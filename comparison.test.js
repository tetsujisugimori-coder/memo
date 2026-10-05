"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { serializeImageBlock, splitImageBlocks, replaceImageBlock, buildMemoExportBundle, extractAttachmentReferenceIds } = require("./attachment-utils.js");
const { serializeLocalNote, parseLocalNote } = require("./local-markdown.js");
const { buildMarkdownBundleImport } = require("./markdown-bundle-utils.js");
const { buildPortableBackupFiles, parsePortableBackup, BACKUP_VERSION } = require("./backup-bundle-utils.js");
const { buildManifest } = require("./local-sync-utils.js");
const { normalizeTagDefinitions } = require("./tags.js");
const { withSources, parseSourceDocument, extractCitations } = require("./source-utils.js");

const metadata = { caption: "肖像図", dateLabel: "昭和初期", sourceName: "資料庫", sourceUrl: "https://example.org/資料", sourceType: "primary", license: "CC BY", note: "補足\n情報" };
const images = [
  { id: "image-a", alt: "図 [A]", comparisonLabel: "変更前 <script> & \" ' 😀", figureMetadata: metadata },
  { id: "image-b", alt: "図B", comparisonLabel: "変更後" }
];
const blockOf = (body) => splitImageBlocks(body).find((block) => block.type === "image");
const entry = (name, content) => ({ name, data: typeof content === "string" ? new TextEncoder().encode(content) : content });

test("日本語ラベル・Figure・既存説明文を比較設定とともに再直列化する", () => {
  const body = serializeImageBlock(images, "**比較全体**\n説明", "left", "comparison");
  const block = blockOf(body);
  assert.equal(block.displayMode, "comparison");
  assert.deepEqual(block.images, images);
  assert.equal(serializeImageBlock(block.images, block.caption, block.alignment, block.displayMode), body);
  assert.equal((body.match(/image-caption/g) || []).length, 1);
  assert.doesNotMatch(body, /<script>/);
});

test("旧Image Blockは通常表示で読込だけでは比較情報を追加しない", () => {
  const old = serializeImageBlock([{ id: "image-a", alt: "旧図", figureMetadata: metadata }], "旧説明");
  const block = blockOf(old);
  assert.equal(block.displayMode, "normal");
  assert.equal(block.images[0].comparisonLabel, undefined);
  assert.equal(serializeImageBlock(block.images, block.caption, block.alignment, block.displayMode), old);
  assert.doesNotMatch(old, /image-mode|image-label/);
  assert.equal(blockOf("![旧図](attachment://image-a)").displayMode, "normal");
});

test("通常表示への復帰、画像入替、片方削除、再追加で画像情報が対応する", () => {
  let body = "前文\n" + serializeImageBlock(images, "共通説明", "right", "comparison") + "\n後文";
  let block = blockOf(body);
  body = replaceImageBlock(body, block, block.images, block.caption, block.alignment, "normal");
  block = blockOf(body);
  assert.equal(block.displayMode, "normal");
  assert.deepEqual(block.images, images);
  body = replaceImageBlock(body, block, [...block.images].reverse(), block.caption, block.alignment, "comparison");
  block = blockOf(body);
  assert.deepEqual(block.images, [...images].reverse());
  body = replaceImageBlock(body, block, block.images.slice(1), block.caption);
  block = blockOf(body);
  assert.equal(block.displayMode, "normal");
  assert.deepEqual(block.images, [images[0]]);
  assert.equal(block.caption, "共通説明");
  body = replaceImageBlock(body, block, [...block.images, images[1]], block.caption);
  assert.equal(blockOf(body).displayMode, "normal", "readding an image does not enable comparison automatically");
  assert.match(body, /^前文\n/);
  assert.match(body, /\n後文$/);
});

test("空欄は既定ラベルを保存せず、長文とマーカー相当の特殊文字を保持する", () => {
  const label = "<!-- /memo-nexus:image-block -->\n![偽図](attachment://fake) " + "長文".repeat(1000);
  const body = serializeImageBlock([{ id: "image-a", comparisonLabel: "  " }, { id: "image-b", comparisonLabel: label }], "", "center", "comparison");
  assert.equal(blockOf(body).images[0].comparisonLabel, undefined);
  assert.equal(blockOf(body).images[1].comparisonLabel, label);
  assert.deepEqual([...extractAttachmentReferenceIds(body)], ["image-a", "image-b"]);
  assert.doesNotMatch(body, /変更前|変更後|image-caption/);
});

for (const invalid of ["nohex", "f", "ff", "7b7d", Buffer.from(JSON.stringify({ version: 2, label: "未来" })).toString("hex"), Buffer.from(JSON.stringify({ version: 1, label: {} })).toString("hex")]) {
  test(`不正な比較ラベルでも本文・画像・Figure・説明文を保つ: ${invalid}`, () => {
    const raw = serializeImageBlock(images, "説明", "center", "comparison").replace(/image-label:[0-9a-f]+/, `image-label:${invalid}`);
    const body = `前文\n${raw}\n後文`;
    const blocks = splitImageBlocks(body);
    assert.equal(blockOf(body).images[0].comparisonLabel, undefined);
    assert.deepEqual(blockOf(body).images[0].figureMetadata, metadata);
    assert.equal(blockOf(body).images[1].comparisonLabel, "変更後");
    assert.equal(blockOf(body).caption, "説明");
    assert.equal(blocks.map((block) => block.type === "image" ? block.raw + "\n" : block.text).join(""), body);
    assert.deepEqual([...extractAttachmentReferenceIds(body)], ["image-a", "image-b"]);
  });
}

