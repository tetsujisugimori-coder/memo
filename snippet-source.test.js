"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const s=require("./source-utils.js"),t=require("./table-block-utils.js"),c=require("./chart-block-utils.js");
const app=fs.readFileSync(__dirname+"/app.js","utf8");
function actualFunction(name){const start=app.indexOf("function "+name+"(");assert.ok(start>=0);return app.slice(start,app.indexOf("\n}",start)+2);}
const context={parseSourceDocument:s.parseSourceDocument,tableBlockPlainText:t.tableBlockPlainText,chartBlockPlainText:c.chartBlockPlainText};
vm.createContext(context);vm.runInContext(actualFunction("stripLinkMarkupForText")+"\n"+actualFunction("snippet"),context);
const snippet=context.snippet;
const sources=[{id:"s1",title:"既存資料",author:"著者",url:"https://example.org/"+"long".repeat(300)},{id:"s2",title:"追加資料",publisher:"出版社"}];
for(const placement of ["header","footer"]){
 test(placement+" Source保存情報の長さに影響されず本文を一覧へ表示する",()=>{
  for(const refs of [sources.slice(0,1),sources]){
   const body="本文 [@s1] と [[知識]]";
   const stored=placement==="header"?s.withSources(body,refs):body+"\n"+s.serializeSources(refs);
   const before=s.parseSourceDocument(stored),raw=stored;
   assert.equal(snippet(stored),"本文 [@s1] と 知識");
   assert.equal(stored,raw);assert.deepEqual(s.parseSourceDocument(stored),before);
  }
 });
}
test("Sourceなし・知識リンク・Table・Chartの一覧テキストを維持する",()=>{
 assert.equal(snippet(""),"空のカード");assert.equal(snippet("# 通常本文"),"通常本文");
 assert.equal(snippet("[[知識]] と [[* 実験結果]]"),"知識 と 実験結果");
 const table=t.serializeTableBlock({...t.createTableBlock("table"),caption:"表の説明",rows:[["項目","値"],["A","12"]],citationIds:["s1","missing"]});
 const chart=c.serializeChartBlock({...c.createChartBlock("chart"),title:"グラフの説明",items:[{id:"a",label:"A"}],series:[{id:"series",name:"系列",values:[12]}],citationIds:["s2"]});
 const body="[[知識]]\n"+table+"\n"+chart;
 const expected=c.chartBlockPlainText(t.tableBlockPlainText(body)).replace("[[知識]]","知識").replace(/#/g,"").trim();
 assert.equal(snippet(body),expected);assert.equal(snippet(s.withSources(body,sources)),expected);
 const stored=s.withSources(body,sources),before=s.parseSourceDocument(stored);
 snippet(stored);assert.deepEqual(s.parseSourceDocument(stored),before);
 assert.deepEqual(t.splitTableBlocks(before.body).find(b=>b.type==="table").table.citationIds,["s1","missing"]);
 assert.deepEqual(c.splitChartBlocks(before.body).find(b=>b.type==="chart").chart.citationIds,["s2"]);
});
test("コード例・不正・未知形式・曖昧な旧保存情報を一覧でも原文保護する",()=>{
 const marker=s.serializeSources(sources);
 const examples=["~~~text\n"+marker+"\n~~~","コード例\n  \x60\x60\x60text\n"+marker+"\n  \x60\x60\x60","<!-- memo-nexus:sources-v1:zz -->","<!-- memo-nexus:sources-v2:7b7d -->","<!-- memo-nexus:sources-v1:7b7d -->","本文\n~~~js\n未完\n"+marker,"旧本文\n"+marker+"\n本文\n~~~js\n"+marker];
 for(const body of examples){assert.equal(s.parseSourceDocument(body).body,body);assert.equal(snippet(body),body);}
 const example="~~~text\n"+marker+"\n~~~";
 assert.equal(snippet(s.withSources(example,sources)),example);
});
for(const fence of ["~~~","\x60\x60\x60"]){test("未完 "+fence+" のSource保護と本文プレビューを両立する",()=>{
 const body="本文 [@s1]\n"+fence+"js\n未完成のコード",stored=s.withSources(body,sources),before=s.parseSourceDocument(stored);
 assert.equal(snippet(stored),body);assert.equal(before.body,body);assert.deepEqual(s.parseSourceDocument(stored),before);
});}
