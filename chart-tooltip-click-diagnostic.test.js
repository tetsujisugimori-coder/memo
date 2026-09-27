"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeClickBoundaries, createTooltipClickBoundaryDiagnostic,
  installTooltipClickBoundaryState, collectTooltipClickBoundaryState } = require("./chart-tooltip-click-diagnostic.e2e.js");

test("click boundary summary reports min, median, mean and max without filling missing focus samples", () => {
  const summary = summarizeClickBoundaries([
    { t0ToPointerdownMs: 10, pointerdownToPreviewFocusMs: 2, clickToPreviewFocusMs: 3,
      syncEndToPreviewFocusMs: 4, clickToSyncEndMs: 1, syncEndToRafMs: 8 },
    { t0ToPointerdownMs: 20, pointerdownToPreviewFocusMs: null, clickToPreviewFocusMs: null,
      syncEndToPreviewFocusMs: null, clickToSyncEndMs: 2, syncEndToRafMs: 12 },
    { t0ToPointerdownMs: 30, pointerdownToPreviewFocusMs: 6, clickToPreviewFocusMs: 9,
      syncEndToPreviewFocusMs: 10, clickToSyncEndMs: 3, syncEndToRafMs: 16 }
  ]);

  assert.deepEqual(summary.t0ToPointerdown, { count: 3, outOfOrderCount: 0, min: 10, median: 20, mean: 20, max: 30 });
  assert.deepEqual(summary.pointerdownToPreviewFocus, { count: 2, outOfOrderCount: 0, min: 2, median: 4, mean: 4, max: 6 });
  assert.deepEqual(summary.clickToPreviewFocus, { count: 2, outOfOrderCount: 0, min: 3, median: 6, mean: 6, max: 9 });
  assert.deepEqual(summary.clickToSyncEnd, { count: 3, outOfOrderCount: 0, min: 1, median: 2, mean: 2, max: 3 });
  assert.deepEqual(summary.syncEndToRaf, { count: 3, outOfOrderCount: 0, min: 8, median: 12, mean: 12, max: 16 });
});

test("click boundary summary marks wholly unobserved intervals with null statistics", () => {
  const summary = summarizeClickBoundaries([{ t0ToPointerdownMs: null, pointerdownToPreviewFocusMs: null,
    clickToPreviewFocusMs: null, syncEndToPreviewFocusMs: null, clickToSyncEndMs: 0, syncEndToRafMs: null }]);
  assert.deepEqual(summary.pointerdownToPreviewFocus, { count: 0, outOfOrderCount: 0, min: null, median: null, mean: null, max: null });
  assert.deepEqual(summary.clickToSyncEnd, { count: 1, outOfOrderCount: 0, min: 0, median: 0, mean: 0, max: 0 });
});

test("click boundary summary preserves but excludes event pairs observed in reverse order", () => {
  const summary = summarizeClickBoundaries([{ events: ["pointerdown", "previewFocusin", "click", "syncEnd", "raf"],
    t0ToPointerdownMs: 12, pointerdownToPreviewFocusMs: 5, clickToPreviewFocusMs: -4,
    syncEndToPreviewFocusMs: -6,
    clickToSyncEndMs: 2, syncEndToRafMs: 16 }]);

  assert.deepEqual(summary.clickToPreviewFocus, { count: 0, outOfOrderCount: 1,
    min: null, median: null, mean: null, max: null });
  assert.equal(summary.pointerdownToPreviewFocus.median, 5);
});

function fakeEventTarget(id, tagName = "BUTTON") {
  const listeners = new Map();
  return {
    id, tagName,
    addEventListener(type, listener) { (listeners.get(type) || listeners.set(type, []).get(type)).push(listener); },
    removeEventListener(type, listener) {
      const callbacks = listeners.get(type) || [];
      const index = callbacks.indexOf(listener);
      if (index >= 0) callbacks.splice(index, 1);
    },
    emit(type, target = this) { for (const listener of [...(listeners.get(type) || [])]) listener({ target }); },
    listenerCount() { return [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.length, 0); }
  };
}

