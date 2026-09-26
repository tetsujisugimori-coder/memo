"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const playwright = require("playwright");
const { createE2eTiming } = require("./e2e-timing.js");
const { verifyTableToChart, verifyTableToChartTouch } = require("./table-to-chart.e2e.js");
const { verifyChartPngClipboard, verifyChartPngClipboardTouch, verifyNativeClipboard } = require("./chart-png-clipboard.e2e.js");
const { verifyChartSvg, verifyChartSvgTouch } = require("./chart-svg-export.e2e.js");
const { verifyChartPng, verifyChartPngTouch } = require("./chart-png-export.e2e.js");
const { verifyChartTsv, verifyChartTsvTouch } = require("./chart-tsv-import.e2e.js");
const { verifyChartTsvCopy, verifyChartTsvCopyTouch } = require("./chart-tsv-copy.e2e.js");
const { verifyChartDataTable, verifyChartDataTableTouch } = require("./chart-data-table.e2e.js");
const { verifyDualAxisCharts } = require("./chart-combo-dual-axis.e2e.js");
const { verifyAxisTitles } = require("./chart-axis-titles.e2e.js");
const { verifyChartTooltips, verifyTouchTooltips } = require("./chart-tooltips.e2e.js");
const { stopCardClickTracing } = require("./chart-card-click-trace.e2e.js");

let appUrl = process.env.MEMO_NEXUS_E2E_URL || "";
const browserName = process.env.MEMO_NEXUS_E2E_BROWSER || "chromium";
const screenshotPath = path.join(os.tmpdir(), "memo-nexus-chart-block-390.png");

async function startStaticServer() {
  if (appUrl) return null;
  const root = __dirname;
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
      const extension = path.extname(filePath);
      response.writeHead(200, { "Content-Type": extension === ".html" ? "text/html; charset=utf-8" : extension === ".css" ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8" });
      response.end(body);
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  appUrl = `http://127.0.0.1:${server.address().port}/`;
  return server;
}

async function launchBrowser() {
  const browserType = playwright[browserName];
  if (!browserType) throw new Error(`Unsupported browser: ${browserName}`);
  try {
    return await browserType.launch({ headless: true });
  } catch (error) {
    const executablePath = path.join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium_headless_shell-1194", "chrome-win", "headless_shell.exe");
    if (browserName !== "chromium" || !fs.existsSync(executablePath)) throw error;
    return browserType.launch({ headless: true, executablePath });
  }
}

async function closeStaticServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function waitForApp(page) {
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("#appStartupGuard").waitFor({ state: "hidden", timeout: 30000 });
  await page.locator("#editor").waitFor({ state: "visible" });
}

async function waitForPieSlices(page, expectedCount) {
  try {
    await page.waitForFunction((count) => document.querySelectorAll("#preview .chart-block-pie-slice").length === count, expectedCount);
  } catch (error) {
    const state = await page.evaluate(() => {
      const chart = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
        .find((segment) => segment.type === "chart")?.chart;
      return {
        chartType: chart?.chartType,
        itemLabels: chart?.items?.map((item) => item.label),
        series: chart?.series,
        inputValues: [...document.querySelectorAll('.chart-block-editor input[data-chart-series-value]')].map((input) => input.value),
        editorChartType: document.querySelector('.chart-block-editor select[data-chart-field="chartType"]')?.value,
        previewClass: document.querySelector("#preview .chart-block")?.className,
        previewSliceCount: document.querySelectorAll("#preview .chart-block-pie-slice").length
      };
    });
    console.error(`Pie preview state: ${JSON.stringify(state)}`);
    throw error;
  }
}

function chart(page) {
  return page.evaluate(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
    .find((segment) => segment.type === "chart")?.chart || null);
}

function charts(page) {
  return page.evaluate(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
    .filter((segment) => segment.type === "chart").map((segment) => segment.chart));
}

async function chartCategoryLabelNames(locator) {
  return locator.evaluateAll((labels) => labels.map((label) => label.getAttribute("aria-label") || ""));
}

async function chartCategoryLabelText(locator) {
  return locator.evaluateAll((labels) => labels.map((label) => [...label.querySelectorAll("tspan")]
    .map((tspan) => tspan.textContent || "").join("")));
}

async function waitForChartCategoryLabelNames(page, selector, expectedNames, expectedCount = expectedNames.length) {
  await page.waitForFunction(({ selector, expectedNames, expectedCount }) => {
    const labels = [...document.querySelectorAll(selector)];
    return labels.length === expectedCount
      && labels.map((label) => label.getAttribute("aria-label") || "").join(",") === expectedNames.join(",");
  }, { selector, expectedNames, expectedCount });
}

async function waitForChartEditorSyncAfterBodyInput(page, expectedCount) {
  // 1. Playwrightが書き込んだ本文自体にマーカーがあることを確認する。
  await page.waitForFunction((count) => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
    .filter((segment) => segment.type === "chart").length === count, expectedCount);
  // 2. full要求の登録、またはその要求が現行revisionの本文モデルからプレビューまで描画済みであることを待つ。
  await page.waitForFunction((count) => window.MemoNexusTypingDerivedUiScheduler?.pendingRequestType() === "full"
    || document.querySelectorAll("#preview .chart-block").length === count, expectedCount);
  await page.waitForFunction((count) => document.querySelectorAll("#preview .chart-block").length === count, expectedCount);
  // 3. 同じfull描画で構造化編集欄も追従したことを最後に確認する。
  await page.waitForFunction((count) => document.querySelectorAll(".chart-block-editor").length === count, expectedCount);
}

async function waitForChartCancelCompletion(page, chartIndex) {
  await page.waitForFunction((index) => document.querySelectorAll(".chart-block-editor")[index]
    ?.querySelector(".chart-block-status")?.textContent === "編集内容を取り消しました", chartIndex);
}

async function checkboxLayout(input) {
  return input.evaluate((checkbox) => {
    const label = checkbox.closest("label");
    const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const textRange = document.createRange();
    textRange.selectNode(textNode);
    const toRect = (rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    return {
      className: label.className,
      display: getComputedStyle(label).display,
      checkbox: toRect(checkbox.getBoundingClientRect()),
      text: toRect(textRange.getBoundingClientRect())
    };
  });
}

function assertInlineCheckboxLayout(layout, name) {
  assert.match(layout.className, /\bchart-block-appearance-checkbox\b/, `${name}に専用クラスを付ける`);
  assert.equal(layout.display, "flex", `${name}を横並びflexで表示する`);
  assert.ok(layout.checkbox.right <= layout.text.left, `${name}のチェックボックスを文言の左に置く`);
  assert.ok(Math.abs((layout.checkbox.top + layout.checkbox.bottom) / 2 - (layout.text.top + layout.text.bottom) / 2) <= 2, `${name}のチェックボックスと文言を縦中央で揃える`);
}

function boxesOverlap(first, second) {
  return first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;
}

function boxesHaveGap(first, second, minimumGap = 2) {
  return first.x + first.width + minimumGap <= second.x || second.x + second.width + minimumGap <= first.x || first.y + first.height + minimumGap <= second.y || second.y + second.height + minimumGap <= first.y;
}



async function verifyDivergingStacks(page, percent = false, step = () => {}) {
  step("Chart setup and preview geometry");
  const barMode = percent ? "percent-stacked" : "stacked";
  await page.setViewportSize({ width: 1100, height: 820 });
  // Responsive mode changes can blur the editor; wait before starting a new input.
  await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
  const seed = {
    id: 'diverging-e2e', chartType: 'bar', title: '発散型積み上げ', unit: percent ? '%' : '万円',
    items: [{ id: 'a', label: percent ? '正負混在のとても長い項目名を省略しても全文を保持' : '正負混在' }, { id: 'b', label: '別の構成' }, { id: 'c', label: 'ゼロ項目' }],
    series: [{ id: 's1', name: '系列A', color: '#123456', values: [30,-20,0] }, { id: 's2', name: '系列B', color: '#dc2626', values: [-10,10,0] }, { id: 's3', name: '系列C', color: '#059669', values: [20,-30,0] }],
    appearance: { barMode, showValues: true, showStackTotals: true, showLegend: true }
  };
  await page.locator('#editor').fill(await page.evaluate((seed) => window.MemoNexusChartBlockUtils.serializeChartBlock(seed), seed));
  const panel = page.locator('.chart-block-editor[data-chart-id="diverging-e2e"]');
  await panel.waitFor({ state: 'visible' });
  const type = panel.locator('[data-chart-field="chartType"]');
  const mode = panel.locator('[data-chart-field="barMode"]');
  const orientation = panel.locator('[data-chart-field="barOrientation"]');
  const input = (item, series) => panel.locator('[data-chart-item-index="' + item + '"] input[data-chart-series-index="' + series + '"]');
  const confirm = panel.locator('[data-chart-action="confirm"]');
  const cancel = panel.locator('[data-chart-action="cancel"]');
  async function geometry(horizontal, values) {
    await page.waitForFunction(({ horizontal, barMode }) => {
      const fig = document.querySelector('#preview figure[data-chart-id="diverging-e2e"]');
      return fig?.dataset.chartBarMode === barMode && fig.classList.contains('chart-block-horizontal-bar-chart') === horizontal;
    }, { horizontal, barMode });
    const state = await page.locator('#preview figure[data-chart-id="diverging-e2e"]').evaluate((figure) => {
      const svg = figure.querySelector('svg');
      const zero = svg.querySelector('.chart-block-zero-line');
      const box = (el) => { const b = el.getBBox(); return { x:b.x,y:b.y,width:b.width,height:b.height }; };
      const totals = [...svg.querySelectorAll('.chart-block-stacked-total-value, .chart-block-percent-stacked-value')];
      const texts = [...svg.querySelectorAll('.chart-block-value,.chart-block-stacked-total-value,.chart-block-axis-value,.chart-block-label')];
      return {
        zero: { x:Number(zero.getAttribute('x1')), y:Number(zero.getAttribute('y1')), count:svg.querySelectorAll('.chart-block-zero-line').length, hidden:zero.getAttribute('aria-hidden'), stroke:getComputedStyle(zero).stroke },
        axes: [...svg.querySelectorAll('line')].map((el) => ['x1','x2','y1','y2'].map((name) => el.getAttribute(name)).join(',')),
        groups: [...svg.querySelectorAll('.chart-block-bar-group')].map((group) => ({
          bars: [...group.querySelectorAll('.chart-block-bar')].map((g) => { const rect=g.querySelector('rect'); return { id:g.dataset.chartSeriesId, title:g.querySelector('title').textContent, rect:rect ? ['x','y','width','height'].map((n)=>Number(rect.getAttribute(n))) : null, color:rect?.getAttribute('fill') }; }),
          totals: [...group.querySelectorAll('.chart-block-stacked-total-value')].map((el) => ({ side:el.dataset.chartTotalSide, description:el.getAttribute('aria-label'), box:box(el) }))
        })),
        collisions: totals.flatMap((total) => texts.filter((other) => other !== total && (() => { const a=box(total),b=box(other); return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y; })()).map((other) => [total.getAttribute('aria-label'),other.textContent])),
        outside: texts.filter((el)=>{const b=box(el),v=svg.viewBox.baseVal;return b.x < -0.1 || b.y < -0.1 || b.x+b.width > v.width+0.1 || b.y+b.height > v.height+0.1;}).map((el)=>el.textContent),
        invalid: [...svg.querySelectorAll('*')].flatMap((el)=>[...el.attributes].filter((a)=>/NaN|Infinity/.test(a.value)).map((a)=>a.name)),
        zeros: [...svg.querySelectorAll('.chart-block-axis-value')].filter((el)=>/^0%?$/.test(el.textContent)).length,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.documentElement.clientWidth,
        ticks: [...svg.querySelectorAll('.chart-block-axis-value')].map((el)=>el.textContent),
        endpoints: Object.fromEntries([...svg.querySelectorAll('.chart-block-axis-value')].map((el)=>[el.textContent, figure.classList.contains('chart-block-horizontal-bar-chart') ? Number(el.getAttribute('x')) : Number(el.getAttribute('y')) - 4])),
        labelsOutsideBars: [...svg.querySelectorAll('.chart-block-percent-stacked-value')].filter((el)=>{ const a=box(el),r=box(el.closest('.chart-block-bar').querySelector('rect')); return a.x<r.x-0.1 || a.y<r.y-0.1 || a.x+a.width>r.x+r.width+0.1 || a.y+a.height>r.y+r.height+0.1; }).map((el)=>el.textContent),
        accessible: figure.querySelector('.sr-only').textContent,
        legend: [...figure.querySelectorAll('.chart-block-legend li')].map((el)=>el.textContent)
      };
    });
    assert.equal(state.zero.count,1); assert.equal(state.zero.hidden,'true'); assert.notEqual(state.zero.stroke,'none');
    assert.equal(new Set(state.axes).size,state.axes.length,'軸線の重複なし');
    assert.equal(state.zeros,1);
    if (state.overflow) console.log("Stack layout overflow", await page.evaluate(() => ({width:innerWidth,mode:document.body.dataset.layoutMode,doc:document.documentElement.scrollWidth,body:document.body.scrollWidth,outside:[...document.querySelectorAll("body *")].filter(el=>{const r=el.getBoundingClientRect();return r.width>0 && r.right>innerWidth;}).slice(0,20).map(el=>({tag:el.tagName,class:el.className,right:el.getBoundingClientRect().right}))})));
    assert.equal(state.overflow,false);
    if (percent) {
      const all = values.flat();
      assert.equal(state.ticks.includes('-100%'), all.some((n)=>n<0));
      assert.equal(state.ticks.includes('100%'), all.some((n)=>n>0) || all.every((n)=>n===0));
    }
    assert.deepEqual(state.invalid,[]); assert.deepEqual(state.outside,[]); assert.deepEqual(state.collisions,[], '合計・割合ラベルの衝突なし');
    assert.deepEqual(state.labelsOutsideBars, [], '割合ラベルを棒の内側へ収める');
    assert.deepEqual(state.legend,seed.series.map((s)=>s.name));
    for (let item=0;item<3;item++) {
      const group=state.groups[item];
      const previous={positive:horizontal?state.zero.x:state.zero.y,negative:horizontal?state.zero.x:state.zero.y};
      assert.deepEqual(group.bars.map((b)=>b.id),seed.series.map((s)=>s.id));
      for (let index=0;index<3;index++) {
        const bar=group.bars[index],value=values[index][item],side=value<0?'negative':'positive';
        assert.ok(bar.title.includes(String(value)));
        if (!bar.rect) {
          const magnitude = Math.max(...(percent ? values.map((series)=>series[item]).filter((n)=>Math.sign(n)===Math.sign(value)) : values.flat()).map(Math.abs));
          assert.ok(value === 0 || Math.abs(value) / magnitude < 1e-12, "通常の非0値の棒を省略しない");
          continue;
        }
        const [x,y,w,h]=bar.rect;
        assert.ok(bar.rect.every(Number.isFinite)&&w>=0&&h>=0); assert.equal(bar.color,seed.series[index].color);
        const start=horizontal?(value<0?x+w:x):(value<0?y:y+h);
        const end=horizontal?(value<0?x:x+w):(value<0?y+h:y);
        assert.ok(Math.abs(start-previous[side])<0.0001,'同符号だけが連続して積み上がる');
        assert.ok(horizontal?(value<0?end<=state.zero.x:end>=state.zero.x):(value<0?end>=state.zero.y:end<=state.zero.y));
        previous[side]=end;
      }
      const itemValues=values.map((s)=>s[item]);
      const positive=itemValues.filter((n)=>n>0),negative=itemValues.filter((n)=>n<0);
      if (percent) {
        assert.deepEqual(group.totals, [], "100%モードに合計ラベルを出さない");
        const sides = { positive, negative };
        for (let index = 0; index < 3; index++) {
          const value = itemValues[index], side = sides[value < 0 ? 'negative' : 'positive'];
          const scale = Math.max(0, ...side.map(Math.abs));
          const sum = scale ? side.reduce((total, n) => total + Math.abs(n) / scale, 0) : 0;
          const expected = sum ? (value / scale) / sum * 100 : 0;
          assert.ok(group.bars[index].title.includes(seed.items[item].label));
          assert.ok(group.bars[index].title.includes(seed.series[index].name));
          assert.ok(group.bars[index].title.includes(`割合: ${expected === 0 ? 0 : expected}%`));
          assert.ok(state.accessible.includes(group.bars[index].title));
          assert.ok(!group.bars[index].title.includes('%%'));
        }
        if (positive.length) assert.ok(Math.abs(previous.positive-state.endpoints['100%'])<0.0001, '正側の端は+100%目盛りと一致');
        if (negative.length) assert.ok(Math.abs(previous.negative-state.endpoints['-100%'])<0.0001, '負側の端は-100%目盛りと一致');
      } else {
        assert.deepEqual(group.totals.map((t)=>t.side),[...(positive.length||!negative.length?['positive']:[]),...(negative.length?['negative']:[])]);
      }
      for (const total of group.totals) {
        const sum=(total.side==='positive'?positive:negative).reduce((a,b)=>a+b,0);
        assert.ok(total.description.includes(Number.isFinite(sum)?String(sum):'上限超過'));
        assert.ok(state.accessible.includes(total.description));
      }
    }
  }
  const datasets = [seed.series.map((s)=>s.values), [[30,30,30],[10,10,10],[20,20,20]], [[-30,-30,-30],[-10,-10,-10],[-20,-20,-20]], [[0,0,0],[0,0,0],[0,0,0]], [[Number.MAX_VALUE,-Number.MAX_VALUE,1e-300],[Number.MAX_VALUE,-Number.MAX_VALUE,-1e300],[-Number.MAX_VALUE,Number.MAX_VALUE,0]], [[1e300,1e300,1e300],[-1e-300,-1e-300,-1e-300],[0,0,0]], [[-1e300,-1e300,-1e300],[1e-300,1e-300,1e-300],[0,0,0]]];
  step("140 geometry combinations across data, theme and width");
  for (const values of datasets) {
    for (let item=0;item<3;item++) for(let series=0;series<3;series++) await input(item,series).fill(String(values[series][item]));
    for(const theme of ['light','dark']) {
      await page.locator('#settingsBtn').click();await page.locator('#themeSelect').selectOption(theme);await page.locator('#closeSettingsBtn').click();
      for(const width of [320,375,390,430,1100]) {
        await page.setViewportSize({width,height:820});
        await page.waitForFunction(w => innerWidth === w && document.body.dataset.layoutMode === (w === 1100 ? 'wide' : 'mobile'), width);
        for(const horizontal of [false,true]) {await orientation.selectOption(horizontal?'horizontal':'vertical');await geometry(horizontal,values);}
      }
    }
  }
  for(let item=0;item<3;item++) for(let series=0;series<3;series++) await input(item,series).fill(String(seed.series[series].values[item]));
  step("save/reload, type changes and invalid drafts");
  for(const kind of ['vertical','horizontal']) {
    await orientation.selectOption(kind); await confirm.click();
    await page.waitForFunction(()=>document.querySelector('.chart-block-editor .chart-block-status')?.textContent==='入力内容を保存しました');
    const saved=await chart(page), savedBody=await page.locator('#editor').inputValue();
    await page.reload({waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});await panel.waitFor({state:'visible'});
    assert.deepEqual(await chart(page),saved);assert.equal(await page.locator('#editor').inputValue(),savedBody);
    await geometry(kind==='horizontal',seed.series.map((s)=>s.values));
    for(const supported of ['grouped','line', ...(percent ? ['stacked'] : ['percent-stacked'])]) {
      if(supported==='line')await type.selectOption('line');else await mode.selectOption(supported);
      assert.deepEqual((await chart(page)).series,seed.series);
      await type.selectOption('bar');await mode.selectOption(barMode);assert.deepEqual((await chart(page)).series,seed.series);
    }
    for(const unsupported of ['pie']) {
      if(unsupported==='pie')await type.selectOption('pie');else await mode.selectOption(unsupported);
      assert.equal(await confirm.isDisabled(),true);assert.match(await panel.locator('.chart-block-editor-preview').textContent(),/負数に未対応/);
      assert.equal(await page.locator('#editor').inputValue(),savedBody);
      await input(0,1).fill('-11');assert.equal(await page.locator('#editor').inputValue(),savedBody);
      if(unsupported==='pie')await type.selectOption('bar');else await mode.selectOption('stacked');
      assert.equal((await chart(page)).series[1].values[0],-11);assert.equal(await confirm.isDisabled(),false);
      await cancel.click();await waitForChartCancelCompletion(page,0);assert.equal(await page.locator('#editor').inputValue(),savedBody);
      if(unsupported==='pie')await type.selectOption('pie');else await mode.selectOption(unsupported);
      await input(0,1).fill('-12');await cancel.click();await waitForChartCancelCompletion(page,0);assert.equal(await page.locator('#editor').inputValue(),savedBody);
    }
    await type.selectOption('pie');await input(0,1).fill('-99');
    await page.reload({waitUntil:'domcontentloaded'});await page.locator('#appStartupGuard').waitFor({state:'hidden'});await panel.waitFor({state:'visible'});
    assert.equal(await page.locator('#editor').inputValue(),savedBody,'未確定エラーをページ終了時に保存しない');
    assert.deepEqual((await chart(page)).series,seed.series);
  }
  if (percent) {
    const savedBody = await page.locator('#editor').inputValue();
    for (const invalid of ['-', 'NaN', 'Infinity', '-Infinity', '1e', '']) {
      await input(0, 0).fill(invalid);
      await confirm.click();
      assert.equal(await input(0, 0).getAttribute('aria-invalid'), 'true');
      assert.equal(await page.locator('#editor').inputValue(), savedBody);
      await cancel.click(); await waitForChartCancelCompletion(page, 0);
    }
    await input(0, 1).fill('-12.5');
    assert.equal((await chart(page)).series[1].values[0], -12.5, '再編集した有限負数を保持');
    await cancel.click(); await waitForChartCancelCompletion(page, 0);
    await panel.locator('[data-chart-item-index="1"] [data-chart-action="move-item-up"]').click();
    await page.waitForFunction(() => document.activeElement?.closest('[data-chart-item-id="b"]'));
    assert.deepEqual((await chart(page)).series.map((series)=>series.values), seed.series.map((series)=>[series.values[1],series.values[0],series.values[2]]));
    await cancel.click(); await waitForChartCancelCompletion(page, 0);
    assert.equal(await page.locator('#editor').inputValue(), savedBody);
  }
  const legacy='<!-- memo-nexus:chart-block:'+Buffer.from(JSON.stringify({id:'legacy-stacked',items:[{label:'旧項目',value:percent ? -30 : 30}],appearance:{barMode}})).toString('hex')+' -->';
  await page.locator('#editor').fill(legacy);await page.locator('.chart-block-editor[data-chart-id="legacy-stacked"]').waitFor({state:'visible'});
  assert.equal(await page.locator('#editor').inputValue(),legacy);
  await page.locator('.chart-block-editor input[data-chart-series-value]').fill(percent ? '-31' : '-30');
  await page.locator('.chart-block-editor [data-chart-action="cancel"]').click();await waitForChartCancelCompletion(page,0);
  assert.equal(await page.locator('#editor').inputValue(),legacy);
  console.log(`Diverging ${barMode} checks passed: 140 geometry combinations, persistence, type switches, invalid drafts, reload and cancel`);
}

function createComboProfile() {
  if (process.env.MEMO_NEXUS_E2E_BROWSER !== "webkit"
    || process.env.MEMO_NEXUS_E2E_COMBO_PROFILE !== "1") return null;
  const samples = [];
  return {
    record(stage, started, context) {
      const ms = performance.now() - started;
      samples.push({ stage, ms, ...context });
      return ms;
    },
    summary() {
      const aggregate = (items) => {
        const result = {};
        for (const item of items) {
          const group = result[item.key] ||= { count: 0, ms: 0, minMs: Infinity, maxMs: 0 };
          group.count += item.count || 1;
          group.ms += item.ms;
          group.minMs = Math.min(group.minMs, item.ms);
          group.maxMs = Math.max(group.maxMs, item.ms);
        }
        return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, {
          count: value.count,
          ms: Math.round(value.ms),
          perCallMs: Math.round(value.ms / value.count * 10) / 10,
          minMs: Math.round(value.minMs * 10) / 10,
          maxMs: Math.round(value.maxMs)
        }]));
      };
      const by = (field, select) => aggregate(samples.filter((sample) => sample[field] !== undefined)
        .map((sample) => ({ key: select ? select(sample[field]) : sample[field], ms: sample.ms })));
      const stages = aggregate(samples.map((sample) => ({ key: sample.stage, ms: sample.ms })));
      const mobileCardShow = aggregate(samples.filter((sample) => sample.stage === "mobile-card-show")
        .map((sample) => ({ key: "mobile-card-show", ms: sample.ms })))["mobile-card-show"] || {
        count: 0, ms: 0, perCallMs: 0, minMs: 0, maxMs: 0
      };
      const conditionTimes = new Map();
      for (const sample of samples) {
        if (sample.dataset === undefined) continue;
        const themes = sample.theme === undefined ? ["light", "dark"] : [sample.theme];
        const widths = sample.width === undefined ? [320, 375, 390, 430, 1100] : [sample.width];
        const share = sample.ms / (themes.length * widths.length);
        for (const theme of themes) for (const width of widths) {
          const key = [sample.seriesCount, sample.dataset, theme, width].join("/");
          conditionTimes.set(key, (conditionTimes.get(key) || 0) + share);
        }
      }
      const slowest = [...conditionTimes.entries()].map(([key, ms]) => {
        const [seriesCount, dataset, theme, width] = key.split("/");
        return { seriesCount: Number(seriesCount), dataset: Number(dataset), theme, width: Number(width), ms: Math.round(ms) };
      }).sort((a, b) => b.ms - a.ms).slice(0, 5);
      const conditions = new Set(samples.filter((sample) => sample.width !== undefined)
        .map((sample) => [sample.seriesCount, sample.dataset, sample.theme, sample.width].join("/"))).size;
      console.log("[COMBO_PROFILE] " + JSON.stringify({
        conditions,
        stages,
        mobileCardShow,
        seriesCounts: by("seriesCount", String),
        datasets: by("dataset", String),
        themes: by("theme"),
        widths: by("width", String),
        slowest
      }));
    }
  };
}

