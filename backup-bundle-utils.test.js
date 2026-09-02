const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { buildManifest } = require("./local-sync-utils.js");
const { parseLocalNote, serializeLocalNote } = require("./local-markdown.js");
const { mergeTagDefinitionsFromNotes, normalizeTagDefinitions, tagColorFromId } = require("./tags.js");
const {
  BACKUP_FORMAT, BACKUP_VERSION, attachmentIdsToReplace, buildPortableBackupFiles, importedWins, isPortableBackup, parsePortableBackup
} = require("./backup-bundle-utils.js");
const { createGeometryBlock, serializeGeometryBlock } = require("./geometry-block-utils.js");

function entry(name, content) {
  return { name, data: typeof content === "string" ? new TextEncoder().encode(content) : content };
}

function manifest(overrides = {}) {
  return { ...buildManifest({
    appVersion: "0.5.0", savedAt: "2026-08-15T00:00:00.000Z", exportedAt: "2026-08-15T00:00:00.000Z",
    notes: [], collections: [], assetsCount: 0
  }), ...overrides };
}

test("タグバックアップ関連スクリプトのキャッシュ番号を更新する", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /tags\.js\?v=0\.5\.0-4/);
  assert.match(html, /local-sync-utils\.js\?v=0\.5\.0-10/);
  assert.match(html, /backup-bundle-utils\.js\?v=0\.5\.0-5/);
  assert.match(html, /app\.js\?v=0\.5\.0-139/);
});

test("完全バックアップはメモ個別のWebフォントIDをそのまま往復する", () => {
  const fontSettings = {
    enabled: true,
    titleFontId: "noto-serif-jp-web",
    titleFontSize: 26,
    bodyFontId: "noto-sans-jp-web",
    bodyFontSize: 17,
    headingFontId: "shippori-mincho-web",
    codeFontId: "jetbrains-mono-web",
    codeFontSize: 13
  };
  const markdown = serializeLocalNote({ id: "web-font-note", title: "Webフォント", fontSettings }, "本文");
  const parsed = parsePortableBackup([
    entry("manifest.json", JSON.stringify(manifest())),
    entry("collections.json", "[]"),
    entry("notes/web-font.md", markdown)
  ], { parseNote: parseLocalNote });
  assert.deepEqual(parsed.notes[0].note.fontSettings, fontSettings);
});

test("Memo Nexus形式ZIPの書き出しと復元で幾何学ブロック本文をそのまま保持する", () => {
  const geometryMarker = serializeGeometryBlock(createGeometryBlock("backup-round-trip"));
  const body = `前\n${geometryMarker}\n後`;
  const markdown = serializeLocalNote({ id: "geometry-backup", title: "幾何学バックアップ" }, body);
  const files = buildPortableBackupFiles({
    manifest: manifest(),
    collections: [],
    tagDefinitions: [],
    notePlans: [{ fileName: "geometry.md", markdown }],
    normalizeTagDefinitions
  });
  const parsed = parsePortableBackup(files.map((file) => entry(file.name, file.content)), {
    parseNote: parseLocalNote,
    normalizeTagDefinitions
  });
  assert.equal(parsed.notes[0].note.body, body);
});

test("ZIP出力・復元でUTCの作成・更新時刻の瞬間を変更しない", () => {
  const note = {
    id: "date-note",
    title: "日付境界",
    body: "本文",
    createdAt: "2026-08-19T23:19:22.291Z",
    localCreatedAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T01:00:00.000Z",
    bodyUpdatedAt: "2026-08-20T00:30:00.000Z",
    localSavedAt: "2026-08-20T02:00:00.000Z"
  };
  const markdown = serializeLocalNote(note, note.body);
  const files = buildPortableBackupFiles({
    manifest: manifest(),
    collections: [],
    tagDefinitions: [],
    notePlans: [{ fileName: "date-note.md", markdown, updatedAt: note.updatedAt }],
    normalizeTagDefinitions
  });
  const parsed = parsePortableBackup(files.map((file) => entry(file.name, file.content)), {
    parseNote: parseLocalNote,
    normalizeTagDefinitions
  });
  const restored = parsed.notes[0].note;
  assert.equal(restored.createdAt, note.createdAt);
  assert.equal(restored.localCreatedAt, note.localCreatedAt);
  assert.equal(restored.updatedAt, note.updatedAt);
  assert.equal(restored.bodyUpdatedAt, note.bodyUpdatedAt);
  assert.equal(restored.localSavedAt, note.localSavedAt);
});

