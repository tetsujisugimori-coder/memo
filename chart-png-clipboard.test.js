"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { copyChartPng, saveChartPng, generateChartPng, chartPngCopyMessage } = require("./chart-png-export.js");
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
function browser() {
  const log=[], urls=new Set(), canvases=[], images=[], blobs=[];
  let source;
  const doc={fonts:{ready:Promise.resolve()},body:{append(){log.push("link");}}};
  class Svg {
    constructor(){this.ownerDocument=doc;this.attributes=[];this.style={setProperty(){}};this.viewBox={baseVal:{width:300,height:200}};this.children=[];}
    querySelectorAll(){return [];}
    cloneNode(){return new Svg();}
    setAttribute(){} removeAttribute(){} append(el){this.children.push(el);} prepend(el){this.children.unshift(el);}
  }
  source=new Svg();
  const style={fontFamily:"sans-serif",getPropertyValue:p=>({"--section-bg":"#fff","--ink":"#222"}[p]||"")};
  const card={isConnected:true,ownerDocument:doc,querySelector:q=>q===".chart-block-scroll > svg"?source:null,querySelectorAll:()=>[]};
  const view={isSecureContext:true,AbortController,Blob,navigator:{clipboard:{}},getComputedStyle:()=>style,
    URL:{createObjectURL(){urls.add("blob:svg");return "blob:svg";},revokeObjectURL(u){urls.delete(u);}},
    XMLSerializer:class{serializeToString(){log.push("svg");return "<svg/>";}},
    Image:class{constructor(){images.push(this);}set src(v){queueMicrotask(()=>this.onload?.());}decode(){return Promise.resolve();}removeAttribute(){}},
    FileReader:class{readAsDataURL(blob){log.push("reader");this.result="data:image/png;base64,test";queueMicrotask(()=>this.onload());}},
    ClipboardItem:class{constructor(data){log.push("item");this.data=data;this.types=Object.keys(data);this.data["image/png"].catch(()=>{});}getType(type){return this.data[type];}}
  };
  doc.defaultView=view;
  doc.createElementNS=()=>new Svg();
  doc.createElement=tag=>{
    if(tag==="a")return {setAttribute(){},remove(){},removeAttribute(){},click(){log.push("download");}};
    assert.equal(tag,"canvas");
    const canvas={width:300,height:150,getContext:()=>({measureText:t=>({width:t.length*10}),fillRect(){},drawImage(){}}),
      toBlob(callback,type){log.push("blob");const bytes=new Uint8Array(40);bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);const header=new DataView(bytes.buffer);header.setUint32(16,this.width);header.setUint32(20,this.height);const blob=new Blob([bytes],{type});blobs.push(blob);callback(blob);}};
    canvases.push(canvas);return canvas;
  };
  view.navigator.clipboard.write=items=>{log.push("write");state.items=items;return items[0].getType("image/png").then(()=>log.push("written"));};
  const state={card,doc,view,log,urls,canvases,images,blobs,replaceSource(){source=new Svg();}};
  return state;
}
test("Promise PNGをClipboardItemへ渡し、フォント待機完了前の同一呼出しでwriteを開始",async()=>{
  const env=browser(),font=deferred();env.doc.fonts.ready=font.promise;
  const copying=copyChartPng(Object.freeze(env.card));
  assert.deepEqual(env.log,["item","write"]);assert.equal(env.items.length,1);assert.deepEqual(env.items[0].types,["image/png"]);
  assert.ok(env.items[0].data["image/png"] instanceof Promise);font.resolve();await copying;
  assert.equal(await env.items[0].getType("image/png"),env.blobs[0]);assert.deepEqual(env.log,["item","write","svg","blob","written"]);
  assert.equal(env.urls.size,0);assert.ok(env.images.every(i=>i.onload===null&&i.onerror===null));assert.equal(env.canvases.at(-1).width,0);
});
test("共通生成、保存、コピーで同じPNGバイトを生成し配送だけを変える",async()=>{
  const a=browser(),b=browser(),c=browser();const blob=await generateChartPng(a.card);await saveChartPng(b.card,"日本語");await copyChartPng(c.card);
  assert.deepEqual(await blob.arrayBuffer(),await b.blobs[0].arrayBuffer());assert.deepEqual(await blob.arrayBuffer(),await c.blobs[0].arrayBuffer());
  assert.ok(b.log.includes("reader")&&b.log.includes("link")&&b.log.includes("download"));assert.ok(!c.log.some(x=>["reader","link","download"].includes(x)));
});
test("write完了まではコピー成功にならない",async()=>{
  const env=browser(),write=deferred();let done=false;env.view.navigator.clipboard.write=()=>write.promise;
  const copying=copyChartPng(env.card).then(()=>done=true);await generateChartPng(browser().card);assert.equal(done,false);write.resolve();await copying;assert.equal(done,true);
});
for(const [name,mutate,code] of [
  ["secure contextなし",e=>e.view.isSecureContext=false,"insecure"],
  ["clipboardなし",e=>delete e.view.navigator.clipboard,"clipboard-unavailable"],
  ["writeなし",e=>delete e.view.navigator.clipboard.write,"clipboard-unavailable"],
  ["ClipboardItemなし",e=>delete e.view.ClipboardItem,"item-unavailable"],
  ["PNG明示未対応",e=>e.view.ClipboardItem.supports=()=>false,"png-unsupported"]
])test(name+"では生成・書込みしない",async()=>{const e=browser();mutate(e);await assert.rejects(copyChartPng(e.card),{code});assert.deepEqual(e.log,[]);assert.match(chartPngCopyMessage({code}),/PNG画像として保存/);});
test("supportsがない基本APIでは書込みを試す",async()=>{const e=browser();assert.equal(e.view.ClipboardItem.supports,undefined);await copyChartPng(e.card);assert.ok(e.log.includes("write"));});
for(const stage of ["item-construction","write-sync","write-async"])test(stage+"失敗で生成Promiseを観測し後始末、再試行可能",async()=>{
  const e=browser(),native=e.view.ClipboardItem,write=e.view.navigator.clipboard.write;e.doc.fonts.ready=deferred().promise;
  if(stage==="item-construction")e.view.ClipboardItem=class{constructor(){throw new Error("constructor");}};
  else e.view.navigator.clipboard.write=()=>{if(stage==="write-sync")throw new Error("write");return Promise.reject(new Error("write"));};
  await assert.rejects(copyChartPng(e.card),{code:stage});assert.equal(e.urls.size,0);assert.ok(!e.log.includes("download"));
  e.doc.fonts.ready=Promise.resolve();e.view.ClipboardItem=native;e.view.navigator.clipboard.write=write;await copyChartPng(e.card);
});
for(const name of ["NotAllowedError","SecurityError","DataError","AbortError"])test(name+"に日本語の復帰案内",async()=>{
  const e=browser();e.view.navigator.clipboard.write=()=>Promise.reject(Object.assign(new Error("internal"),{name}));
  await assert.rejects(copyChartPng(e.card),error=>{assert.equal(error.cause.name,name);assert.match(chartPngCopyMessage(error),/PNG画像として保存/);assert.doesNotMatch(chartPngCopyMessage(error),/internal|Error/);return true;});
});
for(const failure of ["fonts","load","decode","canvas","toBlob","null","undefined","empty","mime","signature","dimensions"])test("生成失敗をClipboardItemへ伝える: "+failure,async()=>{
  const e=browser(),create=e.doc.createElement;
  if(failure==="fonts")e.doc.fonts.ready=Promise.reject(new Error("fonts"));
  if(failure==="load")e.view.Image=class{set src(v){queueMicrotask(()=>this.onerror?.());}removeAttribute(){}};
  if(failure==="decode")e.view.Image.prototype.decode=()=>Promise.reject(new Error("decode"));
  if(!["fonts","load","decode"].includes(failure))e.doc.createElement=tag=>{const el=create(tag);if(tag!=="canvas")return el;
    if(failure==="canvas")el.getContext=()=>null;
    else if(failure==="dimensions")el.toBlob=cb=>{const bytes=new Uint8Array(40);bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);cb(new Blob([bytes],{type:"image/png"}));};
    else el.toBlob=cb=>{if(failure==="toBlob")throw new Error("toBlob");cb(failure==="null"?null:failure==="undefined"?undefined:new Blob([failure==="empty"?"":"x".repeat(40)],{type:failure==="mime"?"text/plain":"image/png"}));};return el;};
  await assert.rejects(copyChartPng(e.card));await assert.rejects(e.items[0].getType("image/png"));assert.equal(e.urls.size,0);assert.ok(!e.log.includes("written")&&!e.log.includes("download"));
});
for(const change of ["removed","redrawn"])test("処理中の対象変更: "+change,async()=>{
  const e=browser(),font=deferred();e.doc.fonts.ready=font.promise;const copying=copyChartPng(e.card);
  if(change==="removed")e.card.isConnected=false;else e.replaceSource();font.resolve();await assert.rejects(copying,{code:"target-changed"});assert.ok(!e.log.includes("blob"));
});
test("write完了前の対象変更でも成功にしない",async()=>{const e=browser(),done=deferred(),consumed=deferred();e.view.navigator.clipboard.write=async items=>{await items[0].getType("image/png");consumed.resolve();await done.promise;};const copying=copyChartPng(e.card);await consumed.promise;e.card.isConnected=false;done.resolve();await assert.rejects(copying,{code:"target-changed"});});

