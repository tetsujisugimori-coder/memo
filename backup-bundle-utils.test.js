const test = require("node:test");
const assert = require("node:assert/strict");
const { buildManifest } = require("./local-sync-utils.js");
const { parseLocalNote, serializeLocalNote } = require("./local-markdown.js");
const {
  BACKUP_FORMAT, BACKUP_VERSION, attachmentIdsToReplace, buildPortableBackupFiles, importedWins, isPortableBackup, parsePortableBackup
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
    isFlagged: true, deletedAt: null, tags: [" Work ", "work", "資料"], explanations: [{ text: "説明" }]
  };
  const markdown = serializeLocalNote(note, note.body, [{ id: "asset-1", fileName: "asset-1.png", mimeType: "image/png", kind: "image" }]);
  const files = buildPortableBackupFiles({
    manifest: manifest(), collections: [{ id: "child", name: "子", parentId: "root", sortOrder: 1 }],
    notePlans: [{ fileName: "日本語--note-1.md", markdown }], assetPlans: [{ fileName: "asset-1.png", data: Uint8Array.of(1, 2) }]
  });
  assert.deepEqual(files.map((file) => file.name), ["manifest.json", "collections.json", "notes/日本語--note-1.md", "assets/asset-1.png"]);
  assert.match(files[0].content, new RegExp(`"format": "${BACKUP_FORMAT}"`));
  assert.match(files[0].content, new RegExp(`"version": ${BACKUP_VERSION}`));
  assert.match(markdown, /tags: \["work","資料"\]/);
  assert.match(markdown, /attachments: \[\{"id":"asset-1"/);
});

test("ZIP往復でタグを保持し、タグなし旧メモは空配列として復元する", () => {
  const taggedMarkdown = serializeLocalNote({ id: "tagged", title: "タグ付き", tags: ["Alpha", " ALPHA ", "資料"], updatedAt: "2026-08-02T00:00:00.000Z" }, "本文");
  const legacyMarkdown = "---\nmemoNexusId: \"legacy\"\ntitle: \"旧形式\"\nupdatedAt: \"2026-08-02T00:00:00.000Z\"\n---\n\n本文";
  const parsed = parsePortableBackup([
    entry("manifest.json", JSON.stringify(manifest())), entry("collections.json", "[]"),
    entry("notes/tagged.md", taggedMarkdown), entry("notes/legacy.md", legacyMarkdown)
  ], { parseNote: parseLocalNote });
  const byId = new Map(parsed.notes.map((plan) => [plan.note.id, plan.note]));
  assert.deepEqual(byId.get("tagged").tags, ["alpha", "資料"]);
  assert.deepEqual(byId.get("legacy").tags, []);
});

test("ZIP往復で解説アンカーコメントを含む本文がそのまま保持される", () => {
  const anchor = "<!-- memo-nexus:explanation id=\"backup-1\" -->";
  const note = {
    id: "note-100",
    title: "解説アンカー保存",
    body: `本文${anchor}の後`,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    explanations: [{ id: "backup-1", target: "本文", type: "補足", body: "固定メモ", updatedAt: "2026-08-02T00:00:00.000Z" }]
  };
  const markdown = serializeLocalNote(note, note.body, []);
  const parsed = parsePortableBackup([
    entry("manifest.json", JSON.stringify(manifest())),
    entry("collections.json", "[]"),
    entry("notes/note-100.md", markdown)
  ], { parseNote: parseLocalNote, idFactory: () => "new-id" });
  assert.equal(parsed.notes.length, 1);
  assert.equal(parsed.notes[0].note.body.includes(anchor), true);
  assert.equal(parsed.notes[0].note.explanations?.[0]?.id, "backup-1");
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

test("添付が一部欠損したメモは既存添付を置換対象にしない", () => {
  const imageMarkdown = serializeLocalNote(
    { id: "image-note", title: "画像", updatedAt: "2026-08-02T00:00:00.000Z" }, "![A](attachment://image-a)\n![C](attachment://image-c)",
    [{ id: "image-a", fileName: "image-a.png", mimeType: "image/png", kind: "image" }, { id: "image-c", fileName: "image-c.png", mimeType: "image/png", kind: "image" }]
  );
  const pdfMarkdown = serializeLocalNote(
    { id: "pdf-note", title: "PDF", updatedAt: "2026-08-02T00:00:00.000Z" }, "本文",
    [{ id: "pdf-a", fileName: "pdf-a.pdf", mimeType: "application/pdf", kind: "pdf" }]
  );
  const fullMarkdown = serializeLocalNote(
    { id: "full-note", title: "完全", updatedAt: "2026-08-02T00:00:00.000Z" }, "![A](attachment://full-a)",
    [{ id: "full-a", fileName: "full-a.png", mimeType: "image/png", kind: "image" }]
  );
  const plainMarkdown = serializeLocalNote({ id: "plain-note", title: "通常", updatedAt: "2026-08-02T00:00:00.000Z" }, "本文");
  const parsed = parsePortableBackup([
    entry("manifest.json", JSON.stringify(manifest())), entry("collections.json", "[]"),
    entry("notes/image.md", imageMarkdown), entry("assets/image-a.png", Uint8Array.of(1)),
    entry("notes/pdf.md", pdfMarkdown), entry("notes/full.md", fullMarkdown), entry("assets/full-a.png", Uint8Array.of(1)),
    entry("notes/plain.md", plainMarkdown)
  ], { parseNote: parseLocalNote, idFactory: (() => { let index = 0; return () => `new-${++index}`; })() });
  const byId = new Map(parsed.notes.map((plan) => [plan.note.id, plan]));
  assert.equal(byId.get("image-note").attachmentsComplete, false);
  assert.equal(byId.get("image-note").attachments.length, 1);
  assert.equal(byId.get("image-note").attachmentTotal, 2);
  assert.equal(byId.get("pdf-note").attachmentsComplete, false);
  assert.equal(byId.get("full-note").attachmentsComplete, true);
  assert.equal(byId.get("full-note").attachments.length, 1);
  assert.equal(byId.get("plain-note").attachmentsComplete, true);
  const existing = new Map([
    ["image-note", [{ id: "image-a" }, { id: "image-b" }, { id: "image-c" }]],
    ["pdf-note", [{ id: "pdf-a" }]],
    ["full-note", [{ id: "old-full" }]],
    ["plain-note", []]
  ]);
  assert.deepEqual(attachmentIdsToReplace(parsed.notes, existing), ["old-full"]);
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
