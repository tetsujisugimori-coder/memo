"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { normalizeChartBlock, serializeChartBlock } = require("./chart-block-utils.js");
const { chartPngFilename } = require("./chart-png-export.js");
const button = page => page.locator('#preview [data-chart-png-index]');
const card = page => page.locator('#preview .chart-block');
const panel = page => page.locator('.chart-block-editor');
const field = (page,name) => panel(page).locator('[data-chart-field="'+name+'"]');
const action = (page,name) => panel(page).locator('[data-chart-action="'+name+'"]');
const artifacts = process.env.MEMO_NEXUS_PNG_ARTIFACTS || path.join(os.tmpdir(),'memo-png-artifacts',process.env.MEMO_NEXUS_E2E_BROWSER||'chromium');
async function idle(page) {
  await page.waitForFunction(()=>!noteSaveFoundation.isDirty(currentId) && saveTimer===null && window.MemoNexusTypingDerivedUiScheduler.pendingRequestType()===null);
}
async function snapshot(page) {
  return page.evaluate(async()=>({body:editor.value,note:structuredClone(currentNote()),state:noteSaveFoundation.getState(currentId),saveTimer,
    undo:structuredClone(undoStack),redo:structuredClone(redoStack),drafts:structuredClone([...chartEditorOriginalCharts]),stored:(await getStoredNotes()).find(n=>n.id===currentId)}));
}
function fixture(config={},values=[30,-10,0,20]) {
  return normalizeChartBlock({id:'png',title:'月別売上',unit:'万円',chartType:config.chartType||'bar',
    items:values.map((_,i)=>({id:'i'+i,label:(i+1)+'月'})),
    series:[{id:'sales',name:'売上',color:'#4f46e5',values},{id:'rate',name:'利益',color:'#dc2626',values:values.map(v=>v/2)}],
    appearance:{showLegend:true,showValues:true,showPoints:true,showStackTotals:true,comboLineSeriesId:'rate',pieSeriesId:'rate',comboSecondaryUnit:'%',leftAxisTitle:'売上',rightAxisTitle:'利益率',pieItemColors:{i0:'#059669'},...config}});
}
async function load(page,chart) {
  await page.locator('#editor').fill(serializeChartBlock(chart));
  await page.waitForFunction(()=>document.querySelector('#preview [data-chart-png-index]'));
  await idle(page);
  assert.equal(await panel(page).locator('[data-chart-png-index]').count(),0,'draft preview has no PNG button');
}
async function observe(page) {
  await page.evaluate(()=>{
    window.pngUrls=new Set();window.pngXml=[];window.pngDownloads=0;
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),serialize=XMLSerializer.prototype.serializeToString;
    URL.createObjectURL=blob=>{const url=create(blob);window.pngUrls.add(url);return url;};
    URL.revokeObjectURL=url=>{window.pngUrls.delete(url);return revoke(url);};
    XMLSerializer.prototype.serializeToString=function(node){const xml=serialize.call(this,node);if(node.localName==='svg')window.pngXml.push(xml);return xml;};
  });
}
async function pngPixels(page,bytes) {
  assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.ok(bytes.length>500,'nonempty PNG');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  assert.ok(Number.isInteger(width)&&width>0&&width<=4096&&height>0&&height<=4096&&width*height<=16000000);
  const pixels=await page.evaluate(async base64=>{
    const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data;
    let opaque=true;const colors=new Set();for(let i=0;i<data.length;i+=4){if(data[i+3]!==255)opaque=false;if(colors.size<32)colors.add(data.slice(i,i+3).join(','));}
    return {opaque,colors:colors.size,background:[...data.slice(0,4)],width:image.width,height:image.height};
  },bytes.toString('base64'));
  assert.equal(pixels.opaque,true);assert.ok(pixels.colors>3);assert.equal(pixels.width,width);assert.equal(pixels.height,height);
  return {width,height,...pixels};
}
async function exportPng(page,title,key=null,saveAs=null) {
  await idle(page);const before=await snapshot(page);
  const scroll=await card(page).locator('.chart-block-scroll').evaluate(el=>el.scrollLeft);
  const tooltip=await card(page).locator('.chart-data-tooltip').allTextContents();
  const event=page.waitForEvent('download');
  if(key)await button(page).press(key);else await button(page).click();
  const download=await event;assert.equal(download.suggestedFilename(),chartPngFilename(title));
  const bytes=fs.readFileSync(await download.path());
  await page.waitForFunction(()=>document.querySelector('#preview .chart-png-controls [role="status"]')?.textContent==='PNG画像の保存を開始しました');
  assert.deepEqual(await snapshot(page),before,'body/note/revision/dirty/save/DB/Undo/draft unchanged');
  assert.equal(await card(page).locator('.chart-block-scroll').evaluate(el=>el.scrollLeft),scroll);
  assert.deepEqual(await card(page).locator('.chart-data-tooltip').allTextContents(),tooltip);
  assert.equal(await button(page).getAttribute('aria-busy'),null);
  assert.equal(await page.evaluate(()=>window.pngUrls.size),0);
  assert.equal(await page.locator('a[download][href^="data:image/png"]').count(),0);
  const pixels=await pngPixels(page,bytes);
  if(saveAs){fs.mkdirSync(artifacts,{recursive:true});fs.writeFileSync(path.join(artifacts,saveAs),bytes);}
  return {bytes,pixels};
}
async function composition(page,chart) {
  const result=await page.evaluate(()=>{
    const card=document.querySelector('#preview .chart-block'),api=window.MemoNexusChartPngExport;
    const capture=api.captureChartPng(card);Object.freeze(capture.theme);capture.legend.forEach(Object.freeze);Object.freeze(capture.legend);Object.freeze(capture);
    const plan=api.composeChartPng(capture),plot=plan.svg.querySelector('svg');
    const original=card.querySelector('.chart-block-scroll > svg');
    const shapeNames=['rect','line','polyline','path','circle','text','tspan'];
    const shapeSnapshot=svg=>[...svg.querySelectorAll(shapeNames.join(','))].map(el=>({tag:el.localName,text:el.localName==='text'?el.textContent:null,
      geometry:['x','y','x1','y1','x2','y2','cx','cy','r','width','height','points','d'].map(name=>el.getAttribute(name))}));
    const copiedSnapshot=shapeSnapshot(plot),sourceSnapshot=shapeSnapshot(original);
    // title children are intentionally removed; compare visible text separately.
    const text=plan.svg.textContent;
    return {text,legend:capture.legend,title:capture.title,notice:capture.notice,theme:capture.theme,
      width:plot.getAttribute('width'),logicalWidth:original.viewBox.baseVal.width,
      geometryEqual:JSON.stringify(copiedSnapshot.map(({text,...s})=>s))===JSON.stringify(sourceSnapshot.map(({text,...s})=>s)),
      clonedText:[...plot.querySelectorAll('text')].map(el=>el.textContent),
      sourceText:[...original.querySelectorAll('text')].map(el=>{const c=el.cloneNode(true);c.querySelectorAll('title').forEach(t=>t.remove());return c.textContent;}),
      invalid:[...plan.svg.querySelectorAll('*')].flatMap(el=>[...el.attributes].filter(a=>/NaN|Infinity|var\(/.test(a.value)).map(a=>a.value)),
      forbidden:plan.svg.querySelectorAll('foreignObject,table,button,input,ul,[tabindex],[role="status"],[data-chart-datum]').length,
      bg:plan.svg.firstElementChild.getAttribute('fill'),linePoints:plot.querySelectorAll('circle').length};
  });
  assert.equal(result.geometryEqual,true,'same rendered shapes and coordinates');assert.deepEqual(result.clonedText,result.sourceText,'same label elision, totals and percentages');
  assert.equal(Number(result.width),result.logicalWidth);assert.deepEqual(result.invalid,[]);assert.equal(result.forbidden,0);
  assert.equal(result.legend.length,chart.appearance.showLegend?(chart.chartType==='pie'?chart.items.length:chart.series.length):0);
  assert.equal(result.bg,result.theme.background);assert.ok(result.title.includes(chart.title||'グラフ'));
  if(chart.chartType==='combo'&&chart.appearance.comboAxisMode==='dual'){assert.match(result.notice,/左右で尺度/);assert.match(result.text,/売上|左軸/);assert.match(result.text,/利益率|右軸/);}
  if(chart.chartType==='pie'){assert.ok(result.title.includes('利益'));assert.equal(result.legend[0]?.color,'rgb(5, 150, 105)');}
  return result;
}
async function viewer(page,width) {
  await page.setViewportSize({width,height:1000});
  await page.waitForFunction(w=>innerWidth===w&&document.body.dataset.layoutMode===(w===1100?'wide':'mobile'),width);
  if(width<1100){
    if(await page.locator('#contextPanel').getAttribute('aria-hidden')==='false')await page.locator('#closeContextPanelBtn').click();
    if(await page.locator('#mobileWritingDoneBtn').isVisible())await page.locator('#mobileWritingDoneBtn').click();
    if(await page.locator('#previewCard').getAttribute('aria-hidden')==='true')await page.locator('#cardPaneBtn').click();
    await page.waitForFunction(()=>document.querySelector('#previewCard').getAttribute('aria-hidden')==='false'&&Math.abs(document.querySelector('#previewCard').getBoundingClientRect().right-innerWidth)<1);
  }
  await button(page).scrollIntoViewIfNeeded();
}
async function verifyChartPng(page, step = () => {}) {
  step('PNG setup and 49 Chart/value/display cases');
  await viewerSetup(page);await observe(page);
  const configs=[...['vertical','horizontal'].flatMap(barOrientation=>['grouped','stacked','percent-stacked'].map(barMode=>({barOrientation,barMode}))),
    {chartType:'line'},{chartType:'pie'},{chartType:'combo',comboAxisMode:'single'},{chartType:'combo',comboAxisMode:'dual'}];
  let count=0;
  for(const config of configs)for(const values of [[30,10,0,20],[-30,-10,0,-20],[30,-10,0,20],[0,0,0,0]]) {
    if(config.chartType==='pie'&&values.some(v=>v<0))continue;
    const chart=fixture(config,values);await load(page,chart);await composition(page,chart);await exportPng(page,chart.title);count++;
  }
  for(const values of [[1.2345,-0.001,1e20,-1e-20],[Number.MIN_VALUE,-Number.MIN_VALUE,0,Number.MIN_VALUE],[Number.MAX_VALUE,-Number.MAX_VALUE,0,1]]){
    const chart=fixture({chartType:'combo',comboAxisMode:'dual'},values);await load(page,chart);await composition(page,chart);await exportPng(page,chart.title);count++;
  }
  for(const showLegend of [true,false])for(const showValues of [true,false])for(const showDataTable of [true,false]){
    const chart=fixture({chartType:'line',showLegend,showValues,showDataTable,showPoints:false});await load(page,chart);await composition(page,chart);await exportPng(page,chart.title);count++;
  }
  const named=fixture();named.title='日本語<>:"/\\|?*.PNG';await load(page,named);await exportPng(page,named.title);
  named.title='';await load(page,named);await exportPng(page,'');
  // Real keyboard Tab entry, Enter and Space, preserving focused button.
  await button(page).focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
  assert.equal(await button(page).evaluate(el=>el===document.activeElement),true);
  await exportPng(page,'','Enter');assert.equal(await button(page).evaluate(el=>el===document.activeElement),true);
  await exportPng(page,'','Space');assert.equal(await button(page).evaluate(el=>el===document.activeElement),true);
  // Full SVG width is independent of horizontal scroll, including selected tooltip/focus.
  const wide=fixture({},Array.from({length:50},(_,i)=>i%3?i:-i));await load(page,wide);
  const first=await exportPng(page,wide.title);
  await card(page).locator('[data-chart-datum]').first().focus();await page.keyboard.press('End');
  await page.waitForFunction(()=>document.querySelector('#preview .chart-block-scroll').scrollLeft>0);
  const second=await exportPng(page,wide.title);assert.deepEqual(second.bytes,first.bytes,'scroll and tooltip do not change image');
  assert.equal(second.pixels.width,4096);
  // Current theme after UI switching, long text wrapping, safe literal text, five widths.
  step('long labels, themes and responsive widths');
  const long=fixture({chartType:'combo',comboAxisMode:'dual',showDataTable:true});
  long.title='長い日本語タイトル <画像> & 確認 '.repeat(10);long.items.forEach(i=>i.label='長い日本語項目名'.repeat(10));
  long.series.forEach(s=>s.name='長い日本語系列名'.repeat(10));long.unit='長い単位'.repeat(20);long.appearance.comboSecondaryUnit='長い右単位'.repeat(20);
  await load(page,long);
  const backgrounds=[];
  for(const theme of ['light','dark']) {
    await viewer(page,1100);await page.locator('#settingsBtn').click();await page.locator('#themeSelect').selectOption(theme);await page.locator('#closeSettingsBtn').click();
    for(const width of [320,375,390,430,1100]) {
      await viewer(page,width);const result=await exportPng(page,long.title,null,(width===390||width===1100)?'chart-png-'+theme+'-'+width+'.png':null);
      const metrics=await page.evaluate(()=>{const c=document.querySelector('#preview .chart-png-controls');return {doc:document.documentElement.scrollWidth,body:document.body.scrollWidth,rects:[c,...c.children].map(el=>el.getBoundingClientRect().toJSON())};});
      assert.ok(metrics.doc<=width&&metrics.body<=width,JSON.stringify(metrics));metrics.rects.forEach(r=>assert.ok(r.left>=0&&r.right<=width+1,JSON.stringify(metrics)));
      if(width===390||width===1100){fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'chart-png-ui-'+theme+'-'+width+'.png')});}
      if(width===1100)backgrounds.push(result.pixels.background);
    }
  }
  assert.notDeepEqual(backgrounds[0],backgrounds[1]);
  await viewer(page,1100);
  const example=fixture({chartType:'combo',comboAxisMode:'dual'});example.title='月別売上と利益率';
  await load(page,example);
  for(const theme of ['light','dark']) {
    await viewer(page,1100);await page.locator('#settingsBtn').click();await page.locator('#themeSelect').selectOption(theme);await page.locator('#closeSettingsBtn').click();
    for(const width of [1100,390]) {
      await viewer(page,width);await exportPng(page,example.title,null,'chart-png-example-'+theme+'-'+width+'.png');
      await card(page).locator('figcaption').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(artifacts,'chart-png-example-ui-'+theme+'-'+width+'.png')});
    }
  }
  await viewer(page,1100);
  step('failure paths, selection, Undo and compatibility');
  await failures(page);
  await compatibility(page);
  console.log('PNG export passed:',count,'chart/value/display cases, 10 theme/width layouts, PNG pixels, scroll equality, keyboard, state invariance, failures and compatibility');
}
async function viewerSetup(page) {
  await page.setViewportSize({width:1100,height:1000});await page.waitForFunction(()=>document.body.dataset.layoutMode==='wide');
  const id=await page.evaluate(()=>currentId);await page.locator('#newBtn').click();await page.waitForFunction(old=>currentId!==old&&editor.value==='',id);
}
async function failures(page) {
  await load(page,fixture());
  // Fault injection is limited to browser image/canvas/download boundaries, never app state.
  for(const failure of ['load','decode','canvas','toBlob','empty','null','malformed','wrongMime','reader','download']) {
    await page.evaluate(failure=>{
      window.pngRestore=[];const swap=(object,key,value)=>{const old=object[key];object[key]=value;window.pngRestore.push(()=>object[key]=old);};
      if(failure==='load') {const Native=Image;swap(window,'Image',function(){const image=new Native();Object.defineProperty(image,'src',{set(){queueMicrotask(()=>image.onerror?.(new Event('error')));}});return image;});}
      if(failure==='decode')swap(HTMLImageElement.prototype,'decode',()=>Promise.reject(new Error('decode')));
      if(failure==='canvas')swap(HTMLCanvasElement.prototype,'getContext',()=>null);
      if(['toBlob','empty','null','malformed','wrongMime'].includes(failure))swap(HTMLCanvasElement.prototype,'toBlob',function(callback){if(failure==='toBlob')throw new Error('toBlob');callback(failure==='null'?null:failure==='empty'?new Blob([],{type:'image/png'}):new Blob(['x'.repeat(50)],{type:failure==='malformed'?'image/png':'text/plain'}));});
      if(failure==='reader')swap(FileReader.prototype,'readAsDataURL',function(){queueMicrotask(()=>this.onerror());});
      if(failure==='download')swap(HTMLAnchorElement.prototype,'click',()=>{throw new Error('download');});
    },failure);
    const before=await snapshot(page);let downloads=0;const onDownload=()=>downloads++;page.on('download',onDownload);
    await button(page).click();await page.waitForFunction(()=>document.querySelector('#preview .chart-png-controls [role="status"]').textContent.startsWith('PNG画像を保存できませんでした'));
    assert.equal(downloads,0);assert.equal(await button(page).getAttribute('aria-busy'),null);assert.equal(await page.evaluate(()=>window.pngUrls.size),0);
    assert.deepEqual(await snapshot(page),before);assert.equal(await page.locator('a[download][href^="data:image/png"]').count(),0);
    await page.evaluate(()=>window.pngRestore.reverse().forEach(restore=>restore()));page.off('download',onDownload);
    await exportPng(page,'月別売上');
  }
  // Hold only the toBlob completion to exercise repeated activation deterministically.
  await page.evaluate(()=>{const native=HTMLCanvasElement.prototype.toBlob;window.pngNativeToBlob=native;HTMLCanvasElement.prototype.toBlob=function(callback,type){native.call(this,blob=>{window.pngRelease=()=>callback(blob);},type);};});
  let downloads=0;const onDownload=()=>downloads++;page.on('download',onDownload);
  await button(page).click();await page.waitForFunction(()=>typeof window.pngRelease==='function');
  await button(page).evaluate(el=>{el.click();el.click();});
  assert.equal(await button(page).getAttribute('aria-busy'),'true');
  const event=page.waitForEvent('download');await page.evaluate(()=>window.pngRelease());await event;
  await page.waitForFunction(()=>!document.querySelector('#preview [data-chart-png-index]').hasAttribute('aria-busy'));
  assert.equal(downloads,1);page.off('download',onDownload);
  await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=window.pngNativeToBlob;delete window.pngRelease;});
}
async function compatibility(page) {
  await load(page,fixture());await exportPng(page,'月別売上');
  const saved=await snapshot(page);
  await action(page,'paste-table').click();await page.getByRole('dialog').locator('textarea').fill('項目\t売上\t利益\n変更\t12\t6');await page.getByRole('button',{name:'貼り付け内容を反映',exact:true}).click();
  assert.equal((await snapshot(page)).body,saved.body);
  await exportPng(page,'月別売上');assert.equal(await panel(page).locator('[data-chart-png-index]').count(),0);
  await action(page,'cancel').click();await page.waitForFunction(()=>document.querySelector('.chart-block-editor > .chart-block-status')?.textContent==='編集内容を取り消しました');await idle(page);
  assert.equal((await snapshot(page)).body,saved.body);
  await action(page,'paste-table').click();await page.getByRole('dialog').locator('textarea').fill('項目\t売上\t利益\n確定\t12\t6');await page.getByRole('button',{name:'貼り付け内容を反映',exact:true}).click();
  await field(page,'showDataTable').check();await action(page,'confirm').click();await idle(page);
  await page.waitForFunction(()=>document.querySelector('#preview .chart-data-table'));
  assert.match(await card(page).locator('.chart-data-table').textContent(),/確定.*12.*6/);
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.pngCopied=text;}}});});
  await card(page).locator('[data-chart-copy-index]').click();assert.equal(await page.evaluate(()=>window.pngCopied),'項目\t売上\t利益\n確定\t12\t6');
  await exportPng(page,'月別売上');
  const confirmed=(await snapshot(page)).body;
  await page.locator('#undoBtn').click();await idle(page);
  assert.equal((await snapshot(page)).body,saved.body,'PNG leaves the preceding edit as the next Undo step');
  await page.locator('#editor').fill(confirmed);await idle(page);
  const input=field(page,'title');await input.focus();await input.press('Home');await input.press('Shift+ArrowRight');
  const selection=await input.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]);
  await exportPng(page,'月別売上');
  assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]),selection);
  assert.equal(await input.evaluate(el=>el===document.activeElement),true);
  const caption=card(page).locator('figcaption');await caption.scrollIntoViewIfNeeded();
  const textBox=await caption.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getBoundingClientRect().toJSON();});
  await page.mouse.dblclick(textBox.x+8,textBox.y+textBox.height/2);
  const domSelection=await page.evaluate(()=>getSelection().toString());assert.ok(domSelection.length>0);
  await exportPng(page,'月別売上');assert.equal(await page.evaluate(()=>getSelection().toString()),domSelection);
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});await idle(page);await observe(page);
  assert.match(await card(page).locator('.chart-data-table').textContent(),/確定.*12.*6/);await exportPng(page,'月別売上');
  // Legacy marker is read without normalization writes from PNG export.
  const legacy='<!-- memo-nexus:chart-block:'+Buffer.from(JSON.stringify({id:'legacy',title:'旧グラフ',items:[{id:'old',label:'旧項目',value:3}]})).toString('hex')+' -->';
  await page.locator('#editor').fill(legacy);await idle(page);await exportPng(page,'旧グラフ');assert.equal(await page.locator('#editor').inputValue(),legacy);
}
async function verifyChartPngTouch(browser,url) {
  const context=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:1000}}),page=await context.newPage();
  try {
    await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:r.request().url().endsWith('.css')?'text/css':'text/javascript',body:''}));
    await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});
    await viewerSetup(page);await observe(page);await load(page,fixture());await viewer(page,390);
    await card(page).locator('[data-chart-datum]').first().tap();
    const tooltip=await card(page).locator('.chart-data-tooltip').allTextContents();
    assert.equal(tooltip.length,1);
    const before=await snapshot(page),event=page.waitForEvent('download');
    await button(page).tap();const download=await event.catch(async error=>{console.error('PNG touch state',await page.evaluate(()=>({status:document.querySelector('#preview .chart-png-controls')?.textContent,urls:window.pngUrls.size,xml:window.pngXml.length})));throw error;});
    await pngPixels(page,fs.readFileSync(await download.path()));assert.deepEqual(await snapshot(page),before);
    assert.deepEqual(await card(page).locator('.chart-data-tooltip').allTextContents(),tooltip);
    console.log('PNG touch passed at 390px (emulation)');
  }finally{await context.close();}
}
module.exports={verifyChartPng,verifyChartPngTouch, helpers:{idle,snapshot,fixture,load,observe,pngPixels,composition,viewer,viewerSetup,exportPng}};

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
    await verifyChartPng(page);await verifyChartPngTouch(browser,url);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
