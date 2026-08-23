"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { createNoteSaveFoundation, createSaveRequest, normalizeRevision } = require("./note-save-foundation.js");

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createHarness({ writer, ensureTags = async () => {} } = {}) {
  const timers = new Map();
  let timerSequence = 0;
  const context = vm.createContext({
    console: { error() {}, log() {} },
    createNoteSaveFoundation,
    createSaveRequest,
    normalizeNoteRevision: normalizeRevision,
    structuredClone,
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
    let notes = [
      { id: "A", title: "A", body: "A0", revision: 0, tags: [], collectionId: "old", updatedAt: 1 },
      { id: "B", title: "B", body: "B0", revision: 0, tags: [], collectionId: "old", updatedAt: 1 }
    ];
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
    const setSaveStatus = noop;
    const invalidateTermRelationIndex = noop;
    const cloneNoteSnapshot = structuredClone;
    const activeNotes = () => notes.filter((note) => !note.deletedAt);
    const collectLinks = () => [];
    const buildDiscoveryMessage = () => "discovered";
    const normalizeTagIds = (tags) => Array.isArray(tags) ? [...tags] : [];
    const restrictTagIds = (tags) => normalizeTagIds(tags).filter((tag) => registeredTags.includes(tag));
    const titleFromBody = (body) => String(body).split(/\\r?\\n/).find(Boolean) || "";
    const updateNotesTransaction = async (items) => writer(items, { batch: true });
    const ensureRegisteredTagsForNotes = () => ensureTags();

    ${openNoteSource}
    ${saveCoreSource}
    ${saveHandlersSource}
    ${scheduleSaveSource}
    ${updateTagsSource}

    noteSaveFoundation.registerNote("A", 0);
    noteSaveFoundation.registerNote("B", 0);
    globalThis.harness = {
      foundation: noteSaveFoundation,
      openNote,
      scheduleSave,
      updateCurrentNoteTags,
      mutateNotesAtomically,
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
          ,documentTitle: document.title
        };
      },
      edit(title, body) { titleInput.value = title; editor.value = body; },
      setCurrentId(id) { currentId = id; },
      liveNote(id) { return noteForSave(id); }
    };
    function timersForHarness() { return globalThis.__timers; }
  `, context);
  context.__timers = timers;
  return context.harness;
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
