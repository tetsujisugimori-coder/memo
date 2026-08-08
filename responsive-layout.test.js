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

test("本文入力欄の後ろに表ブロック編集領域と境界余白を置く", () => {
  const editorCard = html.match(/<section class="editor-card">[\s\S]*?<\/section>/)?.[0] || "";
  const editorIndex = editorCard.indexOf('id="editor"');
  const tableEditorsIndex = editorCard.indexOf('id="tableBlockEditors"');

  assert.ok(editorIndex >= 0);
  assert.ok(tableEditorsIndex > editorIndex);
  assert.match(css, /\.table-block-editors\s*\{[^}]*margin-top:\s*10px;[^}]*border-top:\s*1px solid var\(--line\);/s);
  assert.doesNotMatch(css, /\.table-block-editors\s*\{[^}]*border-bottom:/s);
});

test("Mermaid表示用CSSの配信キャッシュを更新する", () => {
  assert.match(html, /style\.css\?v=0\.4\.0-33/);
});

test("右側コンテキストパネルは単一の固定列とモバイルドロワーを持つ", () => {
  assert.match(html, /id="contextPanel" class="context-panel"/);
  assert.match(app, /let contextPanelTab = "collection"/);
  assert.match(app, /setContextPanelTab\("collection"/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) 340px/);
  assert.match(css, /body\.context-panel-closed\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /\.context-panel\.context-panel-closed\s*\{\s*display:\s*none/);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)[\s\S]*?width:\s*100vw/);
});

test("desktop has one memo list owner and no fixed blank context column when closed", () => {
  assert.match(app, /contextPanel\.append\(collectionExplorer, aiPanel, memoSidebar\)/);
  assert.doesNotMatch(html, /newMemosPanel|contextNewMemosTab/);
  assert.match(css, /body\.context-panel-closed\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(app, /document\.body\.classList\.toggle\("context-panel-closed", !contextPanelOpen\)/);
});

test("memo selection closes only the narrow drawer and preserves wide context state", () => {
  assert.match(app, /openNote\(note\.id\);\s*if \(layoutMode !== "wide"\)/s);
  assert.match(app, /setContextPanelOpen\(false, \{ restoreFocus: false, explicit: false \}\)/);
  assert.match(app, /let contextPanelUserClosed = false/);
  assert.match(app, /layoutMode === "wide" && !contextPanelOpen && !contextPanelUserClosed/);
});

test("AIタブからメモ一覧へ戻ると旧AIドロワー状態を残さない", () => {
  assert.match(app, /setAiAssistantPanelActive\(nextTab === "ai"\)/);
  assert.match(app, /function setAiAssistantPanelActive\(active\) \{[\s\S]*?document\.body\.classList\.toggle\("ai-open", aiAssistantState\.panelOpen\)/);
  assert.doesNotMatch(app, /memoPaneOpen/);
  assert.doesNotMatch(css, /body\.ai-open \.sidebar/);
});

test("狭幅の右コンテキストパネルをオーバーレイとして閉じる", () => {
  const responsiveUi = app.match(/function updateResponsiveLayoutUi\([\s\S]*?function focusLayoutPanel/)?.[0] || "";
  const closeOverlays = app.match(/function closeLayoutOverlays\([\s\S]*?function updateResponsiveLayoutUi/)?.[0] || "";
  assert.match(responsiveUi, /const contextPanelOverlayOpen = layoutMode !== "wide" && contextPanelOpen;/);
  assert.match(responsiveUi, /const overlayOpen = contextPanelOverlayOpen \|\| \(layoutMode === "mobile" && mobileCardOpen\);/);
  assert.match(responsiveUi, /layoutBackdrop\.hidden = !overlayOpen;/);
  assert.match(responsiveUi, /editorCard\.inert = overlayOpen;/);
  assert.match(responsiveUi, /previewCard\.inert = !cardVisible \|\| contextPanelOverlayOpen;/);
  assert.match(closeOverlays, /layoutMode !== "wide" && contextPanelOpen[\s\S]*?setContextPanelOpen\(false, \{ restoreFocus \}\)/);
});

test("メモ一覧は単一見出しだけを持ち不要な表示範囲ラベルを残さない", () => {
  const sidebar = html.match(/<aside id="memoSidebar"[\s\S]*?<\/aside>/)?.[0] || "";
  const appHeader = html.match(/<header class="app-header">[\s\S]*?<\/header>/)?.[0] || "";
  assert.match(sidebar, /<strong id="memoListHeading">メモ一覧<\/strong>/);
  assert.doesNotMatch(sidebar, /memoListScopeLabel|currentCollectionLabel/);
  assert.doesNotMatch(css, /\.memo-list-scope|\.current-collection/);
  assert.doesNotMatch(appHeader, /memoListHeading/);
  assert.match(app, /memoListHeading\.textContent = heading;\s*memoSidebar\.setAttribute\("aria-label", heading\);/);
});

test("主要操作はペイン操作の後ろへ左寄せで既存順序のまま並ぶ", () => {
  const appHeader = html.match(/<header class="app-header">[\s\S]*?<\/header>/)?.[0] || "";
  const orderedIds = ["memoPaneBtn", "cardPaneBtn", "newBtn", "collectionsBtn", "todayBtn", "undoBtn", "backupBtn", "linkStatsBtn", "graphBtn", "settingsBtn", "deleteBtn"];
  orderedIds.reduce((previousIndex, id) => {
    const index = appHeader.indexOf(`id="${id}"`);
    assert.ok(index > previousIndex, `${id}の順序が維持されている`);
    return index;
  }, -1);
  assert.match(css, /\.app-header \.toolbar\s*\{[^}]*flex:\s*1;[^}]*justify-content:\s*flex-start;/s);
  assert.match(css, /\.toolbar\s*\{[^}]*overflow-x:\s*auto;/s);
});

test("コンテナ幅から3モードを判定しモード変更時に既定状態へ戻す", () => {
  assert.match(css, /container:\s*app-width\s*\/\s*inline-size/);
  assert.match(css, /@container app-width \(max-width: 1039\.98px\)/);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)/);
  assert.match(app, /if \(width < 720\) return "mobile";\s*if \(width < 1040\) return "compact";\s*return "wide";/);
  assert.match(app, /mobileCardOpen = false;\s*compactCardVisible = true;/);

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
  assert.match(app, /function setMemoListPanelOpen\(open/);
  assert.match(app, /if \(mobileCardOpen\) \{\s*setContextPanelOpen\(false/s);
  assert.match(app, /event\.key === "Escape" && !document\.querySelector\("dialog\[open\]"\) && closeLayoutOverlays\(\)/);
  assert.match(app, /layoutBackdrop\.addEventListener\("click", \(\) => closeLayoutOverlays\(\)\)/);
});

test("メモ選択で一覧ドロワーを閉じ、背景の誤操作を抑止する", () => {
  assert.match(app, /openNote\(note\.id\);\s*if \(layoutMode !== "wide"\) \{\s*setContextPanelOpen\(false/s);
  assert.match(app, /contextPanelTab === "memo-list"/);
  assert.match(app, /editorCard\.inert = overlayOpen;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.sidebar,[^}]*\.preview-card,/s);
});