async function verifyComboCharts(page, step = () => {}) {
  step("Chart creation, series editing and persistence");
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
  await page.locator("#editor").fill("複合の新規作成");
  await page.locator("#insertChartBtn").click();
  const panel = page.locator(".chart-block-editor");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "グラフ1のタイトル");
  const type = panel.locator('[data-chart-field="chartType"]');
  const select = panel.locator('[data-chart-field="comboLineSeriesId"]');
  const confirm = panel.locator('[data-chart-action="confirm"]');
  const cancel = panel.locator('[data-chart-action="cancel"]');
  const input = (item, series) => panel.locator('[data-chart-item-index="' + item + '"] input[data-chart-series-index="' + series + '"]');
  const saved = async () => {
    await confirm.click();
    await page.waitForFunction(() => document.querySelector('.chart-block-editor > .chart-block-status')?.textContent === "入力内容を保存しました");
    return page.locator("#editor").inputValue();
  };
  const cancelled = async () => { await cancel.click(); await waitForChartCancelCompletion(page, 0); };
  const beforeSingle = await page.locator("#editor").inputValue();
  await type.selectOption("combo");
  assert.equal(await confirm.isDisabled(), true);
  assert.match(await panel.locator('.chart-block-editor-preview').textContent(), /2系列以上/);
  assert.equal(await page.locator("#editor").inputValue(), beforeSingle);
  await panel.locator('[data-chart-item-field="label"]').fill("最初の項目");
  await input(0, 0).fill("-25");
  assert.equal(await page.locator("#editor").inputValue(), beforeSingle);
  await panel.locator('[data-chart-action="add-series"]').click();
  assert.equal(await confirm.isDisabled(), false);
  assert.equal((await chart(page)).series[0].values[0], -25);
  assert.equal((await chart(page)).items[0].label, "最初の項目");
  await page.waitForFunction(() => document.querySelector('#preview .chart-block-combo circle'));
  assert.equal(await page.locator('#preview .chart-block-bar rect').count(), 1);
  assert.equal(await page.locator('#preview .chart-block-line-point').count(), 1);
  await saved();

  const seed = {
    id: "combo-e2e", chartType: "bar", title: "実績と見込み", unit: "万円",
    items: [{ id: "a", label: "長い日本語の項目名を折り返し省略しても完全な情報を残す東京地域" }, { id: "b", label: "大阪地域" }, { id: "c", label: "名古屋地域" }],
    series: [{ id: "s1", name: "実績", color: "#4f46e5", values: [30, 20, 0] }, { id: "s2", name: "見込み", color: "#dc2626", values: [20, 40, 0] }],
    appearance: { barOrientation: "horizontal", barMode: "stacked", showValues: true, showLegend: true, showStackTotals: true }
  };
  const body = await page.evaluate((seed) => window.MemoNexusChartBlockUtils.serializeChartBlock(seed), seed);
  await page.locator("#editor").fill(body);
  await page.locator('.chart-block-editor[data-chart-id="combo-e2e"]').waitFor({ state: "visible" });
  await type.selectOption("combo");
  assert.equal(await select.inputValue(), "s2", "初回は最後の系列ID");
  assert.equal(await panel.locator('[data-chart-field="barMode"], [data-chart-field="barOrientation"]').count(), 0);
  assert.equal((await chart(page)).appearance.barOrientation, "horizontal");
  assert.equal((await chart(page)).appearance.barMode, "stacked");
  await select.selectOption("s1");
  await panel.locator('[data-chart-series-index="0"] input[data-chart-series-field="name"]').fill("変更後の実績");
  assert.equal(await select.locator('option[value="s1"]').textContent(), "変更後の実績");
  await panel.locator('[data-chart-series-index="0"] input[data-chart-series-field="color"]').evaluate((input) => { input.value = "#059669"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  assert.equal((await chart(page)).appearance.comboLineSeriesId, "s1");
  await panel.locator('[data-chart-series-index="0"] [data-chart-action="move-series-down"]').click();
  await page.waitForFunction(() => document.activeElement?.closest('[data-chart-series-id="s1"]'));
  assert.equal(await select.inputValue(), "s1");
  await panel.locator('[data-chart-item-index="1"] [data-chart-action="move-item-up"]').click();
  await page.waitForFunction(() => document.activeElement?.closest('[data-chart-item-id="b"]'));
  const reordered = await chart(page);
  assert.deepEqual(reordered.items.map((i) => i.id), ["b", "a", "c"]);
  assert.deepEqual(reordered.series.map((s) => s.values), [[40, 20, 0], [20, 30, 0]]);
  const reorderedBody = await saved();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
  await panel.waitFor({ state: "visible" });
  assert.deepEqual(await chart(page), reordered);
  assert.equal(await select.inputValue(), "s1");
  await page.locator('#preview .chart-block-edit').click();
  assert.equal(await panel.evaluate((el) => document.activeElement === el), true);
  await input(0, 0).fill("41"); await cancelled();
  assert.equal(await page.locator("#editor").inputValue(), reorderedBody);
  for (const destination of ["bar", "line", "pie", "bar"]) {
    await type.selectOption(destination);
    assert.deepEqual((await chart(page)).series, reordered.series);
    if (destination === "bar") {
      assert.equal(await panel.locator('[data-chart-field="barOrientation"]').inputValue(), "horizontal");
      assert.equal(await panel.locator('[data-chart-field="barMode"]').inputValue(), "stacked");
    }
    await type.selectOption("combo");
    assert.equal(await select.inputValue(), "s1");
    assert.deepEqual((await chart(page)).items, reordered.items);
  }
  await cancelled(); assert.equal(await page.locator("#editor").inputValue(), reorderedBody);
  for (const mode of ["grouped", "percent-stacked"]) {
    await type.selectOption("bar"); await panel.locator('[data-chart-field="barMode"]').selectOption(mode);
    await type.selectOption("combo"); await type.selectOption("bar");
    assert.equal(await panel.locator('[data-chart-field="barMode"]').inputValue(), mode);
    await type.selectOption("combo");
  }
  await cancelled();
  await panel.locator('[data-chart-action="add-series"]').click();
  const third = (await chart(page)).series.at(-1).id;
  assert.equal(await select.inputValue(), "s1");
  await select.selectOption(third);
  await panel.locator('[data-chart-series-index="2"] [data-chart-action="delete-series"]').click();
  assert.equal(await select.inputValue(), "s1", "選択系列削除時は残存する最後のID");
  const beforeDelete = await page.locator("#editor").inputValue();
  await panel.locator('[data-chart-series-index="1"] [data-chart-action="delete-series"]').click();
  assert.equal(await confirm.isDisabled(), true);
  assert.match(await panel.locator('.chart-block-editor-preview').textContent(), /2系列以上/);
  assert.equal(await page.locator("#editor").inputValue(), beforeDelete);
  await input(0, 0).fill("-44");
  assert.equal(await page.locator("#editor").inputValue(), beforeDelete);
  await type.selectOption("line");
  assert.equal((await chart(page)).series[0].values[0], -44);
  await cancelled(); assert.equal(await page.locator("#editor").inputValue(), reorderedBody);
  for (const invalid of ["", "-", "NaN", "Infinity", "-Infinity", "1e"]) {
    await input(0, 0).fill(invalid); await confirm.click();
    assert.equal(await input(0, 0).getAttribute("aria-invalid"), "true");
    assert.equal(await page.locator("#editor").inputValue(), reorderedBody);
    await cancelled();
  }
  await input(0, 0).fill("-30");
  const negativeBody = await saved();
  await type.selectOption("pie");
  assert.equal(await confirm.isDisabled(), true);
  assert.match(await panel.locator('.chart-block-editor-preview').textContent(), /負数/);
  assert.equal(await page.locator("#editor").inputValue(), negativeBody);
  await type.selectOption("combo"); assert.equal((await chart(page)).series[0].values[0], -30);
  await cancelled(); assert.equal(await page.locator("#editor").inputValue(), negativeBody);

  async function geometry(model) {
    let started = profile && performance.now();
    const state = await page.locator('#preview .chart-block-combo').evaluate((figure) => {
      const svg = figure.querySelector("svg"), view = svg.viewBox.baseVal;
      const box = (el) => { const b = el.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
      const texts = [...svg.querySelectorAll('text')];
      const labels = [...svg.querySelectorAll('.chart-block-value')];
      const marks = [...svg.querySelectorAll('rect, circle, polyline')];
      const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      const obstacles = [...texts, ...marks].flatMap((el) => {
        if (el.tagName !== "polyline") return [{ element: el, box: box(el) }];
        return Array.from({ length: Math.max(0, el.points.numberOfItems - 1) }, (_, index) => {
          const a = el.points.getItem(index), b = el.points.getItem(index + 1);
          return { element: el, box: { x: Math.min(a.x, b.x) - 2, y: Math.min(a.y, b.y) - 2, width: Math.abs(b.x - a.x) + 4, height: Math.abs(b.y - a.y) + 4 } };
        });
      });
      const zero = svg.querySelector('.chart-block-zero-line');
      const bars = [...svg.querySelectorAll('.chart-block-bar')];
      const line = svg.querySelector('.chart-block-line-series');
      return {
        visible: figure.closest("#previewCard").getAttribute("aria-hidden") === "false" && svg.getBoundingClientRect().width > 0,
        width: view.width, top: Number(svg.querySelector('line.chart-block-axis').getAttribute('y1')), bottom: Number(svg.querySelector('line.chart-block-axis').getAttribute('y2')),
        zero: Number(zero.getAttribute('y1')), zeroCount: svg.querySelectorAll('.chart-block-zero-line').length, hidden: zero.getAttribute('aria-hidden'),
        zeroTicks: [...svg.querySelectorAll('.chart-block-axis-value')].filter((el) => el.textContent === '0').length,
        axes: [...svg.querySelectorAll('line')].map((el) => ['x1', 'x2', 'y1', 'y2'].map((a) => el.getAttribute(a)).join(',')),
        bars: bars.map((g) => ({ item: g.dataset.chartItemId, series: g.dataset.chartSeriesId, rect: Object.fromEntries(['x', 'y', 'width', 'height'].map((name) => [name, Number(g.querySelector('rect').getAttribute(name))])), color: g.querySelector('rect').getAttribute('fill'), title: g.querySelector('title').textContent })),
        points: [...svg.querySelectorAll('.chart-block-line-item')].map((g) => ({ item: g.dataset.chartItemId, series: g.dataset.chartSeriesId, x: Number(g.querySelector('circle').getAttribute('cx')), y: Number(g.querySelector('circle').getAttribute('cy')), color: g.querySelector('circle').getAttribute('stroke'), title: g.querySelector('title').textContent })),
        foreground: bars.every((g) => Boolean(g.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING)),
        invalid: [...svg.querySelectorAll('*')].flatMap((el) => [...el.attributes].filter((a) => /NaN|Infinity/.test(a.value)).map((a) => a.name)),
        outside: [...texts, ...marks].filter((el) => { const b = box(el); return b.x < -0.1 || b.y < -0.1 || b.x + b.width > view.width + 0.1 || b.y + b.height > view.height + 0.1; }).map((el) => el.outerHTML),
        collisions: labels.flatMap((el) => obstacles.filter((other) => other.element !== el && overlaps(box(el), other.box)).map((other) => [el.textContent, other.element.tagName, box(el), other.box])),
        axisStrokes: [...svg.querySelectorAll('line')].map((el) => getComputedStyle(el).stroke),
        lineStroke: getComputedStyle(svg.querySelector('polyline')).stroke,
        accessible: figure.querySelector('.sr-only').textContent, aria: svg.getAttribute('aria-label'),
        legend: [...figure.querySelectorAll('.chart-block-legend li')].map((el) => el.textContent),
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth > document.documentElement.clientWidth
      };
    });
    if (profile) {
      profile.record("geometry-read", started, condition);
      started = performance.now();
      phase = "geometry-assert";
    }
    assert.equal(state.visible, true, "カードを開いた実表示を検証");
    assert.equal(state.foreground, true); assert.equal(state.zeroCount, 1); assert.equal(state.zeroTicks, 1); assert.equal(state.hidden, "true");
    assert.equal(new Set(state.axes).size, state.axes.length);
    assert.deepEqual(state.invalid, []); assert.deepEqual(state.outside, []); assert.deepEqual(state.collisions, []);
    assert.equal(state.docOverflow, false); assert.equal(state.bodyOverflow, false);
    assert.ok(state.axisStrokes.every((stroke) => stroke !== "none" && stroke !== "rgba(0, 0, 0, 0)"));
    assert.notEqual(state.lineStroke, "none"); assert.match(state.aria, /複合グラフ、単一Y軸/); assert.ok(state.aria.includes(model.title) && state.aria.includes(model.unit));
    const selected = model.appearance.comboLineSeriesId;
    assert.deepEqual(state.legend, model.series.map((s) => s.name + (s.id === selected ? "（折れ線）" : "（棒）")));
    assert.equal(state.bars.length, model.items.length * (model.series.length - 1)); assert.equal(state.points.length, model.items.length);
    const values = model.series.flatMap((s) => s.values), magnitude = Math.max(...values.map(Math.abs));
    const low = magnitude ? Math.min(0, ...values) / magnitude : 0, high = magnitude ? Math.max(0, ...values) / magnitude : 0;
    const expectedY = (v) => magnitude ? state.bottom - (v / magnitude - low) / (high - low) * (state.bottom - state.top) : state.bottom;
    assert.ok(Math.abs(state.zero - expectedY(0)) < 1e-8);
    for (const mark of [...state.bars, ...state.points]) {
      const series = model.series.find((s) => s.id === mark.series), index = model.items.findIndex((i) => i.id === mark.item), value = series.values[index];
      assert.equal(mark.color, series.color); assert.ok(mark.title.includes(model.items[index].label)); assert.ok(mark.title.includes(String(value)));
      assert.ok(state.accessible.includes(model.items[index].label) && state.accessible.includes(String(value)));
      if (mark.rect) {
        assert.notEqual(mark.series, selected); assert.match(mark.title, /（棒）/);
        assert.ok(Object.values(mark.rect).every(Number.isFinite)); assert.ok(mark.rect.width >= 0 && mark.rect.height >= 0);
        assert.ok(Math.abs(mark.rect.y - Math.min(state.zero, expectedY(value))) < 1e-8);
        assert.ok(Math.abs(mark.rect.height - Math.abs(state.zero - expectedY(value))) < 1e-8);
      } else {
        assert.equal(mark.series, selected); assert.match(mark.title, /（折れ線）/);
        assert.ok(Number.isFinite(mark.x) && Number.isFinite(mark.y)); assert.ok(Math.abs(mark.y - expectedY(value)) < 1e-8);
        const bars = state.bars.filter((b) => b.item === mark.item), left = Math.min(...bars.map((b) => b.rect.x)), right = Math.max(...bars.map((b) => b.rect.x + b.rect.width));
        assert.ok(Math.abs(mark.x - (left + right) / 2) < 1e-8, "点は棒グループの中央");
      }
    }
    if (profile) profile.record("geometry-assert", started, condition);
  }

  const datasets = [ [[30,20,0],[20,40,0],[10,20,0]], [[-30,-20,0],[-20,-40,0],[-10,-20,0]], [[30,-20,0],[-20,40,0],[10,-30,0]], [[0,0,0],[0,0,0],[0,0,0]], [[Number.MAX_VALUE,-Number.MAX_VALUE,0],[-Number.MAX_VALUE,Number.MAX_VALUE,0],[1e-300,-1e300,0]], [[1e300,-1e-300,0],[1e-300,-1e300,0],[Number.MIN_VALUE,-Number.MIN_VALUE,0]] ];
  const profile = createComboProfile();
  let condition = {};
  let phase = "series-setup";
  step("120 geometry combinations across data, theme and width");
  let geometryCount = 0;
  try {
  for (const count of [2, 3]) {
    condition = { seriesCount: count };
    if (count === 3) {
      phase = "series-setup";
      const started = profile && performance.now();
      await panel.locator('[data-chart-action="add-series"]').click();
      if (profile) profile.record(phase, started, condition);
    }
    for (const [dataset, values] of datasets.entries()) {
      condition = { seriesCount: count, dataset };
      phase = "data-preview";
      let started = profile && performance.now();
      for (let item = 0; item < 3; item++) for (let series = 0; series < count; series++) await input(item, series).fill(String(values[series][item]));
      await select.selectOption((await chart(page)).series.at(-1).id);
      const model = await chart(page);
      await page.waitForFunction((model) => {
        const fig = document.querySelector('#preview .chart-block-combo');
        return model.items.every((item, index) => model.series.every((s) => [...(fig?.querySelectorAll('g > title') || [])].some((el) => el.textContent === item.label + '、' + s.name + (s.id === model.appearance.comboLineSeriesId ? '（折れ線）' : '（棒）') + ': ' + String(s.values[index]) + model.unit)));
      }, model);
      if (profile) profile.record(phase, started, condition);
      for (const theme of ["light", "dark"]) {
        condition = { seriesCount: count, dataset, theme };
        phase = "theme";
        started = profile && performance.now();
        await page.locator("#settingsBtn").click(); await page.locator("#themeSelect").selectOption(theme); await page.locator("#closeSettingsBtn").click();
        if (profile) profile.record(phase, started, condition);
        for (const width of [320, 375, 390, 430, 1100]) {
          condition = { seriesCount: count, dataset, theme, width };
          phase = "viewport-layout";
          started = profile && performance.now();
          await page.setViewportSize({ width, height: 820 });
          await page.waitForFunction((width) => innerWidth === width && document.body.dataset.layoutMode === (width >= 1100 ? 'wide' : 'mobile'), width);
          if (profile) profile.record(phase, started, condition);
          if (width < 1100) {
            phase = "mobile-card-show";
            started = profile && performance.now();
            let stageStarted = profile && performance.now();
            if (await page.locator("#contextPanel").getAttribute("aria-hidden") === "false") {
              if (profile) profile.record("mobile-show-context-state", stageStarted);
              stageStarted = profile && performance.now();
              await page.locator("#closeContextPanelBtn").click();
              if (profile) profile.record("mobile-show-context-close-click", stageStarted);
              stageStarted = profile && performance.now();
              await page.waitForFunction(() => document.getElementById("contextPanel").getAttribute("aria-hidden") === "true");
              if (profile) profile.record("mobile-show-context-close-wait", stageStarted);
            } else if (profile) {
              profile.record("mobile-show-context-state", stageStarted);
            }
            stageStarted = profile && performance.now();
            await page.locator("#cardPaneBtn").click();
            if (profile) profile.record("mobile-show-card-click", stageStarted);
            stageStarted = profile && performance.now();
            await page.waitForFunction(() => { const card = document.getElementById("previewCard"); return card.getAttribute("aria-hidden") === "false" && Math.abs(card.getBoundingClientRect().right - innerWidth) < 1; });
            if (profile) profile.record("mobile-show-card-condition-wait", stageStarted);
            if (profile) profile.record(phase, started, condition);
          }
          await geometry(model); geometryCount++;
          if (width < 1100) {
            phase = "mobile-card-close";
            started = profile && performance.now();
            await page.locator("#closeCardPaneBtn").click();
            await page.waitForFunction(() => document.getElementById("previewCard").getAttribute("aria-hidden") === "true");
            if (profile) profile.record(phase, started, condition);
          }
        }
      }
    }
  }
  } catch (error) {
    error.message += ` [combo condition=${JSON.stringify(condition)}, phase=${phase}]`;
    throw error;
  } finally {
    profile?.summary();
  }
  assert.equal(geometryCount, 120, "2/3 series × 6 datasets × 2 themes × 5 widths");
  const finalBody = await saved(), finalModel = await chart(page);
  step("final save/reload and legacy fallback");
  await page.reload({ waitUntil: "domcontentloaded" }); await page.locator("#appStartupGuard").waitFor({ state: "hidden" }); await panel.waitFor({ state: "visible" });
  assert.equal(await page.locator("#editor").inputValue(), finalBody); assert.deepEqual(await chart(page), finalModel); await geometry(finalModel);
  const invalidId = { ...finalModel, id: "combo-fallback", appearance: { ...finalModel.appearance, comboLineSeriesId: "deleted" } };
  const raw = '<!-- memo-nexus:chart-block:' + Buffer.from(JSON.stringify(invalidId)).toString('hex') + ' -->';
  await page.locator("#editor").fill(raw);
  await page.locator('.chart-block-editor[data-chart-id="combo-fallback"]').waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector('[data-chart-field="comboLineSeriesId"]')?.value === window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById('editor').value).find((s) => s.type === 'chart').chart.series.at(-1).id);
  assert.equal(await page.locator("#editor").inputValue(), raw);
  await input(0, 0).fill("15"); await cancelled(); assert.equal(await page.locator("#editor").inputValue(), raw);
  console.log("Combo checks passed: " + geometryCount + " geometry combinations, stable IDs, shared axis, save/reload, type switches, invalid drafts and cancel");
}

