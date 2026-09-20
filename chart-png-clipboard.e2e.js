"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {serializeChartBlock}=require("./chart-block-utils.js");
const {helpers:h}=require("./chart-png-export.e2e.js");
const button=page=>page.locator('#preview [data-chart-png-copy-index]');
const card=page=>page.locator('#preview .chart-block');
const success="グラフ画像をクリップボードへコピーしました";
async function boundary(page){
  const capabilities=await page.evaluate(()=>({secure:isSecureContext,item:typeof ClipboardItem,write:typeof navigator.clipboard?.write,png:typeof ClipboardItem==='function'&&typeof ClipboardItem.supports==='function'?ClipboardItem.supports('image/png'):null}));
  assert.equal(capabilities.secure,true);
  // Keep the real browser ClipboardItem: only system clipboard I/O is replaced.
  assert.equal(capabilities.item,'function','this test requires native ClipboardItem; unsupported engines must be reported separately');
  console.log('PNG clipboard native capabilities:',JSON.stringify(capabilities),'(write/getType boundary verification)');
  await page.evaluate(()=>{
    const Native=ClipboardItem;window.clipRestoreItem=Native;window.clipRestoreNavigator=Object.getOwnPropertyDescriptor(navigator,'clipboard');
    window.clipCalls=[];window.clipEvents=[];window.clipBytes=[];
    window.ClipboardItem=new Proxy(Native,{construct(target,args){window.clipEvents.push('item');window.clipPromise=args[0]['image/png'] instanceof Promise;return new target(...args);}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async items=>{
      const entry={count:items.length,types:[...items[0].types],xmlBefore:window.pngXml.length,status:document.querySelector('#preview .chart-png-controls [role="status"]')?.textContent};
      window.clipCalls.push(entry);window.clipEvents.push('write');
      const blob=await items[0].getType('image/png');window.clipEvents.push('blob');entry.mime=blob.type;window.clipBytes=[...new Uint8Array(await blob.arrayBuffer())];
      if(window.clipHold)await new Promise(resolve=>window.clipRelease=resolve);
      window.clipEvents.push('complete');
    }}});
    window.clipBoundaryWrite=navigator.clipboard.write;
    const serialize=XMLSerializer.prototype.serializeToString;window.clipRestoreSerialize=serialize;
    XMLSerializer.prototype.serializeToString=function(node){if(node.localName==='svg')window.clipEvents.push('svg');return serialize.call(this,node);};
  });
}
async function restore(page){await page.evaluate(()=>{window.ClipboardItem=window.clipRestoreItem;const descriptor=window.clipRestoreNavigator;if(descriptor)Object.defineProperty(navigator,'clipboard',descriptor);else delete navigator.clipboard;XMLSerializer.prototype.serializeToString=window.clipRestoreSerialize;});}
async function copy(page,activate){
  await h.idle(page);const before=await h.snapshot(page),scroll=await card(page).locator('.chart-block-scroll').evaluate(el=>el.scrollLeft),tip=await card(page).locator('.chart-data-tooltip').allTextContents();
  await page.evaluate(()=>{window.clipEvents=[];window.clipBytes=[];});
  if(activate)await activate();else await button(page).click();
  await page.waitForFunction(text=>document.querySelector('#preview .chart-png-controls [role="status"]')?.textContent===text,success);
  const data=await page.evaluate(()=>({bytes:window.clipBytes,events:window.clipEvents,promise:window.clipPromise,call:window.clipCalls.at(-1),urls:window.pngUrls.size}));
  assert.equal(data.promise,true);assert.deepEqual(data.events,['item','write','svg','blob','complete']);assert.equal(data.call.count,1);assert.deepEqual(data.call.types,['image/png']);assert.equal(data.call.mime,'image/png');assert.notEqual(data.call.status,success);
  assert.deepEqual(await h.snapshot(page),before);assert.equal(await card(page).locator('.chart-block-scroll').evaluate(el=>el.scrollLeft),scroll);assert.deepEqual(await card(page).locator('.chart-data-tooltip').allTextContents(),tip);
  assert.equal(await button(page).getAttribute('aria-busy'),null);assert.equal(data.urls,0);
  const bytes=Buffer.from(data.bytes);return {bytes,pixels:await h.pngPixels(page,bytes)};
}
async function verifyChartPngClipboard(page){
  await h.viewerSetup(page);await h.observe(page);await boundary(page);
  let downloads=0;const onDownload=()=>downloads++;page.on('download',onDownload);
  try{
    for(const config of [{},{barOrientation:'horizontal'},{chartType:'line'},{chartType:'pie'},{barMode:'percent-stacked'},{chartType:'combo',comboAxisMode:'dual'}]){
      const chart=h.fixture({...config,showDataTable:true},config.chartType==='pie'?[30,10,0,20]:[30,-10,0,20]);await h.load(page,chart);
      assert.equal(await button(page).getAttribute('type'),'button');assert.equal(await page.locator('.chart-block-editor [data-chart-png-copy-index]').count(),0);
      await h.composition(page,chart);const copied=await copy(page);assert.equal(downloads,0);
      page.off('download',onDownload);const saved=await h.exportPng(page,chart.title);page.on('download',onDownload);assert.deepEqual(copied.bytes,saved.bytes,'copy and save use identical pixels, labels, dimensions and theme');
    }
    await button(page).focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');assert.equal(await button(page).evaluate(el=>el===document.activeElement),true);
    for(const key of ['Enter','Space']){await copy(page,()=>button(page).press(key));assert.equal(await button(page).evaluate(el=>el===document.activeElement),true);}
    const chart=h.fixture({chartType:'combo',comboAxisMode:'dual'},Array.from({length:30},(_,i)=>i%3?i:-i));await h.load(page,chart);
    const first=await copy(page);await card(page).locator('.chart-block-scroll').evaluate(el=>el.scrollLeft=el.scrollWidth);
    assert.deepEqual((await copy(page)).bytes,first.bytes);
    await card(page).locator('[data-chart-datum]').first().focus();await card(page).locator('[data-chart-datum]').first().press('ArrowRight');assert.equal(await card(page).locator('.chart-data-tooltip').count(),1);await copy(page);
    const input=page.locator('.chart-block-editor [data-chart-field="title"]');await input.focus();await input.press('Home');await input.press('Shift+ArrowRight');const selection=await input.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]);await copy(page);assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]),selection);assert.equal(await input.evaluate(el=>el===document.activeElement),true);
    const caption=card(page).locator('figcaption');await caption.scrollIntoViewIfNeeded();const rect=await caption.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getBoundingClientRect().toJSON();});await page.mouse.dblclick(rect.x+8,rect.y+rect.height/2);const selected=await page.evaluate(()=>getSelection().toString());assert.ok(selected.length);await copy(page);assert.equal(await page.evaluate(()=>getSelection().toString()),selected);
    // Page/panel scrolling is measured after bringing the button into view.
    await button(page).scrollIntoViewIfNeeded();const scrollState=()=>page.evaluate(()=>[scrollX,scrollY,...['previewCard','preview','mainPanel'].flatMap(id=>{const el=document.getElementById(id);return el?[el.scrollLeft,el.scrollTop]:[];})]);const scrollBefore=await scrollState();await copy(page);assert.deepEqual(await scrollState(),scrollBefore);
    await h.load(page,h.fixture({chartType:'combo',comboAxisMode:'dual'}));
    const backgrounds=[];
    for(const theme of ['light','dark']){
      await h.viewer(page,1100);await page.locator('#settingsBtn').click();await page.locator('#themeSelect').selectOption(theme);await page.locator('#closeSettingsBtn').click();let reference;
      for(const width of [1100,320,375,390,430]){
        await h.viewer(page,width);const result=await copy(page);if(!reference){reference=result.bytes;backgrounds.push(result.pixels.background);}else assert.deepEqual(result.bytes,reference,'full PNG independent of viewport');
        const layout=await card(page).locator('.chart-png-controls').evaluate(el=>({width:innerWidth,overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),buttons:[...el.querySelectorAll('button')].map(b=>b.getBoundingClientRect().toJSON())}));assert.ok(layout.overflow<=width+1);for(const r of layout.buttons)assert.ok(r.left>=-1&&r.right<=width+1);const [a,b]=layout.buttons;assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);
      }
    }
    assert.notDeepEqual(backgrounds[0],backgrounds[1]);await h.viewer(page,1100);
    await failures(page);await busy(page);await compatibility(page);
    assert.equal(downloads,2,'only the two explicitly requested save/recovery downloads; no automatic download');
    console.log('PNG clipboard passed: native ClipboardItem Promise/getType, order, 6 chart types vs downloads, keyboard, 10 layouts, state/selection/scroll, failure/retry and card concurrency');
  }finally{page.off('download',onDownload);await restore(page);}
}
async function failures(page){
  await h.load(page,h.fixture());
  for(const failure of ['api','write-missing','item','unsupported','insecure','constructor','write-sync','write-async','NotAllowedError','SecurityError','DataError','AbortError','fonts','load','decode','canvas','toBlob','null','empty','mime','signature']){
    console.log('PNG clipboard failure case:',failure);
    await page.evaluate(failure=>{
      window.clipFailureRestore=[];const swap=(o,k,v)=>{const d=Object.getOwnPropertyDescriptor(o,k);Object.defineProperty(o,k,{configurable:true,value:v});window.clipFailureRestore.push(()=>{if(d)Object.defineProperty(o,k,d);else delete o[k];});};
      if(failure==='api')swap(navigator,'clipboard',undefined);
      if(failure==='write-missing')swap(navigator,'clipboard',{});
      if(failure==='item')swap(window,'ClipboardItem',undefined);
      if(failure==='unsupported')swap(ClipboardItem,'supports',()=>false);
      if(failure==='insecure')swap(window,'isSecureContext',false);
      if(failure==='constructor')swap(window,'ClipboardItem',class{constructor(){throw new Error('constructor');}});
      if(failure==='write-sync')swap(navigator.clipboard,'write',()=>{throw new Error('sync');});
      if(['write-async','NotAllowedError','SecurityError','DataError','AbortError'].includes(failure))swap(navigator.clipboard,'write',()=>Promise.reject(new DOMException('failure',failure==='write-async'?'UnknownError':failure)));
      if(failure==='fonts')swap(document.fonts,'ready',{then(resolve,reject){reject(new Error('fonts'));}});
      if(failure==='load'){const Native=Image;swap(window,'Image',function(){const image=new Native();Object.defineProperty(image,'src',{set(){queueMicrotask(()=>image.onerror?.());}});return image;});}
      if(failure==='decode')swap(HTMLImageElement.prototype,'decode',()=>Promise.reject(new Error('decode')));
      if(failure==='canvas')swap(HTMLCanvasElement.prototype,'getContext',()=>null);
      if(['toBlob','null','empty','mime','signature'].includes(failure))swap(HTMLCanvasElement.prototype,'toBlob',callback=>{if(failure==='toBlob')throw new Error('toBlob');callback(failure==='null'?null:new Blob([failure==='empty'?'':'x'.repeat(50)],{type:failure==='mime'?'text/plain':'image/png'}));});
    },failure);
    const before=await h.snapshot(page),counts=await page.evaluate(()=>[window.clipCalls.length,window.pngXml.length]);await button(page).focus();await button(page).press('Enter');
    await page.waitForFunction(()=>document.querySelector('#preview .chart-png-controls [role="status"]')?.textContent.includes('『PNG画像として保存』'));
    assert.equal(await button(page).getAttribute('aria-busy'),null);assert.equal(await button(page).evaluate(el=>el===document.activeElement),true);assert.deepEqual(await h.snapshot(page),before);assert.equal(await page.evaluate(()=>window.pngUrls.size),0);
    if(['api','write-missing','item','unsupported','insecure'].includes(failure))assert.deepEqual(await page.evaluate(()=>[window.clipCalls.length,window.pngXml.length]),counts);
    await page.evaluate(()=>window.clipFailureRestore.reverse().forEach(fn=>fn()));await copy(page);
  }
  // Lack of optional supports() must not block otherwise working APIs.
  await page.evaluate(()=>{window.clipSupportsDescriptor=Object.getOwnPropertyDescriptor(ClipboardItem,'supports');Object.defineProperty(ClipboardItem,'supports',{configurable:true,value:undefined});});
  await copy(page);
  await page.evaluate(()=>{if(window.clipSupportsDescriptor)Object.defineProperty(ClipboardItem,'supports',window.clipSupportsDescriptor);else delete ClipboardItem.supports;});
  // Copy never needs a reader or download link, even with the real PNG pipeline.
  await page.evaluate(()=>{window.clipNativeReader=FileReader;window.clipNativeAnchor=HTMLAnchorElement.prototype.click;window.FileReader=class{constructor(){throw new Error('unexpected FileReader');}};HTMLAnchorElement.prototype.click=()=>{throw new Error('unexpected download');};});
  await copy(page);
  await page.evaluate(()=>{window.FileReader=window.clipNativeReader;HTMLAnchorElement.prototype.click=window.clipNativeAnchor;});
  // After rejection the existing save remains usable (observed separately).
  const saved=page.waitForEvent('download');await page.locator('#preview [data-chart-png-index]').click();await saved;await page.waitForFunction(()=>!document.querySelector('#preview [data-chart-png-index]').hasAttribute('aria-busy'));
}
async function busy(page){
  await h.load(page,h.fixture());await page.evaluate(()=>window.clipHold=true);const before=await h.snapshot(page),calls=await page.evaluate(()=>window.clipCalls.length);
  await button(page).click();await page.waitForFunction(()=>typeof window.clipRelease==='function');assert.notEqual(await card(page).locator('.chart-png-controls [role="status"]').textContent(),success);
  await button(page).evaluate(el=>{el.click();el.click();el.parentElement.querySelector('[data-chart-png-index]').click();});assert.equal(await page.evaluate(()=>window.clipCalls.length),calls+1);assert.equal(await button(page).getAttribute('aria-busy'),'true');
  await page.evaluate(()=>{window.clipHold=false;window.clipRelease();delete window.clipRelease;});await page.waitForFunction(text=>document.querySelector('#preview .chart-png-controls [role="status"]').textContent===text,success);assert.deepEqual(await h.snapshot(page),before);
  // A pending download also blocks copying in the same card.
  await page.evaluate(()=>{window.clipNativeToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(cb,type){window.clipNativeToBlob.call(this,blob=>window.clipBlobRelease=()=>cb(blob),type);};});
  const event=page.waitForEvent('download');await page.locator('#preview [data-chart-png-index]').click();await page.waitForFunction(()=>typeof window.clipBlobRelease==='function');await button(page).evaluate(el=>el.click());assert.equal(await page.evaluate(()=>window.clipCalls.length),calls+1);await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=window.clipNativeToBlob;window.clipBlobRelease();delete window.clipBlobRelease;});await event;await page.waitForFunction(()=>!document.querySelector('#preview .chart-png-controls').hasAttribute('aria-busy'));
  // Two cards have independent operation state and one live region per PNG group.
  const first=h.fixture(),second=h.fixture();second.id='png-second';second.title='別グラフ';await page.locator('#editor').fill(serializeChartBlock(first)+'\n\n'+serializeChartBlock(second));await h.idle(page);await page.waitForFunction(()=>document.querySelectorAll('#preview [data-chart-png-copy-index]').length===2);
  await page.evaluate(()=>window.clipHold=true);await button(page).nth(0).click();await page.waitForFunction(()=>typeof window.clipRelease==='function');assert.equal(await button(page).nth(1).getAttribute('aria-disabled'),null);assert.equal(await card(page).nth(1).locator('.chart-png-controls [role="status"]').textContent(),'');await page.evaluate(()=>window.clipHold=false);await button(page).nth(1).click();await page.waitForFunction(text=>document.querySelectorAll('#preview .chart-png-controls [role="status"]')[1].textContent===text,success);assert.equal(await button(page).nth(0).getAttribute('aria-busy'),'true');await page.evaluate(()=>{window.clipRelease();delete window.clipRelease;});await page.waitForFunction(()=>!document.querySelector('#preview .chart-png-controls').hasAttribute('aria-busy'));
  for(const group of await page.locator('#preview .chart-png-controls').all())assert.equal(await group.locator('[aria-live]').count(),1);
  // Changing the target while generation is pending rejects its PNG promise.
  await h.load(page,h.fixture());await page.evaluate(()=>{window.clipFontsDescriptor=Object.getOwnPropertyDescriptor(document.fonts,'ready');Object.defineProperty(document.fonts,'ready',{configurable:true,value:new Promise(resolve=>window.clipFontsRelease=resolve)});window.clipOldCard=document.querySelector('#preview .chart-block');});
  await button(page).click();await page.evaluate(()=>{window.clipOldCard.querySelector('.chart-block-scroll > svg').replaceWith(window.clipOldCard.querySelector('.chart-block-scroll > svg').cloneNode(true));window.clipFontsRelease();});await page.waitForFunction(()=>window.clipOldCard.querySelector('[role="status"]').textContent.includes('対象のグラフが変更'));
  await page.evaluate(()=>{if(window.clipFontsDescriptor)Object.defineProperty(document.fonts,'ready',window.clipFontsDescriptor);else delete document.fonts.ready;});await copy(page);
}
async function compatibility(page){
  const chart=h.fixture();await h.load(page,chart);const old=(await h.snapshot(page)).body;
  await page.locator('.chart-block-editor [data-chart-action="paste-table"]').click();await page.getByRole('dialog').locator('textarea').fill('項目\t売上\t利益\n新項目\t12\t6');await page.getByRole('button',{name:'貼り付け内容を反映',exact:true}).click();await copy(page);assert.equal((await h.snapshot(page)).body,old);assert.equal(await page.locator('.chart-block-editor [data-chart-png-copy-index]').count(),0);
  await page.locator('.chart-block-editor [data-chart-action="confirm"]').click();await h.idle(page);await copy(page);await page.locator('#undoBtn').click();await h.idle(page);assert.equal((await h.snapshot(page)).body,old);await copy(page);await page.locator('#redoBtn').click();await h.idle(page);assert.notEqual((await h.snapshot(page)).body,old);
}
async function verifyChartPngClipboardTouch(browser,url){
  const context=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:r.request().url().endsWith('.css')?'text/css':'text/javascript',body:''}));await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});await h.viewerSetup(page);await h.observe(page);await boundary(page);await h.load(page,h.fixture());await h.viewer(page,390);await card(page).locator('[data-chart-datum]').first().tap();assert.equal(await card(page).locator('.chart-data-tooltip').count(),1);await copy(page,()=>button(page).tap());await restore(page);assert.deepEqual(errors,[]);console.log('PNG clipboard touch passed (390px emulation, native ClipboardItem boundary)');}finally{await context.close();}
}

