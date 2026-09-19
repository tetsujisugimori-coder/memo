"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  comboChartLayout,
  formatChartAxisTitle,
  chartSeriesUnit,
  chartDatumDescription,
  comboAxisRanges,
  comboValueAxisLayout,
  comboSeriesKinds,
  groupedBarLayout,
  normalizeComboLineSeriesId,
  CHART_BLOCK_VERSION,
  CHART_SERIES_COLORS,
  DEFAULT_CHART_COLOR,
  DEFAULT_CHART_SERIES_NAME,
  PIE_CHART_COLORS,
  chartValueLabelLayout,
  chartBarExtent,
  chartValueRange,
  chartValueRatio,
  chartValidationError,
  finiteChartNumber,
  isValidChartNumber,
  chartCategoryLabels,
  chartBlockPlainText,
  chartDisplaySeries,
  chartLabelLayout,
  chartNumericTicks,
  chartDivergingStacks,
  chartStackedTotals,
  chartValueMaximum,
  chartValueAxisLayout,
  createChartBlock,
  formatChartStackTotal,
  formatChartStackTotalDetail,
  horizontalBarLabel,
  horizontalBarLabelWidth,
  horizontalBarSegments,
  insertChartBlock,
  lineChartPoints,
  lineChartWidth,
  moveChartItem,
  moveChartSeries,
  normalizeChartBlock,
  parseChartBlockLine,
  pieItemColor,
  pieChartSegments,
  replaceChartBlock,
  resolvePieSeries,
  serializeChartBlock,
  shouldShowStackTotals,
  stackedBarSegments,
  splitChartBlocks
} = require("./chart-block-utils.js");

for (const value of [0, -0, -12, 0.125, Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE]) {
  test(`データ説明は元の有限値を保持する: ${value}`, () => {
    const item = Object.freeze({ id: "item", label: "項目<>&" });
    const series = Object.freeze({ id: "series", name: "系列<>&" });
    assert.equal(chartDatumDescription({ item, series, value, unit: "万円" }),
      `項目<>&、系列<>&: ${value === 0 ? 0 : value}万円`);
  });
}

test("データ説明は軸割当と割合を共有し、保存マーカーと入力を変更しない", () => {
  const chart = normalizeChartBlock({ id: "description", chartType: "combo", unit: "万円",
    items: [{ id: "a", label: "同名" }, { id: "b", label: "同名" }],
    series: [{ id: "sales", name: "売上", values: [30, -10] }, { id: "rate", name: "成長率", values: [0.5, -0.25] }],
    appearance: { comboLineSeriesId: "rate", comboAxisMode: "dual", comboSecondaryUnit: "%", leftAxisTitle: "売上", rightAxisTitle: "成長率" }
  });
  const marker = serializeChartBlock(chart);
  assert.equal(chartDatumDescription({ item: chart.items[1], series: chart.series[1], value: -0.25,
    unit: chartSeriesUnit(chart, chart.series[1]), assignment: "折れ線・右軸" }), "同名、成長率（折れ線・右軸）: -0.25%");
  assert.equal(chartDatumDescription({ item: chart.items[0], series: chart.series[0], value: 30,
    unit: "万円", percentage: -60 }), "同名、売上: 30万円（割合: -60%）");
  assert.equal(serializeChartBlock(chart), marker);
  assert.equal(parseChartBlockLine(marker).schemaVersion, 1);
});

test("データ説明は非有限な表示引数でもNaNとInfinityを出さない", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const description = chartDatumDescription({ item: { label: "項目" }, series: { name: "系列" }, value, percentage: value });
    assert.equal(description, "項目、系列: 0（割合: 0%）");
  }
});

function charts(markdown) {
  return splitChartBlocks(markdown).filter((segment) => segment.type === "chart");
}

test("初期グラフは棒グラフ、空の1行、円グラフ用の既定設定を持つ", () => {
  const chart = createChartBlock("chart-1");
  assert.equal(chart.type, "chart");
  assert.equal(chart.id, "chart-1");
  assert.equal(chart.schemaVersion, CHART_BLOCK_VERSION);
  assert.equal(chart.chartType, "bar");
  assert.deepEqual(chart.items, [{ id: "chart-1-item-1", label: "" }]);
  assert.deepEqual(chart.series, [{ id: "chart-1-series-1", name: DEFAULT_CHART_SERIES_NAME, color: DEFAULT_CHART_COLOR, values: [0] }]);
  assert.deepEqual(chart.appearance, { color: DEFAULT_CHART_COLOR, barMode: "grouped", barOrientation: "vertical", showStackTotals: false, showValues: true, showPoints: true, showLegend: false, pieLabelMode: "percentage", pieSeriesId: "chart-1-series-1" });
});

test("円グラフの表示系列は安定IDで正規化、保存、系列操作後も解決する", () => {
  const source = {
    id: "pie-series", chartType: "pie", items: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    series: [
      { id: "sales", name: "売上", values: [90, 10] },
      { id: "profit", name: "利益", values: [20, 80] },
      { id: "cost", name: "原価", values: [50, 50] }
    ],
    appearance: { pieSeriesId: "profit", showLegend: true }
  };
  const original = structuredClone(source);
  const selected = normalizeChartBlock(source);
  assert.equal(createChartBlock("new").appearance.pieSeriesId, "new-series-1");
  assert.equal(selected.appearance.pieSeriesId, "profit");
  assert.equal(resolvePieSeries(selected).id, "profit");
  assert.deepEqual(chartDisplaySeries(selected).map((series) => series.id), ["profit"]);
  assert.deepEqual(chartDisplaySeries(selected)[0].values, [20, 80]);
  assert.deepEqual(source, original, "正規化と選択解決は入力を変更しない");

  [undefined, 1, "missing"].forEach((pieSeriesId) => {
    const fallback = normalizeChartBlock({ ...source, appearance: { pieSeriesId } });
    assert.equal(fallback.appearance.pieSeriesId, "sales");
    assert.equal(resolvePieSeries(fallback).id, "sales");
  });

  const restored = parseChartBlockLine(serializeChartBlock(selected));
  assert.equal(restored.appearance.pieSeriesId, "profit");
  ["bar", "line", "pie"].forEach((chartType) => assert.equal(normalizeChartBlock({ ...restored, chartType }).appearance.pieSeriesId, "profit"));
  assert.equal(resolvePieSeries(moveChartSeries(restored, 1, -1)).id, "profit", "並べ替え後も選択IDを解決する");

  const renamed = normalizeChartBlock({ ...restored, series: restored.series.map((series) => series.id === "profit" ? { ...series, name: "営業利益" } : series) });
  assert.equal(resolvePieSeries(renamed).name, "営業利益");
  const withoutOther = normalizeChartBlock({ ...renamed, series: renamed.series.filter((series) => series.id !== "cost") });
  assert.equal(resolvePieSeries(withoutOther).id, "profit");
  const withoutSelected = normalizeChartBlock({ ...withoutOther, series: withoutOther.series.filter((series) => series.id !== "profit") });
  assert.equal(withoutSelected.appearance.pieSeriesId, "sales");
  const withAdded = normalizeChartBlock({ ...withoutOther, series: [...withoutOther.series, { id: "forecast", name: "予測", values: [30, 70] }] });
  assert.equal(withAdded.appearance.pieSeriesId, "profit");
});

test("円グラフの項目色は安定IDで保存し、旧データと不正値を安全に扱う", () => {
  const legacy = normalizeChartBlock({
    id: "pie-colors", chartType: "pie",
    items: [{ id: "north", label: "同名" }, { id: "south", label: "同名" }, { id: "zero", label: "ゼロ" }],
    series: [
      { id: "sales", name: "売上", values: [10, 20, 0] },
      { id: "profit", name: "利益", values: [30, 40, 0] }
    ],
    appearance: { pieSeriesId: "profit" }
  });
  assert.equal(Object.hasOwn(legacy.appearance, "pieItemColors"), false, "旧形式を読むだけでは項目色を追加しない");
  assert.deepEqual(pieChartSegments(legacy.items.map((item, index) => ({ ...item, value: legacy.series[1].values[index] }))).segments.map((segment) => segment.color), PIE_CHART_COLORS.slice(0, 2), "旧形式は従来の固定パレットを使う");

  const colored = normalizeChartBlock({
    ...legacy,
    appearance: { ...legacy.appearance, pieItemColors: { north: "#123456", south: "#abcdef", zero: "#0f0f0f", missing: "#fedcba", invalid: "url(javascript:alert(1))" } }
  });
  assert.deepEqual(colored.appearance.pieItemColors, { north: "#123456", south: "#abcdef", zero: "#0f0f0f" }, "既存項目IDに対応する安全な色だけを保存する");
  const coloredSegments = pieChartSegments(colored.items.map((item, index) => ({ ...item, value: colored.series[1].values[index], color: colored.appearance.pieItemColors[item.id] })));
  assert.deepEqual(coloredSegments.segments.map((segment) => [segment.id, segment.color]), [["north", "#123456"], ["south", "#abcdef"]], "選択系列にかかわらず項目IDの色を使う");

  const reordered = moveChartItem(colored, 1, -1);
  assert.deepEqual(reordered.items.map((item) => item.id), ["south", "north", "zero"]);
  assert.deepEqual(reordered.appearance.pieItemColors, colored.appearance.pieItemColors, "項目並べ替えで色の対応を移動しない");
  const renamed = normalizeChartBlock({ ...reordered, items: reordered.items.map((item) => ({ ...item, label: "同名" })) });
  assert.deepEqual(renamed.appearance.pieItemColors, colored.appearance.pieItemColors, "名前変更と同名項目でもIDごとの色を維持する");
  const added = normalizeChartBlock({ ...renamed, items: [...renamed.items, { id: "new", label: "新規" }], series: renamed.series.map((series) => ({ ...series, values: [...series.values, 5] })) });
  assert.equal(Object.hasOwn(added.appearance.pieItemColors, "new"), false, "追加項目は保存色なしで既定パレットへフォールバックする");
  const deleted = normalizeChartBlock({ ...added, items: added.items.filter((item) => item.id !== "north"), series: added.series.map((series) => ({ ...series, values: series.values.filter((_, index) => added.items[index].id !== "north") })) });
  assert.equal(Object.hasOwn(deleted.appearance.pieItemColors, "north"), false, "削除項目の色を保存結果から除く");
  const seriesMoved = moveChartSeries(deleted, 1, -1);
  const seriesDeleted = normalizeChartBlock({ ...seriesMoved, series: seriesMoved.series.filter((series) => series.id !== "sales") });
  assert.deepEqual(seriesDeleted.appearance.pieItemColors, deleted.appearance.pieItemColors, "系列の並べ替え・削除で項目色を変えない");
  const restored = parseChartBlockLine(serializeChartBlock(seriesDeleted));
  assert.deepEqual(restored.appearance.pieItemColors, seriesDeleted.appearance.pieItemColors, "保存・再読み込み・再編集用の正規化後も色を保持する");
  assert.equal(pieChartSegments([{ id: "bad", label: "不正", value: 1, color: "invalid" }]).segments[0].color, PIE_CHART_COLORS[0], "不正な描画色は既定パレットへフォールバックする");
});

