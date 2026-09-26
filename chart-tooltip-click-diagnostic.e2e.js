"use strict";

const { performance } = require("node:perf_hooks");

// Keep the existing single-condition frame/actionability diagnostic available.
async function diagnoseTooltipCardClick(page, condition, click) {
  if (process.env.MEMO_NEXUS_E2E_BROWSER !== "webkit"
    || process.env.MEMO_NEXUS_E2E_TOOLTIP_DIAGNOSTIC !== "1"
    || condition.configIndex !== 10 || condition.theme !== "light" || condition.width !== 320) return click();

  const nodeBefore = performance.now();
  const pageStart = await page.evaluate(() => {
    const startAt = performance.now();
    const events = [{ atMs: 0, event: "start" }];
    const state = { startAt, events, frame: null, last: {}, repeatedBoxFrames: 0, stable: false,
      frameCount: 0, lastFrameAtMs: null, maxFrameGapMs: 0 };
    const sample = () => {
      state.frame = null;
      const button = document.getElementById("cardPaneBtn");
      const attached = Boolean(button?.isConnected);
      const rect = attached && button.getClientRects().length ? button.getBoundingClientRect() : null;
      const box = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      const visibility = attached ? getComputedStyle(button).visibility : null;
      const current = {
        attached,
        visible: Boolean(box && box.width > 0 && box.height > 0 && visibility !== "hidden" && visibility !== "collapse"),
        enabled: Boolean(attached && !button.matches(":disabled")),
        boundingBox: Boolean(box)
      };
      const atMs = performance.now() - startAt;
      if (state.lastFrameAtMs !== null) state.maxFrameGapMs = Math.max(state.maxFrameGapMs, atMs - state.lastFrameAtMs);
      state.lastFrameAtMs = atMs;
      state.frameCount++;
      for (const [name, value] of Object.entries(current)) {
        if (state.last[name] !== value) events.push({ atMs, event: name, value });
      }
      if (box && (!state.last.box || Object.keys(box).some((key) => box[key] !== state.last.box[key]))) {
        events.push({ atMs, event: "box", ...box });
        state.repeatedBoxFrames = 1;
        state.stable = false;
      } else if (box) {
        state.repeatedBoxFrames++;
        if (!state.stable && state.repeatedBoxFrames >= 3) {
          events.push({ atMs, event: "position-stable", frames: state.repeatedBoxFrames });
          state.stable = true;
        }
      } else {
        state.repeatedBoxFrames = 0;
        state.stable = false;
      }
      state.last = { ...current, box };
      state.frame = requestAnimationFrame(sample);
    };
    const button = document.getElementById("cardPaneBtn");
    const onClick = () => events.push({ atMs: performance.now() - startAt, event: "click-event" });
    button?.addEventListener("click", onClick, { capture: true });
    state.button = button;
    state.onClick = onClick;
    sample();
    window.__tooltipClickDiagnostic = state;
    return startAt;
  });
  const nodeAfter = performance.now();
  const nodePageStart = (nodeBefore + nodeAfter) / 2;
  const clickStartMs = performance.now() - nodePageStart;
  let clickEndMs;
  let clickError;
  try {
    return await click();
  } catch (error) {
    clickError = error;
    throw error;
  } finally {
    clickEndMs = performance.now() - nodePageStart;
    try {
      const observation = await page.evaluate(() => {
        const state = window.__tooltipClickDiagnostic;
        delete window.__tooltipClickDiagnostic;
        if (state.frame !== null) cancelAnimationFrame(state.frame);
        state.button?.removeEventListener("click", state.onClick, { capture: true });
        return { events: state.events, frameCount: state.frameCount,
          lastFrameAtMs: state.lastFrameAtMs, maxFrameGapMs: state.maxFrameGapMs };
      });
      console.log(`[TOOLTIP_DIAGNOSTIC] ${JSON.stringify({ condition, clock: "page performance.now; click boundaries aligned to Node midpoint",
        clockAlignmentErrorBoundMs: Math.round((nodeAfter - nodeBefore) / 2 * 10) / 10,
        pageStartAt: pageStart, clickStartMs, clickEndMs, clickError: clickError ? String(clickError) : null,
        ...observation })}`);
    } catch (diagnosticError) {
      console.error(`[TOOLTIP_DIAGNOSTIC] ${JSON.stringify({ condition, diagnosticError: String(diagnosticError) })}`);
      if (!clickError) throw diagnosticError;
    }
  }
}

