"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { chartToTsv, parseChartTsv, normalizeChartBlock, moveChartItem, moveChartSeries, parseChartBlockLine } = require("./chart-block-utils.js");
const chart = (values = [100, 120]) => normalizeChartBlock({ id: "copy", title: "非出力", unit: "%",
  items: values.map((_, index) => ({ id: "i" + index, label: (index + 1) + "月" })),
  series: [{ id: "s", name: "売上", values }, { id: "t", name: "利益", values: values.map(() => 20) }],
  appearance: { showDataTable: false } });
function roundTrip(source) {
  const before = structuredClone(source);
  const result = parseChartTsv(chartToTsv(source));
  assert.equal(result.ok, true);
  assert.deepEqual(result.table.items.map(i => i.label), source.items.map(i => i.label));
  assert.deepEqual(result.table.series, source.series.map(s => ({ name: s.name, values: s.values.map(v => Number(v) === 0 ? 0 : Number(v)) })));
  assert.deepEqual(source, before);
}
test("one item / one series and exact LF TSV without metadata", () => {
  const source = chart([1]); source.series.pop();
  assert.equal(chartToTsv(source), "項目\t売上\n1月\t1"); roundTrip(source);
});
test("multiple rows/columns, order, deletion and reordering", () => {
  const source = moveChartSeries(moveChartItem(chart(), 0, 1), 0, 1);
  assert.equal(chartToTsv(source), "項目\t利益\t売上\n2月\t20\t120\n1月\t20\t100"); roundTrip(source);
  source.items.pop(); source.series.pop(); source.series[0].values.pop();
  assert.equal(chartToTsv(source), "項目\t利益\n2月\t20");
});
test("50 items / 3 series, duplicate names and long Japanese/alphanumeric names", () => {
  const source = chart(Array.from({length:50},(_,i)=>i));
  source.items.forEach((item,i)=>item.label=i<2?"同名":i%2?"日本語".repeat(100):"abc123".repeat(100));
  source.series.push({...source.series[1],id:"third"}); roundTrip(source);
  assert.equal(chartToTsv(source).split("\n").length,51);
});
for (const value of [1, -1, 0, -0, 1.2345678901234567, 1e-100, 1e100, Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE]) {
  test("finite number round trip: " + String(value), () => { const source = chart([value]); source.series[0].values[0] = value; roundTrip(source); });
}
for (const config of [
  ...["vertical","horizontal"].flatMap(barOrientation => ["grouped","stacked","percent-stacked"].map(barMode => ({chartType:"bar",barOrientation,barMode}))),
  {chartType:"line"}, {chartType:"pie",pieSeriesId:"t"}, {chartType:"combo",comboAxisMode:"single",comboLineSeriesId:"t"}, {chartType:"combo",comboAxisMode:"dual",comboLineSeriesId:"s"}
]) test("all original series: " + JSON.stringify(config), () => {
  const source=chart();source.chartType=config.chartType;Object.assign(source.appearance,config);
  assert.equal(chartToTsv(source),"項目\t売上\t利益\n1月\t100\t20\n2月\t120\t20");roundTrip(source);
});
for (const kind of ["item","series"]) for(const control of ["\t","\r","\n"]) for(const position of ["start","middle","end"]) {
  test(kind+" rejects "+JSON.stringify(control)+" at "+position,()=>{
    const source=chart();const name=position==="start"?control+"名前":position==="end"?"名前"+control:"前"+control+"後";
    if(kind==="item")source.items[0].label=name;else source.series[0].name=name;
    const before=structuredClone(source);assert.throws(()=>chartToTsv(source),kind==="item"?/項目1.*タブまたは改行/s:/系列1.*タブまたは改行/s);assert.deepEqual(source,before);
  });
}
for(const value of [NaN,Infinity,-Infinity,"Infinity","NaN","",null,undefined]) test("reject invalid number: "+String(value),()=>{
  const source=chart();source.series[0].values[0]=value;const before=structuredClone(source);
  assert.throws(()=>chartToTsv(source),/項目1.*系列1.*有限/);assert.deepEqual(source,before);
});
test("missing values and blank names fail instead of lossy normalization",()=>{
  const source=chart();source.series[0].values=[];assert.throws(()=>chartToTsv(source),/有限/);
  source.series[0].values=[1,2];source.items[0].label="";assert.throws(()=>chartToTsv(source),/項目1.*空欄/);
  source.items[0].label="有効";source.series[0].name=" ";assert.throws(()=>chartToTsv(source),/系列1.*空欄/);
});
test("HTML-like names remain literal; quoted names need no CSV escaping",()=>{
  const source=chart([1]);source.items[0].label='<img src=x onerror=alert(1)>';source.series[0].name='"名前"';roundTrip(source);
});
test("frozen inputs including arrays remain unchanged",()=>{
  const source=chart();function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}}freeze(source);roundTrip(source);
});
test("legacy source and raw marker validation do not alter existing load behavior",()=>{
  const legacy={items:[{id:"old",label:"旧項目",value:3}]};assert.equal(chartToTsv(legacy),"項目\t系列 1\n旧項目\t3");
  const corrupt={items:[{label:"名\t前"}],series:[{name:"値",values:["Infinity"]}]};
  const marker='<!-- memo-nexus:chart-block:'+Buffer.from(JSON.stringify(corrupt)).toString('hex')+' -->';
  assert.equal(parseChartBlockLine(marker).series[0].values[0],0);
  assert.throws(()=>chartToTsv(parseChartBlockLine(marker,{normalize:false})),/タブ/);
  corrupt.items[0].label='名前';const raw='<!-- memo-nexus:chart-block:'+Buffer.from(JSON.stringify(corrupt)).toString('hex')+' -->';
  assert.throws(()=>chartToTsv(parseChartBlockLine(raw,{normalize:false})),/有限/);
});
