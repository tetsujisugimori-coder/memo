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
  assert.match(app, /void nextIcon\.offsetWidth/);
  assert.match(app, /nextIcon\.classList\.remove\(animationClass\)/);
  assert.match(app, /prefers-reduced-motion: reduce/);
});

test("タイトル操作部と日時は上段、フラグ・文字数・保存状態は下部バーに分離する", () => {
  assert.match(html, /<div class="title-side">[\s\S]*<div class="title-actions"[\s\S]*<div class="title-content">[\s\S]*<div class="title-input-wrap">[\s\S]*id="noteMeta"/);
  assert.match(css, /\.title-row\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.title-side-head\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/s);
  assert.match(css, /\.title-actions\s*\{[^}]*display:\s*flex/s);
  assert.match(html, /id="localSaveStatusBtn"[\s\S]*id="browserSaveStatusBtn"/);
  assert.match(html, /class="note-meta-actions"[\s\S]*id="noteFlagBtn"[\s\S]*id="textStatsBtn"/);
  assert.match(css, /\.save-status-actions\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.note-flag-button\s*\{[^}]*width:\s*40px[^}]*min-height:\s*40px/s);
  assert.match(css, /\.note-flag-button\.is-flagged::before\s*\{[^}]*width:\s*32px[^}]*height:\s*32px/s);
  assert.match(css, /\.note-flag-icon\.flag-rises\s*\{[^}]*animation:/s);
  assert.doesNotMatch(css, /\.note-flag-button\.flag-rises\s*\{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("タイトルのフォーカス枠は専用ラッパーだけに収める", () => {
  assert.match(html, /<div class="title-input-wrap"><input id="titleInput"/);
  assert.match(css, /\.title-input-wrap\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.title-input-wrap\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.title-input-wrap:focus-within\s*\{[^}]*border-color:\s*var\(--accent\)/s);
  assert.doesNotMatch(css, /\.title-input:focus,/);
  assert.match(css, /\.title-input\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(app, /ブラウザ \$\{browser\.label\}/);
  assert.doesNotMatch(app, /function isNarrowSaveStatus\(\)/);
});

test("フラグ・文書統計と保存状態はエディタ末尾へ置き、日時はタイトルだけに置く", () => {
  assert.match(html, /<div id="tableBlockEditors"[\s\S]*<div class="note-meta-bar"[\s\S]*<div class="note-meta-actions"[\s\S]*id="noteFlagBtn"[\s\S]*id="textStatsBtn"[\s\S]*id="browserSaveStatusBtn"/);
  assert.ok(html.indexOf('id="browserSaveStatusBtn"') > html.indexOf('<div id="tableBlockEditors"'));
  assert.ok(html.indexOf('id="noteMeta"') < html.indexOf('id="editor"'));
  assert.equal((html.match(/id="noteMeta"/g) || []).length, 1);
  assert.doesNotMatch(html, /別ウィンドウで更新があります/);
  assert.match(css, /\.note-meta-bar\s*\{[^}]*border-top:[^}]*display:\s*flex[^}]*justify-content:\s*space-between/s);
  assert.match(css, /\.note-meta-actions\s*\{[^}]*display:\s*flex[^}]*gap:\s*6px/s);
  assert.match(app, /function renderSaveStatus\(\)/);
});
