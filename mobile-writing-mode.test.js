"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");

test("執筆モード専用の上部ヘッダーと独自保存表示を持たない", () => {
  ["mobileWritingHeader", "mobileWritingTitle", "mobileWritingSaveStatus"].forEach((id) => {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`));
    assert.doesNotMatch(app, new RegExp(id));
  });
  assert.doesNotMatch(css, /\.mobile-writing-(?:header|title|save-status)/);
  assert.doesNotMatch(app, /function updateMobileWritingHeader\(/);
});

test("執筆モードの常設ツールは追加・画像・AI・記法ガイド・完了の5項目", () => {
  const toolbar = html.match(/<div id="mobileWritingTools"[\s\S]*?<\/div>\s*<div class="note-meta-bar"/)?.[0] || "";
  assert.match(toolbar, />追加<\/summary>[\s\S]*data-mobile-editor-tool="insertImageBlockBtn"[^>]*>画像<\/button>[\s\S]*>AI<\/summary>[\s\S]*data-mobile-editor-tool="syntaxGuideBtn"[^>]*>記法ガイド<\/button>[\s\S]*id="mobileWritingDoneBtn"[^>]*>完了<\/button>/);
  assert.match(css, /body\.mobile-writing-mode \.mobile-writing-tools\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.mobile-writing-tools button,[\s\S]*white-space:\s*nowrap;[\s\S]*word-break:\s*keep-all;/s);
});

test("720px未満ではフォーカス前から既存ツール欄を非表示にする", () => {
  assert.match(css, /\.editor-tools\s*\{[^}]*display:\s*flex;/s);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)\s*\{[\s\S]*?\.editor-tools\s*\{\s*display:\s*none;/s);
});

test("追加・AI・画像・記法ガイドは既存ボタンの処理へ委譲する", () => {
  [
    "insertTableBtn", "insertCalloutBtn", "addExplanationBtn", "calculatorLinkBtn",
    "insertImageBlockBtn", "aiSummarizeNoteBtn", "aiSendSelectionBtn", "syntaxGuideBtn"
  ].forEach((id) => assert.match(html, new RegExp(`data-mobile-editor-tool="${id}"`)));
  assert.match(app, /function runMobileEditorTool\(targetId\)[\s\S]*target\.click\(\);/);
  assert.match(app, /mobileCalloutTypeSelect\.value = calloutTypeSelect\.value/);
  assert.match(app, /calloutTypeSelect\.value = mobileCalloutTypeSelect\.value/);
});

test("本文フォーカスで入り完了で戻り、blurでは終了しない", () => {
  assert.match(app, /editor\.addEventListener\("focus",[\s\S]*setMobileWritingMode\(true\)/);
  assert.match(app, /mobileWritingDoneBtn\.addEventListener\("click", \(\) => setMobileWritingMode\(false\)\)/);
  assert.match(app, /editor\.addEventListener\("blur", stopEditorCaretAnimation\)/);
  assert.doesNotMatch(app, /editor\.addEventListener\("blur",[^\n]*setMobileWritingMode\(false\)/);
});

test("執筆中は既存コンテキストパネルを閉じ、完了時に元の開閉状態へ戻す", () => {
  assert.match(app, /mobileWritingPreviousContextPanelOpen = contextPanelOpen/);
  assert.match(app, /if \(contextPanelOpen\) setContextPanelOpen\(false, \{ restoreFocus: false, explicit: false \}\)/);
  assert.match(app, /if \(restoreContextPanel\) setContextPanelOpen\(true, \{ restoreFocus: false, explicit: false \}\)/);
});

test("既存720px境界だけでモバイルに限定しデスクトップでは非表示", () => {
  const modeSource = app.match(/function layoutModeForWidth\(width\) \{[\s\S]*?\n\}/)?.[0] || "";
  const layoutModeForWidth = Function(`${modeSource}; return layoutModeForWidth;`)();
  [320, 375, 390, 430, 719].forEach((width) => assert.equal(layoutModeForWidth(width), "mobile"));
  assert.equal(layoutModeForWidth(720), "compact");
  assert.equal(layoutModeForWidth(1040), "wide");
  assert.match(css, /\.mobile-writing-tools\s*\{\s*display:\s*none;/s);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)[\s\S]*body\.mobile-writing-mode \.workspace/s);
});

test("選択範囲・本文スクロールをツール操作前後で復元する", () => {
  assert.match(app, /function captureMobileEditorContext\(\)[\s\S]*rememberEditorSelectionRange\(\)[\s\S]*scrollTop:\s*editor\.scrollTop/s);
  assert.match(app, /function restoreMobileEditorContext\(\)[\s\S]*editor\.focus\(\{ preventScroll: true \}\)[\s\S]*editor\.setSelectionRange\(range\.start, range\.end\)[\s\S]*editor\.scrollTop = context\.scrollTop/s);
  assert.match(app, /mobileWritingTools\.addEventListener\("pointerdown"[\s\S]*captureMobileEditorContext\(\)/);
});

test("別メモ・削除・デスクトップ移行で執筆モードを解除する", () => {
  assert.match(app, /mobileWritingModeNoteId !== id\) setMobileWritingMode\(false\)/);
  assert.match(app, /if \(layoutMode !== "mobile"\) setMobileWritingMode\(false\)/);
  assert.match(app, /const confirmed = confirm[\s\S]*if \(!confirmed\) return;[\s\S]*setMobileWritingMode\(false\)/);
});

test("dvh・上左右safe area・内部スクロールでiPhoneの可変表示領域を使う", () => {
  assert.match(css, /body\.mobile-writing-mode \.workspace\s*\{[^}]*height:\s*100dvh;[^}]*padding:\s*env\(safe-area-inset-top\)\s+env\(safe-area-inset-right\)\s+0\s+env\(safe-area-inset-left\)/s);
  assert.match(css, /body\.mobile-writing-mode #editor\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(css, /\.mobile-writing-menu-panel\s*\{[^}]*width:\s*min\(280px, calc\(100vw - 16px\)\);[^}]*max-height:\s*min\(56dvh, 360px\)/s);
});

test("下部safe areaはツールバーだけが一度担当する", () => {
  const workspaceRule = css.match(/body\.mobile-writing-mode \.workspace\s*\{([^}]*)\}/s)?.[1] || "";
  const toolbarRule = css.match(/body\.mobile-writing-mode \.mobile-writing-tools\s*\{([^}]*)\}/s)?.[1] || "";
  assert.doesNotMatch(workspaceRule, /safe-area-inset-bottom/);
  assert.match(toolbarRule, /padding:\s*4px\s+8px\s+max\(4px, env\(safe-area-inset-bottom\)\)/);
  assert.equal((`${workspaceRule}\n${toolbarRule}`.match(/safe-area-inset-bottom/g) || []).length, 1);
});

test("独自保存状態を削除し、既存の保存入口を変更しない", () => {
  assert.doesNotMatch(app, /updateMobileWritingHeader|mobileWritingSaveStatus/);
  assert.match(app, /async function saveCurrentNote\(\)[\s\S]*applyCurrentEditorDraft\(note\);[\s\S]*flushScheduledNoteSave\(note\.id\)/);
  const writingModeSource = app.match(/function setMobileWritingMode\(open\) \{[\s\S]*?return shouldOpen;\s*\}/)?.[0] || "";
  assert.doesNotMatch(writingModeSource, /(?:flushSave|saveCurrentNote|enqueueNoteSave)\(/);
});
