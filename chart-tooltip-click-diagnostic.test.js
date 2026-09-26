"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeClickBoundaries } = require("./chart-tooltip-click-diagnostic.e2e.js");

test("click boundary summary reports min, median, mean and max without filling missing focus samples", () => {
  const summary = summarizeClickBoundaries([
    { t0ToPointerdownMs: 10, pointerdownToFocusinMs: 2, focusinToClickMs: 3, clickToSyncEndMs: 1, syncEndToRafMs: 8 },
    { t0ToPointerdownMs: 20, pointerdownToFocusinMs: null, focusinToClickMs: null, clickToSyncEndMs: 2, syncEndToRafMs: 12 },
    { t0ToPointerdownMs: 30, pointerdownToFocusinMs: 6, focusinToClickMs: 9, clickToSyncEndMs: 3, syncEndToRafMs: 16 }
  ]);

  assert.deepEqual(summary.t0ToPointerdown, { count: 3, outOfOrderCount: 0, min: 10, median: 20, mean: 20, max: 30 });
  assert.deepEqual(summary.pointerdownToFocusin, { count: 2, outOfOrderCount: 0, min: 2, median: 4, mean: 4, max: 6 });
  assert.deepEqual(summary.focusinToClick, { count: 2, outOfOrderCount: 0, min: 3, median: 6, mean: 6, max: 9 });
  assert.deepEqual(summary.clickToSyncEnd, { count: 3, outOfOrderCount: 0, min: 1, median: 2, mean: 2, max: 3 });
  assert.deepEqual(summary.syncEndToRaf, { count: 3, outOfOrderCount: 0, min: 8, median: 12, mean: 12, max: 16 });
});

test("click boundary summary marks wholly unobserved intervals with null statistics", () => {
  const summary = summarizeClickBoundaries([{ t0ToPointerdownMs: null, pointerdownToFocusinMs: null,
    focusinToClickMs: null, clickToSyncEndMs: 0, syncEndToRafMs: null }]);
  assert.deepEqual(summary.pointerdownToFocusin, { count: 0, outOfOrderCount: 0, min: null, median: null, mean: null, max: null });
  assert.deepEqual(summary.clickToSyncEnd, { count: 1, outOfOrderCount: 0, min: 0, median: 0, mean: 0, max: 0 });
});

test("click boundary summary preserves but excludes event pairs observed in reverse order", () => {
  const summary = summarizeClickBoundaries([{ events: ["pointerdown", "click", "syncEnd", "raf", "focusin"],
    t0ToPointerdownMs: 12, pointerdownToFocusinMs: 500, focusinToClickMs: -490,
    clickToSyncEndMs: 2, syncEndToRafMs: 16 }]);

  assert.deepEqual(summary.focusinToClick, { count: 0, outOfOrderCount: 1,
    min: null, median: null, mean: null, max: null });
  assert.equal(summary.pointerdownToFocusin.median, 500);
});
