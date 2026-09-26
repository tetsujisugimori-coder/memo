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

module.exports = { diagnoseTooltipCardClick, createTooltipClickInternals };
