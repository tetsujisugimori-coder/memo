"use strict";
const assert = require("node:assert/strict");

const tsv = "項目\t売上\t利益\t費用\r\n1月\t100\t20\t10\r\n2月\t120\t25\t15\r\n3月\t90\t18\t8\r\n";
const panel = (page) => page.locator(".chart-block-editor");
const action = (page, name) => panel(page).locator('[data-chart-action="' + name + '"]');
const dialog = (page) => page.getByRole("dialog", { name: "表データを貼り付け" });
async function idle(page) {
  await page.waitForFunction(() => !noteSaveFoundation.isDirty(currentId) && saveTimer === null
    && window.MemoNexusTypingDerivedUiScheduler.pendingRequestType() === null);
}
async function snapshot(page) {
  return page.evaluate(async () => ({ body: editor.value, note: structuredClone(currentNote()),
    state: noteSaveFoundation.getState(currentId), saveTimer,
    stored: (await getStoredNotes()).find((note) => note.id === currentId) }));
}
async function model(page) {
  return page.evaluate(() => window.MemoNexusChartBlockUtils.splitChartBlocks(editor.value).find(x => x.type === "chart").chart);
}
async function draft(page) {
  return page.evaluate(() => {
    const element = document.querySelector('.chart-block-editor');
    return currentChartBlock(Number(element.dataset.chartIndex), element.dataset.chartId, element.dataset.chartSnapshotKey).chart;
  });
}
async function paste(page, text = tsv) {
  await action(page, "paste-table").click();
  assert.equal(await dialog(page).locator("textarea").evaluate(el => el === document.activeElement), true);
  await dialog(page).locator("textarea").fill(text);
}
async function apply(page) {
  await dialog(page).getByRole("button", { name: "貼り付け内容を反映" }).click();
  await dialog(page).waitFor({ state: "detached" });
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
async function newChart(page) {
  await page.setViewportSize({ width:1100, height:820 });
  await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
  await page.locator('#newBtn').click();
  await page.locator('#insertChartBtn').click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'グラフ1のタイトル');
  await confirm(page);
}
async function verifyChartTsv(page, step = () => {}) {
  step('Chart creation and TSV preview');
  await newChart(page);
  const before = await snapshot(page), original = await draft(page);
  await paste(page);
  assert.match(await dialog(page).locator('.chart-tsv-summary').textContent(), /項目数: 3、系列数: 3/);
  assert.deepEqual(await dialog(page).locator('thead th').allTextContents(), ["項目","売上","利益","費用"]);
  assert.deepEqual(await dialog(page).locator('tbody tr').first().locator('th,td').allTextContents(), ["1月","100","20","10"]);
  assert.deepEqual(await draft(page), original, "貼り付けだけではdraftを変えない");
  assert.deepEqual(await snapshot(page), before, "プレビュー前後の保存状態は不変");
  await page.keyboard.press('Escape');
  assert.equal(await action(page,'paste-table').evaluate(el=>el === document.activeElement),true);
  await paste(page); await apply(page);
  const imported = await draft(page);
  assert.equal(imported.items[0].id,original.items[0].id);
  assert.equal(imported.series[0].id,original.series[0].id);
  assert.equal(new Set(imported.items.map(x=>x.id)).size,3);
  assert.equal(new Set(imported.series.map(x=>x.id)).size,3);
  assert.deepEqual(imported.series.map(x=>x.values),[[100,120,90],[20,25,18],[10,15,8]]);
  assert.deepEqual(await snapshot(page),before,"反映後も本文・note・revision・dirty・保存予約・IndexedDBは不変");
  // Corrections and type changes after import must also stay in the same deferred draft.
  await panel(page).locator('[data-chart-field="title"]').fill('TSV保存');
  await panel(page).locator('[data-chart-field="chartType"]').selectOption('line');
  await page.evaluate(() => flushSave());
  assert.deepEqual(await snapshot(page),before,"flushSaveにも未確定draftを渡さない");
  const edited = await draft(page);
  await paste(page, "\t別名\n別項目\t999");
  await dialog(page).getByRole('button',{name:'キャンセル',exact:true}).click();
  assert.deepEqual(await draft(page),edited,"ダイアログ取消は編集途中draftを維持");
  await cancel(page);
  assert.equal((await snapshot(page)).body,before.body,"編集取消は元マーカーを完全復元");
  assert.deepEqual(await draft(page),original);
  step('invalid TSV, cancel and save/reload');
  for (const invalid of ['項目\t売上\n1月\tNaN', '項目\t売上\n1月\t', '項目,売上\n1月,10']) {
    await paste(page,invalid);
    assert.equal(await dialog(page).getByRole('button',{name:'貼り付け内容を反映'}).isDisabled(),true);
    assert.match(await dialog(page).locator('#chart-tsv-error').textContent(), /[12]行 2列/);
    assert.equal(await dialog(page).locator('textarea').getAttribute('aria-invalid'),'true');
    await page.keyboard.press('Escape');
  }
  await paste(page); await apply(page); await confirm(page);
  await page.locator("#undoBtn").click();
  await idle(page);
  assert.equal((await snapshot(page)).body,before.body,"確定したTSV表をUndoで戻せる");
  await panel(page).waitFor({state:"visible"});
  await paste(page); await apply(page); await confirm(page);
  const saved = await model(page);
  await page.reload({waitUntil:'domcontentloaded'}); await page.locator('#appStartupGuard').waitFor({state:'hidden'});
  await panel(page).waitFor({state:'visible'});
  assert.deepEqual(await model(page),saved); assert.deepEqual(await draft(page),saved);
  assert.deepEqual((await snapshot(page)).stored.body,(await snapshot(page)).body);
  // Use actual editing controls to set colors and selected series before replacing the table.
  await panel(page).locator('[data-chart-field="chartType"]').selectOption('pie');
  await panel(page).locator('[data-chart-field="pieSeriesId"]').selectOption(saved.series[1].id);
  await panel(page).locator('[data-chart-item-index="0"] input[data-chart-pie-item-color]').fill('#123456');
  await panel(page).locator('[data-chart-series-index="1"] input[data-chart-series-field="color"]').fill('#654321');
  await confirm(page);
  const colored = await model(page);
  await paste(page,'\t同名\t同名\n同名\t1\t2\n同名\t3\t4'); await apply(page);
  const reduced = await draft(page);
  assert.deepEqual(reduced.items.map(x=>x.id),colored.items.slice(0,2).map(x=>x.id));
  assert.deepEqual(reduced.series.map(x=>[x.id,x.color]),colored.series.slice(0,2).map(x=>[x.id,x.color]));
  assert.equal(reduced.appearance.pieItemColors[reduced.items[0].id],'#123456');
  assert.equal(reduced.appearance.pieSeriesId,colored.series[1].id);
  await confirm(page);
  await paste(page,'\t売上\n1月\t-1'); await apply(page);
  const negativeBefore = await snapshot(page);
  assert.equal(await action(page,'confirm').isDisabled(),true);
  assert.match(await panel(page).locator(':scope > .chart-block-status').textContent(),/負数/);
  await page.evaluate(()=>flushSave()); assert.deepEqual(await snapshot(page),negativeBefore);
  await panel(page).locator('[data-chart-field="chartType"]').selectOption('bar');
  assert.deepEqual(await snapshot(page),negativeBefore,"有効形式へ修正しても確定までは保存しない");
  await confirm(page); assert.equal((await model(page)).series[0].values[0],-1);
  // Eight kinds plus both horizontal stacked modes, all through TSV apply and confirm.
  const configs = [
    ...['vertical','horizontal'].flatMap(barOrientation=>['grouped','stacked','percent-stacked'].map(barMode=>({chartType:'bar',barOrientation,barMode}))),
    {chartType:'line'}, {chartType:'pie'}, {chartType:'combo',comboAxisMode:'single'}, {chartType:'combo',comboAxisMode:'dual'}
  ];
  step('10 Chart configurations and imported values');
  for (const config of configs) {
    await paste(page); await apply(page);
    await panel(page).locator('[data-chart-field="chartType"]').selectOption(config.chartType);
    for (const field of ['barOrientation','barMode','comboAxisMode']) if(config[field]) await panel(page).locator('[data-chart-field="'+field+'"]').selectOption(config[field]);
    if(config.chartType==='combo') {
      await panel(page).locator('[data-chart-field="comboLineSeriesId"]').selectOption((await draft(page)).series[1].id);
      await panel(page).locator('[data-chart-field="leftAxisTitle"]').fill('売上');
      if(config.comboAxisMode==='dual') {
        await panel(page).locator('[data-chart-field="rightAxisTitle"]').fill('成長');
        await panel(page).locator('[data-chart-field="comboSecondaryUnit"]').fill('%');
      }
    }
    await confirm(page);
    const current = await model(page);
    assert.equal(current.chartType,config.chartType);
    for(const field of ['barOrientation','barMode','comboAxisMode']) if(config[field]) assert.equal(current.appearance[field],config[field]);
    const bad = await page.locator('#preview .chart-block svg').evaluateAll(svgs=>svgs.flatMap(svg=>[...svg.querySelectorAll('*')].flatMap(el=>[...el.attributes].filter(a=>/NaN|Infinity/.test(a.value)||(['width','height','r','rx','ry'].includes(a.name)&&Number(a.value)<0)).map(a=>a.name+':'+a.value))));
    assert.deepEqual(bad,[]);
    const datum = page.locator('#preview [data-chart-datum]').first();
    await datum.focus();
    await page.getByRole('tooltip').waitFor({state:'visible'});
    assert.equal(await page.getByRole('tooltip').textContent(),await datum.getAttribute('data-chart-description'));
    await page.keyboard.press('Escape');
    if(config.chartType==='bar') {
      await datum.click(); await page.getByRole('tooltip').waitFor({state:'visible'}); await page.keyboard.press('Escape');
    }
  }
  const comboBefore = await snapshot(page), combo = await model(page);
  await paste(page,'\t一系列\n1月\t1'); await apply(page);
  assert.equal(await action(page,'confirm').isDisabled(),true);
  assert.match(await panel(page).locator(':scope > .chart-block-status').textContent(),/2系列/);
  assert.deepEqual(await snapshot(page),comboBefore);
  await cancel(page); assert.equal((await snapshot(page)).body,comboBefore.body);
  await paste(page,'\tA\tB\nA\t1\t2'); await apply(page);
  const kept = await draft(page);
  assert.deepEqual(kept.appearance,combo.appearance,"左右単位・タイトル・選択・色・表示設定を保持");
  await cancel(page);
  let positions = 0;
  step('theme/width layouts and tooltips');
  for(const theme of ['light','dark']) {
    await page.setViewportSize({width:1100,height:820});
    await page.locator('#settingsBtn').click(); await page.locator('#themeSelect').selectOption(theme); await page.locator('#closeSettingsBtn').click();
    for(const width of [320,375,390,430,1100]) {
      await page.setViewportSize({width,height:820});
      await page.waitForFunction(w=>innerWidth===w&&document.body.dataset.layoutMode===(w===1100?'wide':'mobile'),width);
      if (width < 1100) {
        if (await page.locator('#contextPanel').getAttribute('aria-hidden') === 'false') await page.locator('#closeContextPanelBtn').click();
        if (await page.locator('#previewCard').getAttribute('aria-hidden') === 'false') await page.locator('#closeCardPaneBtn').click();
      }
      await paste(page,'\t'+['長い系列名'.repeat(12),'B','C'].join('\t')+'\n<img src=x onerror=alert(1)>\t1.7976931348623157e308\t-1.7976931348623157e308\t5e-324');
      assert.equal(await dialog(page).locator('img').count(),0,'ユーザー文字列はHTMLとして扱わない');
      const geometry = await dialog(page).evaluate(el=>({
        width:innerWidth, body:document.body.scrollWidth, document:document.documentElement.scrollWidth,
        rects:[el,el.querySelector('textarea'),el.querySelector('.chart-tsv-preview'),...el.querySelectorAll('button')].map(x=>({left:x.getBoundingClientRect().left,right:x.getBoundingClientRect().right})),
        color:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor
      }));
      assert.ok(geometry.body<=width&&geometry.document<=width);
      geometry.rects.forEach(r=>assert.ok(r.left>=0&&r.right<=width,JSON.stringify(r)));
      assert.notEqual(geometry.color,geometry.bg);
      // Dialog focus containment, including reverse tab.
      await dialog(page).locator('textarea').focus(); await page.keyboard.press('Shift+Tab');
      assert.equal(await dialog(page).evaluate(el=>el.contains(document.activeElement)),true);
      await dialog(page).getByRole('button',{name:'貼り付け内容を反映'}).focus(); await page.keyboard.press('Tab');
      assert.equal(await dialog(page).evaluate(el=>el.contains(document.activeElement)),true);
      await dialog(page).locator('textarea').fill('項目\t系列\n項目\t'+ '誤り'.repeat(200));
      assert.equal(await dialog(page).getByRole('button',{name:'貼り付け内容を反映'}).isDisabled(),true);
      assert.ok(await dialog(page).evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.body.scrollWidth<=innerWidth));
      await page.keyboard.press('Escape'); positions++;
    }
  }
  await page.setViewportSize({width:1100,height:820});
  console.log('TSV checks passed: 10 chart configurations, '+positions+' theme/width layouts, persistence boundaries, reload, cancel, IDs/colors, validation and tooltips');
}

