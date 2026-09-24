"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { startCardOpenObservation, finishCardOpenObservation, summarizeCardOpenObservations } = require("./chart-card-open-observation.e2e.js");
const { traceCardOpen } = require("./chart-card-click-trace.e2e.js");

function createDualAxisProfile() {
  if (process.env.MEMO_NEXUS_E2E_BROWSER !== "webkit"
    || process.env.MEMO_NEXUS_E2E_DUAL_AXIS_PROFILE !== "1") return null;
  const samples = [];
  const cardWaits = [];
  const cardObservations = [];
  return {
    record(stage, started, context, detail = false) {
      const ms = performance.now() - started;
      samples.push({ stage, ms, detail, ...context });
      return ms;
    },
    recordDuration(stage, ms, context) {
      samples.push({ stage, ms, detail: true, ...context });
    },
    recordCardWait(ms, context) {
      cardWaits.push({ ms, context });
    },
    recordCardObservation(observation, context) {
      cardObservations.push({ observation, context });
    },
    addCardObservations(observed) {
      assert.equal(observed.length, cardWaits.length, "カード表示観測と2軸モバイル条件の件数が一致する");
      observed.forEach(({ ariaObservedMs, edgeObservedMs }, index) => {
        const { ms, context } = cardWaits[index];
        this.recordDuration("aria-observed", ariaObservedMs, context);
        this.recordDuration("edge-observed", edgeObservedMs, context);
        this.recordDuration("wait-residual", ms - ariaObservedMs - edgeObservedMs, context);
      });
    },
    summary() {
      const aggregate = (filter) => {
        const groups = {};
        for (const sample of samples) {
          const key = filter(sample);
          if (key === undefined) continue;
          const group = groups[key] ||= { count: 0, ms: 0, maxMs: 0 };
          group.count++;
          group.ms += sample.ms;
          group.maxMs = Math.max(group.maxMs, sample.ms);
        }
        return Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, {
          count: value.count, ms: Math.round(value.ms), perCallMs: Math.round(value.ms / value.count * 10) / 10,
          maxMs: Math.round(value.maxMs)
        }]));
      };
      console.log("[DUAL_AXIS_PROFILE] " + JSON.stringify({
        conditions: samples.filter((sample) => sample.stage === "geometry-assert" && !sample.detail).length,
        stages: aggregate((sample) => !sample.detail ? sample.stage : undefined),
        seriesCounts: aggregate((sample) => !sample.detail ? sample.seriesCount : undefined),
        datasets: aggregate((sample) => !sample.detail ? sample.dataset : undefined),
        themes: aggregate((sample) => !sample.detail ? sample.theme : undefined),
        widths: aggregate((sample) => !sample.detail ? sample.width : undefined),
        mobileCardShow: {
          stages: {
            ...Object.fromEntries(["context-state", "context-close-click", "context-close-wait", "card-click",
              "card-wait", "aria-observed", "edge-observed", "wait-residual", "show-residual"]
              .map((name) => [name, { count: 0, ms: 0, perCallMs: 0, maxMs: 0 }])),
            ...aggregate((sample) => sample.detail ? sample.stage : undefined)
          },
          slowest: samples.filter((sample) => sample.stage === "mobile-card-show" && !sample.detail)
            .sort((a, b) => b.ms - a.ms).slice(0, 5)
            .map(({ seriesCount, dataset, theme, width, ms }) => ({ seriesCount, dataset, theme, width, ms: Math.round(ms) })),
          pageObservation: summarizeCardOpenObservations(cardObservations)
        }
      }));
    }
  };
}

