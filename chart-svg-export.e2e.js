"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const { helpers: h } = require("./chart-png-export.e2e.js");
const { chartSvgFilename } = require("./chart-png-export.js");
const { serializeChartBlock } = require("./chart-block-utils.js");
const button = page => page.locator('#preview [data-chart-svg-index]');
const card = page => page.locator('#preview .chart-block');
const success = "グラフをSVG画像として保存しました";
const artifacts = path.join(__dirname, "svg-review", process.env.MEMO_NEXUS_E2E_BROWSER || "chromium");
async function uiSnapshot(page) {
  return page.evaluate(() => ({ x:scrollX,y:scrollY,graph:document.querySelector('#preview .chart-block-scroll').scrollLeft,
    selection:[editor.selectionStart,editor.selectionEnd,editor.selectionDirection],dom:getSelection().toString(),
    tooltip:[...document.querySelectorAll('#preview .chart-data-tooltip')].map(el=>el.textContent),id:currentId,theme:document.documentElement.dataset.theme }));
}
async function exportSvg(page, title, activate, review) {
  await h.idle(page); await button(page).scrollIntoViewIfNeeded();
  const before = await h.snapshot(page), ui = await uiSnapshot(page);
  let downloads = 0; const count = () => downloads++; page.on('download', count);
  const event = page.waitForEvent('download');
  if (activate) await activate(); else await button(page).click();
  const download = await event;
  assert.equal(download.suggestedFilename(), chartSvgFilename(title));
  const file = await download.path(); assert.equal(await download.failure(), null);
  const xml = fs.readFileSync(file, 'utf8');
  await page.waitForFunction(text => document.querySelector('#preview .chart-png-controls [role="status"]').textContent === text, success);
  page.off('download', count); assert.equal(downloads, 1);
  assert.deepEqual(await h.snapshot(page), before); assert.deepEqual(await uiSnapshot(page), ui);
  assert.equal(await button(page).getAttribute('aria-busy'), null);
  assert.equal(await page.locator('a[download][href^="blob:"]').count(), 0);
  assert.equal(await page.evaluate(() => window.pngUrls.size), 0);
  const checked = await page.evaluate(async xml => {
    const api = window.MemoNexusChartPngExport, host = document.querySelector('#preview .chart-block');
    await api.validateChartSvgBlob(new Blob([xml], {type:'image/svg+xml'}), window);
    const root = new DOMParser().parseFromString(xml,'image/svg+xml').documentElement;
    const plan = api.composeChartPng(api.captureChartPng(host));
    // The entire composed plot, title, legend and notice are shared verbatim.
    const tree = el => ({name:el.localName, attributes:[...el.attributes].filter(a=>a.name!=='xmlns').map(a=>[a.name,a.value]).sort(),
      children:[...el.childNodes].map(node=>node.nodeType===3?node.textContent:tree(node))});
    const expected = [...plan.svg.children].map(tree);
    const actual = [...root.children].slice(1).map(tree);
    return {same:JSON.stringify(actual)===JSON.stringify(expected),width:+root.getAttribute('width'),height:+root.getAttribute('height'),
      dimensions:plan.dimensions,namespace:root.getAttribute('xmlns'),text:root.textContent,
      forbidden:root.querySelectorAll('button,table,foreignObject,script,image,use,a,style,[class],[href],[tabindex],[role]').length};
  }, xml);
  assert.equal(checked.same,true); assert.equal(checked.forbidden,0);
  assert.equal(checked.namespace,'http://www.w3.org/2000/svg');
  assert.equal(checked.width,checked.dimensions.width); assert.equal(checked.height,checked.dimensions.height);
  assert.doesNotMatch(xml,/currentColor|var\(|javascript:|NaN|Infinity/);
  assert.match(checked.text,/売上|グラフ|旧項目/);
  if (review) {
    fs.mkdirSync(artifacts,{recursive:true}); const saved=path.join(artifacts,review+'.svg');fs.copyFileSync(file,saved);
    const standalone=await page.context().browser().newPage(), requests=[];
    standalone.on('request',request=>{if(!request.url().startsWith('file:'))requests.push(request.url());});
    try {
      await standalone.setViewportSize({width:Math.max(1100,checked.width),height:Math.max(900,checked.height)}); await standalone.goto(pathToFileURL(saved).href);
      assert.equal(await standalone.locator('svg').first().getAttribute('xmlns'),'http://www.w3.org/2000/svg');
      assert.ok(await standalone.locator('svg text').count()>0); assert.deepEqual(requests,[]);
      // Standalone XML has no HTML body for Playwright's fullPage layout query.
      // A viewport covering the SVG dimensions captures every part without that query.
      await standalone.screenshot({path:path.join(artifacts,review+'.png')});
    } finally {await standalone.close();}
  }
  return xml;
}
async function xmlValidation(page) {
  const result = await page.evaluate(async()=>{
    const wrap = content=>'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">'+content+'</svg>';
    const invalid = ['<svg', '<html/>', '<svg width="100" height="100" viewBox="0 0 100 100"/>',
      wrap('<script>alert(1)</script>'),wrap('<rect onload="alert(1)"/>'),wrap('<a href="javascript:alert(1)"/>'),
      wrap('<image href="https://example.com/x.png"/>'),wrap('<foreignObject/>'),wrap('<style>@import "https://example.com";</style>'),
      wrap('<path d="M NaN 0"/>'),wrap('<rect width="Infinity"/>'),wrap('<g transform="translate(-Infinity 0)"/>'),wrap('<path d="M1e309 0"/>'),
      wrap('<rect fill="var(--ink)"/>'),wrap('<rect fill="currentColor"/>'),wrap('<rect style="fill:url(https://example.com/a)"/>'),
      '<?xml-stylesheet href="https://example.com/x.css"?>'+wrap(''), '<!DOCTYPE svg>'+wrap(''),
      wrap('').replace('width="100"','width="0"'),wrap('').replace('0 0 100 100','0 0 -1 100')];
    const rejected=[];for(const xml of invalid){try{await MemoNexusChartPngExport.validateChartSvgBlob(new Blob([xml],{type:'image/svg+xml'}),window);rejected.push(false);}catch{rejected.push(true);}}
    return rejected;
  }); assert.ok(result.every(Boolean),JSON.stringify(result));
}
async function failures(page) {
  for(const failure of ['canvas','serialize','blob','empty','mime','read','xml','root','dimension','unsafe','url','anchor','click']) {
    await h.load(page,h.fixture());
    await page.evaluate(failure=>{
      window.svgRestore=[];const swap=(o,k,v)=>{const old=o[k];o[k]=v;window.svgRestore.push(()=>o[k]=old);};
      if(failure==='canvas')swap(HTMLCanvasElement.prototype,'getContext',()=>null);
      if(['serialize','xml','root','dimension','unsafe'].includes(failure)){
        const native=XMLSerializer.prototype.serializeToString;
        swap(XMLSerializer.prototype,'serializeToString',function(node){if(failure==='serialize')throw Error('serialize');if(failure==='xml')return '<svg';if(failure==='root')return '<html/>';
          const xml=native.call(this,node);return failure==='dimension'?xml.replace(/width="[^"]+"/,'width="NaN"'):xml.replace('</svg>','<script/> </svg>');});
      }
      if(['blob','empty','mime'].includes(failure)){const Native=Blob;swap(window,'Blob',function(parts,options){if(failure==='blob')throw Error('blob');return new Native(failure==='empty'?[]:parts,{type:failure==='mime'?'text/plain':options.type});});}
      if(failure==='read')swap(Blob.prototype,'arrayBuffer',()=>Promise.reject(Error('read')));
      if(failure==='url')swap(URL,'createObjectURL',()=>{throw Error('url');});
      if(failure==='anchor'){const native=document.createElement.bind(document);swap(document,'createElement',tag=>{if(tag==='a')throw Error('anchor');return native(tag);});}
      if(failure==='click')swap(HTMLAnchorElement.prototype,'click',()=>{throw Error('click');});
    },failure);
    const before=await h.snapshot(page);let downloads=0;const count=()=>downloads++;page.on('download',count);
    await button(page).click();await page.waitForFunction(()=>document.querySelector('#preview .chart-png-controls [role="status"]').textContent.includes('SVG画像を保存できませんでした'));
    assert.equal(downloads,0);assert.equal(await button(page).getAttribute('aria-busy'),null);
    assert.equal(await page.evaluate(()=>window.pngUrls.size),0);assert.equal(await page.locator('a[download][href^="blob:"]').count(),0);
    assert.deepEqual(await h.snapshot(page),before);await page.evaluate(()=>window.svgRestore.reverse().forEach(fn=>fn()));page.off('download',count);
    await exportSvg(page,'月別売上');
  }
}
async function concurrency(page) {
  const first=h.fixture(),second=h.fixture();second.id='second';second.title='別グラフ';
  await page.locator('#editor').fill(serializeChartBlock(first)+'\n\n'+serializeChartBlock(second));await h.idle(page);
  await page.waitForFunction(()=>document.querySelectorAll('#preview [data-chart-svg-index]').length===2);
  await page.evaluate(()=>{window.svgReader=Blob.prototype.arrayBuffer;window.svgReleases=[];Blob.prototype.arrayBuffer=function(){return new Promise(resolve=>window.svgReleases.push(()=>resolve(window.svgReader.call(this))));};});
  let downloads=0;const count=()=>downloads++;page.on('download',count);
  await button(page).first().click();await page.waitForFunction(()=>window.svgReleases.length===1);
  await card(page).first().locator('.chart-png-controls button').evaluateAll(buttons=>buttons.forEach(button=>button.click()));
  assert.equal(await page.evaluate(()=>window.svgReleases.length),1);assert.equal(downloads,0);
  assert.equal(await button(page).nth(1).getAttribute('aria-disabled'),null);
  assert.equal(await card(page).nth(1).locator('.chart-png-controls [role="status"]').textContent(),'');
  await button(page).nth(1).click();await page.waitForFunction(()=>window.svgReleases.length===2);
  const events=[page.waitForEvent('download',d=>d.suggestedFilename()===chartSvgFilename(first.title)),page.waitForEvent('download',d=>d.suggestedFilename()===chartSvgFilename(second.title))];
  await page.evaluate(()=>{Blob.prototype.arrayBuffer=window.svgReader;window.svgReleases.forEach(fn=>fn());});await Promise.all(events);
  await page.waitForFunction(()=>[...document.querySelectorAll('#preview .chart-png-controls')].every(el=>!el.hasAttribute('aria-busy')));
  assert.equal(downloads,2);page.off('download',count);
  for(const el of await card(page).all()) {assert.equal(await el.locator('[aria-live]').count(),1);assert.equal(await el.locator('.chart-png-controls [role="status"]').textContent(),success);}
  for(const phase of ['fonts','validation','delivery']) for(const change of ['removed','redrawn']) {
    await h.load(page,h.fixture());
    await page.evaluate(phase=>{
      window.svgOldCard=document.querySelector('#preview .chart-block');
      if(phase==='fonts'){window.svgFonts=Object.getOwnPropertyDescriptor(document.fonts,'ready');Object.defineProperty(document.fonts,'ready',{configurable:true,value:new Promise(resolve=>window.svgRelease=resolve)});}
      else {window.svgNativeRead=Blob.prototype.arrayBuffer;let calls=0;Blob.prototype.arrayBuffer=function(){calls++;if(calls===(phase==='validation'?1:2))return new Promise(resolve=>window.svgRelease=()=>resolve(window.svgNativeRead.call(this)));return window.svgNativeRead.call(this);};}
    },phase);
    let actual=0;const counter=()=>actual++;page.on('download',counter);await button(page).click();await page.waitForFunction(()=>typeof window.svgRelease==='function');
    await page.evaluate(({change,phase})=>{const host=window.svgOldCard;if(change==='removed')host.remove();else host.querySelector('svg').replaceWith(host.querySelector('svg').cloneNode(true));
      if(phase==='fonts'){if(window.svgFonts)Object.defineProperty(document.fonts,'ready',window.svgFonts);else delete document.fonts.ready;}else Blob.prototype.arrayBuffer=window.svgNativeRead;
      window.svgRelease();delete window.svgRelease;
    },{change,phase});
    await page.waitForFunction(()=>!window.svgOldCard.querySelector('.chart-png-controls').hasAttribute('aria-busy'));
    assert.notEqual(await page.evaluate(()=>window.svgOldCard.querySelector('.chart-png-controls [role="status"]').textContent),success);assert.equal(actual,0);page.off('download',counter);
    assert.equal(await page.evaluate(()=>window.pngUrls.size),0);
  }
}
async function verifyChartSvg(page) {
  await h.viewerSetup(page);await h.observe(page);await xmlValidation(page);
  const configs=[...['vertical','horizontal'].flatMap(barOrientation=>['grouped','stacked','percent-stacked'].map(barMode=>({barOrientation,barMode}))),
    {chartType:'line'},{chartType:'pie'},{chartType:'combo',comboAxisMode:'single'},{chartType:'combo',comboAxisMode:'dual'}];
  let count=0;
  for(const config of configs)for(const values of [[30,10,0,20],[-30,-10,0,-20],[30,-10,0,20],[0,0,0,0]]) {
    if(config.chartType==='pie'&&values.some(v=>v<0))continue;
    const chart=h.fixture(config,values);await h.load(page,chart);assert.equal(await page.locator('.chart-block-editor [data-chart-svg-index]').count(),0);
    await h.composition(page,chart);await exportSvg(page,chart.title);count++;
  }
  for(const values of [[1.2345,-0.001,1e20,-1e-20],[Number.MIN_VALUE,-Number.MIN_VALUE,0,Number.MIN_VALUE],[Number.MAX_VALUE,-Number.MAX_VALUE,0,1]]){
    const chart=h.fixture({chartType:'combo',comboAxisMode:'dual'},values);await h.load(page,chart);await exportSvg(page,chart.title);count++;
  }
  for(const showLegend of [true,false])for(const showDataTable of [true,false]){
    const chart=h.fixture({chartType:'line',showLegend,showDataTable,showValues:false,showPoints:false});await h.load(page,chart);await exportSvg(page,chart.title);
  }
  const named=h.fixture();for(const title of ['', '日本語<>:"/\\|?*.PNG']){named.title=title;await h.load(page,named);await exportSvg(page,title);}
  for(const key of ['Enter','Space']){await button(page).focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');assert.equal(await button(page).evaluate(el=>el===document.activeElement),true);await exportSvg(page,named.title,()=>page.keyboard.press(key));assert.equal(await button(page).evaluate(el=>el===document.activeElement),true);}
  const wide=h.fixture({},Array.from({length:50},(_,i)=>i%3?i:-i));await h.load(page,wide);const xml=await exportSvg(page,wide.title,undefined,'wide');
  await card(page).locator('[data-chart-datum]').first().focus();await page.keyboard.press('End');await page.waitForFunction(()=>document.querySelector('#preview .chart-block-scroll').scrollLeft>0);
  assert.equal(await exportSvg(page,wide.title),xml);
  const long=h.fixture({chartType:'combo',comboAxisMode:'dual',showDataTable:true});long.title='月別売上 長い日本語 <画像> & 確認 '.repeat(8);long.items.forEach(i=>i.label='長い日本語項目名'.repeat(8));
  await h.load(page,long);
  for(const theme of ['light','dark']){
    await h.viewer(page,1100);await page.locator('#settingsBtn').click();await page.locator('#themeSelect').selectOption(theme);await page.locator('#closeSettingsBtn').click();
    for(const width of [320,375,390,430,1100]){
      await h.viewer(page,width);await exportSvg(page,long.title,undefined,[390,1100].includes(width)?theme+'-'+width:null);
      const rects=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,body:document.body.scrollWidth,buttons:[...document.querySelectorAll('#preview .chart-png-controls button')].map(el=>el.getBoundingClientRect().toJSON())}));
      assert.ok(rects.doc<=width&&rects.body<=width,JSON.stringify(rects));for(const r of rects.buttons)assert.ok(r.left>=0&&r.right<=width+1);
      for(let i=0;i<rects.buttons.length;i++)for(let j=i+1;j<rects.buttons.length;j++){const a=rects.buttons[i],b=rects.buttons[j];assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);}
    }
  }
  const pie=h.fixture({chartType:'pie'},[30,10,0,20]);await h.load(page,pie);await exportSvg(page,pie.title,undefined,'pie');
  await failures(page);await concurrency(page);
  await h.load(page,h.fixture());await page.evaluate(()=>editor.setSelectionRange(3,17));await exportSvg(page,'月別売上');
  await card(page).locator('figcaption').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);});await exportSvg(page,'月別売上');
  const old=(await h.snapshot(page)).body;
  await page.locator('.chart-block-editor [data-chart-action="paste-table"]').click();await page.getByRole('dialog').locator('textarea').fill('項目\t売上\t利益\n新項目\t12\t6');await page.getByRole('button',{name:'貼り付け内容を反映',exact:true}).click();await exportSvg(page,'月別売上');assert.equal((await h.snapshot(page)).body,old);
  await page.locator('.chart-block-editor [data-chart-action="confirm"]').click();await h.idle(page);await exportSvg(page,'月別売上');await page.locator('#undoBtn').click();await h.idle(page);assert.equal((await h.snapshot(page)).body,old);await exportSvg(page,'月別売上');await page.locator('#redoBtn').click();await h.idle(page);await exportSvg(page,'月別売上');
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});await h.idle(page);await h.observe(page);await exportSvg(page,'月別売上');
  const legacy='<!-- memo-nexus:chart-block:'+Buffer.from(JSON.stringify({id:'legacy',title:'旧グラフ',items:[{id:'old',label:'旧項目',value:3}]})).toString('hex')+' -->';await page.locator('#editor').fill(legacy);await h.idle(page);await exportSvg(page,'旧グラフ');assert.equal(await page.locator('#editor').inputValue(),legacy);
  console.log('SVG matrix passed:',count,'chart/value cases, themes, five widths, standalone files, failures, concurrency and persistence');
}
async function verifyChartSvgTouch(browser,url){
  const context=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:r.request().url().endsWith('.css')?'text/css':'text/javascript',body:''}));await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});await h.viewerSetup(page);await h.observe(page);await h.load(page,h.fixture());await h.viewer(page,390);await card(page).locator('[data-chart-datum]').first().tap();assert.equal(await card(page).locator('.chart-data-tooltip').count(),1);await exportSvg(page,'月別売上',()=>button(page).tap());assert.deepEqual(errors,[]);console.log('SVG touch passed (390px emulation)');}finally{await context.close();}
}
module.exports={verifyChartSvg,verifyChartSvgTouch};

if(require.main===module)(async()=>{
  const http=require('node:http'),playwright=require('playwright');
  const server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(__dirname,name==='/'?'index.html':'.'+decodeURIComponent(name));
    if(!file.startsWith(__dirname+path.sep))return res.writeHead(403).end();
    fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/javascript');res.end(data);});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await playwright[process.env.MEMO_NEXUS_E2E_BROWSER||'chromium'].launch({headless:true});
    const page=await browser.newPage({viewport:{width:1100,height:820}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:r.request().url().endsWith('.css')?'text/css':'text/javascript',body:''}));
    const url=`http://127.0.0.1:${server.address().port}/`;
    await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});
    await verifyChartSvg(page);await verifyChartSvgTouch(browser,url);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
