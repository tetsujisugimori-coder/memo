"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { prepareAttachmentItems } = require("./attachment-utils.js");
const { createNoteSaveFoundation, createSaveRequest } = require("./note-save-foundation.js");
const {
  ERROR_CODE,
  guardWrites,
  installStore,
  putTombstones,
  transactionError,
  writeAttachments
} = require("./note-tombstone.js");

const app = fs.readFileSync("app.js", "utf8");
const indexHtml = fs.readFileSync("index.html", "utf8");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function waitForTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function cloneValue(value) {
  return value && typeof value === "object" ? { ...value } : value;
}

class DeferredTransaction {
  constructor(database, storeNames, gate) {
    this.database = database;
    this.storeNames = [...new Set(Array.isArray(storeNames) ? storeNames : [storeNames])];
    this.gate = gate;
    this.operations = [];
    this.error = null;
    this.aborted = false;
    this.onabort = null;
    this.oncomplete = null;
    this.onerror = null;
  }

  objectStore(name) {
    if (!this.storeNames.includes(name)) throw new Error(`store ${name} is outside transaction scope`);
    return new DeferredObjectStore(this, name);
  }

  enqueue(action) {
    const request = { error: null, result: undefined, onerror: null, onsuccess: null };
    this.operations.push({ action, request });
    return request;
  }

  fail(error) {
    this.enqueue(() => { throw error; });
  }

  abort() {
    this.aborted = true;
  }

  async run() {
    this.database.startedTransactions.push(this);
    if (this.gate) {
      this.gate.started.resolve(this);
      await this.gate.release.promise;
    }
    const working = {
      notes: new Map(this.database.notes),
      attachments: new Map(this.database.attachments),
      "note-tombstones": new Map(this.database.tombstones)
    };
    for (let index = 0; index < this.operations.length && !this.aborted; index += 1) {
      const { action, request } = this.operations[index];
      try {
        request.result = action(working);
      } catch (error) {
        request.error = error;
        this.error = error;
        request.onerror?.();
        this.onerror?.();
        this.aborted = true;
      }
      await new Promise((resolve) => queueMicrotask(() => {
        if (!request.error) request.onsuccess?.();
        resolve();
      }));
    }
    if (this.aborted) {
      queueMicrotask(() => this.onabort?.());
      return;
    }
    this.database.notes = working.notes;
    this.database.attachments = working.attachments;
    this.database.tombstones = working["note-tombstones"];
    queueMicrotask(() => this.oncomplete?.());
  }
}

class DeferredObjectStore {
  constructor(transaction, name) {
    this.transaction = transaction;
    this.name = name;
  }

  map(working) {
    return working[this.name];
  }

  get(key) {
    return this.transaction.enqueue((working) => {
      this.transaction.database.getLog.push({ store: this.name, key });
      return cloneValue(this.map(working).get(key));
    });
  }

  put(value) {
    return this.transaction.enqueue((working) => {
      const key = this.name === "note-tombstones" ? value.noteId : value.id;
      if (!key) throw new Error(`key is required for ${this.name}`);
      this.map(working).set(String(key), cloneValue(value));
      return key;
    });
  }

  delete(key) {
    return this.transaction.enqueue((working) => this.map(working).delete(String(key)));
  }

  deleteByMemoId(noteId) {
    return this.transaction.enqueue((working) => {
      for (const [id, attachment] of this.map(working)) {
        if (attachment.memoId === noteId) this.map(working).delete(id);
      }
    });
  }
}

class DeferredIndexedDb {
  constructor() {
    this.notes = new Map();
    this.attachments = new Map();
    this.tombstones = new Map();
    this.getLog = [];
    this.startedTransactions = [];
    this.nextGate = null;
    this.tail = Promise.resolve();
  }

  deferNextTransaction() {
    if (this.nextGate) throw new Error("a deferred transaction is already pending");
    const gate = { started: deferred(), release: deferred() };
    this.nextGate = gate;
    return {
      started: gate.started.promise,
      release: () => gate.release.resolve()
    };
  }

  transaction(storeNames) {
    const gate = this.nextGate;
    this.nextGate = null;
    const transaction = new DeferredTransaction(this, storeNames, gate);
    const run = this.tail.then(() => transaction.run());
    this.tail = run.catch(() => {});
    return transaction;
  }
}

function saveRequest(noteId, revision, body) {
  return createSaveRequest({ noteId, revision, snapshot: { id: noteId, revision, body } });
}

