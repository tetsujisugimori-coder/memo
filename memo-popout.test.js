"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");

test("メモを同じmemoIdのポップアウトURLで開く", () => {
  assert.match(html, /id="popoutMemoBtn"[^>]*別ウィンドウで開く/);
  assert.match(app, /url\.searchParams\.set\("popout", memoId\)/);
  assert.match(app, /window\.open\(popoutUrlForMemo\(note\.id\), `memo-nexus-popout-\$\{note\.id\}`/);
  assert.doesNotMatch(app, /createNote\([^\n]*popout/i);
});

test("保存済みメモをBroadcastChannelで別ウィンドウへ通知する", () => {
  assert.match(app, /new BroadcastChannel\(POPOUT_SYNC_CHANNEL\)/);
  assert.match(app, /memoId: note\.id,[\s\S]*updatedAt: note\.updatedAt/);
  assert.match(app, /notes = await getAllNotes\(\)/);
  assert.match(app, /message\.memoId === popoutMemoId && \(!note \|\| note\.deletedAt\)/);
});

test("ポップアウトはリサイズ可能で、本文専用UIと削除時案内を持つ", () => {
  assert.match(app, /resizable=yes/);
  assert.match(app, /POPOUT_WINDOW_STORAGE_KEY/);
  assert.match(html, /id="popoutUnavailable"/);
  assert.match(css, /body\.popout-window \.app-header,[\s\S]*?\.preview-card/);
  assert.match(css, /body\.popout-window \.title-row\s*\{[\s\S]*?position:\s*sticky/);
});
