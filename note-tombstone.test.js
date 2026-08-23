"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { createNoteSaveFoundation, createSaveRequest } = require("./note-save-foundation.js");
const {
  ERROR_CODE,
  guardWrites,
  installStore,
  transactionError
} = require("./note-tombstone.js");

const app = fs.readFileSync("app.js", "utf8");

function request(noteId, revision, body) {
  return createSaveRequest({ noteId, revision, snapshot: { id: noteId, revision, body } });
}

class SharedIndexedDbEquivalent {
  constructor() {
    this.notes = new Map();
    this.attachments = new Map();
    this.tombstones = new Map();
    this.tail = Promise.resolve();
  }

  transaction(operation) {
    const run = this.tail.then(async () => {
      const next = {
        notes: new Map(this.notes),
        attachments: new Map(this.attachments),
        tombstones: new Map(this.tombstones)
      };
      await operation(next);
      this.notes = next.notes;
      this.attachments = next.attachments;
      this.tombstones = next.tombstones;
    });
    this.tail = run.catch(() => {});
    return run;
  }

  save(note) {
    return this.saveBatch([note]);
  }

  saveBatch(notes) {
    return this.transaction((next) => {
      const tombstone = notes.map((note) => next.tombstones.get(note.id)).find(Boolean);
      if (tombstone) {
        const error = new Error("permanently deleted");
        error.code = ERROR_CODE;
        error.noteId = tombstone.noteId;
        error.tombstone = tombstone;
        throw error;
      }
      notes.forEach((note) => next.notes.set(note.id, structuredClone(note)));
    });
  }

  deletePermanently(noteIds, metadata, { fail = false } = {}) {
    return this.transaction((next) => {
      noteIds.forEach((noteId) => {
        next.tombstones.set(noteId, { noteId, ...metadata });
        next.notes.delete(noteId);
        [...next.attachments].forEach(([id, attachment]) => {
          if (attachment.memoId === noteId) next.attachments.delete(id);
        });
      });
      if (fail) throw new Error("delete failed");
    });
  }
}

function windowFoundation(storage) {
  return createNoteSaveFoundation({ writeSnapshot: (snapshot) => storage.save(snapshot) });
}

test("A: 保存完了後に完全削除するとメモと添付を復活不能にする", async () => {
  const storage = new SharedIndexedDbEquivalent();
  const first = windowFoundation(storage);
  first.registerNote("A", 0);
  const revision = first.markChanged("A", 0);
  await first.enqueueSave(request("A", revision, "saved first"));
  storage.attachments.set("image", { id: "image", memoId: "A" });
  await first.runTerminalDelete(["A"], () => storage.deletePermanently(["A"], { deletionId: "d-a", deletedAt: "now" }), { deletionId: "d-a", deletedAt: "now" });
  assert.equal(storage.notes.has("A"), false);
  assert.equal(storage.attachments.has("image"), false);
  assert.equal(storage.tombstones.get("A").deletionId, "d-a");
});

test("B/D: 削除完了後はBroadcastChannel通知が届かない別ウィンドウの古い保存も拒否する", async () => {
  const storage = new SharedIndexedDbEquivalent();
  const deletingWindow = windowFoundation(storage);
  const suspendedWindow = windowFoundation(storage);
  suspendedWindow.registerNote("A", 0);
  await deletingWindow.runTerminalDelete(["A"], () => storage.deletePermanently(["A"], { deletionId: "d-b", deletedAt: "now" }), { deletionId: "d-b" });
  const revision = suspendedWindow.markChanged("A", 0);
  await assert.rejects(suspendedWindow.enqueueSave(request("A", revision, "stale")), (error) => error.code === ERROR_CODE);
  assert.equal(storage.notes.has("A"), false);
});

test("C: 完全削除開始通知を受けたウィンドウは編集中の新規保存を止める", async () => {
  const storage = new SharedIndexedDbEquivalent();
  const editingWindow = windowFoundation(storage);
  editingWindow.registerNote("A", 0);
  editingWindow.beginExternalTerminalDelete(["A"], { deletionId: "d-c", deletedAt: "now" });
  assert.throws(() => editingWindow.markChanged("A", 0), (error) => error.code === "NOTE_DELETING");
  assert.equal(storage.notes.has("A"), false);
});

