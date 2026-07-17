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

test("メモ一覧の表示範囲はサイドバー内に置き上部バーへ残さない", () => {
  const sidebar = html.match(/<aside id="memoSidebar"[\s\S]*?<\/aside>/)?.[0] || "";
  const appHeader = html.match(/<header class="app-header">[\s\S]*?<\/header>/)?.[0] || "";
  assert.match(sidebar, /id="memoListScopeLabel"[^>]*>すべてのメモ<\/span>/);
  assert.doesNotMatch(appHeader, /memoListScopeLabel|currentCollectionLabel|current-collection/);
  assert.doesNotMatch(html, /id="currentCollectionLabel"/);
  assert.match(css, /\.memo-list-scope\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
});

test("コンテナ幅から3モードを判定しモード変更時に既定状態へ戻す", () => {
  assert.match(css, /container:\s*app-width\s*\/\s*inline-size/);
  assert.match(css, /@container app-width \(max-width: 1039\.98px\)/);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)/);
  assert.match(app, /if \(width < 720\) return "mobile";\s*if \(width < 1040\) return "compact";\s*return "wide";/);
  assert.match(app, /memoPaneOpen = false;\s*mobileCardOpen = false;\s*compactCardVisible = true;/);

  const modeFunctionSource = app.match(/function layoutModeForWidth\(width\) \{[\s\S]*?\n\}/)?.[0] || "";
  const layoutModeForWidth = Function(`${modeFunctionSource}; return layoutModeForWidth;`)();
  assert.equal(layoutModeForWidth(719), "mobile");
  assert.equal(layoutModeForWidth(720), "compact");
  assert.equal(layoutModeForWidth(1039), "compact");
  assert.equal(layoutModeForWidth(1040), "wide");
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
