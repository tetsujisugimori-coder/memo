"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { createNoteSaveFoundation, createSaveRequest, normalizeRevision } = require("./note-save-foundation.js");
const { createCodexThreadSaveCoordinator, isCodexThreadSaveRequest, mergeStoredCodexThread } = require("./codex-chat-utils.js");
const { buildPortableBackupFiles } = require("./backup-bundle-utils.js");
const { applyLocalSaveSuccess, classifyLocalSaveFailure, createLocalSaveState, transitionLocalSaveState } = require("./local-save-state.js");
const { serializeLocalNote } = require("./local-markdown.js");
const {
  attachmentExtension,
  buildManifest,
  contentHash,
  deleteLocalConflictResolution,
  hasExternalModification,
  localConflictResolutionFileName,
  localConflictResolutionMatches,
  managedMarkdownComparableHash,
  normalizeSyncState,
  safeStableNoteFileName,
  serializeCollections
} = require("./local-sync-utils.js");

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
const localSaveTargetSource = sourceBetween("async function localSaveTargetsMatch", "async function persistLocalSaveSettings");
const localSaveMetadataSource = sourceBetween("function buildLocalSaveLiveNoteIndex", "async function performLocalWorkspaceSave");
const performLocalWorkspaceSaveSource = sourceBetween("async function performLocalWorkspaceSave", "async function selectLocalSaveFolder");
const updateNotesTransactionSource = sourceBetween("function prepareNoteSnapshotsInTransaction", "function collectionExists");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createProductionBatchWriterHarness(initialNotes) {
  const stored = new Map(initialNotes.map((note) => [note.id, structuredClone(note)]));
  const notifications = [];
  let transactionCount = 0;
  const db = {
    transaction() {
      transactionCount += 1;
      let pendingReads = 0;
      let completionQueued = false;
      const transaction = {
        error: null,
        objectStore() { return store; },
        oncomplete: null,
        onerror: null,
        onabort: null
      };
      const finishIfReady = () => {
        if (pendingReads || completionQueued) return;
        completionQueued = true;
        queueMicrotask(() => transaction.oncomplete?.());
      };
      const store = {
        get(id) {
          pendingReads += 1;
          const request = { result: undefined, onsuccess: null };
          queueMicrotask(() => {
            request.result = stored.has(id) ? structuredClone(stored.get(id)) : undefined;
            request.onsuccess?.();
            pendingReads -= 1;
            finishIfReady();
          });
          return request;
        },
        put(note) { stored.set(note.id, structuredClone(note)); }
      };
      queueMicrotask(finishIfReady);
      return transaction;
    }
  };
  const context = vm.createContext({
    db,
    mergeStoredCodexThread,
    notifyMemoChanged: (note) => notifications.push(structuredClone(note)),
    markLocalWorkspacePending() {},
    guardNoteWrites: (_transaction, _noteIds, write) => write(),
    noteTransactionError: (transaction) => transaction.error || new Error("transaction failed"),
    STORE_NAME: "notes",
    TOMBSTONE_STORE_NAME: "tombstones"
  });
  vm.runInContext(`${updateNotesTransactionSource}\nglobalThis.updateNotesTransactionForHarness = updateNotesTransaction;`, context);
  return {
    notifications,
    stored,
    transactionCount: () => transactionCount,
    updateNotesTransaction: context.updateNotesTransactionForHarness
  };
}