test("タグ定義の正規化処理がないバックアップ生成は明示的に失敗する", () => {
  assert.throws(
    () => buildPortableBackupFiles({ manifest: manifest(), tagDefinitions: [{ id: "ai", name: "AI" }] }),
    /タグ定義の正規化処理が指定されていないため、安全なバックアップを生成できません/
  );
});

test("正規化処理を通したタグ定義0件は空のtags.jsonとして保存する", () => {
  const files = buildPortableBackupFiles({ manifest: manifest(), tagDefinitions: [], normalizeTagDefinitions });
  const tagsFile = files.find((file) => file.name === "tags.json");
  assert.ok(tagsFile);
  assert.deepEqual(JSON.parse(tagsFile.content), []);
});

test("v2バックアップはローカル保存と共通の論理構造を出力する", () => {
  const note = {
    id: "note-1", title: "日本語メモ", body: "![図](attachment://asset-1)", collectionId: "child",
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z",
    isFlagged: true, deletedAt: null, tags: [" Work ", "work", "資料", null, undefined], explanations: [{ text: "説明" }]
  };
  const markdown = serializeLocalNote(note, note.body, [{ id: "asset-1", fileName: "asset-1.png", mimeType: "image/png", kind: "image" }]);
  const files = buildPortableBackupFiles({
    manifest: manifest(), collections: [{ id: "child", name: "子", parentId: "root", sortOrder: 1 }],
    tagDefinitions: [{ id: "unused", name: "未使用", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" }],
    notePlans: [{ fileName: "日本語--note-1.md", markdown }], assetPlans: [{ fileName: "asset-1.png", data: Uint8Array.of(1, 2) }],
    normalizeTagDefinitions
  });
  assert.deepEqual(files.map((file) => file.name), ["manifest.json", "collections.json", "tags.json", "notes/日本語--note-1.md", "assets/asset-1.png"]);
  assert.deepEqual(JSON.parse(files[2].content), [{ id: "unused", name: "未使用", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", color: tagColorFromId("unused") }]);
  assert.match(files[0].content, new RegExp(`"format": "${BACKUP_FORMAT}"`));
  assert.match(files[0].content, new RegExp(`"version": ${BACKUP_VERSION}`));
  assert.match(markdown, /tags: \["work","資料"\]/);
  assert.match(markdown, /attachments: \[\{"id":"asset-1"/);
});

test("ZIP往復でタグを保持し、タグなし旧メモは空配列として復元する", () => {
  const taggedMarkdown = serializeLocalNote({ id: "tagged", title: "タグ付き", tags: ["Alpha", " ALPHA ", "資料", null, undefined], updatedAt: "2026-08-02T00:00:00.000Z" }, "本文");
  const legacyMarkdown = "---\nmemoNexusId: \"legacy\"\ntitle: \"旧形式\"\nupdatedAt: \"2026-08-02T00:00:00.000Z\"\n---\n\n本文";
  const parsed = parsePortableBackup([
    entry("manifest.json", JSON.stringify(manifest())), entry("collections.json", "[]"),
    entry("notes/tagged.md", taggedMarkdown), entry("notes/legacy.md", legacyMarkdown)
  ], { parseNote: parseLocalNote, normalizeTagDefinitions });
  const byId = new Map(parsed.notes.map((plan) => [plan.note.id, plan.note]));
  assert.deepEqual(byId.get("tagged").tags, ["alpha", "資料"]);
  assert.deepEqual(byId.get("legacy").tags, []);
});

test("tags.jsonは未使用タグを含め、ID・表示名・日時を往復する", () => {
  const sourceDefinitions = [
    { id: " AI ", name: " AI ", color: "#3f7fa6", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" },
    { id: "unused", name: "未使用", createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" }
  ];
  const expectedDefinitions = [
    { id: "ai", name: "AI", color: "#3f7fa6", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" },
    { id: "unused", name: "未使用", color: tagColorFromId("unused"), createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" }
  ];
  const files = buildPortableBackupFiles({ manifest: manifest(), tagDefinitions: sourceDefinitions, normalizeTagDefinitions });
  assert.deepEqual(JSON.parse(files.find((file) => file.name === "tags.json").content), expectedDefinitions);
  const parsed = parsePortableBackup(files.map((file) => entry(file.name, file.content)), { parseNote: parseLocalNote, normalizeTagDefinitions });
  assert.equal(parsed.tagsFilePresent, true);
  assert.deepEqual(parsed.tags, expectedDefinitions);
  assert.equal(parsed.tags.find((tag) => tag.id === "ai").name, "AI");
  assert.equal(parsed.tags.find((tag) => tag.id === "unused").name, "未使用");
});

test("破損・重複タグ定義を安全にスキップする", () => {
  const parsed = parsePortableBackup([
    entry("manifest.json", JSON.stringify(manifest())),
    entry("collections.json", "[]"),
    entry("tags.json", JSON.stringify([
      { id: "", name: "空" },
      { id: "AI", name: "AI", createdAt: "invalid", updatedAt: "invalid" },
      { id: "ai", name: "重複" },
      null
    ]))
  ], { parseNote: parseLocalNote, normalizeTagDefinitions });
  assert.deepEqual(parsed.tags, [{ id: "ai", name: "AI", color: tagColorFromId("ai"), createdAt: null, updatedAt: null }]);
  assert.deepEqual(parsed.skipped, ["tags.json:1", "tags.json:3", "tags.json:4"]);
});

test("完全バックアップは有効色を維持し、色なし・不正色を自動色で復元する", () => {
  const source = [
    { id: "valid", name: "有効", color: "#8064a2" },
    { id: "legacy", name: "旧形式" },
    { id: "unsafe", name: "不正", color: "rgba(0,0,0,0)" }
  ];
  const files = buildPortableBackupFiles({ manifest: manifest(), tagDefinitions: source, normalizeTagDefinitions });
  const parsed = parsePortableBackup(files.map((file) => entry(file.name, file.content)), { parseNote: parseLocalNote, normalizeTagDefinitions });
  const colors = new Map(parsed.tags.map((tag) => [tag.id, tag.color]));
  assert.equal(colors.get("valid"), "#8064a2");
  assert.equal(colors.get("legacy"), tagColorFromId("legacy"));
  assert.equal(colors.get("unsafe"), tagColorFromId("unsafe"));
});

test("tags.jsonがないv1バックアップはメモタグから定義を冪等に補完できる", () => {
  const markdown = serializeLocalNote({ id: "legacy", title: "旧形式", tags: ["AI", "ai", "資料"] }, "本文");
  const parsed = parsePortableBackup([
    entry("manifest.json", JSON.stringify({ ...manifest(), version: 1, formatVersion: 1 })),
    entry("collections.json", "[]"),
    entry("notes/legacy.md", markdown)
  ], { parseNote: parseLocalNote, normalizeTagDefinitions });
  const first = mergeTagDefinitionsFromNotes(parsed.tags, parsed.notes.map((plan) => plan.note), "2026-08-16T00:00:00.000Z");
  const second = mergeTagDefinitionsFromNotes(first, parsed.notes.map((plan) => plan.note), "2026-08-17T00:00:00.000Z");
  assert.equal(parsed.tagsFilePresent, false);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((tag) => [tag.id, tag.name]), [["ai", "ai"], ["資料", "資料"]]);
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
