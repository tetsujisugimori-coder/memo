"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { createNoteSaveFoundation, createSaveRequest, normalizeRevision } = require("./note-save-foundation.js");
const { applyLocalSaveSuccess, createLocalSaveState, transitionLocalSaveState } = require("./local-save-state.js");
const { serializeLocalNote } = require("./local-markdown.js");

const appSource = fs.readFileSync(require.resolve("./app.js"), "utf8");

function sourceBetween(start, end) {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return appSource.slice(startIndex, endIndex);
}

const openNoteSource = sourceBetween("function openNote(id)", "async function initPopout");
const saveCoreSource = sourceBetween("function currentNote()", "function handleNoteSaveStateChange");
const saveHandlersSource = sourceBetween("function handleNoteSaveStateChange", "function popoutUrlForMemo");
const scheduleSaveSource = sourceBetween("function scheduleSave(", "function captureUndoSnapshot");
const updateTagsSource = sourceBetween("async function updateCurrentNoteTags", "function setNoteTagStatus");
const localSaveMetadataSource = sourceBetween("function localSavePlanMatchesRevision", "async function performLocalWorkspaceSave");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createHarness({ writer, ensureTags = async () => {}, noteCount = 2 } = {}) {
  const timers = new Map();
  let timerSequence = 0;
  const initialNotes = Array.from({ length: noteCount }, (_, index) => {
    const id = index === 0 ? "A" : index === 1 ? "B" : `N${String(index + 1).padStart(3, "0")}`;
    return { id, title: id, body: `${id}0`, revision: 0, tags: [], collectionId: "old", updatedAt: 1 };
  });
  const context = vm.createContext({
    console: { error() {}, log() {} },
    createNoteSaveFoundation,
    createSaveRequest,
    normalizeNoteRevision: normalizeRevision,
    structuredClone,
    initialNotes,
    crypto: { randomUUID: () => `request-${Math.random()}` },
    writer: writer || (async () => {}),
    ensureTags,
    setTimeout(callback) {
      timerSequence += 1;
      timers.set(timerSequence, callback);
      return timerSequence;
    },
    clearTimeout(id) { timers.delete(id); }
  });

  vm.runInContext(`
    let notes = structuredClone(initialNotes);
    let currentId = "A";
    let saveTimer = null;
    let scheduledSaveNoteId = null;
    let isLocalMemoDirty = false;
    let localDirtyMemoId = null;
    let pendingMemoSync = null;
    let lastUndoSnapshotAt = 0;
    let layoutMode = "wide";
    let isPopoutWindow = false;
    let registeredTags = ["tag-a", "tag-b"];
    const noteLiveDrafts = new Map();
    const noteSaveBeforeLinkCounts = new Map();
    const titleInput = { value: "A" };
    const editor = { value: "A0", focus() {} };
    const noteTagInput = { value: "" };
    const tableAxisSelections = { clear() {} };
    let pendingTableAxisDeletion = null;
    let tagRenderIds = [];
    let renderAllCount = 0;
    let renderListCount = 0;
    let invalidateTermRelationIndexCount = 0;
    let saveStatuses = [];
    let lastDiscovery = "";
    const window = { MemoNexusCodexChat: null };
    const document = { title: "" };
    const noteSaveFoundation = createNoteSaveFoundation({
      writeSnapshot: writer,
      onStateChange: handleNoteSaveStateChange,
      onSaveSuccess: handleNoteSaveSuccess,
      onSaveError: handleNoteSaveError,
      logError() {}
    });
    const noop = () => {};
    const setRelatedDrawerOpen = noop;
    const syncLegacyDirtyStateOriginal = noop;
    const renderMemoSyncNotice = noop;
    const renderNoteFlagButton = noop;
    const renderNoteTags = (note) => { tagRenderIds.push(note?.id || null); };
    const setNoteTagStatus = noop;
    const hideNoteTagOptions = noop;
    const renderNoteMeta = noop;
    const renderTextStats = noop;
    const renderList = () => { renderListCount += 1; };
    const renderAll = () => { renderAllCount += 1; };
    const renderCollectionExplorer = noop;
    const renderTableBlockEditors = noop;
    const applyEffectiveFontSettings = noop;
    const renderPreview = noop;
    const renderAttachmentsForCurrentNote = noop;
    const renderRelated = noop;
    const renderDiscovery = noop;
    const updateUndoButton = noop;
    const renderAiUi = noop;
    const renderTagPanel = noop;
    const renderNoteTagOptions = noop;
    const saveCurrentDraftMirror = noop;
    const setSaveStatus = (status) => { saveStatuses.push(status); };
    const invalidateTermRelationIndex = () => { invalidateTermRelationIndexCount += 1; };
    const cloneNoteSnapshot = structuredClone;
    const activeNotes = () => notes.filter((note) => !note.deletedAt);
    const collectLinks = () => [];
    const buildDiscoveryMessage = () => "discovered";
    const normalizeTagIds = (tags) => Array.isArray(tags) ? [...tags] : [];
    const restrictTagIds = (tags) => normalizeTagIds(tags).filter((tag) => registeredTags.includes(tag));
    const titleFromBody = (body) => String(body).split(/\\r?\\n/).find(Boolean) || "";
    const updateNotesTransaction = async (items, options = {}) => writer(items, { batch: true, ...options });
    const ensureRegisteredTagsForNotes = () => ensureTags();

    ${openNoteSource}
    ${saveCoreSource}
    ${saveHandlersSource}
    ${scheduleSaveSource}
    ${updateTagsSource}
    ${localSaveMetadataSource}

    notes.forEach((note) => noteSaveFoundation.registerNote(note.id, note.revision));
    globalThis.harness = {
      foundation: noteSaveFoundation,
      openNote,
      scheduleSave,
      updateCurrentNoteTags,
      mutateNotesAtomically,
      applyLocalSaveMetadata,
      localSaveBoundaryChanged,
      enqueueNoteSave,
      runNextTimer() {
        const entry = timersForHarness().entries().next().value;
        if (!entry) return false;
        const [id, callback] = entry;
        clearTimeout(id);
        callback();
        return true;
      },
      state() {
        return {
          currentId,
          title: titleInput.value,
          body: editor.value,
          notes: structuredClone(notes),
          timers: timersForHarness().size,
          tagRenderIds: [...tagRenderIds]
          ,renderAllCount
          ,renderListCount
          ,invalidateTermRelationIndexCount
          ,saveStatuses: [...saveStatuses]
          ,documentTitle: document.title
        };
      },
      edit(title, body) { titleInput.value = title; editor.value = body; },
      setCurrentId(id) { currentId = id; },
      noteIds() { return notes.map((note) => note.id); },
      liveNote(id) { return noteForSave(id); }
    };
    function timersForHarness() { return globalThis.__timers; }
  `, context);
  context.__timers = timers;
  return context.harness;
}