test("E: 完全削除transaction失敗はtombstone・メモ・添付をrollbackし、再open相当後に保存できる", async () => {
  const storage = new SharedIndexedDbEquivalent();
  storage.notes.set("A", { id: "A", revision: 0, body: "before" });
  storage.attachments.set("image", { id: "image", memoId: "A" });
  const first = windowFoundation(storage);
  first.registerNote("A", 0);
  await assert.rejects(first.runTerminalDelete(["A"], () => storage.deletePermanently(["A"], { deletionId: "d-e", deletedAt: "now" }, { fail: true })));
  assert.equal(storage.tombstones.has("A"), false);
  assert.equal(storage.notes.has("A"), true);
  assert.equal(storage.attachments.has("image"), true);
  const reopened = windowFoundation(storage);
  reopened.registerNote("A", 0);
  const revision = reopened.markChanged("A", 0);
  await reopened.enqueueSave(request("A", revision, "after reopen"));
  assert.equal(storage.notes.get("A").body, "after reopen");
});

test("F: 複数IDの完全削除は各IDへ同じdeletionIdを残す", async () => {
  const storage = new SharedIndexedDbEquivalent();
  ["A", "B", "C"].forEach((id) => storage.notes.set(id, { id }));
  await storage.deletePermanently(["A", "C"], { deletionId: "d-f", deletedAt: "now" });
  assert.deepEqual([...storage.notes.keys()], ["B"]);
  assert.deepEqual([storage.tombstones.get("A").deletionId, storage.tombstones.get("C").deletionId], ["d-f", "d-f"]);
});

test("G: batch内にtombstone済みIDが1件でもあれば全件を原子的に中止する", async () => {
  const storage = new SharedIndexedDbEquivalent();
  storage.notes.set("B", { id: "B", body: "before" });
  await storage.deletePermanently(["A"], { deletionId: "d-g", deletedAt: "now" });
  await assert.rejects(storage.saveBatch([{ id: "A", body: "resurrect" }, { id: "B", body: "changed" }]), (error) => error.code === ERROR_CODE);
  assert.equal(storage.notes.has("A"), false);
  assert.equal(storage.notes.get("B").body, "before");
});

test("H: メイン削除ボタンの非同期失敗は共通エラー表示へ1回だけ渡す", () => {
  const binding = app.match(/if \(deleteBtn\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(binding, /deleteCurrentNote\(\)\.catch\(showCollectionError\)/);
  assert.equal((binding.match(/showCollectionError/g) || []).length, 1);
});

test("tombstone guardは同一transactionで未削除を許可し、削除済みを専用errorでabortする", async () => {
  const run = (result) => new Promise((resolve) => {
    const transaction = {
      objectStore: () => ({ get: () => {
        const request = { result, error: null };
        queueMicrotask(() => request.onsuccess());
        return request;
      } }),
      abort() { resolve({ allowed: false, error: transactionError(transaction) }); }
    };
    guardWrites(transaction, ["A"], () => resolve({ allowed: true }), "note-tombstones");
  });
  assert.deepEqual(await run(undefined), { allowed: true });
  const blocked = await run({ noteId: "A", deletionId: "d", deletedAt: "now" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.error.code, ERROR_CODE);
});

test("DB migrationは新規・旧DBへstoreを作成し、作成失敗を握りつぶさない", () => {
  const stores = new Set();
  const created = [];
  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore(name, options) {
      stores.add(name);
      created.push({ name, options });
      return { createIndex: (indexName, keyPath) => created.push({ indexName, keyPath }) };
    }
  };
  installStore(database);
  installStore(database);
  assert.equal(created.filter((item) => item.name === "note-tombstones").length, 1);
  assert.deepEqual(created[0].options, { keyPath: "noteId" });
  assert.throws(() => installStore({
    objectStoreNames: { contains: () => false },
    createObjectStore() { throw new Error("upgrade aborted"); }
  }), /upgrade aborted/);
  assert.match(app, /const DB_VERSION = 6;/);
  assert.match(app, /installTombstoneStore\(database, TOMBSTONE_STORE_NAME\)/);
});

test("20回のsave/delete競合でも完全削除後に復活しない", async () => {
  for (let index = 0; index < 20; index += 1) {
    const storage = new SharedIndexedDbEquivalent();
    const first = windowFoundation(storage);
    const second = windowFoundation(storage);
    first.registerNote("A", 0);
    second.registerNote("A", 0);
    const deletion = storage.deletePermanently(["A"], { deletionId: `race-${index}`, deletedAt: "now" });
    const revision = second.markChanged("A", 0);
    const save = second.enqueueSave(request("A", revision, `stale-${index}`)).catch((error) => error);
    await deletion;
    const result = await save;
    assert.equal(result.code, ERROR_CODE);
    assert.equal(storage.notes.has("A"), false);
  }
});
