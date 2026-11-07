"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { matches } = require("./note-conflict-store.js");
const source = fs.readFileSync(process.env.MEMO_SAVE_TEST_APP_SOURCE || "app.js", "utf8");
function between(start, end) {
  const at = source.indexOf(start), until = source.indexOf(end, at);
  assert.ok(at >= 0 && until > at);
  return source.slice(at, until);
}
const oldBase = { id: "memo", title: "base", body: "same body", revision: 7, collectionId: "collection", tags: [], isFlagged: false, deletedAt: null, updatedAt: 1000 };
const remote = { ...oldBase, title: "REMOTE TITLE", revision: 8, updatedAt: 2000 };
async function restore(mirror, held = []) {
  const calls = [], states = new Map();
  const context = vm.createContext({ db: {}, notes: [structuredClone(remote)], Date: class extends Date { static now() { return 4000; } },
    DRAFT_STORAGE_KEY: "isolated", DRAFT_MAX_AGE_MS: 100000, UNCLASSIFIED_COLLECTION_ID: "collection",
    localStorage: { getItem: () => JSON.stringify(mirror), removeItem() { throw Error("must not erase mirror"); } },
    console: { warn() {}, log() {} }, crypto: { randomUUID: () => "attempt" },
    timestampValue: (value) => Number(value), normalizeNoteRevision: (value) => Number(value) || 0,
    normalizeTagIds: (value) => value || [], collectionExists: () => true,
    noteConflictStates: states, noteConflictStore: { readDrafts: async () => held },
    putNote: async (note, options) => {
      calls.push({ route: "guarded", note, options });
      throw Object.assign(new Error("synthetic committed conflict"), { conflictDetected: true, preserved: true, recovery: {} });
    },
    persistIncomingNote: async (note) => { calls.push({ route: "unguarded-rebase", note }); },
    noteSaveFoundation: { finishPermanentDeletion() {} }, removeDraftMirrorForNote() {}
  });
  vm.runInContext(`${between("async function restoreCurrentDraftMirror", "// 削除したメモが次回起動時")}\nglobalThis.restore = restoreCurrentDraftMirror;`, context);
  const id = await context.restore();
  return { calls, states, id };
}
test("title-only stale mirror keeps its own baseline instead of silently rebasing to the latest DB", async () => {
  const mirror = { ...oldBase, title: "LOCAL TITLE", draftSavedAt: 3000, conflictBase: oldBase, conflictRequestId: "original" };
  const { calls, states } = await restore(mirror);
  assert.equal(calls.length, 1); assert.equal(calls[0].route, "guarded");
  assert.equal(calls[0].options.expectedBase.revision, 7);
  assert.equal(calls[0].note.title, "LOCAL TITLE"); assert.equal(calls[0].note.body, oldBase.body);
  assert.equal(Object.hasOwn(calls[0].note, "conflictBase"), false);
  assert.equal(states.get("memo").preserved, true);
});
test("metadata-only stale mirror also retains its own baseline", async () => {
  const mirror = { ...remote, isFlagged: true, conflictBase: oldBase, draftSavedAt: 3000 };
  const { calls } = await restore(mirror);
  assert.equal(calls.length, 1); assert.equal(calls[0].route, "guarded");
  assert.equal(calls[0].options.expectedBase.revision, 7); assert.equal(calls[0].note.isFlagged, true);
});
test("already committed mirror restores the selected memo without writing or rebasing", async () => {
  const mirror = { ...remote, conflictBase: oldBase, draftSavedAt: 3000 };
  const { calls, id } = await restore(mirror);
  assert.equal(id, "memo"); assert.equal(calls.length, 0);
});
test("same-body other-title recovery is not incorrectly accepted as the mirror's preserved draft", async () => {
  const mirror = { ...oldBase, title: "LOCAL TITLE", draftSavedAt: 3000, conflictBase: oldBase };
  const { calls } = await restore(mirror, [{ body: mirror.body, title: "DIFFERENT TITLE", snapshot: { ...mirror, title: "DIFFERENT TITLE" } }]);
  assert.equal(calls.length, 1); assert.equal(calls[0].route, "guarded");
});
test("readonly DB/backup read cannot advance the displayed editor's CAS baseline", async () => {
  const raw = { ...remote, body: "REMOTE BODY" }, bases = new Map([["memo", structuredClone(oldBase)]]);
  const snapshots = new WeakMap();
  const context = vm.createContext({ noteSaveBases: bases, noteStoredSnapshots: snapshots,
    noteSaveFoundation: { getState: () => ({ dirty: false, activeRevision: null, pendingRevision: null }) }, noteConflictStates: new Map(),
    cloneNoteSnapshot: structuredClone, withNormalizedFlag: (row) => ({ ...row }), withNormalizedMemoTags: (row) => ({ ...row }), compareDateTimes: () => 0,
    tx: () => ({ getAll() { const request = { result: [structuredClone(raw)] }; queueMicrotask(() => request.onsuccess()); return request; } }) });
  vm.runInContext(`${between("function getStoredNotes()", "function getStoredNoteSnapshots")}\nglobalThis.read = getStoredNotes;`, context);
  const returned = await context.read();
  assert.equal(returned[0].body, "REMOTE BODY");
  assert.equal(bases.get("memo").body, "same body"); assert.equal(bases.get("memo").revision, 7);
  assert.equal(matches(bases.get("memo"), raw, "memo"), false);
  assert.equal(snapshots.get(returned[0]).revision, 8);
});
test("explicitly adopting a stored snapshot advances the baseline; ordinary register does not", () => {
  const rawNote = { ...remote, body: "REMOTE BODY" }, snapshots = new WeakMap([[rawNote, { ...rawNote }]]);
  const bases = new Map([["memo", { ...oldBase }]]);
  const context = vm.createContext({ noteStoredSnapshots: snapshots, noteSaveBases: bases, noteConflictStates: new Map(),
    cloneNoteSnapshot: structuredClone, normalizeNoteRevision: (value) => value || 0,
    noteSaveFoundation: { getState: () => ({ dirty: false, activeRevision: null, pendingRevision: null }), registerNote: () => ({ dirty: false }) } });
  vm.runInContext(`${between("function registerNoteSaveState", "function rememberNoteDraft")}\nglobalThis.register = registerNoteSaveState;`, context);
  context.register(rawNote);
  assert.equal(bases.get("memo").revision, 7);
  context.register(rawNote, { adoptStoredBase: true });
  assert.equal(bases.get("memo").revision, 8); assert.equal(bases.get("memo").body, "REMOTE BODY");
});
