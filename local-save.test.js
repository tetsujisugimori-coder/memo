"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const {
  applyLocalSaveSuccess,
  classifyLocalSaveFailure,
  createLocalSaveState,
  resolveDisplayedCreatedAt,
  resolveLocalScanState,
  shouldResumeLocalSaveAfterScan,
  transitionLocalSaveState
} = require("./local-save-state.js");
const { compareDateTimes, formatNoteDateTime } = require("./status-time-utils.js");
const { createLocalSaveQueue, runLocalReconnectSequence, runLocalScanAfterQueue } = require("./local-save-queue.js");
const {
  parseLocalNote,
  restoreAttachmentReferences,
  resolveImportedCreatedAt,
  serializeLocalNote
} = require("./local-markdown.js");
const {
  attachmentExtension,
  buildLocalScanAnalysis,
  buildManifest,
  classifyManagedMarkdownHashes,
  classifyMarkdownCandidate,
  contentHash,
  createLocalConflictResolution,
  deleteLocalConflictResolution,
  hasExternalModification,
  localConflictResolutionFileName,
  localConflictResolutionMatches,
  localConflictResolutionPaths,
  managedMarkdownComparableHash,
  managedNoteForPath,
  normalizeSyncState,
  parseCollections,
  serializeCollections
} = require("./local-sync-utils.js");
const localFs = require("./local-fs-adapter.js");
const { runManualLocalSave } = require("./manual-local-save.js");
const { remapImportedAttachmentReferences, resolveImportedAttachmentId } = require("./attachment-utils.js");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} が見つかること`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} の終端が見つかりません`);
}

class MockFileHandle {
  constructor(name, value = "", type = "text/plain") {
    this.kind = "file";
    this.name = name;
    this.value = value;
    this.type = type;
    this.lastModified = 1723590000000;
    this.writeCount = 0;
  }
  async createWritable() {
    return {
      write: async (value) => {
        this.value = value;
        this.writeCount += 1;
        this.lastModified += 1;
      },
      close: async () => {},
      abort: async () => {}
    };
  }
  async getFile() {
    const blob = this.value instanceof Blob ? this.value : new Blob([this.value], { type: this.type });
    Object.defineProperties(blob, { name: { value: this.name }, lastModified: { value: this.lastModified } });
    return blob;
  }
}

class MockDirectoryHandle {
  constructor(name) {
    this.kind = "directory";
    this.name = name;
    this.directories = new Map();
    this.files = new Map();
    this.permission = "granted";
  }
  async queryPermission() { return this.permission; }
  async requestPermission() { this.permission = "granted"; return this.permission; }
  async getDirectoryHandle(name, options = {}) {
    if (!this.directories.has(name) && options.create) this.directories.set(name, new MockDirectoryHandle(name));
    if (!this.directories.has(name)) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
    return this.directories.get(name);
  }
  async getFileHandle(name, options = {}) {
    if (!this.files.has(name) && options.create) this.files.set(name, new MockFileHandle(name));
    if (!this.files.has(name)) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
    return this.files.get(name);
  }
  async *values() {
    yield* this.files.values();
    yield* this.directories.values();
  }
}

function createConfigDb() {
  const records = new Map();
  return {
    records,
    transaction() {
      const transaction = {};
      transaction.objectStore = () => ({
        get(key) {
          const request = {};
          queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); });
          return request;
        },
        put(record) {
          records.set(record.key, record);
          queueMicrotask(() => transaction.oncomplete?.());
        },
        delete(key) {
          records.delete(key);
          queueMicrotask(() => transaction.oncomplete?.());
        }
      });
      return transaction;
    }
  };
}

async function scanMockWorkspace(selected, syncState, notes, resolvedConflicts = new Map()) {
  return (await scanMockWorkspaceAnalysis(selected, syncState, notes, resolvedConflicts)).candidates;
}

function createMockAttachmentStore(items = []) {
  const records = new Map(items.map((item) => [item.id, { ...item }]));
  return {
    records,
    get(id) { return records.get(id) || null; },
    getAllForMemo(memoId) { return [...records.values()].filter((item) => item.memoId === memoId); },
    put(item) { records.set(item.id, { ...item }); },
    getRequest(id) {
      const request = {};
      queueMicrotask(() => {
        request.result = records.get(id);
        request.onsuccess?.();
      });
      return request;
    }
  };
}

function loadAppFunction(name, dependencies, { async = false } = {}) {
  const extracted = extractFunction(app, name);
  const source = async ? extracted.replace(/^function /, "async function ") : extracted;
  const names = Object.keys(dependencies);
  return Function(...names, `"use strict"; ${source}; return ${name};`)(...names.map((dependency) => dependencies[dependency]));
}

function createLocalSaveTargetHarness(initialHandle = null) {
  const source = [
    ["localSaveTargetsMatch", true],
    ["setLocalSaveTarget", true],
    ["createLocalSaveRequest", false],
    ["localSaveRequestIsCurrent", false]
  ].map(([name, isAsync]) => {
    const extracted = extractFunction(app, name);
    return isAsync ? extracted.replace(/^function /, "async function ") : extracted;
  }).join("\n");
  return Function("initialHandle", `
    "use strict";
    let localDirectoryHandle = initialHandle;
    let localSaveTargetGeneration = 0;
    ${source}
    return {
      setLocalSaveTarget,
      createLocalSaveRequest,
      localSaveRequestIsCurrent,
      generation: () => localSaveTargetGeneration,
      handle: () => localDirectoryHandle
    };
  `)(initialHandle);
}

test("ローカル保存先generationは初回・別先・解除だけで進み、同一先の再設定では進まない", async () => {
  const targetA = {};
  const entryA = {
    kind: "directory",
    name: "A",
    target: targetA,
    isSameEntry: async (other) => other?.target === targetA
  };
  const entryAAlias = {
    kind: "directory",
    name: "A alias",
    target: targetA,
    isSameEntry: async (other) => other?.target === targetA
  };
  const entryB = { kind: "directory", name: "B" };
  const harness = createLocalSaveTargetHarness();

  assert.equal(await harness.setLocalSaveTarget(entryA), true);
  assert.equal(harness.generation(), 1);
  assert.equal(await harness.setLocalSaveTarget(entryA), false);
  assert.equal(harness.generation(), 1);
  assert.equal(await harness.setLocalSaveTarget(entryAAlias), false);
  assert.equal(harness.generation(), 1);
  assert.equal(harness.handle(), entryAAlias);
  assert.equal(await harness.setLocalSaveTarget(entryB), true);
  assert.equal(harness.generation(), 2);
  assert.equal(await harness.setLocalSaveTarget(null), true);
  assert.equal(harness.generation(), 3);
  assert.equal(await harness.setLocalSaveTarget(null), false);
  assert.equal(harness.generation(), 3);
});

test("ローカル保存要求は開始時のハンドルとgenerationを固定して旧完了を判別する", async () => {
  const entryA = { kind: "directory", name: "A" };
  const entryB = { kind: "directory", name: "B" };
  const harness = createLocalSaveTargetHarness();
  await harness.setLocalSaveTarget(entryA);
  const requestA = harness.createLocalSaveRequest("manual");
  await harness.setLocalSaveTarget(entryB);
  const requestB = harness.createLocalSaveRequest("manual");

  assert.equal(requestA.directoryHandle, entryA);
  assert.equal(requestA.localSaveTargetGeneration, 1);
  assert.equal(harness.localSaveRequestIsCurrent(requestA), false);
  assert.equal(requestB.directoryHandle, entryB);
  assert.equal(requestB.localSaveTargetGeneration, 2);
  assert.equal(harness.localSaveRequestIsCurrent(requestB), true);
  assert.equal(Object.isFrozen(requestA), true);
});

