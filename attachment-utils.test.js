"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MAX_ATTACHMENT_TOTAL_BYTES,
  attachmentCapacity,
  buildMemoExportBundle,
  classifyAttachment,
  formatAttachmentBytes,
  uniqueAttachmentFileName
} = require("./attachment-utils.js");

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
