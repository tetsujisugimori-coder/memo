"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { serializeTableBlock } = require("./table-block-utils.js");
const { serializeChartBlock } = require("./chart-block-utils.js");
const rows = [["項目", "売上", "利益"], ["1月", "100", "20"], ["2月", "120", "25"]];
const marker = (id, data = rows) => serializeTableBlock({ id, rows:data });
const pending = page => page.locator('[data-chart-pending-table]');
const table = (page, id) => page.locator('.table-block-editor[data-table-id="' + id + '"]');
const action = (page, name) => pending(page).locator('[data-chart-action="' + name + '"]');
const artifacts = path.join(os.tmpdir(), 'memo-table-chart-artifacts', process.env.MEMO_NEXUS_E2E_BROWSER || 'chromium');
async function idle(page) {
  await page.waitForFunction(() => !noteSaveFoundation.isDirty(currentId) && saveTimer === null && window.MemoNexusTypingDerivedUiScheduler.pendingRequestType() === null);
}
async function snapshot(page) {
  return page.evaluate(async () => ({ body:editor.value, note:structuredClone(currentNote()), state:noteSaveFoundation.getState(currentId), saveTimer,
    undo:structuredClone(undoStack), redo:structuredClone(redoStack), stored:(await getStoredNotes()).find(n=>n.id===currentId) }));
}
async function models(page) {
  return page.evaluate(() => window.MemoNexusChartBlockUtils.splitChartBlocks(editor.value).filter(x=>x.type==='chart').map(x=>x.chart));
}
async function load(page, body) {
  await page.locator('#editor').fill(body);
  assert.equal(await page.locator('#editor').inputValue(), body);
  await idle(page);
  await table(page,'source').waitFor({state:'visible'});
}
async function start(page, id='source', key=null) {
  for (const other of await page.locator('.table-block-editor:not([data-table-id="'+id+'"]) details[open] > summary').all()) await other.click();
  const menu = table(page,id).locator('details');
  if (!await menu.evaluate(el=>el.open)) await menu.locator('summary').click();
  const button = menu.getByRole('button',{name:'グラフを作成',exact:true});
  if (key === 'Enter') {
    await menu.locator('summary').focus();
    for (let step=0; step<10 && !await button.evaluate(el=>el===document.activeElement); step++) await page.keyboard.press('Tab');
    assert.equal(await button.evaluate(el=>el===document.activeElement),true,'Tab reaches the native button');
    await page.keyboard.press('Enter');
  } else if (key) { await button.focus(); await page.keyboard.press(key); } else await button.click();
}
async function confirm(page) {
  const id = await pending(page).getAttribute('data-chart-id');
  await action(page,'confirm').click();
  await pending(page).waitFor({state:'detached'});
  await page.waitForFunction(id=>document.querySelector('.chart-block-editor[data-chart-id="'+id+'"] > .chart-block-status')?.textContent==='入力内容を保存しました',id);
  await idle(page);
  return id;
}
async function copyPendingTsv(page, expected) {
  const before = await snapshot(page);
  const draftBefore = await page.evaluate(() => ({ pending: { ...pendingTableChart, trigger: undefined }, drafts: structuredClone([...chartEditorOriginalCharts]) }));
  const chartId = await pending(page).getAttribute('data-chart-id');
  // Stub only the clipboard boundary; application and persistence state remain read-only.
  await page.evaluate(() => {
    window.tableChartClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    window.tableChartCopyCalls = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.tableChartCopyCalls.push(text); } } });
  });
  try {
    await action(page, 'copy-tsv').click();
    await page.waitForFunction(() => document.querySelector('[data-chart-pending-table] > .chart-block-status')?.textContent);
    assert.equal(await pending(page).locator(':scope > .chart-block-status').textContent(), 'TSVをコピーしました（2項目・2系列）');
    assert.deepEqual(await page.evaluate(() => window.tableChartCopyCalls), [expected]);
    assert.deepEqual(await snapshot(page), before, 'copy preserves full body/note/revision/dirty/save timer/IndexedDB/Undo/Redo');
    assert.deepEqual(await page.evaluate(() => ({ pending: { ...pendingTableChart, trigger: undefined }, drafts: structuredClone([...chartEditorOriginalCharts]) })), draftBefore, 'copy preserves the pending draft');
    assert.equal(await pending(page).getAttribute('data-chart-id'), chartId);
    assert.deepEqual(await models(page), [], 'copy does not insert a chart marker');
  } finally {
    await page.evaluate(() => {
      if (window.tableChartClipboardDescriptor) Object.defineProperty(navigator, 'clipboard', window.tableChartClipboardDescriptor);
      else delete navigator.clipboard;
      delete window.tableChartClipboardDescriptor;
      delete window.tableChartCopyCalls;
    });
  }
}
async function verifyTableToChart(page) {
  await page.setViewportSize({width:1100,height:900});
  await page.waitForFunction(()=>document.body.dataset.layoutMode==='wide');
  const previousId = await page.evaluate(()=>currentId);
  await page.locator('#newBtn').click();
  await page.waitForFunction(id=>currentId!==id && document.activeElement===editor,previousId);
  const body = '前\n' + marker('source') + '\n間\n' + marker('same-content') + '\n後';
  await load(page,body);
  const before = await snapshot(page);
  assert.deepEqual(await models(page), []);
  await start(page);
  assert.equal(await pending(page).count(),1);
  assert.equal(await pending(page).locator('input').first().evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(await pending(page).locator('[data-chart-item-field="label"]').evaluateAll(els=>els.map(el=>el.value)),['1月','2月']);
  assert.deepEqual(await pending(page).locator('[data-chart-series-field="name"]').evaluateAll(els=>els.map(el=>el.value)),['売上','利益']);
  assert.deepEqual(await pending(page).locator('[data-chart-series-value]').evaluateAll(els=>els.map(el=>el.value)),['100','20','120','25']);
  await copyPendingTsv(page, rows.map(row => row.join('\t')).join('\n'));
  await pending(page).locator('[data-chart-series-field="name"]').first().fill('編集売上');
  await pending(page).locator('[data-chart-item-field="label"]').first().fill('編集月');
  await pending(page).locator('[data-chart-series-value]').first().fill('-12.5');
  await copyPendingTsv(page, '項目\t編集売上\t利益\n編集月\t-12.5\t20\n2月\t120\t25');
  await start(page); // a second activation only focuses the existing draft
  assert.equal(await pending(page).count(),1);
  await pending(page).locator('[data-chart-field="title"]').fill('表から作成');
  await pending(page).locator('[data-chart-field="chartType"]').selectOption('line');
  await page.evaluate(()=>flushSave());
  assert.deepEqual(await snapshot(page),before,'draft creation, changes and flush do not touch persisted state or Undo');
  await action(page,'cancel').click();
  assert.deepEqual(await snapshot(page),before);
  assert.equal(await table(page,'source').getByRole('button',{name:'グラフを作成',exact:true}).evaluate(el=>el===document.activeElement),true);
  await start(page,'source','Enter'); await page.keyboard.press('Escape');
  assert.deepEqual(await snapshot(page),before);
  await start(page,'same-content','Space');
  await copyPendingTsv(page, rows.map(row => row.join('\t')).join('\n'));
  const id = await confirm(page);
  const saved = (await models(page))[0];
  const created = (await snapshot(page)).body;
  assert.equal(created, '前\n' + marker('source') + '\n間\n' + marker('same-content') + '\n' + serializeChartBlock(saved) + '\n後', 'only the selected table gets an immediately following chart');
  assert.equal(created.split('<!-- memo-nexus:chart-block:').length-1,1);
  assert.deepEqual(await page.evaluate(()=>window.MemoNexusTableBlockUtils.splitTableBlocks(editor.value).filter(x=>x.type==='table').map(x=>x.raw)),[marker('source'),marker('same-content')]);
  await page.locator('#undoBtn').click(); await idle(page);
  assert.equal((await snapshot(page)).body,body,'Undo only removes insertion');
  assert.deepEqual(await models(page),[]);
  assert.ok((await snapshot(page)).redo.length > 0, 'exercise copy with an existing Redo history');
  await start(page); await copyPendingTsv(page, rows.map(row => row.join('\t')).join('\n'));
  await action(page,'cancel').click();
  await page.locator('#redoBtn').click(); await idle(page);
  assert.equal((await snapshot(page)).body,created,'Redo restores the identical marker and IDs');
  assert.deepEqual((await models(page))[0],saved);
  await page.locator('#undoBtn').click(); await idle(page);
  await start(page); await confirm(page);
  assert.equal(await page.locator('#redoBtn').isDisabled(),true,'new insertion invalidates Redo');
  const restored=(await models(page))[0];
  await page.reload({waitUntil:'domcontentloaded'}); await page.locator('#appStartupGuard').waitFor({state:'hidden'});
  await page.locator('.chart-block-editor').waitFor({state:'visible'}); await idle(page);
  assert.deepEqual((await models(page))[0],restored);
  await table(page,'source').locator('[data-row-index="1"][data-column-index="1"]').fill('777'); await idle(page);
  assert.deepEqual((await models(page))[0],restored,'editing source table does not update graph');
  const sourceAfter=(await snapshot(page)).body.match(/<!-- memo-nexus:table-block:[0-9a-f]+ -->/)[0];
  await page.locator('.chart-block-editor [data-chart-series-value]').first().fill('555');
  await page.locator('.chart-block-editor [data-chart-action="confirm"]').click(); await idle(page);
  assert.ok((await snapshot(page)).body.includes(sourceAfter),'editing chart preserves table');
  // Preserve safe identity across movement; refuse removal/replacement/duplicate IDs.
  for (const scenario of ['moved','deleted','replaced','duplicate','edited']) {
    await load(page,body); await start(page);
    const draftId=await pending(page).getAttribute('data-chart-id');
    const changed=scenario==='moved' ? marker('same-content')+'\n移動\n'+marker('source')
      : scenario==='deleted' ? marker('same-content')
      : scenario==='replaced' ? marker('replacement')+'\n'+marker('same-content')
      : scenario==='duplicate' ? marker('source')+'\n'+marker('source')
      : marker('source',[["", "A"],["new", "99"]])+'\n'+marker('same-content');
    await page.locator('#editor').fill(changed); await idle(page);
    assert.equal(await pending(page).getAttribute('data-chart-id'),draftId);
    const unchanged=await snapshot(page);
    if(scenario==='moved') {
      await confirm(page);
      assert.equal((await snapshot(page)).body,changed+'\n'+serializeChartBlock((await models(page))[0]),'moved source is followed immediately by the chart');
      assert.deepEqual((await models(page))[0].series.map(x=>x.values),[[100,120],[20,25]]);
    } else {
      await action(page,'confirm').click();
      assert.match(await pending(page).locator(':scope > [role="status"]').textContent(),/変換元.*やり直し/);
      assert.deepEqual(await snapshot(page),unchanged);
      await action(page,'cancel').click();
    }
  }
  for (const invalid of [ [["", "A"],["1月", "NaN"]], [["", "A","B","C","D"],["1月","1","2","3","4"]], [["", "A"],...Array.from({length:51},()=>["x","1"]) ] ]) {
    await load(page,marker('source',invalid)); const unchanged=await snapshot(page); await start(page);
    assert.equal(await pending(page).count(),0); assert.match(await table(page,'source').locator('[role="status"]').textContent(),/行 .*列/);
    assert.deepEqual(await snapshot(page),unchanged);
  }
  const configs=[...['vertical','horizontal'].flatMap(barOrientation=>['grouped','stacked','percent-stacked'].map(barMode=>({chartType:'bar',barOrientation,barMode}))),{chartType:'line'},{chartType:'pie'},{chartType:'combo',comboAxisMode:'single'},{chartType:'combo',comboAxisMode:'dual'}];
  for (const config of configs) {
    await load(page,marker('source')); await start(page);
    await pending(page).locator('[data-chart-field="chartType"]').selectOption(config.chartType);
    for(const field of ['barOrientation','barMode','comboAxisMode']) if(config[field]) await pending(page).locator('[data-chart-field="'+field+'"]').selectOption(config[field]);
    await confirm(page); const current=(await models(page))[0]; assert.equal(current.chartType,config.chartType);
    for(const field of ['barOrientation','barMode','comboAxisMode']) if(config[field]) assert.equal(current.appearance[field],config[field]);
  }
  await load(page,marker('source',[["", "A"],["x","-1"]])); await start(page);
  await pending(page).locator('[data-chart-field="chartType"]').selectOption('pie');
  assert.equal(await action(page,'confirm').isDisabled(),true);
  await pending(page).locator('[data-chart-field="chartType"]').selectOption('combo');
  assert.equal(await action(page,'confirm').isDisabled(),true);
  await page.keyboard.press('Escape');
  await load(page,marker('source')); await start(page);
  await pending(page).locator('[data-chart-field="showDataTable"]').check();
  await confirm(page);
  await page.locator('#preview .chart-data-table').waitFor({state:'visible'});
  // Existing TSV and PNG controls work on the newly inserted ordinary chart.
  await page.locator('#preview [data-chart-copy-index]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('#preview [role="status"]')].some(el=>el.textContent.includes('コピーしました')));
  const datum=page.locator('#preview [data-chart-datum]').first(); await datum.focus(); await page.getByRole('tooltip').waitFor({state:'visible'}); await page.keyboard.press('Escape');
  const downloadEvent=page.waitForEvent('download'); await page.locator('#preview [data-chart-png-index]').click(); const download=await downloadEvent;
  assert.deepEqual([...fs.readFileSync(await download.path()).subarray(0,8)],[137,80,78,71,13,10,26,10]);
  fs.mkdirSync(artifacts,{recursive:true});
  for(const theme of ['light','dark']) {
    await page.setViewportSize({width:1100,height:900}); await page.waitForFunction(()=>document.body.dataset.layoutMode==='wide');
    await page.locator('#settingsBtn').click(); await page.locator('#themeSelect').selectOption(theme); await page.locator('#closeSettingsBtn').click();
    for(const width of [320,375,390,430,1100]) {
      await page.setViewportSize({width,height:900}); await page.waitForFunction(w=>document.body.dataset.layoutMode===(w===1100?'wide':'mobile'),width);
      if(width<1100 && await page.locator('#contextPanel').getAttribute('aria-hidden')==='false') await page.locator('#closeContextPanelBtn').click();
      if(width<1100 && await page.locator('#previewCard').getAttribute('aria-hidden')==='false') await page.locator('#closeCardPaneBtn').click();
      await start(page); await pending(page).scrollIntoViewIfNeeded();
      const metrics=await pending(page).evaluate(el=>({width:el.getBoundingClientRect().width,view:innerWidth,doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,body:document.body.scrollWidth-document.body.clientWidth}));
      assert.ok(metrics.width<=width); assert.equal(metrics.doc,0); assert.equal(metrics.body,0);
      if(width===390||width===1100) await page.screenshot({path:path.join(artifacts,theme+'-'+width+'-editor.png')});
      await action(page,'cancel').click();
      await table(page,'source').scrollIntoViewIfNeeded();
      if(width===390||width===1100) {
        await page.screenshot({path:path.join(artifacts,theme+'-'+width+'-table.png')});
        if(width===390) {
          if(await page.locator('#mobileWritingDoneBtn').isVisible()) await page.locator('#mobileWritingDoneBtn').click();
          await page.locator('#cardPaneBtn').click();
          await page.waitForFunction(()=>document.querySelector('#previewCard').getAttribute('aria-hidden')==='false' && Math.abs(document.querySelector('#previewCard').getBoundingClientRect().right-innerWidth)<1);
        }
        await page.locator('#preview .table-block').scrollIntoViewIfNeeded();
        await page.locator('#preview').screenshot({path:path.join(artifacts,theme+'-'+width+'-result.png')});
        if(width===390) await page.locator('#closeCardPaneBtn').click();
      }
    }
  }
  console.log('Table-to-chart E2E passed: snapshots, insertion, cancellation, identity, persistence, kinds, widths/themes');
}
async function verifyTableToChartTouch(browser,appUrl) {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try {
    const page=await context.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(appUrl,{waitUntil:'domcontentloaded'}); await page.locator('#appStartupGuard').waitFor({state:'hidden'});
    if(await page.locator('#contextPanel').getAttribute('aria-hidden')==='false') await page.locator('#closeContextPanelBtn').tap();
    const previousId=await page.evaluate(()=>currentId); await page.locator('#newBtn').tap(); await page.waitForFunction(id=>currentId!==id && document.activeElement===editor,previousId); await page.locator('#editor').fill(marker('source')); await idle(page);
    await table(page,'source').locator('summary').tap(); await table(page,'source').getByRole('button',{name:'グラフを作成',exact:true}).tap();
    assert.equal(await pending(page).count(),1); await action(page,'confirm').tap(); await pending(page).waitFor({state:'detached'}); await idle(page);
    assert.equal((await models(page)).length,1); assert.deepEqual((await models(page))[0].series.map(x=>x.values),[[100,120],[20,25]]);
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
  console.log('Table-to-chart touch emulation passed');
}
module.exports={verifyTableToChart,verifyTableToChartTouch};
