"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { chartDataTable, normalizeChartBlock, serializeChartBlock, parseChartBlockLine,
  moveChartItem, moveChartSeries, parseChartTsv, replaceChartTable } = require("./chart-block-utils.js");

function fixture(count = 2, seriesCount = 3) {
  return normalizeChartBlock({ id: "table", title: "売上", unit: "万円",
    items: Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, label: "同名" })),
    series: Array.from({ length: seriesCount }, (_, i) => ({ id: `series-${i}`, name: "同名", values: Array.from({ length: count }, (_, j) => i * 100 + j) })),
    appearance: { showDataTable: true } });
}

for (const value of [undefined, false, true, "true", 1, null]) {
  test(`表設定は厳密boolean・未指定falseで保存復元: ${value}`, () => {
    const input = fixture(); input.appearance.showDataTable = value;
    const restored = parseChartBlockLine(serializeChartBlock(input));
    assert.equal(restored.appearance.showDataTable, value === true);
    assert.equal(restored.schemaVersion, 1);
    assert.deepEqual(restored.items, input.items); assert.deepEqual(restored.series, input.series);
    assert.equal(Object.hasOwn(restored, "rows"), false);
  });
}
test("旧マーカーは読むだけでは変更しない", () => {
  const old = { id: "old", items: [{ id: "a", label: "昔", value: 1 }] };
  const raw = `<!-- memo-nexus:chart-block:${Buffer.from(JSON.stringify(old)).toString("hex")} -->`;
  assert.equal(parseChartBlockLine(raw).appearance.showDataTable, false);
  assert.deepEqual(JSON.parse(Buffer.from(raw.split(":").at(-1).split(" ")[0], "hex").toString()), old);
});
for (const [items, series] of [[1,1], [50,3]]) test(`${items}項目・${series}系列・同名も独立・非破壊`, () => {
  const input = fixture(items,series), before = structuredClone(input);
  input.items.forEach(Object.freeze); input.series.forEach(s=>{Object.freeze(s.values);Object.freeze(s);});
  Object.freeze(input.items); Object.freeze(input.series); Object.freeze(input);
  const table = chartDataTable(input);
  assert.equal(table.rows.length,items); assert.equal(table.columns.length,series);
  assert.equal(new Set(table.rows.map(r=>r.id)).size,items);
  table.rows.forEach((r,i)=>assert.deepEqual(r.values,input.series.map(s=>String(s.values[i]))));
  assert.deepEqual(input,before);
});
test("順序変更・削除はIDと値を対応させる", () => {
  const moved = moveChartSeries(moveChartItem(fixture(),0,1),0,1);
  const table = chartDataTable(moved);
  assert.deepEqual(table.rows.map(r=>r.id),["item-1","item-0"]);
  assert.deepEqual(table.columns.map(c=>c.id),["series-1","series-0","series-2"]);
  assert.deepEqual(table.rows[0].values,["101","1","201"]);
  moved.items.pop(); moved.series.pop(); moved.series.forEach(s=>s.values.pop());
  assert.equal(chartDataTable(moved).rows.length,1); assert.equal(chartDataTable(moved).columns.length,2);
});
for (const value of [0,-0,1.23,-3.25,1e30,1e-30,Number.MIN_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE]) test(`元値を丸めず往復: ${value}`,()=>{
  const input=fixture(1,1);input.series[0].values=[value];
  const text=chartDataTable(input).rows[0].values[0];
  assert.equal(Number(text),value===0?0:value);assert.equal(text,String(value===0?0:value));
});
for(const value of [NaN,Infinity,-Infinity,"", "-"]) test(`無効draftは表を生成しない: ${value}`,()=>{
  const input=fixture();input.series[0].values[0]=value;
  assert.equal(chartDataTable(input),null);
});
for(const mode of ["grouped","stacked","percent-stacked"]) test(`${mode}は座標・割合・合計でなく元値`,()=>{
  const input=fixture(1); input.appearance.barMode=mode;
  input.series.forEach((s,i)=>s.values=[i===0?30:i===1?-10:20]);
  const table=chartDataTable(input);assert.deepEqual(table.rows[0].values,["30","-10","20"]);
  assert.match(table.caption,/元の入力値/);
});
test("円は選択IDの系列のみ・0項目保持・切替追従・負数検証",()=>{
  const input=fixture();input.chartType="pie";input.appearance.pieSeriesId="series-1";
  input.series[1].values=[0,3];
  assert.deepEqual(chartDataTable(input).rows.map(r=>r.values),[["0"],["3"]]);
  assert.deepEqual(chartDataTable(input).columns.map(c=>c.id),["series-1"]);
  input.appearance.pieSeriesId="series-2";
  assert.deepEqual(chartDataTable(input).columns.map(c=>c.id),["series-2"]);
  input.series[0].values[0]=-1;assert.equal(chartDataTable(input),null);
});
for(const mode of ["single","dual"]) test(`複合${mode}は全系列・種類・軸・単位と選択変更に追従`,()=>{
  const input=fixture();input.chartType="combo";
  Object.assign(input.appearance,{comboAxisMode:mode,comboLineSeriesId:"series-1",comboSecondaryUnit:"%"});
  const columns=chartDataTable(input).columns;
  assert.equal(columns.length,3);assert.deepEqual(columns.map(c=>c.kind),["棒","折れ線","棒"]);
  assert.deepEqual(columns.map(c=>c.axis),["左軸",mode==="dual"?"右軸":"左軸","左軸"]);
  assert.deepEqual(columns.map(c=>c.unit),["万円",mode==="dual"?"%":"万円","万円"]);
  input.appearance.comboLineSeriesId="series-0";
  assert.equal(chartDataTable(input).columns[0].kind,"折れ線");
});
test("TSV置換から導出し、元snapshotを保持する",()=>{
  const input=fixture(),before=structuredClone(input);
  const parsed=parseChartTsv("項目\tA\tB\n新項目\t1.23\t-5");
  const next=replaceChartTable(input,parsed.table,{items:[],series:[]});
  assert.deepEqual(chartDataTable(next).rows.map(r=>[r.label,...r.values]),[["新項目","1.23","-5"]]);
  assert.deepEqual(input,before);assert.equal(next.appearance.showDataTable,true);
  assert.deepEqual(chartDataTable(input),chartDataTable(before));
});