async function executeMockLocalSave(harness, { savedAt, onFileWrite = async () => {} }) {
  const plans = harness.state().notes.map((note) => {
    const fixedSnapshot = structuredClone(note);
    const savedNote = applyLocalSaveSuccess(fixedSnapshot, savedAt);
    return {
      note: savedNote,
      startRevision: normalizeRevision(fixedSnapshot.revision),
      markdown: serializeLocalNote(savedNote, savedNote.body)
    };
  });
  for (const plan of plans) await onFileWrite(plan);
  const metadataResult = await harness.applyLocalSaveMetadata(plans);
  return {
    changedDuringSave: harness.localSaveBoundaryChanged(plans, metadataResult.expectedRevisionsAfterMetadata),
    metadataResult,
    plans
  };
}

test("実アプリ経路A: debounce中の切替はAだけを保存しBのDOMを維持する", async () => {
  const writes = [];
  const harness = createHarness({ writer: async (snapshot) => writes.push(structuredClone(snapshot)) });
  harness.edit("A edited", "Aの入力本文");
  harness.scheduleSave();
  assert.equal(harness.state().timers, 1);

  harness.openNote("B");
  await harness.foundation.whenIdle("A");
  assert.equal(harness.state().currentId, "B");
  assert.equal(harness.state().body, "B0");
  assert.deepEqual(writes.map(({ id, body }) => ({ id, body })), [{ id: "A", body: "Aの入力本文" }]);
});