function createTooltipClickInternals() {
  const handlerBoundary = process.env.MEMO_NEXUS_E2E_TOOLTIP_HANDLER_BOUNDARY === "1";
  if (process.env.MEMO_NEXUS_E2E_BROWSER !== "webkit"
    || (!handlerBoundary && process.env.MEMO_NEXUS_E2E_CARD_CLICK_INTERNALS !== "1")) return null;

  let clockOffsetMs = null;
  let clockAlignmentErrorBoundMs = null;
  let clickCalls = [];
  let installed = false;

  return {
    async start(page) {
      this.page = page;
      const nodeBefore = performance.now();
      let pageStartAt;
      try {
        pageStartAt = await page.evaluate((handlerBoundary) => {
          if (window.__cardClickInternals) throw new Error("Previous card click diagnostic was not collected");
          if (window.__tooltipHandlerBoundaryOnly) throw new Error("Previous handler boundary diagnostic was not collected");
          if (handlerBoundary) return performance.now();
          const button = document.getElementById("cardPaneBtn");
          const card = document.getElementById("previewCard");
          const events = [];
          let pendingIndex = null;
          const onClick = () => {
            const index = events.length;
            events.push({ index, t1: performance.now(), t2: null, t2Phase: null, t2DefaultPrevented: null, t4: null, mutation: null });
            pendingIndex = index;
          };
          const afterAppClick = (event) => {
            const observed = events[events.length - 1];
            if (!observed || observed.t2 !== null) return;
            observed.t2 = performance.now();
            observed.t2Phase = event.eventPhase;
            observed.t2DefaultPrevented = event.defaultPrevented;
          };
          const observer = new MutationObserver((records) => {
            if (pendingIndex === null) return;
            const event = events[pendingIndex];
            event.t4 = performance.now();
            const record = records[0];
            event.mutation = record ? {
              target: record.target.id || record.target.tagName.toLowerCase(),
              attribute: record.attributeName
            } : null;
            pendingIndex = null;
          });
          button?.addEventListener("click", onClick, { capture: true });
          if (button && handlerBoundary) button.addEventListener("click", afterAppClick);
          if (button) observer.observe(button, { attributes: true, attributeFilter: ["aria-expanded"] });
          if (card) observer.observe(card, { attributes: true, attributeFilter: ["aria-hidden", "class", "inert", "style"] });
          observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
          window.__cardClickInternals = { button, onClick, afterAppClick, handlerBoundary, observer, events };
          return performance.now();
        }, handlerBoundary);
        const nodeAfter = performance.now();
        clockOffsetMs = (nodeBefore + nodeAfter) / 2 - pageStartAt;
        clockAlignmentErrorBoundMs = (nodeAfter - nodeBefore) / 2;
        clickCalls = [];
        installed = true;
      } catch (error) {
        console.error(`[TOOLTIP_CLICK_INTERNALS] ${JSON.stringify({ diagnosticError: String(error), stage: "start" })}`);
      }
    },

    record(nodeStartMs, nodeEndMs, condition) {
      if (installed) clickCalls.push({ nodeStartMs, nodeEndMs, condition });
    },

    async measure(click, condition) {
      if (handlerBoundary) {
        const selected = (condition?.configIndex === 0 && condition.theme === "light" && condition.width === 320)
          || (condition?.configIndex === 4 && condition.theme === "light" && condition.width === 390)
          || (condition?.configIndex === 10 && condition.theme === "light" && condition.width === 320);
        if (!selected) return click();
        await this.page.evaluate(() => {
          const button = document.getElementById("cardPaneBtn");
          const sample = { t1: null, t2: null, t2Phase: null, t2DefaultPrevented: null };
          const capture = () => { sample.t1 = performance.now(); };
          const postApp = (event) => {
            sample.t2 = performance.now();
            sample.t2Phase = event.eventPhase;
            sample.t2DefaultPrevented = event.defaultPrevented;
          };
          button.addEventListener("click", capture, { capture: true });
          button.addEventListener("click", postApp);
          window.__tooltipHandlerBoundaryOnly = { button, capture, postApp, sample };
        });
        const nodeStartMs = performance.now();
        let result;
        let clickError;
        try { result = await click(); }
        catch (error) { clickError = error; }
        const nodeEndMs = performance.now();
        const event = await this.page.evaluate(() => {
          const state = window.__tooltipHandlerBoundaryOnly;
          if (!state) return null;
          delete window.__tooltipHandlerBoundaryOnly;
          state.button.removeEventListener("click", state.capture, { capture: true });
          state.button.removeEventListener("click", state.postApp);
          return state.sample;
        });
        if (installed) clickCalls.push({ nodeStartMs, nodeEndMs, condition, event });
        if (clickError) throw clickError;
        return result;
      }
      const nodeStartMs = performance.now();
      const result = await click();
      const nodeEndMs = performance.now();
      this.record(nodeStartMs, nodeEndMs, condition);
      return result;
    },

    async finish(page) {
      if (!installed) return;
      try {
        const events = handlerBoundary ? clickCalls.map((call) => call.event) : await page.evaluate(() => {
          const state = window.__cardClickInternals;
          if (!state) return null;
          delete window.__cardClickInternals;
          state.button?.removeEventListener("click", state.onClick, { capture: true });
          if (state.handlerBoundary) state.button?.removeEventListener("click", state.afterAppClick);
          state.observer.disconnect();
          return state.events;
        });
        if (!events) throw new Error("Browser observation was not available");
        const selected = (condition) => !handlerBoundary
          || ((condition?.configIndex === 0 && condition.theme === "light" && condition.width === 320)
            || (condition?.configIndex === 4 && condition.theme === "light" && condition.width === 390)
            || (condition?.configIndex === 10 && condition.theme === "light" && condition.width === 320));
        const values = handlerBoundary ? { domClickCaptureToPostAppListener: [] } : {
          playwrightToDomClick: [], domClickCaptureToPostAppListener: [], domClickToUiMutationObserved: [],
          uiMutationObservedToClickResolve: [], domClickToClickResolve: [], clickTotal: []
        };
        for (let index = 0; index < clickCalls.length; index++) {
          const call = clickCalls[index];
          const event = handlerBoundary ? call.event : events[index];
          if (!event || !selected(call.condition)) continue;
          if (!handlerBoundary) {
            const domClickNodeMs = event.t1 + clockOffsetMs;
            values.playwrightToDomClick.push(domClickNodeMs - call.nodeStartMs);
          }
          if (Number.isFinite(event.t2)) values.domClickCaptureToPostAppListener.push(event.t2 - event.t1);
          if (!handlerBoundary && Number.isFinite(event.t4)) {
            const mutationNodeMs = event.t4 + clockOffsetMs;
            values.domClickToUiMutationObserved.push(event.t4 - event.t1);
            values.uiMutationObservedToClickResolve.push(call.nodeEndMs - mutationNodeMs);
          }
          if (!handlerBoundary) {
            values.domClickToClickResolve.push(call.nodeEndMs - domClickNodeMs);
            values.clickTotal.push(call.nodeEndMs - call.nodeStartMs);
          }
        }
        const summarize = (samples) => {
          if (!samples.length) return { count: 0, totalMs: null, perCallMs: null, maxMs: null };
          const total = samples.reduce((sum, value) => sum + value, 0);
          return {
            count: samples.length,
            totalMs: Math.round(total),
            perCallMs: Math.round(total / samples.length * 10) / 10,
            maxMs: Math.round(Math.max(...samples))
          };
        };
        const missing = handlerBoundary ? {
          domClick: clickCalls.filter((call) => !Number.isFinite(call.event?.t1)).length,
          postAppListener: clickCalls.filter((call) => !Number.isFinite(call.event?.t2)).length
        } : {
          domClick: Math.max(0, clickCalls.length - events.length),
          uiMutation: events.filter((event) => !Number.isFinite(event.t4)).length
        };
        console.log(`[TOOLTIP_CLICK_INTERNALS] ${JSON.stringify({
          calls: clickCalls.length,
          clock: handlerBoundary ? "browser performance.now at both capture and post-app listeners" : "Node performance.now aligned to browser performance.now by setup-call midpoint",
          ...(handlerBoundary ? {} : { clockAlignmentErrorBoundMs: Math.round(clockAlignmentErrorBoundMs * 10) / 10 }),
          stages: Object.fromEntries(Object.entries(values).map(([name, samples]) => [name, summarize(samples)])),
          missing,
          boundary: handlerBoundary ? {
            definition: "same-target capture listener to same-target post-app listener",
            listenerPhase: "AT_TARGET (2)",
            postAppListenerPhases: clickCalls.filter((call) => selected(call.condition)).map((call) => call.event?.t2Phase ?? null),
            defaultPreventedAtPostAppListener: clickCalls.filter((call) => selected(call.condition)).map((call) => call.event?.t2DefaultPrevented ?? null),
            note: "not pure app handler duration"
          } : null,
          firstUiMutationMeans: handlerBoundary ? "not collected in the handler boundary diagnostic" : "first observed MutationObserver callback for card/body/button state attributes; not the exact mutation timestamp"
        })}`);
      } catch (error) {
        console.error(`[TOOLTIP_CLICK_INTERNALS] ${JSON.stringify({ diagnosticError: String(error), stage: "finish" })}`);
      } finally {
        installed = false;
        clickCalls = [];
      }
    }
  };
}

