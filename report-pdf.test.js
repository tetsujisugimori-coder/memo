"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { sanitizeWindowsName } = require("./export-utils.js");
const app = fs.readFileSync("app.js", "utf8");
const code = app.slice(app.indexOf("function restoreReportPrint()"), app.indexOf("// Selection state stays outside", app.indexOf("function restoreReportPrint()")));
function harness({decode = async () => {}, height = 2000} = {}) {
  const attrs = new Map();
  const mediaAttrs = new Map();
  const visual = {style:{},getBoundingClientRect:()=>({height,width:500}),closest:()=>null,
    getAttribute:key=>mediaAttrs.get(key)??null,setAttribute:(key,value)=>mediaAttrs.set(key,value),removeAttribute:key=>mediaAttrs.delete(key)};
  const element = {open:false, style:{}, classList:{contains:()=>false}, naturalWidth:300, parentElement:{closest:()=>null},
    getAttribute:key=>attrs.get(key) ?? null, setAttribute:(key,value)=>attrs.set(key,value), removeAttribute:key=>attrs.delete(key),
    decode, querySelector:()=>visual, querySelectorAll:()=>[], getBoundingClientRect:()=>({height,width:500})};
  const controls = Object.fromEntries(["reportPrintBtn","reportPreviewBackBtn","reportPrintStyles","reportPrintStatus"].map(id=>[id,{disabled:false,focus(){},media:"print",sheet:{},textContent:""}]));
  const context = vm.createContext({document:{readyState:"complete",title:"Memo Nexus",body:{classList:{contains:()=>true}},fonts:{ready:Promise.resolve()}},
    previewCard:{scrollTop:120}, preview:{querySelectorAll:selector=>selector === ".report-image-source" ? [] : [element]},
    reportPrintState:null,mermaidRenderGeneration:1,attachmentRenderPromise:Promise.resolve(),mermaidRenderQueue:Promise.resolve(),
    titleInput:{value:'資料:比較/結果'},safeFileName:sanitizeWindowsName,$:id=>controls[id],
    getComputedStyle:()=>({marginTop:"16",marginBottom:"16"}),requestAnimationFrame:callback=>callback(),window:{print(){context.printed = true;}}});
  vm.runInContext(code,context);
  return {context,controls,element,visual};
}
test("描画完了まで印刷を待ち、大きな図を縦横比を保つzoomで縮小する",async()=>{
  let resolve; const pending=new Promise(r=>{resolve=r;}); const h=harness({decode:()=>pending});
  const printing=h.context.printReportPreview();await Promise.resolve();
  assert.equal(h.context.printed,undefined);resolve();await printing;
  assert.equal(h.context.printed,true);assert.ok(Number(h.visual.style.zoom)<1);
  assert.equal(h.element.style.zoom,undefined,"caption text stays unscaled");
  assert.equal(h.context.document.title,sanitizeWindowsName('資料:比較/結果'));
  assert.equal(h.controls.reportPrintStyles.media,"all");
  h.context.restoreReportPrint();assert.equal(h.context.document.title,"Memo Nexus");
  assert.equal(h.element.open,false);assert.equal(h.controls.reportPrintStyles.media,"print");
  assert.equal(h.controls.reportPrintBtn.disabled,false);assert.equal(h.context.previewCard.scrollTop,120);
});
test("画像decode失敗時は印刷せず一時表示を復元する",async()=>{
  const h=harness({decode:async()=>{throw new Error("broken image");}});await h.context.printReportPreview();
  assert.equal(h.context.printed,undefined);assert.equal(h.context.reportPrintState,null);
  assert.equal(h.element.open,false);assert.match(h.controls.reportPrintStatus.textContent,/broken image/);
});
test("描画中にPreviewが更新されたら古い内容を印刷しない",async()=>{
  const h=harness();let finish;h.context.attachmentRenderPromise=new Promise(r=>{finish=r;});
  const pending=h.context.printReportPreview();h.context.mermaidRenderGeneration++;finish();await pending;
  assert.equal(h.context.printed,undefined);assert.match(h.controls.reportPrintStatus.textContent,/表示が更新/);
});
test("二重実行を拒否し、終了後に再実行できる",async()=>{
  const h=harness({height:100});assert.equal(await h.context.prepareReportPrint(),true);
  assert.equal(await h.context.prepareReportPrint(),false);assert.equal(h.element.style.zoom,undefined);
  h.context.restoreReportPrint();assert.equal(await h.context.prepareReportPrint(),true);h.context.restoreReportPrint();
});
test("空タイトルの既定名と印刷API失敗時の復元",async()=>{
  const h=harness();h.context.titleInput.value=" ";await h.context.prepareReportPrint();assert.equal(h.context.document.title,"無題レポート");
  h.context.restoreReportPrint();h.context.window.print=()=>{throw new Error("unavailable");};await h.context.printReportPreview();
  assert.equal(h.context.reportPrintState,null);assert.equal(h.context.document.title,"Memo Nexus");
});
test("Mermaid描画とフォント待機の両方が終わるまで印刷しない",async()=>{
  const h=harness();let diagram,font;
  h.context.mermaidRenderQueue=new Promise(resolve=>{diagram=resolve;});
  h.context.document.fonts.ready=new Promise(resolve=>{font=resolve;});
  const pending=h.context.printReportPreview();diagram();await Promise.resolve();assert.equal(h.context.printed,undefined);
  font();await pending;assert.equal(h.context.printed,true);h.context.restoreReportPrint();
});
test("印刷CSS失敗と準備中の終了は印刷せず、再開可能な状態へ戻る",async()=>{
  const h=harness();h.controls.reportPrintStyles.sheet=null;await h.context.printReportPreview();
  assert.equal(h.context.printed,undefined);assert.match(h.controls.reportPrintStatus.textContent,/印刷用スタイル/);
  h.controls.reportPrintStyles.sheet={};let finish;h.context.mermaidRenderQueue=new Promise(resolve=>{finish=resolve;});
  const pending=h.context.printReportPreview();h.context.restoreReportPrint();finish();await pending;
  assert.equal(h.context.printed,undefined);assert.equal(h.controls.reportPrintStyles.media,"print");
});


