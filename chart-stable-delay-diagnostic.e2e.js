"use strict";

const path = require("node:path");

// The saved WebKit frame samples with phase instrumentation have Stable totals
// of 78–89 ms. 250 ms is deliberately well above that observed range and
// below the historical 1406 ms event; it is a diagnostic trigger, not a SLO.
const stableDiagnosticThresholdMs = 250;
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const runDirectory = path.join(__dirname, "e2e-artifacts", "chart-card-frame-observation", runId);

function classifyStableDelay(result) {
  const stableMs = result.stableMs;
  const stableMaxAttemptMs = result.phaseCalls?.[0]?.phases?.stable?.maxMs ?? stableMs;
  const detected = Number.isFinite(stableMaxAttemptMs)
    && stableMaxAttemptMs >= stableDiagnosticThresholdMs;
  const preClickGaps = result.preClickFrames?.frames?.filter((frame) =>
    Number.isFinite(frame.timestampMs) && Number.isFinite(frame.deltaMs) && frame.deltaMs >= 32)
    .map((frame) => ({ startMs: frame.timestampMs - frame.deltaMs,
      endMs: frame.timestampMs, durationMs: frame.deltaMs })) || [];
  const longestPreClickGap = preClickGaps.sort((a, b) => b.durationMs - a.durationMs)[0]
    || result.summary?.firstLongGap || null;
  const facts = {
    stableMs: Number.isFinite(stableMs) ? stableMs : null,
    stableMaxAttemptMs: Number.isFinite(stableMaxAttemptMs) ? stableMaxAttemptMs : null,
    stableAttemptCount: result.phaseCalls?.[0]?.phases?.stable?.count ?? null,
    retryCount: result.phaseCalls?.[0]?.retries ?? null,
    actionabilityMs: result.phaseCalls?.[0]?.phases?.actionability?.totalMs ?? null,
    firstFrameGapMs: result.summary?.firstLongGap?.durationMs ?? null,
    longestPreClickFrameGapMs: longestPreClickGap?.durationMs ?? null,
    preClickGeometryChanges: result.summary?.preClick?.button?.changes === undefined
      || result.summary?.preClick?.parent?.changes === undefined ? null
      : result.summary.preClick.button.changes + result.summary.preClick.parent.changes,
    clickEventAfterGap: result.summary?.clickEventAfterGap ?? null,
    startToClickEventMs: result.summary?.startToClickEventMs ?? null
  };
  if (!detected) return { detected: false, thresholdMs: stableDiagnosticThresholdMs,
    classification: "unclassified", reason: Number.isFinite(stableMaxAttemptMs)
      ? "Stable is below the diagnostic threshold" : "Stable measurement is unavailable", facts };
  if (result.phaseMeasurementStatus !== "measured" || !result.traceArtifact) {
    return { detected: true, thresholdMs: stableDiagnosticThresholdMs,
      classification: "unclassified", reason: "A measured phase and its saved Trace are both required", facts };
  }
  const gap = longestPreClickGap;
  const clickStart = result.summary?.clickStartEstimateMs;
  const alignment = result.summary?.clockAlignmentErrorBoundMs;
  const preClickEnd = result.summary?.startToPointerDownMs;
  // Only use the page-clock overlap as supporting evidence. The exact Stable
  // start is not observable, and the Trace and page clocks are never subtracted.
  const overlapsPreClick = gap && Number.isFinite(clickStart) && Number.isFinite(alignment)
    && Number.isFinite(preClickEnd) && gap.endMs >= clickStart + alignment
    && gap.startMs <= preClickEnd;
  if (overlapsPreClick && gap.durationMs >= stableMaxAttemptMs / 2 && facts.preClickGeometryChanges === 0) {
    return { detected: true, thresholdMs: stableDiagnosticThresholdMs,
      classification: "webkit-render-scheduling",
      reason: "A long page-clock rAF gap overlaps the pre-click interval with unchanged sampled geometry; this is consistent with render scheduling, not proof of a WebKit internal cause", facts };
  }
  return { detected: true, thresholdMs: stableDiagnosticThresholdMs,
    classification: "playwright-actionability-or-stable",
    reason: "The instrumented Stable interval is large; available frame evidence does not isolate its underlying cause", facts };
}

module.exports = { runId, runDirectory, stableDiagnosticThresholdMs, classifyStableDelay };