async function verifyChartTsvTouch(browser, appUrl) {
  const context = await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:820}});
  const page = await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:r.request().url().endsWith('.css')?'text/css':'text/javascript',body:''}));
  try {
    await page.goto(appUrl,{waitUntil:'domcontentloaded'}); await page.locator('#appStartupGuard').waitFor({state:'hidden'});
    await newChart(page); await paste(page); await apply(page); await confirm(page);
    await page.setViewportSize({width:390,height:820});
    await page.waitForFunction(()=>document.body.dataset.layoutMode==='mobile');
    if(await page.locator('#mobileWritingDoneBtn').isVisible())await page.locator('#mobileWritingDoneBtn').tap();
    if(await page.locator('#contextPanel').getAttribute('aria-hidden')==='false') await page.locator('#closeContextPanelBtn').tap();
    if(await page.locator('#previewCard').getAttribute('aria-hidden')==='true') await page.locator('#cardPaneBtn').tap();
    const datum=page.locator('#preview [data-chart-datum]').first();
    await datum.tap(); await page.getByRole('tooltip').waitFor({state:'visible'});
    assert.equal(await page.getByRole('tooltip').textContent(),await datum.getAttribute('data-chart-description'));
    await datum.tap(); await page.getByRole('tooltip').waitFor({state:'detached'});
    assert.deepEqual(errors,[]);
    console.log('TSV touch tooltip passed at 390px (emulation)');
  } finally {await context.close();}
}
module.exports = { verifyChartTsv, verifyChartTsvTouch };
