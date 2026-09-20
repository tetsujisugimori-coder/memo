"use strict";

const assert = require("node:assert/strict");

const configs = [
  ...["vertical", "horizontal"].flatMap((barOrientation) => ["grouped", "stacked", "percent-stacked"]
    .map((barMode) => ({ chartType: "bar", barOrientation, barMode }))),
  { chartType: "line", single: true }, { chartType: "line" },
  { chartType: "combo", comboAxisMode: "single" }, { chartType: "combo", comboAxisMode: "dual" },
  { chartType: "pie" }, { chartType: "line", showPoints: false }
];

function seed(config, id) {
  return { id, chartType: config.chartType, title: "操作の検証", unit: "万円",
    items: [{ id: "a", label: "項目A" }, { id: "b", label: "項目B" }, { id: "zero", label: "ゼロ" }, { id: "decimal", label: "小数" }],
    series: [{ id: "sales", name: "売上", color: "#4f46e5", values: [30, config.chartType === "pie" ? 10 : -10, 0, 0.125] },
      ...config.single ? [] : [{ id: "rate", name: "成長率", color: "#dc2626", values: [20, config.chartType === "pie" ? 15 : -15, 0, 0.25] }]],
    appearance: { showValues: true, showLegend: true, showStackTotals: true, showPoints: true,
      pieSeriesId: "sales", pieItemColors: { a: "#123456" }, comboLineSeriesId: "rate", comboSecondaryUnit: "%",
      leftAxisTitle: "売上", rightAxisTitle: "成長率", ...config }
  };
}

async function loadChart(page, model) {
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
  const marker = await page.evaluate((model) => window.MemoNexusChartBlockUtils.serializeChartBlock(model), model);
  await page.locator("#editor").fill(marker);
  await page.locator(`.chart-block-editor[data-chart-id="${model.id}"]`).waitFor({ state: "visible" });
  await page.locator('.chart-block-editor [data-chart-action="confirm"]').click();
  await page.waitForFunction(() => document.querySelector('.chart-block-editor > .chart-block-status')?.textContent === "入力内容を保存しました"
    && !noteSaveFoundation.isDirty(currentId) && saveTimer === null
    && window.MemoNexusTypingDerivedUiScheduler.pendingRequestType() === null);
  await page.locator(`#preview .chart-block[data-chart-id="${model.id}"] [data-chart-datum]`).first().waitFor({ state: "attached" });
}

async function openPreview(page, width) {
  await page.setViewportSize({ width, height: 820 });
  await page.waitForFunction((width) => innerWidth === width && document.body.dataset.layoutMode === (width >= 1100 ? "wide" : "mobile"), width);
  if (width < 1100) {
    if (await page.locator("#mobileWritingDoneBtn").isVisible()) await page.locator("#mobileWritingDoneBtn").click();
    if (await page.locator("#contextPanel").getAttribute("aria-hidden") === "false") await page.locator("#closeContextPanelBtn").click();
    if (await page.locator("#previewCard").getAttribute("aria-hidden") === "true") await page.locator("#cardPaneBtn").click();
    await page.waitForFunction(() => {
      const card = document.getElementById("previewCard");
      return card.getAttribute("aria-hidden") === "false" && Math.abs(card.getBoundingClientRect().right - innerWidth) < 1;
    });
  }
}

async function closed(page) {
  await page.locator(".chart-data-tooltip").waitFor({ state: "detached" });
  assert.equal(await page.locator("[data-chart-datum][aria-describedby]").count(), 0);
}

async function checkTooltip(page, datum) {
  await page.locator(".chart-data-tooltip").waitFor({ state: "visible" });
  assert.equal(await page.locator('[role="tooltip"]').count(), 1);
  const expected = await datum.getAttribute("data-chart-description");
  assert.equal(await page.locator('[role="tooltip"]').textContent(), expected);
  assert.doesNotMatch(expected, /NaN|Infinity/);
  assert.equal(await datum.getAttribute("aria-describedby"), await page.locator('[role="tooltip"]').getAttribute("id"));
  assert.equal(await datum.getAttribute("aria-label"), "グラフのデータ", "同じ説明を名前と説明で二重に通知しない");
  const details = await datum.evaluate((el) => ({
    title: (el.querySelector("title") || el.parentElement.querySelector("title"))?.textContent,
    accessible: [...el.closest(".chart-block").querySelectorAll(".sr-only li")].map((li) => li.textContent),
    tabStops: el.closest(".chart-block").querySelectorAll('[data-chart-datum][tabindex="0"]').length,
    image: el.ownerSVGElement.getAttribute("role"), live: el.closest(".chart-block").querySelectorAll("[aria-live]").length
  }));
  assert.equal(details.title, expected);
  assert.ok(details.accessible.includes(expected));
  assert.equal(details.tabStops, 1); assert.equal(details.image, "img"); assert.equal(details.live, 1);
  assert.equal(await page.locator('#preview .chart-png-controls [role="status"][aria-live="polite"]').count(), 1);
  assert.equal(await page.locator('[role="tooltip"]').getAttribute("aria-live"), null);
  await page.waitForFunction(() => {
    const tooltip = document.querySelector(".chart-data-tooltip");
    if (!tooltip) return false;
    const r = tooltip.getBoundingClientRect(), card = tooltip.closest(".chart-block").getBoundingClientRect();
    return r.left >= Math.max(0, card.left) && r.right <= Math.min(innerWidth, card.right) + 0.5
      && r.top >= Math.max(0, card.top) && r.bottom <= Math.min(innerHeight, card.bottom) + 0.5;
  });
  const visual = await page.locator(".chart-data-tooltip").evaluate((el) => {
    const style = getComputedStyle(el), card = getComputedStyle(el.closest(".chart-block"));
    return { color: style.color, background: style.backgroundColor, card: card.backgroundColor, pointer: style.pointerEvents,
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth };
  });
  assert.notEqual(visual.color, visual.background); assert.equal(visual.background, visual.card);
  assert.equal(visual.pointer, "none"); assert.equal(visual.overflow, 0);
}