// Runs inside the official chart suite with the same browser, error collection,
// persistence route and UI completion conditions as the existing chart tests.
async function verifyDualAxisCharts(page, { chart, waitForChartCancelCompletion, step = () => {} }) {
  step("2-axis Chart creation, editing and validation");
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
  await page.locator("#editor").fill("左右2軸の新規作成");
  await page.locator("#insertChartBtn").click();
  const panel = page.locator(".chart-block-editor");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "グラフ1のタイトル");
  const field = (name) => panel.locator('[data-chart-field="' + name + '"]');
  const action = (name) => panel.locator('[data-chart-action="' + name + '"]');
  const input = (item, series) => panel.locator('[data-chart-item-index="' + item + '"] input[data-chart-series-index="' + series + '"]');
  const save = async () => {
    await action("confirm").click();
    await page.waitForFunction(() => document.querySelector('.chart-block-editor > .chart-block-status')?.textContent === "入力内容を保存しました");
    return page.locator("#editor").inputValue();
  };
  const cancel = async () => { await action("cancel").click(); await waitForChartCancelCompletion(page, 0); };
  await action("add-series").click();
  await field("chartType").selectOption("combo");
  assert.equal(await field("comboAxisMode").inputValue(), "single");
  assert.equal(await field("comboSecondaryUnit").count(), 0);
  await field("title").fill("売上と来店者数");
  await field("unit").fill("万円");
  await field("comboAxisMode").selectOption("dual");
  await field("comboSecondaryUnit").fill("  人  ");
  assert.equal((await chart(page)).appearance.comboSecondaryUnit, "人");
  await input(0, 0).fill("30"); await input(0, 1).fill("2000");
  for (let i = 1; i < 3; i++) {
    await action("add-item").click();
    // Addition transfers focus on the next animation frame, before the next fill.
    await page.waitForFunction((index) => document.activeElement?.matches('input[data-chart-item-field="label"]')
      && document.activeElement.closest("[data-chart-item-index]")?.dataset.chartItemIndex === String(index), i);
  }
  const itemLabels = ["非常に長い項目名の日本語とLongIdentifierを省略しても情報を残す", "地域1", "地域2"];
  for (let i = 0; i < itemLabels.length; i++) await panel.locator('[data-chart-item-index="' + i + '"] [data-chart-item-field="label"]').fill(itemLabels[i]);
  assert.deepEqual((await chart(page)).items.map((item) => item.label), itemLabels, "追加後のフォーカス完了後に全項目名を入力する");
  for (let i = 1; i < 3; i++) { await input(i, 0).fill(String(i * 20)); await input(i, 1).fill(String(i * 1000)); }
  await field("showLegend").check();
  const initial = await chart(page);
  const selected = initial.appearance.comboLineSeriesId;
  await field("comboAxisMode").selectOption("single");
  assert.equal(await field("comboSecondaryUnit").count(), 0);
  assert.equal((await chart(page)).appearance.comboSecondaryUnit, "人");
  assert.deepEqual((await chart(page)).series, initial.series);
  await field("comboAxisMode").selectOption("dual");
  assert.equal(await field("comboSecondaryUnit").inputValue(), "人");
  await panel.locator('[data-chart-series-index="1"] [data-chart-series-field="name"]').fill("来店者数（改名）");
  await panel.locator('[data-chart-series-index="1"] [data-chart-action="move-series-up"]').click();
  await page.waitForFunction((id) => document.activeElement?.closest('[data-chart-series-id]')?.dataset.chartSeriesId === id, selected);
  assert.equal(await field("comboLineSeriesId").inputValue(), selected);
  await panel.locator('[data-chart-item-index="1"] [data-chart-action="move-item-up"]').click();
  await page.waitForFunction((id) => document.activeElement?.closest('[data-chart-item-id]')?.dataset.chartItemId === id, initial.items[1].id);
  const reordered = await chart(page);
  assert.deepEqual(reordered.items.map((i) => i.id), [initial.items[1].id, initial.items[0].id, initial.items[2].id]);
  assert.deepEqual(reordered.series.map((s) => s.values), [[1000, 2000, 2000], [20, 30, 40]]);
  const savedBody = await save();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" }); await panel.waitFor({ state: "visible" });
  assert.equal(await page.locator("#editor").inputValue(), savedBody);
  assert.deepEqual(await chart(page), reordered);
  await page.locator('#preview .chart-block-edit').click();
  assert.equal(await panel.evaluate((el) => document.activeElement === el), true);
  for (const destination of ["bar", "line", "pie"]) {
    await field("chartType").selectOption(destination);
    assert.equal(await field("comboAxisMode").count(), 0);
    assert.equal(await field("comboSecondaryUnit").count(), 0);
    assert.deepEqual((await chart(page)).series, reordered.series);
    await field("chartType").selectOption("combo");
    assert.equal(await field("comboAxisMode").inputValue(), "dual");
    assert.equal(await field("comboSecondaryUnit").inputValue(), "人");
    assert.equal(await field("comboLineSeriesId").inputValue(), selected);
  }
  await cancel(); assert.equal(await page.locator("#editor").inputValue(), savedBody);
  await field("comboLineSeriesId").selectOption(reordered.series[1].id);
  assert.equal((await chart(page)).appearance.comboLineSeriesId, reordered.series[1].id);
  await action("add-series").click();
  const third = (await chart(page)).series.at(-1).id;
  await field("comboLineSeriesId").selectOption(third);
  await panel.locator('[data-chart-series-index="2"] [data-chart-action="delete-series"]').click();
  assert.equal(await field("comboLineSeriesId").inputValue(), reordered.series[1].id);
  await panel.locator('[data-chart-series-index="1"] [data-chart-action="delete-series"]').click();
  assert.equal(await action("confirm").isDisabled(), true);
  await input(0, 0).fill("-77");
  await cancel(); assert.equal(await page.locator("#editor").inputValue(), savedBody);
  for (const invalid of ["", "-", "NaN", "Infinity", "-Infinity", "1e"]) {
    await input(0, 0).fill(invalid);
    await field("comboAxisMode").selectOption("single");
    assert.equal(await field("comboAxisMode").inputValue(), "dual");
    assert.equal(await input(0, 0).inputValue(), invalid);
    await action("confirm").click();
    assert.equal(await input(0, 0).getAttribute("aria-invalid"), "true");
    assert.equal(await page.locator("#editor").inputValue(), savedBody);
    await cancel();
  }
  await field("comboSecondaryUnit").fill('長い右軸単位<script>unit</script>人');
  assert.equal(await panel.locator('script').count(), 0);
  await field("unit").fill("左の非常に長い単位・万円");
  const datasets = [
    [[30,20,0],[1000,2000,0],[20,10,0]],
    [[-30,-20,0],[-1000,-2000,0],[-20,-10,0]],
    [[30,-20,0],[-1000,2000,0],[20,-10,0]],
    [[30,20,0],[-1000,-2000,0],[20,10,0]],
    [[0,0,0],[-1000,2000,0],[0,0,0]],
    [[0,0,0],[0,0,0],[0,0,0]],
    [[0.3,-0.2,-0],[-1.2,2.4,0],[0.1,0.2,0]],
    [[Number.MAX_VALUE,-Number.MAX_VALUE,0],[-Number.MIN_VALUE,Number.MIN_VALUE,0],[1e300,-1e-300,0]]
  ];
  let count = 0;
  const profile = createDualAxisProfile();
  let condition = {};
  let phase = "data-preview";
  step("160 geometry combinations across data, theme and width");
  try { for (const seriesCount of [2, 3]) {
    condition = { seriesCount };
    phase = "series-setup";
    if (seriesCount === 3) await action("add-series").click();
    for (const theme of ["light", "dark"]) {
      condition = { seriesCount, theme };
      phase = "theme";
      let started = profile && performance.now();
      await page.locator("#settingsBtn").click(); await page.locator("#themeSelect").selectOption(theme); await page.locator("#closeSettingsBtn").click();
      if (profile) profile.record(phase, started, condition);
      for (const [dataset, values] of datasets.entries()) {
        condition = { seriesCount, dataset, theme };
        phase = "data-preview";
        started = profile && performance.now();
        for (let i = 0; i < 3; i++) for (let j = 0; j < seriesCount; j++) await input(i, j).fill(String(values[j][i]));
        // The second series remains the right axis even when a third bar is added.
        await field("comboLineSeriesId").selectOption((await chart(page)).series[1].id);
        const model = await chart(page);
        await page.waitForFunction((model) => {
          const fig = document.querySelector('#preview .chart-block-combo-dual');
          return model.items.every((item, i) => model.series.every((s) => [...(fig?.querySelectorAll('g > title') || [])].some((el) => el.textContent === item.label + '、' + s.name + (s.id === model.appearance.comboLineSeriesId ? '（折れ線・右軸）' : '（棒・左軸）') + ': ' + String(s.values[i]) + (s.id === model.appearance.comboLineSeriesId ? model.appearance.comboSecondaryUnit : model.unit))));
        }, model);
        if (profile) profile.record(phase, started, condition);
        for (const width of [320, 375, 390, 430, 1100]) {
          condition = { seriesCount, dataset, theme, width };
          phase = "viewport-layout";
          started = profile && performance.now();
          await page.setViewportSize({ width, height: 820 });
          await page.waitForFunction((width) => innerWidth === width && document.body.dataset.layoutMode === (width >= 1100 ? "wide" : "mobile"), width);
          if (profile) profile.record(phase, started, condition);
          if (width < 1100) {
            phase = "mobile-card-show";
            started = profile && performance.now();
            const detail = {};
            let stageStarted = profile && performance.now();
            const contextOpen = await page.locator("#contextPanel").getAttribute("aria-hidden") === "false";
            if (profile) detail.contextState = profile.record("context-state", stageStarted, condition, true);
            if (contextOpen) {
              stageStarted = profile && performance.now();
              await page.locator("#closeContextPanelBtn").click();
              if (profile) detail.contextClick = profile.record("context-close-click", stageStarted, condition, true);
              stageStarted = profile && performance.now();
              await page.waitForFunction(() => document.getElementById("contextPanel").getAttribute("aria-hidden") === "true");
              if (profile) detail.contextWait = profile.record("context-close-wait", stageStarted, condition, true);
            }
            await traceCardOpen(page, "dual-axis", condition, async () => {
            if (profile) await startCardOpenObservation(page);
            try {
              stageStarted = profile && performance.now();
              await page.locator("#cardPaneBtn").click();
              if (profile) detail.cardClick = profile.record("card-click", stageStarted, condition, true);
              stageStarted = profile && performance.now();
              if (profile) {
                await page.waitForFunction((state) => {
                  const now = performance.now();
                  if (state.first === null) state.first = now;
                  const card = document.getElementById("previewCard");
                  const ariaVisible = card.getAttribute("aria-hidden") === "false";
                  if (ariaVisible && state.aria === null) state.aria = now;
                  if (ariaVisible && Math.abs(card.getBoundingClientRect().right - innerWidth) < 1) {
                    (window.__dualAxisCardWaitProfile ||= []).push({ ariaObservedMs: state.aria - state.first, edgeObservedMs: now - state.aria });
                    return true;
                  }
                  return false;
                }, { first: null, aria: null });
                detail.cardWait = profile.record("card-wait", stageStarted, condition, true);
                profile.recordCardWait(detail.cardWait, condition);
              } else {
                await page.waitForFunction(() => { const card = document.getElementById("previewCard"); return card.getAttribute("aria-hidden") === "false" && Math.abs(card.getBoundingClientRect().right - innerWidth) < 1; });
              }
            } finally {
              if (profile) profile.recordCardObservation(await finishCardOpenObservation(page), condition);
            }
            });
            if (profile) {
              const parentMs = profile.record(phase, started, condition);
              profile.recordDuration("show-residual", parentMs - Object.values(detail).reduce((sum, ms) => sum + ms, 0), condition);
            }
          }
          phase = "geometry-read";
          await verifyDualGeometry(page, model, profile && ((stage, started) => {
            profile.record(stage, started, condition);
          }), () => { phase = "geometry-assert"; }); count++;
          if (seriesCount === 2 && values === datasets[2] && theme === "light" && [390, 1100].includes(width)) {
            phase = "screenshot";
            started = profile && performance.now();
            await page.screenshot({ path: path.join(os.tmpdir(), `memo-combo-dual-${width}-${process.env.MEMO_NEXUS_E2E_BROWSER || "chromium"}.png`) });
            if (profile) profile.record(phase, started, condition);
          }
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
  if (profile) {
    phase = "profile-read";
    profile.addCardObservations(await page.evaluate(() => {
      const samples = window.__dualAxisCardWaitProfile || [];
      delete window.__dualAxisCardWaitProfile;
      return samples;
    }));
  }
  } catch (error) {
    error.message += ` [2-axis condition=${JSON.stringify(condition)}, phase=${phase}]`;
    throw error;
  } finally {
    profile?.summary();
  }
  assert.equal(count, 160, "2/3 series × 8 datasets × 2 themes × 5 widths");
  const finalBody = await save(), finalModel = await chart(page);
  step("save/reload, legacy marker and cancel");
  await page.reload({ waitUntil: "domcontentloaded" }); await page.locator("#appStartupGuard").waitFor({ state: "hidden" }); await panel.waitFor({ state: "visible" });
  assert.equal(await page.locator("#editor").inputValue(), finalBody); assert.deepEqual(await chart(page), finalModel);
  await verifyDualGeometry(page, finalModel);
  const legacy = { ...finalModel, id: "legacy-dual-test", appearance: { comboLineSeriesId: "deleted", showLegend: true } };
  const raw = '<!-- memo-nexus:chart-block:' + Buffer.from(JSON.stringify(legacy)).toString('hex') + ' -->';
  await page.locator("#editor").fill(raw);
  await page.locator('.chart-block-editor[data-chart-id="legacy-dual-test"]').waitFor({ state: "visible" });
  assert.equal(await field("comboAxisMode").inputValue(), "single");
  assert.equal(await page.locator("#editor").inputValue(), raw);
  await field("comboAxisMode").selectOption("dual"); await field("comboSecondaryUnit").fill("取消する単位"); await input(0, 0).fill("-");
  await cancel(); assert.equal(await page.locator("#editor").inputValue(), raw);
  assert.equal(await field("comboAxisMode").inputValue(), "single");
  console.log("Dual-axis checks passed: " + count + " geometry combinations, UI creation, stable IDs, save/reload, type/axis switches, invalid drafts, legacy marker and cancel");
}

async function verifyDualGeometry(page, model, record = null, onAssertStart = null) {
  let started = record && performance.now();
  await page.locator('#preview .chart-block-combo-dual').waitFor({ state: 'attached' });
  // Acquire and measure the current preview in one task; rendering can replace a locator's resolved node.
  const state = await page.evaluate(() => {
    const figure = document.querySelector('#preview .chart-block-combo-dual');
    const svg = figure.querySelector('svg'), view = svg.viewBox.baseVal;
    const box = (el) => { const b = el.getBBox(); return { x:b.x, y:b.y, width:b.width, height:b.height }; };
    const overlaps = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
    const texts = [...svg.querySelectorAll('text')], marks = [...svg.querySelectorAll('rect,circle,polyline')];
    const obstacles = [...texts,...marks].flatMap((el) => el.tagName !== 'polyline' ? [{el,box:box(el)}] : Array.from({length:Math.max(0,el.points.numberOfItems-1)},(_,i) => {
      const a=el.points.getItem(i), b=el.points.getItem(i+1);
      return {el,box:{x:Math.min(a.x,b.x)-2,y:Math.min(a.y,b.y)-2,width:Math.abs(a.x-b.x)+4,height:Math.abs(a.y-b.y)+4}};
    }));
    const axis = svg.querySelector('line.chart-block-axis'), zero = svg.querySelector('.chart-block-zero-line');
    return {
      visible: figure.closest('#previewCard').getAttribute('aria-hidden') === 'false' && svg.getBoundingClientRect().width > 0,
      top:Number(axis.getAttribute('y1')), bottom:Number(axis.getAttribute('y2')), zero:Number(zero.getAttribute('y1')),
      zeroCount:svg.querySelectorAll('.chart-block-zero-line').length, hidden:zero.getAttribute('aria-hidden'),
      zeroTicks:[...svg.querySelectorAll('.chart-block-axis-zero')].map((el)=>Number(el.getAttribute('y'))-4),
      axisStrokes:[...svg.querySelectorAll('line')].map((el)=>getComputedStyle(el).stroke),
      ticks:[...svg.querySelectorAll('.chart-block-axis-value')].map((el)=>({text:el.querySelector('tspan')?.textContent, detail:el.getAttribute('aria-label'), title:el.querySelector('title')?.textContent})),
      bars:[...svg.querySelectorAll('.chart-block-bar')].map((g)=>({item:g.dataset.chartItemId,series:g.dataset.chartSeriesId,title:g.querySelector('title').textContent,rect:Object.fromEntries(['x','y','width','height'].map((a)=>[a,Number(g.querySelector('rect').getAttribute(a))]))})),
      points:[...svg.querySelectorAll('.chart-block-line-item')].map((g)=>({item:g.dataset.chartItemId,series:g.dataset.chartSeriesId,title:g.querySelector('title').textContent,x:Number(g.querySelector('circle').getAttribute('cx')),y:Number(g.querySelector('circle').getAttribute('cy'))})),
      invalid:[...svg.querySelectorAll('*')].flatMap((el)=>[...el.attributes].filter((a)=>/NaN|Infinity/.test(a.value)).map((a)=>a.name)),
      outside:[...texts,...marks].filter((el)=>{const b=box(el);return b.x < -0.1 || b.y < -0.1 || b.x+b.width > view.width+0.1 || b.y+b.height > view.height+0.1;}).map((el)=>el.outerHTML),
      collisions:texts.filter((el)=>el.matches('.chart-block-value,.chart-block-axis-value,.chart-block-unit')).flatMap((el)=>obstacles.filter((o)=>o.el!==el && overlaps(box(el),o.box)).map((o)=>[el.outerHTML,o.el.outerHTML])),
      overflow:document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.documentElement.clientWidth,
      units:[...svg.querySelectorAll('.chart-block-unit')].map((el)=>el.getAttribute('aria-label')),
      aria:svg.getAttribute('aria-label'),accessible:figure.querySelector('.sr-only').textContent,
      legend:[...figure.querySelectorAll('.chart-block-legend li')].map((el)=>el.textContent)
    };
  });
  onAssertStart?.();
  if (record) { record("geometry-read", started); started = performance.now(); }
  assert.equal(state.visible,true); assert.equal(state.zeroCount,1); assert.equal(state.hidden,'true');
  assert.equal(state.zeroTicks.length,2); assert.ok(state.zeroTicks.every((y)=>Math.abs(y-state.zero)<1e-8));
  assert.deepEqual(state.invalid,[]); assert.deepEqual(state.outside,[]); assert.deepEqual(state.collisions,[]); assert.equal(state.overflow,false);
  assert.ok(state.axisStrokes.every((s)=>s!=='none' && s!=='rgba(0, 0, 0, 0)'));
  assert.ok(state.ticks.every((t)=>t.text && t.detail===t.title && /左軸|右軸/.test(t.detail)));
  const axisTitle = (title, unit) => title && unit ? title + '（' + unit + '）' : title || unit || '単位なし';
  assert.deepEqual(state.units,['左軸・棒: '+axisTitle(model.appearance.leftAxisTitle,model.unit),'右軸・折れ線: '+axisTitle(model.appearance.rightAxisTitle,model.appearance.comboSecondaryUnit)]);
  assert.match(state.aria,/左右2軸/); assert.match(state.aria,/尺度が異なります/);
  const lineId=model.appearance.comboLineSeriesId;
  const kind=(s)=>s.id===lineId?'折れ線・右軸':'棒・左軸';
  assert.deepEqual(state.legend,model.series.map((s)=>s.name+'（'+kind(s)+'）'));
  assert.equal(state.bars.length,model.items.length*(model.series.length-1)); assert.equal(state.points.length,model.items.length);
  const all=model.series.flatMap((s)=>s.values), negative=all.some((v)=>v<0),positive=all.some((v)=>v>0);
  const ratio=negative?(positive?0.5:1):0;
  assert.ok(Math.abs(state.zero-(state.bottom-ratio*(state.bottom-state.top)))<1e-8);
  for (const mark of [...state.bars,...state.points]) {
    const s=model.series.find((s)=>s.id===mark.series), i=model.items.findIndex((i)=>i.id===mark.item),value=s.values[i];
    const data=model.series.filter((entry)=>(entry.id===lineId)===(s.id===lineId)).flatMap((s)=>s.values);
    const magnitude=Math.max(...data.map(Math.abs))||1;
    const y=state.bottom-(ratio+value/magnitude*(ratio===0.5?0.5:1))*(state.bottom-state.top);
    const detail=model.items[i].label+'、'+s.name+'（'+kind(s)+'）: '+String(value)+(s.id===lineId?model.appearance.comboSecondaryUnit:model.unit);
    assert.equal(mark.title,detail); assert.ok(state.accessible.includes(detail));
    if (mark.rect) {
      assert.notEqual(mark.series,lineId); assert.ok(Object.values(mark.rect).every(Number.isFinite));
      assert.ok(mark.rect.width>=0 && mark.rect.height>=0);
      assert.ok(Math.abs(mark.rect.y-Math.min(y,state.zero))<1e-8); assert.ok(Math.abs(mark.rect.height-Math.abs(y-state.zero))<1e-8);
    } else {
      assert.equal(mark.series,lineId); assert.ok(Number.isFinite(mark.x) && Number.isFinite(mark.y)); assert.ok(Math.abs(mark.y-y)<1e-8);
    }
  }
  if (record) record("geometry-assert", started);
}

module.exports = { verifyDualAxisCharts, verifyDualGeometry };