function writeNotes(database, notes) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["notes", "note-tombstones"], "readwrite");
    const store = transaction.objectStore("notes");
    guardWrites(transaction, notes.map((note) => note.id), () => {
      notes.forEach((note) => store.put(note));
    });
    transaction.oncomplete = () => resolve(notes);
    transaction.onerror = () => reject(transactionError(transaction, "note save failed"));
    transaction.onabort = () => reject(transactionError(transaction, "note save aborted"));
  });
}

function deletePermanently(database, noteIds, metadata, { fail = false } = {}) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["notes", "attachments", "note-tombstones"], "readwrite");
    const noteStore = transaction.objectStore("notes");
    const attachmentStore = transaction.objectStore("attachments");
    putTombstones(transaction, noteIds.map((noteId) => ({ noteId, ...metadata })));
    noteIds.forEach((noteId) => {
      noteStore.delete(noteId);
      attachmentStore.deleteByMemoId(noteId);
    });
    if (fail) transaction.fail(new Error("delete failed"));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transactionError(transaction, "delete failed"));
    transaction.onabort = () => reject(transactionError(transaction, "delete aborted"));
  });
}

function attachment(database, id, memoId) {
  return { id, memoId, kind: "image", fileName: `${id}.png` };
}

function windowFoundation(database) {
  return createNoteSaveFoundation({ writeSnapshot: (snapshot) => writeNotes(database, [snapshot]) });
}

test("A: note保存transactionを先に予約すると削除が待機し、最後は完全削除になる", async () => {
  const database = new DeferredIndexedDb();
  database.attachments.set("old-image", attachment(database, "old-image", "A"));
  const editingWindow = windowFoundation(database);
  editingWindow.registerNote("A", 0);
  const revision = editingWindow.markChanged("A", 0);
  const gate = database.deferNextTransaction();
  const saving = editingWindow.enqueueSave(saveRequest("A", revision, "saved first"));
  const savingTransaction = await gate.started;
  assert.deepEqual(savingTransaction.storeNames.sort(), ["note-tombstones", "notes"]);
  const deleting = deletePermanently(database, ["A"], { deletionId: "d-a", deletedAt: "now" });
  await waitForTurn();
  assert.equal(database.startedTransactions.length, 1, "delete must wait for the reserved save transaction");
  gate.release();
  await saving;
  await deleting;
  assert.equal(database.notes.has("A"), false);
  assert.equal(database.attachments.has("old-image"), false);
  assert.equal(database.tombstones.get("A").deletionId, "d-a");
});

test("B: 完全削除transactionを先に予約すると古いnote保存が待機し、tombstoneで拒否される", async () => {
  const database = new DeferredIndexedDb();
  database.notes.set("A", { id: "A", revision: 0, body: "before" });
  const suspendedWindow = windowFoundation(database);
  suspendedWindow.registerNote("A", 0);
  const gate = database.deferNextTransaction();
  const deleting = deletePermanently(database, ["A"], { deletionId: "d-b", deletedAt: "now" });
  const deletingTransaction = await gate.started;
  assert.deepEqual(deletingTransaction.storeNames.sort(), ["attachments", "note-tombstones", "notes"]);
  const revision = suspendedWindow.markChanged("A", 0);
  const saving = suspendedWindow.enqueueSave(saveRequest("A", revision, "stale"));
  await waitForTurn();
  assert.equal(database.startedTransactions.length, 1, "save must wait for the reserved delete transaction");
  gate.release();
  await deleting;
  await assert.rejects(saving, (error) => error.code === ERROR_CODE && error.noteId === "A");
  assert.equal(database.notes.has("A"), false);
});

test("C: production attachment writerが先にcommitしても後続の完全削除が添付を除去する", async () => {
  const database = new DeferredIndexedDb();
  database.notes.set("A", { id: "A" });
  const gate = database.deferNextTransaction();
  const adding = writeAttachments({ database, items: [attachment(database, "new-image", "A")] });
  const addingTransaction = await gate.started;
  assert.deepEqual(addingTransaction.storeNames.sort(), ["attachments", "note-tombstones"]);
  const deleting = deletePermanently(database, ["A"], { deletionId: "d-c", deletedAt: "now" });
  await waitForTurn();
  assert.equal(database.startedTransactions.length, 1, "delete must wait for the reserved attachment transaction");
  gate.release();
  await adding;
  await deleting;
  assert.equal(database.notes.has("A"), false);
  assert.equal(database.attachments.has("new-image"), false);
  assert.equal(database.tombstones.has("A"), true);
});

