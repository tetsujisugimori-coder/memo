"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MAX_ATTACHMENT_TOTAL_BYTES,
  attachmentCapacity,
  attachmentMarkdownReference,
  buildMemoExportBundle,
  classifyAttachment,
  createKeyedSerialQueue,
  extractAttachmentReferenceIds,
  findAttachmentReference,
  formatAttachmentBytes,
  insertAttachmentReferences,
  normalizeImageBlockSize,
  renderImageCaptionMarkdown,
  replaceImageBlock,
  saveAttachmentAdditionWithRollback,
  serializeImageBlock,
  splitImageBlocks,
  uniqueAttachmentFileName
} = require("./attachment-utils.js");

test("GIFを既存画像添付として分類する", () => {
  assert.equal(classifyAttachment({ name: "animated.gif", type: "image/gif", size: 128 }), "image");
});

function mockFile(name, type, size = 100) {
  return { name, type, size };
}

test("JPEG、PNG、WebP、PDFをMIMEと拡張子の両方で判定する", () => {
  assert.equal(classifyAttachment(mockFile("photo.JPG", "image/jpeg")), "image");
  assert.equal(classifyAttachment(mockFile("screen.png", "image/png")), "image");
  assert.equal(classifyAttachment(mockFile("image.webp", "image/webp")), "image");
  assert.equal(classifyAttachment(mockFile("document.pdf", "application/pdf")), "pdf");
  assert.throws(() => classifyAttachment(mockFile("fake.png", "text/html")), /対応していない形式/);
  assert.throws(() => classifyAttachment(mockFile("fake.pdf", "image/png")), /対応していない形式/);
  assert.throws(() => classifyAttachment(mockFile("vector.svg", "image/svg+xml")), /対応していない形式/);
});

test("20MBちょうどを許可し、1byte超過を拒否する", () => {
  assert.equal(attachmentCapacity(10, MAX_ATTACHMENT_TOTAL_BYTES - 10).allowed, true);
  const exceeded = attachmentCapacity(10, MAX_ATTACHMENT_TOTAL_BYTES - 9);
  assert.equal(exceeded.allowed, false);
  assert.equal(exceeded.exceededBy, 1);
  assert.equal(formatAttachmentBytes(MAX_ATTACHMENT_TOTAL_BYTES), "20.0 MB");
});

test("複数追加は合計容量を一括判定する", () => {
  const result = attachmentCapacity(12 * 1024 * 1024, 9 * 1024 * 1024);
  assert.equal(result.allowed, false);
  assert.equal(result.total, 21 * 1024 * 1024);
});

test("同一メモへの連続追加を直列化し、2回目の20MB超過を拒否する", async () => {
  const enqueue = createKeyedSerialQueue();
  let storedBytes = 0;
  const add = (bytes) => enqueue("memo-1", async () => {
    const capacity = attachmentCapacity(storedBytes, bytes);
    await Promise.resolve();
    if (!capacity.allowed) return false;
    storedBytes = capacity.total;
    return true;
  });

  const results = await Promise.all([
    add(12 * 1024 * 1024),
    add(9 * 1024 * 1024)
  ]);

  assert.deepEqual(results, [true, false]);
  assert.equal(storedBytes, 12 * 1024 * 1024);
});

test("添付ファイル名は同一フォルダ内で _2 形式の連番を付ける", () => {
  const used = new Set();
  assert.equal(uniqueAttachmentFileName("image.png", used), "image.png");
  assert.equal(uniqueAttachmentFileName("Image.png", used), "Image_2.png");
  assert.equal(uniqueAttachmentFileName("image.png", used), "image_3.png");
});

test("添付付きメモのMarkdown参照と実ファイル名を一致させる", () => {
  const imageBlob = new Blob(["image"], { type: "image/png" });
  const pdfBlob = new Blob(["pdf"], { type: "application/pdf" });
  const bundle = buildMemoExportBundle({
    markdownPath: "プログラミング/会議メモ.md",
    markdownContent: "# 会議メモ\n",
    attachments: [
      { kind: "image", fileName: "capture.png", blob: imageBlob },
      { kind: "image", fileName: "Capture.png", blob: imageBlob },
      { kind: "pdf", fileName: "資料.pdf", blob: pdfBlob }
    ]
  });
  assert.equal(bundle.folderPath, "プログラミング/会議メモ");
  assert.deepEqual(bundle.files.map((file) => file.name), [
    "プログラミング/会議メモ/会議メモ.md",
    "プログラミング/会議メモ/attachments/capture.png",
    "プログラミング/会議メモ/attachments/Capture_2.png",
    "プログラミング/会議メモ/attachments/資料.pdf"
  ]);
  const markdown = bundle.files[0].content;
  assert.match(markdown, /!\[capture\.png\]\(<attachments\/capture\.png>\)/);
  assert.match(markdown, /!\[Capture_2\.png\]\(<attachments\/Capture_2\.png>\)/);
  assert.match(markdown, /- \[資料\.pdf\]\(<attachments\/資料\.pdf>\)/);
  assert.equal(bundle.files[1].content, imageBlob);
});