test("円グラフの0値項目も安定IDの保存色を保持し、表示対象順で既定色を解決する", () => {
  const chart = normalizeChartBlock({
    id: "pie-zero-colors", chartType: "pie",
    items: [{ id: "blank", label: "" }, { id: "zero", label: "ゼロ" }, { id: "same", label: "ゼロ" }],
    series: [{ id: "sales", name: "売上", values: [0, 0, 4] }],
    appearance: { pieItemColors: { zero: "#123456", same: "#abcdef", invalid: "red" } }
  });
  const displayItems = chart.items.map((item, index) => ({ ...item, value: chart.series[0].values[index] }))
    .filter((item) => item.label && item.value >= 0);
  assert.deepEqual(chart.appearance.pieItemColors, { zero: "#123456", same: "#abcdef" }, "0値項目の安全な保存色を正規化後も残す");
  assert.equal(pieItemColor({ ...displayItems[0], color: chart.appearance.pieItemColors.zero }, displayItems), "#123456", "0値項目の凡例用色も保存色を使う");
  assert.equal(pieItemColor(displayItems[1], displayItems), PIE_CHART_COLORS[1], "未指定色は表示対象内の順序で既定色を使う");
  const positive = normalizeChartBlock({ ...chart, series: [{ ...chart.series[0], values: [0, 3, 4] }] });
  const backToZero = normalizeChartBlock({ ...positive, series: [{ ...positive.series[0], values: [0, 0, 4] }] });
  assert.deepEqual(backToZero.appearance.pieItemColors, chart.appearance.pieItemColors, "0値と正数の往復でIDごとの保存色を失わない");
  const moved = moveChartItem(backToZero, 2, -1);
  const renamed = normalizeChartBlock({ ...moved, items: moved.items.map((item) => ({ ...item, label: item.id === "zero" || item.id === "same" ? "同名" : item.label })) });
  assert.deepEqual(renamed.appearance.pieItemColors, chart.appearance.pieItemColors, "並べ替え、名前変更、同名項目でも保存色を別項目へ移動しない");
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
  assert.deepEqual(chart.items, [
    { id: "same", label: "A" }, { id: "same-2", label: "B" }, { id: "unsafe-item-3", label: "C" }
  ]);
  assert.deepEqual(chart.series[0].values, [0, 0, -1], "有限な負数は保持し、不正な旧値だけを安全化する");
  assert.deepEqual(chart.appearance, { color: DEFAULT_CHART_COLOR, barMode: "grouped", barOrientation: "vertical", showStackTotals: false, showValues: false, showPoints: true, showLegend: true, pieLabelMode: "percentage", pieSeriesId: "unsafe-series-1" });
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

test("種類を棒から折れ線、円、棒へ切り替えてもID、共通データ、表示設定を保持する", () => {
  const bar = normalizeChartBlock({
    id: "switchable", chartType: "bar", title: "比較", unit: "点",
    items: [{ id: "first", label: "一回目", value: 70.5 }, { id: "second", label: "二回目", value: 27.75 }],
    appearance: { color: "#dc2626", showValues: false, showPoints: false, showLegend: true, pieLabelMode: "value" }
  });
  const common = ({ id, title, unit, items, appearance }) => ({ id, title, unit, items, appearance });
  const line = normalizeChartBlock({ ...bar, chartType: "line" });
  const pie = normalizeChartBlock({ ...line, chartType: "pie" });
  const restoredBar = parseChartBlockLine(serializeChartBlock({ ...pie, chartType: "bar" }));
  assert.equal(line.chartType, "line");
  assert.equal(pie.chartType, "pie");
  assert.equal(restoredBar.chartType, "bar");
  assert.deepEqual(common(restoredBar), common(bar));
});

test("棒の向きは既定の縦へ正規化し、種類切替、保存、並べ替え後も保持する", () => {
  const legacy = normalizeChartBlock({ id: "legacy", chartType: "bar", items: [{ label: "1月", value: 1 }] });
  const stacked = normalizeChartBlock({ ...legacy, appearance: { ...legacy.appearance, barMode: "stacked" } });
  const percentStacked = normalizeChartBlock({ ...legacy, appearance: { ...legacy.appearance, barMode: "percent-stacked" } });
  const invalid = normalizeChartBlock({ ...legacy, appearance: { ...legacy.appearance, barMode: "percent" } });
  const horizontal = normalizeChartBlock({ ...stacked, appearance: { ...stacked.appearance, barOrientation: "horizontal" } });
  const invalidOrientation = normalizeChartBlock({ ...stacked, appearance: { ...stacked.appearance, barOrientation: "sideways" } });
  assert.equal(legacy.appearance.barMode, "grouped");
  assert.equal(legacy.appearance.barOrientation, "vertical");
  assert.equal(createChartBlock("vertical").appearance.barOrientation, "vertical");
  assert.equal(stacked.appearance.barMode, "stacked");
  assert.equal(percentStacked.appearance.barMode, "percent-stacked");
  assert.equal(invalid.appearance.barMode, "grouped");
  assert.equal(normalizeChartBlock({ ...stacked, chartType: "line" }).appearance.barMode, "stacked");
  assert.equal(normalizeChartBlock({ ...stacked, chartType: "pie" }).appearance.barMode, "stacked");
  assert.equal(parseChartBlockLine(serializeChartBlock(stacked)).appearance.barMode, "stacked");
  assert.equal(normalizeChartBlock({ ...percentStacked, chartType: "line" }).appearance.barMode, "percent-stacked");
  assert.equal(normalizeChartBlock({ ...percentStacked, chartType: "pie" }).appearance.barMode, "percent-stacked");
  assert.equal(parseChartBlockLine(serializeChartBlock(percentStacked)).appearance.barMode, "percent-stacked");
  assert.equal(horizontal.appearance.barOrientation, "horizontal");
  assert.equal(invalidOrientation.appearance.barOrientation, "vertical");
  assert.equal(parseChartBlockLine(serializeChartBlock(horizontal)).appearance.barOrientation, "horizontal");
  assert.equal(moveChartSeries(moveChartItem(horizontal, 0, 0), 0, 0).appearance.barOrientation, "horizontal");
  ["bar", "line", "pie"].forEach((chartType) => assert.equal(normalizeChartBlock({ ...horizontal, chartType }).appearance.barOrientation, "horizontal"));
});

test("横棒の座標は集合、積み上げ、100%積み上げで有限かつ連続になる", () => {
  const items = [{ id: "a", label: "長い日本語の項目名です" }, { id: "b", label: "B" }];
  const series = [{ id: "one", values: [60, 0] }, { id: "two", values: [40, 0] }, { id: "three", values: [20, 0] }];
  const grouped = horizontalBarSegments(items, series, { left: 140, width: 520, mode: "grouped" });
  const stacked = horizontalBarSegments(items, series, { left: 140, width: 520, mode: "stacked" });
  const percent = horizontalBarSegments(items, series, { left: 140, width: 520, mode: "percent-stacked" });
  assert.equal(grouped.segments.length, 6);
  assert.ok(grouped.segments.filter((segment) => segment.item.id === "a").every((segment, index, entries) => segment.y < entries[Math.min(index + 1, entries.length - 1)].y || index === entries.length - 1), "集合横棒は同じ項目の系列を上下へ配置する");
  const stackedA = stacked.segments.filter((segment) => segment.item.id === "a");
  assert.equal(stackedA[0].x, 140);
  assert.equal(stackedA[0].x + stackedA[0].width, stackedA[1].x);
  assert.equal(stackedA[1].x + stackedA[1].width, stackedA[2].x);
  assert.deepEqual(percent.segments.filter((segment) => segment.item.id === "a").map((segment) => Math.round(segment.percentage)), [50, 33, 17]);
  assert.ok(percent.segments.filter((segment) => segment.item.id === "b").every((segment) => segment.width === 0 && segment.percentage === 0));
  [grouped, stacked, percent, horizontalBarSegments(items, [{ values: [Number.MAX_VALUE, 0] }, { values: [1e308, 0] }], { mode: "stacked" })].forEach((layout) => assert.ok(layout.segments.every((segment) => [segment.x, segment.y, segment.width, segment.height, segment.stackStart, segment.stackEnd, segment.percentage].every(Number.isFinite) && segment.width >= 0 && segment.height >= 0)));
});

test("横棒の長い日本語項目名は左領域を上限付きで確保し、全文を保持して短縮する", () => {
  const full = "空白を含まない非常に長い日本語項目名を二行までで表示するためのテストです";
  const width = horizontalBarLabelWidth([{ label: full }]);
  const label = horizontalBarLabel(full, { maximumWidth: 90 });
  assert.ok(width > 94 && width <= 180);
  assert.equal(label.fullText, full);
  assert.ok(label.lines.length <= 2);
  assert.equal(label.shortened, true);
  assert.match(label.text, /…$/);
});

test("共通ラベル整形は短い日本語を保持し、長い日本語・英数字・空白なし文字列を2行と省略記号へ収める", () => {
  const short = chartLabelLayout("4月", { maximumWidth: 72 });
  const japanese = chartLabelLayout("空白を含まない非常に長い日本語項目名を二行へ収めるテスト", { maximumWidth: 72 });
  const latin = chartLabelLayout("VeryLongAlphaNumericCategoryIdentifierWithoutSpaces", { maximumWidth: 72 });
  assert.deepEqual(short.lines, ["4月"]);
  [japanese, latin].forEach((label) => {
    assert.equal(label.lines.length, 2);
    assert.equal(label.shortened, true);
    assert.ok(label.text.endsWith("…"));
    assert.ok(label.lines.every((line) => Array.from(line).length <= label.charactersPerLine));
  });
  assert.equal(japanese.fullText, "空白を含まない非常に長い日本語項目名を二行へ収めるテスト");
});

test("カテゴリ軸ラベルは幅・件数から間引き、短いラベルは全件、狭幅では重なりなく先頭または末尾を残す", () => {
  const short = chartCategoryLabels([{ label: "1月" }, { label: "2月" }, { label: "3月" }], { plotWidth: 360 });
  const many = chartCategoryLabels(Array.from({ length: 20 }, (_, index) => ({ label: `空白なし長い項目名${index + 1}` })), { plotWidth: 240 });
  assert.ok(short.every((entry) => entry.visible), "十分な幅なら全ラベルを表示する");
  assert.ok(many.some((entry) => !entry.visible), "狭幅で多数なら軸ラベルだけを間引く");
  assert.equal(many[0].visible, true);
  assert.ok(many.at(-1).visible || many.filter((entry) => entry.visible).length === 1, "重なりを避けられる場合は末尾も残す");
  assert.ok(many.filter((entry) => entry.visible).every((entry) => entry.layout.lines.length <= 2));
});

test("数値目盛りと軸余白は有限値だけを使い、狭い領域で密度を下げ、0でも少なくとも1目盛りを返す", () => {
  const narrow = chartNumericTicks(12345.678, { availableSpace: 48, minimumSpacing: 32 });
  const wide = chartNumericTicks(12345.678, { availableSpace: 180, minimumSpacing: 32 });
  const zero = chartNumericTicks(0, { availableSpace: 180 });
  const invalid = chartNumericTicks(Infinity, { availableSpace: 180 });
  const axis = chartValueAxisLayout(123456789012345, { availableSpace: 80, minimumSpacing: 40 });
  assert.ok(narrow.length >= 2 && narrow.length < wide.length);
  assert.deepEqual(zero, [{ value: 0, label: "0" }]);
  assert.deepEqual(invalid, [{ value: 0, label: "0" }]);
  assert.equal(axis.margin, Math.max(42, Math.ceil(axis.labelWidth + 10)));
  assert.ok(axis.ticks.every((tick) => Number.isFinite(tick.value) && !tick.label.includes("Infinity") && !tick.label.includes("NaN")));
});

test("数値軸は巨大有限値の目盛り全体と安全余白を確保し、小さい値の余白は広げない", () => {
  for (const maximum of [Number.MAX_VALUE, 1.7e308, 123456789012345, 1e-7, Number.MIN_VALUE]) {
    const axis = chartValueAxisLayout(maximum);
    assert.deepEqual(axis.ticks, chartNumericTicks(maximum), "余白計算は目盛りの値・密度・表示文字を変更しない");
    assert.ok(Number.isFinite(axis.margin));
    assert.ok(axis.margin >= axis.labelWidth + 10, "固定上限で全文幅や安全余白を切り捨てない");
  }
  assert.equal(chartValueAxisLayout(0).margin, 42);
  assert.equal(chartValueAxisLayout(10).margin, 42);
});

test("通常積み上げの合計値設定は安全に正規化、直列化し、表示対象だけを判定する", () => {
  const source = normalizeChartBlock({
    id: "totals", chartType: "bar", items: [{ id: "jan", label: "1月", value: 1 }],
    appearance: { barMode: "stacked", showStackTotals: true }
  });
  const invalid = normalizeChartBlock({ ...source, appearance: { ...source.appearance, showStackTotals: "true" } });
  assert.equal(source.appearance.showStackTotals, true);
  assert.equal(invalid.appearance.showStackTotals, false, "欠損以外の不正値もfalseへ正規化する");
  assert.equal(normalizeChartBlock({ id: "missing", items: [] }).appearance.showStackTotals, false, "旧データの欠損値はfalseにする");
  assert.equal(parseChartBlockLine(serializeChartBlock(source)).appearance.showStackTotals, true, "保存と再正規化で設定を維持する");
  assert.equal(shouldShowStackTotals(source), true);
  [
    { ...source, appearance: { ...source.appearance, barMode: "grouped" } },
    { ...source, appearance: { ...source.appearance, barMode: "percent-stacked" } },
    { ...source, chartType: "line" },
    { ...source, chartType: "pie" }
  ].forEach((chart) => assert.equal(shouldShowStackTotals(chart), false));
});

test("項目別合計は全系列から不変に導出し、旧形式、並べ替え、追加削除へ追従する", () => {
  const items = [{ id: "jan", label: "1月" }, { id: "feb", label: "2月" }, { id: "mar", label: "3月" }];
  const series = [
    { id: "sales", values: [0.1, 0, 10] },
    { id: "profit", values: [0.2, 0, 20] },
    { id: "cost", values: [0, 0, 30] }
  ];
  const original = structuredClone({ items, series });
  assert.deepEqual(chartStackedTotals(items, series).map(({ itemIndex, total, overflow }) => ({ itemIndex, total, overflow })), [
    { itemIndex: 0, total: 0.30000000000000004, overflow: false },
    { itemIndex: 1, total: 0, overflow: false },
    { itemIndex: 2, total: 60, overflow: false }
  ]);
  assert.equal(formatChartStackTotal(chartStackedTotals(items, series)[0]), "0.3", "浮動小数点誤差を長い表示文字列にしない");
  assert.deepEqual(chartStackedTotals([{ label: "旧形式", value: 4.5 }]).map((entry) => entry.total), [4.5], "旧items[].value形式も第1系列として安全に扱う");
  assert.deepEqual({ items, series }, original, "入力オブジェクトと配列を変更しない");
  assert.deepEqual(chartStackedTotals([items[2], items[0]], series.map((entry) => ({ ...entry, values: [entry.values[2], entry.values[0]] }))).map((entry) => entry.total), [60, 0.30000000000000004], "項目の並べ替え後も対応する合計になる");
  assert.deepEqual(chartStackedTotals(items, [series[2], series[0], series[1]]).map((entry) => entry.total), [0.30000000000000004, 0, 60], "系列順を変えても合計は変わらない");
  assert.deepEqual(chartStackedTotals(items, series.slice(0, 2)).map((entry) => entry.total), [0.30000000000000004, 0, 30], "系列の追加削除後は現在の系列だけで再計算する");
});

test("項目別合計は巨大な有限値の上限超過をInfinityにせず公開する", () => {
  const items = [{ id: "huge", label: "巨大" }, { id: "finite", label: "有限" }];
  const series = [{ values: [Number.MAX_VALUE, 1e308] }, { values: [1e308, 1e307] }];
  const totals = chartStackedTotals(items, series);
  assert.deepEqual(totals.map(({ total, overflow }) => ({ total, overflow })), [
    { total: null, overflow: true }, { total: 1.1e308, overflow: false }
  ]);
  assert.ok(totals.every((entry) => entry.total === null || Number.isFinite(entry.total)), "NaNやInfinityを表示用データへ渡さない");
});

test("最大有限の積み上げ合計は表示の丸めで上限超過にしない", () => {
  const maximumFinite = { total: Number.MAX_VALUE, overflow: false };
  const nearMaximumFinite = { total: 1.79e308, overflow: false };
  const directNonFinite = [{ total: NaN, overflow: false }, { total: Infinity, overflow: false }];
  const totals = chartStackedTotals([{ id: "max", label: "最大" }], [{ values: [Number.MAX_VALUE] }]);
  assert.deepEqual(totals.map(({ total, overflow }) => ({ total, overflow })), [{ total: Number.MAX_VALUE, overflow: false }]);
  [maximumFinite, nearMaximumFinite].forEach((entry) => {
    const detail = formatChartStackTotalDetail(entry);
    const display = formatChartStackTotal(entry);
    assert.notEqual(detail, "上限超過");
    assert.doesNotMatch(detail, /Infinity|NaN/);
    assert.match(display, /^\d(?:\.\d+)?e\+\d+$/, "最大付近の有限値は短い科学表記で表示する");
    assert.doesNotMatch(display, /上限超過|Infinity|NaN/);
  });
  assert.equal(formatChartStackTotalDetail({ total: 0.1 + 0.2, overflow: false }), "0.3", "小数の誤差正規化を維持する");
  assert.equal(formatChartStackTotal(chartStackedTotals([{ label: "超過" }], [{ values: [Number.MAX_VALUE] }, { values: [1e308] }])[0]), "上限超過", "実際の加算上限超過は表示しない");
  directNonFinite.forEach((entry) => {
    assert.equal(formatChartStackTotalDetail(entry), "上限超過");
    assert.equal(formatChartStackTotal(entry), "上限超過");
  });
});

test("積み上げ合計は視覚用を短縮し、詳細値と非有限値保護を分離する", () => {
  const shortInteger = { total: 190, overflow: false };
  const decimal = { total: 0.1 + 0.2, overflow: false };
  const longInteger = { total: 123456789012345, overflow: false };
  const hugeFinite = { total: 1.23456789012345e308, overflow: false };
  const overflow = { total: null, overflow: true };
  const nonFinite = [{ total: NaN, overflow: false }, { total: Infinity, overflow: false }];
  assert.equal(formatChartStackTotal(shortInteger), "190");
  assert.equal(formatChartStackTotal(decimal), "0.3");
  assert.equal(formatChartStackTotalDetail(decimal), "0.3", "詳細値にも浮動小数点誤差を露出しない");
  assert.equal(formatChartStackTotal(longInteger), "1.23e+14");
  assert.equal(formatChartStackTotalDetail(longInteger), "123456789012345");
  assert.equal(formatChartStackTotal(hugeFinite), "1.23e+308");
  assert.equal(formatChartStackTotalDetail(hugeFinite), "1.23456789012345e+308");
  assert.equal(formatChartStackTotal(overflow), "上限超過");
  assert.equal(formatChartStackTotalDetail(overflow), "上限超過");
  nonFinite.forEach((total) => {
    assert.equal(formatChartStackTotal(total), "上限超過");
    assert.equal(formatChartStackTotalDetail(total), "上限超過");
  });
});

test("積み上げ棒の座標は系列順を保ち、同じ項目で連続して積み上がる", () => {
  const items = [{ id: "jan", label: "1月" }, { id: "feb", label: "2月" }, { id: "mar", label: "3月" }];
  const series = [
    { id: "shop", name: "店舗", values: [50, 20, 10] },
    { id: "online", name: "オンライン", values: [30, 40, 20] },
    { id: "corporate", name: "法人", values: [20, 10, 30] }
  ];
  const sourceValues = series.map((entry) => entry.values.slice());
  const layout = stackedBarSegments(items, series, { width: 466, top: 54, baseline: 196 });
  assert.deepEqual(layout.segments.map((segment) => [segment.item.id, segment.series.id]), [
    ["jan", "shop"], ["jan", "online"], ["jan", "corporate"],
    ["feb", "shop"], ["feb", "online"], ["feb", "corporate"],
    ["mar", "shop"], ["mar", "online"], ["mar", "corporate"]
  ]);
  for (const itemId of items.map((item) => item.id)) {
    const segments = layout.segments.filter((segment) => segment.item.id === itemId);
    assert.equal(new Set(segments.map((segment) => segment.x)).size, 1, `${itemId}の系列は同じx位置を使う`);
    assert.equal(segments[0].y + segments[0].height, 196, `${itemId}の第1系列は基線から開始する`);
    assert.equal(segments[1].y + segments[1].height, segments[0].y, `${itemId}の第2系列は第1系列の上へ続く`);
    assert.equal(segments[2].y + segments[2].height, segments[1].y, `${itemId}の第3系列は第2系列の上へ続く`);
  }
  assert.equal(Math.min(...layout.segments.filter((segment) => segment.item.id === "jan").map((segment) => segment.y)), 54, "最大合計の棒をプロット上端へ収める");
  assert.deepEqual(series.map((entry) => entry.values), sourceValues, "入力値配列を変更しない");
});

test("積み上げ棒は0、単一系列、巨大値でも有限で負でない座標にする", () => {
  const items = [{ id: "one", label: "1月" }, { id: "two", label: "2月" }];
  const zero = stackedBarSegments(items, [{ id: "a", values: [0, 0] }, { id: "b", values: [0, 0] }]);
  const single = stackedBarSegments([{ id: "one", label: "1月" }], [{ id: "a", values: [10] }]);
  const huge = stackedBarSegments(items, [{ id: "a", values: [1e308, 1e308] }, { id: "b", values: [1e308, 1] }, { id: "c", values: [0, 1e307] }]);
  for (const layout of [zero, single, huge]) {
    assert.ok(layout.segments.every((segment) => [segment.x, segment.y, segment.width, segment.height, segment.stackStart, segment.stackEnd].every(Number.isFinite) && segment.height >= 0), "全てのSVG座標を有限かつ非負にする");
  }
  assert.ok(zero.segments.every((segment) => segment.height === 0), "全値0では高さ0にする");
  assert.equal(single.segments[0].height, 142, "単一系列は既存棒と同じプロット高を使う");
  assert.equal(Math.min(...huge.segments.filter((segment) => segment.item.id === "one").map((segment) => segment.y)), 54, "巨大値の最大積み上げも上端を越えない");
});

test("100%積み上げは項目ごとの割合をscaleBase経由で安全に計算し、元値を変えない", () => {
  const items = [{ id: "first", label: "60と40" }, { id: "second", label: "90と60" }, { id: "decimal", label: "小数" }];
  const series = [
    { id: "a", name: "A", values: [60, 90, 1.25] },
    { id: "b", name: "B", values: [40, 60, 3.75] }
  ];
  const sourceValues = series.map((entry) => entry.values.slice());
  const layout = stackedBarSegments(items, series, { width: 466, top: 54, baseline: 196, mode: "percent-stacked" });
  assert.equal(layout.mode, "percent-stacked");
  assert.deepEqual(layout.segments.map((segment) => Math.round(segment.percentage * 1000) / 1000), [60, 40, 60, 40, 25, 75]);
  for (const item of items) {
    const segments = layout.segments.filter((segment) => segment.item.id === item.id);
    assert.equal(segments[0].y + segments[0].height, 196, `${item.label}の第1系列は基線から開始する`);
    assert.equal(segments.at(-1).y, 54, `${item.label}は合計100%で上端に届く`);
    assert.equal(segments.reduce((sum, segment) => sum + segment.percentage, 0), 100, `${item.label}の未丸め割合は100%になる`);
  }
  assert.deepEqual(series.map((entry) => entry.values), sourceValues, "割合を入力元の値配列へ上書きしない");
});

test("100%積み上げは項目単位の安全な縮小で極端な桁差を保ち、通常積み上げを変えない", () => {
  const items = [{ id: "huge", label: "巨大" }, { id: "tiny", label: "微小" }, { id: "zero", label: "全0" }];
  const series = [
    { id: "a", values: [1e308, 1e-300, 0] },
    { id: "b", values: [1e308, 1e-300, 0] }
  ];
  const sourceValues = series.map((entry) => entry.values.slice());
  const percent = stackedBarSegments(items, series, { mode: "percent-stacked" });
  const stacked = stackedBarSegments(items, series);

  for (const itemId of ["huge", "tiny"]) {
    const segments = percent.segments.filter((segment) => segment.item.id === itemId);
    assert.deepEqual(segments.map((segment) => segment.percentage), [50, 50], `${itemId}の同値2系列は50%ずつになる`);
    assert.equal(segments.at(-1).y, 54, `${itemId}は正の値があれば100%まで描画する`);
    assert.ok(segments.every((segment) => [segment.percentage, segment.y, segment.height, segment.stackStart, segment.stackEnd].every(Number.isFinite)), `${itemId}の割合と描画用数値を有限にする`);
  }
  assert.ok(percent.segments.filter((segment) => segment.item.id === "zero").every((segment) => segment.height === 0 && segment.percentage === 0), "全0項目だけを空の棒にする");
  assert.deepEqual(series.map((entry) => entry.values), sourceValues, "項目ごとの割合計算も元の系列値配列を変更しない");
  assert.equal(stacked.scaleBase, 1e308, "通常積み上げは従来どおり全項目共通のscaleBaseを使う");
  assert.ok(stacked.segments.filter((segment) => segment.item.id === "tiny").every((segment) => segment.height === 0), "通常積み上げの既存の極端な桁差の結果を変えない");
});

test("100%積み上げは0、単一系列、巨大有限値、系列の追加削除後も有限に再計算する", () => {
  const items = [{ id: "zero", label: "全0" }, { id: "partial", label: "一部0" }, { id: "single", label: "単一" }];
  const initial = [
    { id: "a", values: [0, 0, 8] },
    { id: "b", values: [0, 4, 0] },
    { id: "c", values: [0, 0, 0] }
  ];
  const zeroAndPartial = stackedBarSegments(items, initial, { mode: "percent-stacked" });
  assert.ok(zeroAndPartial.segments.filter((segment) => segment.item.id === "zero").every((segment) => segment.height === 0 && segment.percentage === 0), "合計0では空の棒にする");
  assert.deepEqual(zeroAndPartial.segments.filter((segment) => segment.item.id === "partial").map((segment) => segment.percentage), [0, 100, 0], "一部0でも残りの系列を100%にする");
  assert.deepEqual(zeroAndPartial.segments.filter((segment) => segment.item.id === "single").map((segment) => segment.percentage), [100, 0, 0], "1系列だけの項目を100%にする");
  const reduced = stackedBarSegments(items.slice(1), [
    { ...initial[0], values: initial[0].values.slice(1) },
    { ...initial[1], values: initial[1].values.slice(1) }
  ], { mode: "percent-stacked" });
  assert.deepEqual(reduced.segments.filter((segment) => segment.item.id === "partial").map((segment) => segment.percentage), [0, 100], "系列と項目の削除後も現在の全系列だけで再計算する");
  const huge = stackedBarSegments([{ id: "huge", label: "巨大" }], [
    { id: "a", values: [1e308] }, { id: "b", values: [1e308] }, { id: "c", values: [1e307] }
  ], { mode: "percent-stacked" });
  assert.ok(huge.segments.every((segment) => [segment.x, segment.y, segment.width, segment.height, segment.percentage].every(Number.isFinite) && segment.height >= 0), "巨大な有限値でもSVG用の値にNaNやInfinityを出さない");
  assert.equal(huge.groups[0].total, null, "表現不能な元値合計をInfinityとして公開しない");
});

test("集合、積み上げ、100%積み上げの切替は元データを変えず、保存後も復元する", () => {
  const source = normalizeChartBlock({
    id: "percent-switch", chartType: "bar", items: [{ id: "a", label: "" }, { id: "b", label: "B" }],
    series: [{ id: "one", name: "", values: [60, 90] }, { id: "two", name: "B", values: [40, 60] }],
    appearance: { barMode: "grouped", showLegend: true }
  });
  const values = source.series.map((series) => series.values.slice());
  const grouped = normalizeChartBlock(source);
  const stacked = normalizeChartBlock({ ...grouped, appearance: { ...grouped.appearance, barMode: "stacked" } });
  const percent = normalizeChartBlock({ ...stacked, appearance: { ...stacked.appearance, barMode: "percent-stacked" } });
  const restored = parseChartBlockLine(serializeChartBlock({ ...percent, chartType: "line" }));
  assert.deepEqual(grouped.series.map((series) => series.values), values);
  assert.deepEqual(stacked.series.map((series) => series.values), values);
  assert.deepEqual(percent.series.map((series) => series.values), values);
  assert.deepEqual(restored.series.map((series) => series.values), values, "種類切替と保存後も全系列の元値を保持する");
  assert.equal(restored.appearance.barMode, "percent-stacked");
  assert.equal(restored.items[0].label, "", "空の項目名も保存データから失わない");
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
  const separated = lineChartPoints([{ id: "maximum", value: Number.MAX_VALUE }, { id: "lower", value: Number.MAX_VALUE / 2 }], 420, { left: 86, right: 18, top: 42, baseline: 196 });
  assert.ok(separated.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), "巨大な有限値と分離したプロット領域でも有限座標にする");
  assert.ok(separated[0].x > 42, "先頭点をY軸より右のプロット領域へ置く");
});

test("表示系列、共通スケール、折れ線横幅はグラフ種別ごとの規則を共有する", () => {
  const source = normalizeChartBlock({
    id: "multi-line", chartType: "line", items: [{ id: "jan", label: "1月" }, { id: "feb", label: "2月" }, { id: "mar", label: "3月" }],
    series: [
      { id: "sales", name: "売上", values: [40, 60, 50] },
      { id: "profit", name: "営業利益", values: [20, 80, 30] },
      { id: "cost", name: "原価", values: [10, 15, 12] }
    ]
  });
  assert.deepEqual(chartDisplaySeries(source).map((series) => series.id), ["sales", "profit", "cost"]);
  const displayedItems = chartDisplaySeries(source).flatMap((series) => source.items.map((item, index) => ({ ...item, value: series.values[index] })));
  assert.equal(chartValueMaximum(displayedItems), 80, "折れ線は表示する全系列の最大値を共通スケールに使う");
  const points = lineChartPoints(displayedItems.slice(3, 6), lineChartWidth(source.items), { maximum: chartValueMaximum(displayedItems) });
  assert.equal(points[1].y, 22, "最大値80の点を共通スケールの上端へ描画する");
  assert.equal(lineChartWidth(source.items), lineChartWidth([{ label: "1月" }, { label: "2月" }, { label: "3月" }]), "系列数は折れ線の横幅へ加算しない");
  assert.ok(lineChartPoints([{ id: "zero", value: 0 }], 420, { maximum: 0 }).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0));
  assert.deepEqual(chartDisplaySeries({ ...source, chartType: "pie" }).map((series) => series.id), ["sales"], "円は第1系列だけを表示する");
});

