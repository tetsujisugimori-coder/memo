"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { revisionOf, conflictRecords, installStore, writeNote, validRecovery } = require("./note-conflict-store.js");
const { createNoteSaveFoundation, createSaveRequest } = require("./note-save-foundation.js");

// Fault-model tests only; actual browser schedules are tested separately without
// replacing their IDB writer, timers, channels or save functions.
function database(initial = [], fault = {}) {
  const data = new Map([ ["notes", new Map(initial.map((note) => [note.id, structuredClone(note)]))],
    ["note-tombstones", new Map()], ["note-conflicts", new Map()] ]);
  const transactions = [];
  return { data, transactions, transaction(names, mode) {
    if (fault.openError) throw fault.openError;
    const staged = new Map(), transaction = { error: null, aborted: false };
    transactions.push({ names, mode });
    let pending = 0, queued = false;
    function finish() {
      if (pending || queued || transaction.aborted) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (pending || transaction.aborted) return;
        if (fault.abortAfterRequestSuccess) { transaction.abort(); return; }
        for (const [store, rows] of staged) for (const [id, record] of rows) data.get(store).set(id, structuredClone(record));
        transaction.oncomplete?.();
      });
    }
    transaction.abort = () => {
      if (transaction.aborted) return;
      transaction.aborted = true;
      queueMicrotask(() => transaction.onabort?.());
    };
    transaction.objectStore = (name) => ({
      get(id) {
        const request = { result: undefined };
        pending++;
        queueMicrotask(() => {
          if (transaction.aborted) return;
          request.result = structuredClone(staged.get(name)?.get(id) || data.get(name).get(id));
          try { request.onsuccess?.(); } catch (error) { transaction.error = error; transaction.abort(); }
          pending--; finish();
        });
        return request;
      },
      put(record) {
        if (fault.failStore === name) throw Object.assign(new Error("synthetic quota fault"), { name: "QuotaExceededError" });
        const copy = structuredClone(record);
        if (!staged.has(name)) staged.set(name, new Map());
        staged.get(name).set(record.id, copy);
        return { result: record.id };
      },
      add(record) { return this.put(record); }
    });
    queueMicrotask(finish);
    return transaction;
  } };
}
const baseline = { id: "memo", title: "架空メモ", body: "lineA=single\nlineB=sequential", revision: 7, unknownFuture: { retained: true } };
const editA = { ...baseline, body: "lineA=overlap-A\nlineB=sequential", revision: 8 };
const editB = { ...baseline, body: "lineA=single\nlineB=overlap-B", revision: 8 };
function write(db, note, base = baseline, extra = {}) {
  return writeNote({ database: db, note, base, requestId: "attempt", ownerId: "isolated-tab",
    guard: (_tx, _ids, allowed) => allowed(), transactionError: (tx) => tx.error || new Error("aborted"), ...extra });
}