test("本番ローカル保存は固定した保存先だけへ書き、旧世代の成功・失敗を現在stateへ反映しない", () => {
  const saveFlow = extractFunction(app, "performLocalWorkspaceSave");
  const metadataFlow = extractFunction(app, "applyLocalSaveMetadata");
  const initializeFlow = extractFunction(app, "initializeLocalFolderSaving");
  const selectFlow = extractFunction(app, "selectLocalSaveFolder");
  const reconnectFlow = extractFunction(app, "reconnectLocalSaveFolder");
  const disconnectFlow = extractFunction(app, "disconnectLocalSaveFolder");

  assert.match(saveFlow, /const request = createLocalSaveRequest\(reason\)/);
  assert.match(saveFlow, /ensureWorkspaceLayout\(request\.directoryHandle\)/);
  assert.doesNotMatch(saveFlow, /ensureWorkspaceLayout\(localDirectoryHandle\)/);
  assert.ok(saveFlow.indexOf("if (!localSaveRequestIsCurrent(request))") < saveFlow.indexOf("await applyLocalSaveMetadata(plans, {"));
  assert.match(saveFlow, /isCurrent:\s*\(\)\s*=>\s*localSaveRequestIsCurrent\(request\)/);
  const beforeMetadataHookIndex = metadataFlow.indexOf("await options.beforeMetadataTransaction()");
  const preBatchCurrentIndex = metadataFlow.indexOf("if (!isCurrent())", beforeMetadataHookIndex);
  assert.ok(beforeMetadataHookIndex < preBatchCurrentIndex);
  assert.ok(preBatchCurrentIndex < metadataFlow.indexOf("mutateNotesAtomically"));
  assert.match(metadataFlow, /validateBeforeWrite:\s*\(\)\s*=>\s*\{\s*if \(!isCurrent\(\)\) throw localSaveMetadataStaleError\(\)/);
  assert.match(app, /createRequests:\s*\(\)\s*=>\s*requests,\s*validateBeforeWrite,\s*writeSnapshots:/);
  const deleteConfigIndex = saveFlow.indexOf("await localFs.deleteConfig");
  const postDeleteCurrentIndex = saveFlow.indexOf("if (!localSaveRequestIsCurrent(request)) return false;", deleteConfigIndex);
  assert.ok(deleteConfigIndex < postDeleteCurrentIndex);
  assert.ok(postDeleteCurrentIndex < saveFlow.indexOf("localSyncState = nextSync"));
  assert.ok(postDeleteCurrentIndex < saveFlow.indexOf("localPendingExclusions.clear()"));
  assert.match(saveFlow, /catch \(error\) \{\s*if \(localSaveRequestIsCurrent\(request\)\)/);
  assert.match(initializeFlow, /setLocalSaveTarget\(await localFs\.getConfig/);
  assert.match(selectFlow, /await setLocalSaveTarget\(handle\)/);
  assert.match(disconnectFlow, /await setLocalSaveTarget\(null\)/);
  assert.doesNotMatch(reconnectFlow, /setLocalSaveTarget/);
});

function mockAttachmentPersistence(store) {
  const getAttachmentRecord = loadAppFunction("getAttachmentRecord", {
    attachmentTx: () => ({ get: (id) => store.getRequest(id) })
  });
  let pendingMarks = 0;
  const db = {
    transaction() {
      const transaction = {};
      transaction.objectStore = () => ({
        put(item) {
          store.put(item);
          queueMicrotask(() => transaction.oncomplete?.());
        }
      });
      return transaction;
    }
  };
  const putAttachments = loadAppFunction("putAttachments", {
    db,
    ATTACHMENT_STORE_NAME: "attachments",
    TOMBSTONE_STORE_NAME: "note-tombstones",
    writeAttachmentsWithTombstoneGuard: async ({ items }) => {
      items.forEach((item) => store.put(item));
      return items;
    },
    markLocalWorkspacePending: () => { pendingMarks += 1; }
  });
  return { getAttachmentRecord, putAttachments, pendingMarks: () => pendingMarks };
}

async function scanMockWorkspaceAnalysis(selected, syncState, notes, resolvedConflicts = new Map()) {
  const files = await localFs.scanMarkdownFiles(selected);
  return buildLocalScanAnalysis({
    files,
    syncState,
    notes,
    parseNote: parseLocalNote,
    serializeNote: serializeLocalNote,
    getAttachmentsForNote: async () => [],
    resolvedConflicts
  });
}

function applyScanState(state, candidates, now = Date.now()) {
  const resolution = resolveLocalScanState(state, candidates);
  return resolution ? transitionLocalSaveState(state, resolution.status, resolution.patch, now) : state;
}

test("フォールバック競合にも確認時hashを付け、notes/外は上書き対象にしない", async () => {
  const selected = new MockDirectoryHandle("保存先");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const note = { id: "note-1", title: "フォールバック", body: "Memo Nexus本文", tags: [] };
  const markdown = (body) => serializeLocalNote({ ...note, body });
  const legacySync = normalizeSyncState({ notes: { "note-1": { fileName: "legacy.md", attachmentIds: [] } } });
  await localFs.writeFile(layout.root, "notes/legacy.md", markdown("旧形式の外部変更"));
  await localFs.writeFile(layout.root, "notes/unmanaged.md", markdown("未管理notesの外部変更"));
  selected.files.set("root.md", new MockFileHandle("root.md", markdown("直下の外部変更")));

  const legacyCandidates = await scanMockWorkspace(selected, legacySync, [note]);
  const legacy = legacyCandidates.find((candidate) => candidate.path === "notes/legacy.md");
  assert.equal(legacy.classification.currentLocalHash, contentHash(await legacy.file.text()));
  assert.equal(resolutionForCandidate(legacy, note.id, "app", legacySync)?.writePath, "notes/legacy.md");

  const unmanagedCandidates = await scanMockWorkspace(selected, normalizeSyncState(), [note]);
  const unmanaged = unmanagedCandidates.find((candidate) => candidate.path === "notes/unmanaged.md");
  assert.equal(unmanaged.classification.currentLocalHash, contentHash(await unmanaged.file.text()));
  assert.equal(resolutionForCandidate(unmanaged, note.id, "local")?.writePath, "notes/unmanaged.md");
  for (const path of ["root.md", "inbox/unused.md"]) {
    if (path.startsWith("inbox/")) await localFs.writeFile(layout.root, path, markdown("inboxの外部変更"));
    const candidate = (await scanMockWorkspace(selected, normalizeSyncState(), [note])).find((item) => item.path === path);
    assert.equal(candidate.classification.currentLocalHash, contentHash(await candidate.file.text()));
    assert.equal(resolutionForCandidate(candidate, note.id, "app"), null);
    assert.equal(resolutionForCandidate(candidate, note.id, "local"), null);
  }
});

test("旧形式と未管理notesの競合は上書き・ローカル版読込後に同じファイルへ保存して同期管理する", async () => {
  for (const scenario of ["legacy", "unmanaged-notes"]) {
    for (const action of ["app", "local"]) {
      const selected = new MockDirectoryHandle(`${scenario}-${action}`);
      const layout = await localFs.ensureWorkspaceLayout(selected);
      const note = {
        id: "note-1", title: "フォールバック保存", collectionId: "c1", createdAt: "created", localCreatedAt: "local",
        updatedAt: 1, bodyUpdatedAt: 1, localSavedAt: "2026-08-20T00:00:00.000Z", isFlagged: false, deletedAt: null, sortOrder: 0, body: "Memo Nexus本文"
      };
      const fileName = scenario === "legacy" ? "legacy.md" : "unmanaged.md";
      const source = serializeLocalNote({ ...note, body: "ローカル本文" });
      const syncState = scenario === "legacy"
        ? normalizeSyncState({ notes: { "note-1": { fileName, attachmentIds: [] } } })
        : normalizeSyncState();
      await localFs.writeFile(layout.root, `notes/${fileName}`, source);
      const candidate = (await scanMockWorkspaceAnalysis(selected, syncState, [note])).candidates[0];
      assert.equal(candidate.classification.type, "conflict");
      const resolution = resolutionForCandidate(candidate, note.id, action, syncState);
      assert.equal(resolution?.confirmedPath, `notes/${fileName}`);
      assert.equal(resolution?.writePath, `notes/${fileName}`);
      const resolutions = new Map([[note.id, resolution]]);
      const importedNote = action === "local" ? { ...note, body: candidate.parsed.body, updatedAt: 2, bodyUpdatedAt: 2 } : note;
      assert.deepEqual(await scanMockWorkspace(selected, syncState, [importedNote], resolutions), []);

      const completed = await writeMockWorkspacePlan({
        root: layout.root, syncState, note: importedNote, resolutionMap: resolutions,
        savedAt: "2026-08-20T00:04:00.000Z"
      });
      const writtenPath = `notes/${fileName}`;
      const writtenSync = await localFs.readJson(layout.root, "sync-state.json", null);
      assert.equal(writtenSync.notes[note.id].fileName, fileName);
      assert.equal(writtenSync.notes[note.id].hash, contentHash(await localFs.readText(layout.root, writtenPath)));
      assert.equal(await localFs.readText(layout.root, writtenPath), completed.markdown);
      assert.deepEqual(await scanMockWorkspace(selected, completed.syncState, [completed.savedNote]), []);
      assert.equal(resolutions.size, 0);
    }
  }
});

test("フォールバック競合の確認後に対象Markdownを再編集すると保存を許可しない", async () => {
  const selected = new MockDirectoryHandle("再編集");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const note = { id: "note-1", title: "再編集", body: "Memo Nexus本文", tags: [] };
  const syncState = normalizeSyncState();
  await localFs.writeFile(layout.root, "notes/unmanaged.md", serializeLocalNote({ ...note, body: "最初の外部変更" }));
  const candidate = (await scanMockWorkspaceAnalysis(selected, syncState, [note])).candidates[0];
  const resolution = resolutionForCandidate(candidate, note.id, "app", syncState);
  const resolutions = new Map([[note.id, resolution]]);
  await localFs.writeFile(layout.root, "notes/unmanaged.md", serializeLocalNote({ ...note, body: "二度目の外部変更" }));
  const analysis = await scanMockWorkspaceAnalysis(selected, syncState, [note], resolutions);
  assert.deepEqual(analysis.candidates.map((item) => item.path), ["notes/unmanaged.md"]);
  assert.deepEqual(analysis.invalidatedResolutionNoteIds, [note.id]);
  await assert.rejects(writeMockWorkspacePlan({
    root: layout.root, syncState, note, resolutionMap: resolutions,
    savedAt: "2026-08-20T00:05:00.000Z"
  }), (error) => error.code === "conflict");
});

test("選択フォルダ直下とinboxの同一ID競合は上書き・ローカル版読込を提供せず、元ファイルを残す", async () => {
  const selected = new MockDirectoryHandle("未管理パス");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const note = { id: "note-1", title: "未管理パス", body: "Memo Nexus本文", tags: [] };
  const source = (body) => serializeLocalNote({ ...note, body });
  selected.files.set("root.md", new MockFileHandle("root.md", source("直下の外部変更")));
  await localFs.writeFile(layout.root, "inbox/inbox.md", source("inboxの外部変更"));
  const candidates = await scanMockWorkspace(selected, normalizeSyncState(), [note]);
  for (const candidate of candidates) {
    assert.ok(["root.md", "inbox/inbox.md"].includes(candidate.path));
    assert.equal(candidate.classification.type, "conflict");
    assert.equal(resolutionForCandidate(candidate, note.id, "app"), null);
    assert.equal(resolutionForCandidate(candidate, note.id, "local"), null);
  }
  assert.equal(await (await selected.files.get("root.md").getFile()).text(), source("直下の外部変更"));
  assert.equal(await localFs.readText(layout.root, "inbox/inbox.md"), source("inboxの外部変更"));
  const renderFlow = extractFunction(app, "renderLocalScanResults");
  const applyFlow = extractFunction(app, "applyLocalCandidate");
  assert.match(renderFlow, /canResolveLocalConflictInPlace\(candidate\)[\s\S]*\[\["exclude", "除外"\], \["hold", "保留する"\]\]/);
  assert.match(applyFlow, /unsafe-conflict-path/);
});

function resolutionForCandidate(candidate, noteId, action, syncState = normalizeSyncState()) {
  const paths = localConflictResolutionPaths({
    candidatePath: candidate.path,
    managedFileName: syncState.notes[noteId]?.fileName
  });
  return createLocalConflictResolution({
    noteId,
    action,
    ...paths,
    confirmedLocalHash: candidate.classification.currentLocalHash
  });
}

async function writeMockWorkspacePlan({ root, syncState, note, resolutionMap, savedAt, attachments = [], failAfterMarkdown = false }) {
  const previous = syncState.notes[note.id] || {};
  const resolution = resolutionMap.get(note.id);
  const fileName = previous.fileName || localConflictResolutionFileName(resolution, note.id);
  assert.ok(fileName, "本番と共通の解決情報から書込み先を決定できること");
  const savedNote = applyLocalSaveSuccess(note, savedAt);
  const markdown = serializeLocalNote(savedNote, savedNote.body, attachments);
  const writePath = `notes/${fileName}`;
  const currentMarkdown = await localFs.readText(root, resolution?.confirmedPath || writePath);
  if (resolution) {
    if (!localConflictResolutionMatches(resolution, {
      noteId: note.id,
      confirmedPath: resolution.confirmedPath,
      writePath,
      currentLocalHash: contentHash(currentMarkdown)
    })) throw Object.assign(new Error("競合解決後にローカルで変更されています"), { code: "conflict" });
  } else if (hasExternalModification(
    previous.hash,
    contentHash(currentMarkdown),
    contentHash(markdown),
    managedMarkdownComparableHash(currentMarkdown),
    managedMarkdownComparableHash(markdown)
  )) {
    throw Object.assign(new Error("外部変更"), { code: "conflict" });
  }
  await localFs.writeFile(root, writePath, markdown);
  if (failAfterMarkdown) throw new Error("sync-state書込み失敗");
  const nextSync = normalizeSyncState({
    ...syncState,
    savedAt,
    notes: {
      ...syncState.notes,
      [note.id]: { fileName, hash: contentHash(markdown), attachmentIds: attachments.map((attachment) => attachment.id) }
    }
  });
  await localFs.writeJson(root, "sync-state.json", nextSync);
  deleteLocalConflictResolution(resolutionMap, note.id, resolution);
  return { markdown, savedNote, syncState: nextSync };
}

test("タイトル日時と下部の文字数・ローカル・ブラウザを別情報として保持する", () => {
  assert.match(html, /class="title-content"[\s\S]*id="titleInput"[\s\S]*id="noteMeta" class="note-meta"[\s\S]*id="noteCreatedAt"[\s\S]*id="noteUpdatedAt"/);
  assert.match(html, /class="note-meta-actions"[\s\S]*id="noteFlagBtn"[\s\S]*id="textStatsBtn"[\s\S]*class="save-status-actions"[\s\S]*id="localSaveStatusBtn"[\s\S]*id="localSaveSuccessTime"[\s\S]*id="browserSaveStatusBtn"[\s\S]*id="browserSaveSuccessTime"/);
  assert.doesNotMatch(html.match(/<div class="note-meta-bar"[\s\S]*?<\/section>\s*<\/div>/)?.[0] || "", /id="noteMeta"/);
  assert.match(app, /const createdAt = resolveDisplayedCreatedAt\(note\)/);
  assert.match(app, /renderTimestamp\(noteCreatedAt, createdAt, formatNoteDateTime, "作成"\)/);
  assert.match(app, /renderTimestamp\(noteUpdatedAt, updatedAt, formatNoteDateTime, "更新"\)/);
  assert.match(app, /renderNoteMeta\([\s\S]*renderSaveStatus\(\)/);
  assert.match(app, /const combinedLabel = localNeedsAttention \? local\.label : browser\.label/);
  assert.match(app, /`保存状態 \$\{combinedLabel\}`/);
});

test("表示作成日時は有効なcreatedAtを優先し、欠損・不正時だけlocalCreatedAtへフォールバックする", () => {
  const createdAt = "2026-08-19T23:19:22.291Z";
  const localCreatedAt = "2026-08-19T23:25:00.000Z";
  assert.equal(resolveDisplayedCreatedAt({ createdAt, localCreatedAt }), createdAt);
  assert.equal(resolveDisplayedCreatedAt({ localCreatedAt }), localCreatedAt);
  assert.equal(resolveDisplayedCreatedAt({ createdAt: "invalid", localCreatedAt }), localCreatedAt);
  assert.equal(resolveDisplayedCreatedAt({ createdAt: "invalid", localCreatedAt: "also-invalid" }), null);
  assert.equal(resolveDisplayedCreatedAt({}), null);
});

test("初回ローカル保存後も表示作成日時はメモ本来のcreatedAtを維持する", () => {
  const original = { id: "n1", createdAt: "2026-08-19T23:19:22.291Z" };
  const saved = applyLocalSaveSuccess(original, "2026-08-19T23:25:00.000Z");

  assert.equal(saved.createdAt, original.createdAt);
  assert.equal(saved.localCreatedAt, "2026-08-19T23:25:00.000Z");
  assert.equal(resolveDisplayedCreatedAt(saved), original.createdAt);
  assert.equal(formatNoteDateTime(resolveDisplayedCreatedAt(saved), { timeZone: "Asia/Tokyo" }), "2026/8/20 08:19");
});

test("ローカル保存前後でcreatedAt基準の作成日順とMarkdown再取込後の表示日時を維持する", () => {
  const older = { id: "older", createdAt: "2026-08-19T22:00:00.000Z", body: "古いメモ" };
  const newer = { id: "newer", createdAt: "2026-08-19T23:19:22.291Z", body: "新しいメモ" };
  const before = [older, newer]
    .sort((left, right) => compareDateTimes(resolveDisplayedCreatedAt(left), resolveDisplayedCreatedAt(right), "desc"))
    .map((note) => note.id);
  const savedOlder = applyLocalSaveSuccess(older, "2026-08-20T00:30:00.000Z");
  const savedNewer = applyLocalSaveSuccess(newer, "2026-08-19T23:25:00.000Z");
  const after = [savedOlder, savedNewer]
    .sort((left, right) => compareDateTimes(resolveDisplayedCreatedAt(left), resolveDisplayedCreatedAt(right), "desc"))
    .map((note) => note.id);
  const parsed = parseLocalNote(serializeLocalNote(savedNewer, savedNewer.body));

  assert.deepEqual(before, ["newer", "older"]);
  assert.deepEqual(after, before);
  assert.equal(parsed.metadata.createdAt, newer.createdAt);
  assert.equal(parsed.metadata.localCreatedAt, savedNewer.localCreatedAt);
  assert.equal(resolveDisplayedCreatedAt(parsed.metadata), newer.createdAt);
});

test("localCreatedAtは初回ローカル保存成功時だけ設定し元のcreatedAtを維持する", () => {
  const original = { id: "n1", createdAt: "2026-08-01T00:00:00.000Z" };
  const first = applyLocalSaveSuccess(original, "2026-08-14T01:02:03.000Z");
  const second = applyLocalSaveSuccess(first, "2026-08-15T04:05:06.000Z");
  assert.equal(first.localCreatedAt, "2026-08-14T01:02:03.000Z");
  assert.equal(second.localCreatedAt, first.localCreatedAt);
  assert.equal(second.localSavedAt, "2026-08-15T04:05:06.000Z");
  assert.equal(second.createdAt, original.createdAt);
  assert.equal(original.localCreatedAt, undefined);
});

test("ローカル保存失敗状態はメモへlocalCreatedAtを捏造しない", () => {
  const note = { id: "n1", createdAt: 1 };
  const failed = transitionLocalSaveState(createLocalSaveState(), "error", { errorMessage: "disk full" }, 2);
  assert.equal(note.localCreatedAt, undefined);
  assert.equal(failed.status, "error");
  assert.equal(failed.requiresUserAction, true);
});

test("Markdownフロントマターと画像相対参照を往復する", () => {
  const note = {
    id: "note-1", title: "題名", collectionId: "c1", createdAt: "original", localCreatedAt: "local",
    updatedAt: "updated", bodyUpdatedAt: "body-updated", localSavedAt: "saved", isFlagged: true,
    deletedAt: null, sortOrder: 10, tags: [" Work ", "work", "資料", null, undefined], body: "前\n![図](attachment://asset-1)\n後"
  };
  const markdown = serializeLocalNote(note, note.body, [{ id: "asset-1", fileName: "asset-1.png" }]);
  assert.match(markdown, /^---\nmemoNexusId: "note-1"/);
  assert.match(markdown, /createdAt: "original"/);
  assert.match(markdown, /localCreatedAt: "local"/);
  assert.match(markdown, /!\[図\]\(\.\.\/assets\/asset-1\.png\)/);
  const parsed = parseLocalNote(markdown, { assets: [{ path: "../assets/asset-1.png", id: "asset-1" }] });
  assert.equal(parsed.metadata.memoNexusId, note.id);
  assert.equal(parsed.metadata.flagged, true);
  assert.deepEqual(parsed.metadata.tags, ["work", "資料"]);
  assert.equal(parsed.body, note.body);
});

test("タグなし旧Markdownは空のタグ配列として読み込む", () => {
  const parsed = parseLocalNote("---\nmemoNexusId: \"legacy\"\ntitle: \"旧形式\"\n---\n\n本文");
  assert.deepEqual(parsed.metadata.tags, []);
  assert.equal(parsed.body, "本文");
});

test("外部Markdownの作成日時は有効なcreatedAt、localCreatedAt、lastModified、取込日時の順で決める", () => {
  const createdAt = "2026-08-19T23:19:22.291Z";
  const localCreatedAt = "2026-08-19T23:25:00.000Z";
  assert.equal(resolveImportedCreatedAt({ localCreatedAt, createdAt }, 2, 3), createdAt);
  assert.equal(resolveImportedCreatedAt({ localCreatedAt }, 2, 3), localCreatedAt);
  assert.equal(resolveImportedCreatedAt({ createdAt: "invalid", localCreatedAt }, 2, 3), localCreatedAt);
  assert.equal(resolveImportedCreatedAt({}, 2, 3), new Date(2).toISOString());
  assert.equal(resolveImportedCreatedAt({}, 0, 3), new Date(3).toISOString());
});

test("コレクションツリーとmanifestを完全な管理情報として往復する", () => {
  const collections = [{ id: "root", name: "親", parentId: null, sortOrder: 10, isSystem: false, createdAt: "c", updatedAt: "u" }, { id: "child", name: "子", parentId: "root", sortOrder: 20, isSystem: false, createdAt: "c2", updatedAt: "u2" }];
  assert.deepEqual(parseCollections(serializeCollections(collections)), collections);
  assert.deepEqual(buildManifest({ appVersion: "0.5.0", savedAt: "now", notes: [{}, {}], collections, assetsCount: 3 }), {
    format: "memo-nexus-backup", version: 2, exportedAt: "now", formatVersion: 2,
    appVersion: "0.5.0", savedAt: "now", notesCount: 2, collectionsCount: 2, tagsCount: 0, assetsCount: 3
  });
});

test("画像形式に合う拡張子を使い同期状態へ対応を保持する", () => {
  assert.equal(attachmentExtension({ mimeType: "image/jpeg" }), "jpg");
  assert.equal(attachmentExtension({ blob: { type: "image/png" } }), "png");
  assert.deepEqual(normalizeSyncState({ assets: { a1: { fileName: "a1.png", memoId: "n1" } } }).assets.a1, { fileName: "a1.png", memoId: "n1" });
});

test("外部Markdownを新規・復元・同一・競合・重複へ分類する", () => {
  const notes = [{ id: "n1", title: "既存", body: "本文", tags: ["work"] }];
  assert.equal(classifyMarkdownCandidate({ metadata: {}, body: "新規" }, notes).type, "new");
  assert.equal(classifyMarkdownCandidate({ metadata: { memoNexusId: "missing", title: "復元" }, body: "本文" }, notes).type, "restore");
  assert.equal(classifyMarkdownCandidate({ metadata: { memoNexusId: "n1", title: "既存", tags: [" WORK "] }, body: "本文" }, notes).type, "unchanged");
  assert.equal(classifyMarkdownCandidate({ metadata: { memoNexusId: "n1", title: "既存", tags: ["別"] }, body: "本文" }, notes).type, "conflict");
  assert.equal(classifyMarkdownCandidate({ metadata: { memoNexusId: "n1", title: "既存", tags: ["work"] }, body: "外部変更" }, notes).type, "conflict");
  assert.equal(classifyMarkdownCandidate({ metadata: { title: "既存", tags: ["work"] }, body: "本文" }, notes).type, "duplicate");
});

test("最後に書いたハッシュと異なる外部変更を自動上書きしない", () => {
  const last = contentHash("last");
  assert.equal(hasExternalModification(last, contentHash("external"), contentHash("app")), true);
  assert.equal(hasExternalModification(last, last, contentHash("app")), false);
  assert.equal(hasExternalModification(last, null, contentHash("app")), false);
  assert.match(app, /hasExternalModification\(\s*previous\.hash,\s*currentHash,\s*hash,\s*currentComparableHash,\s*nextComparableHash\s*\)/);
  assert.match(app, /setLocalSaveState\("conflict"/);
});

test("管理対象Markdownはsync-stateのnote IDとfileNameで特定する", () => {
  assert.match(html, /local-save-state\.js\?v=0\.5\.0-5/);
  assert.match(html, /local-save-queue\.js\?v=0\.5\.0-3/);
  assert.match(html, /attachment-utils\.js\?v=0\.5\.0-12/);
  assert.match(html, /local-sync-utils\.js\?v=0\.5\.0-10/);
  assert.match(html, /backup-bundle-utils\.js\?v=0\.5\.0-5/);
  assert.match(html, /app\.js\?v=0\.5\.0-118/);
  const syncState = {
    notes: {
      "note-1": { fileName: "題名--note-1.md", hash: "last" },
      "note-2": { fileName: "別--note-2.md", hash: "other" }
    }
  };
  assert.deepEqual(managedNoteForPath(syncState, "notes/題名--note-1.md"), ["note-1", syncState.notes["note-1"]]);
  assert.equal(managedNoteForPath(syncState, "題名--note-1.md"), null);
  assert.equal(managedNoteForPath(syncState, "notes/未管理.md"), null);
});

test("管理対象Markdownは同一・アプリ最新版・アプリ側先行・外部変更を区別する", () => {
  assert.equal(classifyManagedMarkdownHashes("last", "last", "last"), "last-written");
  assert.equal(classifyManagedMarkdownHashes("last", "last", "next"), "app-ahead");
  assert.equal(classifyManagedMarkdownHashes("last", "next", "next"), "app-current");
  assert.equal(classifyManagedMarkdownHashes("last", "external", "next"), "conflict");
  assert.equal(classifyManagedMarkdownHashes("", "external", "next"), "unmanaged");
});

test("比較hashはfront matterのlocalSavedAtだけを除外する", () => {
  const note = {
    id: "note-1", title: "比較hash", collectionId: "c1", createdAt: "created",
    localCreatedAt: "local-created", updatedAt: "updated", bodyUpdatedAt: "body-updated",
    localSavedAt: "2026-08-14T07:00:00.000Z", isFlagged: true, deletedAt: null,
    sortOrder: 2, body: "本文\nlocalSavedAt: 本文中の行"
  };
  const first = serializeLocalNote(note);
  const nextTimeOnly = serializeLocalNote({ ...note, localSavedAt: "2026-08-14T07:01:00.000Z" });
  assert.notEqual(contentHash(first), contentHash(nextTimeOnly));
  assert.equal(managedMarkdownComparableHash(first), managedMarkdownComparableHash(nextTimeOnly));
  assert.notEqual(managedMarkdownComparableHash(first), managedMarkdownComparableHash(serializeLocalNote({ ...note, body: "外部編集" })));
  assert.notEqual(managedMarkdownComparableHash(first), managedMarkdownComparableHash(serializeLocalNote({ ...note, title: "外部で題名変更" })));
  assert.notEqual(managedMarkdownComparableHash(first), managedMarkdownComparableHash(first.replace("localSavedAt: 本文中の行", "localSavedAt: 本文中の外部変更")));
});

test("確認済みのMemo Nexus版上書きは保存前再スキャンを通過し、書込みとsync-state更新後に解決情報を消す", async () => {
  const selected = new MockDirectoryHandle("保存先");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const originalNote = {
    id: "note-1", title: "競合上書き", collectionId: "c1", createdAt: "created", localCreatedAt: "local-created",
    updatedAt: 1, bodyUpdatedAt: 1, localSavedAt: "2026-08-20T00:00:00.000Z", isFlagged: false, deletedAt: null, sortOrder: 0, body: "Memo Nexusの本文"
  };
  const fileName = "競合上書き--note-1.md";
  const lastMarkdown = serializeLocalNote({ ...originalNote, body: "前回保存した本文" });
  const externalMarkdown = serializeLocalNote({ ...originalNote, body: "ローカルで編集した本文" });
  const syncState = normalizeSyncState({
    savedAt: originalNote.localSavedAt,
    notes: { "note-1": { fileName, hash: contentHash(lastMarkdown), attachmentIds: [] } }
  });
  await localFs.writeFile(layout.root, `notes/${fileName}`, externalMarkdown);
  await localFs.writeJson(layout.root, "sync-state.json", syncState);

  const firstAnalysis = await scanMockWorkspaceAnalysis(selected, syncState, [originalNote]);
  assert.deepEqual(firstAnalysis.candidates.map((candidate) => candidate.classification.type), ["conflict"]);
  const resolutions = new Map([["note-1", resolutionForCandidate(firstAnalysis.candidates[0], "note-1", "app")]]);
  const events = [];
  let completed;
  const outcome = await runManualLocalSave({
    flushBrowserSave: async () => events.push("indexeddb"),
    waitForLocalSave: async () => events.push("wait"),
    scan: async () => {
      events.push("scan");
      return scanMockWorkspaceAnalysis(selected, syncState, [originalNote], resolutions);
    },
    hasBlockingCandidates: (analysis) => analysis.candidates.some((candidate) => ["restore", "conflict"].includes(candidate.classification.type)),
    requestLocalSave: () => events.push("request"),
    flushLocalSave: async () => {
      events.push("write");
      completed = await writeMockWorkspacePlan({
        root: layout.root, syncState, note: originalNote, resolutionMap: resolutions,
        savedAt: "2026-08-20T00:01:00.000Z"
      });
      return true;
    }
  });

  assert.equal(outcome.saved, true);
  assert.deepEqual(events, ["indexeddb", "wait", "scan", "request", "write"]);
  assert.notEqual(completed.markdown, externalMarkdown, "確認済みの生Markdownと再生成結果が異なっても保存できる");
  assert.equal(resolutions.size, 0, "sync-state更新まで成功した後だけ解決情報を削除する");
  const writtenSync = await localFs.readJson(layout.root, "sync-state.json", null);
  assert.equal(writtenSync.notes["note-1"].hash, contentHash(await localFs.readText(layout.root, `notes/${fileName}`)));
  assert.deepEqual(await scanMockWorkspace(selected, writtenSync, [completed.savedNote]), []);
});

test("ローカル版読込は画像参照と既存assetを保ったまま確認済み保存できる", async () => {
  const selected = new MockDirectoryHandle("画像保存先");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const attachment = { id: "asset-1", fileName: "asset-1.png" };
  const originalNote = {
    id: "note-1", title: "画像競合", collectionId: "c1", createdAt: "created", localCreatedAt: "local-created",
    updatedAt: 1, bodyUpdatedAt: 1, localSavedAt: "2026-08-20T00:00:00.000Z", isFlagged: false, deletedAt: null, sortOrder: 0,
    body: "Memo Nexus本文\n![画像](attachment://asset-1)"
  };
  const fileName = "画像競合--note-1.md";
  const lastMarkdown = serializeLocalNote({ ...originalNote, body: "前回本文\n![画像](attachment://asset-1)" }, undefined, [attachment]);
  const externalMarkdown = serializeLocalNote({ ...originalNote, body: "ローカル本文\n![画像](attachment://asset-1)" }, undefined, [attachment]);
  const syncState = normalizeSyncState({
    savedAt: originalNote.localSavedAt,
    notes: { "note-1": { fileName, hash: contentHash(lastMarkdown), attachmentIds: [attachment.id] } },
    assets: { "asset-1": { fileName: attachment.fileName, memoId: "note-1", mimeType: "image/png" } }
  });
  await localFs.writeFile(layout.root, `notes/${fileName}`, externalMarkdown);
  await localFs.writeFile(layout.root, `assets/${attachment.fileName}`, new Blob(["image-bytes"], { type: "image/png" }));
  const assetHandle = layout.root.directories.get("assets").files.get(attachment.fileName);
  const initialAssetWrites = assetHandle.writeCount;
  const candidate = (await scanMockWorkspaceAnalysis(selected, syncState, [originalNote])).candidates[0];
  assert.equal(candidate.classification.type, "conflict");
  assert.match(candidate.parsed.body, /attachment:\/\/asset-1/);
  const importedNote = { ...originalNote, body: candidate.parsed.body, updatedAt: 2, bodyUpdatedAt: 2 };
  const resolutions = new Map([["note-1", resolutionForCandidate(candidate, "note-1", "local")]]);
  assert.deepEqual(await scanMockWorkspace(selected, syncState, [importedNote], resolutions), []);

  const completed = await writeMockWorkspacePlan({
    root: layout.root, syncState, note: importedNote, resolutionMap: resolutions,
    savedAt: "2026-08-20T00:02:00.000Z", attachments: [attachment]
  });
  assert.match(completed.markdown, /\.\.\/assets\/asset-1\.png/);
  assert.match(parseLocalNote(completed.markdown, { assets: [{ path: "../assets/asset-1.png", id: "asset-1" }] }).body, /attachment:\/\/asset-1/);
  assert.equal(assetHandle.writeCount, initialAssetWrites, "既存画像を重複作成・削除しない");
  assert.equal(await (await assetHandle.getFile()).text(), "image-bytes");
  assert.equal(resolutions.size, 0);
  assert.deepEqual(await scanMockWorkspace(selected, completed.syncState, [completed.savedNote]), []);
});

test("画像付き競合を両方残すと元添付を奪わず別IDへ複製する", async () => {
  const selected = new MockDirectoryHandle("画像付き両方保存");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const originalNote = {
    id: "original-note", title: "画像競合", body: "Memo Nexus本文\n![画像](attachment://asset-1)", tags: []
  };
  const duplicateNote = { id: "local-copy", title: "画像競合", body: "", tags: [] };
  const imageBlob = new Blob(["image-bytes"], { type: "image/png" });
  const originalAttachment = {
    id: "asset-1", memoId: originalNote.id, fileName: "asset-1.png", mimeType: "image/png",
    kind: "image", size: imageBlob.size, blob: imageBlob, createdAt: "2026-08-20T00:00:00.000Z"
  };
  const attachmentStore = createMockAttachmentStore([originalAttachment]);
  const previousMarkdown = serializeLocalNote({ ...originalNote, body: "前回本文\n![画像](attachment://asset-1)" }, undefined, [
    { id: "asset-1", fileName: "asset-1.png" }
  ]);
  const externalMarkdown = serializeLocalNote({ ...originalNote, body: "ローカル本文\n![画像](attachment://asset-1)" }, undefined, [
    { id: "asset-1", fileName: "asset-1.png" }
  ]);
  const syncState = normalizeSyncState({
    notes: {
      [originalNote.id]: { fileName: "original.md", hash: contentHash(previousMarkdown), attachmentIds: [originalAttachment.id] }
    },
    assets: {
      [originalAttachment.id]: { fileName: "asset-1.png", memoId: originalNote.id, mimeType: "image/png" }
    }
  });
  await localFs.writeFile(layout.root, "assets/asset-1.png", imageBlob);
  await localFs.writeFile(layout.root, "notes/original.md", externalMarkdown);
  const candidate = (await scanMockWorkspaceAnalysis(selected, syncState, [originalNote])).candidates[0];
  assert.equal(candidate.classification.type, "conflict");
  assert.match(candidate.parsed.body, /attachment:\/\/asset-1/);
  const persistence = mockAttachmentPersistence(attachmentStore);
  const candidateAttachments = loadAppFunction("candidateAttachments", {
    localFs,
    localDirectoryHandle: selected,
    localSyncState: syncState,
    crypto: { randomUUID: () => "asset-copy-1" },
    localMimeType: (fileName, fallback = "") => fallback || (fileName.endsWith(".png") ? "image/png" : "application/octet-stream"),
    getAttachmentRecord: persistence.getAttachmentRecord,
    resolveImportedAttachmentId
  }, { async: true });

  const imported = await candidateAttachments(candidate, duplicateNote.id);
  await persistence.putAttachments(imported.records);
  duplicateNote.body = remapImportedAttachmentReferences(
    restoreAttachmentReferences(candidate.parsed.body, imported.assets),
    imported.assets
  );

  assert.equal(attachmentStore.records.size, 2, "主キーが異なる新旧レコードを保持する");
  assert.equal(persistence.pendingMarks(), 1);
  assert.equal(attachmentStore.get("asset-1").memoId, originalNote.id);
  assert.equal(attachmentStore.get("asset-copy-1").memoId, duplicateNote.id);
  assert.match(originalNote.body, /attachment:\/\/asset-1/);
  assert.match(duplicateNote.body, /attachment:\/\/asset-copy-1/);
  assert.equal(await attachmentStore.get("asset-1").blob.text(), "image-bytes");
  assert.equal(await attachmentStore.get("asset-copy-1").blob.text(), "image-bytes");

  const originalAssetFileName = syncState.assets[originalAttachment.id].fileName;
  const copiedAssetFileName = "asset-copy-1.png";
  const originalWrittenMarkdown = serializeLocalNote(originalNote, originalNote.body, [
    { id: originalAttachment.id, fileName: originalAssetFileName }
  ]);
  const copyWrittenMarkdown = serializeLocalNote(duplicateNote, duplicateNote.body, [
    { id: "asset-copy-1", fileName: copiedAssetFileName }
  ]);
  await localFs.writeFile(layout.root, "notes/original.md", originalWrittenMarkdown);
  await localFs.writeFile(layout.root, "notes/local-copy.md", copyWrittenMarkdown);
  await localFs.writeFile(layout.root, `assets/${copiedAssetFileName}`, attachmentStore.get("asset-copy-1").blob);
  const nextSync = normalizeSyncState({
    notes: {
      [originalNote.id]: { fileName: "original.md", hash: contentHash(originalWrittenMarkdown), attachmentIds: [originalAttachment.id] },
      [duplicateNote.id]: { fileName: "local-copy.md", hash: contentHash(copyWrittenMarkdown), attachmentIds: ["asset-copy-1"] }
    },
    assets: {
      [originalAttachment.id]: { fileName: originalAssetFileName, memoId: originalNote.id, mimeType: "image/png" },
      "asset-copy-1": { fileName: copiedAssetFileName, memoId: duplicateNote.id, mimeType: "image/png" }
    }
  });
  await localFs.writeJson(layout.root, "sync-state.json", nextSync);

  assert.notEqual(originalAssetFileName, copiedAssetFileName);
  assert.match(await localFs.readText(layout.root, "notes/original.md"), /\.\.\/assets\/asset-1\.png/);
  assert.match(await localFs.readText(layout.root, "notes/local-copy.md"), /\.\.\/assets\/asset-copy-1\.png/);
  assert.deepEqual(nextSync.notes[originalNote.id].attachmentIds, ["asset-1"]);
  assert.deepEqual(nextSync.notes[duplicateNote.id].attachmentIds, ["asset-copy-1"]);
  assert.equal(nextSync.assets["asset-1"].memoId, originalNote.id);
  assert.equal(nextSync.assets["asset-copy-1"].memoId, duplicateNote.id);
  assert.equal(await layout.root.directories.get("assets").files.get("asset-1.png").value.text(), "image-bytes");
  assert.equal(await layout.root.directories.get("assets").files.get("asset-copy-1.png").value.text(), "image-bytes");
  assert.equal(attachmentStore.getAllForMemo(originalNote.id).length, 1);
  assert.equal(attachmentStore.getAllForMemo(duplicateNote.id).length, 1);
  assert.deepEqual(await scanMockWorkspace(selected, nextSync, [originalNote, duplicateNote]), []);
});

test("ローカル版読込は同じメモ所有の既存添付IDを複製しない", async () => {
  const selected = new MockDirectoryHandle("画像付きローカル版読込");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const imageBlob = new Blob(["same-image"], { type: "image/png" });
  const existing = {
    id: "asset-1", memoId: "original-note", fileName: "asset-1.png", mimeType: "image/png",
    kind: "image", size: imageBlob.size, blob: imageBlob, createdAt: "2026-08-20T00:00:00.000Z"
  };
  const attachmentStore = createMockAttachmentStore([existing]);
  const persistence = mockAttachmentPersistence(attachmentStore);
  const syncState = normalizeSyncState({
    assets: { "asset-1": { fileName: "asset-1.png", memoId: "original-note", mimeType: "image/png" } }
  });
  await localFs.writeFile(layout.root, "assets/asset-1.png", imageBlob);
  const candidateAttachments = loadAppFunction("candidateAttachments", {
    localFs,
    localDirectoryHandle: selected,
    localSyncState: syncState,
    crypto: { randomUUID: () => "unnecessary-copy" },
    localMimeType: () => "image/png",
    getAttachmentRecord: persistence.getAttachmentRecord,
    resolveImportedAttachmentId
  }, { async: true });
  const imported = await candidateAttachments({
    parsed: { assetPaths: ["../assets/asset-1.png"] }
  }, "original-note");
  await persistence.putAttachments(imported.records);
  assert.deepEqual(imported.assets, [{ path: "../assets/asset-1.png", id: "asset-1", sourceId: "asset-1" }]);
  assert.equal(attachmentStore.records.size, 1);
  assert.equal(attachmentStore.get("asset-1").memoId, "original-note");
  assert.equal(persistence.pendingMarks(), 1);
});

test("確認後に同じファイルを再編集すると解決情報を無効化し、別メモの競合は引き続き保存を止める", async () => {
  const selected = new MockDirectoryHandle("再競合");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const notes = ["note-1", "note-2"].map((id) => ({
    id, title: id, collectionId: "c1", createdAt: "created", localCreatedAt: "local", updatedAt: 1, bodyUpdatedAt: 1,
    localSavedAt: "2026-08-20T00:00:00.000Z", isFlagged: false, deletedAt: null, sortOrder: 0, body: `${id}のMemo Nexus本文`
  }));
  const syncState = normalizeSyncState({ notes: {} });
  for (const note of notes) {
    const fileName = `${note.id}.md`;
    const lastMarkdown = serializeLocalNote({ ...note, body: `${note.id}の前回本文` });
    syncState.notes[note.id] = { fileName, hash: contentHash(lastMarkdown), attachmentIds: [] };
    await localFs.writeFile(layout.root, `notes/${fileName}`, serializeLocalNote({ ...note, body: `${note.id}の最初の外部変更` }));
  }
  const first = await scanMockWorkspaceAnalysis(selected, syncState, notes);
  const note1Candidate = first.candidates.find((candidate) => candidate.classification.existing.id === "note-1");
  const resolutions = new Map([["note-1", resolutionForCandidate(note1Candidate, "note-1", "app")]]);
  const whileConfirmed = await scanMockWorkspaceAnalysis(selected, syncState, notes, resolutions);
  assert.deepEqual(whileConfirmed.candidates.map((candidate) => candidate.classification.existing.id), ["note-2"]);
  assert.deepEqual(whileConfirmed.resolvedConflictNoteIds, ["note-1"]);

  await localFs.writeFile(layout.root, "notes/note-1.md", serializeLocalNote({ ...notes[0], body: "note-1の二度目の外部変更" }));
  const changedAgain = await scanMockWorkspaceAnalysis(selected, syncState, notes, resolutions);
  assert.deepEqual(new Set(changedAgain.candidates.map((candidate) => candidate.classification.existing.id)), new Set(["note-1", "note-2"]));
  assert.deepEqual(changedAgain.invalidatedResolutionNoteIds, ["note-1"]);
  changedAgain.invalidatedResolutionNoteIds.forEach((noteId) => resolutions.delete(noteId));
  assert.equal(resolutions.size, 0);
});

test("sync-state更新に失敗した場合は確認済み解決情報を捨てず、同期済みにしない", async () => {
  const selected = new MockDirectoryHandle("失敗確認");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const note = {
    id: "note-1", title: "失敗確認", collectionId: "c1", createdAt: "created", localCreatedAt: "local", updatedAt: 1, bodyUpdatedAt: 1,
    localSavedAt: "2026-08-20T00:00:00.000Z", isFlagged: false, deletedAt: null, sortOrder: 0, body: "Memo Nexus本文"
  };
  const fileName = "失敗確認--note-1.md";
  const lastMarkdown = serializeLocalNote({ ...note, body: "前回本文" });
  const syncState = normalizeSyncState({ notes: { "note-1": { fileName, hash: contentHash(lastMarkdown), attachmentIds: [] } } });
  await localFs.writeFile(layout.root, `notes/${fileName}`, serializeLocalNote({ ...note, body: "外部変更" }));
  await localFs.writeJson(layout.root, "sync-state.json", syncState);
  const candidate = (await scanMockWorkspaceAnalysis(selected, syncState, [note])).candidates[0];
  const resolutions = new Map([["note-1", resolutionForCandidate(candidate, "note-1", "app")]]);
  await assert.rejects(writeMockWorkspacePlan({
    root: layout.root, syncState, note, resolutionMap: resolutions,
    savedAt: "2026-08-20T00:03:00.000Z", failAfterMarkdown: true
  }), /sync-state書込み失敗/);
  assert.equal(resolutions.get("note-1")?.confirmedLocalHash, candidate.classification.currentLocalHash);
  assert.equal((await localFs.readJson(layout.root, "sync-state.json", null)).notes["note-1"].hash, contentHash(lastMarkdown));
});

test("Markdown書込み後の途中失敗はlocalSavedAtが変わる再試行でも競合にしない", async () => {
  const selected = new MockDirectoryHandle("保存先");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const initialSavedAt = "2026-08-14T08:00:00.000Z";
  const failedSavedAt = "2026-08-14T08:01:00.000Z";
  const retriedSavedAt = "2026-08-14T08:02:00.000Z";
  const originalNote = {
    id: "note-1", title: "途中失敗", collectionId: "c1", createdAt: "created",
    localCreatedAt: "local-created", updatedAt: 1, bodyUpdatedAt: 1,
    localSavedAt: initialSavedAt, isFlagged: false, deletedAt: null, sortOrder: 0, body: "初回本文"
  };
  const fileName = "途中失敗--note-1.md";
  const originalMarkdown = serializeLocalNote(originalNote);
  let syncState = normalizeSyncState({
    savedAt: initialSavedAt,
    notes: { "note-1": { fileName, hash: contentHash(originalMarkdown), attachmentIds: [] } }
  });
  await localFs.writeFile(layout.root, `notes/${fileName}`, originalMarkdown);
  await localFs.writeJson(layout.root, "sync-state.json", syncState);
  const editedNote = { ...originalNote, body: "編集後の本文", updatedAt: 2, bodyUpdatedAt: 2 };
  let persistedNote = editedNote;
  let state = transitionLocalSaveState(createLocalSaveState({ status: "saved", lastSuccessAt: initialSavedAt }), "pending", {}, 2);
  let attempt = 0;
  const queue = createLocalSaveQueue(async () => {
    attempt += 1;
    state = transitionLocalSaveState(state, "saving", {}, attempt + 2);
    const savedAt = attempt === 1 ? failedSavedAt : retriedSavedAt;
    const savedNote = applyLocalSaveSuccess(editedNote, savedAt);
    const markdown = serializeLocalNote(savedNote);
    const currentMarkdown = await localFs.readText(layout.root, `notes/${fileName}`);
    const conflict = hasExternalModification(
      syncState.notes["note-1"].hash,
      contentHash(currentMarkdown),
      contentHash(markdown),
      managedMarkdownComparableHash(currentMarkdown),
      managedMarkdownComparableHash(markdown)
    );
    if (conflict) {
      state = transitionLocalSaveState(state, "conflict", { errorCode: "external-conflict" }, attempt + 3);
      throw Object.assign(new Error("外部変更"), { code: "conflict" });
    }
    await localFs.writeFile(layout.root, `notes/${fileName}`, markdown);
    if (attempt === 1) {
      state = transitionLocalSaveState(state, "error", { errorCode: "write", errorMessage: "添付書込み失敗" }, 4);
      throw new Error("添付書込み失敗");
    }
    syncState = normalizeSyncState({
      savedAt,
      notes: { "note-1": { fileName, hash: contentHash(markdown), attachmentIds: [] } }
    });
    await localFs.writeJson(layout.root, "sync-state.json", syncState);
    persistedNote = savedNote;
    state = transitionLocalSaveState(state, "saved", { lastSuccessAt: savedAt }, 5);
  }, 1);

  await assert.rejects(queue.enqueue("partial-failure"), /添付書込み失敗/);
  assert.equal(state.status, "error");
  assert.equal((await localFs.readJson(layout.root, "sync-state.json", null)).notes["note-1"].hash, contentHash(originalMarkdown));
  const partialMarkdown = await localFs.readText(layout.root, `notes/${fileName}`);
  assert.match(partialMarkdown, /編集後の本文/);
  assert.match(partialMarkdown, new RegExp(failedSavedAt.replace(/[.]/g, "\\.")));
  const partialAnalysis = await scanMockWorkspaceAnalysis(selected, syncState, [editedNote]);
  assert.deepEqual(partialAnalysis.candidates, []);
  assert.deepEqual(partialAnalysis.appAheadNoteIds, ["note-1"]);
  assert.equal(partialAnalysis.needsLocalSave, true);

  await queue.enqueue("retry-after-partial");
  const completedMarkdown = await localFs.readText(layout.root, `notes/${fileName}`);
  const completedSync = await localFs.readJson(layout.root, "sync-state.json", null);
  assert.equal(attempt, 2);
  assert.equal(state.status, "saved");
  assert.equal(state.lastSuccessAt, retriedSavedAt);
  assert.equal(persistedNote.localSavedAt, retriedSavedAt);
  assert.equal(persistedNote.createdAt, originalNote.createdAt);
  assert.equal(persistedNote.localCreatedAt, originalNote.localCreatedAt);
  assert.equal(completedSync.savedAt, retriedSavedAt);
  assert.equal(completedSync.notes["note-1"].hash, contentHash(completedMarkdown));
});

test("途中失敗後に本文が外部編集された場合は再試行で競合として保護する", async () => {
  const selected = new MockDirectoryHandle("保存先");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const originalNote = {
    id: "note-1", title: "外部編集保護", createdAt: "created", localCreatedAt: "local-created",
    localSavedAt: "2026-08-14T09:00:00.000Z", body: "初回本文"
  };
  const fileName = "外部編集保護--note-1.md";
  const originalMarkdown = serializeLocalNote(originalNote);
  const lastWrittenHash = contentHash(originalMarkdown);
  await localFs.writeFile(layout.root, `notes/${fileName}`, originalMarkdown);
  const syncState = normalizeSyncState({
    savedAt: originalNote.localSavedAt,
    notes: { "note-1": { fileName, hash: lastWrittenHash, attachmentIds: [] } }
  });
  await localFs.writeJson(layout.root, "sync-state.json", syncState);
  const editedNote = { ...originalNote, body: "Memo-Nexus側の本文" };
  let state = createLocalSaveState({ status: "pending", lastSuccessAt: originalNote.localSavedAt, pendingChanges: true });
  let attempt = 0;
  const queue = createLocalSaveQueue(async () => {
    attempt += 1;
    const savedAt = attempt === 1 ? "2026-08-14T09:01:00.000Z" : "2026-08-14T09:02:00.000Z";
    const nextMarkdown = serializeLocalNote(applyLocalSaveSuccess(editedNote, savedAt));
    const currentMarkdown = await localFs.readText(layout.root, `notes/${fileName}`);
    if (hasExternalModification(
      lastWrittenHash,
      contentHash(currentMarkdown),
      contentHash(nextMarkdown),
      managedMarkdownComparableHash(currentMarkdown),
      managedMarkdownComparableHash(nextMarkdown)
    )) {
      state = transitionLocalSaveState(state, "conflict", { errorCode: "external-conflict" }, 4);
      throw Object.assign(new Error("外部変更"), { code: "conflict" });
    }
    await localFs.writeFile(layout.root, `notes/${fileName}`, nextMarkdown);
    state = transitionLocalSaveState(state, "error", { errorCode: "write" }, 3);
    throw new Error("sync-state前で失敗");
  }, 1);

  await assert.rejects(queue.enqueue("partial-failure"), /sync-state前で失敗/);
  const partialFile = layout.root.directories.get("notes").files.get(fileName);
  partialFile.value = partialFile.value.replace("Memo-Nexus側の本文", "外部エディタで変更した本文");
  const externalMarkdown = partialFile.value;
  const externalAnalysis = await scanMockWorkspaceAnalysis(selected, syncState, [editedNote]);
  assert.deepEqual(externalAnalysis.candidates.map((candidate) => candidate.classification.type), ["conflict"]);
  await assert.rejects(queue.enqueue("retry-after-external-edit"), (error) => error.code === "conflict");
  assert.equal(attempt, 2);
  assert.equal(state.status, "conflict");
  assert.equal(state.errorCode, "external-conflict");
  assert.equal(await localFs.readText(layout.root, `notes/${fileName}`), externalMarkdown);
});

test("初回フォルダ選択は保存先だけを記録し、ローカルファイルを作成しない", async () => {
  const selectFlow = extractFunction(app, "selectLocalSaveFolder");
  const selected = new MockDirectoryHandle("新規保存先");
  assert.doesNotMatch(selectFlow, /scanExternalLocalMarkdown|queueLocalWorkspaceSave|ensureWorkspaceLayout/);
  assert.match(selectFlow, /setLocalSaveState\("pending"/);
  assert.match(selectFlow, /「ローカルへ保存」を押すまでファイルは変更しません/);
  assert.equal(selected.directories.size, 0);
  assert.equal(selected.files.size, 0);
});

test("初回フォルダ選択の復元候補は保存せず既存Markdownを維持する", async () => {
  const selected = new MockDirectoryHandle("既存保存先");
  const existingMarkdown = "---\nmemoNexusId: \"missing-note\"\ntitle: \"復元候補\"\n---\n既存本文";
  selected.files.set("復元候補.md", new MockFileHandle("復元候補.md", existingMarkdown));
  const existingFile = selected.files.get("復元候補.md");
  const analysis = await scanMockWorkspaceAnalysis(selected, normalizeSyncState(), []);
  let state = applyScanState(createLocalSaveState({ status: "pending", pendingChanges: true }), analysis.candidates, 2);
  let saveCount = 0;
  const hasBlockingCandidate = analysis.candidates.some((candidate) => ["restore", "conflict"].includes(candidate.classification.type));
  const outcome = await runManualLocalSave({
    flushBrowserSave: async () => {},
    waitForLocalSave: async () => {},
    scan: async () => analysis,
    hasBlockingCandidates: () => hasBlockingCandidate,
    requestLocalSave: () => { saveCount += 1; },
    flushLocalSave: async () => true
  });

  assert.equal(hasBlockingCandidate, true);
  assert.equal(outcome.blocked, true);
  assert.deepEqual(analysis.candidates.map((candidate) => candidate.classification.type), ["restore"]);
  assert.equal(saveCount, 0);
  assert.equal(existingFile.writeCount, 0);
  assert.equal(await existingFile.getFile().then((file) => file.text()), existingMarkdown);
  assert.equal(state.status, "conflict");
  assert.equal(state.errorCode, "restore-candidate");
});

test("再接続は権限だけを回復し、走査も保存も自動実行しない", () => {
  const reconnectFlow = extractFunction(app, "reconnectLocalSaveFolder");
  assert.match(reconnectFlow, /requestPermission\(localDirectoryHandle, "readwrite"\)/);
  assert.doesNotMatch(reconnectFlow, /scanExternalLocalMarkdown|queueLocalWorkspaceSave|localSaveQueue\.flush|ensureWorkspaceLayout/);
  assert.match(reconnectFlow, /外部変更の確認または保存は、対応するボタンを押したときに実行します/);
});

test("ローカル保存失敗は権限・外部競合・一般エラーを区別する", async () => {
  for (const name of ["NotAllowedError", "SecurityError"]) {
    const failure = classifyLocalSaveFailure(Object.assign(new Error(name), { name }));
    assert.equal(failure.status, "permission-required");
    assert.equal(failure.errorCode, "permission");
  }
  assert.equal(classifyLocalSaveFailure(Object.assign(new Error("拒否"), { code: "permission" })).status, "permission-required");
  const conflict = classifyLocalSaveFailure(Object.assign(new Error("外部変更"), { code: "conflict" }));
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.errorCode, "external-conflict");
  assert.equal(classifyLocalSaveFailure(new Error("disk full")).status, "error");

  let deniedSaveCount = 0;
  const denied = await runLocalReconnectSequence({
    requestPermission: async () => "denied",
    scan: async () => { throw new Error("走査してはいけません"); },
    shouldSave: () => true,
    save: async () => { deniedSaveCount += 1; }
  });
  assert.equal(denied.permission, "denied");
  assert.equal(denied.saveAttempted, false);
  assert.equal(deniedSaveCount, 0);

  await assert.rejects(runLocalReconnectSequence({
    requestPermission: async () => "granted",
    scan: async () => ({ candidates: [], needsLocalSave: true }),
    shouldSave: () => true,
    save: async () => { throw Object.assign(new Error("外部変更"), { code: "conflict" }); }
  }), (error) => error.code === "conflict" && error.localSaveStage === "save");
});

test("本番ローカル保存は固定snapshotとrevision境界を使い、失敗時は保存中を解除する", () => {
  const source = extractFunction(app, "performLocalWorkspaceSave");
  const metadataSource = extractFunction(app, "applyLocalSaveMetadata");
  const liveIndexSource = extractFunction(app, "buildLocalSaveLiveNoteIndex");
  const boundarySource = extractFunction(app, "localSaveBoundaryChanged");
  const savingIndex = source.indexOf('setLocalSaveState("saving"');
  const metadataBatchIndex = source.indexOf("await applyLocalSaveMetadata");
  const savedIndex = source.indexOf('setLocalSaveState(changedDuringSave ? "pending" : "saved"');
  const failureIndex = source.indexOf("const failure = classifyLocalSaveFailure(error)");

  assert.ok(savingIndex >= 0 && savingIndex < metadataBatchIndex);
  assert.ok(metadataBatchIndex < savedIndex);
  assert.ok(savedIndex < failureIndex);
  assert.match(source, /getAllNotes\(\)\)\.map\(cloneNoteSnapshot\)/);
  assert.match(source, /startRevision: normalizeNoteRevision\(note\.revision\)/);
  assert.match(source, /localSaveBoundaryChanged\(plans, metadataResult\.expectedRevisionsAfterMetadata, metadataResult\.liveNotesById\)/);
  assert.match(source, /setLocalSaveState\(failure\.status/);
  assert.match(metadataSource, /captureCurrentDraft: false/);
  assert.match(metadataSource, /clearScheduledSaves: false/);
  assert.match(metadataSource, /applyCommittedChangesWhenDirty: false/);
  assert.match(metadataSource, /allowedChangedFields: \["localCreatedAt", "localSavedAt"\]/);
  assert.match(metadataSource, /invalidateTermRelations: false/);
  assert.match(metadataSource, /markLocalPending: false/);
  assert.match(metadataSource, /const liveNotesById = liveNoteIndexFactory\(\)/);
  assert.match(metadataSource, /liveNotesById,/);
  assert.doesNotMatch(metadataSource, /noteForSave/);
  assert.match(liveIndexSource, /const liveNotesById = new Map\(\)/);
  assert.match(liveIndexSource, /notes\.forEach/);
  assert.match(liveIndexSource, /noteLiveDrafts\.forEach/);
  assert.match(boundarySource, /liveNotesById\.get\(plan\.note\.id\)/);
  assert.doesNotMatch(boundarySource, /noteForSave/);
  assert.match(app, /function updateNotesTransaction\(items, \{ markLocalPending = true, preserveStoredCodexThread = false \} = \{\}\)[\s\S]*if \(markLocalPending\) markLocalWorkspacePending\(\)/);
  assert.match(metadataSource, /preserveStoredCodexThread: true/);
  assert.doesNotMatch(source, /suppressLocalSaveQueue = true/);
});

test("起動時はローカルMarkdownを走査・書込みせず保存状態だけを復元する", async () => {
  const initializeFlow = extractFunction(app, "initializeLocalFolderSaving");
  assert.doesNotMatch(initializeFlow, /scanExternalLocalMarkdown|queueLocalWorkspaceSave|ensureWorkspaceLayout|writeFile|writeJson/);
  assert.match(initializeFlow, /queryPermission\(localDirectoryHandle, "readwrite"\)/);
  const selected = new MockDirectoryHandle("保存先");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const originalNote = { id: "note-1", title: "起動時確認", createdAt: "created", body: "保存済み本文" };
  const originalMarkdown = serializeLocalNote(originalNote);
  await localFs.writeFile(layout.root, "notes/起動時確認--note-1.md", originalMarkdown);
  const managedFile = layout.root.directories.get("notes").files.get("起動時確認--note-1.md");
  const baselineWriteCount = managedFile.writeCount;
  const baselineModified = managedFile.lastModified;
  await Promise.resolve();
  assert.equal(managedFile.writeCount, baselineWriteCount);
  assert.equal(managedFile.lastModified, baselineModified);
  assert.equal(await localFs.readText(layout.root, "notes/起動時確認--note-1.md"), originalMarkdown);
});

test("IndexedDB側の編集ではローカルを書かず、明示保存だけがMarkdownとsync-stateを更新する", async () => {
  const manualFlow = extractFunction(app, "saveLocalWorkspaceNow");
  assert.ok(manualFlow.indexOf("flushBrowserSave: flushSave") < manualFlow.indexOf("scan: () => scanExternalLocalMarkdown"));
  assert.ok(manualFlow.indexOf("scan: () => scanExternalLocalMarkdown") < manualFlow.indexOf("requestLocalSave: () => queueLocalWorkspaceSave(reason)"));
  const selected = new MockDirectoryHandle("保存先");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const originalNote = {
    id: "note-1", title: "回帰テスト", collectionId: "c1", createdAt: "2026-08-01T00:00:00.000Z",
    localCreatedAt: "2026-08-14T00:00:00.000Z", updatedAt: 1, bodyUpdatedAt: 1,
    localSavedAt: "2026-08-14T00:00:00.000Z", isFlagged: false, deletedAt: null, sortOrder: 0, body: "初回本文"
  };
  const originalMarkdown = serializeLocalNote(originalNote);
  const originalHash = contentHash(originalMarkdown);
  await localFs.writeFile(layout.root, "notes/回帰テスト--note-1.md", originalMarkdown);
  await localFs.writeJson(layout.root, "sync-state.json", {
    formatVersion: 1,
    savedAt: originalNote.localSavedAt,
    notes: { "note-1": { fileName: "回帰テスト--note-1.md", hash: originalHash, attachmentIds: [] } },
    assets: {},
    excluded: []
  });

  const editedNote = { ...originalNote, body: "Memo-Nexusで編集した本文", updatedAt: 2, bodyUpdatedAt: 2 };
  const nextMarkdown = serializeLocalNote(editedNote);
  const nextHash = contentHash(nextMarkdown);
  const managedFile = layout.root.directories.get("notes").files.get("回帰テスト--note-1.md");
  const beforeManualWriteCount = managedFile.writeCount;
  const beforeSaveCandidates = await scanMockWorkspace(selected, {
    formatVersion: 1,
    savedAt: originalNote.localSavedAt,
    notes: { "note-1": { fileName: "回帰テスト--note-1.md", hash: originalHash, attachmentIds: [] } },
    assets: {}, excluded: []
  }, [editedNote]);
  assert.deepEqual(beforeSaveCandidates, []);
  assert.equal(managedFile.writeCount, beforeManualWriteCount);
  assert.equal(await localFs.readText(layout.root, "notes/回帰テスト--note-1.md"), originalMarkdown);

  let state = transitionLocalSaveState(createLocalSaveState({ status: "saved", lastSuccessAt: originalNote.localSavedAt }), "pending", {}, 2);
  const queue = createLocalSaveQueue(async () => {
    state = transitionLocalSaveState(state, "saving", {}, 3);
    await localFs.writeFile(layout.root, "notes/回帰テスト--note-1.md", nextMarkdown);
    await localFs.writeJson(layout.root, "sync-state.json", {
      formatVersion: 1,
      savedAt: "2026-08-14T00:01:00.000Z",
      notes: { "note-1": { fileName: "回帰テスト--note-1.md", hash: nextHash, attachmentIds: [] } },
      assets: {},
      excluded: []
    });
    state = transitionLocalSaveState(state, "saved", { lastSuccessAt: "2026-08-14T00:01:00.000Z" }, 4);
  }, 1);
  const events = [];
  const outcome = await runManualLocalSave({
    flushBrowserSave: async () => events.push("indexeddb"),
    waitForLocalSave: async () => events.push("wait-local"),
    scan: async () => { events.push("scan"); return { candidates: [] }; },
    hasBlockingCandidates: (analysis) => analysis.candidates.length > 0,
    requestLocalSave: () => { events.push("request-write"); queue.enqueue("manual"); },
    flushLocalSave: async () => { events.push("write"); return queue.flush("manual"); }
  });

  assert.equal(outcome.saved, true);
  assert.deepEqual(events, ["indexeddb", "wait-local", "scan", "request-write", "write"]);
  assert.equal(await localFs.readText(layout.root, "notes/回帰テスト--note-1.md"), nextMarkdown);
  const updatedSync = await localFs.readJson(layout.root, "sync-state.json", null);
  assert.equal(updatedSync.notes["note-1"].hash, nextHash);
  assert.equal(updatedSync.savedAt, "2026-08-14T00:01:00.000Z");
  assert.deepEqual(await scanMockWorkspace(selected, updatedSync, [editedNote]), []);
  assert.equal(state.status, "saved");
  assert.equal(state.requiresUserAction, false);
  assert.equal(editedNote.createdAt, originalNote.createdAt);
  assert.equal(editedNote.localCreatedAt, originalNote.localCreatedAt);
});

test("外部編集の再スキャンは即時に確認が必要となり、元へ戻すと保存済みへ戻る", async () => {
  const selected = new MockDirectoryHandle("保存先");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const note = {
    id: "note-1", title: "外部変更", collectionId: "c1", createdAt: "original-created",
    localCreatedAt: "local-created", updatedAt: 1, bodyUpdatedAt: 1,
    localSavedAt: "2026-08-14T01:00:00.000Z", isFlagged: false, deletedAt: null, sortOrder: 0, body: "保存済み本文"
  };
  const savedMarkdown = serializeLocalNote(note);
  const syncState = {
    formatVersion: 1,
    savedAt: note.localSavedAt,
    notes: { "note-1": { fileName: "外部変更--note-1.md", hash: contentHash(savedMarkdown), attachmentIds: [] } },
    assets: {}, excluded: []
  };
  await localFs.writeFile(layout.root, "notes/外部変更--note-1.md", savedMarkdown);
  await localFs.writeJson(layout.root, "sync-state.json", syncState);
  const managedFile = layout.root.directories.get("notes").files.get("外部変更--note-1.md");
  managedFile.value = savedMarkdown.replace("保存済み本文", "外部エディタの本文");

  const externalCandidates = await scanMockWorkspace(selected, syncState, [note]);
  assert.deepEqual(externalCandidates.map((candidate) => candidate.classification.type), ["conflict"]);
  let state = applyScanState(createLocalSaveState({ status: "saved", lastSuccessAt: syncState.savedAt }), externalCandidates, 2);
  assert.equal(state.status, "conflict");
  assert.equal(state.errorCode, "external-conflict");
  assert.equal(state.requiresUserAction, true);
  assert.match(state.errorMessage, /ローカルMarkdownが変更/);
  assert.match(await localFs.readText(layout.root, "notes/外部変更--note-1.md"), /外部エディタの本文/);

  managedFile.value = savedMarkdown;
  const resolvedCandidates = await scanMockWorkspace(selected, syncState, [note]);
  assert.deepEqual(resolvedCandidates, []);
  state = applyScanState(state, resolvedCandidates, 3);
  assert.equal(state.status, "saved");
  assert.equal(state.lastSuccessAt, syncState.savedAt);
  assert.equal(state.errorCode, "");
  assert.equal(state.requiresUserAction, false);
  assert.equal(note.createdAt, "original-created");
  assert.equal(note.localCreatedAt, "local-created");
  assert.equal(note.localSavedAt, syncState.savedAt);
});

test("競合解除後も自動保存せず、次の明示保存でだけ保存日時を更新する", async () => {
  const selected = new MockDirectoryHandle("保存先");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const initialSavedAt = "2026-08-14T02:00:00.000Z";
  const resumedSavedAt = "2026-08-14T02:05:00.000Z";
  const originalNote = {
    id: "note-1", title: "保存再開", collectionId: "c1", createdAt: "original-created",
    localCreatedAt: "local-created", updatedAt: 1, bodyUpdatedAt: 1,
    localSavedAt: initialSavedAt, isFlagged: false, deletedAt: null, sortOrder: 0, body: "初回本文"
  };
  const originalMarkdown = serializeLocalNote(originalNote);
  let syncState = {
    formatVersion: 1,
    savedAt: initialSavedAt,
    notes: { "note-1": { fileName: "保存再開--note-1.md", hash: contentHash(originalMarkdown), attachmentIds: [] } },
    assets: {}, excluded: []
  };
  await localFs.writeFile(layout.root, "notes/保存再開--note-1.md", originalMarkdown);
  await localFs.writeJson(layout.root, "sync-state.json", syncState);
  const managedFile = layout.root.directories.get("notes").files.get("保存再開--note-1.md");
  managedFile.value = originalMarkdown.replace("初回本文", "外部変更本文");

  let candidates = await scanMockWorkspace(selected, syncState, [originalNote]);
  let state = applyScanState(createLocalSaveState({ status: "saved", lastSuccessAt: initialSavedAt }), candidates, 2);
  assert.equal(state.status, "conflict");
  const editedNote = { ...originalNote, body: "Memo-Nexus側の最新本文", updatedAt: 2, bodyUpdatedAt: 2 };
  state = createLocalSaveState({ ...state, pendingChanges: true });
  assert.equal(shouldResumeLocalSaveAfterScan({ enabled: true, hasDirectory: true, state, candidates }), false);

  managedFile.value = originalMarkdown;
  candidates = await scanMockWorkspace(selected, syncState, [editedNote]);
  assert.deepEqual(candidates, []);
  state = applyScanState(state, candidates, 3);
  assert.equal(state.status, "pending");
  assert.equal(state.lastSuccessAt, initialSavedAt);
  assert.equal(editedNote.localSavedAt, initialSavedAt);
  assert.equal(shouldResumeLocalSaveAfterScan({ enabled: true, hasDirectory: true, state, candidates }), true);
  assert.doesNotMatch(app.match(/async function reconcileLocalScanCandidates[\s\S]*?\n}/)?.[0] || "", /queueLocalWorkspaceSave|localSaveQueue\.flush/);

  let saveCount = 0;
  let savedNote = editedNote;
  const queue = createLocalSaveQueue(async () => {
    saveCount += 1;
    state = transitionLocalSaveState(state, "saving", {}, 4);
    savedNote = applyLocalSaveSuccess(editedNote, resumedSavedAt);
    const nextMarkdown = serializeLocalNote(savedNote);
    const nextHash = contentHash(nextMarkdown);
    await localFs.writeFile(layout.root, "notes/保存再開--note-1.md", nextMarkdown);
    syncState = {
      ...syncState,
      savedAt: resumedSavedAt,
      notes: { "note-1": { fileName: "保存再開--note-1.md", hash: nextHash, attachmentIds: [] } }
    };
    await localFs.writeJson(layout.root, "sync-state.json", syncState);
    state = transitionLocalSaveState(state, "saved", { lastSuccessAt: resumedSavedAt }, 5);
  }, 1);
  assert.equal(saveCount, 0);
  assert.equal(await localFs.readText(layout.root, "notes/保存再開--note-1.md"), originalMarkdown);
  const queued = queue.enqueue("manual");
  await queue.flush("manual");
  await queued;

  assert.equal(saveCount, 1);
  assert.equal(state.status, "saved");
  assert.equal(state.lastSuccessAt, resumedSavedAt);
  assert.equal(savedNote.localSavedAt, resumedSavedAt);
  assert.equal(savedNote.createdAt, originalNote.createdAt);
  assert.equal(savedNote.localCreatedAt, originalNote.localCreatedAt);
  assert.match(await localFs.readText(layout.root, "notes/保存再開--note-1.md"), /Memo-Nexus側の最新本文/);
  const writtenSync = await localFs.readJson(layout.root, "sync-state.json", null);
  assert.equal(writtenSync.savedAt, resumedSavedAt);
  assert.equal(writtenSync.notes["note-1"].hash, contentHash(await localFs.readText(layout.root, "notes/保存再開--note-1.md")));
  const afterSaveCandidates = await scanMockWorkspace(selected, writtenSync, [savedNote]);
  assert.deepEqual(afterSaveCandidates, []);
  assert.equal(shouldResumeLocalSaveAfterScan({ enabled: true, hasDirectory: true, state, candidates: afterSaveCandidates }), false);
  assert.doesNotMatch(app, /queueLocalWorkspaceSave\("startup"\)/);
});

test("最後の復元候補を除外すると確認状態を解除するが自動保存しない", async () => {
  const selected = new MockDirectoryHandle("保存先");
  selected.files.set("復元候補.md", new MockFileHandle("復元候補.md", "---\nmemoNexusId: \"missing-note\"\ntitle: \"復元候補\"\n---\n復元本文"));
  let syncState = normalizeSyncState();
  let candidates = await scanMockWorkspace(selected, syncState, []);
  assert.deepEqual(candidates.map((candidate) => candidate.classification.type), ["restore"]);
  const fixedSavedAt = "2026-08-14T03:00:00.000Z";
  let state = applyScanState(createLocalSaveState({ status: "saved", lastSuccessAt: fixedSavedAt }), candidates, 2);
  assert.equal(state.status, "conflict");

  syncState = normalizeSyncState({ excluded: ["復元候補.md"] });
  candidates = await scanMockWorkspace(selected, syncState, []);
  assert.deepEqual(candidates, []);
  state = applyScanState(state, candidates, 3);
  assert.equal(state.status, "saved");
  assert.equal(state.lastSuccessAt, fixedSavedAt);
  assert.equal(state.requiresUserAction, false);
  assert.equal(shouldResumeLocalSaveAfterScan({ enabled: true, hasDirectory: true, state, candidates }), false);

  state = createLocalSaveState({ status: "conflict", lastSuccessAt: fixedSavedAt, pendingChanges: true, errorCode: "restore-candidate", requiresUserAction: true });
  state = applyScanState(state, candidates, 4);
  assert.equal(state.status, "pending");
  assert.equal(state.lastSuccessAt, fixedSavedAt);
  assert.equal(shouldResumeLocalSaveAfterScan({ enabled: true, hasDirectory: true, state, candidates }), true);
  assert.equal(state.status, "pending");
  const candidateHandler = extractFunction(app, "applyLocalCandidate");
  assert.match(candidateHandler, /localFs\.putConfig\(db, LOCAL_CONFIG_STORE_NAME, "pendingExclusions"/);
  assert.doesNotMatch(candidateHandler, /writeJson|queueLocalWorkspaceSave|localSaveQueue\.flush/);
});

test("候補消失時も権限・書込み・非対応状態を維持し、ブロック候補と保留競合では再開しない", () => {
  for (const status of ["permission-required", "error", "unsupported"]) {
    const state = createLocalSaveState({ status, lastSuccessAt: "fixed", pendingChanges: true, errorCode: status });
    assert.equal(applyScanState(state, []), state);
    assert.equal(shouldResumeLocalSaveAfterScan({ enabled: true, hasDirectory: true, state, candidates: [] }), false);
  }
  const held = applyScanState(createLocalSaveState({ status: "conflict", pendingChanges: true, errorCode: "conflict-held" }), [{ classification: { type: "conflict" } }], 2);
  assert.equal(held.errorCode, "conflict-held");
  assert.equal(shouldResumeLocalSaveAfterScan({ enabled: true, hasDirectory: true, state: held, candidates: [{ classification: { type: "conflict" } }] }), false);
  const saved = createLocalSaveState({ status: "saved", lastSuccessAt: "fixed" });
  assert.equal(shouldResumeLocalSaveAfterScan({ enabled: true, hasDirectory: true, state: saved, candidates: [{ classification: { type: "new" } }, { classification: { type: "duplicate" } }] }), false);
  const pending = createLocalSaveState({ status: "pending", lastSuccessAt: "fixed", pendingChanges: true });
  assert.equal(shouldResumeLocalSaveAfterScan({ enabled: true, hasDirectory: true, state: pending, candidates: [{ classification: { type: "new" } }, { classification: { type: "duplicate" } }] }), true);
});

test("復元候補だけは区別して確認を求め、新規・重複だけでは保存状態を変えない", async () => {
  const restore = [{ classification: { type: "restore" } }];
  const restoredState = applyScanState(createLocalSaveState({ status: "saved", lastSuccessAt: "saved" }), restore, 2);
  assert.equal(restoredState.status, "conflict");
  assert.equal(restoredState.errorCode, "restore-candidate");
  assert.match(restoredState.errorMessage, /復元/);

  const saved = createLocalSaveState({ status: "saved", lastSuccessAt: "saved" });
  assert.equal(applyScanState(saved, [{ classification: { type: "new" } }, { classification: { type: "duplicate" } }]), saved);
  const unrelatedError = createLocalSaveState({ status: "error", errorCode: "write", errorMessage: "disk full" });
  assert.equal(applyScanState(unrelatedError, []), unrelatedError);
});

test("保留した競合は候補が残る間維持し、解消後は未保存状態へ戻る", () => {
  let state = createLocalSaveState({
    status: "conflict", lastSuccessAt: "saved", pendingChanges: true,
    errorCode: "conflict-held", errorMessage: "競合を保留しています。", requiresUserAction: true
  });
  state = applyScanState(state, [{ classification: { type: "conflict" } }], 2);
  assert.equal(state.errorCode, "conflict-held");
  assert.equal(state.requiresUserAction, true);
  state = applyScanState(state, [], 3);
  assert.equal(state.status, "pending");
  assert.equal(state.requiresUserAction, false);
  assert.match(app, /const scanState = resolveLocalScanState\(localSaveState, localScanCandidates\)/);
  assert.match(app, /pendingChanges: localSaveState\.pendingChanges \|\| reason !== "startup"/);
});

test("外部編集だけを真の競合にし、未管理Markdownは実走査で従来分類へ渡す", async () => {
  const last = contentHash("Memo-Nexusが最後に保存");
  const next = contentHash("アプリ最新版");
  assert.equal(classifyManagedMarkdownHashes(last, contentHash("外部編集"), next), "conflict");
  assert.equal(classifyManagedMarkdownHashes(last, next, next), "app-current");
  const selected = new MockDirectoryHandle("保存先");
  selected.files.set("未管理.md", new MockFileHandle("未管理.md", "# 未管理\n\n新規本文"));
  selected.files.set("復元.md", new MockFileHandle("復元.md", "---\nmemoNexusId: \"missing\"\ntitle: \"復元\"\n---\n復元本文"));
  const candidates = await scanMockWorkspace(selected, normalizeSyncState(), []);
  assert.deepEqual(candidates.map((candidate) => candidate.classification.type).sort(), ["new", "restore"]);
  assert.match(app, /buildLocalScanAnalysis\(\{/);
  assert.match(app, /resolveLocalScanState\(localSaveState, localScanCandidates\)/);
});

test("実行中のローカル保存完了後に一度だけ走査し、待機要求がなくてもtailを待つ", async () => {
  const events = [];
  let releaseSave;
  let announceStarted;
  const started = new Promise((resolve) => { announceStarted = resolve; });
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  const queue = createLocalSaveQueue(async () => {
    events.push("save-start");
    announceStarted();
    await saveGate;
    events.push("save-end");
  }, 1);
  const queued = queue.enqueue("edit");
  await started;
  assert.equal(queue.hasPending(), false);
  const scanPromise = runLocalScanAfterQueue({
    queue,
    reason: "focus-before-scan",
    scan: async () => { events.push("scan"); return []; }
  });
  await Promise.resolve();
  assert.deepEqual(events, ["save-start"]);
  releaseSave();
  await Promise.all([queued, scanPromise]);
  assert.deepEqual(events, ["save-start", "save-end", "scan"]);
});

test("保存が真の競合で失敗しても、その後の走査を実行する", async () => {
  const events = [];
  const queue = createLocalSaveQueue(async () => {
    events.push("save");
    throw Object.assign(new Error("外部変更"), { code: "conflict" });
  }, 1);
  const queued = queue.enqueue("edit");
  const errors = [];
  const scanResult = await runLocalScanAfterQueue({
    queue,
    scan: async () => { events.push("scan"); return ["conflict"]; },
    onSaveError: (error) => errors.push(error.code)
  });
  await assert.rejects(queued, /外部変更/);
  assert.deepEqual(events, ["save", "scan"]);
  assert.deepEqual(errors, ["conflict"]);
  assert.deepEqual(scanResult, ["conflict"]);
});

test("フォーカス復帰では走査せず、手動再スキャンだけがブラウザ保存後にキューを待つ", () => {
  const focusHandler = app.match(/window\.addEventListener\("focus", \(\) => \{[\s\S]*?\n\}\);/)?.[0] || "";
  assert.equal(focusHandler, "");
  const coordinatedScan = app.match(/async function scanExternalLocalMarkdownAfterSaves[\s\S]*?\n}/)?.[0] || "";
  assert.ok(coordinatedScan.indexOf("await flushSave()") < coordinatedScan.indexOf("runLocalScanAfterQueue"));
  assert.match(app, /manual-before-scan/);
  assert.match(app, /hasExternalModification\(\s*previous\.hash,\s*currentHash,\s*hash,\s*currentComparableHash,\s*nextComparableHash\s*\)/);
});

test("競合解決は選択したメモ・ファイル・確認済みhashだけに限定し、保留中は候補を残す", () => {
  assert.match(app, /const localConflictResolutions = new Map\(\)/);
  assert.match(app, /!resolvedConflicts\.has\(note\.id\) && previous\.hash/);
  assert.match(app, /localConflictResolutionMatches\(resolution/);
  assert.match(app, /invalidatedResolutionNoteIds\.forEach/);
  assert.doesNotMatch(app, /forceNextLocalSave/);
  const candidateHandler = extractFunction(app, "applyLocalCandidate");
  assert.match(candidateHandler, /if \(action === "hold"\)[\s\S]*自動上書きしません。[\s\S]*return;/);
  assert.match(candidateHandler, /if \(action === "app"\)[\s\S]*rememberLocalConflictResolution\(candidate, targetId, action\)/);
  assert.match(candidateHandler, /action === "separate"[\s\S]*rememberLocalConflictResolution/);
});

test("ローカル保存キューは短時間の更新をまとめて直列実行する", async () => {
  const calls = [];
  const queue = createLocalSaveQueue(async (reason) => { calls.push(reason); }, 1);
  const first = queue.enqueue("first");
  const second = queue.enqueue("second");
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["second"]);
  await queue.enqueue("third");
  assert.deepEqual(calls, ["second", "third"]);
});

test("真の競合で保存が失敗しても、解決後の次回保存は実行できる", async () => {
  const calls = [];
  const queue = createLocalSaveQueue(async (reason) => {
    calls.push(reason);
    if (reason === "conflict") throw new Error("外部変更");
    return "saved";
  }, 1);
  await assert.rejects(queue.enqueue("conflict"), /外部変更/);
  assert.equal(await queue.enqueue("resolved"), "saved");
  assert.deepEqual(calls, ["conflict", "resolved"]);
});

test("File System Accessアダプターは二重ルートを作らず、書込・読込・スキャンできる", async () => {
  const selected = new MockDirectoryHandle("選択フォルダ");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  assert.equal(layout.root.name, "Memo-Nexus");
  assert.equal(await localFs.resolveWorkspaceRoot(layout.root), layout.root);
  await localFs.writeFile(layout.root, "notes/note.md", "# note");
  await localFs.writeFile(layout.root, "assets/a.png", new Blob(["png"], { type: "image/png" }));
  selected.files.set("external.md", new MockFileHandle("external.md", "# external"));
  assert.equal(await localFs.readText(layout.root, "notes/note.md"), "# note");
  const scanned = await localFs.scanMarkdownFiles(selected);
  assert.deepEqual(scanned.map((item) => item.path).sort(), ["external.md", "notes/note.md"]);
});

test("ディレクトリハンドルをIndexedDBストアへ直接保存・復元・解除する", async () => {
  const db = createConfigDb();
  const handle = new MockDirectoryHandle("Memo");
  await localFs.putConfig(db, "local-config", "directoryHandle", handle);
  assert.equal(await localFs.getConfig(db, "local-config", "directoryHandle"), handle);
  await localFs.deleteConfig(db, "local-config", "directoryHandle");
  assert.equal(await localFs.getConfig(db, "local-config", "directoryHandle"), undefined);
});

test("権限は起動時に照会だけ行い、利用者操作時の再接続で要求する", async () => {
  const handle = new MockDirectoryHandle("Memo");
  handle.permission = "prompt";
  assert.equal(await localFs.queryPermission(handle), "prompt");
  assert.equal(await localFs.requestPermission(handle), "granted");
  assert.match(app, /initializeLocalFolderSaving[\s\S]*queryPermission\(localDirectoryHandle, "readwrite"\)/);
  assert.match(app, /reconnectLocalSaveFolder[\s\S]*requestPermission\(localDirectoryHandle, "readwrite"\)/);
});

test("IndexedDB成功後は要保存だけを記録し、ローカル書込みを予約しない", () => {
  assert.match(app, /transaction\.oncomplete = \(\) => \{\s*notifyMemoChanged\(savedNote\);\s*markLocalWorkspacePending\(\)/);
  assert.equal((app.match(/queueLocalWorkspaceSave\(/g) || []).length, 2);
  assert.match(app, /async function saveLocalWorkspaceNow[\s\S]*queueLocalWorkspaceSave\(reason\)/);
  assert.match(app, /await putNote\(note\)[\s\S]*setSaveStatus\("saved", note\.updatedAt\)/);
  assert.doesNotMatch(extractFunction(app, "performLocalWorkspaceSave"), /deleteAttachmentRecord|deleteCurrentNote/);
});

test("起動・フォーカス・コレクション・添付変更はローカル保存や再スキャンを開始しない", () => {
  assert.doesNotMatch(extractFunction(app, "initializeLocalFolderSaving"), /scanExternalLocalMarkdown|queueLocalWorkspaceSave|ensureWorkspaceLayout/);
  assert.doesNotMatch(app, /window\.addEventListener\("focus"/);
  for (const name of ["putAttachments", "deleteAttachmentRecord", "deleteAttachmentRecords", "putCollection", "deleteCollectionRecord", "updateCollectionsTransaction"]) {
    const flow = extractFunction(app, name);
    assert.match(flow, /markLocalWorkspacePending\(\)/);
    assert.doesNotMatch(flow, /queueLocalWorkspaceSave|scanExternalLocalMarkdown|ensureWorkspaceLayout/);
  }
  assert.match(app, /rescanLocalMarkdownBtn\.addEventListener\("click"[\s\S]*manual-before-scan/);
});

test("明示保存はローカル一式を書き出す既存処理へだけ接続する", () => {
  assert.match(html, /id="saveLocalQuickBtn"[^>]*>ローカルへ保存<\/button>/);
  assert.match(app, /saveLocalQuickBtn\.addEventListener\("click", handleManualLocalSave\)/);
  const saveFlow = extractFunction(app, "performLocalWorkspaceSave");
  assert.match(saveFlow, /buildPortableBackupFiles\(/);
  assert.match(saveFlow, /file\.name, file\.content/);
  assert.match(saveFlow, /serializeCollections\(storedCollections\)/);
  assert.match(saveFlow, /const storedTags = await getAllTagDefinitions\(\)/);
  assert.match(saveFlow, /tagDefinitions: storedTags/);
  assert.match(saveFlow, /normalizeTagDefinitions/);
  assert.match(saveFlow, /"sync-state\.json"/);
});

test("ZIPバックアップとローカルフォルダ保存はタグ定義の正規化処理を渡す", () => {
  const zipFlow = extractFunction(app, "buildPortableBackupZipFiles");
  const localFlow = extractFunction(app, "performLocalWorkspaceSave");
  assert.match(zipFlow, /buildPortableBackupFiles\([\s\S]*normalizeTagDefinitions/);
  assert.match(localFlow, /buildPortableBackupFiles\([\s\S]*normalizeTagDefinitions/);
});

test("ローカル保存・復元はtags.jsonを扱い旧フォルダの欠落を許容する", () => {
  const saveFlow = extractFunction(app, "performLocalWorkspaceSave");
  const restoreTagsFlow = extractFunction(app, "restoreTagsFromLocal");
  const restoreFlow = extractFunction(app, "restoreFromLocalFolder");
  assert.match(saveFlow, /buildPortableBackupFiles\([\s\S]*tagDefinitions: storedTags/);
  assert.match(restoreTagsFlow, /optionalLocalText\(root, "tags\.json"\)/);
  assert.match(restoreTagsFlow, /if \(!text\) return \{ restored: 0, total: 0, skipped: false \}/);
  assert.ok(restoreFlow.indexOf("restoreTagsFromLocal()") < restoreFlow.indexOf("scanExternalLocalMarkdown"));
  assert.match(restoreFlow, /synchronizeRegisteredTagsForNotes\(\)/);
});

test("DB v5は既存ストアを保持してtagsストアを追加する", () => {
  assert.match(app, /const DB_VERSION = 6/);
  assert.match(app, /objectStoreNames\.contains\(LOCAL_CONFIG_STORE_NAME\)[\s\S]*createObjectStore\(LOCAL_CONFIG_STORE_NAME/);
  assert.match(app, /objectStoreNames\.contains\(TAG_STORE_NAME\)[\s\S]*createObjectStore\(TAG_STORE_NAME, \{ keyPath: "id" \}\)/);
  assert.doesNotMatch(app, /deleteObjectStore/);
});

test("設定UIは選択・再接続・保存・スキャン・復元・解除を提供する", () => {
  ["localSaveEnabled", "selectLocalFolderBtn", "reconnectLocalFolderBtn", "saveLocalNowBtn", "rescanLocalMarkdownBtn", "restoreFromLocalBtn", "disconnectLocalFolderBtn"].forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
  assert.match(html, /接続解除ではフォルダ内のファイルを削除/);
  assert.match(app, /applyLocalCandidate[\s\S]*ローカル版を読み込む[\s\S]*Memo-Nexus版で上書き[\s\S]*両方を残す[\s\S]*保留する/);
});

test("非対応環境はZIP代替を案内し、狭幅でも日時を残す", () => {
  assert.equal(localFs.supportStatus({ isSecureContext: true }).supported, false);
  assert.match(localFs.supportStatus({ isSecureContext: true }).reason, /Markdown ZIP/);
  assert.match(css, /--amber:/);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)[\s\S]*\.note-meta\s*\{[^}]*flex-direction:\s*row[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /body\.dark[\s\S]*--amber:/);
  assert.match(app, /event\.key === "Escape"/);
});