const clickBoundaryTrials = 10;

function summarizeClickBoundaries(trials) {
  const intervals = {
    t0ToPointerdown: { value: (trial) => trial.t0ToPointerdownMs },
    pointerdownToFocusin: { value: (trial) => trial.pointerdownToFocusinMs, from: "pointerdown", to: "focusin" },
    focusinToClick: { value: (trial) => trial.focusinToClickMs, from: "focusin", to: "click" },
    clickToSyncEnd: { value: (trial) => trial.clickToSyncEndMs, from: "click", to: "syncEnd" },
    syncEndToRaf: { value: (trial) => trial.syncEndToRafMs, from: "syncEnd", to: "raf" }
  };
  const round = (value) => Math.round(value * 1000) / 1000;
  const summary = Object.fromEntries(Object.entries(intervals).map(([name, interval]) => {
    const samples = trials.map((trial) => {
      const value = interval.value(trial);
      const fromIndex = interval.from && Array.isArray(trial.events) ? trial.events.indexOf(interval.from) : -1;
      const toIndex = interval.to && Array.isArray(trial.events) ? trial.events.indexOf(interval.to) : -1;
      const ordered = !interval.from || !Array.isArray(trial.events)
        || (fromIndex >= 0 && toIndex >= 0 && fromIndex < toIndex);
      return { value, ordered };
    });
    const values = samples.filter(({ value, ordered }) => Number.isFinite(value) && ordered)
      .map(({ value }) => value).sort((a, b) => a - b);
    const outOfOrderCount = samples.filter(({ value, ordered }) => Number.isFinite(value) && !ordered).length;
    if (!values.length) return [name, { count: 0, outOfOrderCount, min: null, median: null, mean: null, max: null }];
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    return [name, { count: values.length, outOfOrderCount, min: round(values[0]), median: round(median),
      mean: round(values.reduce((sum, value) => sum + value, 0) / values.length), max: round(values.at(-1)) }];
  }));
  return summary;
}