// Exercise the UI handler boundary with only the surrounding DOM/save reader supplied.
const vm=require("node:vm"),fs=require("node:fs");
const app=fs.readFileSync("app.js","utf8");
const handler=app.slice(app.indexOf("async function runChartPngFromButton("),app.indexOf("function chartTsvCopyControls("));
function uiCard(id){const status={textContent:""},attrs=new Map(),buttons=[];const controls={getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),querySelector:()=>status,querySelectorAll:()=>buttons};const card={dataset:{chartId:id},isConnected:true};for(const copy of [false,true]){const at=new Map();buttons.push({dataset:copy?{chartPngCopyIndex:id}:{chartPngIndex:id},hasAttribute:key=>copy&&key==="data-chart-png-copy-index",getAttribute:k=>at.get(k),setAttribute:(k,v)=>at.set(k,v),removeAttribute:k=>at.delete(k),closest:s=>s===".chart-png-controls"?controls:card});}return {card,controls,buttons,status};}
test("カード単位の競合防止、通知分離、失敗後のbusy解除と再試行、保存状態不変",async()=>{
  const a=uiCard("0"),b=uiCard("1"),done=deferred(),state=Object.freeze({value:"unchanged"});let copies=0,saves=0;
  const context={editor:state,splitChartBlocks:()=>["0","1"].map(id=>({type:"chart",chart:{id,title:"title"}})),window:{MemoNexusChartPngExport:{copyChartPng:()=>{copies++;return done.promise;},saveChartPng:async()=>{saves++;},chartPngCopyMessage:()=>"PNG画像として保存を利用してください"}}};vm.createContext(context);vm.runInContext(handler,context);
  const first=context.runChartPngFromButton(a.buttons[1]);await context.runChartPngFromButton(a.buttons[1]);await context.runChartPngFromButton(a.buttons[0]);assert.equal(copies,1);assert.equal(saves,0);assert.equal(a.buttons[1].getAttribute("aria-busy"),"true");assert.equal(a.buttons[0].getAttribute("aria-disabled"),"true");assert.equal(b.status.textContent,"");
  await context.runChartPngFromButton(b.buttons[0]);assert.equal(saves,1);assert.match(b.status.textContent,/保存を開始/);done.reject(new Error("permission"));await first;assert.equal(a.buttons[1].getAttribute("aria-busy"),undefined);assert.equal(a.buttons[0].getAttribute("aria-disabled"),undefined);assert.match(a.status.textContent,/PNG画像として保存/);
  context.window.MemoNexusChartPngExport.copyChartPng=async()=>{copies++;};await context.runChartPngFromButton(a.buttons[1]);assert.equal(copies,2);assert.equal(a.status.textContent,"グラフ画像をクリップボードへコピーしました");assert.deepEqual(state,{value:"unchanged"});
});

test("writeが先に解決してもPNG生成失敗を成功にしない",async()=>{const e=browser(),font=deferred();e.doc.fonts.ready=font.promise;e.view.navigator.clipboard.write=()=>Promise.resolve();const copying=copyChartPng(e.card);font.reject(new Error("fonts"));await assert.rejects(copying,{code:"generation"});assert.ok(!e.log.includes("blob"));});

test("write拒否時も読み込み中SVGはload完了後にURLを解放する",async()=>{
  const e=browser(),started=deferred(),write=deferred();let image;
  e.view.Image=class{constructor(){image=this;}set src(value){started.resolve();}removeAttribute(){}decode(){return Promise.resolve();}};
  e.view.navigator.clipboard.write=()=>write.promise;
  const copying=copyChartPng(e.card);await started.promise;write.reject(new Error("denied"));await Promise.resolve();await Promise.resolve();
  assert.equal(e.urls.size,1,"keep URL while its image is loading");image.onload();await assert.rejects(copying,{code:"write-async"});assert.equal(e.urls.size,0);assert.equal(image.onload,null);assert.equal(image.onerror,null);
});
