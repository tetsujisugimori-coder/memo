"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const panel = page => page.locator(".chart-block-editor");
const field = (page, name) => panel(page).locator('[data-chart-field="'+name+'"]');
const action = (page, name) => panel(page).locator('[data-chart-action="'+name+'"]');
const status = page => panel(page).locator(':scope > .chart-block-status');
const tsv = "項目\t売上\t利益\t費用\n1月\t100\t20\t10\n2月\t120\t25\t0";
async function idle(page) {
  await page.waitForFunction(() => !noteSaveFoundation.isDirty(currentId) && saveTimer === null
    && window.MemoNexusTypingDerivedUiScheduler.pendingRequestType() === null);
}
async function snapshot(page) {
  return page.evaluate(async () => ({ body: editor.value, note: structuredClone(currentNote()),
    state: noteSaveFoundation.getState(currentId), saveTimer, undo: structuredClone(undoStack),
    drafts: structuredClone([...chartEditorOriginalCharts]),
    stored: (await getStoredNotes()).find(n => n.id === currentId) }));
}
async function confirm(page) {
  await action(page,"confirm").click();
  await page.waitForFunction(() => document.querySelector('.chart-block-editor > .chart-block-status')?.textContent === "入力内容を保存しました");
  await idle(page);
}
async function paste(page,text=tsv) {
  await action(page,"paste-table").click();
  await page.getByRole('dialog').locator('textarea').fill(text);
  await page.getByRole('button',{name:'貼り付け内容を反映',exact:true}).click();
}
async function setup(page) {
  await page.setViewportSize({width:1100,height:820});
  await page.waitForFunction(()=>document.body.dataset.layoutMode==='wide');
  const id=await page.evaluate(()=>currentId);
  await page.locator('#newBtn').click();
  await page.waitForFunction(old=>currentId!==old && editor.value==='',id);
  await page.locator('#insertChartBtn').click();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='グラフ1のタイトル');
  await paste(page);await confirm(page);
}
// Only the external clipboard boundary is stubbed; application/save state is read-only.
async function clipboard(page,mode='success',fallback=false) {
  await page.evaluate(({mode,fallback})=>{
    window.copyCalls=[];window.fallbackCalls=[];
    if(!window.originalExecCommand)window.originalExecCommand=document.execCommand;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:mode==='missing'?undefined:{writeText:async text=>{
      window.copyCalls.push(text);if(mode==='reject')throw new DOMException('denied','NotAllowedError');
    }}});
    document.execCommand=command=>{
      if(command!=='copy')return window.originalExecCommand.call(document,command);
      window.fallbackCalls.push(document.activeElement.value);return fallback;
    };
  },{mode,fallback});
}
async function copy(page,expected,key=null) {
  const before=await snapshot(page);
  if(key)await action(page,'copy-tsv').press(key);else await action(page,'copy-tsv').click();
  await page.waitForFunction(()=>document.querySelector('.chart-block-editor > .chart-block-status')?.textContent.startsWith('TSVをコピーしました'));
  assert.equal(await page.evaluate(()=>window.copyCalls.at(-1)),expected);
  assert.deepEqual(await snapshot(page),before,'copy does not modify body/note/revision/dirty/save timer/DB/Undo/draft');
}
async function verifyChartTsvCopy(page) {
  await setup(page);
  // Observe real write calls without replacing the native operation. WebKit on Windows
  // does not expose a readable system clipboard to the automation host.
  await page.evaluate(()=>{
    const nativeWrite=navigator.clipboard.writeText.bind(navigator.clipboard);
    window.nativeWrites=[];window.nativeCopyRoute="";
    const nativeExec=document.execCommand.bind(document);
    document.execCommand=command=>{const result=nativeExec(command);if(command==="copy"&&result)window.nativeCopyRoute="execCommand";return result;};
    navigator.clipboard.writeText=async text=>{window.nativeWrites.push(text);await nativeWrite(text);window.nativeCopyRoute="Clipboard API";};
  });
  await action(page,'copy-tsv').click();
  await page.waitForFunction(()=>document.querySelector('.chart-block-editor > .chart-block-status')?.textContent.startsWith('TSVをコピーしました'));
  const nativeText=await page.evaluate(()=>window.nativeWrites.at(-1));
  assert.equal(nativeText,tsv);
  assert.ok(await page.evaluate(()=>["Clipboard API","execCommand"].includes(window.nativeCopyRoute)));
  console.log("Native copy route:",await page.evaluate(()=>window.nativeCopyRoute));
  await action(page,'paste-table').click();
  await page.getByRole('dialog').locator('textarea').fill(nativeText);
  assert.equal(await page.getByRole('dialog').locator('textarea').inputValue(),tsv);
  await page.keyboard.press('Escape');
  await clipboard(page);
  assert.equal(await panel(page).locator('.chart-data-table').count(),0);
  await copy(page,tsv);
  await action(page,'paste-table').focus();await page.keyboard.press('Tab');
  assert.equal(await action(page,'copy-tsv').evaluate(el=>el===document.activeElement),true);
  await copy(page,tsv,'Enter');await copy(page,tsv,'Space');
  assert.equal(await action(page,'copy-tsv').evaluate(el=>el===document.activeElement),true);
  const saved=await snapshot(page);
  await paste(page); // Establish the existing deferred draft boundary.
  await panel(page).locator('[data-chart-series-value]').first().fill('1.2345678901234567');
  await panel(page).locator('[data-chart-item-field="label"]').first().fill('編集途中');
  await action(page,'move-item-down').first().click();
  await page.waitForFunction(()=>document.activeElement?.dataset.chartAction?.startsWith('move-item-'));
  await action(page,'move-series-down').first().click();
  await page.waitForFunction(()=>document.activeElement?.dataset.chartAction?.startsWith('move-series-'));
  const reordered="項目\t利益\t売上\t費用\n2月\t25\t120\t0\n編集途中\t20\t1.2345678901234567\t10";
  await copy(page,reordered);
  await page.evaluate(()=>flushSave());
  assert.equal((await snapshot(page)).body,saved.body);
  assert.deepEqual((await snapshot(page)).stored,saved.stored);
  await action(page,'paste-table').click();
  await page.getByRole('dialog').locator('textarea').fill(await page.evaluate(()=>window.copyCalls.at(-1)));
  assert.match(await page.locator('.chart-tsv-summary').textContent(),/項目数: 2、系列数: 3/);
  assert.deepEqual(await page.getByRole('dialog').locator('thead th').allTextContents(),['項目','利益','売上','費用']);
  assert.deepEqual(await page.getByRole('dialog').locator('tbody tr').last().locator('th,td').allTextContents(),['編集途中','20','1.2345678901234567','10']);
  const beforeDialogCopy=await snapshot(page),draftText=await page.getByRole('dialog').locator('textarea').inputValue();
  // The modal draft remains untouched by clipboard work.
  await page.keyboard.press('Escape');await copy(page,reordered);
  assert.deepEqual(await snapshot(page),beforeDialogCopy);assert.equal(draftText,reordered);
  await action(page,'cancel').click();
  await page.waitForFunction(()=>document.activeElement?.matches('.chart-block-editor') && document.querySelector('.chart-block-editor > .chart-block-status')?.textContent==='編集内容を取り消しました');
  await idle(page);await copy(page,tsv);
  await field(page,'showDataTable').check();await confirm(page);
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});await panel(page).waitFor({state:'visible'});await idle(page);await clipboard(page);
  await copy(page,tsv);
  for(const config of [
    ...['vertical','horizontal'].flatMap(barOrientation=>['grouped','stacked','percent-stacked'].map(barMode=>({chartType:'bar',barOrientation,barMode}))),
    {chartType:'line'},{chartType:'pie'},{chartType:'combo',comboAxisMode:'single'},{chartType:'combo',comboAxisMode:'dual'}
  ]) {
    await field(page,'chartType').selectOption(config.chartType);
    for(const name of ['barOrientation','barMode','comboAxisMode'])if(config[name])await field(page,name).selectOption(config[name]);
    if(config.chartType==='pie')await field(page,'pieSeriesId').selectOption({label:'利益'});
    await confirm(page);await copy(page,tsv);
    const before=await snapshot(page);
    await page.locator('#preview [data-chart-copy-index]').click();
    await page.waitForFunction(()=>document.querySelector('#preview .chart-tsv-copy-controls [role="status"]')?.textContent.startsWith('TSVをコピーしました'));
    assert.equal(await page.evaluate(()=>window.copyCalls.at(-1)),tsv);assert.deepEqual(await snapshot(page),before);
    if(config.chartType==='pie')assert.equal(await page.locator('#preview .chart-data-table thead th').count(),2);
  }
  await paste(page);await panel(page).locator('[data-chart-series-value]').first().fill('Infinity');
  const invalidBefore=await snapshot(page),calls=await page.evaluate(()=>window.copyCalls.length);
  await action(page,'copy-tsv').click();assert.match(await status(page).textContent(),/コピーできませんでした.*有限/);
  assert.equal(await page.evaluate(()=>window.copyCalls.length),calls);assert.deepEqual(await snapshot(page),invalidBefore);
  await panel(page).locator('[data-chart-series-value]').first().fill('100');
  await panel(page).locator('[data-chart-item-field="label"]').first().fill('名\t前');
  await action(page,'copy-tsv').click();assert.match(await status(page).textContent(),/項目1.*タブ/);
  await panel(page).locator('[data-chart-item-field="label"]').first().fill('1月');await confirm(page);
  for(const mode of ['reject','missing']) {
    for(const fallback of [true,false]) {
      await clipboard(page,mode,fallback);const before=await snapshot(page);
      await action(page,'copy-tsv').focus();await page.keyboard.press('Space');
      await page.waitForFunction(()=>document.querySelector('.chart-block-editor > .chart-block-status')?.textContent);
      assert.match(await status(page).textContent(),fallback?/TSVをコピーしました/:/コピーできませんでした.*ブラウザ/);
      assert.equal(await page.evaluate(()=>window.fallbackCalls.at(-1)),tsv);
      assert.equal(await page.locator('.syntax-guide-copy-fallback').count(),0);
      assert.equal(await action(page,'copy-tsv').evaluate(el=>el===document.activeElement),true);
      assert.deepEqual(await snapshot(page),before);
    }
  }
  // Exercise real fallback selection restoration on an input, apart from the button click.
  await clipboard(page,'missing',true);
  const input=field(page,'title');await input.fill('選択復元');await idle(page);await input.focus();await input.press('Home');await input.press('Shift+ArrowRight');
  const selection=await input.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]);
  await page.evaluate(()=>fallbackCopyText('test'));
  assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]),selection);
  assert.equal(await input.evaluate(el=>el===document.activeElement),true);
  await input.fill('月別売上と費用');await idle(page);
  await clipboard(page);
  for(const theme of ['light','dark']) {
    await page.setViewportSize({width:1100,height:820});await page.waitForFunction(()=>document.body.dataset.layoutMode==='wide');
    await page.locator('#settingsBtn').click();await page.locator('#themeSelect').selectOption(theme);await page.locator('#closeSettingsBtn').click();
    for(const width of [320,375,390,430,1100]) {
      await page.setViewportSize({width,height:820});await page.waitForFunction(w=>innerWidth===w&&document.body.dataset.layoutMode===(w===1100?'wide':'mobile'),width);
      if(width<1100){
        if(await page.locator('#contextPanel').getAttribute('aria-hidden')==='false')await page.locator('#closeContextPanelBtn').click();
        if(await page.locator('#previewCard').getAttribute('aria-hidden')==='false')await page.locator('#closeCardPaneBtn').click();
      }
      await action(page,'copy-tsv').scrollIntoViewIfNeeded();await layout(page,panel(page),width);await copy(page,tsv);
      if(width<1100){if(await page.locator('#mobileWritingDoneBtn').isVisible())await page.locator('#mobileWritingDoneBtn').click();await page.locator('#cardPaneBtn').click();}
      const viewer=page.locator('#preview .chart-block');await viewer.locator('[data-chart-copy-index]').scrollIntoViewIfNeeded();await layout(page,viewer,width);
      await viewer.locator('[data-chart-copy-index]').click();
      assert.equal(await page.evaluate(()=>window.copyCalls.at(-1)),tsv);
      if(theme==='light'&&(width===390||width===1100)) {
        await page.setViewportSize({width,height:1200});await page.waitForFunction(()=>innerHeight===1200);
        const scroll=viewer.locator('.chart-data-table-scroll');await scroll.focus();
        while(await scroll.evaluate(el=>el.scrollLeft>0)) {
          const offset=await scroll.evaluate(el=>el.scrollLeft);await page.keyboard.press('ArrowLeft');
          await page.waitForFunction(({el,offset})=>el.scrollLeft<offset,{el:await scroll.elementHandle(),offset});
        }
        await viewer.locator('[data-chart-copy-index]').focus();
        await viewer.scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(process.env.MEMO_NEXUS_COPY_ARTIFACTS||os.tmpdir(),'chart-tsv-copy-'+width+'.png')});
        await page.setViewportSize({width,height:820});await page.waitForFunction(()=>innerHeight===820);
      }
      if(width<1100)await page.locator('#closeCardPaneBtn').click();
    }
  }
  await page.setViewportSize({width:1100,height:820});
  await page.waitForFunction(()=>document.body.dataset.layoutMode==='wide');
  for(const bad of [{label:'名\t前',value:1,error:/項目1.*タブ/}, {label:'名前',value:'Infinity',error:/有限/}]) {
    const corrupt={id:'raw-copy',items:[{id:'i',label:bad.label}],series:[{id:'s',name:'値',values:[bad.value]}],appearance:{showDataTable:true}};
    const raw='<!-- memo-nexus:chart-block:'+Buffer.from(JSON.stringify(corrupt)).toString('hex')+' -->';
    await page.locator('#editor').fill(raw);await page.evaluate(()=>flushSave());await idle(page);
    const before=await snapshot(page),calls=await page.evaluate(()=>window.copyCalls.length);
    await page.locator('#preview [data-chart-copy-index]').click();
    assert.match(await page.locator('#preview .chart-tsv-copy-controls [role="status"]').textContent(),bad.error);
    await action(page,'copy-tsv').click();assert.match(await status(page).textContent(),bad.error);
    assert.equal(await page.evaluate(()=>window.copyCalls.length),calls);assert.deepEqual(await snapshot(page),before);
  }
  console.log('TSV copy passed: API success/rejection/unavailable, fallback success/failure, draft/save/cancel/reload, all 10 chart configurations, 10 theme/width layouts, keyboard, state invariance');
}
async function layout(page,host,width) {
  const metrics=await host.locator('.chart-tsv-copy-controls').evaluate(el=>({
    body:document.body.scrollWidth,doc:document.documentElement.scrollWidth,
    rect:el.getBoundingClientRect().toJSON(),children:[...el.children].filter(e=>e.getBoundingClientRect().height).map(e=>e.getBoundingClientRect().toJSON())
  }));
  assert.ok(metrics.body<=width && metrics.doc<=width,JSON.stringify(metrics));
  assert.ok(metrics.rect.left>=0&&metrics.rect.right<=width,JSON.stringify(metrics));
  for(const rect of metrics.children)assert.ok(rect.left>=metrics.rect.left&&rect.right<=metrics.rect.right+1,JSON.stringify(metrics));
  const svg=await host.locator('svg').boundingBox(),table=host.locator('.chart-data-table-scroll');
  const before=await host.locator('svg').evaluate(el=>({x:el.getBoundingClientRect().x,width:el.getBoundingClientRect().width}));
  const controls=metrics.rect;
  if(!await host.evaluate(el=>el.matches('.chart-block-editor')))assert.ok(controls.top>=svg.y+svg.height,'controls below plot');
  if(await table.evaluate(el=>el.scrollWidth>el.clientWidth)) {
    await table.focus();const offset=await table.evaluate(el=>el.scrollLeft);await page.keyboard.press(offset>0?'ArrowLeft':'ArrowRight');
    await page.waitForFunction(({el,offset})=>el.scrollLeft!==offset,{el:await table.elementHandle(),offset});
    assert.deepEqual(await host.locator('svg').evaluate(el=>({x:el.getBoundingClientRect().x,width:el.getBoundingClientRect().width})),before);
  }
}
async function verifyChartTsvCopyTouch(browser,url) {
  const context=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:820}}),page=await context.newPage();
  try {
    await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:r.request().url().endsWith('.css')?'text/css':'text/javascript',body:''}));
    await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});
    await setup(page);await field(page,'showDataTable').check();await confirm(page);await clipboard(page);
    await page.setViewportSize({width:390,height:820});await page.waitForFunction(()=>document.body.dataset.layoutMode==='mobile');
    if(await page.locator('#contextPanel').getAttribute('aria-hidden')==='false')await page.locator('#closeContextPanelBtn').tap();
    await action(page,'copy-tsv').tap();assert.equal(await page.evaluate(()=>window.copyCalls.at(-1)),tsv);
    if(await page.locator('#mobileWritingDoneBtn').isVisible())await page.locator('#mobileWritingDoneBtn').tap();
    if(await page.locator('#previewCard').getAttribute('aria-hidden')==='true')await page.locator('#cardPaneBtn').tap();
    const before=await snapshot(page);await page.locator('#preview [data-chart-copy-index]').tap();
    assert.equal(await page.evaluate(()=>window.copyCalls.at(-1)),tsv);assert.deepEqual(await snapshot(page),before);
    console.log('TSV copy touch passed at 390px (emulation)');
  } finally {await context.close();}
}
module.exports={verifyChartTsvCopy,verifyChartTsvCopyTouch};

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
    await verifyChartTsvCopy(page);await verifyChartTsvCopyTouch(browser,url);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
