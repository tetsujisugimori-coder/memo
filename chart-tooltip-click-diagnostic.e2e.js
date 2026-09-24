"use strict";

const { performance } = require("node:perf_hooks");

// Observe the real card button without using locator auto-wait or changing the click condition.
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

module.exports = { diagnoseTooltipCardClick };
