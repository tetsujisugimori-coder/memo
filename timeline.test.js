"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeTimeline, serializeTimelineBlock, splitTimelineBlocks, replaceTimelineBlock } = require("./timeline-block-utils.js");
const { serializeImageBlock, splitImageBlocks, replaceImageBlock, buildMemoExportBundle, remapImportedAttachmentReferences } = require("./attachment-utils.js");
const { withSources, parseSourceDocument, extractCitations } = require("./source-utils.js");
const { serializeLocalNote, parseLocalNote } = require("./local-markdown.js");
const { buildMarkdownBundleImport } = require("./markdown-bundle-utils.js");
const { buildPortableBackupFiles, parsePortableBackup, BACKUP_VERSION } = require("./backup-bundle-utils.js");
const { buildManifest } = require("./local-sync-utils.js");
const { normalizeTagDefinitions } = require("./tags.js");
const metadata = { caption: "資料図", dateLabel: "昭和", sourceName: "資料館", sourceUrl: "https://example.org/資料", sourceType: "primary", license: "CC BY", note: "補足" };
const timeline = { id: "timeline-a", title: "歴史 <script> 😀", description: "説明\n二行目", items: [
  { id: "item-a", dateLabel: "1945–1952", title: "出来事A", body: "本文 **太字** [@source-a]", figureId: "figure-a", citationIds: ["source-a", "source-b"] },
  { id: "item-b", dateLabel: "初期開発期", title: "出来事B", body: "本文B", figureId: "", citationIds: [] }
] };
const figure = serializeImageBlock([{ id: "asset-a", alt: "図A", figureMetadata: metadata }], "共通説明", "left", "normal", "figure-a");
const sources = [{ id: "source-a", title: "一次資料" }, { id: "source-b", title: "二次資料" }];
const body = withSources(figure + "\n" + serializeTimelineBlock(timeline), sources);
const timelineOf = (text) => splitTimelineBlocks(text).find((block) => block.type === "timeline").timeline;
const imageOf = (text) => splitImageBlocks(text).find((block) => block.type === "image");
const entry = (name, content) => ({ name, data: typeof content === "string" ? new TextEncoder().encode(content) : content });

