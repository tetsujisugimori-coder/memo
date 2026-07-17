"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");

test("共通ペインとアクセシブルな開閉操作を持つ", () => {
  assert.match(html, /id="memoPaneBtn"[^>]*aria-controls="memoSidebar"[^>]*aria-expanded="false"/);
  assert.match(html, /id="cardPaneBtn"[^>]*aria-controls="previewCard"[^>]*aria-expanded="true"/);
  assert.match(html, /id="layoutBackdrop"[^>]*aria-label="開いているパネルを閉じる"[^>]*hidden/);
  assert.equal((html.match(/id="memoSidebar"/g) || []).length, 1);
  assert.equal((html.match(/id="previewCard"/g) || []).length, 1);
});

test("コンテナ幅から3モードを判定しモード変更時に既定状態へ戻す", () => {
  assert.match(css, /container:\s*app-width\s*\/\s*inline-size/);
  assert.match(css, /@container app-width \(max-width: 1039\.98px\)/);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)/);
  assert.match(app, /if \(width < 720\) return "mobile";\s*if \(width < 1040\) return "compact";\s*return "wide";/);
  assert.match(app, /memoPaneOpen = false;\s*mobileCardOpen = false;\s*compactCardVisible = true;/);
});

test("Compactカード収納とMobile左右ドロワーの排他制御を行う", () => {
  assert.match(css, /body\.compact-card-hidden \.preview-card\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /body\.mobile-card-open \.preview-card\s*\{[^}]*transform:\s*translateX\(0\)/s);
  assert.match(app, /if \(memoPaneOpen\) \{\s*mobileCardOpen = false;/s);
  assert.match(app, /if \(mobileCardOpen\) \{\s*memoPaneOpen = false;/s);
  assert.match(app, /event\.key === "Escape" && closeLayoutOverlays\(\)/);
  assert.match(app, /layoutBackdrop\.addEventListener\("click", \(\) => closeLayoutOverlays\(\)\)/);
});

test("メモ選択で一覧ドロワーを閉じ、背景の誤操作を抑止する", () => {
  assert.match(app, /openNote\(note\.id\);\s*setMemoPaneOpen\(false, \{ restoreFocus: false \}\);/);
  assert.match(app, /memoSidebar\.inert = !sidebarVisible;/);
  assert.match(app, /editorCard\.inert = overlayOpen;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.sidebar,[^}]*\.preview-card,/s);
});
