"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("表示設定は小・標準・大を持ち永続化処理へ接続する", () => {
  assert.match(html, /id="imageBlockSizeSelect"[\s\S]*value="small"[\s\S]*value="medium" selected[\s\S]*value="large"/);
  assert.match(app, /const IMAGE_BLOCK_SIZE_STORAGE_KEY = "memo-nexus-image-block-size"/);
  assert.match(app, /normalizeImageBlockSize\(localStorage\.getItem\(IMAGE_BLOCK_SIZE_STORAGE_KEY\)\)/);
  assert.match(app, /localStorage\.setItem\(IMAGE_BLOCK_SIZE_STORAGE_KEY, imageBlockSize\)/);
});

test("サイズ別の上限と縦横比維持をCSSで適用する", () => {
  assert.match(css, /\.image-block\.image-size-small img\s*\{[^}]*max-height:\s*200px/s);
  assert.match(css, /\.image-block\.image-size-medium img\s*\{[^}]*max-height:\s*350px/s);
  assert.match(css, /\.image-block\.image-size-large img\s*\{[^}]*max-height:\s*min\(620px, 70vh\)/s);
  assert.match(css, /\.image-block \.inline-attachment-image img\s*\{[^}]*max-width:\s*100%;[^}]*height:\s*auto;[^}]*object-fit:\s*contain/s);
  assert.doesNotMatch(css, /\.image-block[^}]*object-fit:\s*cover/s);
});

test("1枚の説明文レイアウトと2枚グリッドを狭幅で縦並びへ戻す", () => {
  assert.match(css, /image-count-1\.has-caption\.image-size-small[\s\S]*35fr[\s\S]*65fr/);
  assert.match(css, /image-count-1\.has-caption\.image-size-medium[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /image-count-2 \.image-block-media\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /@container \(max-width: 560px\)[\s\S]*image-count-2 \.image-block-media[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("画像ブロック操作は追加上限・入れ替え・説明文・参照削除へ接続する", () => {
  assert.match(app, /count < 2 \? '<button class="image-block-add"/);
  assert.match(app, /count === 2 \? '<button class="image-block-swap"/);
  assert.match(app, /openImageCaptionEditor/);
  assert.match(app, /block\.images\.filter\(\(_, index\) => index !== imageIndex\)/);
  assert.match(app, /元データは削除されません/);
});