async function verifyNativeClipboard(browser,url){
  if ((process.env.MEMO_NEXUS_E2E_BROWSER||'chromium') !== 'chromium') return;
  const context=await browser.newContext({viewport:{width:1100,height:1000}});
  try {
    try { await context.grantPermissions(['clipboard-read','clipboard-write']); }
    catch(error){console.log('Native clipboard permissions unavailable:',error.message);return;}
    const page=await context.newPage();await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:r.request().url().endsWith('.css')?'text/css':'text/javascript',body:''}));
    await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});await h.viewerSetup(page);await h.load(page,h.fixture());
    const before=await h.snapshot(page);await button(page).click();await page.waitForFunction(()=>!document.querySelector('#preview .chart-png-controls').hasAttribute('aria-busy'));
    const message=await card(page).locator('.chart-png-controls [role="status"]').textContent();
    if(message!==success){assert.match(message,/PNG画像として保存/);console.log('Native clipboard write unavailable:',message);return;}
    let result;
    try{result=await page.evaluate(async()=>{const items=await navigator.clipboard.read(),item=items.find(item=>item.types.includes('image/png'));if(!item)return null;const blob=await item.getType('image/png');return {type:blob.type,bytes:[...new Uint8Array(await blob.arrayBuffer())]};});}
    catch(error){console.log('Native clipboard write succeeded; read unavailable:',error.message);return;}
    assert.ok(result,'native read returns PNG');assert.equal(result.type,'image/png');await h.pngPixels(page,Buffer.from(result.bytes));assert.deepEqual(await h.snapshot(page),before);
    console.log('Native Chromium clipboard write/read passed (headless test environment; not iPhone or manual app paste)');
  } finally {await context.close();}
}

module.exports={verifyChartPngClipboard,verifyChartPngClipboardTouch,verifyNativeClipboard};

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
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){errors.push(m.text()+' '+JSON.stringify(m.location()));console.error('Browser console error:',m.text(),m.location());}});
    await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:r.request().url().endsWith('.css')?'text/css':'text/javascript',body:''}));
    const url=`http://127.0.0.1:${server.address().port}/`;
    await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});
    await verifyChartPngClipboard(page);await verifyChartPngClipboardTouch(browser,url);await verifyNativeClipboard(browser,url);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