test("実アプリ経路B/C: 保存中再編集と切替先編集を混在させない", async () => {
  const gate = deferred();
  const writes = [];
  let attempt = 0;
  const harness = createHarness({
    writer: async (snapshot) => {
      attempt += 1;
      writes.push(structuredClone(snapshot));
      if (attempt === 1) await gate.promise;
    }
  });
  harness.edit("A rev10", "A rev10");
  harness.scheduleSave();
  harness.runNextTimer();
  await Promise.resolve();

  harness.edit("A rev11", "A rev11");
  harness.scheduleSave();
  harness.openNote("B");
  harness.edit("B edited", "B edited");
  harness.scheduleSave();
  gate.resolve();
  harness.runNextTimer();
  await Promise.all([harness.foundation.whenIdle("A"), harness.foundation.whenIdle("B")]);

  const state = harness.state();
  assert.equal(state.currentId, "B");
  assert.equal(state.body, "B edited");
  assert.equal(harness.foundation.getState("A").dirty, false);
  assert.equal(harness.foundation.getState("B").dirty, false);
  assert.equal(writes.find((item) => item.id === "B" && item.body === "B edited")?.body, "B edited");
  assert.equal(writes.find((item) => item.id === "A" && item.body === "A rev11")?.body, "A rev11");
});

test("実アプリ経路D: タグ登録待機中に切り替えてもAをdirtyのままAとして保存する", async () => {
  const tagGate = deferred();
  const writerError = new Error("tag save failed");
  const writes = [];
  const harness = createHarness({
    ensureTags: () => tagGate.promise,
    writer: async (snapshot) => {
      writes.push(structuredClone(snapshot));
      if (snapshot.id === "A") throw writerError;
    }
  });
  const updating = harness.updateCurrentNoteTags(["tag-a"]);
  harness.openNote("B");
  tagGate.resolve();
  await assert.rejects(updating, (error) => error === writerError);

  assert.equal(writes[0].id, "A");
  assert.deepEqual(Array.from(harness.liveNote("A").tags), ["tag-a"]);
  assert.deepEqual(Array.from(harness.liveNote("B").tags), []);
  assert.equal(harness.foundation.getState("A").dirty, true);
  assert.equal(harness.state().tagRenderIds.at(-1), "B");
  harness.openNote("A");
  assert.deepEqual(Array.from(harness.liveNote("A").tags), ["tag-a"]);
});

test("通常note更新経路は共通mutationまたは排他入口へ接続されている", () => {
  const paths = [
    ["async function resetFontSettings", "async function renderStorageStatus", "mutateNotesAtomically"],
    ["async function moveMemosToCollection", "async function moveMemosToTrash", "mutateNotesAtomically"],
    ["async function moveMemosToTrash", "async function restoreMemos", "mutateNotesAtomically"],
    ["async function restoreMemos", "async function permanentlyDeleteMemos", "mutateNotesAtomically"],
    ["async function permanentlyDeleteMemos", "async function deleteCollectionSafely", "runTerminalDelete"],
    ["async function deleteCollectionSafely", "function openMemoMoveDialog", "mutateNotesAtomically"],
    ["async function deleteCurrentNote", "function showDeleteUndoMessage", "mutateNotesAtomically"],
    ["async function restoreDeletedNote", "function clearDeleteUndoMessage", "mutateNotesAtomically"]
  ];
  paths.forEach(([start, end, expected]) => assert.match(sourceBetween(start, end), new RegExp(expected)));
  assert.match(sourceBetween("async function saveFontSettings", "async function resetFontSettings"), /enqueueNoteSave\(note\.id\)/);
  assert.match(sourceBetween("const saveExplanationCollapsedState", "function hydrateExplanationCards"), /enqueueNoteSave\(note\.id\)/);
});

test("ローカル保存メタデータ200件のbatchは一覧を1回だけ更新し語句索引を無効化しない", async () => {
  const batchOptions = [];
  const harness = createHarness({
    noteCount: 200,
    writer: async (_value, options) => { if (options?.batch) batchOptions.push(options); }
  });

  const localSave = await executeMockLocalSave(harness, { savedAt: "2026-08-24T00:01:00.000Z" });

  const state = harness.state();
  assert.equal(localSave.changedDuringSave, false);
  assert.equal(localSave.metadataResult.results.length, 200);
  assert.deepEqual(batchOptions.map(({ markLocalPending }) => markLocalPending), [false]);
  assert.equal(state.renderListCount, 1);
  assert.equal(state.renderAllCount, 0);
  assert.equal(state.invalidateTermRelationIndexCount, 0);
  assert.equal(state.notes.length, 200);
  state.notes.forEach((note) => {
    assert.equal(note.localSavedAt, "2026-08-24T00:01:00.000Z");
    assert.equal(note.revision, 1);
    assert.equal(harness.foundation.getState(note.id).lastSavedRevision, 1);
    assert.equal(harness.foundation.getState(note.id).dirty, false);
  });
});

