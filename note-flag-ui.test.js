"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("旗だけを再マウントして毎回アニメーションを再生する", () => {
  assert.match(html, /class="note-flag-icon"/);
  assert.match(app, /const nextIcon = icon\.cloneNode\(true\)/);
  assert.match(app, /noteFlagBtn\.replaceChild\(nextIcon, icon\)/);
  assert.match(app, /requestAnimationFrame\(\(\) =>/);
  assert.match(app, /nextIcon\.classList\.remove\(animationClass\)/);
  assert.match(app, /prefers-reduced-motion: reduce/);
});

test("タイトル操作部と保存状態は固定領域で、旗だけを変形する", () => {
  assert.match(css, /\.title-side-head\s*\{[^}]*grid-template-columns:\s*30px 30px 30px 126px/s);
  assert.match(css, /\.save-status\s*\{[^}]*width:\s*126px/s);
  assert.match(css, /\.note-flag-icon\.flag-rises\s*\{[^}]*animation:/s);
  assert.doesNotMatch(css, /\.note-flag-button\.flag-rises\s*\{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("タイトルのフォーカス枠は専用ラッパーだけに収める", () => {
  assert.match(html, /<div class="title-input-wrap"><input id="titleInput"/);
  assert.match(css, /\.title-input-wrap\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.title-input-wrap:focus-within\s*\{[^}]*border-color:\s*var\(--accent\)/s);
  assert.doesNotMatch(css, /\.title-input:focus,/);
  assert.match(css, /\.title-input\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(app, /function isNarrowSaveStatus\(\)/);
});
