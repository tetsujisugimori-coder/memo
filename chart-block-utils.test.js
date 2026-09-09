"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CHART_BLOCK_VERSION,
  DEFAULT_CHART_COLOR,
  PIE_CHART_COLORS,
  chartBlockPlainText,
  createChartBlock,
  insertChartBlock,
  lineChartPoints,
  normalizeChartBlock,
  parseChartBlockLine,
  pieChartSegments,
  replaceChartBlock,
  serializeChartBlock,
  splitChartBlocks
} = require("./chart-block-utils.js");

function charts(markdown) {
  return splitChartBlocks(markdown).filter((segment) => segment.type === "chart");
}

test("初期グラフは棒グラフ、空の1行、円グラフ用の既定設定を持つ", () => {
  const chart = createChartBlock("chart-1");
  assert.equal(chart.type, "chart");
  assert.equal(chart.id, "chart-1");
  assert.equal(chart.schemaVersion, CHART_BLOCK_VERSION);
  assert.equal(chart.chartType, "bar");
  assert.deepEqual(chart.items, [{ id: "chart-1-item-1", label: "", value: 0 }]);
  assert.deepEqual(chart.appearance, { color: DEFAULT_CHART_COLOR, showValues: true, showPoints: true, showLegend: false, pieLabelMode: "percentage" });
});

test("項目名と小数を含む保存形式を同じ内容へ復元し、凡例設定を保持する", () => {
  const source = normalizeChartBlock({
    id: "scores", title: "得点", unit: "点", items: [
      { id: "japanese", label: " 国語 ", value: 70.5 },
      { id: "math", label: "数学", value: "85" }
    ], appearance: { color: "#336699", showValues: false, showLegend: true }
  });
  const restored = parseChartBlockLine(serializeChartBlock(source));
  assert.deepEqual(restored, source);
});

test("不正な種別、数値、色、ラベル設定を安全な既定値へ正規化する", () => {
  const chart = normalizeChartBlock({
    id: "unsafe", chartType: "area", items: [
      { id: "same", label: " A ", value: "NaN" },
      { id: "same", label: "B", value: Infinity },
      { label: "C", value: -1 }
    ], appearance: { color: "javascript:alert(1)", showValues: false, showLegend: true }
  });
  assert.equal(chart.chartType, "bar");
  assert.deepEqual(chart.items.map(({ id, label, value }) => ({ id, label, value })), [
    { id: "same", label: "A", value: 0 }, { id: "same-2", label: "B", value: 0 }, { id: "unsafe-item-3", label: "C", value: 0 }
  ]);
  assert.deepEqual(chart.appearance, { color: DEFAULT_CHART_COLOR, showValues: false, showPoints: true, showLegend: true, pieLabelMode: "percentage" });
});

test("折れ線グラフは共通データと表示設定を保存し、旧データの点表示は既定で有効にする", () => {
  const line = normalizeChartBlock({
    id: "line", chartType: "line", title: "推移", unit: "点",
    items: [{ id: "first", label: "一回目", value: 1.5 }, { id: "second", label: "二回目", value: 3 }],
    appearance: { color: "#336699", showValues: false, showPoints: false, showLegend: true }
  });
  assert.equal(line.chartType, "line");
  assert.deepEqual(parseChartBlockLine(serializeChartBlock(line)), line);
  const legacy = normalizeChartBlock({ id: "legacy", chartType: "bar", items: [{ label: "従来", value: 1 }] });
  assert.equal(legacy.appearance.showPoints, true);
});