test("ローカル書込み待ち中のA→B編集をmetadataへ混ぜず、予約保存とpending状態を維持する", async () => {
  const fileWriteStarted = deferred();
  const releaseFileWrite = deferred();
  const markdownFiles = new Map();
  const browserWrites = [];
  const harness = createHarness({
    noteCount: 1,
    writer: async (value, options) => {
      if (!options?.batch) browserWrites.push(structuredClone(value));
    }
  });
  let firstFile = true;
  let localState = transitionLocalSaveState(createLocalSaveState({ status: "pending", pendingChanges: true }), "saving");
  const firstSave = executeMockLocalSave(harness, {
    savedAt: "2026-08-24T00:01:00.000Z",
    onFileWrite: async (plan) => {
      markdownFiles.set(plan.note.id, plan.markdown);
      if (!firstFile) return;
      firstFile = false;
      fileWriteStarted.resolve();
      await releaseFileWrite.promise;
    }
  });
  await fileWriteStarted.promise;

  harness.edit("A edited", "B [[late-term]]");
  harness.scheduleSave();
  assert.equal(harness.state().timers, 1);
  releaseFileWrite.resolve();
  const firstResult = await firstSave;
  localState = transitionLocalSaveState(localState, firstResult.changedDuringSave ? "pending" : "saved", {
    lastSuccessAt: "2026-08-24T00:01:00.000Z",
    pendingChanges: firstResult.changedDuringSave
  });

  assert.match(markdownFiles.get("A"), /A0/);
  assert.doesNotMatch(markdownFiles.get("A"), /late-term/);
  assert.equal(firstResult.metadataResult.results.some(({ request }) => request.noteId === "A"), false);
  assert.equal(harness.liveNote("A").body, "B [[late-term]]");
  assert.equal(harness.liveNote("A").localSavedAt, undefined);
  assert.equal(harness.foundation.getState("A").dirty, true);
  assert.equal(harness.state().timers, 1);
  assert.equal(harness.state().renderListCount, 1);
  assert.equal(harness.state().invalidateTermRelationIndexCount, 0);
  assert.equal(localState.status, "pending");
  assert.equal(localState.pendingChanges, true);

  harness.runNextTimer();
  await harness.foundation.whenIdle("A");
  assert.equal(browserWrites.at(-1).body, "B [[late-term]]");
  assert.equal(harness.foundation.getState("A").dirty, false);
  assert.equal(harness.state().invalidateTermRelationIndexCount, 1);

  const secondFiles = new Map();
  localState = transitionLocalSaveState(localState, "saving");
  const secondResult = await executeMockLocalSave(harness, {
    savedAt: "2026-08-24T00:02:00.000Z",
    onFileWrite: async (plan) => secondFiles.set(plan.note.id, plan.markdown)
  });
  localState = transitionLocalSaveState(localState, secondResult.changedDuringSave ? "pending" : "saved", {
    lastSuccessAt: "2026-08-24T00:02:00.000Z",
    pendingChanges: secondResult.changedDuringSave
  });
  assert.match(secondFiles.get("A"), /B \[\[late-term\]\]/);
  assert.equal(secondResult.changedDuringSave, false);
  assert.equal(localState.status, "saved");
});

test("metadata transaction待ち中の再編集もローカル日時へ合流させずpendingに戻す", async () => {
  const metadataWriteStarted = deferred();
  const releaseMetadataWrite = deferred();
  const harness = createHarness({
    writer: async (_value, options) => {
      if (!options?.batch) return;
      metadataWriteStarted.resolve();
      await releaseMetadataWrite.promise;
    }
  });
  const saving = executeMockLocalSave(harness, { savedAt: "2026-08-24T00:03:00.000Z" });
  await metadataWriteStarted.promise;
  harness.edit("A during metadata", "B during metadata");
  harness.scheduleSave();
  releaseMetadataWrite.resolve();
  const result = await saving;

  assert.equal(result.changedDuringSave, true);
  assert.equal(harness.liveNote("A").body, "B during metadata");
  assert.equal(harness.liveNote("A").localSavedAt, undefined);
  assert.equal(harness.foundation.getState("A").dirty, true);
  assert.equal(harness.state().timers, 1);
  assert.equal(harness.state().renderListCount, 1);
  assert.equal(harness.state().invalidateTermRelationIndexCount, 0);
});

