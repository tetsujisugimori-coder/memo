"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function extractFunction(name) {
  const start = app.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = app.indexOf(") {", start) + 2;
  assert.notEqual(bodyStart, 1, `${name} body should start`);
  let depth = 0;
  for (let index = bodyStart; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }
  assert.fail(`${name} body should close`);
}

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

test("画像ブロック操作は通常非表示のキーボード対応メニューへ収納する", () => {
  assert.match(app, /class="image-block-menu-toggle"[^>]*aria-expanded="false"[^>]*aria-controls=/);
  assert.match(app, /class="image-block-actions"[^>]*hidden/);
  assert.match(app, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /openImageCaptionEditor/);
  assert.match(app, /block\.images\.filter\(\(_, index\) => index !== imageIndex\)/);
  assert.match(app, /元データは削除されません/);
});

test("画像ブロック変更は本文更新後すぐ再描画し保存予約の重複描画を止める", () => {
  const events = [];
  const editor = { value: "before" };
  const commit = new Function(
    "editor",
    "replaceImageBlock",
    "captureUndoSnapshot",
    "renderPreview",
    "scheduleSave",
    "alert",
    `return (${extractFunction("commitImageBlockChange")});`
  )(
    editor,
    () => "after",
    () => events.push("undo"),
    () => events.push(`render:${editor.value}`),
    (options) => events.push(`save:${options.render}`),
    () => assert.fail("正常時にalertしない")
  );
  assert.equal(commit({ start: 0 }, [], "説明"), true);
  assert.equal(editor.value, "after");
  assert.deepEqual(events, ["undo", "render:after", "save:false"]);
});

test("説明文編集時は通常メニューと差し替え、キャンセルで通常状態へ戻る", () => {
  const classes = new Set();
  const menuShell = { hidden: false };
  const figure = {
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    querySelector: (selector) => selector === ".image-block-menu-shell" ? menuShell : null
  };
  const editorPanel = { removed: false, remove() { this.removed = true; } };
  const setEditing = new Function(`return (${extractFunction("setImageCaptionEditing")});`)();
  setEditing(figure, editorPanel, true);
  assert.equal(menuShell.hidden, true);
  assert.equal(classes.has("editing"), true);
  assert.equal(editorPanel.removed, false);
  setEditing(figure, editorPanel, false);
  assert.equal(menuShell.hidden, false);
  assert.equal(classes.has("editing"), false);
  assert.equal(editorPanel.removed, true);
  assert.match(app, /save\.addEventListener\("click", \(\) => commitImageBlockChange/);
});