test("添付なしメモは従来のMarkdownパスと本文を維持する", () => {
  const bundle = buildMemoExportBundle({
    markdownPath: "歴史/無題のメモ.md",
    markdownContent: "本文",
    attachments: []
  });
  assert.deepEqual(bundle.files, [{ name: "歴史/無題のメモ.md", content: "本文" }]);
});

test("画像参照はblob URLを使わず永続IDで生成する", () => {
  const reference = attachmentMarkdownReference({ id: "image-id-1", fileName: "図解.png" });
  assert.equal(reference, "![図解.png](attachment://image-id-1)");
  assert.doesNotMatch(reference, /blob:/);
  assert.deepEqual(findAttachmentReference(`前${reference}後`, 0), {
    start: 1,
    end: 35,
    alt: "図解.png",
    id: "image-id-1"
  });
});

test("文章の先頭・中間・末尾へ画像参照を挿入できる", () => {
  const image = { id: "image-id", kind: "image", fileName: "画像.png" };
  const block = serializeImageBlock([image]);
  assert.equal(insertAttachmentReferences("本文", 0, 0, [image]).value, `${block}\n本文`);
  assert.equal(insertAttachmentReferences("前後", 1, 1, [image]).value, `前\n${block}\n後`);
  assert.equal(insertAttachmentReferences("本文", 2, 2, [image]).value, `本文\n${block}`);
});

test("複数画像の参照と参照中IDを扱える", () => {
  const result = insertAttachmentReferences("説明", 2, 2, [
    { id: "first-id", kind: "image", fileName: "one.png" },
    { id: "second-id", kind: "image", fileName: "two.png" },
    { id: "pdf-id", kind: "pdf", fileName: "doc.pdf" }
  ]);
  assert.equal(result.value, `説明\n${serializeImageBlock([
    { id: "first-id", fileName: "one.png" },
    { id: "second-id", fileName: "two.png" }
  ])}`);
  assert.deepEqual([...extractAttachmentReferenceIds(result.value)], ["first-id", "second-id"]);
});

test("既存の画像参照内部へ貼り付けても参照記法を分断しない", () => {
  const existing = "![one.png](attachment://first-id)後";
  const result = insertAttachmentReferences(existing, 4, 4, [
    { id: "second-id", kind: "image", fileName: "two.png" }
  ]);
  assert.equal(result.value, `![one.png](attachment://first-id)\n${serializeImageBlock([
    { id: "second-id", fileName: "two.png" }
  ])}\n後`);
  assert.deepEqual([...extractAttachmentReferenceIds(result.value)], ["first-id", "second-id"]);
});

test("エクスポート時に本文内画像参照を実ファイル相対パスへ変換する", () => {
  const imageBlob = new Blob(["image"], { type: "image/png" });
  const bundle = buildMemoExportBundle({
    markdownPath: "説明.md",
    markdownContent: "前\n\n![図](attachment://image-id)\n\n後",
    attachments: [{ id: "image-id", kind: "image", fileName: "図.png", blob: imageBlob }]
  });
  assert.match(bundle.files[0].content, /前\n\n!\[図\]\(<attachments\/図\.png>\)\n\n後/);
  assert.equal((bundle.files[0].content.match(/!\[図\]/g) || []).length, 1);
  assert.doesNotMatch(bundle.files[0].content, /attachment:\/\//);
});

test("カード内画像サイズは3値だけを許可し標準へフォールバックする", () => {
  assert.equal(normalizeImageBlockSize("small"), "small");
  assert.equal(normalizeImageBlockSize("medium"), "medium");
  assert.equal(normalizeImageBlockSize("large"), "large");
  assert.equal(normalizeImageBlockSize("huge"), "medium");
  assert.equal(normalizeImageBlockSize(undefined), "medium");
});

test("画像2枚と共通説明文を標準Markdownが読める形式で保存・復元する", () => {
  const markdown = serializeImageBlock([
    { id: "before-id", alt: "変更前" },
    { id: "after-id", alt: "変更後" }
  ], "**比較結果**\n\n- 左が変更前\n- 右が変更後");
  assert.match(markdown, /!\[変更前\]\(attachment:\/\/before-id\)/);
  assert.match(markdown, /!\[変更後\]\(attachment:\/\/after-id\)/);
  assert.match(markdown, /\*\*比較結果\*\*/);
  const [block] = splitImageBlocks(markdown);
  assert.equal(block.type, "image");
  assert.deepEqual(block.images.map((image) => image.id), ["before-id", "after-id"]);
  assert.equal(block.caption, "**比較結果**\n\n- 左が変更前\n- 右が変更後");
});

test("既存の単独画像参照を説明文なしの画像ブロックとして遅延解釈する", () => {
  const segments = splitImageBlocks("前\n![既存](attachment://legacy-id)\n後");
  const block = segments.find((segment) => segment.type === "image");
  assert.deepEqual(block.images, [{ id: "legacy-id", alt: "既存" }]);
  assert.equal(block.caption, "");
  assert.equal(block.explicit, false);
});

test("既存の連続画像2枚を別々の1枚ブロックとして解釈する", () => {
  const segments = splitImageBlocks([
    "![画像1](attachment://legacy-one)",
    "![画像2](attachment://legacy-two)"
  ].join("\n")).filter((segment) => segment.type === "image");
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map((segment) => segment.images.map((image) => image.id)), [
    ["legacy-one"],
    ["legacy-two"]
  ]);
  assert.deepEqual(segments.map((segment) => segment.explicit), [false, false]);
});

