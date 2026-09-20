"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { chartPngFilename, chartPngDimensions, chartPngTextLines, chartPngTheme, validateChartPngBlob, chartPngBlob } = require("./chart-png-export.js");
for (const [title, expected] of [
  ["", "memo-nexus-chart.png"], ["   ...", "memo-nexus-chart.png"], [null, "memo-nexus-chart.png"],
  ["月別売上", "月別売上.png"], ['a<>:"/\\|?*b', "a_________b.png"],
  ["a\x00\x1f\x7f\x9fb", "a____b.png"], ["売上 .  ", "売上.png"],
  ["売上.PNG.png", "売上.png"], ["売上.png... ", "売上.png"], [".png", "memo-nexus-chart.png"],
  ["x".repeat(76)+".pngsuffix", "x".repeat(76)+".png"],
  ["CON", "_CON.png"], ["NUL.txt", "_NUL.txt.png"], ["LPT1", "_LPT1.png"],
  ["あ".repeat(100), "あ".repeat(80)+".png"], ["😀".repeat(100), "😀".repeat(80)+".png"]
]) test("安全なPNG名: " + JSON.stringify(title), () => {
  const before = title; assert.equal(chartPngFilename(title), expected); assert.equal(title,before);
});
test("通常は論理寸法の2倍", () => assert.deepEqual(chartPngDimensions(500,300), {width:1000,height:600,scale:2}));
for (const [w,h] of [[10000,2000],[2000,10000],[Number.MAX_VALUE,Number.MAX_VALUE/2]]) test("長辺上限と全体の比率: "+w+":"+h, () => {
  const size=chartPngDimensions(w,h);assert.ok(size.width<=4096&&size.height<=4096);
  assert.ok(Math.abs(size.width/size.height-w/h)<0.005);
});
test("1600万画素上限も適用",()=>assert.deepEqual(chartPngDimensions(3000,3000),{width:4000,height:4000,scale:4/3}));
for(const value of [0,-1,NaN,Infinity,-Infinity,Number.MIN_VALUE,0.1]) for(const axis of ['width','height']) test("不正/極小寸法を拒否: "+axis+" "+value,()=>{
  assert.throws(()=>chartPngDimensions(axis==='width'?value:500,axis==='height'?value:300),/寸法|縦横比/);
});
test("小さいが画像化可能な寸法",()=>assert.deepEqual(chartPngDimensions(0.5,0.5),{width:1,height:1,scale:2}));
test("テキストは折返し・最終行省略、入力不変",()=>{
  const source='あいうえおかきくけこ';const measure=s=>Array.from(s).length*10;
  assert.deepEqual(chartPngTextLines(source,30,measure,2),['あいう','えお…']);assert.equal(source,'あいうえおかきくけこ');
  assert.deepEqual(chartPngTextLines('😀😀😀',20,measure,2),['😀😀','😀']);
});
for(const theme of [{background:'#fff',text:'#222522',axis:'rgb(115, 121, 111)'},{background:'#202721',text:'#e7ece7',axis:'rgb(169, 177, 170)'}]) test("テーマの背景・文字・軸色を取得: "+theme.background,()=>{
  const axis=Object.freeze({}), style=Object.freeze({fontFamily:'sans-serif',getPropertyValue:p=>({'--section-bg':theme.background,'--ink':theme.text})[p]});
  const card=Object.freeze({ownerDocument:{defaultView:{getComputedStyle:el=>el===axis?{stroke:theme.axis}:style}},querySelector:()=>axis});
  assert.deepEqual(chartPngTheme(card),{...theme,font:'sans-serif'});
});
for(const blob of [null,new Blob([],{type:'image/png'}),new Blob(['x'],{type:'image/png'}),new Blob(['x'.repeat(40)],{type:'text/plain'})]) test("空/不正Blobを成功扱いしない: "+blob?.size,()=>assert.throws(()=>validateChartPngBlob(blob),/PNG/));
test("有効Blobを変換せず返す",()=>{const blob=new Blob(['x'.repeat(40)],{type:'image/png'});assert.equal(validateChartPngBlob(blob),blob);});
test("PNG化前に不正寸法を拒否する",async()=>{
  const plan=Object.freeze({svg:{ownerDocument:{createElement:()=>({})}},dimensions:Object.freeze({width:Infinity,height:1})});
  await assert.rejects(chartPngBlob(plan),/寸法/);assert.equal(plan.dimensions.width,Infinity);
});