test("200件中1件をローカル書込み中に編集するとmetadataは199件だけを線形更新する", async () => {
  const fileWriteStarted = deferred();
  const releaseFileWrite = deferred();
  const metadataBatchSizes = [];
  const harness = createHarness({
    noteCount: 200,
    writer: async (value, options) => {
      if (options?.batch) metadataBatchSizes.push(value.length);
    }
  });
  let firstFile = true;
  const saving = executeMockLocalSave(harness, {
    savedAt: "2026-08-24T01:00:00.000Z",
    onFileWrite: async () => {
      if (!firstFile) return;
      firstFile = false;
      fileWriteStarted.resolve();
      await releaseFileWrite.promise;
    }
  });
  await fileWriteStarted.promise;
  harness.edit("A late", "A late body");
  harness.scheduleSave();
  releaseFileWrite.resolve();
  const result = await saving;

  const state = harness.state();
  assert.equal(result.changedDuringSave, true);
  assert.equal(result.metadataResult.results.length, 199);
  assert.deepEqual(metadataBatchSizes, [199]);
  assert.equal(state.notes.filter((note) => note.localSavedAt === "2026-08-24T01:00:00.000Z").length, 199);
  assert.equal(harness.liveNote("A").body, "A late body");
  assert.equal(harness.liveNote("A").localSavedAt, undefined);
  assert.equal(harness.foundation.getState("A").dirty, true);
  assert.equal(state.timers, 1);
  assert.equal(state.renderListCount, 1);
  assert.equal(state.renderAllCount, 0);
  assert.equal(state.invalidateTermRelationIndexCount, 0);
});

test("ローカルmetadata transaction失敗と後続通常保存失敗でもdraft・予約・dirtyを保持する", async () => {
  const metadataError = new Error("local metadata transaction aborted");
  const normalError = new Error("late normal save failed");
  let failNormalOnce = true;
  const harness = createHarness({
    writer: async (_value, options) => {
      if (options?.batch) throw metadataError;
      if (failNormalOnce) {
        failNormalOnce = false;
        throw normalError;
      }
    }
  });
  const fileWriteStarted = deferred();
  const releaseFileWrite = deferred();
  let firstFile = true;
  const saving = executeMockLocalSave(harness, {
    savedAt: "2026-08-24T02:00:00.000Z",
    onFileWrite: async () => {
      if (!firstFile) return;
      firstFile = false;
      fileWriteStarted.resolve();
      await releaseFileWrite.promise;
    }
  });
  await fileWriteStarted.promise;
  harness.edit("A late", "A late survives");
  harness.scheduleSave();
  releaseFileWrite.resolve();
  await assert.rejects(saving, (error) => error === metadataError);

  assert.equal(harness.liveNote("A").body, "A late survives");
  assert.equal(harness.foundation.getState("A").dirty, true);
  assert.equal(harness.state().timers, 1);
  assert.equal(harness.state().renderListCount, 0);
  assert.equal(harness.state().invalidateTermRelationIndexCount, 0);

  harness.runNextTimer();
  const failedState = await harness.foundation.whenIdle("A");
  assert.equal(failedState.status, "error");
  assert.equal(failedState.dirty, true);
  assert.equal(harness.liveNote("A").body, "A late survives");
  await harness.enqueueNoteSave("A");
  assert.equal(harness.foundation.getState("A").dirty, false);
});

test("索引無効化を省略するbatchはlocal日時以外の変更をtransaction前に拒否する", async () => {
  let writeCount = 0;
  const harness = createHarness({ writer: async () => { writeCount += 1; } });
  await assert.rejects(harness.mutateNotesAtomically(["A"], (note) => {
    note.body = "unexpected [[term]]";
  }, undefined, {
    allowedChangedFields: ["localCreatedAt", "localSavedAt"],
    invalidateTermRelations: false,
    render: "list"
  }), /disallowed field: body/);
  assert.equal(writeCount, 0);
  assert.equal(harness.liveNote("A").body, "A0");
  assert.equal(harness.liveNote("A").revision, 0);
  assert.equal(harness.state().invalidateTermRelationIndexCount, 0);
});

