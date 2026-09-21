"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { chartSvgFilename, chartPngFilename, validateChartSvgBlob, generateChartSvg } = require("./chart-png-export.js");
for (const title of [null, "", "   ...", "日本語 売上", 'a<>:"/\\|?*\x00\x7fb', "CON", "NUL.txt", "売上.PNG.png", "末尾 . ", "😀".repeat(100)]) {
  test("SVG名はPNGと同じ無害化: " + JSON.stringify(title), () => {
    assert.equal(chartSvgFilename(title), chartPngFilename(title).replace(/\.png$/, ".svg"));
  });
}
// XML parsing itself is tested with native DOMParser in Chromium and WebKit.
// This adapter isolates validation decisions on the parsed document.
const ns = "http://www.w3.org/2000/svg";
function element(tag = "svg", attrs = { width: "600", height: "400", viewBox: "0 0 300 200", xmlns: ns }) {
  return { localName: tag, namespaceURI: ns, style: [], attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    getAttribute(name) { return this.attributes.find(a => a.name === name)?.value ?? null; }, querySelectorAll: () => [] };
}
function view(root, parsererror = false, childNodes = []) {
  return { TextDecoder, DOMParser: class { parseFromString() { return { documentElement: root, querySelector: () => parsererror, childNodes }; } } };
}
const blob = () => new Blob(['<svg>日本語</svg>'], { type: "image/svg+xml;charset=utf-8" });
test("SVG Blobを変換せず返す", async () => { const b = blob(); assert.equal(await validateChartSvgBlob(b, view(element())), b); });
for (const b of [null, undefined, new Blob([], { type: "image/svg+xml" }), new Blob(["x"], { type: "text/plain" })]) {
  test("欠落/空/MIME違いを拒否 " + b?.type, async () => assert.rejects(validateChartSvgBlob(b, view(element()))));
}
test("不正UTF-8を拒否", async () => assert.rejects(validateChartSvgBlob(new Blob([new Uint8Array([0xc0, 0xaf])], { type: "image/svg+xml" }), view(element()))));
test("読出し拒否を伝える", async () => assert.rejects(validateChartSvgBlob({ type: "image/svg+xml", size: 1, arrayBuffer: async () => { throw Error("read"); } }, view(element()))));
test("parsererrorを拒否", async () => assert.rejects(validateChartSvgBlob(blob(), view(element(), true))));
for (const type of [7, 10]) test("外部stylesheet/DTDを拒否 " + type, async () => assert.rejects(validateChartSvgBlob(blob(), view(element(), false, [{ nodeType: type }]))));
for (const [key, value] of [["width", "0"], ["height", "-1"], ["width", "Infinity"], ["height", "1e309"], ["width", "0x10"], ["viewBox", "0 0 0 10"], ["viewBox", "0 0 10"], ["viewBox", "NaN 0 10 10"], ["viewBox", "0,,10,10"], ["viewBox", "0x0 0 10 10"]]) {
  test("不正寸法 " + key + "=" + value, async () => {
    const root = element(); root.attributes.find(a => a.name === key).value = value;
    await assert.rejects(validateChartSvgBlob(blob(), view(root)));
  });
}
for (const tag of ["script", "foreignObject", "image", "use", "a", "style", "animate", "html"]) test("外部/実行可能要素拒否 " + tag, async () => {
  const root = element(); root.querySelectorAll = () => [element(tag, {})]; await assert.rejects(validateChartSvgBlob(blob(), view(root)));
});
for (const [name, value] of [["onload", "alert(1)"], ["href", "javascript:alert(1)"], ["fill", "url(https://example.com/x)"], ["fill", "currentColor"], ["fill", "var(--ink)"], ["style", "fill:u\\72l(x)"], ["transform", "translate(NaN 0)"], ["d", "M1e309 0"], ["x", "-Infinity"], ["class", "app-style"]]) test("危険/未解決属性拒否 " + name + value, async () => {
  const root = element(); root.querySelectorAll = () => [element("rect", { [name]: value })]; await assert.rejects(validateChartSvgBlob(blob(), view(root)));
});
test("未知CSSプロパティ拒否", async () => { const root = element(); root.attributes.push({ name: "style", value: "filter:blur(2px)" }); root.style = ["filter"]; await assert.rejects(validateChartSvgBlob(blob(), view(root))); });
test("SVG名前空間が必須", async () => { const root = element(); root.namespaceURI = ""; await assert.rejects(validateChartSvgBlob(blob(), view(root))); });
for (const change of ["removed", "redrawn"]) test("フォント待機中の対象変更 " + change, async () => {
  let release, source = {}; const doc = { fonts: { ready: new Promise(resolve => release = resolve) } };
  const card = { isConnected: true, ownerDocument: doc, querySelector: () => source };
  const result = generateChartSvg(card);
  if (change === "removed") card.isConnected = false; else source = {};
  release(); await assert.rejects(result, { code: "target-changed" });
});

