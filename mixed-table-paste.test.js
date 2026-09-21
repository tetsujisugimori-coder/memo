"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseHtmlTableContent, parseHtmlTableElement, detectPastedTable, validateMixedTablePaste, serializeMixedTablePaste, insertTablePasteContent, serializeTableBlock, splitTableBlocks } = require("./table-block-utils.js");

// A detached DOM fixture: parsing actual HTML is additionally tested in both browser engines.
function el(tag, children = [], attrs = {}) {
  const node = { nodeType: 1, tagName: tag.toUpperCase(), childNodes: children.map(x => typeof x === "string" ? {nodeType:3,textContent:x} : x),
    get children() { return this.childNodes.filter(x=>x.nodeType===1); },
    get textContent() { return this.childNodes.map(x=>x.textContent).join(""); },
    getAttribute(name) { return attrs[name] ?? null; },
    closest(name) { return this.tagName === name.toUpperCase() ? this : this.parent?.closest(name); },
    querySelectorAll(selector) { return this.childNodes.flatMap(x => x.nodeType === 1 ? [...(selector.split(", ").includes(x.tagName.toLowerCase()) ? [x] : []), ...x.querySelectorAll(selector)] : []); },
    cloneNode() { return el(tag, this.childNodes.map(x=>x.nodeType===1 ? x.cloneNode() : x.textContent), attrs); },
    remove() { this.parent.childNodes = this.parent.childNodes.filter(x=>x!==this); },
    replaceWith(value) { this.parent.childNodes.splice(this.parent.childNodes.indexOf(this),1,{nodeType:3,textContent:value}); }
  };
  node.childNodes.forEach(x=>x.parent=node);
  return node;
}
const row = (...cells) => el("tr",cells);
const cell = (text,tag="td",attrs={}) => el(tag,Array.isArray(text)?text:[text],attrs);
const table = (text="表",header=false) => el("table",[row(cell(text,header?"th":"td"),cell("値")),row(cell("項目"),cell("1"))]);
const parser = root => class { parseFromString() { return {body:root}; } };
const parse = (...nodes) => parseHtmlTableContent("<table>",parser(el("body",nodes)));
const mixed = rows => ({format:"html-mixed",segments:rows.map(r=>({type:"table",table:{rows:r,hasHeader:false}}))});
const matrix = (r,c) => Array.from({length:r},()=>Array(c).fill("x"));
test("文書順に文章3区間と独立した表2件へ分解し文字を重複しない",()=>{
 const result=parse(el("p",["文章A"]),table("表1",true),el("p",["文章B"]),table("表2"),el("p",["文章C"]));
 assert.deepEqual(result.segments.map(x=>x.type==="text"?x.text:x.table.rows[0][0]),["文章A","表1","文章B","表2","文章C"]);
 assert.deepEqual(result.segments.filter(x=>x.table).map(x=>x.table.hasHeader),[true,false]);
 assert.equal(result.format,"html-mixed");
});
test("日本語・英数字・絵文字・改行・inline間の空白を保持し装飾記号を加えない",()=>{
 const result=parse(el("p",["日本語 ",el("b",["ABC"]), " ",el("a",["リンク😀"]),el("br"),"次行"]),table());
 assert.equal(result.segments[0].text,"日本語 ABC リンク😀\n次行");
});
for (const tag of ["p","div","h1","h6","li","blockquote","pre","dt","dd"]) test(tag+"境界を改行として保持する",()=>{
 const result=parse(el(tag,["前"]),el(tag,["後"]),table());
 assert.equal(result.segments[0].text,"前\n\n後");
});
test("script/style/template/noscript/コメント・属性は文章にもセルにも残さない",()=>{
 const excluded=["script","style","template","noscript"];
 const result=parse(el("div",["安全",...excluded.map(tag=>el(tag,["危険"])),{nodeType:8,textContent:"comment"}]),el("table",[row(cell(["セル",...excluded.map(tag=>el(tag,["危険"]))]))]));
 assert.equal(result.segments[0].text,"安全");
 assert.deepEqual(result.segments[1].table.rows,[["セル"]]);
 assert.doesNotMatch(result.plainText,/危険|comment|<|>/);
});
test("各表の結合セル判定・rowspan/colspan・不揃い行を維持する",()=>{
 const merged=el("table",[row(cell("A","th",{rowspan:"2",colspan:"2"}),cell("B")),row(cell("C"))]);
 const result=parse(merged,table());
 assert.deepEqual(result.segments[0].table.rows,[["A","","B"],["","","C"]]);
 assert.deepEqual(result.segments.map(x=>x.table.hasMergedCells),[true,false]);
});
test("入れ子表は外側セルの文字だけに含める",()=>{
 const result=parse(el("p",["前"]),el("table",[row(cell(["外",table("内")]))]),el("p",["後"]));
 assert.equal(result.segments.filter(x=>x.type==="table").length,1);
 assert.match(result.segments[1].table.rows[0][0],/外内/);
 assert.deepEqual(result.segments.filter(x=>x.type==="text").map(x=>x.text),["前","後"]);
});
test("有効な単一表と空白だけなら従来の結果へ戻す",()=>{
 const result=parse(" \n",table("単一"),el("p",[" "]));
 assert.equal(result.format,"html");
 assert.equal(result.plainText,"単一\t値\n項目\t1");
});
test("解析不能表を含む場合は全体を拒否しテキストには周囲の内容を残す",()=>{
 const result=parse(el("p",["前"]),table("有効"),el("table",[el("caption",["不正表"]) ]),el("p",["後"]));
 assert.equal(result.parseFailed,true);
 assert.equal(validateMixedTablePaste(result).allowed,false);
 assert.throws(()=>serializeMixedTablePaste(result,()=>"id"));
 assert.match(result.plainText,/前[\s\S]*有効[\s\S]*不正表[\s\S]*後/);
});
test("表のないHTML・Parser例外はMarkdown/TSV/通常の順へ戻す",()=>{
 for(const Parser of [parser(el("body",[el("p",["本文"])])),class{parseFromString(){throw Error("bad");}}]){
  assert.equal(detectPastedTable({html:"<table>",text:"A | B\n--- | ---\n1 | 2"},Parser).format,"markdown");
  assert.equal(detectPastedTable({html:"<table>",text:"A\tB"},Parser).format,"tab-separated");
  assert.equal(detectPastedTable({html:"<table>",text:"文章"},Parser),null);
 }
});
for (const [name,rows,allowed,count] of [
 ["各表100行30列", [matrix(100,30)],true,3000],
 ["合計3000セル",[matrix(50,30),matrix(50,30)],true,3000],
 ["10表",Array.from({length:10},()=>matrix(1,1)),true,10],
 ["101行",[matrix(101,1)],false,101],
 ["31列",[matrix(1,31)],false,31],
 ["合計3001セル",[matrix(100,30),matrix(1,1)],false,3001],
 ["11表",Array.from({length:11},()=>matrix(1,1)),false,11]
]) test(name+"を切り捨てず検査する",()=>{
 const input=mixed(rows),before=JSON.stringify(input),size=validateMixedTablePaste(input);
 assert.equal(size.allowed,allowed); assert.equal(size.cellCount,count); assert.equal(JSON.stringify(input),before);
 if(!allowed) assert.throws(()=>serializeMixedTablePaste(input,()=>"id"));
});
test("凍結入力から固有ID・個別見出しを直列化し全体を一度に安全挿入する",()=>{
 const input=parse(el("p",["前"]),table("1",true),el("p",["間"]),table("2"),el("p",["後"]));
 function freeze(x){Object.values(x).forEach(v=>{if(v&&typeof v==="object")freeze(v);});return Object.freeze(x);}
 freeze(input);
 const before=JSON.stringify(input); let index=0;
 const content=serializeMixedTablePaste(input,()=>"id-"+ ++index,[false,true]);
 const result=insertTablePasteContent("先XX末",1,3,content),segments=splitTableBlocks(result.value);
 assert.deepEqual(segments.filter(x=>x.type==="table").map(x=>[x.table.id,x.table.hasHeader]),[["id-1",false],["id-2",true]]);
 assert.deepEqual(segments.filter(x=>x.type==="text").map(x=>x.text.trim()),["先\n前","間","後\n末"]);
 assert.equal(JSON.stringify(input),before);
 assert.equal(result.selectionStart,result.value.indexOf("末"));
});
test("既存マーカー内の両選択境界を分断しない",()=>{
 const marker=serializeTableBlock({id:"old",rows:[["old"]]}),source="前\n"+marker+"\n後";
 const result=insertTablePasteContent(source,10,20,"文章");
 assert.equal(splitTableBlocks(result.value).find(x=>x.type==="table").raw,marker);
 assert.equal(result.value,"前\n"+marker+"\n文章\n後");
});
test("ID重複や直列化前の例外は結果を返さず元入力不変",()=>{
 const input=mixed([matrix(1,1),matrix(1,1)]),before=JSON.stringify(input);
 assert.throws(()=>serializeMixedTablePaste(input,()=>"same"),/表ID/);
 let count=0;assert.throws(()=>serializeMixedTablePaste(input,()=>{if(count++)throw Error("uuid");return "first";}),/uuid/);
 assert.equal(JSON.stringify(input),before);
});
test("単一表要素解析は入力DOMを変更しない",()=>{
 const root=table(); const before=root.textContent;
 parseHtmlTableElement(root);
 assert.equal(root.textContent,before);assert.equal(root.children.length,2);
});
