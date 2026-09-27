"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { startCardFrameObservation, summarizeStates, summarizeFrameGap,
  summarizeStableFrames } = require("./chart-card-frame-observation.e2e.js");

test("card frame observation rejects an unexpected direct parent", async () => {
  const previous = [process.env.MEMO_NEXUS_E2E_BROWSER, process.env.MEMO_NEXUS_E2E_TOOLTIP_PROFILE,
    process.env.MEMO_NEXUS_E2E_CARD_CLICK_TRACE];
  process.env.MEMO_NEXUS_E2E_BROWSER = "webkit";
  process.env.MEMO_NEXUS_E2E_TOOLTIP_PROFILE = "1";
  process.env.MEMO_NEXUS_E2E_CARD_CLICK_TRACE = "1";
  try {
    for (const parentElement of [null, { matches: () => false }]) {
      const page = { evaluate: (callback, input) => vm.runInNewContext(`(${callback.toString()})(input)`, {
        input, document: { getElementById: () => ({ parentElement }) }
      }) };
      await assert.rejects(startCardFrameObservation(page, { configIndex: 10, theme: "light", width: 320 }),
        /direct parent must be \.layout-primary-actions/);
    }
  } finally {
    ["MEMO_NEXUS_E2E_BROWSER", "MEMO_NEXUS_E2E_TOOLTIP_PROFILE", "MEMO_NEXUS_E2E_CARD_CLICK_TRACE"]
      .forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

test("card state summary fails on an empty sample set", () => {
  assert.throws(() => summarizeStates([]), /without samples/);
  assert.deepEqual(summarizeStates([{ display: "flex", visibility: "visible", opacity: "1",
    disabled: false, ariaDisabled: null }]), {
    display: false, visibility: false, opacity: false, disabled: false, ariaDisabled: false
  });
});

test("frame gap uses rAF timestamps and locates a delayed timer in the gap", () => {
  const result = summarizeFrameGap({ startMs: 1000, samples: [
    { kind: "start", atMs: 1000 },
    { kind: "frame", frameTimestampMs: 1048, atMs: 1050 },
    { kind: "frame", frameTimestampMs: 1064, atMs: 1065 }
  ], timerSamples: [
    { plannedAtMs: 1016, firedAtMs: 1049 },
    { plannedAtMs: 1065, firedAtMs: 1066 }
  ] });
  assert.deepEqual(result.frames, [{ atMs: 48, deltaMs: 48 }, { atMs: 64, deltaMs: 16 }]);
  assert.deepEqual(result.firstLongGap, { startMs: 0, endMs: 48, durationMs: 48 });
  assert.equal(result.gapMaxTimerDelayMs, 33);
  assert.equal(result.gapOverlapWithDelayedTimer, true);
  assert.equal(result.gapTimerCallbackCount, 0);
});

test("Stable frame summary separates a scheduling gap from geometry changes", () => {
  const box = (x) => ({ x, y: 2, width: 30, height: 10 });
  const result = summarizeStableFrames({ startMs: 1000, endMs: 1110, samples: [
    { kind: "start", button: box(0) },
    { kind: "frame", atMs: 1016, frameTimestampMs: 1015, button: box(1) },
    { kind: "frame", atMs: 1032, frameTimestampMs: 1031, button: box(1) },
    { kind: "frame", atMs: 1100, frameTimestampMs: 1099, button: box(1) }
  ], mutations: [], resizes: [{ initial: true }, { initial: false }], animations: [] });
  assert.equal(result.summary.frameDeltaMaxMs, 68);
  assert.equal(result.summary.longFrameGapCount, 1);
  assert.equal(result.summary.longFrameGapTotalMs, 68);
  assert.equal(result.summary.geometryChangeCount, 1);
  assert.equal(result.summary.firstGeometryChangeMs, 16);
  assert.equal(result.summary.lastGeometryChangeMs, 16);
  assert.equal(result.summary.resizeCount, 1);
  assert.equal(result.summary.resizeInitialCount, 1);
  assert.equal(result.frames[2].geometryChanged, false);
  assert.equal(result.frames[2].deltaMs, 68);
});

test("Stable frame summary tolerates missing frames, detached target and animation data", () => {
  const empty = summarizeStableFrames({ startMs: 0, endMs: 20, samples: [],
    mutations: [], resizes: [] });
  assert.equal(empty.summary.frameDeltaMedianMs, null);
  const detached = summarizeStableFrames({ startMs: 0, endMs: 20, samples: [
    { kind: "frame", atMs: 16, frameTimestampMs: 16, button: null }
  ], mutations: [], resizes: [], animations: [] });
  assert.equal(detached.summary.detachedFrameCount, 1);
  assert.equal(detached.frames[0].geometryChanged, null);
});
