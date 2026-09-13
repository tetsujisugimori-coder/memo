"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CHART_BLOCK_VERSION,
  CHART_SERIES_COLORS,
  DEFAULT_CHART_COLOR,
  DEFAULT_CHART_SERIES_NAME,
  PIE_CHART_COLORS,
  chartBlockPlainText,
  chartDisplaySeries,
  chartValueMaximum,
  createChartBlock,
  insertChartBlock,
  lineChartPoints,
  lineChartWidth,
  moveChartItem,
  normalizeChartBlock,
  parseChartBlockLine,
  pieChartSegments,
  replaceChartBlock,
  serializeChartBlock,
  stackedBarSegments,
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
  assert.deepEqual(chart.items, [{ id: "chart-1-item-1", label: "" }]);
  assert.deepEqual(chart.series, [{ id: "chart-1-series-1", name: DEFAULT_CHART_SERIES_NAME, color: DEFAULT_CHART_COLOR, values: [0] }]);
  assert.deepEqual(chart.appearance, { color: DEFAULT_CHART_COLOR, barMode: "grouped", showValues: true, showPoints: true, showLegend: false, pieLabelMode: "percentage" });
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
  assert.deepEqual(chart.series[0].values, [0, 0, 0]);
  assert.deepEqual(chart.appearance, { color: DEFAULT_CHART_COLOR, barMode: "grouped", showValues: false, showPoints: true, showLegend: true, pieLabelMode: "percentage" });
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

test("棒の表示方法は既定の集合へ正規化し、種類切替後も積み上げ設定を保持する", () => {
  const legacy = normalizeChartBlock({ id: "legacy", chartType: "bar", items: [{ label: "1月", value: 1 }] });
  const stacked = normalizeChartBlock({ ...legacy, appearance: { ...legacy.appearance, barMode: "stacked" } });
  const percentStacked = normalizeChartBlock({ ...legacy, appearance: { ...legacy.appearance, barMode: "percent-stacked" } });
  const invalid = normalizeChartBlock({ ...legacy, appearance: { ...legacy.appearance, barMode: "percent" } });
  assert.equal(legacy.appearance.barMode, "grouped");
  assert.equal(stacked.appearance.barMode, "stacked");
  assert.equal(percentStacked.appearance.barMode, "percent-stacked");
  assert.equal(invalid.appearance.barMode, "grouped");
  assert.equal(normalizeChartBlock({ ...stacked, chartType: "line" }).appearance.barMode, "stacked");
  assert.equal(normalizeChartBlock({ ...stacked, chartType: "pie" }).appearance.barMode, "stacked");
  assert.equal(parseChartBlockLine(serializeChartBlock(stacked)).appearance.barMode, "stacked");
  assert.equal(normalizeChartBlock({ ...percentStacked, chartType: "line" }).appearance.barMode, "percent-stacked");
  assert.equal(normalizeChartBlock({ ...percentStacked, chartType: "pie" }).appearance.barMode, "percent-stacked");
  assert.equal(parseChartBlockLine(serializeChartBlock(percentStacked)).appearance.barMode, "percent-stacked");
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