async function verifySignedCharts(page) {
  await page.setViewportSize({ width: 1100, height: 820 });
  // Responsive mode changes can blur the editor; wait before starting a new input.
  await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
  const seed = {
    id: "signed-e2e", chartType: "bar", title: "正負の比較", unit: "万円",
    items: [{ id: "a", label: "正負の項目A" }, { id: "b", label: "ゼロ項目B" }, { id: "c", label: "正負の項目C" }],
    series: [{ id: "s1", name: "売上", color: "#123456", values: [30, 0, 25.75] }, { id: "s2", name: "利益", color: "#dc2626", values: [20, 0, 15] }],
    appearance: { showValues: true, showLegend: true }
  };
  const body = await page.evaluate((seed) => window.MemoNexusChartBlockUtils.serializeChartBlock(seed), seed);
  await page.locator("#editor").fill(body);
  assert.equal(await page.locator("#editor").inputValue(), body, "レイアウト反映後に負数テスト本文を入力する");
  await page.waitForFunction(() => document.querySelector('.chart-block-editor[data-chart-id="signed-e2e"]'));
  const panel = page.locator('.chart-block-editor[data-chart-id="signed-e2e"]');
  const input = (item, series) => panel.locator('[data-chart-item-index="' + item + '"] input[data-chart-series-index="' + series + '"]');
  const type = panel.locator('[data-chart-field="chartType"]');
  const mode = panel.locator('[data-chart-field="barMode"]');
  const orientation = panel.locator('[data-chart-field="barOrientation"]');
  const confirm = panel.locator('[data-chart-action="confirm"]');
  const cancel = panel.locator('[data-chart-action="cancel"]');
  await input(0, 0).fill("-30");
  await input(2, 1).fill("-15");
  await page.waitForFunction(() => document.querySelector('#preview figure[data-chart-id="signed-e2e"] .chart-block-bar title')?.textContent.includes("-30"));
  const expectedSeries = (await chart(page)).series;
  assert.deepEqual(expectedSeries.map((s) => s.values), [[-30, 0, 25.75], [20, 0, -15]]);

  async function geometry(kind) {
    const state = await page.locator('#preview figure[data-chart-id="signed-e2e"]').evaluate((figure) => {
      const svg = figure.querySelector('svg');
      const zero = svg.querySelector('.chart-block-zero-line');
      const model = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById('editor').value).find((s) => s.type === 'chart').chart;
      const valueOf = (el) => model.series.find((s) => s.id === el.dataset.chartSeriesId).values[model.items.findIndex((i) => i.id === el.dataset.chartItemId)];
      return {
        magnitude: Math.max(...model.series.flatMap((s) => s.values.map(Math.abs))),
        zero: { x: Number(zero.getAttribute('x1')), y: Number(zero.getAttribute('y1')), hidden: zero.getAttribute('aria-hidden'), count: svg.querySelectorAll('.chart-block-zero-line').length, stroke: getComputedStyle(zero).stroke },
        bars: [...svg.querySelectorAll('.chart-block-bar')].map((g) => { const r = g.querySelector('rect'); return { value: valueOf(g), rect: r ? ['x','y','width','height'].map((n) => Number(r.getAttribute(n))) : null, label: g.querySelector('.chart-block-value')?.textContent, fill: r?.getAttribute('fill'), color: model.series.find((s) => s.id === g.dataset.chartSeriesId).color }; }),
        points: [...svg.querySelectorAll('.chart-block-line-item')].map((g) => ({ value: valueOf(g), y: Number(g.querySelector('circle')?.getAttribute('cy')) })),
        paths: [...svg.querySelectorAll('polyline')].map((p) => p.getAttribute('points')),
        invalid: [...svg.querySelectorAll('*')].flatMap((el) => [...el.attributes].filter((attr) => /NaN|Infinity/.test(attr.value)).map((attr) => attr.name)),
        tickZeros: [...svg.querySelectorAll('.chart-block-axis-value')].filter((t) => t.textContent === '0').length,
        outside: [...svg.querySelectorAll('.chart-block-value, .chart-block-axis-value')].filter((el) => { const b=el.getBBox(), v=svg.viewBox.baseVal; return b.x < -0.1 || b.y < -0.1 || b.x+b.width > v.width+0.1 || b.y+b.height > v.height+0.1; }).map((el) => el.textContent),
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth > document.documentElement.clientWidth,
        legend: [...figure.querySelectorAll('.chart-block-legend li')].map((el) => el.textContent)
      };
    });
    assert.equal(state.zero.count, 1);
    assert.equal(state.zero.hidden, 'true');
    assert.notEqual(state.zero.stroke, 'none');
    assert.deepEqual(state.invalid, []);
    assert.deepEqual(state.outside, [], kind + 'の数値をSVG内へ収める');
    assert.equal(state.tickZeros, 1);
    assert.equal(state.docOverflow, false);
    assert.equal(state.bodyOverflow, false);
    assert.deepEqual(state.legend, ['売上', '利益']);
    if (kind === 'line') {
      assert.equal(state.paths.length, 2);
      for (const point of state.points) {
        assert.ok(Number.isFinite(point.y));
        assert.ok(point.value > 0 ? point.y <= state.zero.y : point.value < 0 ? point.y >= state.zero.y : Math.abs(point.y-state.zero.y)<0.01);
        if (Math.abs(point.value) / state.magnitude > 1e-10) assert.ok(point.value > 0 ? point.y < state.zero.y : point.y > state.zero.y);
      }
    } else {
      for (const bar of state.bars) {
        if (!bar.rect) { assert.equal(bar.value, 0); continue; }
        const [x,y,w,h] = bar.rect;
        assert.ok(bar.rect.every(Number.isFinite) && w >= 0 && h >= 0);
        assert.equal(bar.fill, bar.color);
        if (kind === 'horizontal') assert.ok(bar.value < 0 ? Math.abs(x+w-state.zero.x)<0.01 && x<=state.zero.x : Math.abs(x-state.zero.x)<0.01);
        else assert.ok(bar.value < 0 ? Math.abs(y-state.zero.y)<0.01 && y+h>=state.zero.y : Math.abs(y+h-state.zero.y)<0.01);
        if (Math.abs(bar.value) / state.magnitude > 1e-10) assert.ok(kind === 'horizontal' ? w > 0 : h > 0);
        if (bar.value < 0) assert.match(bar.label, /^-/);
      }
    }
  }

  for (const theme of ['light', 'dark']) {
    await page.locator('#settingsBtn').click();
    await page.locator('#themeSelect').selectOption(theme);
    await page.locator('#closeSettingsBtn').click();
    for (const width of [320, 375, 390, 430, 1100]) {
      await page.setViewportSize({ width, height: 820 });
      for (const kind of ['vertical', 'horizontal', 'line']) {
        await type.selectOption(kind === 'line' ? 'line' : 'bar');
        if (kind !== 'line') await orientation.selectOption(kind);
        await page.waitForFunction((kind) => {
          const fig = document.querySelector('#preview figure[data-chart-id="signed-e2e"]');
          return kind === 'line' ? !!fig?.querySelector('polyline') : fig?.classList.contains('chart-block-bar-chart') && (fig.classList.contains('chart-block-horizontal-bar-chart') === (kind === 'horizontal'));
        }, kind);
        await geometry(kind);
        assert.deepEqual((await chart(page)).series, expectedSeries);
      }
    }
  }
  await page.setViewportSize({ width: 1100, height: 820 });
  // Responsive mode changes can blur the editor; wait before starting a new input.
  await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
  await type.selectOption('bar');
  await orientation.selectOption('vertical');
  await confirm.click();
  await page.waitForFunction(() => document.querySelector('.chart-block-editor .chart-block-status')?.textContent === '入力内容を保存しました');
  const savedBody = await page.locator('#editor').inputValue();
  const saved = await chart(page);
  for (const unsupported of ['pie']) {
    if (unsupported === 'pie') await type.selectOption('pie');
    else await mode.selectOption(unsupported);
    assert.match(await panel.locator('.chart-block-editor-preview').textContent(), /負数に未対応/);
    assert.equal(await confirm.isDisabled(), true);
    assert.equal(await page.locator('#editor').inputValue(), savedBody, '未対応形式を自動保存対象の本文へ書かない');
    assert.equal(await input(0, 0).inputValue(), '-30');
    await input(0, 0).fill('-31');
    assert.equal(await page.locator('#editor').inputValue(), savedBody, '未対応形式での追加編集も一時保持する');
    if (unsupported === 'pie') await type.selectOption('line');
    else await mode.selectOption('grouped');
    assert.equal(await confirm.isDisabled(), false);
    assert.equal((await chart(page)).series[0].values[0], -31);
    await cancel.click();
    await waitForChartCancelCompletion(page, 0);
    assert.deepEqual(await chart(page), saved, '取消で対応形式と全系列・設定へ戻す');
  }
  await mode.selectOption('percent-stacked');
  await cancel.click();
  await waitForChartCancelCompletion(page, 0);
  assert.equal(await page.locator('#editor').inputValue(), savedBody, '100%形式への切替から直接取消できる');
  await input(0, 0).fill('-');
  await type.selectOption('line');
  assert.equal(await input(0, 0).inputValue(), '-', '途中入力を種類切替で消さない');
  await confirm.click();
  assert.equal(await input(0, 0).getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('#editor').inputValue(), savedBody);
  await input(0, 0).fill('-30');
  await confirm.click();
  await page.waitForFunction(() => document.querySelector('.chart-block-editor .chart-block-status')?.textContent === '入力内容を保存しました');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#appStartupGuard').waitFor({ state: 'hidden' });
  assert.deepEqual(await chart(page), saved, 'flushSaveと再読み込みで全系列・負数・設定を復元する');
  assert.equal(await page.locator('#editor').inputValue(), savedBody, '読むだけでは本文を書き換えない');
  await geometry('vertical');
  // Reordering through the real editor retains ID/value/color correspondence.
  await panel.locator('[data-chart-item-index="2"] [data-chart-action="move-item-up"]').click();
  await page.waitForFunction(() => document.activeElement?.closest('[data-chart-item-id="c"]'));
  assert.deepEqual((await chart(page)).series.map((s) => s.values), [[-30, 25.75, 0], [20, -15, 0]]);
  await panel.locator('[data-chart-series-id="s2"] [data-chart-action="move-series-up"]').click();
  await page.waitForFunction(() => document.activeElement?.closest('[data-chart-series-id="s2"]'));
  assert.deepEqual((await chart(page)).series.map((s) => [s.id, s.color]), [['s2','#dc2626'],['s1','#123456']]);
  await cancel.click();
  await waitForChartCancelCompletion(page, 0);
  assert.deepEqual(await chart(page), saved);
  // Extreme and one-sided ranges are entered through the existing text inputs.
  for (const values of [[-Number.MAX_VALUE, Number.MAX_VALUE], [-1e-300, 1e300], [-0.5, -30], [0, 0]]) {
    for (let item=0; item<3; item++) for (let series=0; series<2; series++) await input(item, series).fill(String(values[series]));
    for (const kind of ['vertical','horizontal','line']) {
      await type.selectOption(kind === 'line' ? 'line' : 'bar');
      if (kind !== 'line') await orientation.selectOption(kind);
      await page.waitForFunction(({ kind, values }) => {
        const fig = document.querySelector('#preview figure[data-chart-id="signed-e2e"]');
        const correctKind = kind === 'line' ? fig?.classList.contains('chart-block-line') : fig?.classList.contains('chart-block-bar-chart') && fig.classList.contains('chart-block-horizontal-bar-chart') === (kind === 'horizontal');
        return correctKind && fig?.querySelector('.chart-block-bar title, .chart-block-line-item title')?.textContent.includes(String(values[0]));
      }, { kind, values });
      await geometry(kind);
    }
  }
  await cancel.click();
  await waitForChartCancelCompletion(page, 0);
  for (const kind of ['horizontal', 'line']) {
    await type.selectOption(kind === 'line' ? 'line' : 'bar');
    if (kind === 'horizontal') await orientation.selectOption(kind);
    await confirm.click();
    await page.waitForFunction(() => document.querySelector('.chart-block-editor .chart-block-status')?.textContent === '入力内容を保存しました');
    const beforeReload = await chart(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#appStartupGuard').waitFor({ state: 'hidden' });
    assert.deepEqual(await chart(page), beforeReload, kind + 'も保存・再編集で負数と設定を維持する');
    await geometry(kind);
  }
  const legacyBody = '旧形式の本文\n<!-- memo-nexus:chart-block:' + Buffer.from(JSON.stringify({
    id: 'legacy-negative-e2e', chartType: 'bar', items: [{ id: 'a', label: '旧形式', value: -0.5 }, { id: 'b', label: '正数', value: 25.75 }]
  })).toString('hex') + ' -->\n本文の続き';
  await page.locator('#editor').fill(legacyBody);
  const legacyPanel = page.locator('.chart-block-editor[data-chart-id="legacy-negative-e2e"]');
  await legacyPanel.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#editor').inputValue(), legacyBody);
  await legacyPanel.locator('[data-chart-item-index="0"] input[data-chart-series-value]').fill('-0.75');
  await legacyPanel.locator('[data-chart-action="cancel"]').click();
  await waitForChartCancelCompletion(page, 0);
  assert.equal(await page.locator('#editor').inputValue(), legacyBody, '旧マーカーも取消時に元の本文をバイト単位で復元する');
  console.log('Signed chart checks passed: 5 widths, light/dark, geometry, unsupported drafts, persistence, cancel and extremes');
}