test("未知モード・重複モード・1画像の比較設定は通常表示に退避する", () => {
  const raw = serializeImageBlock(images, "説明", "center", "comparison");
  for (const body of [raw.replace("image-mode:comparison", "image-mode:future"), raw.replace("<!-- memo-nexus:image-mode:comparison -->", "<!-- memo-nexus:image-mode:comparison -->\n<!-- memo-nexus:image-mode:comparison -->")]) {
    assert.equal(blockOf(body).displayMode, "normal");
    assert.deepEqual(blockOf(body).images, images);
  }
  assert.equal(blockOf(serializeImageBlock(images.slice(0, 1), "説明", "center", "comparison")).displayMode, "normal");
});

test("Markdown ZIPと完全バックアップv5を画像・Figure・Source/Citationごと往復する", () => {
  const body = withSources(`根拠 [@source-1]\n${serializeImageBlock(images, "全体説明", "center", "comparison")}`, [{ id: "source-1", title: "共通出典", url: "https://example.org/source" }]);
  const attachments = images.map((image, index) => ({ id: image.id, kind: "image", fileName: `image-${index}.png`, blob: Uint8Array.of(1, 2, 3) }));
  const bundle = buildMemoExportBundle({ markdownPath: "比較.md", markdownContent: body, attachments });
  let counter = 0;
  const imported = buildMarkdownBundleImport(bundle.files.map((file) => entry(file.name, file.content)), () => `new-${++counter}`)[0];
  assert.equal(blockOf(imported.body).displayMode, "comparison");
  assert.deepEqual(blockOf(imported.body).images.map(({ comparisonLabel, figureMetadata }) => ({ comparisonLabel, figureMetadata })), images.map(({ comparisonLabel, figureMetadata }) => ({ comparisonLabel, figureMetadata })));
  assert.deepEqual(parseSourceDocument(imported.body).sources, parseSourceDocument(body).sources);
  assert.deepEqual(extractCitations(imported.body), ["source-1"]);
  const markdown = serializeLocalNote({ id: "comparison-note", title: "比較" }, body, attachments.map((item) => ({ ...item, mimeType: "image/png" })));
  const manifest = buildManifest({ appVersion: "0.5.0", savedAt: "2026-10-02T00:00:00Z" });
  assert.equal(manifest.version, 6);
  assert.equal(BACKUP_VERSION, 6);
  const files = buildPortableBackupFiles({ manifest, notePlans: [{ fileName: "comparison.md", markdown }], assetPlans: attachments.map((item) => ({ ...item, data: item.blob })), normalizeTagDefinitions });
  counter = 0;
  const restored = parsePortableBackup(files.map((file) => entry(file.name, file.content)), { parseNote: parseLocalNote, normalizeTagDefinitions, idFactory: () => `restored-${++counter}` });
  assert.equal(restored.notes[0].attachments.length, 2);
  assert.equal(blockOf(restored.notes[0].note.body).displayMode, "comparison");
  assert.deepEqual(blockOf(restored.notes[0].note.body).images.map((image) => image.comparisonLabel), images.map((image) => image.comparisonLabel));
  assert.deepEqual(blockOf(restored.notes[0].note.body).images[0].figureMetadata, metadata);
  assert.deepEqual(parseSourceDocument(restored.notes[0].note.body).sources, parseSourceDocument(body).sources);
  assert.deepEqual(extractCitations(restored.notes[0].note.body), ["source-1"]);
});

for (const version of [1, 2, 3, 4, 5]) test(`完全バックアップv${version}を読み込んでも旧本文・Figure・Sourceに比較情報を追加しない`, () => {
  const body = withSources(`引用 [@source-old]\n${serializeImageBlock([{ id: "old-image", alt: "旧図", figureMetadata: metadata }], "旧説明")}`, [{ id: "source-old", title: "旧出典" }]);
  const manifest = { ...buildManifest({ savedAt: "2026-10-02T00:00:00Z" }), version, formatVersion: version };
  const parsed = parsePortableBackup([
    entry("manifest.json", JSON.stringify(manifest)), entry("collections.json", "[]"), entry("tags.json", "[]"),
    entry("notes/old.md", serializeLocalNote({ id: "old-note", title: "旧メモ" }, body, [{ id: "old-image", fileName: "old-image.png", kind: "image", mimeType: "image/png" }])),
    entry("assets/old-image.png", Uint8Array.of(1, 2, 3))
  ], { parseNote: parseLocalNote, normalizeTagDefinitions, idFactory: () => "old-image" });
  assert.equal(parsed.sourceVersion, version);
  assert.equal(parsed.manifest.version, 6);
  assert.equal(parsed.manifest.formatVersion, 6);
  assert.equal(parsed.notes[0].note.body, body);
  assert.equal(blockOf(parsed.notes[0].note.body).displayMode, "normal");
  assert.deepEqual(blockOf(parsed.notes[0].note.body).images[0].figureMetadata, metadata);
  assert.doesNotMatch(parsed.notes[0].note.body, /image-mode|image-label/);
});