test("D: 完全削除後は通知を受信していないwindowのproduction attachment writerも拒否する", async () => {
  const database = new DeferredIndexedDb();
  await deletePermanently(database, ["A"], { deletionId: "d-d", deletedAt: "now" });
  await assert.rejects(
    writeAttachments({ database, items: [attachment(database, "late-image", "A")] }),
    (error) => error.code === ERROR_CODE && error.noteId === "A" && error.tombstone.deletionId === "d-d"
  );
  assert.equal(database.attachments.size, 0);
});

test("E: attachment準備中にterminal通知を受けると加工後に止まり、保存・editor・一覧を変更しない", async () => {
  const database = new DeferredIndexedDb();
  const editingWindow = windowFoundation(database);
  editingWindow.registerNote("A", 0);
  const preparationGate = deferred();
  const preparationStarted = deferred();
  let writerCalls = 0;
  const editorReferences = [];
  const currentAttachments = [];
  const preparation = prepareAttachmentItems({
    files: [{ name: "slow.png" }],
    noteId: "A",
    assertActive(noteId) {
      const error = editingWindow.terminalError(noteId);
      if (error) throw error;
    },
    async prepare() {
      preparationStarted.resolve();
      await preparationGate.promise;
      return attachment(database, "slow-image", "A");
    }
  });
  const addition = preparation.then(async (items) => {
    writerCalls += 1;
    const saved = await writeAttachments({ database, items });
    currentAttachments.push(...saved);
    editorReferences.push(...saved.map((item) => `attachment://${item.id}`));
  });
  await preparationStarted.promise;
  const tombstone = { deletionId: "d-e", deletedAt: "now" };
  await deletePermanently(database, ["A"], tombstone);
  editingWindow.finishPermanentDeletion(["A"], tombstone);
  preparationGate.resolve();
  await assert.rejects(addition, (error) => error.code === ERROR_CODE);
  assert.equal(writerCalls, 0);
  assert.deepEqual(editorReferences, []);
  assert.deepEqual(currentAttachments, []);
  assert.equal(database.attachments.size, 0);
});

test("F: 複数memoIdのproduction attachment batchは1件のtombstoneで全件abortする", async () => {
  const database = new DeferredIndexedDb();
  await deletePermanently(database, ["A"], { deletionId: "d-f", deletedAt: "now" });
  await assert.rejects(writeAttachments({
    database,
    items: [attachment(database, "a-image", "A"), attachment(database, "b-image", "B")]
  }), (error) => error.code === ERROR_CODE && error.noteId === "A");
  assert.equal(database.attachments.has("a-image"), false);
  assert.equal(database.attachments.has("b-image"), false);
});

test("attachment writerはmemoIdを必須化し、確認対象を重複排除する", async () => {
  const database = new DeferredIndexedDb();
  await assert.rejects(
    writeAttachments({ database, items: [{ id: "orphan" }] }),
    (error) => error.code === "ATTACHMENT_MEMO_ID_REQUIRED" && error.attachmentId === "orphan"
  );
  await assert.rejects(
    writeAttachments({ database, items: [{ id: "blank-owner", memoId: " " }] }),
    (error) => error.code === "ATTACHMENT_MEMO_ID_REQUIRED" && error.attachmentId === "blank-owner"
  );
  assert.equal(database.startedTransactions.length, 0);
  await writeAttachments({
    database,
    items: [
      attachment(database, "a-1", "A"),
      attachment(database, "a-2", "A"),
      attachment(database, "b-1", "B")
    ]
  });
  const tombstoneGets = database.getLog.filter((entry) => entry.store === "note-tombstones");
  assert.deepEqual(tombstoneGets.map((entry) => entry.key), ["A", "B"]);
  assert.equal(database.attachments.size, 3);
});

test("完全削除transaction失敗はtombstone・メモ・添付をrollbackし、再open相当後に保存できる", async () => {
  const database = new DeferredIndexedDb();
  database.notes.set("A", { id: "A", revision: 0, body: "before" });
  database.attachments.set("image", attachment(database, "image", "A"));
  await assert.rejects(deletePermanently(database, ["A"], { deletionId: "failed", deletedAt: "now" }, { fail: true }));
  assert.equal(database.tombstones.has("A"), false);
  assert.equal(database.notes.has("A"), true);
  assert.equal(database.attachments.has("image"), true);
  const reopened = windowFoundation(database);
  reopened.registerNote("A", 0);
  const revision = reopened.markChanged("A", 0);
  await reopened.enqueueSave(saveRequest("A", revision, "after reopen"));
  assert.equal(database.notes.get("A").body, "after reopen");
});

