"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("下部ステータスバーに操作可能な文字数チップと詳細統計を置く", () => {
  assert.match(html, /id="textStatsBtn"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);
  assert.match(html, /id="textStatsPopover"[^>]*role="dialog"[^>]*hidden/);
  assert.match(html, /text-stats-utils\.js\?v=0\.4\.0-1/);
  assert.match(css, /\.text-stats-button\s*\{[^}]*min-height:\s*24px/s);
  assert.match(css, /\.text-stats-popover\s*\{[^}]*width:\s*min\(360px, calc\(100vw - 32px\)\)/s);
});

test("本文更新とキーボード・外側クリックで文章統計を制御する", () => {
  assert.match(app, /function renderTextStats\(\)/);
  assert.match(app, /function setTextStatsOpen\(open\)/);
  assert.match(app, /function scheduleSave\([\s\S]*?renderTextStats\(\)/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /document\.addEventListener\("pointerdown"/);
});