test("本文を含む200件batchは現在メモと背景メモを反映し索引・全体描画を各1回に集約する", async () => {
  const harness = createHarness({ noteCount: 200 });
  const noteIds = harness.noteIds();

  await harness.mutateNotesAtomically(noteIds, (note) => {
    note.body = `${note.id} updated [[term]]`;
  });

  const state = harness.state();
  assert.equal(state.renderAllCount, 1);
  assert.equal(state.renderListCount, 0);
  assert.equal(state.invalidateTermRelationIndexCount, 1);
  assert.equal(state.notes.every((note) => note.body === `${note.id} updated [[term]]`), true);
  assert.equal(harness.liveNote("A").body, "A updated [[term]]");
  assert.equal(harness.liveNote("N200").body, "N200 updated [[term]]");
});

test("通常の1件保存は従来どおり索引と現在メモ画面を更新する", async () => {
  const harness = createHarness();
  harness.edit("A saved", "通常保存本文");
  harness.scheduleSave();
  harness.runNextTimer();
  await harness.foundation.whenIdle("A");

  const state = harness.state();
  assert.equal(state.renderAllCount, 1);
  assert.equal(state.renderListCount, 0);
  assert.equal(state.invalidateTermRelationIndexCount, 1);
  assert.equal(state.saveStatuses.includes("saving"), true);
  assert.equal(state.saveStatuses.at(-1), "saved");
  assert.equal(harness.liveNote("A").body, "通常保存本文");
  assert.equal(harness.foundation.getState("A").dirty, false);
});

test("実アプリ経路G: 本文保存とフォント・全初期化・複数コレクション移動を直列かつ原子的に保存する", async () => {
  const firstWrite = deferred();
  const writes = [];
  let singleWrites = 0;
  const harness = createHarness({
    writer: async (value, options) => {
      writes.push(structuredClone(value));
      if (!options?.batch && singleWrites++ === 0) await firstWrite.promise;
    }
  });
  harness.edit("A body", "本文保存中");
  harness.scheduleSave();
  harness.runNextTimer();
  await Promise.resolve();

  const fontSave = harness.mutateNotesAtomically(["A"], (note) => {
    note.fontSettings = { enabled: true, bodyFontId: "serif" };
  });
  firstWrite.resolve();
  await fontSave;
  assert.equal(harness.liveNote("A").body, "本文保存中");
  assert.equal(harness.liveNote("A").fontSettings.bodyFontId, "serif");

  harness.liveNote("B").fontSettings = { enabled: true, bodyFontId: "sans" };
  await harness.mutateNotesAtomically(["A", "B"], (note) => { delete note.fontSettings; });
  await harness.mutateNotesAtomically(["B", "A"], (note) => { note.collectionId = "moved"; });
  const batchWrites = writes.filter(Array.isArray);
  assert.equal(batchWrites.length, 3);
  assert.equal(batchWrites.every((batch) => batch.every((note) => note.body === (note.id === "A" ? "本文保存中" : "B0"))), true);
  assert.equal(batchWrites.at(-1).every((note) => note.collectionId === "moved"), true);
  assert.equal(harness.foundation.getState("A").dirty, false);
  assert.equal(harness.foundation.getState("B").dirty, false);
});

test("実アプリ経路G: ゴミ箱batch失敗後はbatch変更を破棄し通常編集だけを後続保存する", async () => {
  const transactionError = new Error("trash transaction aborted");
  const singleWrites = [];
  const harness = createHarness({
    writer: async (value, options) => {
      if (options?.batch) throw transactionError;
      singleWrites.push(structuredClone(value));
    }
  });
  harness.edit("A edited", "失われない本文");
  const beforeRevision = harness.liveNote("A").revision;
  await assert.rejects(harness.mutateNotesAtomically(["A", "B"], (note) => {
    note.deletedAt = "2026-08-23T00:00:00.000Z";
  }), (error) => error === transactionError);

  assert.equal(harness.liveNote("A").body, "失われない本文");
  assert.equal(harness.liveNote("A").deletedAt, undefined);
  assert.equal(harness.liveNote("B").deletedAt, undefined);
  assert.equal(harness.liveNote("A").revision > beforeRevision, true);
  assert.equal(harness.foundation.getState("A").dirty, true);
  assert.equal(harness.foundation.getState("B").dirty, false);
  assert.equal(harness.state().saveStatuses.at(-1), "error");
  assert.equal(harness.state().renderAllCount, 0);
  assert.equal(harness.state().renderListCount, 0);
  assert.equal(harness.state().invalidateTermRelationIndexCount, 0);

  await harness.enqueueNoteSave("A");
  harness.openNote("B");
  harness.edit("B edited", "Bの通常編集");
  harness.scheduleSave();
  harness.runNextTimer();
  await harness.foundation.whenIdle("B");
  assert.equal(singleWrites.find((note) => note.id === "A").body, "失われない本文");
  assert.equal(singleWrites.find((note) => note.id === "A").deletedAt, undefined);
  assert.equal(singleWrites.find((note) => note.id === "B").deletedAt, undefined);
});

