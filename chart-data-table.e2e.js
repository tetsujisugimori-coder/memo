"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const panel = page => page.locator(".chart-block-editor");
const field = (page, name) => panel(page).locator(`[data-chart-field="${name}"]`);
const action = (page, name) => panel(page).locator(`[data-chart-action="${name}"]`);
const table = page => panel(page).locator(".chart-data-table");
const tsv = "項目\t売上\t利益\t費用\n1月\t100\t20\t10\n2月\t120\t25\t0";
async function idle(page) {
  await page.waitForFunction(() => !noteSaveFoundation.isDirty(currentId) && saveTimer === null
    && window.MemoNexusTypingDerivedUiScheduler.pendingRequestType() === null);
}
async function snapshot(page) {
  return page.evaluate(async () => ({ body: editor.value, note: structuredClone(currentNote()),
    state: noteSaveFoundation.getState(currentId), saveTimer,
    stored: (await getStoredNotes()).find(n => n.id === currentId) }));
}
async function model(page) {
  return page.evaluate(() => window.MemoNexusChartBlockUtils.splitChartBlocks(editor.value).find(x => x.type === "chart").chart);
}
async function confirm(page) {
  await action(page, "confirm").click();
  await page.waitForFunction(() => document.querySelector('.chart-block-editor > .chart-block-status')?.textContent === "入力内容を保存しました");
  await idle(page);
}
async function cancel(page) {
  await action(page, "cancel").click();
  await page.waitForFunction(() => document.querySelector('.chart-block-editor > .chart-block-status')?.textContent === "編集内容を取り消しました"
    && document.activeElement?.matches('.chart-block-editor'));
  await idle(page);
}
async function paste(page, text = tsv, apply = true) {
  await action(page, "paste-table").click();
  const dialog = page.getByRole("dialog", { name: "表データを貼り付け" });
  await dialog.locator("textarea").fill(text);
  if (apply) await dialog.getByRole("button", { name: "貼り付け内容を反映" }).click();
}
async function setup(page) {
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
  const previousId = await page.evaluate(() => currentId);
  await page.locator("#newBtn").click();
  await page.waitForFunction(id => currentId !== id && editor.value === "", previousId);
  await page.locator("#insertChartBtn").click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "グラフ1のタイトル");
  await paste(page); await confirm(page);
}
async function cells(page) {
  return table(page).locator("tbody tr").evaluateAll(rows => rows.map(r => [...r.cells].map(c => c.textContent)));
}
async function verifyChartDataTable(page) {
  await setup(page);
  const before = await snapshot(page);
  assert.equal(await table(page).count(), 0);
  await panel(page).locator('[data-chart-series-value]').first().fill('');
  await field(page,'showDataTable').click();
  assert.equal(await field(page,'showDataTable').isChecked(),false);
  assert.equal(await table(page).count(),0);
  assert.match(await panel(page).locator(':scope > .chart-block-status').textContent(),/有限/);
  assert.deepEqual(await snapshot(page),before);
  await panel(page).locator('[data-chart-series-value]').first().fill('100');await idle(page);
  // The invalid edit was restored to its original value before testing the toggle boundary.
  await field(page, "showDataTable").focus();
  await page.keyboard.press("Space");
  assert.equal(await field(page, "showDataTable").evaluate(el => el === document.activeElement), true);
  assert.deepEqual(await cells(page), [["1月","100","20","10"],["2月","120","25","0"]]);
  assert.deepEqual(await snapshot(page), before, "設定変更は本文・note・revision・dirty・予約・DBに触れない");
  assert.equal(await page.locator("#preview .chart-data-table").count(), 0);
  await field(page,"title").fill("売上比較");
  await panel(page).locator('[data-chart-item-field="label"]').first().fill("変更項目");
  await panel(page).locator('[data-chart-series-field="name"]').first().fill("変更系列");
  await panel(page).locator('[data-chart-series-value]').first().fill("1.2345678901234567");
  assert.equal((await cells(page))[0][1], "1.2345678901234567");
  await panel(page).locator('[data-chart-action="move-item-down"]').first().click();
  await page.waitForFunction(() => document.activeElement?.dataset.chartAction?.startsWith("move-item-"));
  await panel(page).locator('[data-chart-action="move-series-down"]').first().click();
  await page.waitForFunction(() => document.activeElement?.dataset.chartAction?.startsWith("move-series-"));
  assert.deepEqual(await cells(page), [["2月","25","120","0"],["変更項目","20","1.2345678901234567","10"]]);
  await page.evaluate(() => flushSave());
  assert.deepEqual(await snapshot(page), before, "設定後の編集も確定まで保存しない");
  await confirm(page);
  assert.equal(await page.locator("#preview .chart-data-table").count(),1);
  const saved=await model(page);
  await page.reload({waitUntil:"domcontentloaded"}); await page.locator("#appStartupGuard").waitFor({state:"hidden"});
  await panel(page).waitFor({state:"visible"}); await idle(page);
  assert.deepEqual(await model(page),saved);assert.equal(await field(page,"showDataTable").isChecked(),true);
  const reloaded=await snapshot(page);
  await field(page,"showDataTable").uncheck(); assert.equal(await table(page).count(),0);
  assert.deepEqual(await snapshot(page),reloaded);await cancel(page);
  assert.equal(await table(page).count(),1);assert.equal((await snapshot(page)).body,reloaded.body);
  await field(page,"showDataTable").uncheck();await confirm(page);
  assert.equal(await page.locator("#preview .chart-data-table").count(),0);
  await page.locator("#undoBtn").click();await idle(page);
  assert.equal((await model(page)).appearance.showDataTable,true,"表示設定確定をUndo可能");
  const original=await cells(page), prePaste=await snapshot(page);
  await paste(page,"項目\t同名\t同名\n同名\t7\t0\n同名\t8\t9",false);
  assert.deepEqual(await cells(page),original);assert.deepEqual(await snapshot(page),prePaste);
  await page.getByRole("dialog").getByRole("button",{name:"貼り付け内容を反映"}).click();
  assert.deepEqual(await cells(page),[["同名","7","0"],["同名","8","9"]]);
  assert.deepEqual(await snapshot(page),prePaste);await cancel(page);assert.deepEqual(await cells(page),original);
  await paste(page);await confirm(page);
  const configs=[...['vertical','horizontal'].flatMap(barOrientation=>['grouped','stacked','percent-stacked'].map(barMode=>({chartType:'bar',barOrientation,barMode}))),
    {chartType:'line'},{chartType:'pie'},{chartType:'combo',comboAxisMode:'single'},{chartType:'combo',comboAxisMode:'dual'}];
  for(const config of configs) {
    await field(page,'chartType').selectOption(config.chartType);
    for(const key of ['barOrientation','barMode','comboAxisMode'])if(config[key])await field(page,key).selectOption(config[key]);
    await field(page,'unit').fill('万円');
    if(config.chartType==='combo') {
      await field(page,'comboLineSeriesId').selectOption((await model(page)).series[1].id);
      if(config.comboAxisMode==='dual')await field(page,'comboSecondaryUnit').fill('%');
      const headers=await table(page).locator('thead th').allTextContents();
      assert.match(headers[1],/棒・左軸・単位: 万円/);
      assert.match(headers[2],config.comboAxisMode==='dual'?/折れ線・右軸・単位: %/:/折れ線・左軸・単位: 万円/);
    }
    if(config.chartType==='pie') {
      const current=await model(page);
      await field(page,'pieSeriesId').selectOption(current.series[2].id);
      assert.deepEqual(await cells(page),[['1月','10'],['2月','0']]);
      await field(page,'pieSeriesId').selectOption(current.series[1].id);
      assert.deepEqual(await cells(page),[['1月','20'],['2月','25']]);
      await panel(page).locator('[data-chart-pie-item-color]').first().fill('#123456');
      assert.equal(await table(page).locator('tbody .chart-data-table-swatch').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(18, 52, 86)');
    } else assert.deepEqual(await cells(page),[['1月','100','20','10'],['2月','120','25','0']]);
    assert.match(await table(page).locator('caption').textContent(),/元の入力値/);
    await confirm(page);
    assert.equal(await table(page).locator('th:not([scope])').count(),0);
    assert.equal(await table(page).locator('tbody th[scope="row"]').count(),2);
    assert.equal(await table(page).locator('input,button,[contenteditable]').count(),0);
    const datum=page.locator('#preview [data-chart-datum]').first();
    await datum.focus(); await page.getByRole('tooltip').waitFor({state:'visible'});
    assert.equal(await page.getByRole('tooltip').textContent(),await datum.getAttribute('data-chart-description'));
    await page.keyboard.press('Escape');
    if(config.chartType==='bar'){await datum.click();await page.getByRole('tooltip').waitFor({state:'visible'});await page.keyboard.press('Escape');}
  }
  await page.setViewportSize({width:1600,height:1400});
  await page.waitForFunction(()=>innerWidth===1600&&document.body.dataset.layoutMode==='wide');
  await page.locator('#preview .chart-block').screenshot({path:path.join(os.tmpdir(),'chart-data-table-combo-desktop.png')});
  await page.setViewportSize({width:1100,height:820});
  await field(page,'chartType').selectOption('bar');
  await paste(page,'項目\t<img src=x onerror=alert(1)>\t同名\n<script>bad()</script>\t1\t2');
  assert.equal(await table(page).locator('img,script').count(),0);
  assert.equal((await cells(page))[0][0],'<script>bad()</script>');
  await cancel(page);
  await paste(page,'項目\t'+['長い系列名'.repeat(15),'同名','同名'].join('\t')+'\n'+['長い項目名'.repeat(15),'1.7976931348623157e308','-1.7976931348623157e308','5e-324'].join('\t'));
  await field(page,'unit').fill('長い単位'.repeat(15));await confirm(page);
  assert.deepEqual((await cells(page))[0].slice(1),['1.7976931348623157e+308','-1.7976931348623157e+308','5e-324']);
  for(const theme of ['light','dark']) {
    await page.setViewportSize({width:1100,height:820});
    await page.locator('#settingsBtn').click();await page.locator('#themeSelect').selectOption(theme);await page.locator('#closeSettingsBtn').click();
    for(const width of [320,375,390,430,1100]) {
      await page.setViewportSize({width,height:820});await page.waitForFunction(w=>innerWidth===w&&document.body.dataset.layoutMode===(w===1100?'wide':'mobile'),width);
      if(width<1100){
        if(await page.locator('#contextPanel').getAttribute('aria-hidden')==='false')await page.locator('#closeContextPanelBtn').click();
        if(await page.locator('#previewCard').getAttribute('aria-hidden')==='false')await page.locator('#closeCardPaneBtn').click();
      }
      await field(page,'showDataTable').scrollIntoViewIfNeeded();
      const check=await field(page,'showDataTable').evaluate(el=>({input:el.getBoundingClientRect().toJSON(),label:el.parentElement.getBoundingClientRect().toJSON()}));
      assert.ok(check.input.width>0&&check.input.right<=check.label.right);
      for(const name of ['confirm','cancel']){await action(page,name).scrollIntoViewIfNeeded();assert.equal(await action(page,name).isVisible(),true);}
      await table(page).scrollIntoViewIfNeeded();
      await checkLayout(page,panel(page),width);
      if(width<1100){
        if(await page.locator('#mobileWritingDoneBtn').isVisible())await page.locator('#mobileWritingDoneBtn').click();
        await page.locator('#cardPaneBtn').click();
        await page.waitForFunction(()=>{
          const card=document.getElementById('previewCard');
          return card.getAttribute('aria-hidden')==='false'&&Math.abs(card.getBoundingClientRect().right-innerWidth)<1;
        });
      }
      const viewer=page.locator('#preview .chart-block');await viewer.locator('.chart-data-table').scrollIntoViewIfNeeded();
      await checkLayout(page,viewer,width);
      if(width===320||width===1100)await page.screenshot({path:path.join(process.env.MEMO_NEXUS_TABLE_ARTIFACTS||os.tmpdir(),`chart-data-table-${process.env.MEMO_NEXUS_E2E_BROWSER||'chromium'}-${theme}-${width}.png`)});
      if(width<1100)await page.locator('#closeCardPaneBtn').click();
    }
  }
  // A marker with no flag remains untouched on read and render, including save state.
  await page.setViewportSize({width:1100,height:820});
  const legacy={id:'legacy-table',items:[{id:'a',label:'旧項目',value:1}]};
  const raw=`<!-- memo-nexus:chart-block:${Buffer.from(JSON.stringify(legacy)).toString('hex')} -->`;
  await page.locator('#editor').fill(raw);await page.evaluate(()=>flushSave());await idle(page);
  const old=await snapshot(page);
  // Leave the legacy note before reload: pagehide's existing draft mirror concerns the other note.
  await page.locator('#newBtn').click();
  await page.waitForFunction(id=>currentId!==id&&editor.value==="",old.note.id);await idle(page);
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});await idle(page);
  await page.evaluate(id=>openNote(id),old.note.id);await idle(page);
  const read=await snapshot(page);assert.equal(read.body,raw);assert.deepEqual(read.note,old.note);assert.deepEqual(read.stored,old.stored);
  assert.equal(await field(page,'showDataTable').isChecked(),false);assert.equal(read.saveTimer,null);
  console.log('Data table passed: 10 chart configurations, 10 theme/width layouts in editor and viewer, save/cancel/Undo/reload/legacy/TSV/semantic DOM/tooltips');
}
async function checkLayout(page,host,width) {
  const metrics=await host.evaluate(el=>{
    const scroll=el.querySelector('.chart-data-table-scroll'),svg=el.querySelector('svg'),t=scroll.querySelector('table');
    return {body:document.body.scrollWidth,doc:document.documentElement.scrollWidth,rect:scroll.getBoundingClientRect().toJSON(),
      scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth,height:scroll.clientHeight,fullHeight:scroll.scrollHeight,
      svg:svg.getBoundingClientRect().toJSON(),color:getComputedStyle(t).color,bg:getComputedStyle(t).backgroundColor};
  });
  assert.ok(metrics.body<=width&&metrics.doc<=width,JSON.stringify(metrics));
  assert.ok(metrics.rect.left>=0&&metrics.rect.right<=width,JSON.stringify(metrics));
  assert.ok(metrics.svg.width>=360,'表の追加でSVGを縮小しない');assert.ok(metrics.height>=metrics.fullHeight-20,'固定高さの縦スクロールなし');
  assert.notEqual(metrics.color,metrics.bg);
  if(metrics.scrollWidth>metrics.clientWidth){
    const scroll=host.locator('.chart-data-table-scroll');await scroll.focus();
    const beforeScroll=await host.locator('svg').evaluate(el=>el.getBoundingClientRect().toJSON());
    const previousOffset=await scroll.evaluate(el=>el.scrollLeft);
    await page.keyboard.press(previousOffset>0?'ArrowLeft':'ArrowRight');
    // Browser-native keyboard scrolling is asynchronous; wait on the actual scroll offset.
    await page.waitForFunction(({el,offset})=>el.scrollLeft!==offset,{el:await scroll.elementHandle(),offset:previousOffset});
    const after=await host.locator('svg').evaluate(el=>el.getBoundingClientRect().toJSON());
    assert.equal(after.x,beforeScroll.x);assert.equal(after.width,beforeScroll.width);
  }
}
async function verifyChartDataTableTouch(browser,url) {
  const context=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:820}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:r.request().url().endsWith('.css')?'text/css':'text/javascript',body:''}));
  try{
    await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});
    await setup(page);await field(page,'showDataTable').check();await confirm(page);
    await page.setViewportSize({width:390,height:820});await page.waitForFunction(()=>document.body.dataset.layoutMode==='mobile');
    if(await page.locator('#mobileWritingDoneBtn').isVisible())await page.locator('#mobileWritingDoneBtn').tap();
    if(await page.locator('#contextPanel').getAttribute('aria-hidden')==='false')await page.locator('#closeContextPanelBtn').tap();
    if(await page.locator('#previewCard').getAttribute('aria-hidden')==='true')await page.locator('#cardPaneBtn').tap();
    assert.equal(await page.locator('#preview .chart-data-table').count(),1);
    await page.locator('#preview .chart-block').screenshot({path:path.join(os.tmpdir(),'chart-data-table-mobile-390.png')});
    const datum=page.locator('#preview [data-chart-datum]').first();await datum.tap();await page.getByRole('tooltip').waitFor({state:'visible'});
    assert.equal(await page.getByRole('tooltip').textContent(),await datum.getAttribute('data-chart-description'));
    await datum.tap();await page.getByRole('tooltip').waitFor({state:'detached'});assert.deepEqual(errors,[]);
    console.log('Data table touch tooltip passed at 390px (emulation)');
  }finally{await context.close();}
}
module.exports={verifyChartDataTable,verifyChartDataTableTouch};

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
    await verifyChartDataTable(page);await verifyChartDataTableTouch(browser,url);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
