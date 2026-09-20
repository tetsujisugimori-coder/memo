"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { normalizeTableBlock, serializeTableBlock } = require("./table-block-utils.js");
const { tableToChartDraft, createChartBlock, normalizeChartBlock, serializeChartBlock, parseChartBlockLine,
  chartValidationError, CHART_SERIES_COLORS } = require("./chart-block-utils.js");
const frozen = value => { if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); } return value; };
function convert(rows, extra = {}) {
  const table = normalizeTableBlock({ id: "source", rows, ...extra });
  return tableToChartDraft(table, randomUUID(), { items: table.rows.slice(1).map(() => randomUUID()), series: table.rows[0].slice(1).map(() => randomUUID()) });
}
// map must not pass its index as randomUUID's options.
function ids(length) { return Array.from({ length }, () => randomUUID()); }
function draft(table) { return tableToChartDraft(table, randomUUID(), { items: ids(table.rows.length - 1), series: ids(table.rows[0].length - 1) }); }
for (const value of ["1", "0", "-0", "-12", "0.125", "1e-4", "5e-324", String(Number.MAX_VALUE), String(-Number.MAX_VALUE)]) {
  test("表変換: 有限値を保持 " + value, () => {
    const result = convert([["任意の左上", " 売上 "], [" 日本語A ", value]]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.chart.items.map(x => x.label), ["日本語A"]);
    assert.deepEqual(result.chart.series.map(x => [x.name, x.values]), [["売上", [Number(value) === 0 ? 0 : Number(value)]]]);
    assert.deepEqual(parseChartBlockLine(serializeChartBlock(result.chart)), result.chart);
  });
}
for (const value of ["", " ", "NaN", "Infinity", "-Infinity", "abc", "1,234", "25%", "￥100", "=1+2", '"12"']) {
  test("表変換: 不正値とセル位置 " + JSON.stringify(value), () => {
    const result = convert([["", "A", "B"], ["1月", "10", value]]);
    assert.equal(result.ok, false);
    assert.deepEqual([result.error.row, result.error.column, result.error.value], [2, 3, value]);
    assert.match(result.error.reason, /有限な数値/);
  });
}
for (const [rows, row, column, reason] of [
  [[["項目", "A"]], 2, 1, /項目データ/],
  [[["項目"], ["1月"]], 1, 2, /系列列/],
  [[["", " "], ["1月", "1"]], 1, 2, /系列名/],
  [[["", "A"], [" ", "1"]], 2, 1, /項目名/],
  [[["", "A"], ["1月", "1"], ["", ""]], 3, 1, /空行/],
  [[["", "A", "B"], ["1月", "1"]], 2, 3, /有限な数値/],
  [[["", "A"], ["1月", "1", "2"]], 1, 3, /系列名/],
  [[["", "A", "B", "C", "D"], ["1月", "1", "2", "3", "4"]], 1, 5, /最大3件/],
  [[["", "A"], ...Array.from({length:51}, () => ["項目", "1"])], 52, 1, /最大50件/]
]) test("表変換: 構造と正規化された空セル " + reason, () => {
  const result = convert(rows);
  assert.equal(result.ok, false);
  assert.deepEqual([result.error.row, result.error.column], [row, column]);
  assert.match(result.error.reason, reason);
});
test("表変換: 50項目3系列、同名、日本語英数字、改行正規化、独立IDと既定色", () => {
  const table = frozen(normalizeTableBlock({ id: "table-id", caption: "推測しない円グラフ", unit: "%", rows:
    [["左上<script>", " A\r\n日本語 ", " A\r\n日本語 ", "C"], ...Array.from({ length:50 }, () => [" 同名A ", "1", "2", "3"])] }));
  const before = serializeTableBlock(table);
  const first = draft(table).chart, second = draft(table).chart;
  assert.equal(first.items.length, 50); assert.equal(first.series.length, 3);
  assert.deepEqual(first.series.map(x=>x.name), ["A\n日本語", "A\n日本語", "C"]);
  assert.ok(first.items.every(x => x.label === "同名A"));
  assert.deepEqual(first.series.map(x => x.color), CHART_SERIES_COLORS);
  const allIds = [first, second].flatMap(c => [c.id, ...c.items.map(x=>x.id), ...c.series.map(x=>x.id)]);
  assert.equal(new Set(allIds).size, allIds.length);
  const defaults = createChartBlock(first.id);
  assert.equal(first.chartType, defaults.chartType); assert.equal(first.title, defaults.title); assert.equal(first.unit, defaults.unit);
  assert.deepEqual(first.appearance, defaults.appearance);
  assert.equal(first.schemaVersion, 1);
  assert.deepEqual(Object.keys(first).sort(), Object.keys(defaults).sort());
  assert.equal(JSON.stringify(first).includes("table-id"), false);
  assert.equal(JSON.stringify(first).includes("左上"), false);
  assert.deepEqual(normalizeChartBlock(first), first);
  assert.deepEqual(parseChartBlockLine(serializeChartBlock(first)), first);
  assert.equal(serializeTableBlock(table), before);
  first.items[0].label = "独立"; first.series[0].values[0] = 99;
  assert.equal(table.rows[1][1], "1"); assert.equal(second.series[0].values[0], 1);
});
test("表変換: 1行目は見出し表示オンオフに関係なく系列、セル内タブを区切りにしない", () => {
  const result = convert([["任意", " A\tB "], [" X\tY ", "1"]], { hasHeader:false });
  assert.equal(result.ok, true);
  assert.equal(result.chart.series[0].name, "A\tB"); assert.equal(result.chart.items[0].label, "X\tY");
});
test("表変換: 円の負数と複合の系列数の確定条件を保持", () => {
  const chart = convert([["", "A"], ["項目", "-1"]]).chart;
  assert.match(chartValidationError({ ...chart, chartType:"pie" }), /負数/);
  assert.match(chartValidationError({ ...chart, chartType:"combo" }), /2系列/);
});

