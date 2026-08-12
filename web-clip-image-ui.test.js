const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const popup = fs.readFileSync("extensions/web-clipper/popup.js", "utf8");
const manifest = fs.readFileSync("extensions/web-clipper/manifest.json", "utf8");

test("確認画面は画像プレビュー、個別選択、全選択・全解除を持つ", () => {
  assert.match(html, /id="webClipImagesSection"[\s\S]*id="selectAllWebClipImagesBtn"[\s\S]*id="clearAllWebClipImagesBtn"[\s\S]*id="webClipImagesList"/);
  assert.match(app, /function renderWebClipImages\(\)/);
  assert.match(app, /data-web-clip-image-index/);
  assert.match(app, /画像を保存できませんでした/);
});

test("取得画像は既存の添付保存と画像ブロック直列化へ接続する", () => {
  assert.match(app, /prepareAttachmentFile\(webClipImageBlob\(image\), "image", memoId\)/);
  assert.match(app, /putAttachments\(prepared\)/);
  assert.match(app, /serializeImageBlock\(/);
  assert.match(app, /attachment\.source = \{[\s\S]*type: "web-clip"/);
});

test("拡張はページ・選択画像を取得し、リンクのみでは画像を渡さない", () => {
  assert.match(popup, /extractPageContent/);
  assert.match(popup, /extractSelectionContent/);
  assert.match(popup, /MemoNexusClipImageFetcher\.fetchClipImages/);
  assert.match(popup, /mode === "link"[\s\S]*images: \[\]/);
  assert.match(manifest, /"unlimitedStorage"/);
});

test("確認画面はモバイルで1列になり内部スクロールする", () => {
  assert.match(css, /\.web-clip-images-list[^}]*overflow:\s*auto/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.web-clip-images-list\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test("Memo-NexusのMarkdown ZIPを画像付きで再取り込みできる入口を持つ", () => {
  assert.match(html, /id="settingsImportMarkdownZipBtn"[\s\S]*id="importMarkdownZipInput"/);
  assert.match(app, /function importMarkdownZip\(file\)/);
  assert.match(app, /buildMarkdownBundleImport/);
});