async function snapshot(page) {
  return page.evaluate(async () => ({ body: editor.value, note: structuredClone(currentNote()),
    state: noteSaveFoundation.getState(currentId), saveTimer,
    stored: (await getStoredNotes()).find((note) => note.id === currentId) }));
}

async function datumAction(datum, action) {
  await datum.scrollIntoViewIfNeeded();
  // A sector's bounding-box center can belong to another sector. Hit-test its fill.
  const position = await datum.evaluate((el) => {
    const box = el.getBBox(), rect = el.getBoundingClientRect(), matrix = el.getScreenCTM();
    for (const x of [0.5, 0.25, 0.75, 0.1, 0.9]) for (const y of [0.5, 0.25, 0.75, 0.1, 0.9]) {
      const point = new DOMPoint(box.x + box.width * x, box.y + box.height * y);
      const screen = point.matrixTransform(matrix);
      if (el.isPointInFill(point) && document.elementFromPoint(screen.x, screen.y) === el) {
        return { x: screen.x - rect.left, y: screen.y - rect.top };
      }
    }
    throw new Error('No visible interior for datum ' + el.dataset.chartItemId);
  });
  await datum[action]({ position });
}

async function verifyChartTooltips(page) {
  let count = 0;
  for (const config of configs) {
    const model = seed(config, `tooltip-${count}`);
    await loadChart(page, model);
    const card = page.locator('#preview .chart-block');
    const data = card.locator('[data-chart-datum]');
    const before = await snapshot(page);
    await datumAction(data.first(), 'hover'); await closed(page);
    await datumAction(data.first(), 'click'); await checkTooltip(page, data.first());
    await datumAction(data.first(), 'click'); await closed(page);
    await datumAction(data.first(), 'click'); await checkTooltip(page, data.first());
    await page.keyboard.press("Escape"); await closed(page);
    // The existing edit button precedes the one roving entry in document order.
    await card.locator('.chart-block-edit').focus(); await page.keyboard.press("Tab");
    assert.equal(await data.first().evaluate((el) => el === document.activeElement), true);
    await checkTooltip(page, data.first());
    const total = await data.count();
    for (let index = 1; index < total; index++) {
      await page.keyboard.press("ArrowRight");
      assert.equal(await data.nth(index).evaluate((el) => el === document.activeElement), true);
      await checkTooltip(page, data.nth(index));
    }
    await page.keyboard.press("Home"); await checkTooltip(page, data.first());
    await page.keyboard.press("End"); await checkTooltip(page, data.last());
    await page.keyboard.press("ArrowLeft"); await checkTooltip(page, data.nth(total - 2));
    await page.keyboard.press("Enter"); await closed(page);
    await page.keyboard.press("Space"); await checkTooltip(page, data.nth(total - 2));
    await page.locator('#titleInput').click(); await closed(page);
    assert.deepEqual(await snapshot(page), before, "操作だけでは本文・revision・dirty・保存予約・IndexedDBを変更しない");
    if (config.barMode === "percent-stacked") {
      const positive = await data.first().getAttribute("data-chart-description");
      const negative = await card.locator('[data-chart-datum][data-chart-item-id="b"][data-chart-series-id="sales"]').getAttribute("data-chart-description");
      assert.match(positive, /30万円/); assert.match(negative, /-10万円/);
      assert.ok(Math.abs(Number(positive.match(/割合: ([-\d.]+)%/)[1]) - 60) < 1e-12);
      assert.ok(Math.abs(Number(negative.match(/割合: ([-\d.]+)%/)[1]) + 40) < 1e-12);
    }
    if (config.chartType === "pie") assert.equal(await data.first().getAttribute("fill"), "#123456");
    if (config.comboAxisMode === "dual") {
      assert.match(await data.first().getAttribute("data-chart-description"), /棒・左軸.*30万円/);
      assert.match(await card.locator('[data-chart-datum][data-chart-series-id="rate"]').first().getAttribute("data-chart-description"), /折れ線・右軸.*20%/);
    }
    count++;
  }
  // Every type, both themes and all requested viewport widths, with long safe text.
  let positions = 0;
  for (const config of configs) {
    const model = seed(config, `tooltip-long-${positions}`);
    model.items[0].label = '<img src=x onerror="throw 1">長い項目名'.repeat(2);
    model.series.forEach((series) => { series.name += "長い系列名".repeat(4); });
    model.unit = "長い単位".repeat(4);
    model.appearance.leftAxisTitle = "長い左軸タイトル".repeat(8);
    model.appearance.rightAxisTitle = "長い右軸タイトル".repeat(8);
    model.appearance.comboSecondaryUnit = "長い右単位".repeat(4);
    await loadChart(page, model);
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width: 1100, height: 820 });
      await page.locator('#settingsBtn').click(); await page.locator('#themeSelect').selectOption(theme); await page.locator('#closeSettingsBtn').click();
      for (const width of [320, 375, 390, 430, 1100]) {
        await openPreview(page, width);
        const data = page.locator('#preview [data-chart-datum]');
        await data.first().scrollIntoViewIfNeeded(); await data.first().focus();
        await checkTooltip(page, data.first());
        assert.equal(await page.locator('.chart-data-tooltip img').count(), 0);
        await page.keyboard.press("End"); await checkTooltip(page, data.last());
        if (width < 1100 && config.chartType !== "pie") {
          assert.ok(await data.last().evaluate((el) => el.closest('.chart-block-scroll').scrollLeft) > 0, "矢印移動で図形を横スクロール領域に表示する");
        }
        await page.keyboard.press("Escape"); await closed(page);
        if (width < 1100) await page.locator('#closeCardPaneBtn').click();
        positions++;
      }
    }
  }
  // Extreme finite values and 150 data targets still have a single keyboard entrance.
  const large = seed({ chartType: "bar", barMode: "percent-stacked" }, "tooltip-extremes");
  large.items = Array.from({ length: 50 }, (_, i) => ({ id: `i-${i}`, label: `項目${i}` }));
  large.series = [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE].map((value, index) => ({ id: `s-${index}`, name: `系列${index}`, values: Array(50).fill(value) }));
  await loadChart(page, large);
  assert.equal(await page.locator('#preview [data-chart-datum]').count(), 150);
  assert.equal(await page.locator('#preview [data-chart-datum][tabindex="0"]').count(), 1);
  await page.locator('#preview [data-chart-datum]').first().focus();
  for (let i = 0; i < 3; i++) {
    await checkTooltip(page, page.locator('#preview [data-chart-datum]').nth(i));
    await page.keyboard.press('ArrowRight');
  }
  // Edits, redraw, save, reload and note switches discard stale display state.
  await page.locator('#preview .chart-block-edit').click(); await closed(page);
  await page.locator('#preview [data-chart-datum]').first().focus();
  await page.locator('.chart-block-editor [data-chart-field="chartType"]').selectOption('line'); await closed(page);
  await page.locator('#preview [data-chart-datum]').first().focus();
  await page.locator('.chart-block-editor [data-chart-action="confirm"]').click(); await closed(page);
  await page.waitForFunction(() => document.querySelector('.chart-block-editor > .chart-block-status')?.textContent === "入力内容を保存しました");
  await page.locator('#preview [data-chart-datum]').first().focus();
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#appStartupGuard').waitFor({ state: 'hidden' }); await closed(page);
  await page.locator('#preview [data-chart-datum]').first().focus();
  await page.locator('#newBtn').click(); await closed(page);
  console.log(`Interactive tooltip checks passed: ${count} chart variants, ${positions} type/theme/width positions, 150 targets, lifecycle and persistence`);
}

async function verifyTouchTooltips(browser, appUrl) {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 820 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({ contentType: route.request().url().endsWith('.css') ? 'text/css' : 'text/javascript', body: '' }));
  try {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#appStartupGuard').waitFor({ state: 'hidden' });
    let count = 0;
    for (const config of configs) {
      await loadChart(page, seed(config, `touch-tooltip-${count}`));
      await openPreview(page, 390);
      const data = page.locator('#preview [data-chart-datum]');
      await datumAction(data.first(), 'tap'); await checkTooltip(page, data.first());
      await datumAction(data.first(), 'tap'); await closed(page);
      await datumAction(data.first(), 'tap'); await checkTooltip(page, data.first());
      // A second visible datum changes the one tooltip; keyboard tests cover zero-size data.
      const second = data.nth(1);
      await datumAction(second, 'tap'); await checkTooltip(page, second);
      await page.locator('#closeCardPaneBtn').tap(); await closed(page);
      count++;
    }
    assert.deepEqual(errors, []);
    console.log(`Touch tooltip checks passed: ${count} chart variants at 390px (emulation, not iPhone hardware)`);
  } finally { await context.close(); }
}

module.exports = { verifyChartTooltips, verifyTouchTooltips };