function createHarness({
  writer,
  ensureTags = async () => {},
  initialNotes: providedNotes = null,
  localFsDriver = null,
  noteCount = 2,
  typingDerivedUiScheduler = null
} = {}) {
  const timers = new Map();
  const consoleLogs = [];
  let timerSequence = 0;
  const initialNotes = providedNotes || Array.from({ length: noteCount }, (_, index) => {
    const id = index === 0 ? "A" : index === 1 ? "B" : `N${String(index + 1).padStart(3, "0")}`;
    return { id, title: id, body: `${id}0`, revision: 0, tags: [], collectionId: "old", updatedAt: 1 };
  });
  const storedNotesById = new Map(initialNotes.map((note) => [note.id, structuredClone(note)]));
  const externalWriter = writer || (async () => {});
  const persistingWriter = async (value, options = {}) => {
    const items = Array.isArray(value) ? value : [value];
    const savedItems = items.map((note) => options.preserveStoredCodexThread
      ? mergeStoredCodexThread(note, storedNotesById.get(note.id))
      : note);
    const savedValue = Array.isArray(value) ? savedItems : savedItems[0];
    await externalWriter(savedValue, options);
    savedItems.forEach((note) => storedNotesById.set(note.id, structuredClone(note)));
    return Array.isArray(value) ? savedItems.map((note) => structuredClone(note)) : structuredClone(savedItems[0]);
  };
  const persistCodexThread = async (snapshot, beforeWrite) => {
    if (beforeWrite) await beforeWrite();
    const stored = storedNotesById.get(snapshot.noteId);
    if (!stored || stored.deletedAt) throw new Error("Codex thread note unavailable");
    const saved = structuredClone(stored);
    if (snapshot.codexChat) saved.codexChat = structuredClone(snapshot.codexChat);
    else delete saved.codexChat;
    storedNotesById.set(saved.id, saved);
    return structuredClone(saved);
  };
  const defaultLocalFsDriver = {
    name: "mock-local-folder",
    async queryPermission() { return "granted"; },
    async ensureWorkspaceLayout(root) { return { root }; },
    async readJson(_root, _path, fallback) { return structuredClone(fallback); },
    async readText() { throw Object.assign(new Error("not found"), { name: "NotFoundError" }); },
    async writeFile() {},
    async writeJson() {},
    async deleteConfig() {}
  };
  const context = vm.createContext({
    console: { error() {}, log(...args) { consoleLogs.push(args); } },
    consoleLogs,
    createNoteSaveFoundation,
    createSaveRequest,
    createCodexThreadSaveCoordinator,
    isCodexThreadSaveRequest,
    normalizeNoteRevision: normalizeRevision,
    mergeStoredCodexThread,
    applyLocalSaveSuccess,
    attachmentExtension,
    buildManifest,
    buildPortableBackupFiles,
    classifyLocalSaveFailure,
    contentHash,
    createLocalSaveState,
    deleteLocalConflictResolution,
    hasExternalModification,
    localConflictResolutionFileName,
    localConflictResolutionMatches,
    managedMarkdownComparableHash,
    normalizeSyncState,
    safeStableNoteFileName,
    serializeCollections,
    serializeLocalNote,
    transitionLocalSaveState,
    structuredClone,
    initialNotes,
    crypto: { randomUUID: () => `request-${Math.random()}` },
    writer: persistingWriter,
    persistCodexThread,
    storedNotesForHarness: async () => [...storedNotesById.values()].map((note) => structuredClone(note)),
    localFs: localFsDriver || defaultLocalFsDriver,
    MemoNexusTypingDerivedUiScheduler: typingDerivedUiScheduler,
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
    const noteSaveUiChanges = new Map();
    const titleInput = { value: initialNotes[0]?.title || "A" };
    const editor = { value: initialNotes[0]?.body || "A0", focus() {} };
    const noteTagInput = { value: "" };
    const tableAxisSelections = { clear() {} };
    let pendingTableAxisDeletion = null;
    let tagRenderIds = [];
    let renderAllCount = 0;
    let renderListCount = 0;
    let invalidateTermRelationIndexCount = 0;
    let typingDerivedRenderCount = 0;
    let saveMetaRenderCount = 0;
    let saveDiscoveryRenderCount = 0;
    let saveLinkStatsRenderCount = 0;
    let saveCodexNotificationCount = 0;
    let collectionExplorerRenderCount = 0;
    let collectionTitleUpdateCount = 0;
    let tagPanelRenderCount = 0;
    let memoListRenderCount = 0;
    let previewRenderCount = 0;
    let relatedRenderCount = 0;
    let textStatsRenderCount = 0;
    let tableEditorsRenderCount = 0;
    let aiTargetRenderCount = 0;
    let renderAllOptions = [];
    let saveStatuses = [];
    let lastDiscovery = "";
    let localSaveSettings = { enabled: true };
    let localDirectoryHandle = localFs;
    let localSaveTargetGeneration = 0;
    let localSaveState = createLocalSaveState({ status: "pending", pendingChanges: true });
    let localSyncState = normalizeSyncState();
    let localWorkspaceChangeVersion = 0;
    const localConflictResolutions = new Map();
    const localPendingExclusions = new Set();
    const localSaveStatusHistory = [];
    const db = {};
    const LOCAL_CONFIG_STORE_NAME = "localConfig";
    const APP_VERSION = "0.5.0";
    const window = { MemoNexusCodexChat: { onMemoChanged() { saveCodexNotificationCount += 1; } } };
    const document = { title: "" };
    let codexThreadSaveCoordinator;
    let codexBeforeWrite = null;
    const noteSaveFoundation = createNoteSaveFoundation({
      writeSnapshot: (snapshot, request) => isCodexThreadSaveRequest(request)
        ? noteSaveFoundation.runExclusive([snapshot.noteId], () => codexThreadSaveCoordinator.isCurrentRequest(request)
          ? persistCodexThread(snapshot, codexBeforeWrite).then((saved) => {
            codexThreadSaveCoordinator.markPersisted(request);
            return saved;
          })
          : Promise.resolve(snapshot))
        : writer(snapshot, { preserveStoredCodexThread: true }),
      onStateChange: handleNoteSaveStateChange,
      onSaveSuccess: (request, state, notificationContext) => {
        if (!isCodexThreadSaveRequest(request)) handleNoteSaveSuccess(request, state, notificationContext);
      },
      onSaveError: (request, error, state, notificationContext) => {
        if (!isCodexThreadSaveRequest(request)) handleNoteSaveError(request, error, state, notificationContext);
      },
      logError() {}
    });
    codexThreadSaveCoordinator = createCodexThreadSaveCoordinator({ foundation: noteSaveFoundation, createSaveRequest });
    const noop = () => {};
    const setRelatedDrawerOpen = noop;
    const syncLegacyDirtyStateOriginal = noop;
    const renderMemoSyncNotice = noop;
    const renderNoteFlagButton = noop;
    const renderNoteTags = (note) => { tagRenderIds.push(note?.id || null); };
    const setNoteTagStatus = noop;
    const hideNoteTagOptions = noop;
    const renderNoteMeta = noop;
    const renderTextStats = () => { textStatsRenderCount += 1; };
    const renderList = () => { renderListCount += 1; };
    const renderAll = () => {
      renderAllCount += 1;
      renderAllOptions.push({ full: true });
      collectionExplorerRenderCount += 1;
      tagPanelRenderCount += 1;
      typingDerivedRenderCount += 1;
    };
    const renderCurrentNoteSaveSuccessUi = ({ titleChanged = false } = {}) => {
      saveMetaRenderCount += 1;
      saveDiscoveryRenderCount += 1;
      saveLinkStatsRenderCount += 1;
      saveCodexNotificationCount += 1;
      if (titleChanged) collectionTitleUpdateCount += 1;
    };
    const renderCollectionExplorer = () => { collectionExplorerRenderCount += 1; };
    const renderMemoListPanel = () => {
      memoListRenderCount += 1;
      typingDerivedRenderCount += 1;
    };
    const renderTableBlockEditors = () => { tableEditorsRenderCount += 1; };
    const applyEffectiveFontSettings = noop;
    const renderPreview = () => { previewRenderCount += 1; };
    const renderAttachmentsForCurrentNote = noop;
    const renderRelated = () => { relatedRenderCount += 1; };
    const renderDiscovery = noop;
    const updateUndoButton = noop;
    const renderAiUi = noop;
    const renderTagPanel = () => { tagPanelRenderCount += 1; };
    const updateAiTargetPreview = () => { aiTargetRenderCount += 1; };
    const renderNoteTagOptions = noop;
    const saveCurrentDraftMirror = noop;
    const scheduleDraftMirror = noop;
    const flushDraftMirror = noop;
    const setSaveStatus = (status) => { saveStatuses.push(status); };
    const invalidateTermRelationIndex = () => { invalidateTermRelationIndexCount += 1; };
    const cloneNoteSnapshot = (value) => structuredClone(value);
    const activeNotes = () => notes.filter((note) => !note.deletedAt);
    const collectLinks = () => [];
    const buildDiscoveryMessage = () => "discovered";
    const normalizeTagIds = (tags) => Array.isArray(tags) ? [...tags] : [];
    const restrictTagIds = (tags) => normalizeTagIds(tags).filter((tag) => registeredTags.includes(tag));
    const titleFromBody = (body) => String(body).split(/\\r?\\n/).find(Boolean) || "";
    const compareDateTimes = (left, right) => Number(left || 0) - Number(right || 0);
    const getStoredNotes = () => storedNotesForHarness();
    const updateNotesTransaction = async (items, options = {}) => writer(items, { batch: true, ...options });
    const ensureRegisteredTagsForNotes = () => ensureTags();
    const getAllCollections = async () => [];
    const getAllTagDefinitions = async () => [];
    const getAttachmentsForMemo = async () => [];
    const normalizeTagDefinitions = (items) => Array.isArray(items) ? items : [];
    const sanitizeWindowsName = (value) => String(value || "note").replace(/[^\\w.-]+/g, "-");
    function setLocalSaveState(status, patch = {}) {
      localSaveState = transitionLocalSaveState(localSaveState, status, patch);
      localSaveStatusHistory.push(status);
    }
    async function optionalLocalText(root, path) {
      try { return await localFs.readText(root, path); }
      catch (error) {
        if (error?.name === "NotFoundError") return null;
        throw error;
      }
    }

    ${openNoteSource}
    ${saveCoreSource}
    ${saveHandlersSource}
    ${scheduleSaveSource}
    ${updateTagsSource}
    ${localSaveTargetSource}
    ${localSaveMetadataSource}
    ${performLocalWorkspaceSaveSource}

    notes.forEach((note) => noteSaveFoundation.registerNote(note.id, note.revision));
    globalThis.harness = {
      foundation: noteSaveFoundation,
      openNote,
      scheduleSave,
      updateCurrentNoteTags,
      mutateNotesAtomically,
      applyLocalSaveMetadata,
      buildLocalSaveLiveNoteIndex,
      localSaveBoundaryChanged,
      performLocalWorkspaceSave,
      enqueueNoteSave,
      setBeforeLocalSaveMetadataTransaction(callback) {
        performLocalWorkspaceSave.beforeMetadataTransaction = callback;
      },
      async switchLocalSaveTarget(handle) {
        await setLocalSaveTarget(handle);
        setLocalSaveState(handle ? "pending" : "unconfigured", {
          directoryName: handle?.name || "",
          pendingChanges: Boolean(handle),
          errorCode: "",
          errorMessage: "",
          requiresUserAction: false
        });
      },
      async saveCodexThread(noteId, codexChat, beforeWrite = null) {
        const current = noteForSave(noteId);
        const threadId = codexChat?.threadId || current?.codexChat?.threadId;
        codexBeforeWrite = beforeWrite;
        try {
          const result = await codexThreadSaveCoordinator.enqueue({ noteId, threadId, codexChat });
          if (codexThreadSaveCoordinator.wasPersisted(result.request)) {
            const targets = new Set([notes.find((note) => note.id === noteId), noteLiveDrafts.get(noteId)].filter(Boolean));
            targets.forEach((target) => {
              if (codexChat) target.codexChat = structuredClone(codexChat);
              else delete target.codexChat;
            });
          }
          return result;
        } finally {
          codexBeforeWrite = null;
        }
      },
      codexState(threadId) { return codexThreadSaveCoordinator.getState(threadId); },
      writeFullReplacement(items) { return writer(items, { batch: true, preserveStoredCodexThread: false }); },
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
          ,typingDerivedRenderCount
          ,saveMetaRenderCount
          ,saveDiscoveryRenderCount
          ,saveLinkStatsRenderCount
          ,saveCodexNotificationCount
          ,renderAllOptions: structuredClone(renderAllOptions)
          ,collectionExplorerRenderCount
          ,collectionTitleUpdateCount
          ,tagPanelRenderCount
          ,memoListRenderCount
          ,previewRenderCount
          ,relatedRenderCount
          ,textStatsRenderCount
          ,tableEditorsRenderCount
          ,aiTargetRenderCount
          ,saveStatuses: [...saveStatuses]
          ,localSaveState: structuredClone(localSaveState)
          ,localSaveStatusHistory: [...localSaveStatusHistory]
          ,localSyncState: structuredClone(localSyncState)
          ,localPendingExclusions: [...localPendingExclusions]
          ,consoleLogs: structuredClone(consoleLogs)
          ,localWorkspaceChangeVersion
          ,documentTitle: document.title
          ,drafts: [...noteLiveDrafts.values()].map((note) => structuredClone(note))
        };
      },
      bumpLocalWorkspaceChangeVersion() { localWorkspaceChangeVersion += 1; },
      addLocalPendingExclusion(noteId) { localPendingExclusions.add(noteId); },
      storedNotes: () => storedNotesForHarness(),
      edit(title, body) { titleInput.value = title; editor.value = body; },
      setCurrentId(id) { currentId = id; },
      markDraftDirty(id) {
        const draft = structuredClone(noteForSave(id));
        draft.revision = noteSaveFoundation.markChanged(id, draft.revision);
        noteLiveDrafts.set(id, draft);
        const index = notes.findIndex((note) => note.id === id);
        if (index === -1) notes.unshift(draft); else notes[index] = draft;
        return draft;
      },
      noteIds() { return notes.map((note) => note.id); },
      liveNote(id) { return noteForSave(id); }
    };
    function timersForHarness() { return globalThis.__timers; }
  `, context);
  context.__timers = timers;
  return context.harness;
}

async function executeMockLocalSave(harness, {
  savedAt,
  onFileWrite = async () => {},
  metadataOptions = {}
}) {
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
  const metadataResult = await harness.applyLocalSaveMetadata(plans, metadataOptions);
  return {
    changedDuringSave: harness.localSaveBoundaryChanged(
      plans,
      metadataResult.expectedRevisionsAfterMetadata,
      metadataResult.liveNotesById
    ),
    metadataResult,
    plans
  };
}

function countingLiveNoteIndexFactory(harness, counters) {
  return () => {
    counters.builds += 1;
    const index = harness.buildLocalSaveLiveNoteIndex(() => { counters.visits += 1; });
    return {
      get(noteId) {
        counters.lookups += 1;
        return index.get(noteId);
      },
      set(noteId, note) {
        counters.sets += 1;
        index.set(noteId, note);
        return this;
      }
    };
  };
}

function createMemoryLocalFs({ beforeWriteFile = async () => {}, beforeWriteJson = async () => {}, beforeDeleteConfig = async () => {} } = {}) {
  const files = new Map();
  const jsonFiles = new Map();
  return {
    name: "mock-local-folder",
    files,
    jsonFiles,
    async queryPermission() { return "granted"; },
    async ensureWorkspaceLayout(root) { return { root }; },
    async readJson(_root, path, fallback) {
      return jsonFiles.has(path) ? structuredClone(jsonFiles.get(path)) : structuredClone(fallback);
    },
    async readText(_root, path) {
      if (files.has(path)) return files.get(path);
      throw Object.assign(new Error(`not found: ${path}`), { name: "NotFoundError" });
    },
    async writeFile(_root, path, content) {
      await beforeWriteFile(path, content);
      files.set(path, content);
    },
    async writeJson(_root, path, value) {
      await beforeWriteJson(path, value);
      jsonFiles.set(path, structuredClone(value));
    },
    async deleteConfig(...args) { await beforeDeleteConfig(...args); }
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

test("ローカル保存先変更では保存済み通常noteがdirtyにならず同じrevisionを再保存しない", async () => {
  let writeCount = 0;
  const harness = createHarness({
    noteCount: 1,
    writer: async () => { writeCount += 1; }
  });
  harness.edit("A edited", "saved before local target switch");
  harness.scheduleSave();
  await harness.enqueueNoteSave("A");
  const savedState = harness.foundation.getState("A");

  await harness.switchLocalSaveTarget({ name: "new-target" });
  const switchedState = harness.foundation.getState("A");
  await harness.enqueueNoteSave("A");

  assert.equal(savedState.dirty, false);
  assert.equal(switchedState.dirty, false);
  assert.equal(switchedState.currentRevision, savedState.currentRevision);
  assert.equal(switchedState.lastSavedRevision, savedState.lastSavedRevision);
  assert.equal(writeCount, 1);
});

test("通常note保存中のローカル保存先変更は保存結果をstaleにせず余分なwriteを発生させない", async () => {
  const writeStarted = deferred();
  const releaseWrite = deferred();
  let writeCount = 0;
  const harness = createHarness({
    noteCount: 1,
    writer: async () => {
      writeCount += 1;
      writeStarted.resolve();
      await releaseWrite.promise;
    }
  });
  harness.edit("A edited", "in-flight across local target switch");
  harness.scheduleSave();
  const saving = harness.enqueueNoteSave("A");
  await writeStarted.promise;
  await harness.switchLocalSaveTarget({ name: "new-target" });
  releaseWrite.resolve();
  const result = await saving;

  assert.equal(Object.hasOwn(result, "staleSaveTarget"), false);
  assert.equal(Object.hasOwn(result.request, "saveTargetGeneration"), false);
  assert.equal(writeCount, 1);
  assert.equal(harness.foundation.getState("A").dirty, false);
});

test("Codex保存中のローカル保存先変更はstale・retryを発生させずメモリへ反映する", async () => {
  const writeStarted = deferred();
  const releaseWrite = deferred();
  let writeCount = 0;
  const harness = createHarness({ noteCount: 1 });
  const codexChat = { threadId: "thread-local-switch", title: "Local switch", lastUsedAt: 10 };
  const saving = harness.saveCodexThread("A", codexChat, async () => {
    writeCount += 1;
    writeStarted.resolve();
    await releaseWrite.promise;
  });
  await writeStarted.promise;
  await harness.switchLocalSaveTarget({ name: "new-target" });
  releaseWrite.resolve();
  const result = await saving;

  assert.equal(Object.hasOwn(result, "staleSaveTarget"), false);
  assert.equal(Object.hasOwn(result.request, "saveTargetGeneration"), false);
  assert.equal(writeCount, 1);
  assert.deepEqual(harness.liveNote("A").codexChat, codexChat);
  assert.deepEqual((await harness.storedNotes())[0].codexChat, codexChat);
});

test("atomic batch中のローカル保存先変更は通常どおり1回で完了して結果を適用する", async () => {
  const writeStarted = deferred();
  const releaseWrite = deferred();
  let batchWriteCount = 0;
  const harness = createHarness({
    noteCount: 1,
    writer: async (_value, options) => {
      if (!options?.batch) return;
      batchWriteCount += 1;
      writeStarted.resolve();
      await releaseWrite.promise;
    }
  });
  const saving = harness.mutateNotesAtomically(["A"], (note) => { note.isFlagged = true; });
  await writeStarted.promise;
  await harness.switchLocalSaveTarget({ name: "new-target" });
  releaseWrite.resolve();
  const results = await saving;

  assert.equal(batchWriteCount, 1);
  assert.equal(Object.hasOwn(results[0], "staleSaveTarget"), false);
  assert.equal(Object.hasOwn(results[0].request, "saveTargetGeneration"), false);
  assert.equal(results[0].state.dirty, false);
  assert.equal(harness.liveNote("A").isFlagged, true);
  assert.equal((await harness.storedNotes())[0].isFlagged, true);
});

test("通常note更新経路は共通mutationまたは排他入口へ接続されている", () => {
  const noteSaveFoundationSource = sourceBetween("const noteSaveFoundation", "const codexThreadSaveCoordinator");
  const paths = [
    ["function scheduleSave", "function captureUndoSnapshot", "enqueueNoteSave"],
    ["async function updateCurrentNoteTags", "function setNoteTagStatus", "enqueueNoteSave"],
    ["async function toggleCurrentNoteFlag", "function notifyPermanentDelete", "enqueueNoteSave"],
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
  assert.match(sourceBetween("function saveExplanationFromDialog", "function deleteExplanation"), /enqueueNoteSave\(note\.id\)/);
  assert.match(sourceBetween("function deleteExplanation", "// ここから下は、画面操作と処理を結びつけるイベント設定です。"), /enqueueNoteSave\(note\.id\)/);
  assert.match(sourceBetween("async function enqueueCodexThreadSave", "function applyCodexThreadSaveResult"), /codexThreadSaveCoordinator\.enqueue/);
  assert.match(noteSaveFoundationSource, /runExclusive\(\[snapshot\.noteId\]/);
  assert.match(noteSaveFoundationSource, /putCodexThreadSnapshot\(snapshot\)/);
  assert.match(noteSaveFoundationSource, /writeSnapshot\s*:\s*\(\s*snapshot\s*,\s*request\s*\)\s*=>\s*isCodexThreadSaveRequest\s*\(\s*request\s*\)\s*\?[\s\S]*?noteSaveFoundation\.runExclusive\s*\([\s\S]*?\)\s*:\s*putNote\s*\(\s*snapshot\s*,\s*\{\s*preserveStoredCodexThread\s*:\s*true\s*\}\s*\)\s*,/);
});

test("本文保存中のCodex更新とタグ更新は同一メモで直列化され、各フィールドを維持する", async () => {
  const firstWriteStarted = deferred();
  const firstWriteGate = deferred();
  let writeCount = 0;
  const harness = createHarness({
    writer: async () => {
      writeCount += 1;
      if (writeCount === 1) {
        firstWriteStarted.resolve();
        await firstWriteGate.promise;
      }
    }
  });

  harness.edit("A edited", "A body edited");
  harness.scheduleSave();
  harness.runNextTimer();
  await firstWriteStarted.promise;

  const codexChat = { threadId: "thread-a", title: "Thread A", lastUsedAt: 10 };
  const codexSaving = harness.saveCodexThread("A", codexChat);
  const tagSaving = harness.updateCurrentNoteTags(["tag-a"]);

  firstWriteGate.resolve();
  await Promise.all([codexSaving, tagSaving]);
  await harness.foundation.whenIdle("A");

  const stored = (await harness.storedNotes()).find((note) => note.id === "A");
  assert.equal(stored.body, "A body edited");
  assert.deepEqual(Array.from(stored.tags), ["tag-a"]);
  assert.deepEqual(stored.codexChat, codexChat);
  assert.equal(harness.foundation.getState("A").dirty, false);
  assert.deepEqual(harness.liveNote("A").codexChat, codexChat);
});

test("ローカルmetadataのlive索引はbatchごとに1回だけ構築され、200件から400件で走査・参照が正確に2倍になる", async () => {
  async function measure(noteCount) {
    const counters = { builds: 0, visits: 0, lookups: 0, sets: 0 };
    const harness = createHarness({ noteCount });
    const result = await executeMockLocalSave(harness, {
      savedAt: "2026-08-24T00:00:00.000Z",
      metadataOptions: { liveNoteIndexFactory: countingLiveNoteIndexFactory(harness, counters) }
    });
    assert.equal(result.changedDuringSave, false);
    return counters;
  }

  const count200 = await measure(200);
  const count400 = await measure(400);
  assert.deepEqual(count200, { builds: 1, visits: 200, lookups: 800, sets: 200 });
  assert.deepEqual(count400, { builds: 1, visits: 400, lookups: 1600, sets: 400 });
});

test("実performLocalWorkspaceSaveは固定snapshotをMarkdown・manifest・syncへ書き、metadataを原子的に保存済みにする", async () => {
  const localFs = createMemoryLocalFs();
  const metadataBatchSizes = [];
  const harness = createHarness({
    noteCount: 2,
    localFsDriver: localFs,
    writer: async (value, options) => {
      if (options?.batch) metadataBatchSizes.push(value.length);
    }
  });
  harness.addLocalPendingExclusion("removed-note");

  assert.equal(await harness.performLocalWorkspaceSave("actual-success"), true);

  const syncState = localFs.jsonFiles.get("sync-state.json");
  const aMarkdown = localFs.files.get(`notes/${syncState.notes.A.fileName}`);
  const manifest = JSON.parse(localFs.files.get("manifest.json"));
  const storedNotes = await harness.storedNotes();
  assert.match(aMarkdown, /A0/);
  assert.equal(syncState.notes.A.hash, contentHash(aMarkdown));
  assert.equal(manifest.savedAt, syncState.savedAt);
  assert.equal(manifest.notesCount, 2);
  assert.deepEqual(metadataBatchSizes, [2]);
  assert.equal(storedNotes.every((note) => note.localSavedAt === syncState.savedAt && note.revision === 1), true);
  storedNotes.forEach((note) => {
    assert.equal(harness.foundation.getState(note.id).lastSavedRevision, 1);
    assert.equal(harness.foundation.getState(note.id).dirty, false);
  });
  const state = harness.state();
  assert.deepEqual(Array.from(state.localSaveStatusHistory), ["saving", "saved"]);
  assert.equal(state.localSaveState.pendingChanges, false);
  assert.equal(state.localSyncState.savedAt, syncState.savedAt);
  assert.deepEqual(Array.from(state.localPendingExclusions), []);
  assert.equal(state.consoleLogs.some(([message]) => message === "Local workspace saved"), true);
  assert.equal(state.renderListCount, 1);
  assert.equal(state.invalidateTermRelationIndexCount, 0);
});

test("metadata transaction直前の保存先変更は旧local metadataをIndexedDBへ確定しない", async () => {
  const transactionReady = deferred();
  const releaseTransaction = deferred();
  let metadataWrites = 0;
  const oldTarget = createMemoryLocalFs();
  const harness = createHarness({
    noteCount: 1,
    localFsDriver: oldTarget,
    writer: async (_value, options) => { if (options?.batch) metadataWrites += 1; }
  });

  harness.setBeforeLocalSaveMetadataTransaction(async () => {
    transactionReady.resolve();
    await releaseTransaction.promise;
  });
  const saving = harness.performLocalWorkspaceSave("stale-before-metadata-transaction");
  await transactionReady.promise;
  await harness.switchLocalSaveTarget({ name: "new-target" });
  releaseTransaction.resolve();

  assert.equal(await saving, false);
  const storedNote = (await harness.storedNotes())[0];
  const state = harness.state();
  assert.equal(storedNote.localCreatedAt, undefined);
  assert.equal(storedNote.localSavedAt, undefined);
  assert.equal(metadataWrites, 0);
  assert.equal(state.localSaveState.status, "pending");
  assert.equal(state.localSaveState.lastSuccessAt, null);
  assert.deepEqual(Array.from(state.localSaveStatusHistory), ["saving", "pending"]);
});

test("metadata transaction直前hook中に保存先が変わらなければlocal metadataと成功状態を確定する", async () => {
  const transactionReady = deferred();
  const releaseTransaction = deferred();
  let metadataWrites = 0;
  const localFs = createMemoryLocalFs();
  const harness = createHarness({
    noteCount: 1,
    localFsDriver: localFs,
    writer: async (_value, options) => { if (options?.batch) metadataWrites += 1; }
  });

  harness.setBeforeLocalSaveMetadataTransaction(async () => {
    transactionReady.resolve();
    await releaseTransaction.promise;
  });
  const saving = harness.performLocalWorkspaceSave("current-before-metadata-transaction");
  await transactionReady.promise;
  releaseTransaction.resolve();

  assert.equal(await saving, true);
  const storedNote = (await harness.storedNotes())[0];
  const state = harness.state();
  assert.equal(metadataWrites, 1);
  assert.equal(typeof storedNote.localCreatedAt, "string");
  assert.equal(typeof storedNote.localSavedAt, "string");
  assert.equal(state.localSaveState.status, "saved");
  assert.equal(state.localSaveState.lastSuccessAt, storedNote.localSavedAt);
  assert.deepEqual(Array.from(state.localSaveStatusHistory), ["saving", "saved"]);
});

test("note lock待機中の保存先変更はwriter前検証で旧metadata batchを正常中止する", async () => {
  const singleWriteStarted = deferred();
  const releaseSingleWrite = deferred();
  const metadataPreparationReached = deferred();
  let metadataWrites = 0;
  const oldTarget = createMemoryLocalFs();
  const harness = createHarness({
    noteCount: 1,
    localFsDriver: oldTarget,
    writer: async (_value, options) => {
      if (options?.batch) {
        metadataWrites += 1;
        return;
      }
      singleWriteStarted.resolve();
      await releaseSingleWrite.promise;
    }
  });
  harness.edit("A normal save", "通常保存がlockを保持");
  harness.scheduleSave();
  harness.runNextTimer();
  await singleWriteStarted.promise;
  harness.setBeforeLocalSaveMetadataTransaction(async () => { metadataPreparationReached.resolve(); });

  const saving = harness.performLocalWorkspaceSave("stale-while-waiting-for-note-lock");
  await metadataPreparationReached.promise;
  for (let attempt = 0; attempt < 20 && harness.foundation.getState("A").currentRevision < 2; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(harness.foundation.getState("A").currentRevision, 2);
  await harness.switchLocalSaveTarget({ name: "new-target" });
  releaseSingleWrite.resolve();

  assert.equal(await saving, false);
  const idleState = await harness.foundation.whenIdle("A");
  const storedNote = (await harness.storedNotes())[0];
  const state = harness.state();
  assert.equal(metadataWrites, 0);
  assert.equal(storedNote.localCreatedAt, undefined);
  assert.equal(storedNote.localSavedAt, undefined);
  assert.equal(idleState.currentRevision, 1);
  assert.equal(idleState.lastSavedRevision, 1);
  assert.equal(idleState.dirty, false);
  assert.equal(idleState.status, "saved");
  assert.equal(idleState.lastError, null);
  assert.equal(state.saveStatuses.includes("error"), false);
  assert.equal(state.localSaveState.status, "pending");
  assert.equal(state.localSaveState.lastSuccessAt, null);
});

test("pendingExclusions削除待機中の保存先変更はawait後に旧成功のstate確定を止める", async () => {
  const deleteConfigStarted = deferred();
  const releaseDeleteConfig = deferred();
  let metadataWrites = 0;
  const oldTarget = createMemoryLocalFs({
    beforeDeleteConfig: async (_db, _storeName, key) => {
      if (key !== "pendingExclusions") return;
      deleteConfigStarted.resolve();
      await releaseDeleteConfig.promise;
    }
  });
  const harness = createHarness({
    noteCount: 1,
    localFsDriver: oldTarget,
    writer: async (_value, options) => { if (options?.batch) metadataWrites += 1; }
  });
  harness.addLocalPendingExclusion("old-target-exclusion");

  const saving = harness.performLocalWorkspaceSave("stale-during-pending-exclusions-delete");
  await deleteConfigStarted.promise;
  await harness.switchLocalSaveTarget({ name: "new-target" });
  harness.addLocalPendingExclusion("new-target-exclusion");
  releaseDeleteConfig.resolve();

  assert.equal(await saving, false);
  const storedNote = (await harness.storedNotes())[0];
  const state = harness.state();
  assert.equal(metadataWrites, 1);
  assert.equal(typeof storedNote.localCreatedAt, "string");
  assert.equal(typeof storedNote.localSavedAt, "string");
  assert.deepEqual(Object.keys(state.localSyncState.notes), []);
  assert.deepEqual(Array.from(state.localPendingExclusions), ["old-target-exclusion", "new-target-exclusion"]);
  assert.equal(state.localSaveState.status, "pending");
  assert.equal(state.localSaveState.lastSuccessAt, null);
  assert.equal(state.consoleLogs.some(([message]) => message === "Local workspace saved"), false);
  assert.deepEqual(Array.from(state.localSaveStatusHistory), ["saving", "pending"]);
});

test("実performLocalWorkspaceSaveは保存中の保存先変更後に旧成功を現在stateとmetadataへ確定しない", async () => {
  const writeStarted = deferred();
  const releaseWrite = deferred();
  let blocked = false;
  let metadataWrites = 0;
  const oldTarget = createMemoryLocalFs({
    beforeWriteFile: async (path) => {
      if (blocked || !path.startsWith("notes/")) return;
      blocked = true;
      writeStarted.resolve();
      await releaseWrite.promise;
    }
  });
  const harness = createHarness({
    noteCount: 1,
    localFsDriver: oldTarget,
    writer: async (_value, options) => { if (options?.batch) metadataWrites += 1; }
  });

  const saving = harness.performLocalWorkspaceSave("old-target-success");
  await writeStarted.promise;
  await harness.switchLocalSaveTarget({ name: "new-target" });
  releaseWrite.resolve();
  assert.equal(await saving, false);

  const state = harness.state();
  assert.deepEqual(Array.from(state.localSaveStatusHistory), ["saving", "pending"]);
  assert.equal(state.localSaveState.status, "pending");
  assert.equal(state.localSaveState.lastSuccessAt, null);
  assert.equal(metadataWrites, 0);
  assert.equal((await harness.storedNotes())[0].localSavedAt, undefined);
});

test("実performLocalWorkspaceSaveは旧保存先の失敗をrejectするが新保存先を失敗stateにしない", async () => {
  const writeStarted = deferred();
  const releaseWrite = deferred();
  const oldError = new Error("old target sync write failed");
  let blocked = false;
  const oldTarget = createMemoryLocalFs({
    beforeWriteFile: async (path) => {
      if (blocked || !path.startsWith("notes/")) return;
      blocked = true;
      writeStarted.resolve();
      await releaseWrite.promise;
    },
    beforeWriteJson: async (path) => {
      if (path === "sync-state.json") throw oldError;
    }
  });
  const harness = createHarness({ noteCount: 1, localFsDriver: oldTarget });

  const saving = harness.performLocalWorkspaceSave("old-target-failure");
  await writeStarted.promise;
  await harness.switchLocalSaveTarget({ name: "new-target" });
  releaseWrite.resolve();
  await assert.rejects(saving, (error) => error === oldError);

  const state = harness.state();
  assert.deepEqual(Array.from(state.localSaveStatusHistory), ["saving", "pending"]);
  assert.equal(state.localSaveState.status, "pending");
  assert.equal(state.localSaveState.errorMessage, "");
  assert.equal((await harness.storedNotes())[0].localSavedAt, undefined);
});

test("実performLocalWorkspaceSaveのファイル待機中編集は固定snapshotへ混ぜずlive revisionとchange versionでpendingに戻す", async () => {
  const noteWriteStarted = deferred();
  const releaseNoteWrite = deferred();
  let blocked = false;
  const localFs = createMemoryLocalFs({
    beforeWriteFile: async (path) => {
      if (blocked || !path.startsWith("notes/")) return;
      blocked = true;
      noteWriteStarted.resolve();
      await releaseNoteWrite.promise;
    }
  });
  const metadataBatchSizes = [];
  const harness = createHarness({
    noteCount: 2,
    localFsDriver: localFs,
    writer: async (value, options) => {
      if (options?.batch) metadataBatchSizes.push(value.length);
    }
  });

  const saving = harness.performLocalWorkspaceSave("actual-concurrent-edit");
  await noteWriteStarted.promise;
  harness.edit("A late", "A late body [[late-term]]");
  harness.scheduleSave();
  harness.bumpLocalWorkspaceChangeVersion();
  releaseNoteWrite.resolve();
  assert.equal(await saving, true);

  const syncState = localFs.jsonFiles.get("sync-state.json");
  const aMarkdown = localFs.files.get(`notes/${syncState.notes.A.fileName}`);
  assert.match(aMarkdown, /A0/);
  assert.doesNotMatch(aMarkdown, /late-term/);
  assert.equal(syncState.notes.A.hash, contentHash(aMarkdown));
  assert.deepEqual(metadataBatchSizes, [1]);
  assert.equal(harness.liveNote("A").body, "A late body [[late-term]]");
  assert.equal(harness.liveNote("A").revision, 1);
  assert.equal(harness.liveNote("A").localSavedAt, undefined);
  assert.equal(harness.foundation.getState("A").dirty, true);
  assert.equal(harness.foundation.getState("B").lastSavedRevision, 1);
  assert.equal(harness.state().localWorkspaceChangeVersion, 1);
  assert.equal(harness.state().localSaveState.status, "pending");
  assert.equal(harness.state().localSaveState.pendingChanges, true);

  harness.runNextTimer();
  await harness.foundation.whenIdle("A");
  assert.equal(harness.liveNote("A").body, "A late body [[late-term]]");
  assert.equal(harness.foundation.getState("A").lastSavedRevision, 1);
  assert.equal(harness.foundation.getState("A").dirty, false);
});

test("実performLocalWorkspaceSaveのmetadata transaction失敗はdraft・dirtyを保ち保存中からerrorへ遷移する", async () => {
  const metadataStarted = deferred();
  const releaseMetadata = deferred();
  const metadataError = new Error("actual metadata transaction aborted");
  const localFs = createMemoryLocalFs();
  const harness = createHarness({
    noteCount: 1,
    localFsDriver: localFs,
    writer: async (_value, options) => {
      if (!options?.batch) return;
      metadataStarted.resolve();
      await releaseMetadata.promise;
      throw metadataError;
    }
  });

  const saving = harness.performLocalWorkspaceSave("actual-metadata-failure");
  await metadataStarted.promise;
  harness.edit("A after files", "A draft survives");
  harness.scheduleSave();
  releaseMetadata.resolve();
  await assert.rejects(saving, (error) => error === metadataError);

  assert.equal(harness.liveNote("A").body, "A draft survives");
  assert.equal(harness.liveNote("A").localSavedAt, undefined);
  assert.equal(harness.foundation.getState("A").dirty, true);
  assert.equal(harness.state().timers, 1);
  const syncState = localFs.jsonFiles.get("sync-state.json");
  const aMarkdown = localFs.files.get(`notes/${syncState.notes.A.fileName}`);
  assert.equal(syncState.notes.A.hash, contentHash(aMarkdown));
  assert.deepEqual(Array.from(harness.state().localSaveStatusHistory), ["saving", "error"]);
  assert.equal(harness.state().localSaveState.status, "error");
  assert.equal(harness.state().renderListCount, 0);
});

test("実performLocalWorkspaceSaveはファイル待機中にtombstone化されたメモのmetadata書込みを拒否して復活させない", async () => {
  const noteWriteStarted = deferred();
  const releaseNoteWrite = deferred();
  let blocked = false;
  let metadataWrites = 0;
  const localFs = createMemoryLocalFs({
    beforeWriteFile: async (path) => {
      if (blocked || !path.startsWith("notes/")) return;
      blocked = true;
      noteWriteStarted.resolve();
      await releaseNoteWrite.promise;
    }
  });
  const harness = createHarness({
    noteCount: 1,
    localFsDriver: localFs,
    writer: async (_value, options) => { if (options?.batch) metadataWrites += 1; }
  });

  const saving = harness.performLocalWorkspaceSave("actual-tombstone");
  await noteWriteStarted.promise;
  const tombstone = { deletionId: "delete-during-local-save", deletedAt: "2026-08-24T03:00:00.000Z" };
  harness.foundation.finishPermanentDeletion(["A"], tombstone);
  releaseNoteWrite.resolve();
  await assert.rejects(saving, (error) => error?.code === "NOTE_PERMANENTLY_DELETED" && error?.noteId === "A");

  assert.equal(metadataWrites, 0);
  assert.equal(harness.foundation.isTerminal("A"), true);
  assert.equal(harness.foundation.terminalError("A")?.tombstone?.deletionId, tombstone.deletionId);
  assert.equal((await harness.storedNotes())[0].localSavedAt, undefined);
  assert.equal(harness.state().localSaveState.status, "error");
  assert.equal(harness.state().localSaveStatusHistory.at(-1), "error");
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

test("未反映の通常1件保存は派生UIを補完し保存成功専用UIだけを更新する", async () => {
  const harness = createHarness();
  harness.edit("A saved", "通常保存本文");
  harness.scheduleSave();
  harness.runNextTimer();
  await harness.foundation.whenIdle("A");

  const state = harness.state();
  assert.equal(state.renderAllCount, 0);
  assert.equal(state.renderListCount, 0);
  assert.equal(state.invalidateTermRelationIndexCount, 1);
  assert.equal(state.memoListRenderCount, 1);
  assert.equal(state.previewRenderCount, 1);
  assert.equal(state.relatedRenderCount, 1);
  assert.equal(state.textStatsRenderCount, 1);
  assert.equal(state.tableEditorsRenderCount, 1);
  assert.equal(state.aiTargetRenderCount, 1);
  assert.equal(state.collectionExplorerRenderCount, 0);
  assert.equal(state.tagPanelRenderCount, 0);
  assert.equal(state.saveMetaRenderCount, 1);
  assert.equal(state.saveDiscoveryRenderCount, 1);
  assert.equal(state.saveLinkStatsRenderCount, 1);
  assert.equal(state.saveCodexNotificationCount, 1);
  assert.equal(state.saveStatuses.includes("saving"), true);
  assert.equal(state.saveStatuses.at(-1), "saved");
  assert.equal(harness.liveNote("A").body, "通常保存本文");
  assert.equal(harness.foundation.getState("A").dirty, false);
});

test("同じnoteId・revisionの派生UI反映後は保存成功UIだけを更新して重い描画を省く", async () => {
  const scheduled = [];
  const typingDerivedUiScheduler = {
    schedule(noteId, revision) { scheduled.push({ noteId, revision }); },
    scheduleAuxiliary(noteId, revision) { scheduled.push({ noteId, revision, type: "auxiliary" }); },
    cancelNote() {},
    markRendered() {},
    requiredDerivedUiAfterSave(noteId, revision) {
      return scheduled.some((request) => request.noteId === noteId && request.revision === revision)
        ? null
        : "full";
    }
  };
  const harness = createHarness({ typingDerivedUiScheduler });
  harness.edit("A", "派生UI反映済み本文");
  harness.scheduleSave();
  const scheduledRevision = scheduled[0].revision;
  harness.runNextTimer();
  await harness.foundation.whenIdle("A");

  const state = harness.state();
  assert.deepEqual(scheduled, [{ noteId: "A", revision: scheduledRevision }]);
  assert.deepEqual(state.renderAllOptions, []);
  assert.equal(state.renderAllCount, 0);
  assert.equal(state.typingDerivedRenderCount, 0);
  assert.equal(state.invalidateTermRelationIndexCount, 0);
  assert.equal(state.collectionExplorerRenderCount, 0);
  assert.equal(state.collectionTitleUpdateCount, 0);
  assert.equal(state.tagPanelRenderCount, 0);
  assert.equal(state.saveMetaRenderCount, 1);
  assert.equal(state.saveDiscoveryRenderCount, 1);
  assert.equal(state.saveLinkStatsRenderCount, 1);
  assert.equal(state.saveCodexNotificationCount, 1);
  assert.equal(state.saveStatuses.includes("saving"), true);
  assert.equal(state.saveStatuses.at(-1), "saved");
  assert.equal(harness.foundation.getState("A").dirty, false);
  assert.equal(harness.liveNote("A").revision, scheduledRevision);
  assert.equal(harness.liveNote("A").updatedAt > 1, true);
});

test("タイトル変更はコレクション内の表示名だけを1回更新する", async () => {
  const scheduled = [];
  const typingDerivedUiScheduler = {
    schedule(noteId, revision) { scheduled.push({ noteId, revision }); },
    scheduleAuxiliary() {},
    cancelNote() {},
    markRendered() {},
    requiredDerivedUiAfterSave(noteId, revision) {
      return scheduled.some((request) => request.noteId === noteId && request.revision === revision)
        ? null
        : "full";
    }
  };
  const harness = createHarness({ typingDerivedUiScheduler });
  harness.edit("A renamed", "A0");
  harness.scheduleSave();
  harness.runNextTimer();
  await harness.foundation.whenIdle("A");

  const state = harness.state();
  assert.equal(harness.liveNote("A").title, "A renamed");
  assert.equal(state.collectionTitleUpdateCount, 1);
  assert.equal(state.collectionExplorerRenderCount, 0);
  assert.equal(state.tagPanelRenderCount, 0);
});

test("タグ変更はタグ件数を更新し通常保存成功では重複描画しない", async () => {
  const harness = createHarness();
  await harness.updateCurrentNoteTags(["tag-a"]);

  const state = harness.state();
  assert.deepEqual(Array.from(harness.liveNote("A").tags), ["tag-a"]);
  assert.equal(state.tagPanelRenderCount, 1);
  assert.equal(state.collectionExplorerRenderCount, 0);
});

test("コレクション変更のatomic batchはコレクション件数を更新する", async () => {
  const harness = createHarness();
  await harness.mutateNotesAtomically(["A"], (note) => { note.collectionId = "moved"; });

  const state = harness.state();
  assert.equal(harness.liveNote("A").collectionId, "moved");
  assert.equal(state.collectionExplorerRenderCount, 1);
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

function codexAtomicInitialNotes(count = 2) {
  return Array.from({ length: count }, (_, index) => {
    const id = index === 0 ? "A" : index === 1 ? "B" : "C";
    return {
      id,
      title: id,
      body: index === 0 ? "本文0" : `${id}0`,
      revision: 0,
      tags: [],
      collectionId: "old",
      isFlagged: false,
      updatedAt: 1,
      ...(index === 0 ? { codexChat: { threadId: "thread-a", lastUsedAt: "2026-08-25T00:00:00.000Z", title: "A" } } : {})
    };
  });
}

const threadB = Object.freeze({ threadId: "thread-b", lastUsedAt: "2026-08-25T00:01:00.000Z", title: "B" });

test("本番updateNotesTransactionは同一transaction内で全件の確定Codex値だけをmergeして実保存snapshotを返す", async () => {
  const production = createProductionBatchWriterHarness([
    { id: "A", body: "DB本文A", revision: 0, codexChat: threadB },
    { id: "B", body: "DB本文B", revision: 0 }
  ]);
  const snapshots = [
    { id: "A", body: "batch本文A", revision: 1, codexChat: { threadId: "thread-a" }, isFlagged: true },
    { id: "B", body: "batch本文B", revision: 1, codexChat: { threadId: "thread-old" }, isFlagged: true }
  ];
  const saved = await production.updateNotesTransaction(snapshots, { preserveStoredCodexThread: true });

  assert.equal(production.transactionCount(), 1);
  assert.equal(production.stored.get("A").body, "batch本文A");
  assert.equal(production.stored.get("A").isFlagged, true);
  assert.equal(production.stored.get("A").codexChat.threadId, "thread-b");
  assert.equal(production.stored.get("B").body, "batch本文B");
  assert.equal(Object.hasOwn(production.stored.get("B"), "codexChat"), false);
  assert.equal(saved[0].codexChat.threadId, "thread-b");
  assert.equal(Object.hasOwn(saved[1], "codexChat"), false);
  assert.equal(snapshots[0].codexChat.threadId, "thread-a");
  assert.equal(snapshots[1].codexChat.threadId, "thread-old");
  assert.equal(production.notifications[0].codexChat.threadId, "thread-b");
});

test("通常custom writerだけがCodex保護helperを明示し、バックアップ全体置換は従来writerを維持する", () => {
  const localMetadataWriter = sourceBetween("async function applyLocalSaveMetadata", "function localSaveBoundaryChanged");
  const webClipWriter = sourceBetween("const writeWebClipTransaction", "return noteForSave(memoId)");
  const collectionDeletionWriter = sourceBetween("const writeDeletionTransaction", "if (affected.length)");
  const backupWriter = sourceBetween("async function applyPortableBackupImport", "async function importPastedItNewsJson");

  assert.match(localMetadataWriter, /preserveStoredCodexThread: true/);
  assert.match(webClipWriter, /prepareNoteSnapshotsInTransaction[\s\S]*preserveStoredCodexThread: true/);
  assert.match(collectionDeletionWriter, /prepareNoteSnapshotsInTransaction[\s\S]*preserveStoredCodexThread: true/);
  assert.doesNotMatch(backupWriter, /preserveStoredCodexThread: true/);
});

test("Codex先行: ロック待ちatomic batchはtransaction内のthread-bを維持してDB・メモリ・結果へ反映する", async () => {
  const codexStarted = deferred();
  const releaseCodex = deferred();
  const harness = createHarness({ initialNotes: codexAtomicInitialNotes() });
  const codexSave = harness.saveCodexThread("A", threadB, async () => {
    codexStarted.resolve();
    await releaseCodex.promise;
  });
  await codexStarted.promise;

  const batchSave = harness.mutateNotesAtomically(["A"], (note) => { note.isFlagged = true; });
  releaseCodex.resolve();
  const [, results] = await Promise.all([codexSave, batchSave]);
  const stored = (await harness.storedNotes()).find((note) => note.id === "A");
  const memory = harness.liveNote("A");

  assert.equal(results[0].request.snapshot.codexChat.threadId, "thread-a");
  assert.equal(results[0].savedSnapshot.codexChat.threadId, "thread-b");
  assert.equal(stored.body, "本文0");
  assert.equal(stored.isFlagged, true);
  assert.equal(stored.codexChat.threadId, "thread-b");
  assert.equal(memory.body, "本文0");
  assert.equal(memory.isFlagged, true);
  assert.equal(memory.codexChat.threadId, "thread-b");
});

test("atomic batch先行: batch完了後のCodex保存でフラグとthread-bをともに維持する", async () => {
  const batchStarted = deferred();
  const releaseBatch = deferred();
  const harness = createHarness({
    initialNotes: codexAtomicInitialNotes(),
    writer: async (_value, options) => {
      if (!options?.batch) return;
      batchStarted.resolve();
      await releaseBatch.promise;
    }
  });
  const batchSave = harness.mutateNotesAtomically(["A"], (note) => { note.isFlagged = true; });
  await batchStarted.promise;
  const codexSave = harness.saveCodexThread("A", threadB);
  releaseBatch.resolve();
  await Promise.all([batchSave, codexSave]);

  const stored = (await harness.storedNotes()).find((note) => note.id === "A");
  assert.equal(stored.isFlagged, true);
  assert.equal(stored.codexChat.threadId, "thread-b");
  assert.equal(harness.liveNote("A").isFlagged, true);
  assert.equal(harness.liveNote("A").codexChat.threadId, "thread-b");
});

test("Codex解除先行: 古いthread-a入りbatchから解除済みthreadを復活させない", async () => {
  const codexStarted = deferred();
  const releaseCodex = deferred();
  const harness = createHarness({ initialNotes: codexAtomicInitialNotes() });
  const codexSave = harness.saveCodexThread("A", null, async () => {
    codexStarted.resolve();
    await releaseCodex.promise;
  });
  await codexStarted.promise;
  const batchSave = harness.mutateNotesAtomically(["A"], (note) => { note.isFlagged = true; });
  releaseCodex.resolve();
  const [, results] = await Promise.all([codexSave, batchSave]);

  const stored = (await harness.storedNotes()).find((note) => note.id === "A");
  assert.equal(stored.isFlagged, true);
  assert.equal(Object.hasOwn(stored, "codexChat"), false);
  assert.equal(Object.hasOwn(harness.liveNote("A"), "codexChat"), false);
  assert.equal(Object.hasOwn(results[0].savedSnapshot, "codexChat"), false);
});

test("batch失敗: merge後のtransaction abortは部分更新せずdraft・revision・idle・Codex状態を維持する", async () => {
  const codexStarted = deferred();
  const releaseCodex = deferred();
  const batchError = new Error("atomic transaction aborted after Codex merge");
  const harness = createHarness({
    initialNotes: codexAtomicInitialNotes(),
    writer: async (_value, options) => { if (options?.batch) throw batchError; }
  });
  const codexSave = harness.saveCodexThread("A", threadB, async () => {
    codexStarted.resolve();
    await releaseCodex.promise;
  });
  await codexStarted.promise;
  const batchSave = harness.mutateNotesAtomically(["A"], (note) => { note.isFlagged = true; });
  harness.edit("A edited", "失われない本文");
  harness.scheduleSave();
  releaseCodex.resolve();
  await codexSave;
  const coordinatorBeforeFailure = structuredClone(harness.codexState("thread-b"));
  await assert.rejects(batchSave, (error) => error === batchError);
  const idleState = await harness.foundation.whenIdle("A");
  const stored = (await harness.storedNotes()).find((note) => note.id === "A");

  assert.equal(stored.body, "本文0");
  assert.equal(stored.isFlagged, false);
  assert.equal(stored.codexChat.threadId, "thread-b");
  assert.equal(harness.liveNote("A").body, "失われない本文");
  assert.equal(harness.liveNote("A").isFlagged, false);
  assert.equal(harness.liveNote("A").codexChat.threadId, "thread-b");
  assert.equal(idleState.currentRevision, harness.liveNote("A").revision);
  assert.equal(idleState.lastSavedRevision, 0);
  assert.equal(idleState.dirty, true);
  assert.deepEqual(harness.codexState("thread-b"), coordinatorBeforeFailure);
});

test("複数メモbatch: 競合メモだけ最新Codex値をmergeし、全件原子保存中も対象外メモを待たせない", async () => {
  const codexStarted = deferred();
  const releaseCodex = deferred();
  const unrelatedCompleted = deferred();
  const harness = createHarness({ initialNotes: codexAtomicInitialNotes(3) });
  const codexSave = harness.saveCodexThread("A", threadB, async () => {
    codexStarted.resolve();
    await releaseCodex.promise;
  });
  await codexStarted.promise;
  const batchSave = harness.mutateNotesAtomically(["B", "A"], (note) => { note.collectionId = "moved"; });
  const unrelated = harness.foundation.runExclusive(["C"], async () => { unrelatedCompleted.resolve(); });
  await unrelatedCompleted.promise;
  harness.markDraftDirty("A");
  releaseCodex.resolve();
  const [, results] = await Promise.all([codexSave, batchSave, unrelated]);
  const stored = new Map((await harness.storedNotes()).map((note) => [note.id, note]));
  const draftA = harness.state().drafts.find((note) => note.id === "A");

  assert.equal(stored.get("A").collectionId, "moved");
  assert.equal(stored.get("A").codexChat.threadId, "thread-b");
  assert.equal(stored.get("B").collectionId, "moved");
  assert.equal(stored.get("B").codexChat, undefined);
  assert.equal(stored.get("C").collectionId, "old");
  assert.equal(harness.liveNote("A").collectionId, "moved");
  assert.equal(draftA.codexChat.threadId, "thread-b");
  assert.equal(results.find(({ request }) => request.noteId === "A").savedSnapshot.codexChat.threadId, "thread-b");
});

test("意図的な全体置換writerはCodex保護を適用せず従来どおり入力snapshotで置換する", async () => {
  const harness = createHarness({ initialNotes: codexAtomicInitialNotes() });
  const results = await harness.mutateNotesAtomically(["A"], (note) => {
    note.body = "バックアップ本文";
    delete note.codexChat;
  }, (snapshots) => harness.writeFullReplacement(snapshots));
  const stored = (await harness.storedNotes()).find((note) => note.id === "A");

  assert.equal(stored.body, "バックアップ本文");
  assert.equal(Object.hasOwn(stored, "codexChat"), false);
  assert.equal(Object.hasOwn(harness.liveNote("A"), "codexChat"), false);
  assert.equal(Object.hasOwn(results[0].savedSnapshot, "codexChat"), false);
});
