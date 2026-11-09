"use strict";
// Synthetic transaction / VM boundary checks. This is not browser acceptance.
// Product functions are extracted verbatim; the IDB schedule and UI are fixtures.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const crypto = require("node:crypto");
const conflict = require("./note-conflict-store.js");
const { createNoteSaveFoundation, createSaveRequest, normalizeRevision } = require("./note-save-foundation.js");
const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
function between(start, end) {
  const at = source.indexOf(start), until = source.indexOf(end, at);
  assert.ok(at >= 0 && until > at, `Product function boundary: ${start}`);
  return source.slice(at, until);
}

function fixtureDatabase(initial) {
  const data = new Map([["notes", new Map([[initial.id, structuredClone(initial)]])],
    ["note-tombstones", new Map()], ["note-conflicts", new Map()]]);
  const transactions = [];
  return { data, transactions, transaction(names, mode) {
    const staged = new Map(), transaction = { error: null, aborted: false };
    transactions.push({ names, mode });
    let pending = 0, queued = false;
    function finish() {
      if (pending || queued || transaction.aborted) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (pending || transaction.aborted) return;
        for (const [store, rows] of staged) for (const [id, row] of rows) data.get(store).set(id, structuredClone(row));
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
        const request = {};
        pending++;
        queueMicrotask(() => {
          if (transaction.aborted) return;
          request.result = structuredClone(staged.get(name)?.get(id) || data.get(name).get(id));
          try { request.onsuccess?.(); }
          catch (error) { transaction.error = error; transaction.abort(); }
          pending--; finish();
        });
        return request;
      },
      put(record) {
        if (!staged.has(name)) staged.set(name, new Map());
        staged.get(name).set(record.id, structuredClone(record));
        return { result: record.id };
      },
      add(record) { assert.ok(!data.get(name).has(record.id)); return this.put(record); }
    });
    queueMicrotask(finish);
    return transaction;
  } };
}

function recoveryHarness(db, stored, held) {
  const context = vm.createContext({ db, currentId: stored.id, notes: [structuredClone(stored)],
    noteSaveBases: new Map([[stored.id, structuredClone(stored)]]), noteStoredSnapshots: new WeakMap(),
    noteConflictStates: new Map([[stored.id, { recovery: held, preserved: true }]]),
    noteConflictResolutions: new Map(), noteConflictAttempts: new Map(), noteLiveDrafts: new Map(),
    noteConflictStore: conflict, noteConflictOwnerId: "synthetic-reloaded-tab", STORE_NAME: "notes",
    cloneNoteSnapshot: structuredClone, normalizeNoteRevision: normalizeRevision, createSaveRequest,
    crypto, Date, isLocalMemoDirty: false, localDirtyMemoId: null,
    clearScheduledNoteSave() {}, renderNoteConflictUi: async () => {}, setSaveStatus() {},
    titleInput: { value: stored.title, readOnly: true },
    editor: { value: stored.body, readOnly: true, focus() {} },
    guardNoteWrites: (_tx, _ids, allow) => allow(), noteTransactionError: (tx) => tx.error || new Error("synthetic abort"),
    withNormalizedMemoTags: (note) => note, mergeStoredCodexThread: (incoming) => incoming,
    notifyMemoChanged() {}, markLocalWorkspacePending() {}
  });
  context.noteForSave = (id) => context.noteLiveDrafts.get(id) || context.notes.find((note) => note.id === id);
  context.noteSaveFoundation = createNoteSaveFoundation({
    writeSnapshot: (snapshot) => context.putNote(snapshot, {
      expectedBase: context.noteSaveBases.get(snapshot.id), conflictRequestId: context.noteConflictAttemptId(snapshot),
      resolveRequestId: context.noteConflictResolutions.get(snapshot.id)
    }), logError() {}
  });
  context.waitForNoteSave = (id) => context.noteSaveFoundation.whenIdle(id);
  vm.runInContext([
    between("function getStoredNoteSnapshots(", "function noteConflictAttemptId("),
    between("function noteConflictAttemptId(", "function noteConflictUiError("),
    between("async function resumeConflictDraft(", "function ensureNoteConflictUi("),
    between("function putNote(", "// 遅延した通常保存が改名batch"),
    between("function registerNoteSaveState(", "function clearLocalMemoDirty("),
    between("function enqueueNoteSaveSnapshot(", "function enqueueNoteSave("),
  ].join("\n"), context);
  context.registerNoteSaveState(context.notes[0]);
  return context;
}