async function withFakeBoundaryDom(run) {
  const globals = ["window", "document", "requestAnimationFrame", "cancelAnimationFrame"];
  const saved = Object.fromEntries(globals.map((name) => [name, global[name]]));
  const button = fakeEventTarget("cardPaneBtn");
  const previewFocus = fakeEventTarget("closeCardPaneBtn");
  const previewCard = { contains: (target) => target === previewFocus };
  const document = fakeEventTarget("document", "DOCUMENT");
  document.getElementById = (id) => ({ cardPaneBtn: button, previewCard })[id] || null;
  const frames = new Map();
  let nextFrame = 0;
  global.window = {};
  global.document = document;
  global.requestAnimationFrame = (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; };
  global.cancelAnimationFrame = (id) => { frames.delete(id); };
  try {
    await run({ button, document, previewFocus, frames,
      flushFrames: () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } } });
  } finally {
    if (global.window.__tooltipClickBoundaries) collectTooltipClickBoundaryState();
    for (const name of globals) {
      if (saved[name] === undefined) delete global[name];
      else global[name] = saved[name];
    }
  }
}

test("trial end excludes close focus while preview focus and raw event order are retained", async () => {
  await withFakeBoundaryDom(async ({ button, document, previewFocus, flushFrames }) => {
    installTooltipClickBoundaryState();
    const state = window.__tooltipClickBoundaries;
    state.begin();
    button.emit("pointerdown");
    button.emit("click");
    document.emit("focusin", previewFocus);
    flushFrames();
    assert.equal(await state.waitForRaf(10), "observed");
    state.end();
    document.emit("focusin", button);
    assert.equal(state.trials[0].focusEvents.length, 1);
    assert.deepEqual(state.trials[0].order, ["pointerdown", "click", "syncEnd", "previewFocusin", "raf"]);
    assert.deepEqual(state.trials[0].focusEvents[0].targetId, "closeCardPaneBtn");
    assert.equal(state.trials[0].focusEvents[0].insidePreviewCard, true);
    assert.equal(state.trials[0].focusEvents[0].kind, "previewCard");
    assert.equal(collectTooltipClickBoundaryState().length, 1);
    assert.equal(button.listenerCount(), 0);
    assert.equal(document.listenerCount(), 0);
  });
});

test("unobserved preview focus stays null and a stalled diagnostic rAF settles on timeout", async () => {
  await withFakeBoundaryDom(async ({ button, document, frames }) => {
    installTooltipClickBoundaryState();
    const state = window.__tooltipClickBoundaries;
    state.begin();
    button.emit("click");
    assert.equal(await state.waitForRaf(5), "timed out after 5ms");
    state.end();
    document.emit("focusin", button);
    assert.equal(state.trials[0].previewFocusin, null);
    assert.deepEqual(state.trials[0].focusEvents, []);
    assert.equal(frames.size, 0);
    collectTooltipClickBoundaryState();
    assert.equal(button.listenerCount(), 0);
    assert.equal(document.listenerCount(), 0);
  });
});

test("click failure still ends the trial and removes browser listeners", async () => {
  const previousBrowser = process.env.MEMO_NEXUS_E2E_BROWSER;
  const previousDiagnostic = process.env.MEMO_NEXUS_E2E_TOOLTIP_CLICK_BOUNDARIES;
  process.env.MEMO_NEXUS_E2E_BROWSER = "webkit";
  process.env.MEMO_NEXUS_E2E_TOOLTIP_CLICK_BOUNDARIES = "1";
  try {
    await withFakeBoundaryDom(async ({ button, document }) => {
      const diagnostic = createTooltipClickBoundaryDiagnostic();
      diagnostic.setPage({ evaluate: (fn) => fn() });
      await assert.rejects(diagnostic.measure(async () => { throw new Error("click failed"); },
        { configIndex: 10, theme: "light", width: 320 }), /click failed/);
      assert.equal(window.__tooltipClickBoundaries, undefined);
      assert.equal(button.listenerCount(), 0);
      assert.equal(document.listenerCount(), 0);
    });
  } finally {
    if (previousBrowser === undefined) delete process.env.MEMO_NEXUS_E2E_BROWSER;
    else process.env.MEMO_NEXUS_E2E_BROWSER = previousBrowser;
    if (previousDiagnostic === undefined) delete process.env.MEMO_NEXUS_E2E_TOOLTIP_CLICK_BOUNDARIES;
    else process.env.MEMO_NEXUS_E2E_TOOLTIP_CLICK_BOUNDARIES = previousDiagnostic;
  }
});