function createTooltipClickBoundaryDiagnostic() {
  if (process.env.MEMO_NEXUS_E2E_BROWSER !== "webkit"
    || process.env.MEMO_NEXUS_E2E_TOOLTIP_CLICK_BOUNDARIES !== "1") return null;

  let page;
  let nodeToPageOffsetMs = null;
  let alignmentErrorBoundMs = null;

  return {
    async measure(click, condition) {
      const selected = condition?.configIndex === 10 && condition.theme === "light" && condition.width === 320;
      if (!selected) return click();
      page = page || this.page;
      if (!page) throw new Error("Click boundary diagnostic must be started with a page");

      const setupBefore = performance.now();
      const pageStart = await page.evaluate(() => {
        const button = document.getElementById("cardPaneBtn");
        if (!button) throw new Error("#cardPaneBtn is missing");
        if (window.__tooltipClickBoundaries) throw new Error("Previous click boundary diagnostic was not collected");
        const state = { button, active: -1, trials: [], rafPromises: [], rafIds: new Set() };
        const trial = () => state.trials[state.active];
        const record = (name) => (event) => {
          const current = trial();
          if (!current) return;
          const atMs = performance.now();
          current.order.push(name);
          if (current[name] === null) current[name] = atMs;
          if (name === "syncEnd") {
            state.rafPromises.push(new Promise((resolve) => {
              const rafId = requestAnimationFrame(() => {
                state.rafIds.delete(rafId);
                current.raf = performance.now();
                current.order.push("raf");
                resolve();
              });
              state.rafIds.add(rafId);
            }));
          }
        };
        state.onPointerdown = record("pointerdown");
        state.onFocusin = (event) => { if (event.target === button) record("focusin")(event); };
        state.onClick = record("click");
        state.onSyncEnd = record("syncEnd");
        button.addEventListener("pointerdown", state.onPointerdown, true);
        document.addEventListener("focusin", state.onFocusin, true);
        button.addEventListener("click", state.onClick, true);
        // Same-target bubble listener runs after the app's existing target listeners.
        button.addEventListener("click", state.onSyncEnd);
        state.begin = () => {
          state.active = state.trials.length;
          state.trials.push({ pointerdown: null, focusin: null, click: null, syncEnd: null, raf: null, order: [] });
        };
        window.__tooltipClickBoundaries = state;
        return performance.now();
      });
      const setupAfter = performance.now();
      nodeToPageOffsetMs = (setupBefore + setupAfter) / 2 - pageStart;
      alignmentErrorBoundMs = (setupAfter - setupBefore) / 2;

      const nodeStarts = [];
      let rafWait = "not reached";
      let browserTrials;
      try {
        for (let index = 0; index < clickBoundaryTrials; index++) {
          await page.evaluate(() => window.__tooltipClickBoundaries.begin());
          nodeStarts.push(performance.now());
          await click();
          if (index < clickBoundaryTrials - 1) {
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
            await page.locator("#closeCardPaneBtn").click();
            // aria-hidden is the existing app state boundary; CSS may keep the panel visible during its normal transition.
            await page.waitForFunction(() => document.getElementById("previewCard")?.getAttribute("aria-hidden") === "true");
          }
        }
        let rafTimeout;
        rafWait = await Promise.race([
          page.evaluate(() => Promise.all(window.__tooltipClickBoundaries.rafPromises).then(() => "observed")),
          new Promise((resolve) => { rafTimeout = setTimeout(() => resolve("timed out after 1000ms"), 1000); })
        ]);
        clearTimeout(rafTimeout);
      } finally {
        browserTrials = await page.evaluate(() => {
          const state = window.__tooltipClickBoundaries;
          if (!state) return [];
          state.rafIds.forEach(cancelAnimationFrame);
          state.rafIds.clear();
          state.button.removeEventListener("pointerdown", state.onPointerdown, true);
          document.removeEventListener("focusin", state.onFocusin, true);
          state.button.removeEventListener("click", state.onClick, true);
          state.button.removeEventListener("click", state.onSyncEnd);
          delete window.__tooltipClickBoundaries;
          return state.trials;
        });
      }
      const round = (value) => Math.round(value * 1000) / 1000;
      const trials = browserTrials.map((trial, index) => {
        const down = trial.pointerdown === null ? null : trial.pointerdown + nodeToPageOffsetMs;
        return {
          run: index + 1,
          events: trial.order,
          t0ToPointerdownMs: down === null ? null : round(down - nodeStarts[index]),
          pointerdownToFocusinMs: trial.pointerdown === null || trial.focusin === null ? null : round(trial.focusin - trial.pointerdown),
          focusinToClickMs: trial.focusin === null || trial.click === null ? null : round(trial.click - trial.focusin),
          clickToSyncEndMs: trial.click === null || trial.syncEnd === null ? null : round(trial.syncEnd - trial.click),
          syncEndToRafMs: trial.syncEnd === null || trial.raf === null ? null : round(trial.raf - trial.syncEnd),
          focus: trial.focusin === null ? "not observed" : "observed"
        };
      });
      const summary = summarizeClickBoundaries(trials);
      const categoryByInterval = {
        t0ToPointerdown: "Playwright click前処理・actionability・stable判定・scroll・hit testingを調査する候補",
        pointerdownToFocusin: "対象要素のfocus遷移を調査する候補",
        focusinToClick: "ブラウザイベント系列や途中のDOM変化を調査する候補",
        clickToSyncEnd: "アプリの同期click handlerを再調査する候補",
        syncEndToRaf: "rendering・main thread・frame境界を調査する候補"
      };
      const dominant = Object.entries(summary).filter(([, stats]) => stats.count > 0)
        .sort((a, b) => b[1].median - a[1].median)[0];
      console.log(`[TOOLTIP_CLICK_BOUNDARIES] ${JSON.stringify({ condition, trials, summary,
        dominantByMedian: dominant ? { interval: dominant[0], medianMs: dominant[1].median,
          nextInvestigationCandidate: dominant[0] === "pointerdownToFocusin"
            && summary.focusinToClick.outOfOrderCount > 0
            ? "focusinがclick後に観測された試行があるため、focus遷移の原因を断定せずイベント系列とfocus発火契機を調査する候補"
            : categoryByInterval[dominant[0]] } : null,
        clock: "Node performance.now aligned to browser performance.now by setup-call midpoint; browser intervals use performance.now",
        clockAlignmentErrorBoundMs: round(alignmentErrorBoundMs), trialCount: clickBoundaryTrials,
        rafWait,
        syncEndDefinition: "same-target bubble listener registered after app target listeners; approximate synchronous handler boundary" })}`);
      return undefined;
    },
    setPage(value) { this.page = value; }
  };
}

module.exports = { diagnoseTooltipCardClick, createTooltipClickInternals, summarizeClickBoundaries,
  createTooltipClickBoundaryDiagnostic };
