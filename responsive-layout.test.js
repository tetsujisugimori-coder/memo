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

test("画面配置用CSSの配信キャッシュを更新する", () => {
  assert.match(html, /style\.css\?v=0\.5\.0-73/);
  assert.match(html, /layout-resize-utils\.js\?v=0\.5\.0-2/);
  assert.match(html, /app\.js\?v=0\.5\.0-136/);
  assert.ok(html.indexOf("layout-resize-utils.js") < html.indexOf("app.js"));
});

test("狭幅ではタイトル日時と保存状態を重ねず一段へ収める", () => {
  assert.match(css, /@media \(max-width: 719\.98px\)[\s\S]*\.title-content\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /@media \(max-width: 719\.98px\)[\s\S]*\.note-meta\s*\{[^}]*flex-direction:\s*row[^}]*flex-wrap:\s*nowrap/s);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.save-status-actions\s*\{[^}]*flex:\s*0 0 auto[^}]*flex-wrap:\s*nowrap/s);
  assert.match(css, /\.save-status-actions > \.save-status-group\s*\{\s*display:\s*none/);
  assert.match(css, /\.combined-save-status\s*\{\s*display:\s*inline-flex/);
});

test("右側コンテキストパネルは空白帯のない第2列とモバイルドロワーを持つ", () => {
  assert.match(html, /id="contextPanel" class="context-panel"/);
  assert.match(app, /let contextPanelTab = "collection"/);
  assert.match(app, /setContextPanelTab\("collection"/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) var\(--context-panel-width, 340px\)/);
  assert.doesNotMatch(css, /grid-template-columns:\s*minmax\(0, 1fr\) 10px var\(--context-panel-width/);
  assert.match(css, /body\.context-panel-closed\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /\.context-panel\.context-panel-closed\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width: 719\.98px\)[\s\S]*?width:\s*100vw/);
});

test("広幅の2境界はARIA付きセパレーターとしてGridへ組み込まれる", () => {
  const editorSeparator = html.match(/<div id="editorCardSeparator"[^>]*>/)?.[0] || "";
  const contextSeparator = html.match(/<div id="contextPanelSeparator"[^>]*>/)?.[0] || "";
  for (const separator of [editorSeparator, contextSeparator]) {
    assert.match(separator, /role="separator"/);
    assert.match(separator, /aria-orientation="vertical"/);
    assert.match(separator, /aria-label="[^"]+"/);
    assert.match(separator, /tabindex="0"/);
  }
  assert.match(css, /grid-template-columns:\s*var\(--editor-column-width, minmax\(320px, 1fr\)\) 16px minmax\(280px, 1fr\)/);
  assert.doesNotMatch(css, /minmax\(280px, 0\.8fr\)/);
  assert.match(css, /\.workspace-separator\s*\{[^}]*grid-column:\s*2[^}]*width:\s*10px/s);
  assert.match(css, /\.context-panel-separator\s*\{[^}]*grid-column:\s*2[^}]*width:\s*10px[^}]*justify-self:\s*start[^}]*transform:\s*translateX\(-50%\)[^}]*z-index:/s);
  assert.match(css, /\.context-panel\s*\{[^}]*grid-column:\s*2/s);
  assert.match(css, /body\[data-layout-mode="wide"\] > \.context-panel\s*\{[^}]*border-left:\s*0/s);
});