test("折れ線の座標は入力順を保ち、0件・1件・同値・小数でも有限にする", () => {
  assert.deepEqual(lineChartPoints([], 420), []);
  const single = lineChartPoints([{ id: "only", value: 4 }], 420);
  assert.equal(single.length, 1);
  assert.ok(Number.isFinite(single[0].x) && Number.isFinite(single[0].y));
  const equal = lineChartPoints([{ id: "a", value: 2.5 }, { id: "b", value: 2.5 }, { id: "c", value: 2.5 }], 420);
  assert.deepEqual(equal.map((point) => point.id), ["a", "b", "c"]);
  assert.ok(equal.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.ok(equal[0].x < equal[1].x && equal[1].x < equal[2].x);
  assert.equal(equal[0].y, equal[1].y);
});

test("円グラフは共通項目データを使い、最後の扇形まで合計100%にする", () => {
  const chart = normalizeChartBlock({
    id: "pie", chartType: "pie", unit: "個", items: [
      { id: "a", label: "A", value: 2 }, { id: "b", label: "B", value: 3 }, { id: "zero", label: "0", value: 0 }
    ], appearance: { showLegend: true, pieLabelMode: "value" }
  });
  const pie = pieChartSegments(chart.items);
  assert.equal(chart.chartType, "pie");
  assert.equal(chart.appearance.showLegend, true);
  assert.equal(chart.appearance.pieLabelMode, "value");
  assert.equal(pie.total, 5);
  assert.equal(pie.segments.length, 2);
  assert.ok(Math.abs(pie.segments[0].percentage - 40) < 1e-9);
  assert.ok(Math.abs(pie.segments[1].percentage - 60) < 1e-9);
  assert.ok(Math.abs(pie.segments.at(-1).endAngle - (Math.PI * 3) / 2) < 1e-12);
});

test("1項目の円グラフ、合計0、chartTypeなしの旧データを区別して正規化する", () => {
  const single = pieChartSegments([{ id: "only", label: "唯一", value: 4 }]);
  assert.equal(single.segments.length, 1);
  assert.ok(Math.abs(single.segments[0].endAngle - single.segments[0].startAngle - Math.PI * 2) < 1e-9);
  assert.deepEqual(pieChartSegments([{ id: "zero", label: "ゼロ", value: 0 }]), { total: 0, segments: [] });
  const legacy = normalizeChartBlock({ id: "legacy", items: [{ label: "従来", value: 1 }] });
  assert.equal(legacy.chartType, "bar");
  assert.equal(legacy.appearance.pieLabelMode, "percentage");
  assert.equal(legacy.appearance.showPoints, true);
});

test("巨大な有限値も最大値で正規化して有限な比率と角度にする", () => {
  const equal = pieChartSegments([
    { id: "a", label: "項目A", value: 1e308 },
    { id: "b", label: "項目B", value: 1e308 }
  ]);
  assert.ok(Math.abs(equal.segments[0].percentage - 50) < 1e-9);
  assert.ok(Math.abs(equal.segments[1].percentage - 50) < 1e-9);
  assert.ok(equal.segments.every((segment) => Number.isFinite(segment.percentage) && Number.isFinite(segment.startAngle) && Number.isFinite(segment.endAngle)));
  assert.equal(equal.segments.at(-1).endAngle, (Math.PI * 3) / 2);

  const unequal = pieChartSegments([
    { id: "a", label: "項目A", value: 1e308 },
    { id: "b", label: "項目B", value: 5e307 }
  ]);
  assert.ok(Math.abs(unequal.segments[0].percentage - (200 / 3)) < 1e-9);
  assert.ok(Math.abs(unequal.segments[1].percentage - (100 / 3)) < 1e-9);
});

test("通常値、合計0、1項目、0を挟む色順の円グラフ契約を維持する", () => {
  const normal = pieChartSegments([{ id: "a", label: "A", value: 2 }, { id: "b", label: "B", value: 3 }]);
  assert.equal(normal.total, 5);
  assert.ok(Math.abs(normal.segments[0].percentage - 40) < 1e-9);
  assert.ok(Math.abs(normal.segments[1].percentage - 60) < 1e-9);

  assert.deepEqual(pieChartSegments([{ id: "zero", label: "ゼロ", value: 0 }]), { total: 0, segments: [] });
  const single = pieChartSegments([{ id: "only", label: "唯一", value: 4 }]);
  assert.equal(single.segments.length, 1);
  assert.equal(single.segments[0].endAngle, (Math.PI * 3) / 2);

  const withZero = pieChartSegments([
    { id: "first", label: "最初", value: 2 },
    { id: "zero", label: "ゼロ", value: 0 },
    { id: "third", label: "3番目", value: 3 }
  ]);
  assert.deepEqual(withZero.segments.map(({ id, label, value, color }) => ({ id, label, value, color })), [
    { id: "first", label: "最初", value: 2, color: PIE_CHART_COLORS[0] },
    { id: "third", label: "3番目", value: 3, color: PIE_CHART_COLORS[2] }
  ]);
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