test("円グラフは共通項目データを使い、最後の扇形まで合計100%にする", () => {
  const chart = normalizeChartBlock({
    id: "pie", chartType: "pie", unit: "個", items: [
      { id: "a", label: "A", value: 2 }, { id: "b", label: "B", value: 3 }, { id: "zero", label: "0", value: 0 }
    ], appearance: { showLegend: true, pieLabelMode: "value" }
  });
  const pie = pieChartSegments(chart.items.map((item, index) => ({ ...item, value: chart.series[0].values[index] })));
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

test("旧形式は第1系列へ読み込み時に正規化し、保存時だけ新形式へ移行する", () => {
  const legacy = { id: "legacy", chartType: "bar", items: [{ id: "jan", label: "1月", value: 100 }, { id: "feb", label: "2月", value: 140 }], appearance: { color: "#336699" } };
  const chart = normalizeChartBlock(legacy);
  assert.deepEqual(chart.items, [{ id: "jan", label: "1月" }, { id: "feb", label: "2月" }]);
  assert.deepEqual(chart.series, [{ id: "legacy-series-1", name: "系列 1", color: "#336699", values: [100, 140] }]);
  assert.equal(Object.hasOwn(chart.items[0], "value"), false);
  const stored = JSON.parse(Buffer.from(serializeChartBlock(chart).match(/:([0-9a-f]+) -->/i)[1], "hex").toString("utf8"));
  assert.equal(Object.hasOwn(stored.items[0], "value"), false, "新形式だけを保存する");
  assert.deepEqual(stored.series[0].values, [100, 140]);
});

test("2系列・3系列を項目順へ正規化し、不正値、余剰値、4系列目を安全に扱う", () => {
  const chart = normalizeChartBlock({
    id: "months", items: [{ id: "jan", label: "1月" }, { id: "feb", label: "2月" }],
    series: [
      { id: "sales", name: "売上", color: "#2563eb", values: [100, "140", 999] },
      { id: "profit", name: "利益", color: "#16a34a", values: [30, Infinity] },
      { id: "cost", name: "原価", color: "bad", values: [0, 38] },
      { id: "ignored", name: "対象外", values: [1, 1] }
    ]
  });
  assert.equal(chart.series.length, 3);
  assert.deepEqual(chart.series.map(({ id, name, color, values }) => ({ id, name, color, values })), [
    { id: "sales", name: "売上", color: "#2563eb", values: [100, 140] },
    { id: "profit", name: "利益", color: "#16a34a", values: [30, 0] },
    { id: "cost", name: "原価", color: CHART_SERIES_COLORS[2], values: [0, 38] }
  ]);
});

test("系列の値は項目の追加・削除を経ても対応を保てる正規化長へそろえる", () => {
  const chart = normalizeChartBlock({
    id: "aligned", items: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
    series: [{ id: "one", name: "一", values: [1, 2] }, { id: "two", name: "二", values: [3, 4, 5, 6] }]
  });
  assert.deepEqual(chart.series.map((series) => series.values), [[1, 2, 0], [3, 4, 5]]);
});

test("項目の移動は3系列の値を同じ位置で一体に並べ替え、IDと入力を維持する", () => {
  const source = normalizeChartBlock({
    id: "months", chartType: "bar", items: [{ id: "jan", label: "1月" }, { id: "feb", label: "2月" }, { id: "mar", label: "3月" }],
    series: [
      { id: "sales", name: "売上", values: [10, 20, 30] },
      { id: "profit", name: "利益", values: [100, 200, 300] },
      { id: "cost", name: "原価", values: [1, 2, 3] }
    ]
  });
  const original = structuredClone(source);
  const moved = moveChartItem(source, 2, -1);
  assert.deepEqual(moved.items.map((item) => [item.id, item.label]), [["jan", "1月"], ["mar", "3月"], ["feb", "2月"]]);
  assert.deepEqual(moved.series.map((series) => series.values), [[10, 30, 20], [100, 300, 200], [1, 3, 2]]);
  assert.equal(moved.id, "months");
  assert.deepEqual(moved.series.map((series) => series.id), ["sales", "profit", "cost"]);
  assert.deepEqual(source, original, "入力の配列・項目・系列を直接変更しない");
  assert.notEqual(moved.items, source.items);
  assert.notEqual(moved.series[0].values, source.series[0].values);
});

test("項目の連続移動と範囲外操作は安全で、少数・0・巨大な有限値を保持する", () => {
  const source = normalizeChartBlock({
    id: "values", items: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
    series: [{ id: "one", values: [0, 1.5, 1e308] }, { id: "two", values: [2.25, 0, 3] }]
  });
  const lastToFirst = moveChartItem(moveChartItem(source, 2, -1), 1, -1);
  assert.deepEqual(lastToFirst.items.map((item) => item.id), ["c", "a", "b"]);
  assert.deepEqual(lastToFirst.series.map((series) => series.values), [[1e308, 0, 1.5], [3, 2.25, 0]]);
  const restored = moveChartItem(moveChartItem(lastToFirst, 0, 1), 1, 1);
  assert.deepEqual(restored.items.map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(restored.series.map((series) => series.values), source.series.map((series) => series.values));
  [-1, 3, 1.5, "1"].forEach((index) => assert.deepEqual(moveChartItem(source, index, 1), source));
  assert.deepEqual(moveChartItem(source, 0, -1), source);
  assert.deepEqual(moveChartItem(source, 2, 1), source);
  assert.deepEqual(moveChartItem(createChartBlock("only"), 0, 1), createChartBlock("only"));
});

test("系列の移動はID、名前、色、全項目値を一体で並べ替え、項目を変更しない", () => {
  const source = normalizeChartBlock({
    id: "series-order", chartType: "bar",
    items: [{ id: "jan", label: "1月" }, { id: "feb", label: "2月" }, { id: "mar", label: "3月" }],
    series: [
      { id: "sales", name: "売上", color: "#4f46e5", values: [0, 1.5, 1e308] },
      { id: "profit", name: "利益", color: "#dc2626", values: [20, 30, 40] },
      { id: "cost", name: "原価", color: "#059669", values: [2.25, 0, 3] }
    ]
  });
  const original = structuredClone(source);
  const up = moveChartSeries(source, 1, -1);
  assert.deepEqual(up.series.map((series) => [series.id, series.name, series.color, series.values]), [
    ["profit", "利益", "#dc2626", [20, 30, 40]],
    ["sales", "売上", "#4f46e5", [0, 1.5, 1e308]],
    ["cost", "原価", "#059669", [2.25, 0, 3]]
  ]);
  assert.deepEqual(up.items, source.items, "項目と項目ID・順序を変更しない");
  assert.deepEqual(source, original, "入力オブジェクトと配列を直接変更しない");
  assert.notEqual(up.series, source.series);
  assert.equal(up.appearance.color, "#dc2626");
  const down = moveChartSeries(up, 0, 1);
  assert.deepEqual(down.series, source.series, "連続移動で元の系列順へ戻せる");
  [-1, 3, 1.5, "1"].forEach((index) => assert.deepEqual(moveChartSeries(source, index, 1), source));
  assert.deepEqual(moveChartSeries(source, 0, -1), source);
  assert.deepEqual(moveChartSeries(source, 2, 1), source);
  assert.deepEqual(moveChartSeries(createChartBlock("only"), 0, 1), createChartBlock("only"));
});

test("旧形式の正規化後も系列順は直列化、表示系列、積み上げ順で維持される", () => {
  const legacy = normalizeChartBlock({ id: "legacy-series", items: [{ id: "a", label: "A", value: 10 }, { id: "b", label: "B", value: 20 }] });
  const withSecond = normalizeChartBlock({ ...legacy, series: [...legacy.series, { id: "second", name: "次", color: "#dc2626", values: [30, 40] }] });
  const moved = parseChartBlockLine(serializeChartBlock(moveChartSeries(withSecond, 1, -1)));
  assert.deepEqual(moved.series.map((series) => series.id), ["second", legacy.series[0].id]);
  assert.deepEqual(chartDisplaySeries({ ...moved, chartType: "line" }).map((series) => series.id), ["second", legacy.series[0].id]);
  assert.deepEqual(chartDisplaySeries({ ...moved, chartType: "pie" }).map((series) => series.id), [legacy.series[0].id], "系列順を変えても既定選択の系列IDを維持する");
  ["stacked", "percent-stacked"].forEach((mode) => assert.deepEqual(
    stackedBarSegments(moved.items, moved.series, { mode }).segments.map((segment) => segment.series.id),
    ["second", legacy.series[0].id, "second", legacy.series[0].id]
  ));
});

test("旧形式の正規化後も移動、直列化、表示系列、積み上げ座標の対応を維持する", () => {
  const legacy = { id: "legacy", chartType: "bar", items: [{ id: "jan", label: "1月", value: 60 }, { id: "feb", label: "2月", value: 40 }] };
  const moved = moveChartItem(normalizeChartBlock(legacy), 1, -1);
  const restored = parseChartBlockLine(serializeChartBlock(moved));
  assert.deepEqual(restored.items.map((item) => item.id), ["feb", "jan"]);
  assert.deepEqual(restored.series[0].values, [40, 60]);
  assert.deepEqual(chartDisplaySeries({ ...restored, chartType: "line" }).map((series) => series.id), restored.series.map((series) => series.id));
  assert.deepEqual(chartDisplaySeries({ ...restored, chartType: "pie" }).map((series) => series.id), [restored.series[0].id]);
  ["stacked", "percent-stacked"].forEach((barMode) => {
    const layout = stackedBarSegments(restored.items, restored.series, { mode: barMode });
    assert.ok(layout.segments.every((segment) => [segment.x, segment.y, segment.width, segment.height, segment.percentage].every(Number.isFinite)));
  });
});

function signedChart(values = [-30, 0, 25.75]) {
  return normalizeChartBlock({ id: "signed", chartType: "bar",
    items: values.map((value, index) => ({ id: "item-" + index, label: "項目" + index })),
    series: [{ id: "first", name: "第一", color: "#123456", values }, { id: "second", name: "第二", color: "#abcdef", values: values.map((v) => -v) }],
    appearance: { showLegend: true, showValues: true }
  });
}

for (const [name, values, expected] of [
  ["正数", [1, 25.75], { minimum: 0, maximum: 25.75 }],
  ["負数", [-30, -0.5], { minimum: -30, maximum: 0 }],
  ["混在", [-30, 0, 25.75], { minimum: -30, maximum: 25.75 }],
  ["全値0", [0, 0], { minimum: 0, maximum: 0 }],
  ["負の0", [-0], { minimum: 0, maximum: 0 }]
]) test(name + "の軸範囲に0を含める", () => {
  const range = chartValueRange(values.map((value) => ({ value })));
  assert.deepEqual(range, expected);
  assert.ok(Number.isFinite(chartValueRatio(0, range)));
});

test("複数系列の共通範囲を求める", () => {
  const chart = signedChart();
  assert.deepEqual(chartValueRange(chart.series.flatMap((s) => s.values.map((value) => ({ value })))), { minimum: -30, maximum: 30 });
});

test("有限な負数、小数と負の0を正規化・直列化・再読込する", () => {
  const chart = signedChart([-0.5, -0, 25.75]);
  assert.deepEqual(chart.series[0].values, [-0.5, 0, 25.75]);
  assert.equal(Object.is(chart.series[0].values[1], -0), false);
  assert.deepEqual(parseChartBlockLine(serializeChartBlock(chart)), chart);
  assert.equal(chart.schemaVersion, 1);
  assert.equal(finiteChartNumber("-0.5"), -0.5);
});

test("負数を含む項目と系列をID・色ごと並べ替えて保存する", () => {
  const chart = signedChart();
  const moved = moveChartSeries(moveChartItem(chart, 2, -1), 1, -1);
  assert.deepEqual(moved.items.map((i) => i.id), ["item-0", "item-2", "item-1"]);
  assert.deepEqual(moved.series.map((s) => [s.id, s.color, s.values]), [["second", "#abcdef", [30, -25.75, 0]], ["first", "#123456", [-30, 25.75, 0]]]);
  assert.deepEqual(parseChartBlockLine(serializeChartBlock(moved)), moved);
});

for (const values of [[-Number.MAX_VALUE, Number.MAX_VALUE], [-Number.MIN_VALUE, Number.MIN_VALUE], [-0.0000003, 0.0000002], [-1e-300, 1e300], [-1e300, 1e-300], [0, 0]]) {
  test("極端な正負値の有限な軸・目盛り・座標: " + values, () => {
    const range = chartValueRange(values.map((value) => ({ value })));
    const ticks = chartNumericTicks(range, { availableSpace: 300 });
    assert.equal(ticks.filter((t) => t.value === 0).length, 1);
    assert.ok(ticks.every((t) => Number.isFinite(t.value) && !/NaN|Infinity|^-0$/.test(t.label)));
    assert.equal(new Set(ticks.map((t) => t.value)).size, ticks.length);
    const layout = chartValueAxisLayout(range);
    assert.ok(Number.isFinite(layout.margin));
    for (const v of values) {
      const extent = chartBarExtent(v, range, 196, 54);
      assert.ok(Object.values(extent).every(Number.isFinite));
      assert.ok(extent.size >= 0 && extent.start >= 54 && extent.start + extent.size <= 196 + 1e-10);
    }
  });
}

for (const [orientation, start, end] of [["縦", 196, 54], ["横", 100, 450]]) {
  test(orientation + "棒は0から正負の反対方向へ伸び、寸法が非負になる", () => {
    const range = { minimum: -30, maximum: 60 };
    const negative = chartBarExtent(-30, range, start, end);
    const positive = chartBarExtent(60, range, start, end);
    assert.equal(negative.zero, positive.zero);
    assert.ok((negative.tip - negative.zero) * (positive.tip - positive.zero) < 0);
    for (const extent of [negative, positive, chartBarExtent(0, range, start, end)]) assert.ok(extent.size >= 0);
    assert.equal(chartBarExtent(0, range, start, end).size, 0);
    if (orientation === "縦") assert.ok(negative.tip > negative.zero && positive.tip < positive.zero);
    else assert.ok(negative.tip < negative.zero && positive.tip > positive.zero);
  });
}

test("横棒の複数系列は同じ0位置と系列順を使う", () => {
  const chart = signedChart();
  const layout = horizontalBarSegments(chart.items, chart.series);
  const zero = layout.left + chartValueRatio(0, layout.range) * layout.plotWidth;
  layout.segments.forEach((s) => {
    assert.ok(s.width >= 0 && s.height >= 0);
    assert.ok(s.value < 0 ? Math.abs(s.x + s.width - zero) < 1e-9 : Math.abs(s.x - zero) < 1e-9);
    assert.equal(s.series.id, chart.series[s.seriesIndex].id);
  });
});

test("折れ線は共通軸の正数・0・負数順で配置し不正値を描かない", () => {
  const points = lineChartPoints([30, 0, -30, NaN, Infinity].map((value) => ({ value })), 420, { range: { minimum: -60, maximum: 60 } });
  assert.equal(points.length, 3);
  assert.ok(points[0].y < points[1].y && points[1].y < points[2].y);
  assert.ok(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

for (const [chartType, barMode] of [["pie", "grouped"]]) {
  test(chartType + "/" + barMode + "は負数を保持し描画と保存を拒否する", () => {
    const original = signedChart();
    const unsupported = normalizeChartBlock({ ...original, chartType, appearance: { ...original.appearance, barMode } });
    assert.match(chartValidationError(unsupported), /負数に未対応/);
    assert.throws(() => serializeChartBlock(unsupported), /負数に未対応/);
    assert.deepEqual(unsupported.series, original.series);
    assert.deepEqual(pieChartSegments([{ label: "A", value: -1 }, { label: "B", value: 3 }]).segments, []);
    for (const type of ["bar", "line"]) {
      const restored = normalizeChartBlock({ ...unsupported, chartType: type, appearance: { ...unsupported.appearance, barMode: "grouped" } });
      assert.equal(chartValidationError(restored), "");
      assert.deepEqual(parseChartBlockLine(serializeChartBlock(restored)).series, original.series);
    }
  });
}

test("円グラフの非選択系列や空項目の負数も保存前に検出する", () => {
  const chart = signedChart([1, 2]);
  chart.chartType = "pie";
  chart.items[0].label = "";
  assert.match(chartValidationError(chart), /負数に未対応/);
});

test("NaN・Infinity・不正文字列・途中入力は有限値として確定しない", () => {
  for (const value of [NaN, Infinity, -Infinity, "NaN", "Infinity", "-Infinity", "", " ", "-", "abc", null, true]) {
    assert.equal(isValidChartNumber(value), false);
    const chart = signedChart();
    chart.series[0].values[0] = value;
    assert.throws(() => serializeChartBlock(chart), /有限な数値/);
  }
  for (const value of ["-30", "-0.5", "0", "25.75"]) assert.equal(isValidChartNumber(value), true);
});

test("旧単一系列の正負値を本文の読込だけで変更しない", () => {
  const raw = '<!-- memo-nexus:chart-block:' + Buffer.from(JSON.stringify({ id: "legacy-signed", items: [{ id: "a", label: "A", value: -0.5 }, { id: "b", label: "B", value: 20 }] })).toString("hex") + ' -->';
  const block = splitChartBlocks(raw)[0];
  assert.equal(block.raw, raw);
  assert.deepEqual(block.chart.series[0].values, [-0.5, 20]);
  assert.deepEqual(parseChartBlockLine(serializeChartBlock(block.chart)).series, block.chart.series);
});

test("負数の値ラベルを短縮し元値を変えずSVG内と衝突回避位置へ置く", () => {
  const value = -Number.MAX_VALUE;
  const first = chartValueLabelLayout(value, { x: 110, tip: 196, left: 50, right: 420 });
  assert.match(first.text, /^-/);
  assert.ok(first.text.length < String(value).length);
  assert.ok(first.box.x >= 50 && first.box.x + first.box.width <= 420);
  assert.ok(first.y > 196 && first.y <= 212);
  const second = chartValueLabelLayout(value, { x: 110, tip: 196, left: 50, right: 420, occupied: [first.box] });
  assert.ok(second.box.y + second.box.height <= first.box.y || second.box.y >= first.box.y + first.box.height);
  assert.equal(value, -Number.MAX_VALUE);
});

test("桁差の大きい軸では0と重なる側の目盛りを間引き元の範囲を維持する", () => {
  const range = { minimum: -1e-300, maximum: 1e300 };
  const ticks = chartNumericTicks(range, { availableSpace: 140, minimumSpacing: 32 });
  assert.equal(ticks.filter((t) => chartValueRatio(t.value, range) === 0).length, 1);
  assert.deepEqual(range, { minimum: -1e-300, maximum: 1e300 });
});

test("種別欠損・未知種別も正規化後の100%積み上げ契約で負数を保持する", () => {
  for (const chartType of [undefined, "unknown"]) {
    const source = { chartType, items: [{ label: "旧形式", value: -1 }], appearance: { barMode: "percent-stacked" } };
    assert.equal(chartValidationError(source), "");
    assert.equal(parseChartBlockLine(serializeChartBlock(source)).series[0].values[0], -1);
  }
});

test("負数の事前検証後も配列でない円データを安全に扱う", () => {
  for (const input of [null, undefined, {}, "invalid"]) assert.deepEqual(pieChartSegments(input), { total: 0, segments: [] });
});

test("負数の事前検証後も欠損した旧系列値を安全に扱う", () => {
  const items = [{ label: "A" }];
  for (const series of [[null], [{ values: "invalid" }]]) {
    assert.doesNotThrow(() => stackedBarSegments(items, series));
    assert.doesNotThrow(() => horizontalBarSegments(items, series, { mode: "stacked" }));
    assert.doesNotThrow(() => serializeChartBlock(normalizeChartBlock({ items, series })));
    if (series[0] === null) assert.doesNotThrow(() => serializeChartBlock({ items, series }));
    else assert.throws(() => serializeChartBlock({ items, series }), /有限な数値/);
  }
});


for (const [name, values, totals] of [
  ["正数", [30, 10, 20], [60, 0]], ["負数", [-30, -10, -20], [0, -60]],
  ["混在", [30, -10, 20], [50, -10]], ["負側累計", [-30, 10, -20], [10, -50]],
  ["0を含む", [30, 0, -10], [30, -10]], ["全0", [0, 0, 0], [0, 0]],
  ["負の0", [-0], [0, 0]], ["1系列", [-30], [0, -30]],
  ["小数", [0.1, -0.2, 0.2], [0.30000000000000004, -0.2]],
  ["極小", [Number.MIN_VALUE, -Number.MIN_VALUE, Number.MIN_VALUE], [1e-323, -Number.MIN_VALUE]],
  ["巨大有限", [1e300, -1e300, 1e300], [2e300, -1e300]],
  ["最大有限", [Number.MAX_VALUE, -Number.MAX_VALUE, 0], [Number.MAX_VALUE, -Number.MAX_VALUE]],
  ["正側超過", [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE], [null, -Number.MAX_VALUE]],
  ["負側超過", [-Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE], [Number.MAX_VALUE, null]],
  ["桁差", [1e-300, -1e300, 0], [1e-300, -1e300]],
  ["逆の桁差", [-1e-300, 1e300, 0], [1e300, -1e-300]]
]) {
  test("発散型積み上げ: " + name, () => {
    const items = [{ id: "a", label: "A" }];
    const series = values.map((value, index) => ({ id: "s" + index, name: "系列" + index, color: ["#123456", "#abcdef", "#fedcba"][index], values: [value] }));
    const before = structuredClone(series);
    const layout = chartDivergingStacks(items, series);
    const group = layout.groups[0];
    assert.deepEqual([group.positive.total, group.negative.total], totals);
    assert.deepEqual([group.positive.overflow, group.negative.overflow], totals.map((value) => value === null));
    assert.deepEqual(group.entries.map((entry) => entry.series), before);
    assert.equal(Object.is(group.entries[0].value, -0), false);
    assert.deepEqual(series, before, "元データを変更しない");
    const visibleTotals = group.totals.map((total) => total.total);
    assert.deepEqual(visibleTotals, totals.every((value) => value === 0) ? [0] : totals.filter((value) => value !== 0));
    for (const total of group.totals) {
      assert.doesNotMatch(formatChartStackTotal(total), /NaN|Infinity/);
      assert.equal(formatChartStackTotal(total) === "上限超過", total.overflow);
    }
    const ticks = chartNumericTicks(layout.range);
    assert.equal(ticks.filter((tick) => tick.value === 0).length, 1);
    assert.equal(ticks.filter((tick) => tick.label === "0").length, 1);
    assert.ok(ticks.every((tick) => Number.isFinite(tick.value) && !/NaN|Infinity/.test(tick.label)));
    for (const horizontal of [false, true]) {
      const rendered = horizontal ? horizontalBarSegments(items, series, { mode: "stacked" }) : stackedBarSegments(items, series);
      const zero = chartValueRatio(0, layout.range);
      const previous = { positive: zero, negative: zero };
      for (const segment of rendered.segments) {
        assert.ok([segment.x, segment.y, segment.width, segment.height, segment.stackStart, segment.stackEnd].every(Number.isFinite));
        assert.ok(segment.width >= 0 && segment.height >= 0);
        const side = segment.value < 0 ? "negative" : "positive";
        assert.equal(segment.stackStart, previous[side], "正負の累計は独立");
        assert.ok(segment.value < 0 ? segment.stackEnd <= segment.stackStart : segment.stackEnd >= segment.stackStart);
        previous[side] = segment.stackEnd;
        if (segment.value === 0) assert.equal(horizontal ? segment.width : segment.height, 0);
      }
    }
    const chart = normalizeChartBlock({ items, series, appearance: { barMode: "stacked" } });
    assert.equal(chartValidationError(chart), "");
    assert.deepEqual(parseChartBlockLine(serializeChartBlock(chart)), chart);
  });
}

test("発散型は項目ごとの正負を共通軸で比較し正数の既存座標を保つ", () => {
  const items = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];
  const series = [{ values: [30, -60, 0] }, { values: [-10, 20, 0] }, { values: [20, -20, 0] }];
  const layout = chartDivergingStacks(items, series);
  assert.deepEqual(layout.groups.map((g) => [g.positive.total, g.negative.total]), [[50,-10],[20,-80],[0,0]]);
  assert.equal(layout.range.minimum * layout.scaleBase, -80);
  assert.ok(Math.abs(layout.range.maximum * layout.scaleBase - 50) < 1e-12);
  const positive = stackedBarSegments(items.slice(0,1), [{ values:[30] },{ values:[10] },{ values:[20] }], { top: 0, baseline: 120 });
  positive.segments.forEach((segment, index) => {
    assert.ok(Math.abs(segment.y - [60,40,0][index]) < 1e-12);
    assert.ok(Math.abs(segment.height - [60,20,40][index]) < 1e-12);
  });
  assert.deepEqual(layout.groups[0].totals.map((t) => t.labelPrefix), ["正側合計", "負側合計"]);
  assert.deepEqual(layout.groups[2].totals.map((t) => t.labelPrefix), ["合計"]);
});

for (const value of [NaN, Infinity, -Infinity, "-", "", "1e"]) {
  test("発散型は不正入力を拒否: " + String(value), () => {
    const items = [{ label: "A" }], series = [{ values: [value] }];
    assert.throws(() => chartDivergingStacks(items, series), /有限な数値/);
    assert.throws(() => stackedBarSegments(items, series), /有限な数値/);
    assert.throws(() => horizontalBarSegments(items, series, { mode: "stacked" }), /有限な数値/);
    assert.throws(() => serializeChartBlock({ items, series, appearance: { barMode: "stacked" } }), /有限な数値/);
  });
}

test("通常積み上げは形式を往復してもID・値・色・向き・保存契約を保持する", () => {
  for (const barOrientation of ["vertical", "horizontal"]) {
    const original = normalizeChartBlock({ ...signedChart(), appearance: { barMode: "stacked", barOrientation, showStackTotals: true } });
    for (const [chartType, barMode] of [["bar","grouped"],["line","stacked"],["bar","percent-stacked"],["pie","stacked"]]) {
      const switched = { ...original, chartType, appearance: { ...original.appearance, barMode } };
      if (chartType === "pie") assert.throws(() => serializeChartBlock(switched), /負数に未対応/);
      else assert.deepEqual(parseChartBlockLine(serializeChartBlock(switched)).series, original.series);
      const restored = { ...switched, chartType: "bar", appearance: original.appearance };
      assert.deepEqual(parseChartBlockLine(serializeChartBlock(restored)), original);
      assert.equal(original.schemaVersion, 1);
    }
  }
});

 test("発散型の最小正数の軸でも0と丸められた目盛りを重複表示しない", () => {
  const range = chartDivergingStacks([{ label: "A" }], [{ values: [Number.MIN_VALUE] }]).range;
  const ticks = chartNumericTicks(range);
  assert.equal(ticks.filter((tick) => tick.label === "0").length, 1);
  assert.equal(new Set(ticks.map((tick) => tick.label)).size, ticks.length);
  assert.equal(ticks.at(-1).label, "5e-324");
  assert.equal(ticks.at(-1).value, range.maximum, "同じ表示値では端の目盛りを残す");
});


for (const [name, values, expected, range] of [
  ["混在", [30, -10, 20], [60, -100, 40], [-100, 100]],
  ["正のみ", [30, 10, 20], [50, 100 / 6, 100 / 3], [0, 100]],
  ["負のみ", [-30, -10, -20], [-50, -100 / 6, -100 / 3], [-100, 0]],
  ["全0", [0, -0, 0], [0, 0, 0], [0, 100]],
  ["単一負数", [-0.25], [-100], [-100, 0]],
  ["巨大正側", [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE], [50, -100, 50], [-100, 100]],
  ["巨大負側", [-Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE], [-50, 100, -50], [-100, 100]],
  ["微小負側", [Number.MAX_VALUE, -Number.MIN_VALUE, 0], [100, -100, 0], [-100, 100]],
  ["微小正側", [-Number.MAX_VALUE, Number.MIN_VALUE, 0], [-100, 100, 0], [-100, 100]],
  ["同符号桁差", [-Number.MAX_VALUE, -Number.MIN_VALUE, 1], [-100, 0, 100], [-100, 100]],
  ["小数", [0.1, -0.3, 0.2], [100 / 3, -100, 200 / 3], [-100, 100]],
  ["最小値", [-Number.MIN_VALUE, -Number.MIN_VALUE], [-50, -50], [-100, 0]]
]) {
  test(`発散型100%: ${name}を縦横共通で正負別正規化する`, () => {
    const items = Object.freeze([Object.freeze({ id: "a", label: "項目A" })]);
    const series = Object.freeze(values.map((value, index) => Object.freeze({ id: `s${index}`, name: `系列${index}`, color: "#123456", values: Object.freeze([value]) })));
    const before = JSON.stringify(series);
    for (const horizontal of [false, true]) {
      const layout = (horizontal ? horizontalBarSegments : stackedBarSegments)(items, series, { mode: "percent-stacked" });
      assert.deepEqual([layout.range.minimum, layout.range.maximum], range);
      const zero = chartValueRatio(0, layout.range);
      const previous = { positive: zero, negative: zero };
      layout.segments.forEach((segment, index) => {
        const side = values[index] < 0 ? "negative" : "positive";
        assert.ok(Math.abs(segment.percentage - expected[index]) < 1e-12);
        assert.equal(Object.is(segment.percentage, -0), false);
        assert.equal(segment.stackStart, previous[side]);
        assert.ok(values[index] < 0 ? segment.stackEnd <= segment.stackStart : segment.stackEnd >= segment.stackStart);
        previous[side] = segment.stackEnd;
        assert.equal(segment.value, values[index] === 0 ? 0 : values[index]);
        assert.equal(segment.series, series[index]);
        assert.ok([segment.x, segment.y, segment.width, segment.height, segment.percentage].every(Number.isFinite));
        assert.ok(segment.width >= 0 && segment.height >= 0);
      });
      if (values.some((value) => value > 0)) assert.equal(previous.positive, 1, "正側の最終端は正確に+100%");
      if (values.some((value) => value < 0)) assert.equal(previous.negative, 0, "負側の最終端は正確に-100%");
    }
    assert.equal(JSON.stringify(series), before);
    const chart = normalizeChartBlock({ items, series, appearance: { barMode: "percent-stacked" } });
    assert.deepEqual(parseChartBlockLine(serializeChartBlock(chart)), chart, "割合や座標を保存せず元値・ID・順序を保持");
  });
}

test("発散型100%は別項目の正負も全体軸へ反映し、片側ごとの微小値を保持する", () => {
  const items = [{ label: "正だけ" }, { label: "負だけ" }, { label: "全0" }];
  const series = [{ values: [Number.MAX_VALUE, -Number.MIN_VALUE, 0] }, { values: [Number.MAX_VALUE, -Number.MIN_VALUE, 0] }];
  const layout = chartDivergingStacks(items, series, { percent: true });
  assert.deepEqual([layout.range.minimum, layout.range.maximum], [-100, 100]);
  assert.deepEqual(layout.groups.flatMap((group) => group.entries.map((entry) => entry.percentage)), [50, 50, -50, -50, 0, 0]);
  assert.ok(layout.groups[2].entries.every((entry) => entry.stackStart === 0.5 && entry.stackEnd === 0.5));
  assert.equal(layout.groups[0].positive.total, null);
  assert.equal(layout.groups[0].positive.overflow, true);
});

test("発散型100%でも非有限値・途中入力の確定を拒否し円の負数制限を保持する", () => {
  for (const invalid of [NaN, Infinity, -Infinity, "", "-", "1e", "1e-"]) {
    const chart = { items: [{ label: "A" }], series: [{ values: [invalid] }], appearance: { barMode: "percent-stacked" } };
    assert.match(chartValidationError(chart), /有限な数値/);
    assert.throws(() => serializeChartBlock(chart), /有限な数値/);
    assert.throws(() => stackedBarSegments(chart.items, chart.series, { mode: "percent-stacked" }), /有限な数値/);
    assert.throws(() => horizontalBarSegments(chart.items, chart.series, { mode: "percent-stacked" }), /有限な数値/);
  }
  const original = normalizeChartBlock({ ...signedChart(), appearance: { barMode: "percent-stacked" } });
  assert.throws(() => serializeChartBlock({ ...original, chartType: "pie" }), /負数に未対応/);
  for (const barMode of ["grouped", "stacked", "percent-stacked"]) {
    const restored = parseChartBlockLine(serializeChartBlock({ ...original, appearance: { ...original.appearance, barMode } }));
    assert.deepEqual(restored.series, original.series);
  }
});

function comboFixture(values = [[30, -20, 0], [10, 40, -10], [20, -30, 0]]) {
  return { id: "combo", chartType: "combo", title: "比較", unit: "万円",
    items: [{ id: "a", label: "項目A" }, { id: "b", label: "項目B" }, { id: "c", label: "項目C" }],
    series: values.map((values, index) => ({ id: "s" + index, name: "系列" + index, color: CHART_SERIES_COLORS[index], values })),
    appearance: { barMode: "stacked", barOrientation: "horizontal", showStackTotals: true } };
}

test("複合は初回だけ最後の正規化済みIDを選び、旧棒へ設定を追加しない", () => {
  const source = comboFixture();
  const normalized = normalizeChartBlock(source);
  assert.equal(normalized.chartType, "combo");
  assert.equal(normalized.appearance.comboLineSeriesId, "s2");
  assert.equal(normalizeChartBlock({ ...source, chartType: "bar" }).appearance.comboLineSeriesId, undefined);
  for (const invalid of [undefined, null, 1, "missing"]) {
    assert.equal(normalizeComboLineSeriesId(invalid, normalized.series), "s2");
  }
  const repaired = normalizeChartBlock({ ...source, series: [{ values: [1] }, { values: [2] }, { id: "combo-series-2", values: [3] }] });
  assert.equal(repaired.appearance.comboLineSeriesId, "combo-series-2-2");
  assert.equal(repaired.series.length, 3);
  assert.deepEqual(comboSeriesKinds(normalized).map(({ series, kind }) => [series.id, kind]), [["s0", "bar"], ["s1", "bar"], ["s2", "line"]]);
});

test("複合の安定IDは名前・色・項目系列の並べ替え・追加削除で保持する", () => {
  const original = normalizeChartBlock({ ...comboFixture(), appearance: { comboLineSeriesId: "s1" } });
  const renamed = normalizeChartBlock({ ...original, series: original.series.map((series) => ({ ...series, name: "同名", color: "#123456" })) });
  const moved = moveChartSeries(moveChartItem(renamed, 1, -1), 1, 1);
  assert.equal(moved.appearance.comboLineSeriesId, "s1");
  assert.equal(comboSeriesKinds(moved).find((entry) => entry.kind === "line").series.name, "同名");
  const deletedOther = normalizeChartBlock({ ...moved, series: moved.series.filter((s) => s.id !== "s0") });
  assert.equal(deletedOther.appearance.comboLineSeriesId, "s1");
  assert.equal(normalizeChartBlock({ ...deletedOther, series: [...deletedOther.series, original.series[0]] }).appearance.comboLineSeriesId, "s1");
  const deletedSelected = normalizeChartBlock({ ...moved, series: moved.series.filter((s) => s.id !== "s1") });
  assert.equal(deletedSelected.appearance.comboLineSeriesId, "s2");
  assert.equal(chartValidationError(deletedSelected), "");
  assert.equal(original.series[1].name, "系列1");
});

test("複合の1系列と欠損系列は日本語で保存を拒否し値を失わない", () => {
  for (const series of [undefined, [], [comboFixture().series[0]]]) {
    const source = { ...comboFixture(), series };
    const before = structuredClone(source);
    assert.match(chartValidationError(source), /2系列以上/);
    assert.throws(() => serializeChartBlock(source), /2系列以上/);
    assert.deepEqual(source, before);
  }
});

for (const [name, values] of [
  ["正のみ", [[30, 10, 0], [10, 20, 5]]], ["負のみ", [[-30, -10, 0], [-10, -20, -5]]],
  ["混在", [[30, -20, 0], [-10, 20, 0], [30, -20, 0]]], ["全0", [[0, 0, 0], [-0, 0, 0]]],
  ["巨大有限", [[Number.MAX_VALUE, -Number.MAX_VALUE, 0], [-Number.MAX_VALUE, Number.MAX_VALUE, 0]]],
  ["桁差", [[1e300, -1e-300, 0], [1e-300, -1e300, Number.MIN_VALUE]]],
  ["極小", [[Number.MIN_VALUE, -Number.MIN_VALUE, 0], [-Number.MIN_VALUE, Number.MIN_VALUE, 0]]]
]) test("複合の共通軸とカテゴリ中央・有限座標: " + name, () => {
  const source = comboFixture(values);
  const before = structuredClone(source);
  const freeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(source);
  const options = { width: 600, left: 80, right: 20, top: 54, baseline: 196 };
  const result = comboChartLayout(source, options);
  assert.deepEqual(result.range, { minimum: Math.min(0, ...values.flat()) || 0, maximum: Math.max(0, ...values.flat()) || 0 });
  const scale = Math.max(...values.flat().map(Math.abs));
  const low = scale ? result.range.minimum / scale : 0;
  const high = scale ? result.range.maximum / scale : 0;
  const expectedY = (value) => scale ? 196 - (value / scale - low) / (high - low) * 142 : 196;
  const zero = expectedY(0);
  result.groups.forEach((group, index) => {
    assert.ok(Math.abs(group.center - (80 + (index + 0.5) * 500 / 3)) < 1e-10);
    assert.ok(Math.abs(result.points[index].x - group.center) < 1e-10);
    assert.ok(Math.abs(result.points[index].y - expectedY(values.at(-1)[index])) < 1e-10);
    group.segments.forEach((segment) => {
      assert.ok([segment.x, segment.y, segment.width, segment.height, segment.tip, segment.zero].every(Number.isFinite));
      assert.ok(segment.width >= 0 && segment.height >= 0);
      assert.ok(Math.abs(segment.zero - zero) < 1e-10);
      assert.ok(Math.abs(segment.tip - expectedY(segment.value)) < 1e-10);
      assert.ok(segment.value < 0 ? segment.tip >= zero : segment.tip <= zero);
    });
  });
  assert.deepEqual(source, before);
  const parsed = parseChartBlockLine(serializeChartBlock(source));
  assert.equal(Object.is(parsed.series.at(-1).values[0], -0), false);
  assert.equal(parsed.appearance.barMode, "stacked");
  assert.equal(parsed.appearance.barOrientation, "horizontal");
  assert.equal(shouldShowStackTotals(parsed), false);
});

test("集合棒の共通化は既存の棒幅・間隔・0基準を保つ", () => {
  for (const count of [1, 2, 3]) for (const width of [420, 600, 1100]) {
    const source = comboFixture().series.slice(0, count);
    const layout = groupedBarLayout(comboFixture().items, source, { width });
    const groupWidth = (width - 52 - 18) / 3;
    const barWidth = Math.max(4, Math.min(48, (Math.max(12, groupWidth - 20) - 4 * (count - 1)) / count));
    layout.groups.forEach((group, itemIndex) => group.segments.forEach((bar, seriesIndex) => {
      const x = 52 + itemIndex * groupWidth + (groupWidth - (barWidth * count + 4 * (count - 1))) / 2 + seriesIndex * (barWidth + 4);
      assert.ok(Math.abs(bar.x - x) < 1e-10);
      assert.equal(bar.width, barWidth);
    }));
  }
});

test("複合は空項目を除き単一項目でもカテゴリ中央へ点を配置する", () => {
  const source = comboFixture();
  source.items = [{ id: "a", label: "" }, { id: "b", label: "表示" }, { id: "c", label: "" }];
  const layout = comboChartLayout(source);
  assert.equal(layout.points.length, 1);
  assert.equal(layout.points[0].x, (52 + 420 - 18) / 2);
  assert.equal(layout.points[0].value, -30);
  assert.deepEqual(comboChartLayout({ ...source, items: [] }).points, []);
});

for (const invalid of [NaN, Infinity, -Infinity, "", "-", "1e"]) test("複合は不正入力を確定しない: " + invalid, () => {
  const source = comboFixture();
  source.series[1].values[0] = invalid;
  assert.match(chartValidationError(source), /有限/);
  assert.throws(() => serializeChartBlock(source), /有限/);
});

test("複合の種類往復は選択・旧棒設定・ID・値を維持し描画座標を保存しない", () => {
  const source = normalizeChartBlock(comboFixture([[30, 20, 0], [10, 30, 0], [20, 10, 0]]));
  let current = source;
  for (const chartType of ["bar", "combo", "line", "combo", "pie", "combo"]) {
    current = parseChartBlockLine(serializeChartBlock({ ...current, chartType }));
    assert.deepEqual(current.items, source.items);
    assert.deepEqual(current.series, source.series);
    assert.deepEqual(current.appearance, source.appearance);
    assert.equal(current.schemaVersion, 1);
    assert.equal(Object.hasOwn(current, "points"), false);
    assert.equal(Object.hasOwn(current, "range"), false);
  }
  assert.match(chartValidationError({ ...comboFixture(), chartType: "pie" }), /負数/);
});

test("旧本文と不正な複合IDは読み込みだけでは変更せず表示用フォールバックを使う", () => {
  for (const source of [{ id: "legacy", items: [{ label: "旧", value: -1 }] }, { ...comboFixture(), appearance: { comboLineSeriesId: "deleted" } }]) {
    const raw = "<!-- memo-nexus:chart-block:" + Buffer.from(JSON.stringify(source)).toString("hex") + " -->";
    const block = splitChartBlocks(raw)[0];
    assert.equal(block.raw, raw);
    if (source.chartType === "combo") {
      assert.equal(block.chart.appearance.comboLineSeriesId, "s2");
      assert.equal(comboChartLayout(block.chart).lineSeries.id, "s2");
    }
    assert.equal(block.raw, raw);
  }
});

test("複合の値ラベルは衝突・幅不足時に省略を選べる", () => {
  const options = { x: 60, tip: 60, left: 0, right: 100, top: 24, bottom: 100, occupied: [{ x: 0, y: 0, width: 100, height: 100 }], hideOnCollision: true };
  assert.equal(chartValueLabelLayout(30, options), null);
  assert.equal(chartValueLabelLayout(30, { ...options, occupied: [], right: 1 }), null);
  assert.ok(chartValueLabelLayout(30, { ...options, hideOnCollision: false }));
});


for (const mode of [undefined, null, "", "other", 1, {}, "single"]) test("二軸の欠損・不正モードは単一軸: " + JSON.stringify(mode), () => {
  const source = comboFixture();
  source.appearance.comboAxisMode = mode;
  const raw = "<!-- memo-nexus:chart-block:" + Buffer.from(JSON.stringify(source)).toString("hex") + " -->";
  const block = splitChartBlocks(raw)[0];
  assert.equal(block.chart.appearance.comboAxisMode, "single");
  assert.equal(block.chart.appearance.comboSecondaryUnit, "");
  assert.equal(block.raw, raw);
  assert.equal(comboAxisRanges(block.chart).mode, "single");
});

test("二軸設定・安全な単位は保存、種類往復、系列と項目の移動・削除で保持する", () => {
  let chart = normalizeChartBlock({ ...comboFixture([[30, 20, 0], [10, 40, 0], [20, 30, 0]]),
    appearance: { comboAxisMode: "dual", comboLineSeriesId: "s1", comboSecondaryUnit: "  人\r\n<script>単位</script>  " } });
  const original = structuredClone(chart);
  assert.equal(chart.appearance.comboSecondaryUnit, "人\n<script>単位</script>");
  for (const chartType of ["bar", "line", "pie", "combo"]) {
    chart = parseChartBlockLine(serializeChartBlock({ ...chart, chartType }));
    assert.deepEqual(chart.appearance, original.appearance);
    assert.deepEqual(chart.series, original.series);
    assert.equal(chart.unit, original.unit);
    assert.equal(chart.schemaVersion, 1);
    assert.equal(Object.hasOwn(chart, "leftRange"), false);
    assert.equal(Object.hasOwn(chart, "zeroRatio"), false);
  }
  for (const comboAxisMode of ["single", "dual"]) {
    chart = parseChartBlockLine(serializeChartBlock({ ...chart, appearance: { ...chart.appearance, comboAxisMode } }));
    assert.equal(chart.appearance.comboSecondaryUnit, original.appearance.comboSecondaryUnit);
    assert.deepEqual(chart.series, original.series);
    assert.equal(chart.appearance.comboLineSeriesId, "s1");
  }
  chart = moveChartSeries(moveChartItem(chart, 0, 1), 1, 1);
  chart = normalizeChartBlock({ ...chart, series: chart.series.map((series) => ({ ...series, name: "同名" })) });
  assert.equal(chart.appearance.comboLineSeriesId, "s1");
  assert.equal(comboChartLayout(chart).lineSeries.id, "s1");
  chart = normalizeChartBlock({ ...chart, series: chart.series.filter((s) => s.id !== "s1") });
  assert.equal(chart.appearance.comboLineSeriesId, "s2");
  assert.equal(chart.appearance.comboAxisMode, "dual");
  assert.equal(chart.appearance.comboSecondaryUnit, original.appearance.comboSecondaryUnit);
});

const dualCases = [
  ["左右正数", [[30, 20, 0], [1000, 2000, 0]], 0],
  ["左右負数", [[-30, -20, 0], [-1000, -2000, 0]], 1],
  ["左右混在", [[30, -20, 0], [-1000, 2000, 0]], 0.5],
  ["正と負の片側拡張", [[30, 20, 0], [-1000, -2000, 0]], 0.5],
  ["片側混在", [[30, 20, 0], [-1000, 2000, 0]], 0.5],
  ["棒全0", [[0, 0, 0], [-1000, 2000, 0]], 0.5],
  ["折れ線全0", [[-30, -20, 0], [0, 0, 0]], 1],
  ["全0", [[0, 0, 0], [-0, 0, 0]], 0],
  ["小数", [[0.3, -0.2, -0], [-1.2, 2.4, 0]], 0.5],
  ["最小有限", [[Number.MIN_VALUE, -Number.MIN_VALUE, 0], [-Number.MIN_VALUE, Number.MIN_VALUE, 0]], 0.5],
  ["最大有限", [[Number.MAX_VALUE, -Number.MAX_VALUE, 0], [-Number.MAX_VALUE, Number.MAX_VALUE, 0]], 0.5],
  ["軸間の桁差", [[Number.MAX_VALUE, -Number.MAX_VALUE, 0], [-Number.MIN_VALUE, Number.MIN_VALUE, 0]], 0.5],
  ["軸内の桁差", [[Number.MAX_VALUE, -Number.MIN_VALUE, 0], [-Number.MAX_VALUE, Number.MIN_VALUE, 0]], 0.5],
  ["3系列", [[30, -20, 0], [-100, 40, 0], [0.002, -0.001, 0]], 0.5]
];
for (const [name, values, zeroRatio] of dualCases) test("二軸の独立範囲・共通0・有限座標・凍結入力: " + name, () => {
  const source = { ...comboFixture(values), appearance: { comboAxisMode: "dual", comboSecondaryUnit: "人" } };
  const before = structuredClone(source);
  const freeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(source);
  const layout = comboChartLayout(source, { width: 500, left: 90, right: 90, top: 54, baseline: 196 });
  assert.equal(layout.mode, "dual");
  assert.equal(layout.zeroRatio, zeroRatio);
  assert.equal(layout.zero, 196 - 142 * zeroRatio);
  for (const [range, data] of [[layout.leftRange, values.slice(0, -1).flat()], [layout.rightRange, values.at(-1)]]) {
    assert.ok(Number.isFinite(range.minimum) && Number.isFinite(range.maximum));
    assert.ok(range.minimum <= 0 && range.maximum >= 0);
    assert.ok(data.every((v) => range.minimum <= v && v <= range.maximum), "切り捨てなし");
    assert.equal(chartValueRatio(0, range), zeroRatio);
    const axis = comboValueAxisLayout(range);
    assert.ok(Number.isFinite(axis.margin));
    assert.ok(axis.ticks.every((t) => Number.isFinite(t.value) && Number.isFinite(chartValueRatio(t.value, range))));
    assert.ok(axis.ticks.every((t) => t.fullLabel === String(t.value)));
    assert.equal(axis.ticks.filter((t) => t.value === 0).length, 1);
  }
  // Independent oracle: each axis uses its own magnitude, without the other
  // axis influencing its numeric scale. No subtraction of raw extreme values.
  const expectedY = (v, data) => {
    const magnitude = Math.max(...data.map(Math.abs)) || 1;
    return 196 - (zeroRatio + (v / magnitude) * (zeroRatio === 0.5 ? 0.5 : 1)) * 142;
  };
  layout.segments.forEach((s) => {
    assert.equal(s.zero, layout.zero);
    assert.ok(Math.abs(s.tip - expectedY(s.value, values.slice(0, -1).flat())) < 1e-10);
    assert.ok([s.x, s.y, s.width, s.height].every(Number.isFinite));
    assert.ok(s.width >= 0 && s.height >= 0);
  });
  layout.points.forEach((p, i) => {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(Math.abs(p.y - expectedY(p.value, values.at(-1))) < 1e-10);
    assert.ok(Math.abs(p.x - layout.groups[i].center) < 1e-10);
    if (i) assert.ok(Number.isFinite(p.y - layout.points[i - 1].y));
  });
  assert.deepEqual(source, before);
  const loaded = parseChartBlockLine(serializeChartBlock(source));
  assert.deepEqual(loaded.series.map((s) => s.values), values.map((vs) => vs.map((v) => v === 0 ? 0 : v)));
  assert.equal(loaded.appearance.comboAxisMode, "dual");
});

test("二軸の往復後も単一軸の座標・軸ラベルは従来と一致する", () => {
  for (const [, values] of dualCases) {
    const original = comboFixture(values);
    const before = comboChartLayout(original);
    const dual = normalizeChartBlock({ ...original, appearance: { comboAxisMode: "dual", comboSecondaryUnit: "人" } });
    const single = comboChartLayout({ ...dual, appearance: { ...dual.appearance, comboAxisMode: "single" } });
    assert.deepEqual(single, before);
    assert.deepEqual(chartNumericTicks(single.range), chartNumericTicks(before.range));
  }
});


test("軸タイトルのない旧マーカーへ任意フィールドを追加しない", () => {
  for (const chartType of ["bar", "line", "pie", "combo"]) {
    const source = { ...comboFixture([[1, 2], [3, 4]]), chartType };
    const raw = "<!-- memo-nexus:chart-block:" + Buffer.from(JSON.stringify(source)).toString("hex") + " -->";
    const block = charts(raw)[0];
    assert.equal(block.raw, raw);
    assert.equal(Object.hasOwn(block.chart.appearance, "leftAxisTitle"), false);
    assert.equal(Object.hasOwn(block.chart.appearance, "rightAxisTitle"), false);
    assert.equal(formatChartAxisTitle(block.chart.appearance.leftAxisTitle, block.chart.unit), block.chart.unit);
  }
});

for (const [title, unit, expected] of [
  ["売上", "万円", "売上（万円）"], ["成長率", "%", "成長率（%）"],
  [" 売上 ", "", "売上"], ["", " 万円 ", "万円"], ["", "", ""],
  [undefined, null, ""], ["  ", " ", ""]
]) test("軸タイトル表示: " + JSON.stringify([title, unit]), () => {
  assert.equal(formatChartAxisTitle(title, unit), expected);
});

function axisTitleFixture() {
  return normalizeChartBlock({ ...comboFixture([[0, -12.5, Number.MAX_VALUE], [0, 0.3, 12]]), unit: "万円",
    appearance: { comboAxisMode: "dual", leftAxisTitle: "  売上\r\n合計  ", rightAxisTitle: "  成長率<script>  ", comboSecondaryUnit: " % " } });
}

test("左右軸の任意タイトルを安全な文字列へ正規化し元値とともに保存復元する", () => {
  const chart = axisTitleFixture();
  assert.equal(chart.appearance.leftAxisTitle, "売上\n合計");
  assert.equal(chart.appearance.rightAxisTitle, "成長率<script>");
  assert.equal(chart.appearance.comboSecondaryUnit, "%");
  assert.deepEqual(parseChartBlockLine(serializeChartBlock(chart)), chart);
  assert.equal(chart.schemaVersion, 1);
  assert.ok(chart.series.every((s) => s.values.every((value) => typeof value === "number")));
  const empty = normalizeChartBlock({ ...chart, appearance: { leftAxisTitle: null, rightAxisTitle: undefined } });
  assert.equal(empty.appearance.leftAxisTitle, ""); assert.equal(empty.appearance.rightAxisTitle, "");
});

test("二軸の解除・種類往復・系列順変更でも左右タイトルと単位を保持する", () => {
  const original = axisTitleFixture();
  let chart = original;
  for (const chartType of ["bar", "line", "combo"]) for (const comboAxisMode of ["single", "dual"]) {
    chart = parseChartBlockLine(serializeChartBlock({ ...chart, chartType, appearance: { ...chart.appearance, comboAxisMode } }));
    assert.equal(chart.appearance.leftAxisTitle, original.appearance.leftAxisTitle);
    assert.equal(chart.appearance.rightAxisTitle, original.appearance.rightAxisTitle);
    assert.equal(chart.appearance.comboSecondaryUnit, "%"); assert.equal(chart.unit, "万円");
    assert.deepEqual(chart.series, original.series);
  }
  chart = moveChartSeries(chart, 1, -1);
  assert.equal(chartSeriesUnit(chart, chart.series[0]), "%");
  assert.equal(chartSeriesUnit(chart, chart.series[1]), "万円");
  const pie = parseChartBlockLine(serializeChartBlock({ ...chart, chartType: "pie", series: chart.series.map((s) => ({ ...s, values: [0, 1, 2] })) }));
  assert.equal(pie.appearance.rightAxisTitle, original.appearance.rightAxisTitle);
  assert.equal(chartSeriesUnit(pie, pie.series[0]), "万円");
});

test("系列の単位は二軸の安定ID選択を参照し、空単位と単一軸へ安全に戻る", () => {
  const chart = axisTitleFixture(), [bar, line] = chart.series;
  assert.equal(chartSeriesUnit(chart, bar), "万円"); assert.equal(chartSeriesUnit(chart, line), "%");
  const swapped = { ...chart, appearance: { ...chart.appearance, comboLineSeriesId: bar.id } };
  assert.equal(chartSeriesUnit(swapped, bar), "%"); assert.equal(chartSeriesUnit(swapped, line), "万円");
  assert.equal(chartSeriesUnit({ ...chart, appearance: { ...chart.appearance, comboAxisMode: "single" } }, line), "万円");
  assert.equal(chartSeriesUnit({ ...chart, appearance: { ...chart.appearance, comboSecondaryUnit: "" } }, line), "");
  assert.equal(chartSeriesUnit({ ...chart, appearance: { ...chart.appearance, comboLineSeriesId: "deleted" } }, line), "%");
});

test("軸タイトルは座標・軸範囲・目盛り計算を変えない", () => {
  const chart = axisTitleFixture();
  const old = { ...chart, appearance: { comboAxisMode: "dual", comboSecondaryUnit: "%" } };
  assert.deepEqual(comboChartLayout(chart), comboChartLayout(old));
});

test("左右タイトルと単位はMarkdown・ZIP用bundle・ローカル保存の入出力経路で保持する", () => {
  const { buildMemoExportBundle } = require("./attachment-utils.js");
  const { buildMarkdownBundleImport } = require("./markdown-bundle-utils.js");
  const { serializeNoteForMarkdown, parseFlaggedMarkdown } = require("./note-flag-utils.js");
  const { serializeLocalNote, parseLocalNote } = require("./local-markdown.js");
  const chart = axisTitleFixture(), body = "前\n" + serializeChartBlock(chart) + "\n後";
  const note = { id: "axis-export", title: "軸設定", body, tags: [], isFlagged: true };
  const markdown = serializeNoteForMarkdown(note, body);
  assert.equal(parseFlaggedMarkdown(markdown).body, body);
  const bundle = buildMemoExportBundle({ markdownPath: "軸設定.md", markdownContent: markdown, attachments: [] });
  const [plan] = buildMarkdownBundleImport(bundle.files.map((file) => ({ name: file.name, data: new TextEncoder().encode(file.content) })));
  assert.equal(parseFlaggedMarkdown(plan.body).body, body);
  const local = parseLocalNote(serializeLocalNote(note, body));
  assert.equal(local.body, body);
  assert.deepEqual(charts(plan.body)[0].chart, chart);
  assert.deepEqual(charts(local.body)[0].chart, chart);
});
