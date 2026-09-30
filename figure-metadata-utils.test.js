"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { hasFigureMetadata, parseFigureMetadata, safeFigureSourceUrl, serializeFigureMetadata } = require("./figure-metadata-utils.js");
const { serializeImageBlock, splitImageBlocks, replaceImageBlock } = require("./attachment-utils.js");
const { buildMemoExportBundle } = require("./attachment-utils.js");
const { buildMarkdownBundleImport } = require("./markdown-bundle-utils.js");

const metadata = {
  caption: "武田信玄像 <資料> & 説明", dateLabel: "永禄12年", sourceName: "山梨県立博物館",
  sourceUrl: `https://example.org/source?${"長".repeat(500)}&x=1`, sourceType: "primary",
  license: "CC BY-SA 4.0", note: "第1行\n第2行 <注記>"
};

test("資料情報7項目を画像ごとに本文へ保存し、再読込で完全一致する", () => {
  const body = serializeImageBlock([{ id: "first", alt: "一枚目", figureMetadata: metadata }, { id: "second", alt: "二枚目" }], "既存の説明文");
  const [block] = splitImageBlocks(body);
  assert.equal(block.type, "image");
  assert.deepEqual(block.images[0].figureMetadata, metadata);
  assert.equal(block.images[1].figureMetadata, undefined);
  assert.equal(block.caption, "既存の説明文");
  assert.equal(serializeImageBlock(block.images, block.caption), body);
});

test("旧画像、一部入力、全空欄、URLなしを許容する", () => {
  const oldBody = serializeImageBlock([{ id: "old", alt: "旧画像" }]);
  assert.doesNotMatch(oldBody, /figure-metadata/);
  assert.equal(splitImageBlocks(oldBody)[0].images[0].figureMetadata, undefined);
  const partial = serializeImageBlock([{ id: "old", alt: "旧画像", figureMetadata: { caption: "図", note: "補足" } }]);
  assert.equal(splitImageBlocks(partial)[0].images[0].figureMetadata.caption, "図");
  assert.equal(splitImageBlocks(partial)[0].images[0].figureMetadata.sourceUrl, "");
  assert.equal(serializeImageBlock([{ id: "old", figureMetadata: {} }]), serializeImageBlock([{ id: "old" }]));
  assert.equal(hasFigureMetadata({}), false);
  const legacyInline = "![旧画像](attachment://legacy-id)";
  const [legacyBlock] = splitImageBlocks(legacyInline);
  const upgraded = replaceImageBlock(legacyInline, legacyBlock, [{ ...legacyBlock.images[0], figureMetadata: { caption: "旧画像の資料" } }]);
  assert.equal(splitImageBlocks(upgraded).find((block) => block.type === "image").images[0].figureMetadata.caption, "旧画像の資料");
});

test("再編集、入替、削除で資料情報を元の画像とともに保持する", () => {
  const body = serializeImageBlock([{ id: "a", figureMetadata: metadata }, { id: "b", figureMetadata: { caption: "B" } }]);
  const [block] = splitImageBlocks(body);
  const updated = replaceImageBlock(body, block, [block.images[1], { ...block.images[0], figureMetadata: { ...metadata, caption: "再編集" } }]);
  const [swapped] = splitImageBlocks(updated);
  assert.equal(swapped.images[0].figureMetadata.caption, "B");
  assert.equal(swapped.images[1].figureMetadata.caption, "再編集");
  const removed = replaceImageBlock(updated, swapped, [swapped.images[1]]);
  assert.equal(splitImageBlocks(removed)[0].images[0].figureMetadata.caption, "再編集");
  assert.equal(splitImageBlocks(removed)[0].images.length, 1);
});

test("安全な出典URLのみリンクにできる", () => {
  assert.equal(safeFigureSourceUrl("https://example.org/path"), "https://example.org/path");
  assert.equal(safeFigureSourceUrl("http://example.org/"), "http://example.org/");
  for (const value of ["javascript:alert(1)", "data:text/html,hi", "https://", "https://example.org\n<script>"])
    assert.equal(safeFigureSourceUrl(value), "");
  assert.equal(parseFigureMetadata(serializeFigureMetadata({ caption: "<script>alert(1)</script>" })).caption, "<script>alert(1)</script>");
});

test("Markdown ZIP用の書き出しと取込で画像と資料情報を保持する", () => {
  const body = serializeImageBlock([{ id: "asset-1", alt: "図", figureMetadata: metadata }]);
  const bundle = buildMemoExportBundle({
    markdownPath: "report.md", markdownContent: body,
    attachments: [{ id: "asset-1", fileName: "figure.png", kind: "image", blob: new Uint8Array([1, 2, 3]) }]
  });
  const markdown = bundle.files.find((file) => file.name.endsWith(".md")).content;
  assert.match(markdown, /figure-metadata/);
  const entries = bundle.files.map((file) => ({ name: file.name, data: file.content instanceof Uint8Array ? file.content : new TextEncoder().encode(file.content) }));
  const [imported] = buildMarkdownBundleImport(entries, () => "new-asset");
  assert.equal(imported.attachments.length, 1);
  assert.equal(splitImageBlocks(imported.body)[0].images[0].id, "new-asset");
  assert.deepEqual(splitImageBlocks(imported.body)[0].images[0].figureMetadata, metadata);
});