test("実アプリ経路G: batch待機中の本文編集は失敗後もdirtyで残り通常保存できる", async () => {
  const gate = deferred();
  const transactionError = new Error("custom writer aborted");
  const singleWrites = [];
  const harness = createHarness({
    writer: async (value, options) => {
      if (options?.batch) {
        await gate.promise;
        throw transactionError;
      }
      singleWrites.push(structuredClone(value));
    }
  });

  const batchSave = harness.mutateNotesAtomically(["A", "B"], (note) => {
    note.collectionId = "batch-only";
  });
  await Promise.resolve();
  harness.edit("A concurrent", "batch中の追加入力");
  harness.scheduleSave();
  harness.runNextTimer();
  gate.resolve();
  await assert.rejects(batchSave, (error) => error === transactionError);

  assert.equal(harness.liveNote("A").body, "batch中の追加入力");
  assert.equal(harness.liveNote("A").collectionId, "old");
  assert.equal(harness.foundation.getState("A").dirty, true);
  await Promise.resolve();
  await harness.foundation.whenIdle("A");
  assert.equal(singleWrites.at(-1).body, "batch中の追加入力");
  assert.equal(singleWrites.at(-1).collectionId, "old");
});

test("実アプリ経路G: batch成功待機中の本文編集を消さず、batch変更とともに後続保存する", async () => {
  const gate = deferred();
  const writes = [];
  const harness = createHarness({
    writer: async (value, options) => {
      writes.push(structuredClone(value));
      if (options?.batch) await gate.promise;
    }
  });

  const batchSave = harness.mutateNotesAtomically(["A", "B"], (note) => {
    note.collectionId = "committed-batch";
  });
  await Promise.resolve();
  harness.edit("A concurrent", "成功待機中の追加入力");
  harness.scheduleSave();
  harness.runNextTimer();
  gate.resolve();
  await batchSave;

  assert.equal(harness.liveNote("A").body, "成功待機中の追加入力");
  assert.equal(harness.liveNote("A").collectionId, "committed-batch");
  assert.equal(harness.foundation.getState("A").dirty, true);
  await Promise.resolve();
  await harness.foundation.whenIdle("A");
  const lastSingleA = writes.filter((value) => !Array.isArray(value) && value.id === "A").at(-1);
  assert.equal(lastSingleA.body, "成功待機中の追加入力");
  assert.equal(lastSingleA.collectionId, "committed-batch");
});

test("本番handleNoteSaveSuccessは背景Aのstale完了で表示中BとAのlive draftを変更しない", async () => {
  const gate = deferred();
  const harness = createHarness({ writer: async () => gate.promise });
  harness.edit("A first", "A stale");
  harness.scheduleSave();
  harness.runNextTimer();
  await Promise.resolve();
  harness.edit("A latest", "A live draft");
  harness.scheduleSave();
  harness.openNote("B");
  harness.edit("B live", "Bの表示中draft");
  harness.scheduleSave();
  gate.resolve();
  await harness.foundation.whenIdle("A");

  assert.equal(harness.state().currentId, "B");
  assert.equal(harness.state().title, "B live");
  assert.equal(harness.state().body, "Bの表示中draft");
  assert.equal(harness.liveNote("A").body, "A live draft");
  assert.equal(harness.foundation.getState("A").dirty, false);
  assert.equal(harness.foundation.getState("B").dirty, true);
  assert.deepEqual(Array.from(harness.liveNote("B").tags), []);
  assert.equal(harness.state().renderAllCount, 0);
  assert.equal(harness.state().renderListCount > 0, true);
});
