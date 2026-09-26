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
  if (process.env.MEMO_NEXUS_E2E_BROWSER !== "webkit"
    || process.env.MEMO_NEXUS_E2E_CARD_CLICK_INTERNALS !== "1") return null;

  let clockOffsetMs = null;
  let clockAlignmentErrorBoundMs = null;
  let clickCalls = [];
  let installed = false;

  return {
    async start(page) {
      const nodeBefore = performance.now();
      let pageStartAt;
      try {
        pageStartAt = await page.evaluate(() => {
          if (window.__cardClickInternals) throw new Error("Previous card click diagnostic was not collected");
          const button = document.getElementById("cardPaneBtn");
          const card = document.getElementById("previewCard");
          const events = [];
          let pendingIndex = null;
          const onClick = () => {
            const index = events.length;
            events.push({ index, t1: performance.now(), t4: null, mutation: null });
            pendingIndex = index;
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
          if (button) observer.observe(button, { attributes: true, attributeFilter: ["aria-expanded"] });
          if (card) observer.observe(card, { attributes: true, attributeFilter: ["aria-hidden", "class", "inert", "style"] });
          observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
          window.__cardClickInternals = { button, onClick, observer, events };
          return performance.now();
        });
        const nodeAfter = performance.now();
        clockOffsetMs = (nodeBefore + nodeAfter) / 2 - pageStartAt;
        clockAlignmentErrorBoundMs = (nodeAfter - nodeBefore) / 2;
        clickCalls = [];
        installed = true;
      } catch (error) {
        console.error(`[TOOLTIP_CLICK_INTERNALS] ${JSON.stringify({ diagnosticError: String(error), stage: "start" })}`);
      }
    },

    record(nodeStartMs, nodeEndMs) {
      if (installed) clickCalls.push({ nodeStartMs, nodeEndMs });
    },

    async measure(click) {
      const nodeStartMs = performance.now();
      const result = await click();
      const nodeEndMs = performance.now();
      this.record(nodeStartMs, nodeEndMs);
      return result;
    },

    async finish(page) {
      if (!installed) return;
      try {
        const events = await page.evaluate(() => {
          const state = window.__cardClickInternals;
          if (!state) return null;
          delete window.__cardClickInternals;
          state.button?.removeEventListener("click", state.onClick, { capture: true });
          state.observer.disconnect();
          return state.events;
        });
        if (!events) throw new Error("Browser observation was not available");
        const values = { playwrightToDomClick: [], domClickToUiMutationObserved: [],
          uiMutationObservedToClickResolve: [], domClickToClickResolve: [], clickTotal: [] };
        for (let index = 0; index < clickCalls.length; index++) {
          const call = clickCalls[index];
          const event = events[index];
          if (!event) continue;
          const domClickNodeMs = event.t1 + clockOffsetMs;
          values.playwrightToDomClick.push(domClickNodeMs - call.nodeStartMs);
          if (Number.isFinite(event.t4)) {
            const mutationNodeMs = event.t4 + clockOffsetMs;
            values.domClickToUiMutationObserved.push(event.t4 - event.t1);
            values.uiMutationObservedToClickResolve.push(call.nodeEndMs - mutationNodeMs);
          }
          values.domClickToClickResolve.push(call.nodeEndMs - domClickNodeMs);
          values.clickTotal.push(call.nodeEndMs - call.nodeStartMs);
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
        const missing = {
          domClick: Math.max(0, clickCalls.length - events.length),
          uiMutation: events.filter((event) => !Number.isFinite(event.t4)).length
        };
        console.log(`[TOOLTIP_CLICK_INTERNALS] ${JSON.stringify({
          calls: clickCalls.length,
          clock: "Node performance.now aligned to browser performance.now by setup-call midpoint",
          clockAlignmentErrorBoundMs: Math.round(clockAlignmentErrorBoundMs * 10) / 10,
          stages: Object.fromEntries(Object.entries(values).map(([name, samples]) => [name, summarize(samples)])),
          missing,
          firstUiMutationMeans: "first observed MutationObserver callback for card/body/button state attributes; not the exact mutation timestamp"
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