(async () => {
  let server = null;
  let browser = null;
  let runError = null;
  const featureFlag = process.argv.indexOf("--feature");
  const selectedFeature = featureFlag < 0 ? "" : process.argv[featureFlag + 1];
  if (featureFlag >= 0 && !selectedFeature) throw new Error("--feature requires a feature name");
  const report = createE2eTiming(`Chart E2E (${browserName})`, selectedFeature);

  async function runPageFeature(name, verify) {
    await report.feature(name, async ({ beginStep }) => {
      beginStep("fresh browser context and editor startup");
      const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
      const pageErrors = [];
      const consoleErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      try {
        await page.route("https://cdn.jsdelivr.net/**", (route) => {
          const pathname = new URL(route.request().url()).pathname.toLowerCase();
          return pathname.endsWith(".css")
            ? route.fulfill({ contentType: "text/css", body: "" })
            : route.fulfill({ contentType: "text/javascript", body: "window.katex={renderToString:String};window.mermaid={initialize(){},render:async()=>({svg:'<svg></svg>'})};window.hljs={highlightAuto:()=>({value:''}),getLanguage:()=>false};" });
        });
        await waitForApp(page);
        beginStep("UI operations and assertions");
        await verify(page, beginStep);
        assert.deepEqual(pageErrors, [], `ページエラーなし: ${pageErrors.join("\n")}`);
        assert.deepEqual(consoleErrors, [], `console errorなし: ${consoleErrors.join("\n")}`);
      } catch (error) {
        if (!page.isClosed()) {
          console.error("Chart failure state:", JSON.stringify(await page.evaluate(() => ({
            charts: window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).filter((segment) => segment.type === "chart").map((segment) => segment.chart),
            chartStatus: [...document.querySelectorAll(".chart-block-status")].map((el) => el.textContent)
          })).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) }))));
        }
        throw error;
      } finally {
        try {
          await stopCardClickTracing(page);
        } finally {
          await page.close();
        }
      }
    });
  }

  try {
    server = await startStaticServer();
    browser = await launchBrowser();
    await runPageFeature("chart-create-edit-save", async (page, step) => {
      step("chart-create: insert and render");
    await page.locator("#editor").fill("グラフの前\nグラフの後");
    await page.locator("#insertChartBtn").click();
    const editor = page.locator(".chart-block-editor");
    await editor.waitFor({ state: "visible" });
    // Insertion focuses the title on the next animation frame. Finish that
    // focus handoff before fill() can move to another field.
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "グラフ1のタイトル");
    assert.equal(await editor.locator('button[data-chart-action="move-item-up"]').isDisabled(), true, "1項目だけでは上へを無効化する");
    assert.equal(await editor.locator('button[data-chart-action="move-item-down"]').isDisabled(), true, "1項目だけでは下へを無効化する");
    assert.equal(await editor.locator('button[data-chart-action="move-item-up"]').getAttribute("aria-label"), "1件目の項目を上へ移動", "空の項目名は項目番号で移動操作を識別する");
    assert.equal(await editor.locator('button[data-chart-action="move-series-up"]').isDisabled(), true, "1系列だけでは系列の上へを無効化する");
    assert.equal(await editor.locator('button[data-chart-action="move-series-down"]').isDisabled(), true, "1系列だけでは系列の下へを無効化する");
    await editor.locator('input[aria-label="グラフ1のタイトル"]').fill("テスト得点");
    await editor.locator('input[aria-label="グラフ1の単位"]').fill("点");
    assert.equal(await editor.locator('input[aria-label="グラフ1のタイトル"]').inputValue(), "テスト得点");
    assert.equal(await editor.locator('input[aria-label="グラフ1の単位"]').inputValue(), "点");
    await editor.locator('input[aria-label="1件目の項目名"]').fill("国語");
    await editor.locator('input[aria-label="1件目の数値"]').fill("70.5");
    await editor.locator('button[data-chart-action="add-item"]').click();
    await page.waitForFunction(() => document.activeElement?.matches('.chart-block-item-row[data-chart-item-index="1"] input[data-chart-item-field="label"]'));
    await editor.locator('input[aria-label="2件目の項目名"]').fill("数学");
    await editor.locator('input[aria-label="2件目の数値"]').fill("0");
    await editor.locator('input[aria-label="グラフ1の棒の色"]').evaluate((input) => { input.value = "#dc2626"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    assertInlineCheckboxLayout(await checkboxLayout(editor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]')), "棒の上に数値を表示");
    await editor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]').uncheck();
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.title === "テスト得点" && current.unit === "点" && current.items.length === 2 && current.series[0].values[0] === 70.5 && current.series[0].values[1] === 0 && current.appearance.color === "#dc2626" && current.appearance.showValues === false;
    });
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 2);
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-value").length === 0);
    assert.equal(await page.locator("#preview .chart-block-bar").count(), 2, "保存前プレビューは2本の棒を描画する");
    assert.equal(await page.locator("#preview .chart-block-value").count(), 0, "数値表示オフを即時反映する");
    assert.equal(await page.locator("#preview .chart-block-bar rect").first().getAttribute("fill"), "#dc2626", "選択色を全棒へ反映する");
    assert.equal(await page.locator("#preview .chart-block-edit").count(), 1, "カードに再編集操作を表示する");
    await page.locator("#preview .chart-block-edit").click();
    assert.equal(await editor.evaluate((element) => document.activeElement === element), true, "カードの編集操作が対応する編集欄へ移動する");
    step("chart-edit: validation and type changes");
    const firstValue = editor.locator('input[aria-label="1件目の数値"]');
    await firstValue.fill("");
    assert.equal(await firstValue.getAttribute("aria-invalid"), "true", "空の数値欄を不正として公開する");
    assert.equal((await chart(page)).series[0].values[0], 70.5, "不正な空入力は直前の有効な保存値を置き換えない");
    await editor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "1件目の数値");
    assert.match(await editor.locator(".chart-block-status").textContent(), /数値は有限な数値/, "不正値では保存成功を表示しない");
    await firstValue.fill("-1");
    assert.equal(await firstValue.getAttribute("aria-invalid"), null, "集合棒は有限な負数を受け付ける");
    assert.equal((await chart(page)).series[0].values[0], -1, "負数を保存モデルへ保持する");
    await firstValue.fill("NaN");
    assert.equal(await firstValue.getAttribute("aria-invalid"), "true", "NaNを不正として公開する");
    await firstValue.fill("Infinity");
    assert.equal(await firstValue.getAttribute("aria-invalid"), "true", "有限でない数値を不正として公開する");
    await firstValue.fill("72.25");
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart.series[0].values[0] === 72.25);
    assert.equal(await firstValue.getAttribute("aria-invalid"), null, "有効な数値へ修正すると不正状態を解除する");
    await editor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    await editor.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart.chartType === "line");
    const lineEditor = page.locator(".chart-block-editor");
    assert.equal(await lineEditor.locator('input[aria-label="1件目の項目名"]').inputValue(), "国語", "棒グラフから折れ線グラフへの切替でも項目名を保持する");
    assert.equal(await lineEditor.locator('input[aria-label="1件目の数値"]').inputValue(), "72.25", "棒グラフから折れ線グラフへの切替でも数値を保持する");
    assert.equal(await lineEditor.locator('input[aria-label="グラフ1のデータ点を表示"]').isChecked(), true, "折れ線グラフはデータ点を既定で表示する");
    assertInlineCheckboxLayout(await checkboxLayout(lineEditor.locator('input[aria-label="グラフ1のデータ点の数値を表示"]')), "データ点の数値を表示");
    assertInlineCheckboxLayout(await checkboxLayout(lineEditor.locator('input[aria-label="グラフ1のデータ点を表示"]')), "データ点を表示");
    assertInlineCheckboxLayout(await checkboxLayout(lineEditor.locator('input[aria-label="グラフ1の凡例を表示"]')), "折れ線グラフの凡例を表示");
    await lineEditor.locator('input[aria-label="グラフ1のデータ点の数値を表示"]').check();
    await lineEditor.locator('input[aria-label="グラフ1の凡例を表示"]').check();
    await lineEditor.locator('input[aria-label="2件目の数値"]').fill("27.75");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line-item").length === 2 && document.querySelectorAll("#preview .chart-block-line-point").length === 2);
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line .chart-block-value").length === 2);
    assert.equal(await page.locator("#preview .chart-block-line-path").count(), 1, "複数項目の折れ線グラフは点を直線で接続する");
    assert.deepEqual(await page.locator("#preview .chart-block-line-item").evaluateAll((items) => items.map((item) => item.dataset.chartItemId)), (await chart(page)).items.map((item) => item.id), "入力順を点と接続順へ維持する");
    const lineCoordinates = await page.locator("#preview .chart-block-line-point").evaluateAll((points) => points.map((point) => ({ x: Number(point.getAttribute("cx")), y: Number(point.getAttribute("cy")) })));
    assert.ok(lineCoordinates.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), "小数値でも有限な折れ線座標を描画する");
    assert.ok(lineCoordinates[0].x < lineCoordinates[1].x, "入力順に横軸を左から右へ並べる");
    const lineChart = await chart(page);
    const lineSvgState = await page.locator("#preview .chart-block-line svg").evaluate((svg, firstItemId) => {
      const firstItem = [...svg.querySelectorAll(".chart-block-line-item")].find((item) => item.dataset.chartItemId === firstItemId);
      const toBox = (element) => {
        const box = element.getBBox();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      const polyline = svg.querySelector(".chart-block-line-path");
      return {
        pathCount: svg.querySelectorAll(".chart-block-line-path").length,
        pointCount: svg.querySelectorAll(".chart-block-line-point").length,
        valueCount: svg.querySelectorAll(".chart-block-value").length,
        labelCount: svg.querySelectorAll(".chart-block-label").length,
        pointCoordinates: [...svg.querySelectorAll(".chart-block-line-point")].map((point) => [Number(point.getAttribute("cx")), Number(point.getAttribute("cy"))]),
        polylineCoordinates: (polyline?.getAttribute("points") || "").trim().split(/\s+/).filter(Boolean).flatMap((point) => point.split(",").map(Number)),
        firstValue: toBox(firstItem.querySelector(".chart-block-value")),
        unit: toBox(svg.querySelector(".chart-block-unit")),
        maximum: toBox(svg.querySelector(".chart-block-axis-maximum"))
      };
    }, lineChart.items[0].id);
    assert.deepEqual([lineSvgState.pathCount, lineSvgState.pointCount, lineSvgState.valueCount, lineSvgState.labelCount], [1, 2, 2, 2], "先頭が最大値でも線・点・数値・項目名を表示する");
    assert.ok([...lineSvgState.pointCoordinates.flat(), ...lineSvgState.polylineCoordinates].every(Number.isFinite), "折れ線と点の生成座標をすべて有限にする");
    assert.equal(boxesOverlap(lineSvgState.firstValue, lineSvgState.unit), false, "先頭の数値と単位を重ねない");
    assert.equal(boxesOverlap(lineSvgState.firstValue, lineSvgState.maximum), false, "先頭の数値とY軸最大値を重ねない");
    assert.equal(boxesOverlap(lineSvgState.unit, lineSvgState.maximum), false, "単位とY軸最大値を重ねない");
    await lineEditor.locator('input[aria-label="1件目の数値"]').fill("2.5");
    await lineEditor.locator('input[aria-label="2件目の数値"]').fill("2.5");
    await page.waitForFunction(() => {
      const points = [...document.querySelectorAll("#preview .chart-block-line-point")];
      return points.length === 2 && points[0].getAttribute("cy") === points[1].getAttribute("cy");
    });
    await lineEditor.locator('input[aria-label="1件目の数値"]').fill("72.25");
    await lineEditor.locator('input[aria-label="2件目の数値"]').fill("27.75");
    await lineEditor.locator('input[aria-label="グラフ1のデータ点を表示"]').uncheck();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line-point").length === 0);
    await lineEditor.locator('input[aria-label="グラフ1のデータ点を表示"]').check();
    await lineEditor.locator('input[aria-label="1件目の項目名"]').fill("");
    await lineEditor.locator('input[aria-label="2件目の項目名"]').fill("");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-line .chart-block-empty")?.textContent === "項目名と有限な数値を入力してください");
    await lineEditor.locator('input[aria-label="1件目の項目名"]').fill("国語");
    await lineEditor.locator('input[aria-label="2件目の項目名"]').fill("数学");
    await lineEditor.locator('button[data-chart-action="delete-item"]').last().click();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line-point").length === 1 && document.querySelectorAll("#preview .chart-block-line-path").length === 0);
    await page.locator('.chart-block-editor button[data-chart-action="add-item"]').click();
    // add-item restores focus on the next animation frame. Finish that UI action
    // before fill() can send text to a different field while focus is moving.
    await page.waitForFunction(() => document.activeElement?.matches('.chart-block-item-row[data-chart-item-index="1"] input[data-chart-item-field="label"]'));
    await page.locator('input[aria-label="2件目の項目名"]').fill("数学");
    await page.locator('input[aria-label="2件目の数値"]').fill("27.75");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line-point").length === 2);
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("pie");
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart.chartType === "pie");
    let pieEditor = page.locator(".chart-block-editor");
    assert.equal(await pieEditor.locator('input[aria-label="1件目の項目名"]').inputValue(), "国語", "折れ線グラフから円グラフへの切替でも項目名を保持する");
    assert.equal(await pieEditor.locator('input[aria-label="1件目の数値"]').inputValue(), "72.25", "折れ線グラフから円グラフへの切替でも数値を保持する");
    await waitForPieSlices(page, 2);
    assert.equal(await page.locator("#preview .chart-block-pie-label").count(), 2, "割合ラベルを既定で描画する");
    assert.match(await page.locator("#preview .chart-block-pie-label").first().textContent(), /72\.3%/, "割合は小数第1位で統一して丸める");
    const pieFills = await page.locator("#preview .chart-block-pie-slice").evaluateAll((slices) => slices.map((slice) => slice.getAttribute("fill")));
    assert.notEqual(pieFills[0], pieFills[1], "各扇形を識別可能な色で描画する");
    const pieItemIds = (await chart(page)).items.map((item) => item.id);
    const firstPieColor = pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[0]}"] input[data-chart-pie-item-color]`);
    const secondPieColor = pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[1]}"] input[data-chart-pie-item-color]`);
    assert.equal(await firstPieColor.inputValue(), "#4f46e5", "色未指定の先頭項目は既定パレットを表示する");
    assert.equal(await secondPieColor.inputValue(), "#dc2626", "色未指定の次項目は既定パレットを表示する");
    await firstPieColor.fill("#123456");
    await secondPieColor.fill("#abcdef");
    await page.waitForFunction((ids) => {
      const fills = Object.fromEntries([...document.querySelectorAll("#preview .chart-block-pie-slice")].map((slice) => [slice.dataset.chartItemId, slice.getAttribute("fill")]));
      const chart = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return fills[ids[0]] === "#123456" && fills[ids[1]] === "#abcdef"
        && chart?.appearance?.pieItemColors?.[ids[0]] === "#123456"
        && chart?.appearance?.pieItemColors?.[ids[1]] === "#abcdef";
    }, pieItemIds);
    assert.deepEqual(await page.locator("#preview .chart-block-legend-swatch").evaluateAll((swatches) => swatches.map((swatch) => getComputedStyle(swatch).backgroundColor)), ["rgb(18, 52, 86)", "rgb(171, 205, 239)"], "凡例も扇形と同じ項目色を使う");
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[1]}"] input[data-chart-series-value]`).fill("0");
    await page.waitForFunction((id) => document.querySelectorAll("#preview .chart-block-pie-slice").length === 1
      && document.querySelector(`#preview .chart-block-pie-slice[data-chart-item-id="${id}"]`) === null, pieItemIds[1]);
    assert.deepEqual(await page.locator("#preview .chart-block-legend-swatch").evaluateAll((swatches) => swatches.map((swatch) => getComputedStyle(swatch).backgroundColor)), ["rgb(18, 52, 86)", "rgb(171, 205, 239)"], "0値で扇形がなくても凡例は保存済み項目色を使う");
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[1]}"] input[data-chart-series-value]`).fill("27.75");
    await page.waitForFunction((id) => document.querySelector(`#preview .chart-block-pie-slice[data-chart-item-id="${id}"]`)?.getAttribute("fill") === "#abcdef", pieItemIds[1]);
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[0]}"] input[data-chart-item-field="label"]`).fill("同名項目");
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[1]}"] input[data-chart-item-field="label"]`).fill("同名項目");
    await page.waitForFunction((ids) => {
      const chart = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return chart?.items?.every((item) => item.label === "同名項目")
        && chart?.appearance?.pieItemColors?.[ids[0]] === "#123456"
        && chart?.appearance?.pieItemColors?.[ids[1]] === "#abcdef";
    }, pieItemIds);
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[0]}"] input[data-chart-item-field="label"]`).fill("国語");
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[1]}"] input[data-chart-item-field="label"]`).fill("数学");
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[0]}"] button[data-chart-action="move-item-down"]`).click();
    await page.waitForFunction((ids) => {
      const chart = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      const fills = Object.fromEntries([...document.querySelectorAll("#preview .chart-block-pie-slice")].map((slice) => [slice.dataset.chartItemId, slice.getAttribute("fill")]));
      return chart?.items?.map((item) => item.id).join(",") === `${ids[1]},${ids[0]}` && fills[ids[0]] === "#123456" && fills[ids[1]] === "#abcdef";
    }, pieItemIds);
    pieEditor = page.locator(".chart-block-editor");
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[0]}"] button[data-chart-action="move-item-up"]`).click();
    await page.waitForFunction((ids) => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.items?.map((item) => item.id).join(",") === ids.join(","), pieItemIds);
    pieEditor = page.locator(".chart-block-editor");
    await pieEditor.locator('button[data-chart-action="add-item"]').click();
    pieEditor = page.locator(".chart-block-editor");
    const addedPieRow = pieEditor.locator('.chart-block-item-row[data-chart-item-index="2"]');
    await addedPieRow.locator('input[data-chart-item-field="label"]').fill("追加項目");
    await addedPieRow.locator('input[data-chart-series-value]').fill("5");
    assert.equal(await addedPieRow.locator('input[data-chart-pie-item-color]').inputValue(), "#059669", "追加項目は保存色なしで既定パレットを使う");
    await addedPieRow.locator('button[data-chart-action="delete-item"]').click();
    await page.waitForFunction((ids) => {
      const chart = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return chart?.items?.length === 2 && Object.keys(chart?.appearance?.pieItemColors || {}).sort().join(",") === ids.slice().sort().join(",");
    }, pieItemIds);
    pieEditor = page.locator(".chart-block-editor");
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[0]}"] button[data-chart-action="reset-pie-item-color"]`).click();
    await page.waitForFunction((id) => !window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.appearance?.pieItemColors?.[id], pieItemIds[0]);
    pieEditor = page.locator(".chart-block-editor");
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[1]}"] button[data-chart-action="reset-pie-item-color"]`).click();
    await page.waitForFunction((id) => document.activeElement?.matches(`.chart-block-item-row[data-chart-item-id="${id}"] input[data-chart-pie-item-color]`), pieItemIds[1]);
    pieEditor = page.locator(".chart-block-editor");
    const firstPieLabel = pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[0]}"] input[data-chart-item-field="label"]`);
    const syncedSecondPieColor = pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[1]}"] input[data-chart-pie-item-color]`);
    await firstPieLabel.fill("");
    assert.equal((await chart(page)).items[0].label, "", "フォーカス復帰後の空欄入力を保存データへ反映する");
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[0]}"] input[data-chart-pie-item-color]`).fill("#123456");
    await page.waitForFunction((id) => document.querySelector(`#preview .chart-block-pie-slice[data-chart-item-id="${id}"]`)?.getAttribute("fill") === "#4f46e5", pieItemIds[1]);
    assert.equal(await syncedSecondPieColor.inputValue(), "#4f46e5", "先頭項目名が空欄なら未指定色入力は第1パレット色へ同期する");
    await firstPieLabel.fill("国語");
    await page.waitForFunction((ids) => document.querySelector(`#preview .chart-block-pie-slice[data-chart-item-id="${ids[0]}"]`)?.getAttribute("fill") === "#123456"
      && document.querySelector(`#preview .chart-block-pie-slice[data-chart-item-id="${ids[1]}"]`)?.getAttribute("fill") === "#dc2626", pieItemIds);
    assert.equal(await syncedSecondPieColor.inputValue(), "#dc2626", "項目名を入力すると未指定色入力は第2パレット色へ同期する");
    assert.equal(await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[0]}"] input[data-chart-pie-item-color]`).inputValue(), "#123456", "明示色は同期で上書きしない");
    await firstPieLabel.fill("");
    await page.waitForFunction((id) => document.querySelector(`#preview .chart-block-pie-slice[data-chart-item-id="${id}"]`)?.getAttribute("fill") === "#4f46e5", pieItemIds[1]);
    assert.equal(await syncedSecondPieColor.inputValue(), "#4f46e5", "項目名を空欄へ戻すと未指定色入力は第1パレット色へ戻る");
    assert.equal(await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[0]}"] input[data-chart-pie-item-color]`).inputValue(), "#123456", "空欄への変更でも明示色は保持する");
    await firstPieLabel.fill("国語");
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[0]}"] input[data-chart-pie-item-color]`).fill("#123456");
    await syncedSecondPieColor.fill("#abcdef");
    for (const viewportWidth of [320, 375, 390, 430]) {
      await page.setViewportSize({ width: viewportWidth, height: 760 });
      await page.waitForFunction((width) => innerWidth === width && document.body.dataset.layoutMode === "mobile", viewportWidth);
      const pieColorMobileMetrics = await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[0]}"]`).evaluate((row) => {
        const table = row.closest(".chart-block-item-table");
        const color = row.querySelector('input[data-chart-pie-item-color]')?.getBoundingClientRect();
        const reset = row.querySelector('button[data-chart-action="reset-pie-item-color"]')?.getBoundingClientRect();
        return {
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
          tableScrollable: table?.scrollWidth > table?.clientWidth,
          color: color && { left: color.left, right: color.right, top: color.top, bottom: color.bottom },
          reset: reset && { left: reset.left, right: reset.right, top: reset.top, bottom: reset.bottom }
        };
      });
      assert.equal(pieColorMobileMetrics.documentOverflow, 0, `${viewportWidth}pxで色入力によりdocumentの横スクロールを作らない`);
      assert.equal(pieColorMobileMetrics.bodyOverflow, 0, `${viewportWidth}pxで色入力によりbodyの横スクロールを作らない`);
      assert.equal(pieColorMobileMetrics.tableScrollable, true, `${viewportWidth}pxで項目表だけを横スクロール可能にする`);
      assert.ok(pieColorMobileMetrics.color && pieColorMobileMetrics.reset && (pieColorMobileMetrics.color.bottom <= pieColorMobileMetrics.reset.top || pieColorMobileMetrics.reset.bottom <= pieColorMobileMetrics.color.top || pieColorMobileMetrics.color.right <= pieColorMobileMetrics.reset.left || pieColorMobileMetrics.reset.right <= pieColorMobileMetrics.color.left), `${viewportWidth}pxで色入力と既定色へ戻す操作を重ねない: ${JSON.stringify(pieColorMobileMetrics)}`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
    pieEditor = page.locator(".chart-block-editor");
    assertInlineCheckboxLayout(await checkboxLayout(pieEditor.locator('input[aria-label="グラフ1の凡例を表示"]')), "円グラフの凡例を表示");
    await pieEditor.locator('input[aria-label="グラフ1の凡例を表示"]').check();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-legend li").length === 2);
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[1]}"] input[data-chart-series-value]`).fill("0");
    await page.waitForFunction((id) => document.querySelectorAll("#preview .chart-block-pie-slice").length === 1
      && document.querySelector(`#preview .chart-block-pie-slice[data-chart-item-id="${id}"]`) === null, pieItemIds[1]);
    await pieEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    step("chart-save-reload: persist and restore");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    pieEditor = page.locator(".chart-block-editor");
    assert.equal(await pieEditor.locator('select[aria-label="グラフ1の種類"]').inputValue(), "pie", "0値の項目色を保存した再編集でも円グラフを復元する");
    assert.equal(await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[1]}"] input[data-chart-series-value]`).inputValue(), "0", "再読み込み後も0値を復元する");
    assert.equal(await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[1]}"] input[data-chart-pie-item-color]`).inputValue(), "#abcdef", "再編集でも0値項目の保存色を復元する");
    assert.deepEqual(await page.locator("#preview .chart-block-legend-swatch").evaluateAll((swatches) => swatches.map((swatch) => getComputedStyle(swatch).backgroundColor)), ["rgb(18, 52, 86)", "rgb(171, 205, 239)"], "再読み込み後も0値項目の凡例色を保持する");
    await pieEditor.locator(`.chart-block-item-row[data-chart-item-id="${pieItemIds[1]}"] input[data-chart-series-value]`).fill("27.75");
    await page.waitForFunction((id) => document.querySelector(`#preview .chart-block-pie-slice[data-chart-item-id="${id}"]`)?.getAttribute("fill") === "#abcdef", pieItemIds[1]);
    await pieEditor.locator('select[aria-label="グラフ1の円グラフのラベル"]').selectOption("value");
    await page.waitForFunction(() => [...document.querySelectorAll("#preview .chart-block-pie-label")].some((label) => label.textContent === "72.25点"));
    await pieEditor.locator('select[aria-label="グラフ1の円グラフのラベル"]').selectOption("none");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-pie-label").length === 0);
    await pieEditor.locator('select[aria-label="グラフ1の円グラフのラベル"]').selectOption("percentage");
    await pieEditor.locator('input[aria-label="1件目の数値"]').fill("0");
    await pieEditor.locator('input[aria-label="2件目の数値"]').fill("0");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-pie .chart-block-empty")?.textContent === "円グラフを表示できる有効な数値がありません");
    await pieEditor.locator('input[aria-label="1件目の数値"]').fill("72.25");
    await pieEditor.locator('input[aria-label="2件目の数値"]').fill("27.75");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-pie-slice").length === 2);
    await pieEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    await pieEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 2);
    assert.equal(await page.locator('input[aria-label="2件目の数値"]').inputValue(), "27.75", "円グラフから棒グラフへの切替でも数値を保持する");
    await page.locator('.chart-block-editor button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    const beforeCancel = await chart(page);
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("pie");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-pie-slice").length === 2);
    await page.locator('.chart-block-editor button[data-chart-action="cancel"]').click();
    await waitForChartCancelCompletion(page, 0);
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart.chartType === "bar");
    assert.deepEqual(await chart(page), beforeCancel, "編集を取り消すと開始時の棒グラフ、ID、共通データ、表示設定へ戻す");
    await page.locator('.chart-block-editor button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    const beforeReload = await chart(page);
    assert.deepEqual({ ...beforeReload.appearance, pieSeriesId: undefined, pieItemColors: undefined }, { color: "#dc2626", barMode: "grouped", barOrientation: "vertical", showStackTotals: false, showDataTable: false, showValues: true, showPoints: true, showLegend: true, pieLabelMode: "percentage", pieSeriesId: undefined, pieItemColors: undefined }, "棒グラフへ戻しても既存の色・数値・点・凡例設定を保存する");
    assert.deepEqual(beforeReload.appearance.pieItemColors, { [pieItemIds[0]]: "#123456", [pieItemIds[1]]: "#abcdef" }, "円グラフの項目色は棒グラフへ切り替えても項目IDへ保存する");
    assert.equal(beforeReload.appearance.pieSeriesId, beforeReload.series[0].id, "既定の円グラフ表示系列IDを保存する");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.deepEqual(await chart(page), beforeReload, "再読み込み後もグラフ保存データを復元する");
    assert.equal(await page.locator("#preview .chart-block-bar").count(), 2, "再読み込み後もカードの棒グラフを復元する");
    assert.equal(await page.locator('select[aria-label="グラフ1の種類"]').inputValue(), "bar", "再編集時に棒グラフ種別を復元する");
    assert.equal(await page.locator('input[aria-label="グラフ1の棒の上に数値を表示"]').isChecked(), true, "再編集時に数値表示設定を復元する");
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.locator('.chart-block-editor button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    const lineBeforeReload = await chart(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.deepEqual(await chart(page), lineBeforeReload, "折れ線グラフも再読み込み後に保存データを復元する");
    assert.equal(await page.locator("#preview .chart-block-line").count(), 1, "再読み込み後もカードの折れ線グラフを復元する");
    assert.equal(await page.locator('select[aria-label="グラフ1の種類"]').inputValue(), "line", "再編集時に折れ線グラフ種別を復元する");
    await page.locator('input[aria-label="グラフ1のタイトル"]').fill("更新後の得点");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block").length === 1 && document.querySelector("#preview .chart-block figcaption")?.textContent === "更新後の得点");
    await page.locator("#settingsBtn").click();
    await page.locator("#themeSelect").selectOption("dark");
    await page.waitForFunction(() => document.body.classList.contains("dark"));
    const darkLineStyles = await page.locator("#preview .chart-block-line-path").evaluate((line) => ({ stroke: getComputedStyle(line).stroke, visibility: getComputedStyle(line).visibility }));
    assert.notEqual(darkLineStyles.stroke, "none", "ダークテーマでも折れ線の色を維持する");
    assert.equal(darkLineStyles.visibility, "visible", "ダークテーマでも折れ線を表示する");
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 2);
    const darkBarStyles = await page.locator("#preview .chart-block-bar rect").first().evaluate((bar) => ({ fill: getComputedStyle(bar).fill, visibility: getComputedStyle(bar).visibility }));
    assert.notEqual(darkBarStyles.fill, "none", "ダークテーマでも棒の色を維持する");
    assert.equal(darkBarStyles.visibility, "visible", "ダークテーマでも棒を表示する");
    await page.locator("#themeSelect").selectOption("light");
    await page.waitForFunction(() => !document.body.classList.contains("dark"));
    await page.locator("#closeSettingsBtn").click();
    });

    await runPageFeature("chart-multiple-blocks", async (page, step) => {
      step("duplicate IDs and independent editing");
    const duplicateSetup = await page.evaluate(() => {
      const { normalizeChartBlock, serializeChartBlock } = window.MemoNexusChartBlockUtils;
      const first = normalizeChartBlock({
        id: "duplicated-chart", chartType: "bar", title: "一つ目", unit: "件",
        items: [{ id: "first-item", label: "前半", value: 3 }],
        appearance: { color: "#2563eb", showValues: true, showPoints: true, showLegend: false, pieLabelMode: "percentage" }
      });
      const second = normalizeChartBlock({
        id: "duplicated-chart", chartType: "bar", title: "二つ目", unit: "個",
        items: [{ id: "second-item", label: "後半", value: 8 }],
        appearance: { color: "#16a34a", showValues: false, showPoints: false, showLegend: false, pieLabelMode: "percentage" }
      });
      const front = normalizeChartBlock({
        id: "front-chart", chartType: "pie", title: "前方追加", unit: "件",
        items: [{ id: "front-item", label: "先頭", value: 1 }],
        appearance: { color: "#7c3aed", showValues: true, showPoints: true, showLegend: true, pieLabelMode: "value" }
      });
      return { body: `${serializeChartBlock(first)}\n${serializeChartBlock(second)}`, first, second, frontMarker: serializeChartBlock(front) };
    });
    await page.locator("#editor").fill(duplicateSetup.body);
    await page.waitForFunction(() => document.querySelectorAll(".chart-block-editor").length === 2);
    let secondEditor = page.locator(".chart-block-editor").nth(1);
    await secondEditor.locator('input[aria-label="グラフ2のタイトル"]').fill("二つ目を変更");
    await secondEditor.locator('input[aria-label="グラフ2の単位"]').fill("点");
    await secondEditor.locator('input[aria-label="1件目の項目名"]').fill("後半を変更");
    await secondEditor.locator('input[aria-label="1件目の数値"]').fill("18.5");
    await secondEditor.locator('select[aria-label="グラフ2の種類"]').selectOption("pie");
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.chartType === "pie");
    secondEditor = page.locator(".chart-block-editor").nth(1);
    await secondEditor.locator('input[aria-label="グラフ2の凡例を表示"]').check();
    await secondEditor.locator('select[aria-label="グラフ2の円グラフのラベル"]').selectOption("value");
    await secondEditor.locator('button[data-chart-action="cancel"]').click();
    await waitForChartCancelCompletion(page, 1);
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.title === "二つ目");
    let duplicateCharts = await charts(page);
    assert.deepEqual(duplicateCharts, [duplicateSetup.first, duplicateSetup.second], "同一chartIdでも2件目の取消は2件目自身の開始時状態だけを復元する");
    secondEditor = page.locator(".chart-block-editor").nth(1);
    await secondEditor.locator('select[aria-label="グラフ2の種類"]').selectOption("line");
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.chartType === "line");
    secondEditor = page.locator(".chart-block-editor").nth(1);
    await secondEditor.locator('input[aria-label="グラフ2のデータ点の数値を表示"]').check();
    await secondEditor.locator('input[aria-label="グラフ2の凡例を表示"]').check();
    await secondEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".chart-block-editor")[1]?.querySelector(".chart-block-status")?.textContent === "入力内容を保存しました");
    const confirmedSecond = (await charts(page))[1];
    secondEditor = page.locator(".chart-block-editor").nth(1);
    await secondEditor.locator('select[aria-label="グラフ2の種類"]').selectOption("pie");
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.chartType === "pie");
    await page.locator(".chart-block-editor").nth(1).locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.chartType === "line");
    await waitForChartCancelCompletion(page, 1);
    duplicateCharts = await charts(page);
    assert.deepEqual(duplicateCharts[0], duplicateSetup.first, "2件目の確定・取消でも1件目を変更しない");
    assert.deepEqual(duplicateCharts[1], confirmedSecond, "確定保存後の取消は直近の確定状態へ戻す");
    const duplicateBody = await page.locator("#editor").inputValue();
    await page.locator("#editor").fill(`${duplicateSetup.frontMarker}\n${duplicateBody}`);
    await waitForChartEditorSyncAfterBodyInput(page, 3);
    let movedSecondEditor = page.locator(".chart-block-editor").nth(2);
    await movedSecondEditor.locator('input[aria-label="グラフ3のタイトル"]').fill("前方追加後の変更");
    await movedSecondEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction((title) => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[2]?.chart.title === title, confirmedSecond.title);
    await waitForChartCancelCompletion(page, 2);
    duplicateCharts = await charts(page);
    assert.deepEqual(duplicateCharts.slice(1), [duplicateSetup.first, confirmedSecond], "前方グラフ追加後も2件目へ別ブロックの取消状態を適用しない");
    await page.locator("#editor").fill((await page.locator("#editor").inputValue()).replace(`${duplicateSetup.frontMarker}\n`, ""));
    await waitForChartEditorSyncAfterBodyInput(page, 2);
    movedSecondEditor = page.locator(".chart-block-editor").nth(1);
    await movedSecondEditor.locator('input[aria-label="グラフ2のタイトル"]').fill("前方削除後の変更");
    await movedSecondEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction((title) => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.title === title, confirmedSecond.title);
    await waitForChartCancelCompletion(page, 1);
    assert.deepEqual(await charts(page), [duplicateSetup.first, confirmedSecond], "前方グラフ削除後も対象外のグラフを復元しない");
    });

    await runPageFeature("chart-multi-series", async (page, step) => {
      step("legacy marker and series editing");
    const legacyMultiMarker = await page.evaluate(() => window.MemoNexusChartBlockUtils.serializeChartBlock({
      id: "legacy-multi", chartType: "bar", title: "月別比較", unit: "万円",
      items: [
        { id: "jan", label: "1月", value: 100 },
        { id: "feb", label: "2月", value: 140 },
        { id: "mar", label: "3月", value: 120 }
      ],
      appearance: { color: "#2563eb", showValues: true, showLegend: false }
    }));
    await page.locator("#editor").fill(legacyMultiMarker);
    await waitForChartEditorSyncAfterBodyInput(page, 1);
    let multiEditor = page.locator(".chart-block-editor");
    assert.equal(await multiEditor.locator('input[data-chart-series-field="name"]').count(), 1, "旧形式は編集時に1系列へ正規化する");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] input[data-chart-series-value][data-chart-series-index="0"]').getAttribute("aria-label"), "1件目の数値", "1系列では従来の数値ラベルを維持する");
    await multiEditor.locator('button[data-chart-action="add-series"]').click();
    multiEditor = page.locator(".chart-block-editor");
    await page.waitForFunction(() => {
      const editor = document.querySelector(".chart-block-editor");
      const labels = [...editor?.querySelectorAll('input[data-chart-series-value][data-chart-series-index="0"]') || []].map((input) => input.getAttribute("aria-label"));
      return labels.join(",") === "1件目の系列 1の数値,2件目の系列 1の数値,3件目の系列 1の数値";
    });
    const firstSeriesName = multiEditor.locator('input[data-chart-series-field="name"]').first();
    await firstSeriesName.fill("売上");
    await page.waitForFunction(() => {
      const editor = document.querySelector(".chart-block-editor");
      const nameInput = editor?.querySelector('.chart-block-series-row[data-chart-series-index="0"] input[data-chart-series-field="name"]');
      const header = editor?.querySelector('[data-chart-series-header-index="0"]')?.textContent;
      const labels = [...editor?.querySelectorAll('input[data-chart-series-value][data-chart-series-index="0"]') || []].map((input) => input.getAttribute("aria-label"));
      const legend = [...document.querySelectorAll("#preview .chart-block-legend li")].map((item) => item.textContent).join(",");
      return header === "売上"
        && labels.join(",") === "1件目の売上の数値,2件目の売上の数値,3件目の売上の数値"
        && legend === "売上,系列 2"
        && editor?.querySelector('.chart-block-series-row[data-chart-series-index="0"] button[data-chart-action="move-series-up"]')?.getAttribute("aria-label") === "売上を上へ移動"
        && editor?.querySelector('.chart-block-series-row[data-chart-series-index="0"] button[data-chart-action="move-series-down"]')?.getAttribute("aria-label") === "売上を下へ移動"
        && document.activeElement === nameInput
        && nameInput.selectionStart === nameInput.value.length
        && nameInput.selectionEnd === nameInput.value.length;
    });
    await multiEditor.locator('input[data-chart-series-field="name"]').nth(1).fill("利益");
    await multiEditor.locator('input[data-chart-series-field="color"]').nth(1).evaluate((input) => { input.value = "#16a34a"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await multiEditor.locator('input[data-chart-series-field="name"]').nth(1).fill("営業利益");
    assert.equal(await multiEditor.locator('.chart-block-series-row[data-chart-series-index="1"] button[data-chart-action="move-series-up"]').getAttribute("aria-label"), "営業利益を上へ移動", "系列名変更直後に上へ操作の読み上げ名を同期する");
    assert.equal(await multiEditor.locator('.chart-block-series-row[data-chart-series-index="1"] button[data-chart-action="move-series-down"]').getAttribute("aria-label"), "営業利益を下へ移動", "系列名変更直後に下へ操作の読み上げ名を同期する");
    await page.waitForFunction(() => {
      const editor = document.querySelector(".chart-block-editor");
      const header = editor?.querySelector('[data-chart-series-header-index="1"]')?.textContent;
      const ariaLabel = editor?.querySelector('.chart-block-item-row[data-chart-item-index="0"] input[data-chart-series-value][data-chart-series-index="1"]')?.getAttribute("aria-label");
      const legend = [...document.querySelectorAll("#preview .chart-block-legend li")].map((item) => item.textContent).join(",");
      return header === "営業利益" && ariaLabel === "1件目の営業利益の数値" && legend === "売上,営業利益";
    });
    for (const [itemIndex, value] of [30, 45, 38].entries()) {
      await multiEditor.locator(`.chart-block-item-row[data-chart-item-index="${itemIndex}"] input[data-chart-series-value][data-chart-series-index="1"]`).fill(String(value));
    }
    await multiEditor.locator('button[data-chart-action="add-series"]').click();
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('input[data-chart-series-field="name"]').nth(2).fill(" ");
    assert.equal(await multiEditor.locator('.chart-block-series-row[data-chart-series-index="2"] button[data-chart-action="move-series-up"]').getAttribute("aria-label"), "3件目の系列を上へ移動", "空白だけの系列名は番号へフォールバックする");
    assert.equal(await multiEditor.locator('.chart-block-series-row[data-chart-series-index="2"] button[data-chart-action="move-series-down"]').getAttribute("aria-label"), "3件目の系列を下へ移動", "空白だけの系列名は番号へフォールバックする");
    await multiEditor.locator('input[data-chart-series-field="name"]').nth(2).fill("原価");
    for (const [itemIndex, value] of [60, 80, 70].entries()) {
      await multiEditor.locator(`.chart-block-item-row[data-chart-item-index="${itemIndex}"] input[data-chart-series-value][data-chart-series-index="2"]`).fill(String(value));
    }
    assert.equal(await multiEditor.locator('button[data-chart-action="add-series"]').isDisabled(), true, "4系列目は追加できない");
    assert.equal(await multiEditor.locator(".chart-block-series-limit").textContent(), "系列は最大3つまでです。", "上限理由を表示する");
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.series.length === 3 && current.series.map((series) => series.name).join(",") === "売上,営業利益,原価"
        && JSON.stringify(current.series.map((series) => series.values)) === JSON.stringify([[100, 140, 120], [30, 45, 38], [60, 80, 70]]);
    });
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 9);
    assert.equal(await multiEditor.locator('.chart-block-series-row[data-chart-series-index="0"] button[data-chart-action="move-series-up"]').isDisabled(), true, "先頭系列の上へを無効化する");
    assert.equal(await multiEditor.locator('.chart-block-series-row[data-chart-series-index="2"] button[data-chart-action="move-series-down"]').isDisabled(), true, "末尾系列の下へを無効化する");
    const [salesSeriesId, profitSeriesId, costSeriesId] = (await chart(page)).series.map((series) => series.id);
    await multiEditor.locator('.chart-block-series-row[data-chart-series-index="1"] button[data-chart-action="move-series-up"]').click();
    await page.waitForFunction((profitId) => {
      const editor = document.querySelector(".chart-block-editor");
      return document.activeElement?.closest(".chart-block-series-row")?.dataset.chartSeriesId === profitId
        && document.activeElement?.getAttribute("data-chart-action") === "move-series-down"
        && editor?.querySelector(".chart-block-status")?.textContent === "営業利益を1番目へ移動しました";
    }, profitSeriesId);
    assert.deepEqual((await chart(page)).series.map((series) => [series.id, series.name, series.color, series.values]), [
      [profitSeriesId, "営業利益", "#16a34a", [30, 45, 38]],
      [salesSeriesId, "売上", "#2563eb", [100, 140, 120]],
      [costSeriesId, "原価", "#059669", [60, 80, 70]]
    ], "系列ID、名前、色、全値を一体で移動する");
    assert.deepEqual(await multiEditor.locator('[data-chart-series-header-index]').allTextContents(), ["営業利益", "売上", "原価"], "入力表の系列列を移動する");
    await page.waitForFunction(() => [...document.querySelectorAll("#preview .chart-block-legend li")].map((item) => item.textContent).join(",") === "営業利益,売上,原価");
    assert.deepEqual(await page.locator("#preview .chart-block-legend li").allTextContents(), ["営業利益", "売上", "原価"], "集合棒の凡例順を移動する");
    assert.deepEqual(await page.locator("#preview .chart-block-bar").evaluateAll((bars) => bars.slice(0, 3).map((bar) => bar.dataset.chartSeriesId)), [profitSeriesId, salesSeriesId, costSeriesId], "集合棒の左右順を移動する");
    const reorderBarMode = multiEditor.locator('select[aria-label="グラフ1の棒の表示方法"]');
    await reorderBarMode.selectOption("stacked");
    await page.waitForFunction((seriesIds) => JSON.stringify([...document.querySelectorAll("#preview .chart-block-stacked-bar")].slice(0, 3).map((entry) => entry.dataset.chartSeriesId)) === JSON.stringify(seriesIds), [profitSeriesId, salesSeriesId, costSeriesId]);
    assert.deepEqual(await page.locator("#preview .chart-block-stacked-bar").evaluateAll((bars) => bars.slice(0, 3).map((bar) => bar.dataset.chartSeriesId)), [profitSeriesId, salesSeriesId, costSeriesId], "積み上げ棒の順を移動する");
    await reorderBarMode.selectOption("percent-stacked");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked");
    assert.deepEqual(await page.locator("#preview .chart-block-percent-stacked-bar").evaluateAll((bars) => bars.slice(0, 3).map((bar) => bar.dataset.chartSeriesId)), [profitSeriesId, salesSeriesId, costSeriesId], "100%積み上げ棒の順を移動する");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line-series").length === 3);
    assert.deepEqual(await page.locator("#preview .chart-block-line-series").evaluateAll((lines) => lines.map((line) => line.dataset.chartSeriesId)), [profitSeriesId, salesSeriesId, costSeriesId], "折れ線の描画順を移動する");
    assert.deepEqual(await page.locator("#preview .chart-block-legend li").allTextContents(), ["営業利益", "売上", "原価"], "折れ線の凡例順を移動する");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("pie");
    const multiPieItemIds = (await chart(page)).items.map((item) => item.id);
    await multiEditor.locator(`.chart-block-item-row[data-chart-item-id="${multiPieItemIds[0]}"] input[data-chart-pie-item-color]`).fill("#654321");
    await multiEditor.locator(`.chart-block-item-row[data-chart-item-id="${multiPieItemIds[1]}"] input[data-chart-pie-item-color]`).fill("#2468ac");
    await page.waitForFunction((ids) => {
      const chart = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return chart?.appearance?.pieItemColors?.[ids[0]] === "#654321" && chart?.appearance?.pieItemColors?.[ids[1]] === "#2468ac";
    }, multiPieItemIds);
    const pieSeriesSelect = multiEditor.locator('select[aria-label="グラフ1の表示する系列"]');
    await page.waitForFunction((salesId) => document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === salesId, salesSeriesId);
    assert.deepEqual(await pieSeriesSelect.locator("option").evaluateAll((options) => options.map((option) => option.value)), [profitSeriesId, salesSeriesId, costSeriesId], "円グラフの表示系列選択肢は現在の系列順と安定IDを使う");
    assert.equal(await pieSeriesSelect.inputValue(), salesSeriesId, "並べ替え後も既定選択の系列IDを維持する");
    assert.deepEqual(await page.locator("#preview .chart-block-pie .sr-only li").allTextContents(), ["1月、売上: 100万円（割合: 27.77777777777778%）", "2月、売上: 140万円（割合: 38.888888888888886%）", "3月、売上: 120万円（割合: 33.33333333333333%）"], "円グラフの読み上げは選択系列の値を使う");
    await pieSeriesSelect.selectOption(profitSeriesId);
    await page.waitForFunction((profitId) => document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === profitId, profitSeriesId);
    assert.deepEqual((await chart(page)).appearance.pieItemColors, { [multiPieItemIds[0]]: "#654321", [multiPieItemIds[1]]: "#2468ac" }, "表示系列を切り替えても項目IDごとの色を維持する");
    await pieSeriesSelect.selectOption(salesSeriesId);
    await page.waitForFunction((salesId) => {
      const pie = document.querySelector("#preview .chart-block-pie");
      return pie?.dataset.chartSeriesId === salesId
        && pie.querySelector("svg")?.getAttribute("aria-label")?.includes("表示系列: 売上")
        && [...pie.querySelectorAll(".chart-block-legend li")].map((item) => item.textContent).join(",") === "1月: 100万円,2月: 140万円,3月: 120万円";
    }, salesSeriesId);
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${salesSeriesId}"] input[data-chart-series-field="name"]`).fill("売上実績");
    await page.waitForFunction((salesId) => document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === salesId
      && document.querySelector("#preview .chart-block-pie figcaption")?.textContent?.includes("売上実績")
      && document.querySelector("#preview .chart-block-pie svg")?.getAttribute("aria-label")?.includes("表示系列: 売上実績"), salesSeriesId);
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${salesSeriesId}"] input[data-chart-series-field="name"]`).fill("売上");
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${salesSeriesId}"] button[data-chart-action="move-series-down"]`).click();
    await page.waitForFunction((salesId) => document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === salesId, salesSeriesId);
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${salesSeriesId}"] button[data-chart-action="move-series-up"]`).click();
    await page.waitForFunction((salesId) => document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === salesId, salesSeriesId);
    assert.equal((await chart(page)).series.length, 3, "円グラフでも非表示系列を保持する");
    assert.deepEqual((await chart(page)).appearance.pieItemColors, { [multiPieItemIds[0]]: "#654321", [multiPieItemIds[1]]: "#2468ac" }, "系列の並べ替えでも項目色を別項目へ移動しない");
    await multiEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${costSeriesId}"] button[data-chart-action="delete-series"]`).click();
    await page.waitForFunction((salesId) => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.series.length === 2 && current.appearance.pieSeriesId === salesId && document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === salesId;
    }, salesSeriesId);
    assert.deepEqual((await chart(page)).appearance.pieItemColors, { [multiPieItemIds[0]]: "#654321", [multiPieItemIds[1]]: "#2468ac" }, "非選択系列の削除でも項目色を維持する");
    await multiEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction((salesId) => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.series.length === 3 && current.appearance.pieSeriesId === salesId;
    }, salesSeriesId);
    await waitForChartCancelCompletion(page, 0);
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${salesSeriesId}"] button[data-chart-action="delete-series"]`).click();
    await page.waitForFunction((profitId) => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.appearance.pieSeriesId === profitId && document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === profitId;
    }, profitSeriesId);
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${costSeriesId}"] button[data-chart-action="delete-series"]`).click();
    await page.waitForFunction((profitId) => {
      const select = document.querySelector('.chart-block-editor select[data-chart-field="pieSeriesId"]');
      return select?.disabled === true && select.value === profitId;
    }, profitSeriesId);
    await multiEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction((salesId) => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.appearance?.pieSeriesId === salesId, salesSeriesId);
    await waitForChartCancelCompletion(page, 0);
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${profitSeriesId}"] button[data-chart-action="move-series-down"]`).click();
    await page.waitForFunction((profitId) => document.activeElement?.closest(".chart-block-series-row")?.dataset.chartSeriesId === profitId
      && document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "営業利益を2番目へ移動しました", profitSeriesId);
    assert.deepEqual((await chart(page)).series.map((series) => series.id), [salesSeriesId, profitSeriesId, costSeriesId], "連続操作で元の系列順へ戻せる");
    await page.waitForFunction(() => [...document.querySelectorAll("#preview .chart-block-legend li")].map((item) => item.textContent).join(",") === "売上,営業利益,原価");
    multiEditor = page.locator(".chart-block-editor");
    const invalidSeriesReorderValue = multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] input[data-chart-series-value][data-chart-series-index="1"]');
    await invalidSeriesReorderValue.fill("Infinity");
    await multiEditor.locator('.chart-block-series-row[data-chart-series-index="1"] button[data-chart-action="move-series-up"]').click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "1件目の営業利益の数値"
      && document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "数値は有限な数値を入力してください");
    assert.equal(await invalidSeriesReorderValue.inputValue(), "Infinity", "不正な編集中の数値を系列移動で破棄しない");
    assert.deepEqual((await chart(page)).series.map((series) => series.id), [salesSeriesId, profitSeriesId, costSeriesId], "不正値では系列を移動しない");
    await invalidSeriesReorderValue.fill("30");
    await multiEditor.locator('select[aria-label="グラフ1の棒の表示方法"]').selectOption("grouped");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "grouped");
    assert.equal(await page.locator("#preview .chart-block-bar").count(), 9, "3項目・3系列を集合棒として描画する");
    assert.deepEqual(await page.locator("#preview .chart-block-legend li").allTextContents(), ["売上", "営業利益", "原価"], "凡例を系列名と色で表示する");
    assert.deepEqual(await page.locator("#preview .chart-block-bar-chart .sr-only li").allTextContents(), [
      "1月、売上: 100万円", "1月、営業利益: 30万円", "1月、原価: 60万円",
      "2月、売上: 140万円", "2月、営業利益: 45万円", "2月、原価: 80万円",
      "3月、売上: 120万円", "3月、営業利益: 38万円", "3月、原価: 70万円"
    ], "棒グラフは表示中の全系列を読み上げ対象にする");
    const groupedViewBox = (await page.locator("#preview .chart-block-bar-chart svg").getAttribute("viewBox")).split(" ").map(Number);
    assert.ok(groupedViewBox[2] >= 466 && groupedViewBox[3] === 260, "集合棒グラフは系列幅を縮めず、数値軸の必要余白だけを加える");
    const barMetrics = await page.locator("#preview .chart-block-bar rect").evaluateAll((bars) => bars.map((bar) => ({ x: Number(bar.getAttribute("x")), height: Number(bar.getAttribute("height")), fill: bar.getAttribute("fill") })));
    assert.ok(barMetrics.every((bar) => Number.isFinite(bar.x) && Number.isFinite(bar.height) && bar.height >= 0), "SVG属性に不正値を混入しない");
    assert.ok(barMetrics.some((bar) => bar.height === 142), "全系列の最大値140を高さ計算の基準へ使う");
    assert.notEqual(barMetrics[0].x, barMetrics[1].x, "同じ項目の系列を横に並べる");
    const firstItemNameInput = multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] input[data-chart-item-field="label"]');
    await firstItemNameInput.fill("4月");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] button[data-chart-action="move-item-up"]').getAttribute("aria-label"), "4月を上へ移動", "項目名変更直後に上へボタンの読み上げ名を同期する");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] button[data-chart-action="move-item-down"]').getAttribute("aria-label"), "4月を下へ移動", "項目名変更直後に下へボタンの読み上げ名を同期する");
    assert.equal(await firstItemNameInput.evaluate((input) => document.activeElement === input && input.selectionStart === input.value.length && input.selectionEnd === input.value.length), true, "項目名入力中に編集欄を再描画せずフォーカスとキャレットを維持する");
    await firstItemNameInput.fill(" ");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] button[data-chart-action="move-item-up"]').getAttribute("aria-label"), "1件目の項目を上へ移動", "空白だけの項目名は上へボタンで項目番号へフォールバックする");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] button[data-chart-action="move-item-down"]').getAttribute("aria-label"), "1件目の項目を下へ移動", "空白だけの項目名は下へボタンで項目番号へフォールバックする");
    await firstItemNameInput.fill("4月");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] button[data-chart-action="move-item-down"]').click();
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.items.map((item) => item.label).join(",") === "2月,4月,3月"
        && JSON.stringify(current.series.map((series) => series.values)) === JSON.stringify([[140, 100, 120], [45, 30, 38], [80, 60, 70]])
        && document.activeElement?.getAttribute("data-chart-action") === "move-item-down"
        && document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "「4月」を2件目へ移動しました";
    });
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] input[data-chart-item-field="label"]').fill("1月");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] button[data-chart-action="move-item-up"]').click();
    const restoredItemOrder = await chart(page);
    assert.deepEqual(restoredItemOrder.items.map((item) => item.label), ["1月", "2月", "3月"], "回帰確認後に項目順を戻す");
    assert.deepEqual(restoredItemOrder.series.map((series) => series.values), [[100, 140, 120], [30, 45, 38], [60, 80, 70]], "回帰確認後に全系列値の対応を戻す");
    multiEditor = page.locator(".chart-block-editor");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] button[data-chart-action="move-item-up"]').isDisabled(), true, "先頭項目の上へを無効化する");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="2"] button[data-chart-action="move-item-down"]').isDisabled(), true, "末尾項目の下へを無効化する");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="2"] button[data-chart-action="move-item-up"]').getAttribute("aria-label"), "3月を上へ移動", "項目名を含む上へボタンのアクセシブルな名前を付ける");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="2"] button[data-chart-action="move-item-up"]').click();
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.items.map((item) => item.label).join(",") === "1月,3月,2月"
        && JSON.stringify(current.series.map((series) => series.values)) === JSON.stringify([[100, 120, 140], [30, 38, 45], [60, 70, 80]])
        && document.activeElement?.getAttribute("data-chart-action") === "move-item-up"
        && document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "「3月」を2件目へ移動しました";
    });
    await waitForChartCategoryLabelNames(page, "#preview .chart-block-bar-chart .chart-block-label", ["1月", "3月", "2月"]);
    const barCategoryLabels = page.locator("#preview .chart-block-bar-chart .chart-block-label");
    assert.deepEqual(await chartCategoryLabelNames(barCategoryLabels), ["1月", "3月", "2月"], "集合棒の横軸の完全な項目名をaria-labelから取得する");
    assert.deepEqual(await chartCategoryLabelText(barCategoryLabels), ["1月", "3月", "2月"], "集合棒の横軸の表示文字はtspanから取得する");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] button[data-chart-action="move-item-down"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.items.map((item) => item.label).join(",") === "1月,2月,3月");
    multiEditor = page.locator(".chart-block-editor");
    const invalidReorderValue = multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] input[data-chart-series-value][data-chart-series-index="0"]');
    await invalidReorderValue.fill("Infinity");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] button[data-chart-action="move-item-down"]').click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "2件目の売上の数値" && document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "数値は有限な数値を入力してください");
    assert.equal(await invalidReorderValue.inputValue(), "Infinity", "不正な編集中の文字列を並べ替えで破棄しない");
    assert.deepEqual((await chart(page)).items.map((item) => item.label), ["1月", "2月", "3月"], "不正値では項目を移動しない");
    await invalidReorderValue.fill("140");
    const multiChartId = (await chart(page)).id;
    const barMode = multiEditor.locator('select[aria-label="グラフ1の棒の表示方法"]');
    assert.equal(await barMode.inputValue(), "grouped", "旧形式の棒グラフは集合表示として開く");
    await barMode.selectOption("stacked");
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.appearance?.barMode === "stacked" && document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "stacked";
    });
    const stackedMetrics = await page.locator("#preview .chart-block-stacked-bar rect").evaluateAll((bars) => bars.map((bar) => ({
      itemId: bar.closest(".chart-block-bar")?.dataset.chartItemId,
      seriesId: bar.closest(".chart-block-bar")?.dataset.chartSeriesId,
      x: Number(bar.getAttribute("x")), y: Number(bar.getAttribute("y")), height: Number(bar.getAttribute("height")), fill: bar.getAttribute("fill")
    })));
    assert.equal(stackedMetrics.length, 9, "3項目・3系列を積み上げ棒として描画する");
    for (const itemId of ["jan", "feb", "mar"]) {
      const segments = stackedMetrics.filter((segment) => segment.itemId === itemId);
      assert.equal(new Set(segments.map((segment) => segment.x)).size, 1, `${itemId}の積み上げ系列は同じx位置を使う`);
      assert.equal(segments[0].y + segments[0].height, 196, `${itemId}の第1系列は基線から積み上げる`);
      assert.equal(segments[1].y + segments[1].height, segments[0].y, `${itemId}の第2系列は連続して積み上げる`);
      assert.equal(segments[2].y + segments[2].height, segments[1].y, `${itemId}の第3系列は連続して積み上げる`);
    }
    assert.deepEqual(stackedMetrics.slice(0, 3).map((segment) => [segment.seriesId, segment.fill]), (await chart(page)).series.map((series) => [series.id, series.color]), "系列色と積み上げ順を維持する");
    assert.deepEqual(await page.locator("#preview .chart-block-bar-chart .sr-only li").allTextContents(), [
      "1月、売上: 100万円", "1月、営業利益: 30万円", "1月、原価: 60万円",
      "2月、売上: 140万円", "2月、営業利益: 45万円", "2月、原価: 80万円",
      "3月、売上: 120万円", "3月、営業利益: 38万円", "3月、原価: 70万円"
    ], "積み上げ棒も全系列を読み上げ対象にする");
    const stackTotals = multiEditor.locator('input[aria-label="グラフ1の合計値を表示"]');
    assert.equal(await stackTotals.isChecked(), false, "新規の合計値表示はオフで始める");
    await stackTotals.check();
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.appearance?.showStackTotals === true && document.querySelectorAll("#preview .chart-block-stacked-total-value").length === 3;
    });
    assert.deepEqual(await page.locator("#preview .chart-block-stacked-total-value").allTextContents(), ["190", "265", "228"], "各積み上げ棒の上へ系列合計を表示する");
    assert.deepEqual(await page.locator("#preview .chart-block-bar-chart .sr-only li").allTextContents(), [
      "1月、売上: 100万円", "1月、営業利益: 30万円", "1月、原価: 60万円", "1月、合計: 190万円",
      "2月、売上: 140万円", "2月、営業利益: 45万円", "2月、原価: 80万円", "2月、合計: 265万円",
      "3月、売上: 120万円", "3月、営業利益: 38万円", "3月、原価: 70万円", "3月、合計: 228万円"
    ], "合計表示時は項目名と合計をスクリーンリーダーへ追加する");
    const totalLabelBoxes = await page.locator("#preview .chart-block-stacked-total-value").evaluateAll((labels) => labels.map((label) => {
      const total = label.getBoundingClientRect();
      const segments = [...label.closest(".chart-block-bar-group")?.querySelectorAll(".chart-block-stacked-value") || []].map((segment) => segment.getBoundingClientRect());
      const svg = label.ownerSVGElement?.getBoundingClientRect();
      return {
        total: { x: total.x, y: total.y, width: total.width, height: total.height },
        segments: segments.map((segment) => ({ x: segment.x, y: segment.y, width: segment.width, height: segment.height })),
        svg: svg && { left: svg.left, right: svg.right, top: svg.top, bottom: svg.bottom }
      };
    }));
    assert.ok(totalLabelBoxes.every(({ total, svg }) => total.x >= svg.left && total.x + total.width <= svg.right && total.y >= svg.top && total.y + total.height <= svg.bottom), "合計ラベルをSVG内へ置く");
    assert.ok(totalLabelBoxes.every(({ total }, index) => totalLabelBoxes.slice(index + 1).every((other) => !boxesOverlap(total, other.total))), "すべての隣接合計ラベルを重ねない");
    assert.ok(totalLabelBoxes.every(({ total, segments }) => segments.every((segment) => !boxesOverlap(total, segment))), "合計ラベルを関連するすべての系列内ラベルと重ねない");
    assert.deepEqual(await page.locator("#preview .chart-block-stacked-total-title").allTextContents(), ["1月、合計: 190万円", "2月、合計: 265万円", "3月、合計: 228万円"], "短い合計も詳細titleを持つ");
    const originalStackedBody = await page.locator("#editor").inputValue();
    const originalStackedValues = (await chart(page)).series.map((series) => series.values.slice());
    const longTotalValues = [
      [9.87654321098765e122, 1.23456789012345e123, 2.34567890123456e123],
      [8.76543210987654e122, 1.34567890123456e123, 2.45678901234567e123],
      [7.65432109876543e122, 1.45678901234567e123, 2.56789012345678e123]
    ];
    for (let seriesIndex = 0; seriesIndex < longTotalValues.length; seriesIndex += 1) {
      for (let itemIndex = 0; itemIndex < longTotalValues[seriesIndex].length; itemIndex += 1) {
        await multiEditor.locator(`.chart-block-item-row[data-chart-item-index="${itemIndex}"] input[data-chart-series-value][data-chart-series-index="${seriesIndex}"]`).fill(String(longTotalValues[seriesIndex][itemIndex]));
      }
    }
    await page.waitForFunction((expected) => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return JSON.stringify(current?.series.map((series) => series.values)) === JSON.stringify(expected);
    }, longTotalValues);
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      const totals = window.MemoNexusChartBlockUtils.chartStackedTotals(current?.items, current?.series);
      const labels = [...document.querySelectorAll("#preview .chart-block-stacked-total-value")];
      return labels.length === totals.length && labels.every((label, index) => label.textContent === window.MemoNexusChartBlockUtils.formatChartStackTotal(totals[index]));
    });
    const longTotalLayout = await page.locator("#preview .chart-block-stacked-total-value").evaluateAll((labels) => labels.map((label) => {
      const group = label.closest(".chart-block-bar-group");
      const total = label.getBoundingClientRect();
      const svg = label.ownerSVGElement?.getBoundingClientRect();
      const segmentLabels = [...group.querySelectorAll(".chart-block-stacked-value")].map((segment) => segment.getBoundingClientRect());
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      const itemIndex = current.items.findIndex((item) => item.id === group.dataset.chartItemId);
      const totalEntry = window.MemoNexusChartBlockUtils.chartStackedTotals(current.items, current.series)[itemIndex];
      return {
        item: current.items[itemIndex].label,
        display: label.textContent,
        detail: window.MemoNexusChartBlockUtils.formatChartStackTotalDetail(totalEntry),
        title: group.querySelector(".chart-block-stacked-total-title")?.textContent,
        total: { x: total.x, y: total.y, width: total.width, height: total.height },
        segmentLabels: segmentLabels.map((segment) => ({ x: segment.x, y: segment.y, width: segment.width, height: segment.height })),
        svg: svg && { left: svg.left, right: svg.right, top: svg.top, bottom: svg.bottom }
      };
    }));
    assert.ok(longTotalLayout.every((entry) => entry.display.length <= 11 && entry.display !== entry.detail && /e[+-]\d+$/.test(entry.display)), `長い有限合計を短い科学表記へ表示する: ${JSON.stringify(longTotalLayout)}`);
    assert.ok(longTotalLayout.every((entry) => entry.title === `${entry.item}、合計: ${entry.detail}万円`), "短縮前の有限合計をtitleへ残す");
    assert.ok(longTotalLayout.every(({ total, svg }) => total.x >= svg.left && total.x + total.width <= svg.right && total.y >= svg.top && total.y + total.height <= svg.bottom), "長い合計ラベルもSVG左右内に収める");
    assert.ok(longTotalLayout.every(({ total }, index) => longTotalLayout.slice(index + 1).every((other) => !boxesOverlap(total, other.total))), "長い隣接合計ラベル同士を重ねない");
    assert.ok(longTotalLayout.every(({ total, segmentLabels }) => segmentLabels.every((segment) => !boxesOverlap(total, segment))), "長い合計ラベルを関連するすべての系列内ラベルと重ねない");
    const longTotalAccessibleItems = await page.locator("#preview .chart-block-bar-chart .sr-only li").allTextContents();
    assert.ok(longTotalLayout.every((entry) => longTotalAccessibleItems.includes(`${entry.item}、合計: ${entry.detail}万円`)), "読み上げには短縮前の安全な合計を残す");
    for (let seriesIndex = 0; seriesIndex < originalStackedValues.length; seriesIndex += 1) {
      for (let itemIndex = 0; itemIndex < originalStackedValues[seriesIndex].length; itemIndex += 1) {
        await multiEditor.locator(`.chart-block-item-row[data-chart-item-index="${itemIndex}"] input[data-chart-series-value][data-chart-series-index="${seriesIndex}"]`).fill(String(originalStackedValues[seriesIndex][itemIndex]));
      }
    }
    await page.waitForFunction((expected) => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return JSON.stringify(current?.series.map((series) => series.values)) === JSON.stringify(expected);
    }, originalStackedValues);
    step("stacked geometry and narrow layouts");
    await page.setViewportSize({ width: 320, height: 820 });
    await page.waitForFunction(() => innerWidth === 320 && document.body.dataset.layoutMode === "mobile");
    const narrowContextPanel = page.locator("#contextPanel");
    if (await narrowContextPanel.getAttribute("aria-hidden") !== "true") {
      await page.locator("#closeContextPanelBtn").click();
      await page.waitForFunction(() => document.getElementById("contextPanel")?.getAttribute("aria-hidden") === "true");
    }
    await multiEditor.locator('.chart-block-series-row button[data-chart-action="delete-series"]').last().click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.series.length === 2);
    await multiEditor.locator('.chart-block-series-row button[data-chart-action="delete-series"]').last().click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.series.length === 1);
    await multiEditor.locator('button[data-chart-action="add-item"]').click();
    await multiEditor.locator('button[data-chart-action="add-item"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.items.length === 5);
    const narrowValues = [Number.MAX_VALUE, 1.7e308, 1.6e308, 1.5e308, 1.4e308];
    for (let itemIndex = 0; itemIndex < narrowValues.length; itemIndex += 1) {
      await multiEditor.locator(`.chart-block-item-row[data-chart-item-index="${itemIndex}"] input[data-chart-item-field="label"]`).fill(`最狭${itemIndex + 1}`);
      await multiEditor.locator(`.chart-block-item-row[data-chart-item-index="${itemIndex}"] input[data-chart-series-value][data-chart-series-index="0"]`).fill(String(narrowValues[itemIndex]));
    }
    await page.waitForFunction((expected) => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      const labels = [...document.querySelectorAll("#preview .chart-block-stacked-total-value")];
      const totals = window.MemoNexusChartBlockUtils.chartStackedTotals(current?.items, current?.series);
      return current?.appearance?.barMode === "stacked" && current?.appearance?.showStackTotals === true && current?.series.length === 1 && current?.items.length === 5
        && JSON.stringify(current.series[0].values) === JSON.stringify(expected)
        && labels.length === 5 && labels.every((label, index) => label.textContent === window.MemoNexusChartBlockUtils.formatChartStackTotal(totals[index]));
    }, narrowValues);
    const narrowTotalLayout = await page.locator("#preview .chart-block-stacked-total-value").evaluateAll((labels) => labels.map((label) => {
      const group = label.closest(".chart-block-bar-group");
      const total = label.getBoundingClientRect();
      const svg = label.ownerSVGElement?.getBoundingClientRect();
      const segmentLabels = [...group.querySelectorAll(".chart-block-stacked-value")].map((segment) => segment.getBoundingClientRect());
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      const itemIndex = current.items.findIndex((item) => item.id === group.dataset.chartItemId);
      const detail = window.MemoNexusChartBlockUtils.formatChartStackTotalDetail(window.MemoNexusChartBlockUtils.chartStackedTotals(current.items, current.series)[itemIndex]);
      return {
        item: current.items[itemIndex].label,
        display: label.textContent,
        detail,
        title: group.querySelector(".chart-block-stacked-total-title")?.textContent,
        total: { x: total.x, y: total.y, width: total.width, height: total.height },
        segmentLabels: segmentLabels.map((segment) => ({ x: segment.x, y: segment.y, width: segment.width, height: segment.height })),
        svg: svg && { left: svg.left, right: svg.right, top: svg.top, bottom: svg.bottom }
      };
    }));
    const narrowPlot = await page.locator("#preview .chart-block-bar-chart svg").evaluate((svg) => {
      const axis = [...svg.querySelectorAll(".chart-block-axis")].find((line) => line.getAttribute("y1") === line.getAttribute("y2"));
      const boxes = (selector) => [...svg.querySelectorAll(selector)].map((element) => {
        const { x, y, width, height } = element.getBBox();
        return { x, y, width, height, text: element.textContent, className: element.getAttribute("class") };
      });
      return {
        viewBox: svg.getAttribute("viewBox").trim().split(/\s+/).map(Number),
        centers: [...svg.querySelectorAll(".chart-block-bar-group")].map((group) => {
          const rect = group.querySelector("rect");
          return Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2;
        }),
        axisStart: Number(axis.getAttribute("x1")),
        axisEnd: Number(axis.getAttribute("x2")),
        ticks: boxes(".chart-block-axis-value"),
        bars: boxes(".chart-block-bar rect"),
        totals: boxes(".chart-block-stacked-total-value"),
        invalidAttributes: [svg, ...svg.querySelectorAll("*")].flatMap((element) => [...element.attributes]
          .filter((attribute) => /NaN|Infinity/.test(attribute.value)).map((attribute) => attribute.name))
      };
    });
    assert.equal(narrowPlot.viewBox.length, 4, "viewBoxは4要素を持つ");
    assert.ok(narrowPlot.viewBox.every(Number.isFinite), "巨大有限値でもviewBoxの全要素が有限である");
    assert.deepEqual([narrowPlot.viewBox[0], narrowPlot.viewBox[1], narrowPlot.viewBox[3]], [0, 0, 260], "SVGの原点と高さを維持する");
    assert.equal(narrowPlot.centers.length, 5, "巨大有限値の5項目をすべて描画する");
    const narrowGaps = narrowPlot.centers.slice(1).map((center, index) => center - narrowPlot.centers[index]);
    assert.ok(narrowGaps.every((gap) => Math.abs(gap - 75.2) <= 0.05), "1系列・5項目の棒中心間隔は74単位＋6単位の余裕を5等分した75.2単位を保つ");
    const narrowPlotStart = narrowPlot.centers[0] - narrowGaps[0] / 2;
    assert.ok(Math.abs(narrowPlot.axisEnd - narrowPlotStart - 376) <= 0.05, "動的な軸余白が増えても5項目分の描画領域376単位を縮めない");
    assert.ok(Math.abs(narrowPlot.axisEnd - narrowPlot.centers.at(-1) - narrowGaps.at(-1) / 2) <= 0.05, "末尾にも半項目分の領域を確保する");
    assert.ok(narrowPlot.ticks.length > 0, "巨大有限値の数値目盛りを表示する");
    assert.equal(narrowPlot.bars.length, 5, "巨大有限値の棒を省略しない");
    assert.equal(narrowPlot.totals.length, 5, "巨大有限値の合計を省略しない");
    assert.ok([...narrowPlot.ticks, ...narrowPlot.bars, ...narrowPlot.totals].every(({ x, y, width, height }) =>
      [x, y, width, height].every(Number.isFinite) && x >= -0.05 && y >= -0.05
      && x + width <= narrowPlot.viewBox[2] + 0.05 && y + height <= 260.05), `目盛り・棒・合計ラベルをSVG内に収める: ${JSON.stringify(narrowPlot)}`);
    assert.ok(narrowPlot.ticks.every(({ x, width }) => x + width < narrowPlot.axisStart), "数値目盛りを軸線より左へ収めて描画領域と重ねない");
    assert.deepEqual(narrowPlot.invalidAttributes, [], "巨大有限値でもNaN・InfinityをSVG属性へ渡さない");
    assert.ok(narrowTotalLayout.every((entry) => entry.display.length <= 10 && /e[+-]\d+$/.test(entry.display)), "最狭幅でも長い有限合計を短い科学表記へ表示する");
    assert.ok(narrowTotalLayout.every((entry) => entry.title === `${entry.item}、合計: ${entry.detail}万円` && !entry.title.includes("00000000000000004")), "最狭幅でもtitleへ人間向け詳細値を残す");
    const maximumFiniteLayout = narrowTotalLayout[0];
    assert.ok(maximumFiniteLayout.display !== "上限超過" && !/Infinity|NaN/.test(maximumFiniteLayout.display) && /e[+-]\d+$/.test(maximumFiniteLayout.display), "最大有限値も最狭幅で科学表記として表示する");
    assert.ok(maximumFiniteLayout.detail !== "上限超過" && !/Infinity|NaN/.test(maximumFiniteLayout.detail) && !/上限超過|Infinity|NaN/.test(maximumFiniteLayout.title), "最大有限値のtitleへ有限な詳細値を残す");
    assert.ok(narrowTotalLayout.every(({ total, svg }) => total.x >= svg.left && total.x + total.width <= svg.right && total.y >= svg.top && total.y + total.height <= svg.bottom), "最狭幅でも合計ラベルをSVG上下左右内へ置く");
    assert.ok(narrowTotalLayout.every(({ total }, index) => narrowTotalLayout.slice(index + 1).every((other) => boxesHaveGap(total, other.total))), "最狭幅でも全合計ラベルの間に安全余白を持たせる");
    assert.ok(narrowTotalLayout.every(({ total, segmentLabels }) => segmentLabels.every((segment) => boxesHaveGap(total, segment))), "最狭幅でも合計ラベルを関連する全系列内ラベルから離す");
    const narrowAccessibleItems = await page.locator("#preview .chart-block-bar-chart .sr-only li").allTextContents();
    assert.ok(narrowTotalLayout.every((entry) => narrowAccessibleItems.includes(`${entry.item}、合計: ${entry.detail}万円`) && !entry.detail.includes("00000000000000004")), "最狭幅でも読み上げへ人間向け詳細値を残す");
    assert.ok(narrowAccessibleItems.includes(`${maximumFiniteLayout.item}、合計: ${maximumFiniteLayout.detail}万円`), "最大有限値も読み上げで上限超過にしない");
    await page.setViewportSize({ width: 1100, height: 820 });
    await page.waitForFunction(() => innerWidth === 1100 && document.body.dataset.layoutMode !== "mobile");
    await page.locator("#editor").fill(originalStackedBody);
    await waitForChartEditorSyncAfterBodyInput(page, 1);
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.series.length === 3 && current?.items.length === 3 && current?.appearance?.showStackTotals === true
        && document.querySelectorAll("#preview .chart-block-stacked-total-value").length === 3;
    });
    const valuesToggle = multiEditor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]');
    await valuesToggle.uncheck();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-stacked-value").length === 0 && document.querySelectorAll("#preview .chart-block-stacked-total-value").length === 3);
    await valuesToggle.check();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-stacked-value").length > 0);
    await barMode.selectOption("percent-stacked");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked" && document.querySelectorAll("#preview .chart-block-stacked-total-value").length === 0);
    assert.equal(await multiEditor.locator('input[aria-label="グラフ1の合計値を表示"]').count(), 0, "100%積み上げでは合計値の操作欄を表示しない");
    const orientation = multiEditor.locator('select[aria-label="グラフ1の棒の向き"]');
    await orientation.selectOption("horizontal");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarOrientation === "horizontal");
    const longHorizontalLabel = "空白を含まない非常に長い日本語項目名を横棒で確認するためのテストです";
    await multiEditor.locator('input[aria-label="1件目の項目名"]').fill(longHorizontalLabel);
    await page.waitForFunction((label) => [...document.querySelectorAll("#preview .chart-block-horizontal-label title")].some((title) => title.textContent === label), longHorizontalLabel);
    const longLabelLayout = await page.locator("#preview .chart-block-horizontal-label").first().evaluate((label) => {
      const text = label.getBoundingClientRect();
      const bars = [...label.closest(".chart-block-bar-group").querySelectorAll("rect")].map((bar) => bar.getBoundingClientRect());
      const svg = label.ownerSVGElement.getBoundingClientRect();
      return { text, leftBar: Math.min(...bars.map((bar) => bar.left)), svg, title: label.querySelector("title")?.textContent, lines: label.querySelectorAll("tspan").length };
    });
    assert.equal(longLabelLayout.title, longHorizontalLabel, "省略した横棒項目名もSVG titleに全文を残す");
    assert.ok(longLabelLayout.lines <= 2 && longLabelLayout.text.right <= longLabelLayout.leftBar && longLabelLayout.text.left >= longLabelLayout.svg.left, "長い横棒項目名を最大2行で棒と重ねずSVG内へ置く");
    await multiEditor.locator('input[aria-label="1件目の項目名"]').fill("1月");
    await page.waitForFunction(() => {
      const chart = document.querySelector("#preview .chart-block-horizontal-bar-chart");
      const label = chart?.querySelector(".chart-block-horizontal-label");
      return label?.querySelector("tspan")?.textContent === "1月"
        && label?.querySelector("title")?.textContent === "1月";
    });
    const horizontalPercent = await page.locator("#preview .chart-block-percent-stacked-bar rect").evaluateAll((bars) => bars.map((bar) => ({ x: Number(bar.getAttribute("x")), y: Number(bar.getAttribute("y")), width: Number(bar.getAttribute("width")), height: Number(bar.getAttribute("height")) })));
    assert.equal(horizontalPercent.length, 9, "横向き100%積み上げでも3項目・3系列を描画する");
    assert.ok(horizontalPercent.every((segment) => Object.values(segment).every(Number.isFinite) && segment.width > 0 && segment.height > 0), "横棒のSVG属性へNaNやInfinityを出さない");
    assert.deepEqual(await page.locator("#preview .chart-block-percent-axis-value").allTextContents(), ["0%", "25%", "50%", "75%", "100%"], "横向き100%積み上げも割合目盛りを表示する");
    await barMode.selectOption("stacked");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-horizontal-bar-chart .chart-block-stacked-total-value").length === 3);
    const horizontalTotals = await page.locator("#preview .chart-block-horizontal-bar-chart .chart-block-stacked-total-value").evaluateAll((labels) => labels.map((label) => {
      const labelBox = label.getBoundingClientRect();
      const bars = [...label.closest(".chart-block-bar-group").querySelectorAll("rect")].map((bar) => bar.getBoundingClientRect());
      return { label: labelBox, right: Math.max(...bars.map((bar) => bar.right)), svg: label.ownerSVGElement.getBoundingClientRect() };
    }));
    assert.ok(horizontalTotals.every(({ label, right, svg }) => label.left >= right && label.right <= svg.right), "横向き通常積み上げの合計ラベルを棒の右端かつSVG内へ置く");
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-line"));
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("pie");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-pie"));
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarOrientation === "horizontal");
    assert.equal((await chart(page)).appearance.barOrientation, "horizontal", "棒→折れ線→円→棒でも横向き設定を保持する");
    await orientation.selectOption("vertical");
    await barMode.selectOption("percent-stacked");
    await page.waitForFunction((chartId) => {
      const chart = [...document.querySelectorAll("#preview .chart-block-bar-chart")]
        .find((candidate) => candidate.dataset.chartId === chartId);
      return chart?.dataset.chartBarMode === "percent-stacked"
        && !chart.classList.contains("chart-block-horizontal-bar-chart");
    }, multiChartId);
    await barMode.selectOption("grouped");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "grouped" && document.querySelectorAll("#preview .chart-block-stacked-total-value").length === 0);
    assert.equal(await multiEditor.locator('input[aria-label="グラフ1の合計値を表示"]').count(), 0, "集合棒では合計値の操作欄を表示しない");
    await barMode.selectOption("stacked");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "stacked" && document.querySelectorAll("#preview .chart-block-stacked-total-value").length === 3);
    assert.equal(await multiEditor.locator('input[aria-label="グラフ1の合計値を表示"]').isChecked(), true, "通常積み上げへ戻すと保存中の合計値設定を復元する");
    const valuesBeforePercentStacked = (await chart(page)).series.map((series) => series.values.slice());
    await barMode.selectOption("percent-stacked");
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.appearance?.barMode === "percent-stacked" && document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked";
    });
    assert.deepEqual((await chart(page)).series.map((series) => series.values), valuesBeforePercentStacked, "100%積み上げへの切替で元の実数値を変更しない");
    const percentStackedMetrics = await page.locator("#preview .chart-block-percent-stacked-bar rect").evaluateAll((bars) => bars.map((bar) => ({
      itemId: bar.closest(".chart-block-bar")?.dataset.chartItemId,
      seriesId: bar.closest(".chart-block-bar")?.dataset.chartSeriesId,
      x: Number(bar.getAttribute("x")), y: Number(bar.getAttribute("y")), height: Number(bar.getAttribute("height")), fill: bar.getAttribute("fill")
    })));
    assert.equal(percentStackedMetrics.length, 9, "3項目・3系列を100%積み上げとして描画する");
    for (const itemId of ["jan", "feb", "mar"]) {
      const segments = percentStackedMetrics.filter((segment) => segment.itemId === itemId);
      assert.equal(new Set(segments.map((segment) => segment.x)).size, 1, `${itemId}の100%積み上げ系列は同じx位置を使う`);
      assert.equal(segments[0].y + segments[0].height, 196, `${itemId}の第1系列は基線から積み上げる`);
      assert.equal(segments.at(-1).y, 54, `${itemId}の棒は100%で同じ高さにする`);
      assert.ok(segments.every((segment) => Number.isFinite(segment.y) && Number.isFinite(segment.height) && segment.height > 0), `${itemId}のSVG属性へNaNやInfinityを出さない`);
    }
    assert.deepEqual(percentStackedMetrics.slice(0, 3).map((segment) => [segment.seriesId, segment.fill]), (await chart(page)).series.map((series) => [series.id, series.color]), "100%積み上げでも系列順と色を維持する");
    assert.deepEqual(await page.locator("#preview .chart-block-percent-stacked-value").allTextContents(), ["53%", "16%", "32%", "53%", "17%", "30%", "53%", "17%", "31%"], "値表示を未丸めの割合から一貫して丸める");
    const percentLabelBoxes = await page.locator("#preview .chart-block-percent-stacked-value").evaluateAll((labels) => labels.map((label) => {
      const text = label.getBoundingClientRect();
      const rect = label.closest(".chart-block-bar")?.querySelector("rect")?.getBoundingClientRect();
      return { text: { x: text.x, y: text.y, width: text.width, height: text.height }, rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }));
    assert.ok(percentLabelBoxes.every(({ text, rect }) => rect && text.x >= rect.x && text.y >= rect.y && text.x + text.width <= rect.x + rect.width && text.y + text.height <= rect.y + rect.height), "区間ラベルを対応する棒の内側へ安全に配置する");
    assert.ok(percentLabelBoxes.every(({ text }, index) => percentLabelBoxes.slice(index + 1).every((other) => !boxesOverlap(text, other.text))), "表示した割合ラベルを重ねない");
    assert.deepEqual(await page.locator("#preview .chart-block-percent-axis-value").allTextContents(), ["0%", "25%", "50%", "75%", "100%"], "100%積み上げのY軸を割合表示にする");
    assert.deepEqual(await page.locator("#preview .chart-block-bar-chart .sr-only li").allTextContents(), [
      "1月、売上: 100万円、53%、項目合計: 190万円", "1月、営業利益: 30万円、16%、項目合計: 190万円", "1月、原価: 60万円、32%、項目合計: 190万円",
      "2月、売上: 140万円、53%、項目合計: 265万円", "2月、営業利益: 45万円、17%、項目合計: 265万円", "2月、原価: 80万円、30%、項目合計: 265万円",
      "3月、売上: 120万円、53%、項目合計: 228万円", "3月、営業利益: 38万円、17%、項目合計: 228万円", "3月、原価: 70万円、31%、項目合計: 228万円"
    ].map((entry, index) => {
      const item = Math.floor(index / 3), series = index % 3;
      const values = valuesBeforePercentStacked.map((row) => row[item]);
      const scale = Math.max(...values);
      const percentage = (values[series] / scale) / values.reduce((sum, value) => sum + value / scale, 0) * 100;
      return entry.replace(/、(\d+%)、項目合計:/, `（$1、割合: ${percentage}%、項目合計:`) + "）";
    }), "100%積み上げは元の値、丸め割合、未丸め割合、項目合計を読み上げ対象にする");
    await barMode.selectOption("grouped");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "grouped");
    assert.deepEqual((await chart(page)).series.map((series) => series.values), valuesBeforePercentStacked, "集合へ戻しても元の実数値を復元する");
    await barMode.selectOption("percent-stacked");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked");
    await multiEditor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]').uncheck();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-stacked-value").length === 0);
    await multiEditor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]').check();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-stacked-value").length > 0);
    await orientation.selectOption("horizontal");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarOrientation === "horizontal");
    for (const viewportWidth of [320, 375, 390, 430]) {
      await page.setViewportSize({ width: viewportWidth, height: 760 });
      await page.waitForFunction((width) => innerWidth === width && document.body.dataset.layoutMode === "mobile", viewportWidth);
      const contextPanel = page.locator("#contextPanel");
      if (await contextPanel.getAttribute("aria-hidden") !== "true") {
        await page.locator("#closeContextPanelBtn").click();
        await page.waitForFunction(() => document.getElementById("contextPanel")?.getAttribute("aria-hidden") === "true");
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      const cardPaneButton = page.locator("#cardPaneBtn");
      if (await cardPaneButton.getAttribute("aria-expanded") !== "true") {
        const cardPaneClickPoint = await page.evaluate(() => {
          const button = document.getElementById("cardPaneBtn");
          if (!button) return null;
          const rect = button.getBoundingClientRect();
          for (let y = 2; y < rect.height - 1; y += 2) {
            for (let x = 2; x < rect.width - 1; x += 2) {
              const hit = document.elementFromPoint(Math.round(rect.left + x), Math.round(rect.top + y));
              if (hit === button || button.contains(hit)) return { x: Math.round(x), y: Math.round(y) };
            }
          }
          return null;
        });
        assert.ok(cardPaneClickPoint, `${viewportWidth}pxで100%積み上げカード表示ボタンの実ヒット領域を持つ`);
        await cardPaneButton.click({ position: cardPaneClickPoint });
      }
      await page.waitForFunction(() => document.getElementById("previewCard")?.getAttribute("aria-hidden") === "false");
      await page.waitForFunction(() => {
        const card = document.getElementById("previewCard")?.getBoundingClientRect();
        return card && card.left >= 0 && card.right <= window.innerWidth;
      });
      const percentMobileMetrics = await page.locator("#preview .chart-block-percent-stacked-bar-chart, #preview .chart-block-bar-chart[data-chart-bar-mode='percent-stacked']").evaluate((element) => {
        const select = document.querySelector('.chart-block-editor select[aria-label="グラフ1の棒の表示方法"]')?.getBoundingClientRect();
        const table = document.querySelector(".chart-block-item-table");
        const chartScroll = element.querySelector(".chart-block-scroll");
        const card = element.getBoundingClientRect();
        return {
          card: { left: card.left, right: card.right, width: card.width },
          select: select && { left: select.left, right: select.right },
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
          tableScrollable: table?.scrollWidth > table?.clientWidth,
          chartScrollable: chartScroll?.scrollWidth > chartScroll?.clientWidth
        };
      });
      assert.ok(percentMobileMetrics.card.left >= -0.5 && percentMobileMetrics.card.right <= viewportWidth + 0.5, `${viewportWidth}pxで100%積み上げカードを画面内へ収める`);
      assert.ok(percentMobileMetrics.select && percentMobileMetrics.select.left >= -0.5 && percentMobileMetrics.select.right <= viewportWidth + 0.5, `${viewportWidth}pxで棒の表示方法を操作可能にする`);
      assert.equal(percentMobileMetrics.documentOverflow, 0, `${viewportWidth}pxでdocumentの横スクロールを作らない`);
      assert.equal(percentMobileMetrics.bodyOverflow, 0, `${viewportWidth}pxでbodyの横スクロールを作らない`);
      assert.equal(percentMobileMetrics.tableScrollable, true, `${viewportWidth}pxで入力表だけを横スクロール可能にする`);
      assert.equal(percentMobileMetrics.chartScrollable, true, `${viewportWidth}pxで横棒の横スクロールをグラフ領域だけへ閉じ込める`);
    }
    step("multi-series type changes, mobile layout and persistence");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
    await multiEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.waitForFunction(() => document.querySelector(".chart-block-series-notice")?.hidden === true && document.querySelectorAll("#preview .chart-block-line-series").length === 3 && document.querySelectorAll("#preview .chart-block-line-item").length === 9);
    const multiLineLayout = await page.locator("#preview .chart-block-line svg").evaluate((svg) => ({
      viewBox: svg.getAttribute("viewBox").trim().split(/\s+/).map(Number),
      positions: [...svg.querySelectorAll(".chart-block-line-series")].map((series) =>
        [...series.querySelectorAll(".chart-block-line-point")].map((point) => Number(point.getAttribute("cx")))),
      axisEnd: Number([...svg.querySelectorAll(".chart-block-axis")].find((axis) => axis.getAttribute("y1") === axis.getAttribute("y2")).getAttribute("x2"))
    }));
    assert.equal(multiLineLayout.viewBox.length, 4, "折れ線のviewBoxは4要素を持つ");
    assert.ok(multiLineLayout.viewBox.every(Number.isFinite), "折れ線の動的viewBoxは有限である");
    assert.deepEqual([multiLineLayout.viewBox[0], multiLineLayout.viewBox[1], multiLineLayout.viewBox[3]], [0, 0, 260], "折れ線の原点と高さを維持する");
    assert.equal(multiLineLayout.positions.length, 3, "3系列の描画領域を検証する");
    const linePositions = multiLineLayout.positions[0];
    assert.equal(linePositions.length, 3, "折れ線の横軸は系列数ではなく3項目で構成する");
    assert.ok(linePositions.every(Number.isFinite), "各項目のx座標は有限である");
    assert.ok(multiLineLayout.positions.every((positions) => JSON.stringify(positions) === JSON.stringify(linePositions)), "全系列は同じ3項目のx座標を共有し、系列ごとに領域を横へ追加しない");
    assert.ok(Math.abs((linePositions[1] - linePositions[0]) - (linePositions[2] - linePositions[1])) <= 0.05, "3項目を等間隔で配置する");
    assert.ok(linePositions[2] - linePositions[0] >= 3 * 74 + 6, "数値軸余白を除いた描画領域に3項目分の最小幅を保つ");
    assert.ok(linePositions[0] > 0 && Math.abs(linePositions[2] - multiLineLayout.axisEnd) <= 0.05
      && multiLineLayout.axisEnd < multiLineLayout.viewBox[2], "折れ線が確保された横軸領域を使いSVG内に収まる");
    assert.equal(await page.locator("#preview .chart-block-line-path").count(), 3, "3系列を独立した折れ線で描画する");
    assert.equal(await page.locator("#preview .chart-block-line-point").count(), 9, "3系列・3項目の9点を描画する");
    assert.deepEqual(await page.locator("#preview .chart-block-line .chart-block-legend li").allTextContents(), ["売上", "営業利益", "原価"], "折れ線の凡例へ全系列の名前と色を表示する");
    assert.deepEqual(await page.locator("#preview .chart-block-line .sr-only li").allTextContents(), [
      "1月、売上: 100万円", "1月、営業利益: 30万円", "1月、原価: 60万円",
      "2月、売上: 140万円", "2月、営業利益: 45万円", "2月、原価: 80万円",
      "3月、売上: 120万円", "3月、営業利益: 38万円", "3月、原価: 70万円"
    ], "折れ線は表示中の全系列を読み上げ対象にする");
    const lineMetrics = await page.locator("#preview .chart-block-line-point").evaluateAll((points) => points.map((point) => ({ cy: Number(point.getAttribute("cy")), stroke: point.getAttribute("stroke") })));
    assert.ok(lineMetrics.every((point) => Number.isFinite(point.cy) && point.cy >= 0), "複数系列の折れ線SVGへ不正な座標を渡さない");
    assert.ok(lineMetrics.some((point) => point.cy === 42), "全系列の最大値140を折れ線の共通スケールへ使う");
    for (const viewportWidth of [320, 375, 390, 430]) {
      await page.setViewportSize({ width: viewportWidth, height: 760 });
      await page.waitForFunction((width) => innerWidth === width && document.body.dataset.layoutMode === "mobile", viewportWidth);
      const contextPanel = page.locator("#contextPanel");
      if (await contextPanel.getAttribute("aria-hidden") !== "true") {
        await page.locator("#closeContextPanelBtn").click();
        await page.waitForFunction(() => document.getElementById("contextPanel")?.getAttribute("aria-hidden") === "true");
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => window.scrollY === 0);
      const cardPaneButton = page.locator("#cardPaneBtn");
      if (await cardPaneButton.getAttribute("aria-expanded") !== "true") {
        const cardPaneClickPoint = await page.evaluate(() => {
          const button = document.getElementById("cardPaneBtn");
          if (!button) return null;
          const rect = button.getBoundingClientRect();
          for (let y = 2; y < rect.height - 1; y += 2) {
            for (let x = 2; x < rect.width - 1; x += 2) {
              const hit = document.elementFromPoint(Math.round(rect.left + x), Math.round(rect.top + y));
              if (hit === button || button.contains(hit)) return { x: Math.round(x), y: Math.round(y) };
            }
          }
          return null;
        });
        assert.ok(cardPaneClickPoint, `${viewportWidth}pxでカード表示ボタンの実ヒット領域を持つ`);
        await cardPaneButton.click({ position: cardPaneClickPoint });
      }
      await page.waitForFunction(() => document.getElementById("previewCard")?.getAttribute("aria-hidden") === "false");
      await page.waitForFunction(() => {
        const card = document.getElementById("previewCard")?.getBoundingClientRect();
        return card && card.left >= 0 && card.right <= window.innerWidth;
      });
      const mobileLineMetrics = await page.locator("#preview .chart-block-line").evaluate((element) => {
        const rect = (selector) => {
          const box = element.querySelector(selector)?.getBoundingClientRect();
          return box && { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
        };
        return {
          card: element.getBoundingClientRect().width,
          viewport: innerWidth,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scroll: rect(".chart-block-scroll"),
          legend: rect(".chart-block-legend"),
          edit: rect(".chart-block-edit"),
          tableScrollable: document.querySelector(".chart-block-item-table")?.scrollWidth > document.querySelector(".chart-block-item-table")?.clientWidth
        };
      });
      assert.ok(mobileLineMetrics.card <= mobileLineMetrics.viewport, `${viewportWidth}pxで3系列折れ線カードを画面内へ収める`);
      assert.equal(mobileLineMetrics.pageOverflow, 0, `${viewportWidth}pxでページ全体の横スクロールを作らない`);
      assert.ok(mobileLineMetrics.legend.top >= mobileLineMetrics.scroll.bottom - 0.5, `${viewportWidth}pxで凡例をグラフ領域の後ろへ折り返す`);
      assert.ok(mobileLineMetrics.edit.left >= -0.5 && mobileLineMetrics.edit.right <= mobileLineMetrics.viewport + 0.5, `${viewportWidth}pxで編集ボタンを操作可能にする: ${JSON.stringify(mobileLineMetrics)}`);
      assert.equal(mobileLineMetrics.tableScrollable, true, `${viewportWidth}pxで入力表だけを横スクロール可能にする`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
    await page.locator('.chart-block-editor select[aria-label="グラフ1の種類"]').selectOption("pie");
    await page.waitForFunction(() => document.querySelector(".chart-block-series-notice")?.hidden === false && document.querySelectorAll("#preview .chart-block-pie-slice").length === 3);
    assert.deepEqual(await page.locator("#preview .chart-block-pie .sr-only li").allTextContents(), ["1月、売上: 100万円（割合: 27.77777777777778%）", "2月、売上: 140万円（割合: 38.888888888888886%）", "3月、売上: 120万円（割合: 33.33333333333333%）"], "円グラフは第1系列だけを読み上げ対象にする");
    await page.locator('.chart-block-editor select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 9);
    assert.equal((await chart(page)).appearance.barMode, "percent-stacked", "棒から折れ線、円を経由しても100%積み上げ設定を保持する");
    assert.equal(await page.locator("#preview .chart-block-bar-chart .sr-only li").count(), 9, "棒グラフへ戻すと全系列を再び読み上げ対象にする");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('button[data-chart-action="add-item"]').click();
    multiEditor = page.locator(".chart-block-editor");
    const newRow = multiEditor.locator('.chart-block-item-row[data-chart-item-index="3"]');
    await newRow.locator('input[data-chart-item-field="label"]').fill("4月");
    assert.deepEqual(await newRow.locator('input[data-chart-series-value]').evaluateAll((inputs) => inputs.map((input) => input.value)), ["0", "0", "0"], "項目追加時に全系列の値を0で初期化する");
    await page.waitForFunction(() => document.querySelectorAll('#preview .chart-block-percent-stacked-bar[data-chart-item-id]').length === 12 && document.querySelectorAll('#preview .chart-block-percent-stacked-bar[data-chart-item-id] rect').length === 9);
    assert.equal(await page.locator('#preview .chart-block-percent-stacked-bar[data-chart-item-id] text').count(), 9, "合計0の項目では棒区間と割合ラベルを表示しない");
    await newRow.locator('button[data-chart-action="delete-item"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.series?.[2]?.values.join(",") === "60,80,70");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('.chart-block-series-row[data-chart-series-index="1"] button[data-chart-action="delete-series"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.series.map((series) => series.name).join(",") === "売上,原価");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 6);
    assert.equal(await page.locator("#preview .chart-block-bar").count(), 6, "系列削除後も他系列の値をずらさない");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.waitForFunction(() => document.querySelector(".chart-block-series-notice")?.hidden === true && document.querySelectorAll("#preview .chart-block-line-item").length === 6);
    assert.equal((await chart(page)).series.length, 2, "折れ線へ切替えても第2系列を保持する");
    await page.locator('.chart-block-editor select[aria-label="グラフ1の種類"]').selectOption("pie");
    await page.waitForFunction(() => document.querySelector(".chart-block-series-notice")?.hidden === false && document.querySelectorAll("#preview .chart-block-pie-slice").length === 3);
    await page.locator('.chart-block-editor select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 6);
    await page.locator('.chart-block-editor button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    const multiBeforeReload = await chart(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.deepEqual(await chart(page), multiBeforeReload, "複数系列を保存・再読み込み後も復元する");
    assert.equal(await page.locator("#preview .chart-block-bar").count(), 6, "再読み込み後も集合棒を復元する");
    multiEditor = page.locator(".chart-block-editor");
    assert.equal(await multiEditor.locator('select[aria-label="グラフ1の棒の表示方法"]').inputValue(), "percent-stacked", "再読み込み後も100%積み上げ表示を復元する");
    await multiEditor.locator('select[aria-label="グラフ1の棒の表示方法"]').selectOption("grouped");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "grouped");
    await multiEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked");
    await waitForChartCancelCompletion(page, 0);
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] button[data-chart-action="move-item-down"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.items.map((item) => item.label).join(",") === "1月,3月,2月");
    await multiEditor.locator('button[data-chart-action="cancel"]').click();
    await waitForChartCancelCompletion(page, 0);
    assert.deepEqual((await chart(page)).items.map((item) => item.label), ["1月", "2月", "3月"], "並べ替え後の取消で編集開始時の順序へ戻す");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] button[data-chart-action="move-item-down"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.items.map((item) => item.label).join(",") === "1月,3月,2月");
    await multiEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await waitForChartCategoryLabelNames(page, "#preview .chart-block-line .chart-block-label", ["1月", "3月", "2月"]);
    assert.deepEqual(await chartCategoryLabelNames(page.locator("#preview .chart-block-line .chart-block-label")), ["1月", "3月", "2月"], "折れ線の横軸の完全な項目名をaria-labelから取得する");
    assert.deepEqual(await chartCategoryLabelText(page.locator("#preview .chart-block-line .chart-block-label")), ["1月", "3月", "2月"], "折れ線の横軸の表示文字はtspanから取得する");
    assert.equal(await page.locator("#preview .chart-block-line-item").count(), 6, "折れ線は並べ替え後も全系列のデータ点を描画する");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("pie");
    await waitForPieSlices(page, 3);
    assert.deepEqual(await page.locator("#preview .chart-block-pie .sr-only li").allTextContents(), ["1月、売上: 100万円（割合: 27.77777777777778%）", "3月、売上: 120万円（割合: 33.333333333333336%）", "2月、売上: 140万円（割合: 38.88888888888889%）"], "円グラフも並べ替えた第1系列との対応を維持する");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => {
      const chart = document.querySelector("#preview .chart-block-bar-chart");
      const labels = [...chart?.querySelectorAll(".chart-block-label") || []]
        .map((label) => label.querySelector("tspan")?.textContent || "");
      return chart?.querySelectorAll(".chart-block-bar").length === 6
        && labels.join(",") === "1月,3月,2月";
    });
    await multiEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.deepEqual((await chart(page)).items.map((item) => item.label), ["1月", "3月", "2月"], "確定した並べ替えを再読み込み後も復元する");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('.chart-block-series-row[data-chart-series-index="1"] button[data-chart-action="delete-series"]').click();
    await page.waitForFunction(() => {
      const editor = document.querySelector(".chart-block-editor");
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      const labels = [...editor?.querySelectorAll('input[data-chart-series-value][data-chart-series-index="0"]') || []].map((input) => input.getAttribute("aria-label"));
      return current?.series.length === 1 && labels.join(",") === "1件目の数値,2件目の数値,3件目の数値";
    });
    const persistentLongLabel = "空白を含まないVeryLongCategoryIdentifierForAxisLayout確認用項目名";
    assert.equal((await chart(page)).appearance.barOrientation, "horizontal", "前段で保存した横向き設定が再読み込み後も残る");
    await multiEditor.locator('select[aria-label="グラフ1の棒の向き"]').selectOption("vertical");
    await page.waitForFunction(() => {
      const chart = document.querySelector("#preview .chart-block-bar-chart");
      return chart && !chart.classList.contains("chart-block-horizontal-bar-chart")
        && document.querySelector('select[aria-label="グラフ1の棒の向き"]')?.value === "vertical";
    });
    await multiEditor.locator('input[aria-label="1件目の項目名"]').fill(persistentLongLabel);
    await page.waitForFunction((label) => {
      const text = document.querySelector("#preview .chart-block-bar-chart .chart-block-label");
      return text?.getAttribute("aria-label") === label
        && text.querySelector("title")?.textContent === label
        && text.querySelectorAll("tspan").length === 2;
    }, persistentLongLabel);
    const verticalLongLabelLayout = await page.locator("#preview .chart-block-bar-chart .chart-block-label").first().evaluate((label) => {
      const text = label.getBoundingClientRect();
      const svg = label.ownerSVGElement.getBoundingClientRect();
      const horizontalAxis = [...label.ownerSVGElement.querySelectorAll(".chart-block-axis")].at(-1).getBoundingClientRect();
      return { text, svg, horizontalAxis, title: label.querySelector("title")?.textContent, aria: label.getAttribute("aria-label") };
    });
    assert.equal(verticalLongLabelLayout.title, persistentLongLabel, "縦棒で省略前の項目名をtitleへ保持する");
    assert.equal(verticalLongLabelLayout.aria, persistentLongLabel, "縦棒で省略前の項目名をaria-labelへ保持する");
    assert.ok(verticalLongLabelLayout.text.left >= verticalLongLabelLayout.svg.left && verticalLongLabelLayout.text.right <= verticalLongLabelLayout.svg.right && verticalLongLabelLayout.text.top >= verticalLongLabelLayout.horizontalAxis.bottom, "縦棒の長い項目名を軸線とSVG領域の外へ出さない");
    await multiEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    multiEditor = page.locator(".chart-block-editor");
    assert.equal(await multiEditor.locator('input[aria-label="1件目の項目名"]').inputValue(), persistentLongLabel, "保存・再読み込み・再編集後も元の長い項目名を保持する");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.waitForFunction((label) => {
      const text = document.querySelector("#preview .chart-block-line .chart-block-label");
      return text?.getAttribute("aria-label") === label && text.querySelector("title")?.textContent === label && text.querySelectorAll("tspan").length === 2;
    }, persistentLongLabel);
    const lineLongLabelLayout = await page.locator("#preview .chart-block-line .chart-block-label").first().evaluate((label) => {
      const text = label.getBoundingClientRect();
      const svg = label.ownerSVGElement.getBoundingClientRect();
      const horizontalAxis = [...label.ownerSVGElement.querySelectorAll(".chart-block-axis")].at(-1).getBoundingClientRect();
      return { text, svg, horizontalAxis };
    });
    assert.ok(lineLongLabelLayout.text.left >= lineLongLabelLayout.svg.left && lineLongLabelLayout.text.right <= lineLongLabelLayout.svg.right && lineLongLabelLayout.text.top >= lineLongLabelLayout.horizontalAxis.bottom, "折れ線の長い項目名を軸線とSVG領域の外へ出さない");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart"));
    const previewChart = page.locator("#preview .chart-block").first();
    await page.screenshot({ path: screenshotPath });
    await page.setViewportSize({ width: 390, height: 760 });
    const metrics = await previewChart.evaluate((element) => ({ card: element.getBoundingClientRect().width, viewport: innerWidth, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    assert.ok(metrics.card <= metrics.viewport, "390px幅でもグラフカードが画面からはみ出さない");
    assert.equal(metrics.pageOverflow, 0, "390px幅でもページ全体の横スクロールを作らない");
    });

    await runPageFeature("chart-signed-values", async (page) => verifySignedCharts(page));
    await runPageFeature("chart-diverging-stacked", async (page, step) => verifyDivergingStacks(page, false, step));
    await runPageFeature("chart-diverging-percent", async (page, step) => verifyDivergingStacks(page, true, step));
    await runPageFeature("chart-combo", async (page, step) => verifyComboCharts(page, step));
    await runPageFeature("chart-dual-axis", async (page, step) => verifyDualAxisCharts(page, { chart, waitForChartCancelCompletion, step }));
    await runPageFeature("chart-axis-titles", async (page, step) => verifyAxisTitles(page, { chart, waitForChartCancelCompletion, step }));
    await runPageFeature("chart-tooltips", async (page, step) => verifyChartTooltips(page, step));
    await runPageFeature("chart-tsv-import", async (page, step) => verifyChartTsv(page, step));
    await runPageFeature("chart-data-table", async (page, step) => verifyChartDataTable(page, step));
    await runPageFeature("chart-tsv-copy", async (page, step) => verifyChartTsvCopy(page, step));
    await runPageFeature("chart-png-export", async (page, step) => verifyChartPng(page, step));
    await runPageFeature("chart-png-copy", async (page, step) => verifyChartPngClipboard(page, step));
    await runPageFeature("chart-svg-export", async (page, step) => verifyChartSvg(page, step));
    await runPageFeature("table-to-chart", async (page, step) => verifyTableToChart(page, step));
    await report.feature("chart-tooltips-touch", async ({ beginStep }) => { beginStep("touch UI and assertions"); await verifyTouchTooltips(browser, appUrl); });
    await report.feature("chart-tsv-import-touch", async ({ beginStep }) => { beginStep("touch UI and assertions"); await verifyChartTsvTouch(browser, appUrl); });
    await report.feature("chart-data-table-touch", async ({ beginStep }) => { beginStep("touch UI and assertions"); await verifyChartDataTableTouch(browser, appUrl); });
    await report.feature("chart-tsv-copy-touch", async ({ beginStep }) => { beginStep("touch UI and assertions"); await verifyChartTsvCopyTouch(browser, appUrl); });
    await report.feature("chart-png-export-touch", async ({ beginStep }) => { beginStep("touch UI and assertions"); await verifyChartPngTouch(browser, appUrl); });
    await report.feature("chart-png-copy-touch", async ({ beginStep }) => { beginStep("touch UI and assertions"); await verifyChartPngClipboardTouch(browser, appUrl); });
    await report.feature("chart-png-copy-native", async ({ beginStep }) => { beginStep("touch UI and assertions"); await verifyNativeClipboard(browser, appUrl); });
    await report.feature("chart-svg-export-touch", async ({ beginStep }) => { beginStep("touch UI and assertions"); await verifyChartSvgTouch(browser, appUrl); });
    await report.feature("table-to-chart-touch", async ({ beginStep }) => { beginStep("touch UI and assertions"); await verifyTableToChartTouch(browser, appUrl); });
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    let cleanupError = null;
    try {
      if (browser) await browser.close();
    } catch (error) {
      if (runError) console.error("Browser cleanup failed", error);
      else cleanupError = error;
    }
    try {
      await closeStaticServer(server);
    } catch (error) {
      if (runError) console.error("Static server cleanup failed", error);
      else if (!cleanupError) cleanupError = error;
    }
    report.summary();
    if (cleanupError) throw cleanupError;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
