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
const { createLocalSaveQueue, runLocalReconnectSequence, runLocalScanAfterQueue } = require("./local-save-queue.js");
const {
  parseLocalNote,
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
  hasExternalModification,
  managedNoteForPath,
  normalizeSyncState,
  parseCollections,
  serializeCollections
} = require("./local-sync-utils.js");
const localFs = require("./local-fs-adapter.js");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");

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

async function scanMockWorkspace(selected, syncState, notes) {
  return (await scanMockWorkspaceAnalysis(selected, syncState, notes)).candidates;
}

async function scanMockWorkspaceAnalysis(selected, syncState, notes) {
  const files = await localFs.scanMarkdownFiles(selected);
  return buildLocalScanAnalysis({
    files,
    syncState,
    notes,
    parseNote: parseLocalNote,
    serializeNote: serializeLocalNote,
    getAttachmentsForNote: async () => []
  });
}

function applyScanState(state, candidates, now = Date.now()) {
  const resolution = resolveLocalScanState(state, candidates);
  return resolution ? transitionLocalSaveState(state, resolution.status, resolution.patch, now) : state;
}

test("下部バーに文字数・日時・ローカル・ブラウザを別情報として保持する", () => {
  assert.match(html, /id="textStatsBtn"[\s\S]*id="noteMeta" class="note-meta"[\s\S]*id="localSaveStatusBtn"[\s\S]*id="browserSaveStatusBtn"/);
  assert.match(app, /const noteMeta = \$\("noteMeta"\)/);
  assert.match(app, /const createdAt = resolveDisplayedCreatedAt\(note\)/);
  assert.match(app, /`作成: \$\{formatDateTime\(createdAt\)\}　更新: \$\{formatDateTime\(updatedAt\)\}`/);
  assert.match(app, /renderNoteMeta\([\s\S]*renderSaveStatus\(\)/);
  assert.match(app, /const combinedLabel = localNeedsAttention \? local\.label : browser\.label/);
  assert.match(app, /`保存状態 \$\{combinedLabel\}`/);
});

test("表示作成日時はlocalCreatedAtを優先し、なければ元のcreatedAtを使う", () => {
  assert.equal(resolveDisplayedCreatedAt({ createdAt: "original" }), "original");
  assert.equal(resolveDisplayedCreatedAt({ createdAt: "original", localCreatedAt: "local" }), "local");
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
    deletedAt: null, sortOrder: 10, body: "前\n![図](attachment://asset-1)\n後"
  };
  const markdown = serializeLocalNote(note, note.body, [{ id: "asset-1", fileName: "asset-1.png" }]);
  assert.match(markdown, /^---\nmemoNexusId: "note-1"/);
  assert.match(markdown, /createdAt: "original"/);
  assert.match(markdown, /localCreatedAt: "local"/);
  assert.match(markdown, /!\[図\]\(\.\.\/assets\/asset-1\.png\)/);
  const parsed = parseLocalNote(markdown, { assets: [{ path: "../assets/asset-1.png", id: "asset-1" }] });
  assert.equal(parsed.metadata.memoNexusId, note.id);
  assert.equal(parsed.metadata.flagged, true);
  assert.equal(parsed.body, note.body);
});

test("外部Markdownの作成日時はlocalCreatedAt、createdAt、lastModified、取込日時の順で決める", () => {
  assert.equal(resolveImportedCreatedAt({ localCreatedAt: "local", createdAt: "created" }, 2, 3), "local");
  assert.equal(resolveImportedCreatedAt({ createdAt: "created" }, 2, 3), "created");
  assert.equal(resolveImportedCreatedAt({}, 2, 3), new Date(2).toISOString());
  assert.equal(resolveImportedCreatedAt({}, 0, 3), new Date(3).toISOString());
});

test("コレクションツリーとmanifestを完全な管理情報として往復する", () => {
  const collections = [{ id: "root", name: "親", parentId: null, sortOrder: 10, isSystem: false, createdAt: "c", updatedAt: "u" }, { id: "child", name: "子", parentId: "root", sortOrder: 20, isSystem: false, createdAt: "c2", updatedAt: "u2" }];
  assert.deepEqual(parseCollections(serializeCollections(collections)), collections);
  assert.deepEqual(buildManifest({ appVersion: "0.4.0", savedAt: "now", notes: [{}, {}], collections, assetsCount: 3 }), {
    formatVersion: 1, appVersion: "0.4.0", savedAt: "now", notesCount: 2, collectionsCount: 2, assetsCount: 3
  });
});