test("複数IDの完全削除は各IDへ同じdeletionIdを残す", async () => {
  const database = new DeferredIndexedDb();
  ["A", "B", "C"].forEach((id) => database.notes.set(id, { id }));
  await deletePermanently(database, ["A", "C"], { deletionId: "same", deletedAt: "now" });
  assert.deepEqual([...database.notes.keys()], ["B"]);
  assert.deepEqual([database.tombstones.get("A").deletionId, database.tombstones.get("C").deletionId], ["same", "same"]);
});

test("note batch内にtombstone済みIDが1件でもあれば全件を原子的に中止する", async () => {
  const database = new DeferredIndexedDb();
  database.notes.set("B", { id: "B", body: "before" });
  await deletePermanently(database, ["A"], { deletionId: "batch", deletedAt: "now" });
  await assert.rejects(writeNotes(database, [{ id: "A", body: "resurrect" }, { id: "B", body: "changed" }]),
    (error) => error.code === ERROR_CODE);
  assert.equal(database.notes.has("A"), false);
  assert.equal(database.notes.get("B").body, "before");
});

test("メイン削除ボタンの非同期失敗は共通エラー表示へ1回だけ渡す", () => {
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

test("変更したブラウザ配信JavaScriptのcache識別子を更新している", () => {
  assert.match(indexHtml, /attachment-utils\.js\?v=0\.5\.0-12/);
  assert.match(indexHtml, /note-tombstone\.js\?v=0\.5\.0-2/);
  assert.match(indexHtml, /note-save-foundation\.js\?v=0\.5\.0-5/);
  assert.match(indexHtml, /app\.js\?v=0\.5\.0-101/);
});

async function runRepeatedRace(pattern, iteration) {
  const database = new DeferredIndexedDb();
  database.notes.set("A", { id: "A", revision: 0 });
  const tombstone = { deletionId: `race-${iteration}`, deletedAt: "now" };
  if (pattern === 0) {
    const gate = database.deferNextTransaction();
    const saving = writeNotes(database, [{ id: "A", body: "early" }]);
    await gate.started;
    const deleting = deletePermanently(database, ["A"], tombstone);
    gate.release();
    await saving;
    await deleting;
  } else if (pattern === 1) {
    const gate = database.deferNextTransaction();
    const deleting = deletePermanently(database, ["A"], tombstone);
    await gate.started;
    const saving = writeNotes(database, [{ id: "A", body: "late" }]).catch((error) => error);
    gate.release();
    await deleting;
    assert.equal((await saving).code, ERROR_CODE);
  } else if (pattern === 2) {
    const gate = database.deferNextTransaction();
    const adding = writeAttachments({ database, items: [attachment(database, `image-${iteration}`, "A")] });
    await gate.started;
    const deleting = deletePermanently(database, ["A"], tombstone);
    gate.release();
    await adding;
    await deleting;
  } else if (pattern === 3) {
    const preparationGate = deferred();
    const preparationStarted = deferred();
    const preparing = prepareAttachmentItems({
      files: [{}], noteId: "A", assertActive: () => {},
      prepare: async () => {
        preparationStarted.resolve();
        await preparationGate.promise;
        return attachment(database, `prepared-${iteration}`, "A");
      }
    });
    await preparationStarted.promise;
    await deletePermanently(database, ["A"], tombstone);
    preparationGate.resolve();
    const items = await preparing;
    const result = await writeAttachments({ database, items }).catch((error) => error);
    assert.equal(result.code, ERROR_CODE);
  } else if (pattern === 4) {
    const editingWindow = windowFoundation(database);
    editingWindow.registerNote("A", 0);
    editingWindow.beginExternalTerminalDelete(["A"], tombstone);
    assert.throws(() => editingWindow.markChanged("A", 0), (error) => error.code === "NOTE_DELETING");
    await deletePermanently(database, ["A"], tombstone);
    editingWindow.finishPermanentDeletion(["A"], tombstone);
  } else {
    await deletePermanently(database, ["A"], tombstone);
    const result = await writeAttachments({ database, items: [attachment(database, `unnotified-${iteration}`, "A")] })
      .catch((error) => error);
    assert.equal(result.code, ERROR_CODE);
  }
  assert.equal(database.notes.has("A"), false, `pattern ${pattern} must not resurrect note A`);
  assert.equal([...database.attachments.values()].some((item) => item.memoId === "A"), false,
    `pattern ${pattern} must not leave an orphan attachment`);
  assert.equal(database.tombstones.has("A"), true, `pattern ${pattern} must retain tombstone A`);
}

test("24回・6種類のdeferred競合でもnote復活と孤立attachmentが0件になる", async () => {
  for (let iteration = 0; iteration < 24; iteration += 1) {
    await runRepeatedRace(iteration % 6, iteration);
  }
});
