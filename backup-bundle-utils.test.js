const test = require("node:test");
const assert = require("node:assert/strict");
const { buildManifest } = require("./local-sync-utils.js");
const { parseLocalNote, serializeLocalNote } = require("./local-markdown.js");
const {
  BACKUP_FORMAT, BACKUP_VERSION, buildPortableBackupFiles, importedWins, isPortableBackup, parsePortableBackup
} = require("./backup-bundle-utils.js");

function entry(name, content) {
  return { name, data: typeof content === "string" ? new TextEncoder().encode(content) : content };
}

function manifest() {
  return buildManifest({
    appVersion: "0.4.0", savedAt: "2026-08-15T00:00:00.000Z", exportedAt: "2026-08-15T00:00:00.000Z",
    notes: [], collections: [], assetsCount: 0
  });
}

test("v1バックアップはローカル保存と共通の論理構造を出力する", () => {
  const note = {
    id: "note-1", title: "日本語メモ", body: "![図](attachment://asset-1)", collectionId: "child",
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z",
    isFlagged: true, deletedAt: null, explanations: [{ text: "説明" }]
  };
  const markdown = serializeLocalNote(note, note.body, [{ id: "asset-1", fileName: "asset-1.png", mimeType: "image/png", kind: "image" }]);
  const files = buildPortableBackupFiles({
    manifest: manifest(), collections: [{ id: "child", name: "子", parentId: "root", sortOrder: 1 }],
    notePlans: [{ fileName: "日本語--note-1.md", markdown }], assetPlans: [{ fileName: "asset-1.png", data: Uint8Array.of(1, 2) }]
  });
  assert.deepEqual(files.map((file) => file.name), ["manifest.json", "collections.json", "notes/日本語--note-1.md", "assets/asset-1.png"]);
  assert.match(files[0].content, new RegExp(`"format": "${BACKUP_FORMAT}"`));
  assert.match(files[0].content, new RegExp(`"version": ${BACKUP_VERSION}`));
  assert.match(markdown, /attachments: \[\{"id":"asset-1"/);
});

test("完全バックアップは未分類フォールバックに必要なメモを、collections破損時も解析する", () => {
  const markdown = serializeLocalNote({ id: "note-1", title: "救済", updatedAt: "2026-08-02T00:00:00.000Z" }, "本文");
  const parsed = parsePortableBackup([
    entry("manifest.json", JSON.stringify(manifest())), entry("collections.json", "壊れたJSON"), entry("notes/rescue.md", markdown)
  ], { parseNote: parseLocalNote, idFactory: () => "new-asset" });
  assert.equal(parsed.notes.length, 1);
  assert.deepEqual(parsed.collections, []);
  assert.deepEqual(parsed.skipped, ["collections.json"]);
});

test("本文にないPDF添付もfront matterから復元対象にする", () => {
  const markdown = serializeLocalNote(
    { id: "note-1", title: "PDF", updatedAt: "2026-08-02T00:00:00.000Z" }, "本文",
    [{ id: "pdf-1", fileName: "pdf-1.pdf", mimeType: "application/pdf", kind: "pdf" }]
  );
  const parsed = parsePortableBackup([
    entry("manifest.json", JSON.stringify(manifest())), entry("collections.json", "[]"), entry("notes/pdf.md", markdown), entry("assets/pdf-1.pdf", Uint8Array.of(37, 80, 68, 70))
  ], { parseNote: parseLocalNote, idFactory: () => "new-pdf" });
  assert.equal(parsed.notes[0].attachments[0].mimeType, "application/pdf");
  assert.equal(parsed.notes[0].attachments[0].kind, "pdf");
});

test("manifestの欠損・破損・未知形式は完全バックアップとして安全に中止する", () => {
  assert.equal(isPortableBackup([entry("notes/a.md", "本文")]), false);
  assert.throws(() => parsePortableBackup([entry("manifest.json", "{")], { parseNote: parseLocalNote }), /manifest/);
  assert.throws(() => parsePortableBackup([entry("manifest.json", JSON.stringify({ ...manifest(), format: "other" }))], { parseNote: parseLocalNote }), /形式/);
});

test("ID衝突ではimport側のupdatedAtが厳密に新しい場合だけ採用する", () => {
  assert.equal(importedWins({ updatedAt: "2026-08-02T00:00:00.000Z" }, { updatedAt: "2026-08-03T00:00:00.000Z" }), true);
  assert.equal(importedWins({ updatedAt: "2026-08-03T00:00:00.000Z" }, { updatedAt: "2026-08-02T00:00:00.000Z" }), false);
  assert.equal(importedWins({ updatedAt: "2026-08-03T00:00:00.000Z" }, { updatedAt: "2026-08-03T00:00:00.000Z" }), false);
});