test("画像形式に合う拡張子を使い同期状態へ対応を保持する", () => {
  assert.equal(attachmentExtension({ mimeType: "image/jpeg" }), "jpg");
  assert.equal(attachmentExtension({ blob: { type: "image/png" } }), "png");
  assert.deepEqual(normalizeSyncState({ assets: { a1: { fileName: "a1.png", memoId: "n1" } } }).assets.a1, { fileName: "a1.png", memoId: "n1" });
});

test("外部Markdownを新規・復元・同一・競合・重複へ分類する", () => {
  const notes = [{ id: "n1", title: "既存", body: "本文" }];
  assert.equal(classifyMarkdownCandidate({ metadata: {}, body: "新規" }, notes).type, "new");
  assert.equal(classifyMarkdownCandidate({ metadata: { memoNexusId: "missing", title: "復元" }, body: "本文" }, notes).type, "restore");
  assert.equal(classifyMarkdownCandidate({ metadata: { memoNexusId: "n1", title: "既存" }, body: "本文" }, notes).type, "unchanged");
  assert.equal(classifyMarkdownCandidate({ metadata: { memoNexusId: "n1", title: "既存" }, body: "外部変更" }, notes).type, "conflict");
  assert.equal(classifyMarkdownCandidate({ metadata: { title: "既存" }, body: "本文" }, notes).type, "duplicate");
});