const { downloadChartSvg } = require("./chart-png-export.js");
function downloadEnvironment(failure) {
  const events=[], urls=new Set(); let removed=false, hrefRemoved=false;
  const boundary={...view(element()), MessageChannel,
    URL:{createObjectURL(b){assert.equal(b.type,'image/svg+xml;charset=utf-8');if(failure==='url')throw Error('url');urls.add('blob:svg');return 'blob:svg';},revokeObjectURL(url){events.push('revoke');urls.delete(url);}}};
  const anchor={setAttribute(){},remove(){removed=true;},removeAttribute(){hrefRemoved=true;},click(){events.push('click');assert.equal(urls.size,1);if(failure==='click')throw Error('click');}};
  const doc={defaultView:boundary,body:{append(){events.push('append');if(failure==='append')throw Error('append');}},
    createElement(tag){assert.equal(tag,'a');if(failure==='anchor')throw Error('anchor');return anchor;}};
  return {doc,urls,events,anchor,clean:()=>({removed,hrefRemoved})};
}
test("Object URLはクリック後に解放、一時リンクを除去、ファイル名維持",async()=>{
  const e=downloadEnvironment();await downloadChartSvg(blob(),'売上.svg',e.doc);
  assert.deepEqual(e.events,['append','click','revoke']);assert.equal(e.urls.size,0);assert.deepEqual(e.clean(),{removed:true,hrefRemoved:true});assert.equal(e.anchor.download,'売上.svg');
});
for(const failure of ['url','anchor','append','click','target'])test("配送失敗でも後始末: "+failure,async()=>{
  const e=downloadEnvironment(failure);
  await assert.rejects(downloadChartSvg(blob(),'test.svg',e.doc,()=>{if(failure==='target')throw Error('target');}));
  assert.equal(e.urls.size,0);if(!['url','anchor'].includes(failure))assert.deepEqual(e.clean(),{removed:true,hrefRemoved:true});
  if(failure==='target')assert.ok(!e.events.includes('click'));
});
test("検証失敗はObject URL生成前に中止",async()=>{
  const e=downloadEnvironment();await assert.rejects(downloadChartSvg(null,'test.svg',e.doc));assert.deepEqual(e.events,[]);assert.equal(e.urls.size,0);
});
test('同時配送は別タスクで順に開始して双方のURLを解放',async()=>{
  const e=downloadEnvironment();await Promise.all([downloadChartSvg(blob(),'first.svg',e.doc),downloadChartSvg(blob(),'second.svg',e.doc)]);
  assert.deepEqual(e.events,['append','click','revoke','append','click','revoke']);assert.equal(e.urls.size,0);
});

const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('app.js','utf8');
const handler=source.slice(source.indexOf('async function runChartPngFromButton('),source.indexOf('function chartTsvCopyControls('));
function uiCard(id){
  const status={textContent:''},attrs=new Map(),buttons=[];
  const controls={getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),querySelector:()=>status,querySelectorAll:()=>buttons};
  const card={dataset:{chartId:id},isConnected:true};
  for(const type of ['png','copy','svg']){const attrs=new Map(),data=type==='png'?{chartPngIndex:id}:type==='copy'?{chartPngCopyIndex:id}:{chartSvgIndex:id};
    buttons.push({dataset:data,hasAttribute:key=>key===(type==='svg'?'data-chart-svg-index':type==='copy'?'data-chart-png-copy-index':'data-chart-png-index'),
      setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),getAttribute:k=>attrs.get(k),closest:s=>s==='.chart-png-controls'?controls:card});}
  return {status,controls,buttons};
}
for(const operation of [0,1,2])test('PNG保存/コピー/SVGの相互排他と別カード独立: '+operation,async()=>{
  const a=uiCard('0'),b=uiCard('1'),calls=[];let release;
  const pending=new Promise(resolve=>release=resolve), state=Object.freeze({value:'unchanged'});
  const api={saveChartPng:()=>{calls.push('png');return pending;},copyChartPng:()=>{calls.push('copy');return pending;},saveChartSvg:()=>{calls.push('svg');return pending;}};
  const context={window:{MemoNexusChartPngExport:api},editor:state,splitChartBlocks:()=>['0','1'].map(id=>({type:'chart',chart:Object.freeze({id,title:'売上'})}))};
  vm.createContext(context);vm.runInContext(handler,context);
  const first=context.runChartPngFromButton(a.buttons[operation]);for(const button of a.buttons)await context.runChartPngFromButton(button);
  assert.equal(calls.length,1);assert.ok(a.buttons.every(button=>button.getAttribute('aria-disabled')==='true'));assert.equal(b.status.textContent,'');
  const second=context.runChartPngFromButton(b.buttons[2]);assert.equal(calls.length,2);release();await Promise.all([first,second]);
  assert.equal(b.status.textContent,'グラフをSVG画像として保存しました');assert.equal(a.controls.getAttribute('aria-busy'),undefined);assert.equal(state.value,'unchanged');
});
test('SVG失敗を成功通知せずbusyを解除し再試行、PNGへ自動代替しない',async()=>{
  const a=uiCard('0');let fail=true,saves=0;const context={window:{MemoNexusChartPngExport:{saveChartSvg:async()=>{if(fail)throw Error('internal');},saveChartPng:()=>saves++}},editor:Object.freeze({value:'unchanged'}),splitChartBlocks:()=>[{type:'chart',chart:{id:'0',title:'売上'}}]};
  vm.createContext(context);vm.runInContext(handler,context);await context.runChartPngFromButton(a.buttons[2]);
  assert.match(a.status.textContent,/PNG画像として保存/);assert.doesNotMatch(a.status.textContent,/internal|保存しました/);assert.equal(saves,0);assert.equal(a.controls.getAttribute('aria-busy'),undefined);
  fail=false;await context.runChartPngFromButton(a.buttons[2]);assert.equal(a.status.textContent,'グラフをSVG画像として保存しました');
});