test("legacy absent revision alone maps to 0; invalid values never become matches", () => {
  assert.equal(revisionOf(null), null);
  assert.equal(revisionOf({}), 0);
  for (const value of [null, "7", -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(revisionOf({ revision: value }), undefined);
  for (const value of [0, 7, Number.MAX_SAFE_INTEGER]) assert.equal(revisionOf({ revision: value }), value);
});
test("schema upgrade is additive and idempotent and propagates creation failure", () => {
  const stores = new Set(["notes", "tags"]), created = [];
  const db = { objectStoreNames: { contains: (name) => stores.has(name) }, createObjectStore(name, options) {
    stores.add(name); created.push({ name, options }); return { createIndex: (name, path) => created.push({ name, path }) };
  } };
  installStore(db); installStore(db);
  assert.deepEqual([...stores], ["notes", "tags", "note-conflicts"]);
  assert.equal(created.length, 2);
  assert.deepEqual(created[0].options, { keyPath: "id" });
  assert.throws(() => installStore({ objectStoreNames: { contains: () => false }, createObjectStore() { throw new Error("abort upgrade"); } }), /abort upgrade/);
});
test("same revision commits notes and increments persisted generation in one readwrite transaction", async () => {
  const db = database([baseline]);
  const saved = await write(db, editA);
  assert.equal(saved.body, editA.body); assert.equal(saved.revision, 8);
  assert.deepEqual(db.transactions, [{ names: ["notes", "note-tombstones", "note-conflicts"], mode: "readwrite" }]);
  assert.equal(db.data.get("note-conflicts").size, 0);
});
test("stale revision rejects after committing exact draft and receipt, preserving confirmed note", async () => {
  const db = database([editA]);
  await assert.rejects(write(db, editB), (error) => error.code === "NOTE_SAVE_CONFLICT" && error.preserved === true && error.recovery.receipt.committedRevision === 8);
  assert.deepEqual(db.data.get("notes").get("memo"), editA);
  const records = [...db.data.get("note-conflicts").values()];
  assert.equal(records.length, 2);
  assert.equal(records.find((row) => row.kind === "memo-conflict-draft").body, editB.body);
  assert.equal(records.find((row) => row.kind === "memo-conflict-rejection").expectedRevision, 7);
});
test("retry of same rejected draft is idempotent and returns actual original durable records", async () => {
  const db = database([editA]);
  let original;
  await write(db, editB).catch((error) => { original = error.recovery; });
  await assert.rejects(write(db, editB), (error) => { assert.deepEqual(error.recovery, original); return true; });
  assert.equal(db.data.get("note-conflicts").size, 2);
});
test("colliding attempt identifier cannot claim a different draft was preserved", async () => {
  const db = database([editA]);
  await write(db, editB).catch(() => {});
  await assert.rejects(write(db, { ...editB, body: "different exact bytes" }), (error) => error.code === "NOTE_CONFLICT_PRESERVATION_FAILED" && !error.preserved);
  assert.equal(db.data.get("note-conflicts").get("draft:attempt").body, editB.body);
});
test("recovery quota failure aborts whole transaction and never reports preservation", async () => {
  const db = database([editA], { failStore: "note-conflicts" });
  await assert.rejects(write(db, editB), (error) => error.code === "NOTE_CONFLICT_PRESERVATION_FAILED" && !error.preserved && error.cause.name === "QuotaExceededError");
  assert.deepEqual(db.data.get("notes").get("memo"), editA);
  assert.equal(db.data.get("note-conflicts").size, 0);
});
test("request success followed by abort is not a commit and never advances foundation saved state", async () => {
  const db = database([baseline], { abortAfterRequestSuccess: true });
  const foundation = createNoteSaveFoundation({ writeSnapshot: (snapshot) => write(db, snapshot) });
  foundation.registerNote("memo", 7); const revision = foundation.markChanged("memo", 7);
  await assert.rejects(foundation.enqueueSave(createSaveRequest({ noteId: "memo", revision, snapshot: editA })));
  await foundation.whenIdle("memo");
  const state = foundation.getState("memo");
  assert.equal(state.dirty, true); assert.equal(state.status, "error"); assert.equal(state.lastSavedRevision, 7);
  assert.deepEqual(db.data.get("notes").get("memo"), baseline);
});
test("normal notes-store quota failure retains dirty retry data rather than reporting success", async () => {
  const db = database([baseline], { failStore: "notes" });
  const foundation = createNoteSaveFoundation({ writeSnapshot: (snapshot) => write(db, snapshot) });
  foundation.registerNote("memo", 7); const revision = foundation.markChanged("memo", 7);
  const request = createSaveRequest({ noteId: "memo", revision, snapshot: editA });
  await assert.rejects(foundation.enqueueSave(request), { name: "QuotaExceededError" });
  assert.equal(request.snapshot.body, editA.body);
  assert.equal(foundation.getState("memo").dirty, true);
  assert.equal(db.data.get("notes").get("memo").body, baseline.body);
});
test("unknown or malformed stored revision refuses overwrite and preserves the draft", async () => {
  for (const revision of [null, "7", -1, NaN]) {
    const stored = { ...baseline, revision }, db = database([stored]);
    await assert.rejects(write(db, editA), (error) => error.code === "NOTE_SAVE_CONFLICT");
    assert.deepEqual(db.data.get("notes").get("memo"), stored);
  }
});
test("a missing baseline cannot create an unconditional update", async () => {
  const db = database([baseline]);
  await assert.rejects(writeNote({ database: db, note: editA, base: undefined, requestId: "unknown", ownerId: "tab", guard: (_tx, _ids, fn) => fn() }), { code: "NOTE_SAVE_CONFLICT" });
  assert.equal(db.data.get("notes").get("memo").body, baseline.body);
});
test("legacy record missing revision upgrades only with explicit legacy baseline", async () => {
  const legacy = { id: "memo", title: "legacy", body: "original" }, db = database([legacy]);
  const saved = await write(db, { ...legacy, body: "updated", revision: 1 }, legacy);
  assert.equal(saved.revision, 1);
});
test("unknown future fields and exact unformatted draft text survive", async () => {
  const db = database([baseline]);
  const saved = await write(db, { id: "memo", title: baseline.title, body: "\r\n  raw\u0000日本語\t\n", revision: 8 });
  assert.deepEqual(saved.unknownFuture, baseline.unknownFuture);
  const records = conflictRecords(saved, baseline, editB, "exact", "tab", 123);
  assert.equal(records.draft.body, saved.body); assert.equal(records.draft.createdAt, 123);
});
test("DB VersionError is an execution failure and cannot become saved", async () => {
  const db = database([], { openError: Object.assign(new Error("newer database"), { name: "VersionError" }) });
  await assert.rejects(write(db, editA), { name: "VersionError" });
  assert.equal(db.transactions.length, 0);
});
test("a repeated conflict retains both generations and explicit resolution marks the recovery lineage atomically", async () => {
  const db = database([editA]);
  await write(db, editB).catch(() => {});
  const newer = { ...editA, body: "newer committed", revision: 9 };
  db.data.get("notes").set("memo", newer);
  await assert.rejects(write(db, { ...editB, revision: 10 }, editA, { requestId: "second", resolveRequestId: "attempt" }), { code: "NOTE_SAVE_CONFLICT" });
  assert.equal(db.data.get("note-conflicts").get("draft:second").parentRequestId, "attempt");
  const saved = await write(db, { ...editB, revision: 11 }, newer, { requestId: "final", resolveRequestId: "second" });
  assert.equal(saved.body, editB.body);
  assert.equal(db.data.get("note-conflicts").size, 4);
  assert.ok([...db.data.get("note-conflicts").values()].every((record) => record.resolvedAt && record.resolvedRevision === 11));
});
test("same body with another title or broken snapshot cannot be falsely called an idempotent preserved attempt", async () => {
  for (const corrupt of [
    (record) => { record.title = "different title"; },
    (record) => { record.snapshot.body = "different snapshot"; },
    (record) => { record.baseRevision = 6; }
  ]) {
    const db = database([editA]); await write(db, editB).catch(() => {});
    corrupt(db.data.get("note-conflicts").get("draft:attempt"));
    await assert.rejects(write(db, editB), { code: "NOTE_CONFLICT_PRESERVATION_FAILED" });
  }
});
test("recovery read validation binds draft content, title and baseline to an actual committed receipt", () => {
  const records = conflictRecords(editB, baseline, editA, "bound", "tab");
  assert.equal(validRecovery(records, "bound"), true);
  for (const corrupt of [
    (data) => { data.draft.snapshot.title = "mismatch"; },
    (data) => { data.receipt.committedSnapshot.body = "mismatch"; },
    (data) => { data.receipt.committedRevision += 1; },
    (data) => { data.draft.requestId = "another"; },
    (data) => { data.draft.baseRevision += 1; }
  ]) { const data = structuredClone(records); corrupt(data); assert.equal(validRecovery(data, "bound"), false); }
});