test("最後に書いたハッシュと異なる外部変更を自動上書きしない", () => {
  const last = contentHash("last");
  assert.equal(hasExternalModification(last, contentHash("external"), contentHash("app")), true);
  assert.equal(hasExternalModification(last, last, contentHash("app")), false);
  assert.match(app, /hasExternalModification\(previous\.hash, currentHash, hash\)/);
  assert.match(app, /setLocalSaveState\("conflict"/);
});

test("管理対象Markdownはsync-stateのnote IDとfileNameで特定する", () => {
  assert.match(html, /local-save-state\.js\?v=0\.4\.0-4/);
  assert.match(html, /local-save-queue\.js\?v=0\.4\.0-3/);
  assert.match(html, /local-sync-utils\.js\?v=0\.4\.0-4/);
  assert.match(html, /app\.js\?v=0\.4\.0-78/);
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

test("再接続は権限回復後に外部競合を先に検出し、保存せず競合状態を維持する", async () => {
  assert.match(app, /runLocalReconnectSequence\(\{/);
  assert.match(app, /resumePendingSave: false/);
  const selected = new MockDirectoryHandle("保存先");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const note = {
    id: "note-1", title: "再接続競合", createdAt: "created", localCreatedAt: "local-created",
    localSavedAt: "2026-08-14T04:00:00.000Z", body: "前回保存本文"
  };
  const savedMarkdown = serializeLocalNote(note);
  const syncState = normalizeSyncState({
    savedAt: note.localSavedAt,
    notes: { "note-1": { fileName: "再接続競合--note-1.md", hash: contentHash(savedMarkdown), attachmentIds: [] } }
  });
  await localFs.writeFile(layout.root, "notes/再接続競合--note-1.md", savedMarkdown);
  const managedFile = layout.root.directories.get("notes").files.get("再接続競合--note-1.md");
  const externalMarkdown = savedMarkdown.replace("前回保存本文", "外部で変更した本文");
  managedFile.value = externalMarkdown;
  const appNote = { ...note, body: "Memo-Nexus側の未保存本文" };
  const events = [];
  let saveCount = 0;
  let state = createLocalSaveState({
    status: "permission-required", lastSuccessAt: note.localSavedAt,
    pendingChanges: true, errorCode: "permission", requiresUserAction: true
  });

  const result = await runLocalReconnectSequence({
    requestPermission: async () => { events.push("permission"); selected.permission = "granted"; return "granted"; },
    onPermissionGranted: () => { state = transitionLocalSaveState(state, "pending", { lastSuccessAt: state.lastSuccessAt }, 2); },
    scan: async () => {
      events.push("scan");
      const analysis = await scanMockWorkspaceAnalysis(selected, syncState, [appNote]);
      state = applyScanState(state, analysis.candidates, 3);
      return analysis;
    },
    shouldSave: (analysis) => shouldResumeLocalSaveAfterScan({
      enabled: true, hasDirectory: true, state, candidates: analysis.candidates
    }),
    save: async () => { events.push("save"); saveCount += 1; }
  });

  assert.deepEqual(events, ["permission", "scan"]);
  assert.equal(result.saveAttempted, false);
  assert.equal(saveCount, 0);
  assert.equal(state.status, "conflict");
  assert.equal(state.errorCode, "external-conflict");
  assert.notEqual(state.status, "permission-required");
  assert.equal(await localFs.readText(layout.root, "notes/再接続競合--note-1.md"), externalMarkdown);
});

test("再接続は安全なapp-aheadを走査後に一度だけ保存する", async () => {
  const selected = new MockDirectoryHandle("保存先");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const initialSavedAt = "2026-08-14T05:00:00.000Z";
  const nextSavedAt = "2026-08-14T05:01:00.000Z";
  const originalNote = {
    id: "note-1", title: "再接続保存", createdAt: "created", localCreatedAt: "local-created",
    localSavedAt: initialSavedAt, body: "前回保存本文"
  };
  const originalMarkdown = serializeLocalNote(originalNote);
  let syncState = normalizeSyncState({
    savedAt: initialSavedAt,
    notes: { "note-1": { fileName: "再接続保存--note-1.md", hash: contentHash(originalMarkdown), attachmentIds: [] } }
  });
  await localFs.writeFile(layout.root, "notes/再接続保存--note-1.md", originalMarkdown);
  const editedNote = { ...originalNote, body: "Memo-Nexus側の最新版" };
  const events = [];
  let saveCount = 0;
  let state = createLocalSaveState({
    status: "permission-required", lastSuccessAt: initialSavedAt,
    pendingChanges: true, errorCode: "permission", requiresUserAction: true
  });
  const queue = createLocalSaveQueue(async () => {
    events.push("save");
    saveCount += 1;
    state = transitionLocalSaveState(state, "saving", {}, 3);
    const savedNote = applyLocalSaveSuccess(editedNote, nextSavedAt);
    const markdown = serializeLocalNote(savedNote);
    syncState = normalizeSyncState({
      savedAt: nextSavedAt,
      notes: { "note-1": { fileName: "再接続保存--note-1.md", hash: contentHash(markdown), attachmentIds: [] } }
    });
    await localFs.writeFile(layout.root, "notes/再接続保存--note-1.md", markdown);
    await localFs.writeJson(layout.root, "sync-state.json", syncState);
    state = transitionLocalSaveState(state, "saved", { lastSuccessAt: nextSavedAt }, 4);
  }, 1);

  const result = await runLocalReconnectSequence({
    requestPermission: async () => { events.push("permission"); return "granted"; },
    onPermissionGranted: () => { state = transitionLocalSaveState(state, "pending", { lastSuccessAt: initialSavedAt }, 2); },
    scan: async () => {
      events.push("scan");
      const analysis = await scanMockWorkspaceAnalysis(selected, syncState, [editedNote]);
      assert.deepEqual(analysis.candidates, []);
      assert.deepEqual(analysis.appAheadNoteIds, ["note-1"]);
      assert.equal(analysis.needsLocalSave, true);
      return analysis;
    },
    shouldSave: (analysis) => analysis.needsLocalSave && shouldResumeLocalSaveAfterScan({
      enabled: true, hasDirectory: true, state, candidates: analysis.candidates
    }),
    save: async () => {
      const queued = queue.enqueue("reconnect");
      await queue.flush("reconnect");
      return queued;
    }
  });

  assert.deepEqual(events, ["permission", "scan", "save"]);
  assert.equal(result.saveAttempted, true);
  assert.equal(saveCount, 1);
  assert.equal(state.status, "saved");
  assert.equal(state.lastSuccessAt, nextSavedAt);
  assert.match(await localFs.readText(layout.root, "notes/再接続保存--note-1.md"), /Memo-Nexus側の最新版/);
  const writtenSync = await localFs.readJson(layout.root, "sync-state.json", null);
  assert.equal(writtenSync.savedAt, nextSavedAt);
  assert.equal(writtenSync.notes["note-1"].hash, contentHash(await localFs.readText(layout.root, "notes/再接続保存--note-1.md")));
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

test("起動時解析はapp-aheadだけを保存し、同一内容と真の外部変更は書き換えない", async () => {
  const selected = new MockDirectoryHandle("保存先");
  const layout = await localFs.ensureWorkspaceLayout(selected);
  const initialSavedAt = "2026-08-14T06:00:00.000Z";
  const nextSavedAt = "2026-08-14T06:02:00.000Z";
  const originalNote = {
    id: "note-1", title: "起動時解析", createdAt: "created", localCreatedAt: "local-created",
    localSavedAt: initialSavedAt, body: "前回保存本文"
  };
  const originalMarkdown = serializeLocalNote(originalNote);
  let syncState = normalizeSyncState({
    savedAt: initialSavedAt,
    notes: { "note-1": { fileName: "起動時解析--note-1.md", hash: contentHash(originalMarkdown), attachmentIds: [] } }
  });
  await localFs.writeFile(layout.root, "notes/起動時解析--note-1.md", originalMarkdown);
  const managedFile = layout.root.directories.get("notes").files.get("起動時解析--note-1.md");
  const baselineWriteCount = managedFile.writeCount;
  const baselineModified = managedFile.lastModified;
  let state = createLocalSaveState({ status: "saved", lastSuccessAt: initialSavedAt, pendingChanges: false });

  const sameAnalysis = await scanMockWorkspaceAnalysis(selected, syncState, [originalNote]);
  assert.deepEqual(sameAnalysis, { candidates: [], appAheadNoteIds: [], needsLocalSave: false });
  assert.equal(managedFile.writeCount, baselineWriteCount);
  assert.equal(managedFile.lastModified, baselineModified);
  assert.equal(state.lastSuccessAt, initialSavedAt);
  assert.equal(originalNote.localSavedAt, initialSavedAt);

  const editedNote = { ...originalNote, body: "ブラウザ側だけ新しい本文" };
  const appAhead = await scanMockWorkspaceAnalysis(selected, syncState, [editedNote]);
  assert.deepEqual(appAhead.candidates, []);
  assert.deepEqual(appAhead.appAheadNoteIds, ["note-1"]);
  assert.equal(appAhead.needsLocalSave, true);
  state = transitionLocalSaveState(state, "pending", { lastSuccessAt: initialSavedAt }, 2);
  let saveCount = 0;
  const queue = createLocalSaveQueue(async () => {
    saveCount += 1;
    state = transitionLocalSaveState(state, "saving", {}, 3);
    const savedNote = applyLocalSaveSuccess(editedNote, nextSavedAt);
    const markdown = serializeLocalNote(savedNote);
    syncState = normalizeSyncState({
      savedAt: nextSavedAt,
      notes: { "note-1": { fileName: "起動時解析--note-1.md", hash: contentHash(markdown), attachmentIds: [] } }
    });
    await localFs.writeFile(layout.root, "notes/起動時解析--note-1.md", markdown);
    await localFs.writeJson(layout.root, "sync-state.json", syncState);
    state = transitionLocalSaveState(state, "saved", { lastSuccessAt: nextSavedAt }, 4);
  }, 1);
  const queued = queue.enqueue("startup");
  await queue.flush("startup");
  await queued;
  assert.equal(saveCount, 1);
  assert.equal(state.status, "saved");
  assert.equal(state.lastSuccessAt, nextSavedAt);
  assert.match(await localFs.readText(layout.root, "notes/起動時解析--note-1.md"), /ブラウザ側だけ新しい本文/);
  assert.equal((await localFs.readJson(layout.root, "sync-state.json", null)).savedAt, nextSavedAt);

  const latestMarkdown = await localFs.readText(layout.root, "notes/起動時解析--note-1.md");
  managedFile.value = latestMarkdown.replace("ブラウザ側だけ新しい本文", "外部だけ変更した本文");
  const externalBefore = managedFile.value;
  const conflictAnalysis = await scanMockWorkspaceAnalysis(selected, syncState, [applyLocalSaveSuccess(editedNote, nextSavedAt)]);
  assert.deepEqual(conflictAnalysis.candidates.map((candidate) => candidate.classification.type), ["conflict"]);
  state = applyScanState(state, conflictAnalysis.candidates, 5);
  assert.equal(state.status, "conflict");
  assert.equal(state.errorCode, "external-conflict");
  assert.equal(await localFs.readText(layout.root, "notes/起動時解析--note-1.md"), externalBefore);
  assert.equal(saveCount, 1);
});

test("初回保存後のアプリ内編集は走査で競合せず、保存キューがMarkdownとsync-stateを更新する", async () => {
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
  const beforeSaveCandidates = await scanMockWorkspace(selected, {
    formatVersion: 1,
    savedAt: originalNote.localSavedAt,
    notes: { "note-1": { fileName: "回帰テスト--note-1.md", hash: originalHash, attachmentIds: [] } },
    assets: {}, excluded: []
  }, [editedNote]);
  assert.deepEqual(beforeSaveCandidates, []);

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
  await queue.enqueue("edited-note");

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

test("競合解除後のpending保存を一度だけ再開し、実保存成功時だけ保存日時を更新する", async () => {
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
  const queued = queue.enqueue("scan-unblocked");
  await queue.flush("scan-unblocked");
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
  assert.match(app, /else if \(localSaveState\.pendingChanges \|\| !localSaveState\.lastSuccessAt\) queueLocalWorkspaceSave\("startup"\)/);
});

test("最後の復元候補を除外すると確認状態を解除し、必要な場合だけ保存再開を許可する", async () => {
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
  let saveCount = 0;
  const queue = createLocalSaveQueue(async () => {
    saveCount += 1;
    state = transitionLocalSaveState(state, "saving", {}, 5);
    state = transitionLocalSaveState(state, "saved", { lastSuccessAt: "2026-08-14T03:05:00.000Z" }, 6);
  }, 1);
  const queued = queue.enqueue("candidate-excluded");
  await queue.flush("candidate-excluded");
  await queued;
  assert.equal(saveCount, 1);
  assert.equal(state.status, "saved");
  assert.match(app, /candidate-excluded/);
  assert.match(app, /reconcileLocalScanCandidates\(\{ resumePendingSave: true/);
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

test("フォーカス復帰と手動再スキャンはブラウザ保存後に無条件でキューを待つ", () => {
  const focusHandler = app.match(/window\.addEventListener\("focus", \(\) => \{[\s\S]*?\n\}\);/)?.[0] || "";
  assert.match(focusHandler, /scanExternalLocalMarkdownAfterSaves\(\{ automatic: true, reason: "focus-before-scan" \}\)/);
  assert.doesNotMatch(focusHandler, /hasPending\(\)/);
  const coordinatedScan = app.match(/async function scanExternalLocalMarkdownAfterSaves[\s\S]*?\n}/)?.[0] || "";
  assert.ok(coordinatedScan.indexOf("await flushSave()") < coordinatedScan.indexOf("runLocalScanAfterQueue"));
  assert.match(app, /manual-before-scan/);
  assert.match(app, /hasExternalModification\(previous\.hash, currentHash, hash\)/);
});

test("競合の強制保存は選択したメモだけに限定し、保留中は候補を残す", () => {
  assert.match(app, /const forcedLocalSaveNoteIds = new Set\(\)/);
  assert.match(app, /!forcedNoteIds\.has\(note\.id\) && previous\.hash/);
  assert.doesNotMatch(app, /forceNextLocalSave/);
  const candidateHandler = app.match(/async function applyLocalCandidate[\s\S]*?\n}\n\nasync function restoreCollectionsFromLocal/)?.[0] || "";
  assert.match(candidateHandler, /if \(action === "hold"\)[\s\S]*自動上書きしません。[\s\S]*return;/);
  assert.match(candidateHandler, /if \(action === "app"\)[\s\S]*forcedLocalSaveNoteIds\.add\(targetId\)/);
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

test("IndexedDB成功後にローカル保存を予約し、ローカル失敗でブラウザ内容を削除しない", () => {
  assert.match(app, /transaction\.oncomplete = \(\) => \{\s*notifyMemoChanged\(note\);\s*queueLocalWorkspaceSave\("note"\)/);
  assert.match(app, /await putNote\(note\)[\s\S]*setSaveStatus\("saved", note\.updatedAt\)/);
  assert.doesNotMatch(app.match(/async function performLocalWorkspaceSave[\s\S]*?\n}\n\nasync function selectLocalSaveFolder/)?.[0] || "", /deleteAttachmentRecord|deleteCurrentNote/);
});

test("DB v4は既存ストアを保持してlocal-configだけを追加する", () => {
  assert.match(app, /const DB_VERSION = 4/);
  assert.match(app, /objectStoreNames\.contains\(LOCAL_CONFIG_STORE_NAME\)[\s\S]*createObjectStore\(LOCAL_CONFIG_STORE_NAME/);
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
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.note-meta\s*\{[^}]*flex:[^}]*font-size:/);
  assert.match(css, /body\.dark[\s\S]*--amber:/);
  assert.match(app, /event\.key === "Escape"/);
});
