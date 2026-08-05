"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const utils = fs.readFileSync("table-block-utils.js", "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf(`function ${name}(`);
  const end = nextName ? app.indexOf(`\nfunction ${nextName}(`, start) : app.indexOf("\nfunction ", start + 10);
  return app.slice(start, end);
}

test("表貼り付けdialogは形式・サイズ・見出し選択と3操作を持つ", () => {
  assert.match(html, /id="tablePasteDialog"[^>]*aria-labelledby="tablePasteTitle"/);
  assert.match(html, /id="tablePasteSummary"/);
  assert.match(html, /id="tablePasteFormat"/);
  assert.match(html, /id="tablePasteHeaderCheckbox"[^>]*type="checkbox"/);
  assert.match(html, /id="confirmTablePasteBtn"[^>]*>表として貼り付け</);
  assert.match(html, /id="pasteTableAsTextBtn"[^>]*>テキストとして貼り付け</);
  assert.match(html, /id="cancelTablePasteBtn"[^>]*>キャンセル</);
});

test("pasteは画像の既存処理後にHTML・Markdown・タブ区切りを判定し通常貼り付けを妨げない", () => {
  const source = functionSource("handleEditorPaste");
  assert.match(source, /handleClipboardAttachmentPaste\(event\)/);
  assert.match(source, /detectPastedTable\(\{[\s\S]*text\/html[\s\S]*text\/plain/);
  assert.match(source, /if \(!detected\) return;/);
  assert.match(source, /editorSelectionIsInsideCodeFence\(\)/);
  assert.match(source, /event\.preventDefault\(\);[\s\S]*openTablePasteDialog/);
  const detectionStart = utils.indexOf("function detectPastedTable(");
  const detectionEnd = utils.indexOf("\n  function validatePastedTableSize", detectionStart);
  const detection = utils.slice(detectionStart, detectionEnd);
  assert.ok(detection.indexOf("parseHtmlTable") < detection.indexOf("parseMarkdownTable"));
  assert.ok(detection.indexOf("parseMarkdownTable") < detection.indexOf("parseTabSeparatedTable"));
  assert.doesNotMatch(utils, /parseCsv|CSV/i);
});

test("コードフェンス内はタブやMarkdown記号を表へ変換せず通常貼り付けへ戻す", () => {
  const source = functionSource("editorSelectionIsInsideCodeFence", "handleEditorPaste");
  assert.match(source, /editor\.value\.slice\(0, editor\.selectionStart\)/);
  assert.match(source, /\^\\s\*```/);
  assert.match(source, /inCodeFence = !inCodeFence/);
});

test("確認前のメモ・本文・選択範囲を保持し変更時は誤挿入しない", () => {
  const open = functionSource("openTablePasteDialog", "pendingTablePasteIsCurrent");
  const current = functionSource("pendingTablePasteIsCurrent", "insertPastedPlainText");
  assert.match(open, /noteId: note\.id/);
  assert.match(open, /editorValue: editor\.value/);
  assert.match(open, /selectionStart/);
  assert.match(open, /selectionEnd/);
  assert.match(current, /currentId === pending\.noteId/);
  assert.match(current, /editor\.value === pending\.editorValue/);
});

test("表貼り付けは既存表構造・Undo・保存経路を再利用し左上セルへフォーカスする", () => {
  const source = functionSource("insertPastedTable", "handleEditorPaste");
  assert.match(source, /normalizeTableBlock\(\{/);
  assert.match(source, /createTableBlock\(tableId\)/);
  assert.match(source, /insertTableBlock\(/);
  assert.match(source, /captureUndoSnapshot\(\{ inputType: "insertFromPaste" \}\)/);
  assert.match(source, /tableAxisSelections\.delete\(table\.id\)/);
  assert.match(source, /scheduleSave\(\{ render: false \}\)/);
  assert.match(source, /focusTableCell\(table\.id, 0, 0\)/);
});

test("テキスト貼り付けは元の選択範囲を一度に置換しUndoへ記録する", () => {
  const source = functionSource("insertPastedPlainText", "insertPastedTable");
  assert.match(source, /captureUndoSnapshot\(\{ inputType: "insertFromPaste" \}\)/);
  assert.match(source, /slice\(0, pending\.selectionStart\)/);
  assert.match(source, /slice\(pending\.selectionEnd\)/);
  assert.match(source, /setSelectionRange\(nextPosition, nextPosition\)/);
});

test("上限超過時は表挿入を隠しテキストまたはキャンセルだけを選べる", () => {
  const source = functionSource("openTablePasteDialog", "pendingTablePasteIsCurrent");
  assert.match(source, /validatePastedTableSize\(detected\.rows\)/);
  assert.match(source, /confirmTablePasteBtn\.hidden = exceedsLimit/);
  assert.match(source, /データは変更されていません/);
  assert.match(source, /TABLE_PASTE_LIMITS\.rows/);
  assert.match(source, /TABLE_PASTE_LIMITS\.columns/);
  assert.match(source, /TABLE_PASTE_LIMITS\.cells/);
});

test("Escape・Enter・閉じる操作とフォーカス復元をdialogへ接続する", () => {
  assert.match(app, /tablePasteDialog\.addEventListener\("cancel"[\s\S]*event\.preventDefault\(\)[\s\S]*closeTablePasteDialog/);
  assert.match(app, /tablePasteDialog\.addEventListener\("keydown"[\s\S]*event\.key !== "Enter"[\s\S]*insertPastedTable/);
  assert.match(app, /closeTablePasteBtn\.addEventListener\("click", \(\) => closeTablePasteDialog\(\)\)/);
  assert.match(app, /restoreTablePasteEditorContext[\s\S]*setSelectionRange\(pending\.selectionStart, pending\.selectionEnd\)/);
});

test("確認dialogは既存テーマ変数、内部スクロール、モバイル1列操作に対応する", () => {
  assert.match(css, /\.table-paste-dialog \{[\s\S]*background: var\(--paper\)[\s\S]*color: var\(--ink\)/);
  assert.match(css, /\.table-paste-dialog::backdrop \{[\s\S]*var\(--dialog-backdrop\)/);
  assert.match(css, /\.table-paste-body \{[\s\S]*overflow-y: auto/);
  assert.match(css, /\.table-paste-warning \{[\s\S]*var\(--danger\)/);
  assert.match(css, /\.table-paste-actions \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("各表の操作メニューへ表コピーとMarkdownコピーを追加する", () => {
  const start = app.indexOf("function createTableEditor(");
  const end = app.indexOf("\nfunction renderTableBlockEditors(", start);
  const source = app.slice(start, end);
  assert.match(source, /tableEditorButton\("表をコピー", "copy-table"\)/);
  assert.match(source, /tableEditorButton\("Markdown表としてコピー", "copy-markdown"\)/);
});

test("コピー直前は対象表DOMの最新セル値だけを複製し本文へ書き戻さない", () => {
  const source = functionSource("tableSnapshotForCopy", "showTableCopyStatus");
  assert.match(source, /table\.rows\.map\(\(row\) => \[\.\.\.row\]\)/);
  assert.match(source, /editorBlock\.querySelectorAll\("\.table-block-cell-input"\)/);
  assert.match(source, /rows\[rowIndex\]\[columnIndex\] = input\.value/);
  assert.doesNotMatch(source, /editor\.value|captureUndoSnapshot|scheduleSave/);
});

test("表コピーは選択・Undo・保存を変更せず成功または失敗を表付近へ表示する", () => {
  const copySource = functionSource("copyTableBlock", "focusTableAxisHeader");
  const actionSource = functionSource("handleTableEditorAction");
  assert.match(copySource, /writeTableToClipboard\(table/);
  assert.match(copySource, /writeTextToClipboard\(tableBlockToMarkdown\(table\)/);
  assert.match(copySource, /表をコピーしました/);
  assert.match(copySource, /Markdown表をコピーしました/);
  assert.match(copySource, /表をコピーできませんでした/);
  assert.doesNotMatch(copySource, /captureUndoSnapshot|scheduleSave|tableAxisSelections\.(?:set|delete)/);
  assert.match(actionSource, /case "copy-table":[\s\S]*copyTableBlock\(editorBlock, block\.table, "table"\)/);
  assert.match(actionSource, /case "copy-markdown":[\s\S]*copyTableBlock\(editorBlock, block\.table, "markdown"\)/);
  assert.match(css, /\.table-block-operation-status\.success\s*\{[^}]*color:\s*var\(--accent\)/s);
});

test("配信キャッシュ番号を貼り付け機能の変更に合わせて更新する", () => {
  assert.match(html, /style\.css\?v=0\.4\.0-29/);
  assert.match(html, /table-block-utils\.js\?v=0\.4\.0-4/);
  assert.match(html, /app\.js\?v=0\.4\.0-42/);
});
