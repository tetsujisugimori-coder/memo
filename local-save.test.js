"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const {
  applyLocalSaveSuccess,
  createLocalSaveState,
  resolveDisplayedCreatedAt,
  transitionLocalSaveState
} = require("./local-save-state.js");
const { createLocalSaveQueue } = require("./local-save-queue.js");
const {
  parseLocalNote,
  resolveImportedCreatedAt,
  serializeLocalNote
} = require("./local-markdown.js");
const {
  attachmentExtension,
  buildManifest,
  classifyMarkdownCandidate,
  contentHash,
  hasExternalModification,
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
  }
  async createWritable() {
    return {
      write: async (value) => { this.value = value; },
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
