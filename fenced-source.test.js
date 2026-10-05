"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const s=require("./source-utils.js"),t=require("./table-block-utils.js"),tl=require("./timeline-block-utils.js"),g=require("./geometry-block-utils.js");
const source={id:"s1",title:"既存資料",author:"著者",url:"https://example.org/a",publisher:"出版社",date:"2026-10-04",accessedAt:"2026-10-04",page:"12",sourceType:"primary"};
function splitPreview(body){
  const app=fs.readFileSync(__dirname+"/app.js","utf8");
  const code=app.slice(app.indexOf("function splitFencedBlocks("),app.indexOf("function splitMathAndCalculationBlocks("));
  const context={};if(fs.existsSync(__dirname+"/markdown-fence-utils.js"))context.scanFencedLines=require("./markdown-fence-utils.js").scanFencedLines;
  vm.createContext(context);vm.runInContext(code,context);return JSON.parse(JSON.stringify(context.splitFencedBlocks(body)));
}
for(const fence of ["~~~","```"]){
  test("未完フェンス "+fence+" でもアプリ保存Sourceと参照配列を保持する",()=>{
    const block=t.serializeTableBlock({...t.createTableBlock("refs"),citationIds:["s1","missing"]});
    const body="本文 [@s1]\n"+block+"\n"+fence+"js\n未完成のコード";
    let saved=s.withSources(body,[source]);
    assert.deepEqual(s.parseSourceDocument(saved).sources,s.normalizeSources([source]));
    assert.equal(s.parseSourceDocument(saved).body,body);
    saved=s.withSources(saved,[{...source,title:"編集資料"},{id:"s2",title:"追加資料"}]);
    assert.equal(s.parseSourceDocument(saved).sources[0].title,"編集資料");
    assert.deepEqual(t.splitTableBlocks(s.parseSourceDocument(saved).body).find(x=>x.type==="table").table.citationIds,["s1","missing"]);
    assert.equal((saved.match(/<!-- memo-nexus:sources-v1:/g)||[]).length,1);
    assert.equal(s.withSources(saved,s.parseSourceDocument(saved).sources),saved);
  });
}
test("曖昧な旧末尾マーカーはコード例を登録せず原文と上書き拒否状態を保持する",()=>{
  const body="本文 [@s1]\n~~~js\n未完成のコード\n"+s.serializeSources([source]);
  const parsed=s.parseSourceDocument(body);assert.deepEqual(parsed.sources,[]);assert.equal(parsed.body,body);
  assert.equal(parsed.sourceStorageConflict,true);assert.equal(s.withSources(body,[{id:"s2",title:"追加"}]),body);
});
for(const [open,close,hidden] of [["  ~~~js","  ~~~",true],["  ```js","  ```",true],["~~~js","```",true],["~~~~js","~~~",true],["~~~js","~~~ trailing",true],["```js more","```",true],["    ~~~js","    ~~~",false],["~~~js","~~~~ \t",true]]){
  test("表示と抽出のフェンス判定が一致: "+JSON.stringify([open,close]),()=>{
    const body=open+"\n[@s1]\n"+close+"\n[@s2]";
    const blocks=splitPreview(body);const displayed=blocks.filter(b=>b.type==="text").flatMap(b=>[...b.text.matchAll(/\[@(s[12])\]/g)].map(m=>m[1]));
    assert.equal(displayed.includes("s1"),!hidden);assert.deepEqual(s.extractCitations(body),displayed);
  });
}
test("Timelineも閉じ行の末尾文字を閉じ区切りとして扱わない",()=>{
  const marker=tl.serializeTimelineBlock({id:"tl",items:[{id:"i",citationIds:["s1"]}]});
  const body="  ~~~js\n~~~ trailing\n"+marker+"\n  ~~~";
  assert.equal(tl.splitTimelineBlocks(body).some(b=>b.type==="timeline"),false);assert.deepEqual(s.extractCitations(body),[]);
});