// Minimal SVG document adapter: tests composition without a browser or a second renderer.
// Geometry is an opaque pre-rendered payload; composition must preserve it verbatim.
const { composeChartPng } = require("./chart-png-export.js");
function compositionDocument() {
  const doc = {
    createElement: () => ({ getContext: () => ({ font: "", measureText: text => ({width:Array.from(text).length*12}) }) }),
    createElementNS: (_namespace,tag) => new SvgNode(tag)
  };
  class SvgNode {
    constructor(tag){this.tag=tag;this.ownerDocument=doc;this.attributes={};this.children=[];this.textContent="";}
    setAttribute(key,value){this.attributes[key]=value;}
    append(node){this.children.push(node);}
    prepend(node){this.children.unshift(node);}
    cloneNode(){const clone=new SvgNode(this.tag);clone.attributes={...this.attributes};clone.textContent=this.textContent;clone.children=this.children.map(child=>child.cloneNode());return clone;}
  }
  return doc;
}
const renderedCases = [
  {name:'bar',width:700,geometry:'bars + X/Y ticks'},
  {name:'horizontal',width:1200,geometry:'horizontal bars + all item labels'},
  {name:'line',width:900,geometry:'polyline + circles'},
  {name:'pie',width:360,geometry:'selected-series sectors #059669 #dc2626',legend:[{text:'選択系列の項目',color:'#059669',line:false}]},
  {name:'stacked',width:600,geometry:'signed segments + 合計: 50 / -10'},
  {name:'percent-stacked',width:600,geometry:'60% -100% 40%'},
  {name:'combo-single',width:700,geometry:'bars + polyline + shared Y'},
  {name:'combo-dual',width:700,geometry:'bars + polyline + 左軸 万円 + 右軸 %',notice:'左右で尺度が異なります'},
  {name:'legend-hidden',width:700,geometry:'bars',legend:[]},
  {name:'values-hidden',width:700,geometry:'unlabelled bars'},
  {name:'points-hidden',width:700,geometry:'polyline only'},
  {name:'table-visible',width:700,geometry:'bars',dataTable:'must not export table'}
];
for(const example of renderedCases) test('出力構成は描画済み内容を再計算しない: '+example.name,()=>{
  const doc=compositionDocument(),svg=doc.createElementNS('','svg');
  svg.setAttribute('viewBox','0 0 '+example.width+' 260');
  const payload=doc.createElementNS('','g');payload.textContent=example.geometry;svg.append(payload);
  const capture=Object.freeze({svg,width:example.width,height:260,title:'タイトル <未信頼> & 日本語',
    theme:Object.freeze({background:'#202721',text:'#e7ece7',axis:'#a9b1aa',font:'sans-serif'}),
    legend:Object.freeze((example.legend||[{text:'凡例',color:'#4f46e5',line:false},{text:'折れ線',color:'#dc2626',line:true}]).map(Object.freeze)),
    notice:example.notice||'',dataTable:example.dataTable||'',editor:'must not export editor',tooltip:'must not export tooltip'});
  const before=JSON.stringify(capture,(key,value)=>key==='ownerDocument'?undefined:value);
  const plan=composeChartPng(capture),children=plan.svg.children,plot=children.find(node=>node.tag==='svg');
  assert.equal(plot.attributes.width,undefined,'does not rewrite the pre-rendered SVG width');
  assert.equal(plot.attributes.viewBox,svg.attributes.viewBox);assert.equal(plot.children[0].textContent,example.geometry);
  assert.equal(plan.svg.attributes.width,String(example.width+40),'full logical width plus padding');
  assert.equal(children[0].attributes.fill,'#202721');
  assert.ok(children.some(node=>node.textContent.includes('タイトル')));
  const output=JSON.stringify(plan,(key,value)=>key==='ownerDocument'?undefined:value);
  assert.doesNotMatch(output,/must not export/);
  if(example.notice)assert.ok(children.some(node=>node.textContent.includes('左右で尺度')));
  if(example.legend?.length===0)assert.equal(children.filter(node=>node.tag==='circle'||node.tag==='line').length,0);
  assert.equal(JSON.stringify(capture,(key,value)=>key==='ownerDocument'?undefined:value),before,'no fields added or mutated');
});
