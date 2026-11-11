"use strict";
// Synthetic IDB/DOM schedule, using production cleanup, recovery store and foundation.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const store = require('./note-conflict-store.js');
const { createNoteSaveFoundation } = require('./note-save-foundation.js');
const source = fs.readFileSync(process.env.MEMO_DELETE_TEST_APP_SOURCE || 'app.js', 'utf8');
const helperSource = fs.readFileSync('note-conflict-store.test.js', 'utf8');
const helper = vm.createContext({ structuredClone, queueMicrotask });
vm.runInContext(helperSource.slice(helperSource.indexOf('function database('), helperSource.indexOf('const baseline =')), helper);
function harness(fault = {}) {
  const db = helper.database([], fault), foundation = createNoteSaveFoundation({ writeSnapshot: async () => { throw Error('no note write expected'); } });
  const draft = { id: 'N', body: 'UNSAVED B manuscript\r\n日本語\t', title: 'N', revision: 8 };
  foundation.registerNote('N', 7); foundation.markChanged('N', 7);
  const drafts = new Map([['N', draft]]), mirrors = new Map([['N', draft]]), notices = [], renders = [];
  const ctx = { noteSaveFoundation: foundation, noteConflictStore: store, noteSaveBases: new Map(), noteConflictStates: new Map(),
    noteConflictOwnerId: 'synthetic-tab', noteConflictAttemptId: (note) => `attempt-${note.body}`, cloneNoteSnapshot: structuredClone,
    orphanConflictSelection: null, failedDeletedDraftRecoveries: new Map(), noteLiveDrafts: drafts, noteForSave: (id) => drafts.get(id), noteSaveBeforeBodies: new Map(), noteSaveUiChanges: new Map(), memoLinkRenameSaveTasks: new Map(), selectedMemoIds: new Set(), typingPerformanceEnabled: false,
    clearScheduledNoteSave() {}, removeDraftMirrorForNote: (id) => mirrors.delete(id),
    localStorage: { getItem: () => mirrors.has('N') ? JSON.stringify(mirrors.get('N')) : null }, DRAFT_STORAGE_KEY: 'synthetic',
    db, getAllNotes: async () => [{ id: 'other' }], notes: [draft], currentId: 'N', editor: { value: draft.body }, titleInput: { value: draft.title },
    invalidateTermRelationIndex() {}, isPopoutWindow: false, activeNotes: () => [{ id: 'other' }],
    openNote: (id) => { ctx.currentId = id; }, renderAll() {}, setSaveStatus: (s) => notices.push(s), setSaveStatusNotice: (s) => notices.push(s),
    ensureNoteConflictUi: () => ({ render: (model) => renders.push(model) }) };
  vm.createContext(ctx);
  const start = source.includes('async function preservePermanentlyDeletedDraft') ? source.indexOf('async function preservePermanentlyDeletedDraft') : source.indexOf('async function performPermanentDeletionCleanup');
  vm.runInContext(source.slice(start, source.indexOf('async function handleMemoSyncMessage', start)), ctx);
  return { ctx, db, foundation, drafts, mirrors, draft, notices, renders };
}
test('remote permanent deletion durably preserves full dirty manuscript before cleanup without resurrection', async () => {
  const h = harness();
  await h.ctx.performPermanentDeletionCleanup(['N'], { deletionId: 'remote-delete' });
  const rows = [...h.db.data.get('note-conflicts').values()];
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.kind === 'memo-conflict-draft').body, h.draft.body);
  assert.equal(h.db.data.get('notes').size, 0);
  assert.equal(h.drafts.size, 0); assert.equal(h.mirrors.size, 0); assert.equal(h.foundation.getState('N'), null);
  assert.equal(h.ctx.currentId, 'other');
  assert.deepEqual(Array.from(h.db.transactions, tx => tx.names), ['note-conflicts']);
});
for (const [name, fault] of [['quota', { failStore: 'note-conflicts' }], ['abort after request success', { abortAfterRequestSuccess: true }], ['connection failure', { openError: new Error('connection unavailable') }]]) {
  test(`${name}: failed deletion preservation retains live manuscript and mirror with export warning`, async () => {
    const h = harness(fault);
    await h.ctx.performPermanentDeletionCleanup(['N'], { deletionId: 'remote-delete' });
    assert.equal(h.db.data.get('note-conflicts').size, 0);
    assert.equal(h.drafts.get('N').body, h.draft.body); assert.equal(h.mirrors.get('N').body, h.draft.body);
    assert.equal(h.ctx.currentId, 'N'); assert.equal(h.foundation.isDirty('N'), true);
    assert.equal(h.foundation.isTerminal('N'), true);
    assert.equal(h.renders.at(-1).state.preserved, false);
    assert.match(h.notices.join('\n'), /書き出してください/);
    assert.doesNotMatch(h.notices.join('\n'), /保全しました|保存済み/);
  });
}
for (const fail of [false, true]) {
  test(`tombstoned startup mirror ${fail ? 'failure retains mirror and exportable text' : 'is preserved before mirror removal'}`, async () => {
    const h = harness(fail ? { failStore: 'note-conflicts' } : {});
    Object.assign(h.ctx, { notes: [], Date, console, DRAFT_MAX_AGE_MS: 100000, UNCLASSIFIED_COLLECTION_ID: 'default',
      collectionExists: () => false, timestampValue: (value) => Number(value) || null, normalizeTagIds: () => [],
      persistIncomingNote: async () => { throw Object.assign(new Error('deleted'), { code: 'NOTE_PERMANENTLY_DELETED', noteId: 'N' }); } });
    const start = source.indexOf('async function restoreCurrentDraftMirror');
    vm.runInContext(source.slice(start, source.indexOf('// 削除したメモが次回起動時', start)), h.ctx);
    assert.equal(await h.ctx.restoreCurrentDraftMirror(), null);
    assert.equal(h.db.data.get('notes').size, 0);
    if (fail) {
      assert.equal(h.mirrors.get('N').body, h.draft.body);
      assert.equal(h.renders.at(-1).state.preserved, false);
      assert.equal(h.renders.at(-1).state.recovery.draft.body, h.draft.body);
    } else {
      assert.equal(h.mirrors.size, 0);
      assert.equal([...h.db.data.get('note-conflicts').values()].find(row => row.kind === 'memo-conflict-draft').body, h.draft.body);
    }
  });
}
test('orphan draft list survives reload, selection does not navigate or resurrect missing note', async () => {
  const h = harness();
  const recovery = store.conflictRecords(h.draft, null, null, 'orphan', 'old-tab');
  h.ctx.currentId = 'other'; h.ctx.noteConflictResolutions = new Map(); h.ctx.noteConflictRenderSequence = 0;
  h.ctx.noteConflictUi = { render: model => h.renders.push(model) };
  h.ctx.ensureNoteConflictUi = () => h.ctx.noteConflictUi;
  h.ctx.getStoredNoteSnapshots = async () => new Map([['other', { id: 'other', body: 'unchanged' }]]);
  h.ctx.noteConflictStore = { ...store, readDrafts: async (_db, id) => { assert.equal(id, null); return [recovery.draft]; }, readRecovery: async () => recovery };
  const start = source.indexOf('async function renderNoteConflictUi');
  vm.runInContext(source.slice(start, source.indexOf('function refreshNoteConflictUi', start)), h.ctx);
  const choose = source.indexOf('async function chooseConflictDraft');
  vm.runInContext(source.slice(choose, source.indexOf('async function resumeConflictDraft', choose)), h.ctx);
  await h.ctx.renderNoteConflictUi();
  assert.equal(h.renders.at(-1).drafts.length, 1);
  await h.ctx.chooseConflictDraft(recovery.draft);
  assert.equal(h.ctx.currentId, 'other'); assert.equal(h.renders.at(-1).missing, true);
  assert.equal(h.renders.at(-1).state.recovery.draft.body, h.draft.body);
  assert.equal(h.ctx.editor.readOnly, false);
});
test('input after external delete-started is captured from visible editor before cleanup', async () => {
  const h = harness();
  h.foundation.beginExternalTerminalDelete(['N'], { deletionId: 'remote-delete' });
  h.ctx.editor.value += '\nlast input after notification';
  const visible = h.ctx.editor.value;
  await h.ctx.performPermanentDeletionCleanup(['N'], { deletionId: 'remote-delete' });
  const rows = [...h.db.data.get('note-conflicts').values()].filter(row => row.kind === 'memo-conflict-draft');
  assert.ok(rows.some(row => row.body === visible));
  assert.ok(rows.some(row => row.body === h.draft.body));
});