test("コードフェンス内の画像参照や専用コメントとは衝突しない", () => {
  const markdown = [
    "```markdown",
    "<!-- memo-nexus:image-block -->",
    "![例](attachment://sample-id)",
    "<!-- /memo-nexus:image-block -->",
    "```"
  ].join("\n");
  assert.deepEqual(splitImageBlocks(markdown), [{ type: "text", text: markdown, start: 0, end: markdown.length }]);
});

test("画像の入れ替えと2枚から1枚への削除で説明文を維持する", () => {
  const source = serializeImageBlock([
    { id: "left-id", alt: "左" },
    { id: "right-id", alt: "右" }
  ], "共通説明");
  const block = splitImageBlocks(source)[0];
  const swapped = replaceImageBlock(source, block, [...block.images].reverse(), block.caption);
  assert.deepEqual(splitImageBlocks(swapped)[0].images.map((image) => image.id), ["right-id", "left-id"]);
  const swappedBlock = splitImageBlocks(swapped)[0];
  const reduced = replaceImageBlock(swapped, swappedBlock, [swappedBlock.images[0]], swappedBlock.caption);
  assert.deepEqual(splitImageBlocks(reduced)[0].images.map((image) => image.id), ["right-id"]);
  assert.equal(splitImageBlocks(reduced)[0].caption, "共通説明");
});

test("3枚の挿入は最大2枚ずつの画像ブロックへ分割する", () => {
  const result = insertAttachmentReferences("", 0, 0, [
    { id: "one", kind: "image", fileName: "1.png" },
    { id: "two", kind: "image", fileName: "2.png" },
    { id: "three", kind: "image", fileName: "3.png" }
  ]);
  const blocks = splitImageBlocks(result.value).filter((segment) => segment.type === "image");
  assert.deepEqual(blocks.map((block) => block.images.length), [2, 1]);
});

test("2枚目追加の保存後検証に失敗した場合は今回の添付だけをロールバックする", async () => {
  const storedIds = ["existing-id"];
  const additions = [{ id: "new-image-id" }];
  let validationCount = 0;
  await assert.rejects(() => saveAttachmentAdditionWithRollback({
    attachments: additions,
    validate: () => {
      validationCount += 1;
      if (validationCount === 2) throw new Error("画像ブロックが変更されました");
    },
    save: async (items) => storedIds.push(...items.map((item) => item.id)),
    apply: async () => assert.fail("保存後検証に失敗した場合は本文へ適用しない"),
    rollback: async (items) => {
      const rollbackIds = new Set(items.map((item) => item.id));
      for (let index = storedIds.length - 1; index >= 0; index -= 1) {
        if (rollbackIds.has(storedIds[index])) storedIds.splice(index, 1);
      }
    }
  }), /画像ブロックが変更されました/);
  assert.equal(validationCount, 2);
  assert.deepEqual(storedIds, ["existing-id"]);
});

test("説明文は許可したMarkdownだけを安全なHTMLとして描画する", () => {
  const html = renderImageCaptionMarkdown([
    "**太字**、*斜体*、`code`、[公式](https://example.com)",
    "<img src=x onerror=alert(1)>",
    "[危険](javascript:alert(1))",
    "- 1行目",
    "- 2行目"
  ].join("\n"));
  assert.match(html, /<strong>太字<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<code class="inline-code">code<\/code>/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /<ul><li>1行目<\/li><li>2行目<\/li><\/ul>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img|href="javascript:/i);
  assert.match(html, /\[危険\]\(javascript:alert\(1\)\)/);
});