test("実旧Source readerは新しい先頭v1と従来末尾v1を読める",()=>{
  const context={module:{exports:{}},require:id=>require(id),TextEncoder,TextDecoder,URL};vm.createContext(context);
  vm.runInContext(fs.readFileSync(__dirname+"/docs/report-preview-v1/fixtures/source-utils-main.txt","utf8"),context);
  const body="本文 [@s1]\n~~~js\n未完";const saved=s.withSources(body,[source]);
  const old=context.module.exports.parseSourceDocument(saved);
  assert.equal(old.body,body);assert.deepEqual(JSON.parse(JSON.stringify(old.sources)),s.normalizeSources([source]));
  const legacy="本文 [@s1]\n"+s.serializeSources([source]);assert.equal(s.parseSourceDocument(legacy).body,"本文 [@s1]");
  assert.equal(s.parseSourceDocument(s.withSources(legacy,[{...source,title:"編集"}])).sources[0].title,"編集");
});
test("登録済み先頭Sourceと未完コード例マーカーは独立し例から登録しない",()=>{
  const example="~~~text\n"+s.serializeSources([{id:"example",title:"コード例"}]);
  const body=s.serializeSources([source])+"\n"+example;
  assert.deepEqual(s.parseSourceDocument(body).sources,s.normalizeSources([source]));
  const saved=s.withSources(body,[{...source,title:"編集"}]);
  assert.equal(s.parseSourceDocument(saved).body,example);assert.equal(s.parseSourceDocument(saved).sources.length,1);
  assert.equal(s.parseSourceDocument(saved).sources[0].id,"s1");assert.equal(s.parseSourceDocument(saved).sourceStorageConflict,undefined);
});
test("各ブロックparserとSource/描画は字下げ・種類・長さ・閉じ行条件を共有する",()=>{
  const a=require("./attachment-utils.js"),c=require("./chart-block-utils.js");
  const bodyParts=[a.serializeImageBlock([{id:"img",figureMetadata:{citationIds:["s1"]}}]),t.serializeTableBlock({...t.createTableBlock("tbl"),citationIds:["s1"]}),c.serializeChartBlock({...c.createChartBlock("chart"),citationIds:["s1"]}),tl.serializeTimelineBlock({id:"tl",items:[{id:"i",citationIds:["s1"]}]}),g.serializeGeometryBlock({...g.createGeometryBlock("geom"),version:2,diagram:{citationIds:["s1"]}})];
  for(const [open,badClose,close] of [["  ~~~js","  \x60\x60\x60","  ~~~"],["  \x60\x60\x60\x60js","  \x60\x60\x60","  \x60\x60\x60\x60"],["~~~js","~~~ trailing","~~~"],["- リスト\n    ~~~js","      ~~~","    ~~~"]]){
    const body=open+"\n"+badClose+"\n"+bodyParts.join("\n")+"\n[@s1]\n"+s.serializeSources([source])+"\n"+close;
    assert.equal(a.splitImageBlocks(body).some(b=>b.type==="image"),false);
    assert.equal(t.splitTableBlocks(body).some(b=>b.type==="table"),false);assert.equal(c.splitChartBlocks(body).some(b=>b.type==="chart"),false);
    assert.equal(tl.splitTimelineBlocks(body).some(b=>b.type==="timeline"),false);assert.equal(g.splitGeometryBlocks(body).some(b=>b.type==="geometry"),false);
    assert.deepEqual(s.extractCitations(body),[]);assert.deepEqual(s.parseSourceDocument(body).sources,[]);
    assert.equal(splitPreview(body).filter(b=>b.type==="text").some(b=>b.text.includes("[@s1]")),false);
  }
});

test("コード外の旧保存マーカーが複数あっても編集で一件になり増殖しない",()=>{
  const body=s.serializeSources([source])+"\n本文 [@s1]\n"+s.serializeSources([{...source,title:"旧末尾"}]);
  assert.equal(s.parseSourceDocument(body).sources[0].title,"旧末尾");
  const saved=s.withSources(body,[{...source,title:"更新"}]);
  assert.equal((saved.match(/<!-- memo-nexus:sources-v1:/g)||[]).length,1);
  assert.equal(s.parseSourceDocument(saved).body,"本文 [@s1]");assert.equal(s.parseSourceDocument(saved).sources[0].title,"更新");
  assert.equal(s.withSources(saved,s.parseSourceDocument(saved).sources),saved);
  assert.deepEqual(s.sourceSelectionFromRaw(body,body.indexOf("本文"),body.indexOf("本文")+2),{start:0,end:2});
});

test("共通化後もコード内末尾改行と通常本文改行の表示を保持する",()=>{
  assert.equal(splitPreview("~~~js\n未完\n")[0].code,"未完\n");
  assert.equal(splitPreview("通常本文\n")[0].text,"通常本文\n");
});