test("先頭Timeline項目は親sectionの見出し分も確保して印刷する",async()=>{
  const h=harness();
  h.element.classList.contains=name=>name==="timeline-item";
  h.element.parentElement.previousElementSibling={matches:selector=>selector.includes("h2"),getBoundingClientRect:()=>({height:80})};
  await h.context.prepareReportPrint();
  const available=257*96/25.4-112-4;
  assert.ok(Number(h.visual.style.zoom)*2000+32<=available+0.01,"heading and complete Timeline media/caption/source fit together");
  assert.equal(h.element.style.zoom,undefined,"Timeline text stays unscaled");
  h.context.restoreReportPrint();
});

test("長い説明を含むFigureは全体を縮めず分割でき、一時styleを復元する",async()=>{
  const h=harness({height:2400});
  h.element.querySelector=()=>({getBoundingClientRect:()=>({height:300,width:500})});
  await h.context.prepareReportPrint();
  assert.equal(h.element.style.breakInside,"auto");assert.equal(h.element.style.zoom,undefined);
  assert.equal(h.element.style.display,"block");
  h.context.restoreReportPrint();assert.equal(h.element.getAttribute("style"),null);
 });
test("画像を持たない長いTimeline項目は文字サイズを維持して分割できる",async()=>{
  const h=harness({height:2400});
  h.element.classList.contains=name=>name==="timeline-item";
  h.element.querySelector=()=>null;
  await h.context.prepareReportPrint();
  assert.equal(h.element.style.breakInside,"auto");assert.equal(h.element.style.zoom,undefined);
  h.context.restoreReportPrint();
 });

test("ページを超えるキャプションは画像の縮小余地をすべて奪わない",async()=>{
  const h=harness({height:4000});
  const attrs=new Map();
  const visual={style:{},getBoundingClientRect:()=>({height:1600,width:500}),
    closest:()=>({classList:{contains:()=>false},querySelector:()=>({getBoundingClientRect:()=>({height:2000})})}),
    getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),removeAttribute:key=>attrs.delete(key)};
  h.element.querySelector=()=>visual;h.element.querySelectorAll=()=>[visual];
  await h.context.prepareReportPrint();
  assert.equal(h.element.style.zoom,undefined);
  assert.ok(Number(visual.style.zoom)>.35&&Number(visual.style.zoom)<1,"fit the large media while leaving caption text unscaled");
  h.context.restoreReportPrint();assert.equal(visual.getAttribute("style"),null);
});
