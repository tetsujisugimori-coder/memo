"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CHART_BLOCK_VERSION,
  DEFAULT_CHART_COLOR,
  chartBlockPlainText,
  createChartBlock,
  insertChartBlock,
  normalizeChartBlock,
  parseChartBlockLine,
  replaceChartBlock,
  serializeChartBlock,
  splitChartBlocks
} = require("./chart-block-utils.js");

function charts(markdown) {
  return splitChartBlocks(markdown).filter((segment) => segment.type === "chart");
}

test("初期グラフは棒グラフ、空の1行、将来用の凡例設定を持つ", () => {
  const chart = createChartBlock("chart-1");
  assert.equal(chart.type, "chart");
  assert.equal(chart.id, "chart-1");
  assert.equal(chart.schemaVersion, CHART_BLOCK_VERSION);
  assert.equal(chart.chartType, "bar");
  assert.deepEqual(chart.items, [{ id: "chart-1-item-1", label: "", value: 0 }]);
  assert.deepEqual(chart.appearance, { color: DEFAULT_CHART_COLOR, showValues: true, showLegend: false });
});

test("項目名と小数を含む保存形式を同じ内容へ復元する", () => {
  const source = normalizeChartBlock({
    id: "scores", title: "得点", unit: "点", items: [
      { id: "japanese", label: " 国語 ", value: 70.5 },
      { id: "math", label: "数学", value: "85" }
    ], appearance: { color: "#336699", showValues: false, showLegend: true }
  });
  const restored = parseChartBlockLine(serializeChartBlock(source));
  assert.deepEqual(restored, { ...source, appearance: { ...source.appearance, showLegend: false } });
});

test("不正な種別、数値、色、凡例設定を安全な既定値へ正規化する", () => {
  const chart = normalizeChartBlock({
    id: "unsafe", chartType: "line", items: [
      { id: "same", label: " A ", value: "NaN" },
      { id: "same", label: "B", value: Infinity },
      { label: "C", value: -1 }
    ], appearance: { color: "javascript:alert(1)", showValues: false, showLegend: true }
  });
  assert.equal(chart.chartType, "bar");
  assert.deepEqual(chart.items.map(({ id, label, value }) => ({ id, label, value })), [
    { id: "same", label: "A", value: 0 }, { id: "same-2", label: "B", value: 0 }, { id: "unsafe-item-3", label: "C", value: 0 }
  ]);
  assert.deepEqual(chart.appearance, { color: DEFAULT_CHART_COLOR, showValues: false, showLegend: false });
});

test("未知の保存データで不正な行があっても最大50件に収めて安定IDを作る", () => {
  const chart = normalizeChartBlock({ id: "many", items: Array.from({ length: 52 }, (_, index) => ({ label: `項目${index}`, value: index })) });
  assert.equal(chart.items.length, 50);
  assert.equal(new Set(chart.items.map((item) => item.id)).size, 50);
});

test("カーソル位置への挿入と既存マーカー内部の境界補正を行う", () => {
  const first = createChartBlock("first");
  const inserted = insertChartBlock("前XX後", 1, 3, first);
  assert.match(inserted.value, /^前\n<!-- memo-nexus:chart-block:/);
  assert.equal(charts(inserted.value).length, 1);
  const result = insertChartBlock(`${serializeChartBlock(first)}\n後`, 10, 10, createChartBlock("second"));
  assert.deepEqual(charts(result.value).map((block) => block.chart.id), ["first", "second"]);
});

test("置換と削除は対象グラフだけを更新する", () => {
  const first = serializeChartBlock(createChartBlock("first"));
  const second = serializeChartBlock(createChartBlock("second"));
  const body = `前\n${first}\n中\n${second}\n後`;
  const blocks = charts(body);
  const updated = replaceChartBlock(body, blocks[0], normalizeChartBlock({ ...blocks[0].chart, title: "更新" }));
  assert.deepEqual(charts(updated).map((block) => block.chart.title), ["更新", ""]);
  assert.equal(charts(replaceChartBlock(updated, charts(updated)[1], null)).length, 1);
});

test("コードフェンスと画像ブロック内のマーカーはグラフとして扱わない", () => {
  const marker = serializeChartBlock(createChartBlock("hidden"));
  assert.equal(charts(["```json", marker, "```"].join("\n")).length, 0);
  assert.equal(charts(["<!-- memo-nexus:image-block -->", marker, "<!-- /memo-nexus:image-block -->"].join("\n")).length, 0);
});

test("壊れたマーカーは本文として残し、要約用テキストへ有効項目を含める", () => {
  assert.equal(charts("<!-- memo-nexus:chart-block:zz -->").length, 0);
  const source = serializeChartBlock(normalizeChartBlock({ id: "summary", title: "得点", unit: "点", items: [{ id: "a", label: "国語", value: 70 }] }));
  assert.match(chartBlockPlainText(`前\n${source}\n後`), /得点 点 国語 70/);
});
