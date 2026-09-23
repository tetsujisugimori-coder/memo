"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const {
  TABLE_PASTE_LIMITS,
  parseCsvTable,
  parseDelimitedTable,
  parseTsvTable,
  validateTableFileRows
} = require("./table-block-utils.js");

test("UTF-8 CSV/TSVはBOM、改行、引用符、空セル、末尾空列を保持する", () => {
  const csv = "\ufeff項目,値,,\r\n\"A,B\",\"引用符 \"\"x\"\"\",,\r\n\"改行\nセル\", ,,";
  assert.deepEqual(parseCsvTable(csv).rows, [
    ["項目", "値", "", ""],
    ["A,B", "引用符 \"x\"", "", ""],
    ["改行\nセル", " ", "", ""]
  ]);
  assert.deepEqual(parseTsvTable("A\tB\t\n1\t\"x\ty\"\t\n").rows, [["A", "B", ""], ["1", "x\ty", ""]]);
  assert.deepEqual(parseCsvTable("A,B\r1,2\n3,4\r\n").rows, [["A", "B"], ["1", "2"], ["3", "4"]]);
});

test("区切り文字は拡張子ごとの指定だけを使い、セル文字列を変更しない", () => {
  const csv = " 前後 ,\t,=SUM(A1:A2),+1,-1,@name,<b>絵文字😀</b>";
  assert.deepEqual(parseCsvTable(csv).rows, [[" 前後 ", "\t", "=SUM(A1:A2)", "+1", "-1", "@name", "<b>絵文字😀</b>"]]);
  assert.deepEqual(parseCsvTable("A\tB,C").rows, [["A\tB", "C"]]);
  assert.deepEqual(parseTsvTable("A,B\tC").rows, [["A,B", "C"]]);
  assert.equal(csv, " 前後 ,\t,=SUM(A1:A2),+1,-1,@name,<b>絵文字😀</b>");
});

test("不正な引用符、NUL、空データ、不揃い列を部分結果なしで拒否する", () => {
  assert.throws(() => parseCsvTable('"未終了'), /閉じられていません/);
  assert.throws(() => parseCsvTable('"A"x,B'), /閉じ引用符/);
  assert.throws(() => parseCsvTable("A\0,B"), /NUL/);
  assert.throws(() => parseCsvTable(""), /空/);
  assert.throws(() => parseCsvTable(",\n,"), /実データ/);
  assert.throws(() => parseCsvTable("A,B\n1"), /2行目/);
});

test("100行・30列・3000セルの境界を受理し、上限超過は拒否する", () => {
  const accepted = Array.from({ length: 100 }, (_, row) => Array.from({ length: 30 }, (_, column) => `${row}-${column}`));
  assert.deepEqual(validateTableFileRows(accepted), {
    allowed: true, rowCount: 100, columnCount: 30, cellCount: 3000, limits: TABLE_PASTE_LIMITS
  });
  assert.throws(() => validateTableFileRows(Array.from({ length: 101 }, () => ["x"])), /行数/);
  assert.throws(() => validateTableFileRows([Array.from({ length: 31 }, () => "x")]), /列数/);
  assert.throws(() => parseDelimitedTable(Array.from({ length: 3001 }, () => "x").join(","), ","), /列数|セル数/);
});

test("ファイル選択は既存表ダイアログをファイルモードで使い、貼り付け自動判定を変えない", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const html = fs.readFileSync("index.html", "utf8");
  const utils = fs.readFileSync("table-block-utils.js", "utf8");
  const detectStart = utils.indexOf("function detectPastedTable(");
  const detectEnd = utils.indexOf("\n  function validatePastedTableSize", detectStart);
  assert.match(html, /id="importTableFileBtn"[^>]*>CSV\/TSV</);
  assert.match(html, /id="tableFileImportInput"[^>]*type="file"[^>]*accept="\.csv,\.tsv"/);
  assert.doesNotMatch(html, /id="tableFileImportInput"[^>]*multiple/);
  assert.match(html, /data-mobile-editor-tool="importTableFileBtn">CSV\/TSVを読み込む/);
  assert.match(html, /id="tableFileImportStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app, /new TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(app, /file\.arrayBuffer\(\)/);
  assert.match(app, /file\.size > TABLE_FILE_IMPORT_LIMITS\.bytes/);
  assert.match(app, /openTablePasteDialog\(\{[\s\S]*format: "file-"/);
  assert.match(app, /fileMode \? "表として読み込む"/);
  assert.match(app, /if \(fileMode\) \{[\s\S]*pasteTableAsImageBtn\.hidden = true;[\s\S]*pasteTableAsTextBtn\.hidden = true/);
  assert.match(app, /if \(pending\.fileImport\) captureUndoSnapshot\(\{ inputType: "insertFromFile" \}\)/);
  assert.doesNotMatch(utils.slice(detectStart, detectEnd), /parseCsv|parseTsv|CSV/i);
});