test("セパレーターはwide限定で、右側欄閉鎖時とpopoutでは操作不能になる", () => {
  assert.match(css, /body\[data-layout-mode="wide"\] \.workspace-separator\s*\{\s*display:\s*block/s);
  assert.match(css, /body\[data-layout-mode="wide"\]:not\(\.context-panel-closed\) > \.context-panel-separator\s*\{\s*display:\s*block/s);
  assert.match(css, /body\.popout-window \.layout-separator/);
  assert.match(app, /const wideActive = layoutMode === "wide" && !isPopoutWindow/);
  assert.match(app, /\[contextPanelSeparator, wideActive && contextPanelOpen\]/);
  assert.match(app, /separator\.tabIndex = active \? 0 : -1/);
  assert.match(app, /separator\.setAttribute\("aria-disabled", String\(!active\)\)/);
});

test("Pointer Capture、選択抑止、終了保証を伴って列幅だけをフレーム更新する", () => {
  assert.match(app, /event\.button !== 0/);
  assert.match(app, /separator\.setPointerCapture\(event\.pointerId\)/);
  assert.match(app, /separator\.releasePointerCapture\(resize\.pointerId\)/);
  assert.match(app, /requestAnimationFrame\(\(\) => \{[\s\S]*?applyLayoutResizePointer/);
  assert.match(app, /pointercancel[\s\S]*?finishLayoutResize\(\{ cancel: true \}\)/);
  assert.match(app, /event\.key !== "Escape" \|\| !activeLayoutResize/);
  assert.match(app, /event\.shiftKey \? 3 : 1/);
  assert.match(css, /body\.layout-resizing\s*\{[^}]*user-select:\s*none/s);
});

test("矢印キーとダブルクリックは個別の幅を制約内で変更・初期化して保存する", () => {
  assert.match(app, /event\.key !== "ArrowLeft" && event\.key !== "ArrowRight"/);
  assert.match(app, /changeLayoutWidthFromKeyboard\(kind,[\s\S]*?persistLayoutResizeWidths\(kind\)/);
  assert.match(app, /separator\.addEventListener\("dblclick", \(\) => resetLayoutWidth\(kind\)\)/);
  assert.match(app, /if \(kind === "editor"\) layoutResizeWidths\.editorWidth = null;[\s\S]*?DEFAULT_CONTEXT_PANEL_WIDTH/);
  assert.match(app, /commitLayoutWidthsForKind\([\s\S]*?layoutResizeWidths,[\s\S]*?appliedLayoutResizeWidths,[\s\S]*?kind/);
  assert.match(app, /localStorage\.setItem\(LAYOUT_RESIZE_STORAGE_KEY, JSON\.stringify\(layoutResizeWidths\)\)/);
});

test("右境界の操作領域は最大幅計算で占有幅として減算されない", () => {
  const rangeSource = app.match(/function currentContextPanelWidthRange\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(rangeSource, /calculateContextPanelRange\(\s*document\.body\.clientWidth,\s*workspaceMinimumWidth\s*\)/s);
  assert.doesNotMatch(rangeSource, /,\s*10\s*\)/);
});

test("desktop has one memo list owner and no fixed blank context column when closed", () => {
  assert.match(app, /contextPanel\.append\(collectionExplorer, tagPanel, aiPanel, memoSidebar\)/);
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

test("viewport幅から3モードを判定しSafari互換の同一境界を使う", () => {
  assert.doesNotMatch(css, /@container app-width/);
  assert.match(css, /@media \(max-width: 1039\.98px\)/);
  assert.match(css, /@media \(max-width: 719\.98px\)/);
  assert.match(app, /if \(width < 720\) return "mobile";\s*if \(width < 1040\) return "compact";\s*return "wide";/);
  assert.match(app, /mobileCardOpen = false;\s*compactCardVisible = true;/);

  const modeFunctionSource = app.match(/function layoutModeForWidth\(width\) \{[\s\S]*?\n\}/)?.[0] || "";
  const layoutModeForWidth = Function(`${modeFunctionSource}; return layoutModeForWidth;`)();
  assert.equal(layoutModeForWidth(719), "mobile");
  assert.equal(layoutModeForWidth(720), "compact");
  assert.equal(layoutModeForWidth(1039), "compact");
  assert.equal(layoutModeForWidth(1040), "wide");
});

test("モバイルはsafe area対応viewportと折りたたみ主要操作を持つ", () => {
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover"/);
  assert.match(html, /id="mobileAppMenu" class="mobile-app-menu" open/);
  assert.match(html, /<summary aria-label="その他の操作を開く">その他<\/summary>/);
  assert.match(app, /mobileAppMenu\.open = layoutMode !== "mobile"/);
  assert.match(app, /layoutMode === "mobile" && event\.target\.closest\("button"\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /padding:\s*0 env\(safe-area-inset-right\) env\(safe-area-inset-bottom\) env\(safe-area-inset-left\)/);
});

test("モバイルの関連メモとNEX-2は本文外の下段へ置く", () => {
  assert.match(css, /\.related-toggle\s*\{[^}]*position:\s*static[^}]*grid-row:\s*2/s);
  assert.match(css, /\.ai-robot-button\s*\{[^}]*position:\s*static[^}]*grid-row:\s*2/s);
  assert.match(css, /\.ai-robot-status::before\s*\{\s*content:\s*"NEX-2 · "/s);
  assert.match(css, /body\.collections-open:not\(\.context-panel-closed\) \.context-panel/);
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
