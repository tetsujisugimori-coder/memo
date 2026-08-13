const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const popup = fs.readFileSync("extensions/web-clipper/popup.js", "utf8");
const background = fs.readFileSync("extensions/web-clipper/background.js", "utf8");
const manifest = fs.readFileSync("extensions/web-clipper/manifest.json", "utf8");

test("確認画面は画像プレビュー、個別選択、全選択・全解除を持つ", () => {
  assert.match(html, /id="webClipImagesSection"[\s\S]*id="selectAllWebClipImagesBtn"[\s\S]*id="clearAllWebClipImagesBtn"[\s\S]*id="webClipImagesList"/);
  assert.match(app, /function renderWebClipImages\(\)/);
  assert.match(app, /data-web-clip-image-index/);
  assert.match(app, /画像を保存できませんでした/);
  assert.match(html, /id="saveWebClipTextOnlyBtn"/);
  assert.match(app, /保存可能\$\{ready\.length\}件・選択\$\{selected\.length\}件/);
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
  assert.match(popup, /chrome\.runtime\.sendMessage/);
  assert.doesNotMatch(popup, /func:\s*MemoNexusClipImageFetcher\.fetchClipImages/);
  assert.match(background, /fetchImagesForMessage/);
  assert.match(background, /return true/);
  assert.match(popup, /mode === "link"[\s\S]*images: \[\]/);
  assert.match(manifest, /"unlimitedStorage"/);
  assert.match(manifest, /"http:\/\/\*\/\*"/);
  assert.match(manifest, /"https:\/\/\*\/\*"/);
});

test("選択画像の保存失敗では確認画面を維持し、本文のみ保存を明示選択できる", () => {
  assert.match(app, /error\.imageFailures = imageFailures/);
  assert.match(app, /renderWebClipImages\(\)/);
  assert.match(app, /saveWebClip\(\{ textOnly: true \}\)/);
  assert.match(app, /deleteAttachmentRecords\(prepared\.map/);
});

test("同一URLの再クリップは既存メモの更新または新規保存を選べ、失敗画像だけ再試行できる", () => {
  assert.match(html, /id="webClipExistingNoteSection"[\s\S]*webClipSaveMode[\s\S]*value="update"[\s\S]*value="new"/);
  assert.match(html, /id="retryFailedWebClipImagesBtn"/);
  assert.match(app, /normalizeWebClipComparisonUrl/);
  assert.match(app, /db\.transaction\(\[STORE_NAME, ATTACHMENT_STORE_NAME\], "readwrite"\)/);
  assert.match(app, /previousWebClipAttachments/);
  assert.match(app, /memo-nexus-web-clip-retry-images/);
  assert.match(app, /画像なしで保存/);
});

test("展開読み込み版のmanifestとREADMEの現在版は一致する", () => {
  const readme = fs.readFileSync("extensions/web-clipper/README.md", "utf8");
  const version = JSON.parse(manifest).version;
  assert.ok(readme.includes(`ローカル開発版\`${version}\``));
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