test("Timelineの全フィールド・複数項目・自由な年代文字列を順序どおり往復する", () => {
  assert.deepEqual(timelineOf(body), timeline);
  assert.deepEqual(timelineOf(JSON.parse(JSON.stringify({ body })).body), timeline);
  for (const dateLabel of ["1945", "1945-08-15", "1951年9月", "1945–1952", "2026 Q3", "初期開発期"]) {
    const value = { ...timeline, items: [{ ...timeline.items[0], dateLabel }] };
    assert.equal(timelineOf(serializeTimelineBlock(value)).items[0].dateLabel, dateLabel);
  }
  assert.doesNotMatch(serializeTimelineBlock(timeline), /<script>|\[@/);
});
test("項目並べ替え・削除とTimeline置換は周辺本文と共通Sourceを維持する", () => {
  const original = "前文\n" + body + "\n後文";
  const block = splitTimelineBlocks(original).find((item) => item.type === "timeline");
  const reversed = { ...timeline, items: [...timeline.items].reverse() };
  const next = replaceTimelineBlock(original, block, reversed);
  assert.deepEqual(timelineOf(next), reversed);
  assert.deepEqual(parseSourceDocument(next).sources, parseSourceDocument(body).sources);
  assert.equal(imageOf(next).raw, figure);
  assert.match(next, /^前文\n/);
  assert.match(next, /\n後文$/);
  assert.throws(() => replaceTimelineBlock("changed" + original, block, timeline), /更新/);
  assert.equal(splitTimelineBlocks(replaceTimelineBlock(original, block, null)).filter((item) => item.type === "timeline").length, 0);
});
test("欠落値と重複IDは安全に扱い、空Timelineも往復する", () => {
  assert.deepEqual(normalizeTimeline({ id: "timeline-old" }), { id: "timeline-old", title: "", description: "", items: [] });
  assert.equal(normalizeTimeline({ id: "bad id" }), null);
  const value = normalizeTimeline({ id: "t", items: [{ id: "i", citationIds: ["s", "s", "bad id"] }, { id: "i" }, null] });
  assert.equal(value.items.length, 1);
  assert.deepEqual(value.items[0], { id: "i", title: "", dateLabel: "", body: "", figureId: "", citationIds: ["s"] });
  assert.deepEqual(timelineOf(serializeTimelineBlock({ id: "empty" })), normalizeTimeline({ id: "empty" }));
});
test("不正・将来版マーカーとコードフェンス内のTimelineは本文として残す", () => {
  for (const payload of ["zz", "f", "ff", "7b7d", Buffer.from(JSON.stringify({ version: 2, timeline })).toString("hex")]) {
    const raw = "前文\n<!-- memo-nexus:timeline-v1:" + payload + " -->\n後文";
    const segments = splitTimelineBlocks(raw);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].text, raw);
  }
  const marker = serializeTimelineBlock(timeline);
  for (const delimiter of [String.fromCharCode(96).repeat(3), "~~~"]) {
    const text = delimiter + "\n" + marker + "\n" + delimiter;
    assert.equal(splitTimelineBlocks(text)[0].text, text);
  }
});
test("Timeline引用は本文引用と共通Sourceを参照し、コード中の引用は除外する", () => {
  assert.deepEqual(extractCitations(body), ["source-a", "source-a", "source-b"]);
  const value = { ...timeline, items: [{ ...timeline.items[0], body: String.fromCharCode(96) + "[@hidden]" + String.fromCharCode(96), citationIds: ["source-a"] }] };
  assert.deepEqual(extractCitations(withSources(serializeTimelineBlock(value), sources)), ["source-a"]);
  assert.deepEqual(parseSourceDocument(body).sources.map((source) => source.id), ["source-a", "source-b"]);
});
test("項目内の未閉じコードフェンスは選択Citationや次項目の参照を隠さない", () => {
  const value = { ...timeline, items: [{ ...timeline.items[0], body: String.fromCharCode(96).repeat(3) + "\n[@hidden]" }, timeline.items[1]] };
  assert.deepEqual(extractCitations(serializeTimelineBlock(value) + "\n[@outside]"), ["source-a", "source-b", "outside"]);
});
test("Figure IDは既存メタデータ・比較設定・画像編集・添付ID再割当後も維持する", () => {
  let block = imageOf(body);
  assert.equal(block.figureId, timeline.items[0].figureId);
  const changed = replaceImageBlock(body, block, [{ ...block.images[0], figureMetadata: { ...metadata, caption: "変更" } }, { id: "asset-b", alt: "図B", comparisonLabel: "後" }], "説明", "right", "comparison");
  block = imageOf(changed);
  assert.equal(block.figureId, "figure-a");
  assert.equal(block.displayMode, "comparison");
  assert.equal(block.images[0].figureMetadata.caption, "変更");
  const remapped = remapImportedAttachmentReferences(changed, [{ sourceId: "asset-a", id: "new-asset" }]);
  assert.equal(imageOf(remapped).images[0].id, "new-asset");
  assert.equal(imageOf(remapped).figureId, timelineOf(remapped).items[0].figureId);
});
test("Timelineのない旧メモ・旧Figure・Comparisonは変更せず再直列化できる", () => {
  const old = withSources(serializeImageBlock([{ id: "old-a", alt: "旧図", figureMetadata: metadata }, { id: "old-b", comparisonLabel: "後" }], "旧説明", "center", "comparison"), sources);
  assert.ok(splitTimelineBlocks(old).every((segment) => segment.type === "text"));
  assert.equal(imageOf(old).figureId, undefined);
  for (const invalid of [null, {}, [], false]) assert.equal(imageOf(serializeImageBlock([{ id: "old-a" }], "", "center", "normal", invalid)).figureId, undefined);
  assert.equal(serializeImageBlock(imageOf(old).images, imageOf(old).caption, "center", "comparison"), parseSourceDocument(old).body);
});
test("ローカルMarkdownの保存・復元でTimelineと全参照が同じ状態へ戻る", () => {
  const markdown = serializeLocalNote({ id: "note-a", title: "年表" }, body, [{ id: "asset-a", kind: "image", fileName: "asset.png", mimeType: "image/png" }]);
  const parsed = parseLocalNote(markdown, { assets: [{ path: "../assets/asset.png", id: "asset-a" }] });
  assert.equal(parsed.body, body);
  assert.deepEqual(timelineOf(parsed.body), timeline);
  assert.equal(imageOf(parsed.body).figureId, "figure-a");
});
test("Markdown ZIPで添付IDが変わってもTimelineから同じFigureとSourceを参照できる", () => {
  const files = buildMemoExportBundle({ markdownPath: "年表.md", markdownContent: body, attachments: [{ id: "asset-a", fileName: "asset.png", kind: "image", blob: Uint8Array.of(1, 2, 3) }] }).files;
  const restored = buildMarkdownBundleImport(files.map((file) => entry(file.name, file.content)), () => "new-asset")[0];
  assert.deepEqual(timelineOf(restored.body), timeline);
  const block = imageOf(restored.body);
  assert.equal(block.figureId, timelineOf(restored.body).items[0].figureId);
  assert.deepEqual(block.images[0].figureMetadata, metadata);
  assert.equal(block.images[0].id, "new-asset");
  assert.equal(restored.attachments[0].id, block.images[0].id);
  assert.deepEqual(parseSourceDocument(restored.body).sources, parseSourceDocument(body).sources);
});
for (const version of [1, 2, 3, 4]) test("完全バックアップv" + version + "の復元でTimeline・Figure・引用を保持する", () => {
  const manifest = { ...buildManifest({ appVersion: "0.5.0", savedAt: "2026-10-02T00:00:00Z" }), version, formatVersion: version };
  const files = buildPortableBackupFiles({ manifest: { ...manifest, version: 4, formatVersion: 4 },
    notePlans: [{ fileName: "timeline.md", markdown: serializeLocalNote({ id: "note-a", title: "年表" }, body, [{ id: "asset-a", kind: "image", fileName: "asset.png", mimeType: "image/png" }]) }],
    assetPlans: [{ id: "asset-a", fileName: "asset.png", data: Uint8Array.of(1, 2, 3) }], normalizeTagDefinitions });
  files.find((file) => file.name === "manifest.json").content = JSON.stringify(manifest);
  const parsed = parsePortableBackup(files.map((file) => entry(file.name, file.content)), { parseNote: parseLocalNote, normalizeTagDefinitions, idFactory: () => "restored-asset" });
  assert.equal(BACKUP_VERSION, 4);
  assert.equal(parsed.sourceVersion, version);
  assert.deepEqual(timelineOf(parsed.notes[0].note.body), timeline);
  assert.equal(imageOf(parsed.notes[0].note.body).figureId, "figure-a");
  assert.deepEqual(imageOf(parsed.notes[0].note.body).images[0].figureMetadata, metadata);
  assert.deepEqual(extractCitations(parsed.notes[0].note.body), ["source-a", "source-a", "source-b"]);
});
