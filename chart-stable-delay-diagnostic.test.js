"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyStableDelay, stableDiagnosticThresholdMs } = require("./chart-stable-delay-diagnostic.e2e.js");

function sample(stableMs, overrides = {}) {
  return { stableMs, phaseMeasurementStatus: "measured",
    phaseCalls: [{ retries: 0, phases: { actionability: { totalMs: 3 },
      stable: { count: 1, maxMs: stableMs } } }],
    traceArtifact: "e2e-artifacts/chart-card-frame-observation/run/traces/tooltip-slow-c10-light-320.zip",
    summary: { firstLongGap: { startMs: 0, endMs: 40, durationMs: 40 },
      clickStartEstimateMs: 5, clockAlignmentErrorBoundMs: 2, startToPointerDownMs: 100,
      startToClickEventMs: 101, clickEventAfterGap: true,
      preClick: { button: { changes: 0 }, parent: { changes: 0 } } }, ...overrides };
}

test("ordinary Stable measurement stays outside diagnosis", () => {
  const result = classifyStableDelay(sample(89));
  assert.equal(stableDiagnosticThresholdMs, 250);
  assert.equal(result.detected, false);
  assert.equal(result.classification, "unclassified");
  assert.equal(result.facts.stableMs, 89);
});

test("multiple ordinary retries do not become one long Stable attempt", () => {
  const result = classifyStableDelay(sample(300, { phaseCalls: [{ retries: 1,
    phases: { stable: { count: 2, maxMs: 150 }, actionability: { totalMs: 3 } } }] }));
  assert.equal(result.detected, false);
  assert.equal(result.facts.stableMs, 300);
  assert.equal(result.facts.stableMaxAttemptMs, 150);
});

test("large Stable gap gives a qualified render scheduling interpretation", () => {
  const result = classifyStableDelay(sample(300, { summary: {
    ...sample(300).summary, startToPointerDownMs: 220 },
    preClickFrames: { frames: [{ timestampMs: 40, deltaMs: 40 },
      { timestampMs: 210, deltaMs: 170 }] } }));
  assert.equal(result.detected, true);
  assert.equal(result.classification, "webkit-render-scheduling");
  assert.equal(result.facts.firstFrameGapMs, 40);
  assert.equal(result.facts.longestPreClickFrameGapMs, 170);
  assert.match(result.reason, /not proof/);
});

test("large Stable without a matching frame gap stays in actionability layer", () => {
  const result = classifyStableDelay(sample(1406));
  assert.equal(result.classification, "playwright-actionability-or-stable");
  assert.equal(result.facts.stableMs, 1406);
});

test("missing Trace or phase data is explicitly unclassified", () => {
  assert.equal(classifyStableDelay(sample(300, { traceArtifact: null })).classification, "unclassified");
  assert.equal(classifyStableDelay(sample(null)).classification, "unclassified");
});
