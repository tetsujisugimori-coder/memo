"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { startCardFrameObservation, summarizeStates, summarizeFrameGap } = require("./chart-card-frame-observation.e2e.js");

test("card frame observation rejects an unexpected direct parent", async () => {
  const previous = [process.env.MEMO_NEXUS_E2E_BROWSER, process.env.MEMO_NEXUS_E2E_TOOLTIP_PROFILE,
    process.env.MEMO_NEXUS_E2E_CARD_CLICK_TRACE];
  process.env.MEMO_NEXUS_E2E_BROWSER = "webkit";
  process.env.MEMO_NEXUS_E2E_TOOLTIP_PROFILE = "1";
  process.env.MEMO_NEXUS_E2E_CARD_CLICK_TRACE = "1";
  try {
    for (const parentElement of [null, { matches: () => false }]) {
      const page = { evaluate: (callback) => vm.runInNewContext(`(${callback.toString()})()`, {
        document: { getElementById: () => ({ parentElement }) }
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