test('failed newest manuscript stays selected when older mirror preservation succeeds', async () => {
  const h = harness();
  const original = store.preserveDeletedDraft;
  h.ctx.editor.value = 'newest visible text';
  h.ctx.noteConflictStore = { ...store, preserveDeletedDraft: (options) => {
    if (options.note.body === 'newest visible text') return Promise.reject(store.conflictError(options.note,
      store.conflictRecords(options.note, null, null, options.requestId, options.ownerId), false));
    return original(options);
  } };
  await h.ctx.performPermanentDeletionCleanup(['N'], {});
  assert.equal(h.ctx.orphanConflictSelection.preserved, false);
  assert.equal(h.ctx.orphanConflictSelection.recovery.draft.body, 'newest visible text');
  assert.equal(h.ctx.noteConflictStates.get('N').preserved, false);
  assert.equal(h.ctx.failedDeletedDraftRecoveries.size, 1);
  assert.equal(h.ctx.currentId, 'N');
});
test('multiple failed deleted manuscripts remain independently selectable for export', async () => {
  const h = harness({ failStore: 'note-conflicts' });
  h.drafts.set('M', { id: 'M', title: 'M', body: 'second failed manuscript', revision: 1 });
  await h.ctx.performPermanentDeletionCleanup(['N', 'M'], {});
  assert.equal(h.ctx.failedDeletedDraftRecoveries.size, 2);
  h.ctx.currentId = 'other'; h.ctx.noteConflictResolutions = new Map(); h.ctx.noteConflictRenderSequence = 0;
  h.ctx.noteConflictUi = { render: model => h.renders.push(model) };
  h.ctx.ensureNoteConflictUi = () => h.ctx.noteConflictUi;
  h.ctx.getStoredNoteSnapshots = async () => new Map([['other', { id: 'other', body: 'unchanged' }]]);
  h.ctx.noteConflictStore = { ...store, readDrafts: async () => [] };
  const start = source.indexOf('async function renderNoteConflictUi');
  vm.runInContext(source.slice(start, source.indexOf('function refreshNoteConflictUi', start)), h.ctx);
  const choose = source.indexOf('async function chooseConflictDraft');
  vm.runInContext(source.slice(choose, source.indexOf('async function resumeConflictDraft', choose)), h.ctx);
  await h.ctx.renderNoteConflictUi();
  const drafts = h.renders.at(-1).drafts;
  assert.equal(drafts.length, 2);
  for (const draft of drafts) {
    await h.ctx.chooseConflictDraft(draft);
    assert.equal(h.renders.at(-1).state.preserved, false);
    assert.equal(h.renders.at(-1).state.recovery.draft.body, draft.body);
  }
});
test('persistent database read failures do not block choosing every failed manuscript', async () => {
  const h = harness({ openError: new Error('offline IDB') });
  h.drafts.set('M', { id: 'M', title: 'M', body: 'second exact failed text', revision: 1 });
  await h.ctx.performPermanentDeletionCleanup(['N', 'M'], {});
  h.ctx.noteConflictRenderSequence = 0;
  h.ctx.noteConflictUi = { render: model => h.renders.push(model) };
  h.ctx.ensureNoteConflictUi = () => h.ctx.noteConflictUi;
  const fail = async () => { throw Error('persistent read failure'); };
  h.ctx.getStoredNoteSnapshots = fail;
  h.ctx.noteConflictStore = { ...store, readDrafts: fail };
  const start = source.indexOf('async function renderNoteConflictUi');
  vm.runInContext(source.slice(start, source.indexOf('function refreshNoteConflictUi', start)), h.ctx);
  const choose = source.indexOf('async function chooseConflictDraft');
  vm.runInContext(source.slice(choose, source.indexOf('async function resumeConflictDraft', choose)), h.ctx);
  h.ctx.currentId = 'unrelated';
  h.ctx.editor.readOnly = true; h.ctx.titleInput.readOnly = true;
  for (const failDraftRead of [true, false]) {
    h.ctx.noteConflictStore.readDrafts = failDraftRead ? fail : async () => [];
    await h.ctx.renderNoteConflictUi();
    const drafts = h.renders.at(-1).drafts;
    assert.equal(h.ctx.editor.readOnly, false); assert.equal(h.ctx.titleInput.readOnly, false);
    assert.equal(drafts.length, 2);
    for (const draft of drafts) {
      await h.ctx.chooseConflictDraft(draft);
      assert.equal(h.renders.at(-1).state.preserved, false);
      assert.equal(h.renders.at(-1).state.recovery.draft.body, draft.body);
    }
  }
});
for (const fail of [false, true]) {
  test(`missing-note popout startup preserves mirror without resurrection (${fail ? 'quota' : 'durable'})`, async () => {
    const h = harness(fail ? { failStore: 'note-conflicts' } : {});
    Object.assign(h.ctx, { popoutMemoId: 'N', restoreGlobalFontSettings() {}, openDb: async () => h.db,
      getAllCollections: async () => [], getAllNotes: async () => [], getAllTagDefinitions: async () => [],
      ensureRegisteredTagsForNotes: async () => {}, initializeLocalFolderSaving: async () => {},
      editorCard: { hidden: true }, popoutUnavailable: { hidden: true },
      noteConflictRenderSequence: 0, noteConflictResolutions: new Map(), featurePalette: null,
      isMobileWritingMode: () => false, getStoredNoteSnapshots: async () => new Map(),
      DRAFT_MAX_AGE_MS: 100000, registerNoteSaveState() {},
      persistIncomingNote() { throw Error('must not recreate missing note'); } });
    h.ctx.noteConflictUi = { render: model => h.renders.push(model) };
    h.ctx.ensureNoteConflictUi = () => h.ctx.noteConflictUi;
    h.ctx.noteConflictStore = { ...store, readDrafts: async () => [...h.db.data.get('note-conflicts').values()].filter(row => row.kind === 'memo-conflict-draft') };
    let start = source.indexOf('async function renderNoteConflictUi');
    vm.runInContext(source.slice(start, source.indexOf('function refreshNoteConflictUi', start)), h.ctx);
    start = source.indexOf('async function restoreCurrentDraftMirror');
    vm.runInContext(source.slice(start, source.indexOf('// 削除したメモが次回起動時', start)), h.ctx);
    start = source.indexOf('async function initPopout()');
    vm.runInContext(source.slice(start, source.indexOf('// 今開いているメモ本体', start)), h.ctx);
    await h.ctx.initPopout();
    assert.equal(h.db.data.get('notes').size, 0);
    assert.equal(h.ctx.editorCard.hidden, false);
    assert.equal(h.ctx.editor.readOnly, true);
    assert.equal(h.renders.at(-1).state.recovery.draft.body, h.draft.body);
    assert.equal(h.renders.at(-1).state.preserved, !fail);
    assert.equal(h.renders.at(-1).missing, true);
  });
}