const legacy = { id: "synthetic-legacy-436", title: "legacy current", body: "confirmed legacy body",
  collectionId: "latest-collection", tags: ["latest-tag"], unknownFuture: { retain: true } };
async function conflictThenReload() {
  const db = fixtureDatabase(legacy);
  const stale = { ...legacy, body: "earlier baseline" };
  const draft = { ...legacy, title: "rejected title", body: "exact rejected draft\n  日本語\t", revision: 1 };
  let held;
  await assert.rejects(conflict.writeNote({ database: db, note: draft, base: stale, requestId: "legacy-first",
    ownerId: "synthetic-original-tab", guard: (_tx, _ids, allow) => allow() }), (error) => {
    held = error.recovery;
    return error.code === "NOTE_SAVE_CONFLICT" && error.preserved;
  });
  assert.deepEqual(db.data.get("notes").get(legacy.id), legacy);
  held = await conflict.readRecovery(db, "legacy-first");
  const reloaded = recoveryHarness(db, structuredClone(db.data.get("notes").get(legacy.id)), held);
  return { db, held, reloaded };
}

test("synthetic: missing v6 revision survives conflict, reload, explicit re-edit and guarded save", async () => {
  const { db, held, reloaded } = await conflictThenReload();
  await reloaded.resumeConflictDraft(held.draft);
  const live = reloaded.noteForSave(legacy.id);
  assert.equal(live.revision, 1, "registerNoteSaveState normalizes intermediate NaN before markChanged");
  assert.ok(Number.isSafeInteger(live.revision));
  assert.equal(Object.hasOwn(reloaded.noteSaveBases.get(legacy.id), "revision"), false, "CAS retains raw absent-field baseline");
  assert.equal(reloaded.noteSaveFoundation.getState(legacy.id).dirty, true);
  assert.equal(reloaded.editor.readOnly, false);
  assert.equal(reloaded.editor.value, held.draft.body);
  assert.deepEqual(db.data.get("notes").get(legacy.id), legacy, "resume alone does not write");
  await reloaded.enqueueNoteSaveSnapshot(legacy.id);
  await reloaded.noteSaveFoundation.whenIdle(legacy.id);
  const committed = db.data.get("notes").get(legacy.id);
  assert.equal(committed.revision, 1); assert.equal(committed.body, held.draft.body); assert.equal(committed.title, held.draft.title);
  assert.equal(committed.collectionId, legacy.collectionId); assert.deepEqual(committed.tags, legacy.tags);
  assert.deepEqual(committed.unknownFuture, legacy.unknownFuture);
  assert.equal(reloaded.noteSaveFoundation.getState(legacy.id).dirty, false);
  assert.ok([...db.data.get("note-conflicts").values()].every((row) => row.resolvedAt && row.resolvedRevision === 1));
});

test("synthetic: post-resume external update still refuses obsolete revision and preserves a new lineage", async () => {
  const { db, held, reloaded } = await conflictThenReload();
  await reloaded.resumeConflictDraft(held.draft);
  const external = { ...legacy, body: "newer external commit", revision: 1 };
  db.data.get("notes").set(legacy.id, structuredClone(external));
  await assert.rejects(reloaded.enqueueNoteSaveSnapshot(legacy.id), (error) => error.code === "NOTE_SAVE_CONFLICT" && error.preserved);
  await reloaded.noteSaveFoundation.whenIdle(legacy.id);
  assert.deepEqual(db.data.get("notes").get(legacy.id), external);
  const drafts = [...db.data.get("note-conflicts").values()].filter((row) => row.kind === "memo-conflict-draft");
  assert.equal(drafts.length, 2);
  assert.ok(drafts.some((row) => row.parentRequestId === held.draft.requestId && row.body === held.draft.body));
  assert.equal(reloaded.noteSaveFoundation.getState(legacy.id).dirty, true);
});

test("synthetic: malformed stored revision is rejected before rebase or editable recovery", async () => {
  for (const revision of [null, "0", -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const stored = { ...legacy, revision }, db = fixtureDatabase(stored);
    const held = conflict.conflictRecords({ ...legacy, body: "held", revision: 1 }, legacy, stored, "invalid", "tab");
    const reloaded = recoveryHarness(db, stored, held);
    await assert.rejects(reloaded.resumeConflictDraft(held.draft), /現在の保存内容を確認できません/);
    assert.equal(reloaded.editor.readOnly, true);
    assert.equal(reloaded.noteConflictResolutions.size, 0);
    assert.equal(reloaded.noteConflictStates.has(legacy.id), true);
    assert.deepEqual(db.data.get("notes").get(legacy.id), stored);
  }
});
