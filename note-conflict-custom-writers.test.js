"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const conflict = require("./note-conflict-store.js");
const { mergeStoredCodexThread } = require("./codex-chat-utils.js");
const source = fs.readFileSync(process.env.MEMO_SAVE_TEST_APP_SOURCE || "app.js", "utf8");
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a); return source.slice(a, b);
}
const base = { id: "memo", title: "base", body: "BASE", revision: 7, collectionId: "collection" };
const remote = { ...base, body: "A_NEW", revision: 8 };
// SYNTHETIC transaction model, not IndexedDB/browser evidence. Production callers,
// snapshot preparation, batch CAS, and recovery serialization execute unchanged.
function fixture({ stale = true, fail = null, hold = false, empty = false } = {}) {
  const data = new Map([
    ["notes", new Map(empty ? [] : [[base.id, structuredClone(stale ? remote : base)]])],
    ["collections", new Map([["collection", { id: "collection" }]])],
    ["attachments", new Map([["old-image", { id: "old-image", source: { type: "web-clip" } }]])],
    ["note-conflicts", new Map()], ["note-tombstones", new Map()]
  ]);
  const notices = [], transactions = [], cleanups = [];
  const live = { ...base, body: "B_DRAFT" };
  let release = null;
  const db = { transaction(names) {
    const working = new Map(names.map(name => [name, structuredClone(data.get(name))]));
    let pending = 0, ended = false, scheduled = false;
    const tx = { abort() { if (ended) return; ended = true; queueMicrotask(() => tx.onabort?.()); } };
    transactions.push(tx);
    const complete = () => {
      if (ended || pending) return;
      ended = true; for (const [name, rows] of working) data.set(name, rows);
      tx.oncomplete?.();
    };
    const maybeFinish = () => {
      if (scheduled || ended) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; if (pending || ended) return;
        if (hold) release = complete; else complete(); });
    };
    const request = (name, op, id, value) => {
      const req = {}; pending++;
      queueMicrotask(() => {
        if (ended) return;
        if (fail?.(name, op, id)) {
          tx.error = new Error("synthetic quota/request failure"); tx.onerror?.(); tx.abort(); return;
        }
        const rows = working.get(name);
        if (op === "get") req.result = structuredClone(rows.get(id));
        else if (op === "delete") rows.delete(id);
        else rows.set(id, structuredClone(value));
        req.onsuccess?.(); pending--; maybeFinish();
      }); return req;
    };
    tx.objectStore = name => { assert.ok(working.has(name), `store ${name} belongs to same transaction`); return {
      get: id => request(name, "get", id), put: row => request(name, "put", row.id, row),
      add: row => request(name, "add", row.id, row), delete: id => request(name, "delete", id)
    }; };
    maybeFinish(); return tx;
  } };
  const bases = new Map([[base.id, structuredClone(base)]]);
  const context = vm.createContext({ db, noteSaveBases: bases, noteConflictStates: new Map(), noteConflictStore: conflict,
    noteConflictOwnerId: "synthetic-owner", noteConflictAttemptId: note => `attempt-${note.id}`,
    normalizeNoteRevision: n => Number(n) || 0, cloneNoteSnapshot: structuredClone, mergeStoredCodexThread,
    STORE_NAME: "notes", COLLECTION_STORE_NAME: "collections", ATTACHMENT_STORE_NAME: "attachments",
    TOMBSTONE_STORE_NAME: "note-tombstones", UNCLASSIFIED_COLLECTION_ID: "unclassified",
    guardNoteWrites: (_tx, _ids, ready) => ready(), noteTransactionError: tx => tx.error || Error("aborted"),
    notifyMemoChanged: () => notices.push("changed"), markLocalWorkspacePending: () => notices.push("pending"),
    collections: [{ id: "collection", name: "collection" }], descendantCollectionIds: () => [],
    activeNotes: () => empty ? [] : [live], normalizedCollectionId: n => n.collectionId, confirm: () => true,
    getAllCollections: async () => [...data.get("collections").values()], expandedCollectionIds: new Set(),
    renderAll() {}, showCollectionToast: () => notices.push("toast"), noteForSave: () => live,
    // Boundary adapter only: capture the dirty draft, apply the requested mutation,
    // then invoke the unmodified production writer. Foundation/UI are tested elsewhere.
    mutateNotesAtomically: async (_ids, mutate, write) => {
      const snapshot = structuredClone(live); mutate(snapshot); snapshot.revision++;
      const saved = await write([snapshot]); Object.assign(live, saved[0]); return saved;
    },
    webClipImageBlob: () => ({}), prepareAttachmentFile: async () => ({ id: "new-image", size: 1 }),
    attachmentCapacity: () => ({ allowed: true, total: 1 }), MAX_ATTACHMENT_TOTAL_BYTES: 100,
    serializeImageBlock: () => "image", webClipImageSourceMetadata: () => ({}),
    buildWebClipMarkdown: () => "CLIP_DRAFT", replaceWebClipImageMarkers: body => body,
    getAttachmentsForMemo: async () => [...data.get("attachments").values()],
    deleteAttachmentRecords: async ids => { cleanups.push(ids); for (const id of ids) data.get("attachments").delete(id); }
  });
  vm.runInContext(section("function prepareNoteSnapshotsInTransaction", "function collectionExists") +
    section("async function deleteCollectionSafely", "function openMemoMoveDialog") +
    section("async function createWebClipNoteWithImages", "function consumeWebClipFragment"), context);
  return { data, bases, notices, cleanups, live, context, transactions, release: () => { assert.ok(release); release(); },
    run: kind => kind === "collection" ? context.deleteCollectionSafely("collection") :
      context.createWebClipNoteWithImages("clip", { images: [{ status: "ready", selected: true, token: "image" }], capturedAt: "now" }, {}, "collection", live) };
}
for (const kind of ["collection", "webclip"]) {
  test(`${kind}: stale draft rejects and preserves full draft without related mutations`, async () => {
    const f = fixture();
    await assert.rejects(f.run(kind), e => e.conflictDetected && e.preserved);
    assert.deepEqual(f.data.get("notes").get(base.id), remote);
    assert.equal(f.data.get("collections").has("collection"), true);
    assert.deepEqual([...f.data.get("attachments").keys()], ["old-image"]);
    assert.equal(f.data.get("note-conflicts").get("draft:attempt-memo").body, kind === "collection" ? "B_DRAFT" : "CLIP_DRAFT");
    assert.equal(f.bases.get(base.id).revision, 7); assert.deepEqual(f.notices, []);
    assert.deepEqual(f.cleanups, []); assert.equal(f.live.body, "B_DRAFT");
  });
  test(`${kind}: recovery write failure has no success or collateral writes`, async () => {
    const f = fixture({ fail: (name, op) => name === "note-conflicts" && op === "add" });
    await assert.rejects(f.run(kind), e => e.conflictDetected && !e.preserved);
    assert.deepEqual(f.data.get("notes").get(base.id), remote);
    assert.equal(f.data.get("note-conflicts").size, 0);
    assert.equal(f.data.get("collections").has("collection"), true);
    assert.deepEqual([...f.data.get("attachments").keys()], ["old-image"]);
    assert.deepEqual(f.notices, []); assert.deepEqual(f.cleanups, []); assert.equal(f.bases.get(base.id).revision, 7);
  });
  test(`${kind}: side-effect request failure rolls note and related changes back`, async () => {
    const f = fixture({ stale: false, fail: (name, op) => op === "delete" && name === (kind === "collection" ? "collections" : "attachments") });
    await assert.rejects(f.run(kind), /synthetic/);
    assert.deepEqual(f.data.get("notes").get(base.id), base);
    assert.equal(f.data.get("collections").has("collection"), true);
    assert.deepEqual([...f.data.get("attachments").keys()], ["old-image"]);
    assert.deepEqual(f.notices, []); assert.deepEqual(f.cleanups, []); assert.equal(f.bases.get(base.id).revision, 7);
  });
  test(`${kind}: completion commits side effects and advances base for next save`, async () => {
    const f = fixture({ stale: false, hold: true });
    let settled = false; const operation = f.run(kind).then(() => { settled = true; });
    await new Promise(setImmediate);
    assert.equal(settled, false); assert.deepEqual(f.notices, []); assert.equal(f.bases.get(base.id).revision, 7);
    assert.deepEqual(f.data.get("notes").get(base.id), base);
    f.release(); await operation;
    assert.equal(f.bases.get(base.id).revision, 8);
    assert.equal(f.data.get("collections").has("collection"), kind !== "collection");
    assert.deepEqual([...f.data.get("attachments").keys()], kind === "collection" ? ["old-image"] : ["new-image"]);
    const next = { ...f.live, body: "NEXT_SAVE", revision: 9 };
    const saving = f.context.updateNotesTransaction([next]); await new Promise(setImmediate); f.release(); await saving;
    assert.equal(f.data.get("notes").get(base.id).body, "NEXT_SAVE"); assert.equal(f.bases.get(base.id).revision, 9);
  });
}
test("empty collection deletion still commits its related write", async () => {
  const f = fixture({ empty: true }); await f.run("collection");
  assert.equal(f.data.get("collections").size, 0); assert.ok(f.notices.includes("toast"));
});
test("synchronous side-effect staging failure aborts the note write", async () => {
  const f = fixture({ stale: false });
  await assert.rejects(f.context.updateNotesTransaction([{ ...base, body: "LOCAL", revision: 8 }], {
    stageSideEffects: () => { throw Error("synthetic staging failure"); }
  }), /staging failure/);
  assert.deepEqual(f.data.get("notes").get(base.id), base); assert.deepEqual(f.notices, []);
});
test("batch conflict preserves every attempted draft and skips all related writes", async () => {
  const f = fixture();
  const other = { ...base, id: "other", body: "OTHER_BASE" };
  f.data.get("notes").set(other.id, other); f.bases.set(other.id, structuredClone(other));
  let staged = false;
  await assert.rejects(f.context.updateNotesTransaction([
    { ...base, body: "B_DRAFT", revision: 8 }, { ...other, body: "OTHER_DRAFT", revision: 8 }
  ], { additionalStores: ["collections"], stageSideEffects: () => { staged = true; } }), e => e.conflictDetected && e.preserved);
  assert.equal(staged, false); assert.deepEqual(f.data.get("notes").get(base.id), remote);
  assert.deepEqual(f.data.get("notes").get(other.id), other);
  assert.equal(f.data.get("note-conflicts").get("draft:attempt-other").body, "OTHER_DRAFT");
  assert.deepEqual(f.notices, []);
});
test("successful custom write does not mask a newer remote revision on the next save", async () => {
  const f = fixture({ stale: false }); await f.run("webclip");
  const newer = { ...f.data.get("notes").get(base.id), body: "REMOTE_AGAIN", revision: 9 };
  f.data.get("notes").set(base.id, newer);
  await assert.rejects(f.context.updateNotesTransaction([{ ...f.live, body: "LOCAL_AGAIN", revision: 9 }]), e => e.conflictDetected && e.preserved);
  assert.deepEqual(f.data.get("notes").get(base.id), newer);
  assert.equal(f.data.get("note-conflicts").get("draft:attempt-memo").body, "LOCAL_AGAIN");
  assert.equal(f.bases.get(base.id).revision, 8);
});