const vm = require("node:vm");
const app = require("node:fs").readFileSync("app.js", "utf8");
function undoFixture() {
  const context = vm.createContext({ currentId:"note", undoStack:[], redoStack:[], UNDO_LIMIT:100, lastUndoSnapshotAt:0,
    titleInput:{value:"title"}, editor:{value:"table"}, undoBtn:{}, redoBtn:{}, saves:0,
    renderTableBlockEditors(){}, renderNoteMeta(){}, scheduleSave(){ context.saves++; },
    currentNote(){return {id:context.currentId};}, typingPerformanceEnabled:false, UNDO_INPUT_INTERVAL_MS:1000 });
  for(const name of ["captureUndoSnapshot", "shouldForceUndoSnapshot", "pushUndoSnapshot", "undoLastEdit", "redoLastEdit", "updateUndoButton"]) {
    const source=app.match(new RegExp("function "+name+"\\([^]*?\\n\\}"))[0];
    vm.runInContext(source,context);
  }
  return context;
}
test("Undo/Redo: 同じマーカーを往復し、別編集でやり直しを無効にする", () => {
  const c=undoFixture(); c.captureUndoSnapshot({inputType:"insertFromPaste"}); c.editor.value="table\nchart-with-stable-ids";
  c.undoLastEdit(); assert.equal(c.editor.value,"table"); assert.equal(c.redoBtn.disabled,false);
  c.redoLastEdit(); assert.equal(c.editor.value,"table\nchart-with-stable-ids"); assert.equal(c.redoBtn.disabled,true);
  c.undoLastEdit(); c.captureUndoSnapshot({inputType:"insertText"}); c.editor.value="changed table";
  c.redoLastEdit(); assert.equal(c.editor.value,"changed table"); assert.equal(c.redoBtn.disabled,true);
  assert.equal(c.saves,3);
});
test("Undo/Redo: 別メモの履歴と本文を混ぜず、取消したdraftは履歴を増やさない", () => {
  const c=undoFixture(); c.captureUndoSnapshot({inputType:"insertFromPaste"}); c.editor.value="chart A";c.undoLastEdit();
  c.currentId="other";c.editor.value="other body";c.updateUndoButton();assert.equal(c.redoBtn.disabled,true);
  c.redoLastEdit();assert.equal(c.editor.value,"other body");
  c.captureUndoSnapshot({inputType:"insertFromPaste"});c.editor.value="other edit";
  c.currentId="note";c.editor.value="table";c.redoLastEdit();assert.equal(c.editor.value,"chart A");
});
