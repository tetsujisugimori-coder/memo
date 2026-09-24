"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const artifactDir = path.join(__dirname, "e2e-artifacts", "chart-card-frame-observation");
const rectTolerancePx = 0.1;
const longFrameGapMs = 32;
const timerIntervalMs = 16;
const delayedTimerMs = 32;

function selectedCondition({ configIndex, theme, width }) {
  if (process.env.MEMO_NEXUS_E2E_BROWSER !== "webkit"
    || process.env.MEMO_NEXUS_E2E_TOOLTIP_PROFILE !== "1"
    || process.env.MEMO_NEXUS_E2E_CARD_CLICK_TRACE !== "1"
    || theme !== "light") return null;
  if (configIndex === 10 && width === 320) return "tooltip-c10-light-320";
  if (configIndex === 4 && width === 390) return "tooltip-c4-light-390";
  if (configIndex === 0 && width === 320) return "tooltip-c0-light-320";
  return null;
}

async function startCardFrameObservation(page, condition) {
  const name = selectedCondition(condition);
  if (!name) return null;
  const nodeBeforeMs = performance.now();
  await page.evaluate((timerIntervalMs) => {
    const button = document.getElementById("cardPaneBtn");
    if (!button) throw new Error("#cardPaneBtn is missing");
    const parent = button.parentElement;
    if (!parent || !parent.matches(".layout-primary-actions")) {
      throw new Error("#cardPaneBtn direct parent must be .layout-primary-actions");
    }
    const rect = (element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const observation = {
      startMs: performance.now(), samples: [], timerSamples: [], pointerDownMs: null, clickEventMs: null,
      longTaskObserverSupported: typeof PerformanceObserver !== "undefined"
        && PerformanceObserver.supportedEntryTypes?.includes("longtask") === true,
      active: true, frameId: null, timerId: null
    };
    observation.take = (kind, frameTimestampMs = null) => {
      const style = getComputedStyle(button);
      observation.samples.push({ kind, atMs: performance.now(), frameTimestampMs,
        button: rect(button), parent: rect(parent),
        display: style.display, visibility: style.visibility, opacity: style.opacity,
        disabled: button.disabled, ariaDisabled: button.getAttribute("aria-disabled") });
    };
    observation.onPointerDown = () => { observation.pointerDownMs ??= performance.now(); };
    observation.onClick = () => { observation.clickEventMs ??= performance.now(); };
    button.addEventListener("pointerdown", observation.onPointerDown, true);
    button.addEventListener("click", observation.onClick, true);
    observation.take("start");
    const tick = (frameTimestampMs) => {
      if (!observation.active) return;
      observation.take("frame", frameTimestampMs);
      observation.frameId = requestAnimationFrame(tick);
    };
    const scheduleTimer = () => {
      const plannedAtMs = performance.now() + timerIntervalMs;
      observation.timerId = setTimeout(() => {
        if (!observation.active) return;
        observation.timerSamples.push({ plannedAtMs, firedAtMs: performance.now() });
        scheduleTimer();
      }, timerIntervalMs);
    };
    observation.frameId = requestAnimationFrame(tick);
    scheduleTimer();
    window.__chartCardFrameObservation = observation;
  }, timerIntervalMs);
  const nodeAfterMs = performance.now();
  return { name, condition, nodeMidpointMs: (nodeBeforeMs + nodeAfterMs) / 2,
    clockAlignmentErrorBoundMs: (nodeAfterMs - nodeBeforeMs) / 2 };
}

function roundMs(value) { return value === null ? null : Math.round(value * 1000) / 1000; }

function summarizeRect(samples, key, startMs) {
  const maxDeltaPx = { x: 0, y: 0, width: 0, height: 0 };
  let changes = 0;
  let lastChangeMs = null;
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1][key];
    const current = samples[index][key];
    const deltas = Object.fromEntries(Object.keys(maxDeltaPx).map((axis) => [axis, Math.abs(current[axis] - previous[axis])]));
    for (const axis of Object.keys(maxDeltaPx)) maxDeltaPx[axis] = Math.max(maxDeltaPx[axis], deltas[axis]);
    if (Object.values(deltas).some((delta) => delta > rectTolerancePx)) {
      changes++;
      lastChangeMs = samples[index].atMs - startMs;
    }
  }
  return { changes, lastChangeMs: roundMs(lastChangeMs),
    maxDeltaPx: Object.fromEntries(Object.entries(maxDeltaPx).map(([axis, value]) => [axis, roundMs(value)])) };
}

function summarizeStates(samples) {
  if (samples.length === 0) throw new Error("Cannot summarize card states without samples");
  return Object.fromEntries(["display", "visibility", "opacity", "disabled", "ariaDisabled"]
    .map((key) => [key, samples.some((sample) => sample[key] !== samples[0][key])]));
}

function summarizeFrameGap(observation) {
  const { startMs, samples, timerSamples } = observation;
  let previousMs = startMs;
  const frameSamples = samples.filter((sample) => sample.kind === "frame");
  const frames = frameSamples.map((sample) => {
    const deltaMs = sample.frameTimestampMs - previousMs;
    const frame = { atMs: roundMs(sample.frameTimestampMs - startMs), deltaMs: roundMs(deltaMs) };
    previousMs = sample.frameTimestampMs;
    return frame;
  });
  const firstLongIndex = frames.findIndex((frame) => frame.deltaMs >= longFrameGapMs);
  const firstLongGap = firstLongIndex < 0 ? null : {
    startMs: roundMs((firstLongIndex === 0 ? startMs : frameSamples[firstLongIndex - 1].frameTimestampMs) - startMs),
    endMs: frames[firstLongIndex].atMs,
    durationMs: frames[firstLongIndex].deltaMs
  };
  const timerDelays = timerSamples.map(({ plannedAtMs, firedAtMs }) => ({
    plannedAtMs: roundMs(plannedAtMs - startMs), firedAtMs: roundMs(firedAtMs - startMs),
    delayMs: roundMs(Math.max(0, firedAtMs - plannedAtMs))
  }));
  const overlapping = firstLongGap === null ? [] : timerDelays.filter((timer) =>
    timer.plannedAtMs < firstLongGap.endMs && timer.firedAtMs > firstLongGap.startMs);
  return { frames, firstLongGap, timerDelays,
    timerProbeSampleCount: timerDelays.length,
    eventLoopMaxDelayMs: timerDelays.length ? Math.max(...timerDelays.map((timer) => timer.delayMs)) : null,
    gapTimerCallbackCount: firstLongGap === null ? null : timerDelays.filter((timer) =>
      timer.firedAtMs > firstLongGap.startMs && timer.firedAtMs < firstLongGap.endMs).length,
    gapMaxTimerDelayMs: firstLongGap === null || overlapping.length === 0 ? null
      : Math.max(...overlapping.map((timer) => timer.delayMs)),
    gapOverlapWithDelayedTimer: firstLongGap === null || overlapping.length === 0 ? "unknown"
      : overlapping.some((timer) => timer.delayMs >= delayedTimerMs) };
}

function summarize(observation, selected, clickStartNodeMs, clickEndNodeMs) {
  const { startMs, endMs, pointerDownMs, clickEventMs, samples } = observation;
  const preClickBoundaryMs = pointerDownMs ?? clickEventMs ?? endMs;
  const preClickSamples = samples.filter((sample) => sample.atMs < preClickBoundaryMs);
  const frame = summarizeFrameGap(observation);
  const clickStartEstimateMs = clickStartNodeMs === null ? null
    : roundMs(clickStartNodeMs - selected.nodeMidpointMs);
  const clickEndEstimateMs = clickEndNodeMs === null ? null
    : roundMs(clickEndNodeMs - selected.nodeMidpointMs);
  const clickCompletedAfterGap = frame.firstLongGap === null || clickEndEstimateMs === null ? null
    : clickEndEstimateMs - selected.clockAlignmentErrorBoundMs > frame.firstLongGap.endMs ? true
      : clickEndEstimateMs + selected.clockAlignmentErrorBoundMs < frame.firstLongGap.endMs ? false : "unknown";
  const clickEventAfterGap = frame.firstLongGap === null || clickEventMs === null ? null
    : clickEventMs - startMs > frame.firstLongGap.endMs;
  return {
    rectTolerancePx,
    longFrameGapMs,
    timerIntervalMs,
    delayedTimerMs,
    frameCount: samples.filter((sample) => sample.kind === "frame").length,
    startToEndMs: roundMs(endMs - startMs),
    startToPointerDownMs: pointerDownMs === null ? null : roundMs(pointerDownMs - startMs),
    startToClickEventMs: clickEventMs === null ? null : roundMs(clickEventMs - startMs),
    preClickBoundary: pointerDownMs !== null ? "pointerdown" : clickEventMs !== null ? "click" : "observation-end",
    firstLongGap: frame.firstLongGap,
    eventLoopMaxDelayMs: frame.eventLoopMaxDelayMs,
    gapMaxTimerDelayMs: frame.gapMaxTimerDelayMs,
    gapTimerCallbackCount: frame.gapTimerCallbackCount,
    gapOverlapWithDelayedTimer: frame.gapOverlapWithDelayedTimer,
    timerProbeSampleCount: frame.timerProbeSampleCount,
    longTaskObserverSupported: observation.longTaskObserverSupported,
    clickStartEstimateMs,
    clickEndEstimateMs,
    clockAlignmentErrorBoundMs: roundMs(selected.clockAlignmentErrorBoundMs),
    clickCompletedAfterGap,
    clickEventAfterGap,
    actionabilityStart: "not-observable",
    styleLayoutPaintPhases: "not-observable",
    preClick: { sampleCount: preClickSamples.length, button: summarizeRect(preClickSamples, "button", startMs),
      parent: summarizeRect(preClickSamples, "parent", startMs), stateChanges: summarizeStates(preClickSamples) },
    allSamples: { sampleCount: samples.length, button: summarizeRect(samples, "button", startMs),
      parent: summarizeRect(samples, "parent", startMs), stateChanges: summarizeStates(samples) },
    frames: frame.frames
  };
}

async function finishCardFrameObservation(page, selected, clickMs, clickStartNodeMs = null, clickEndNodeMs = null) {
  if (!selected) return;
  const observation = await page.evaluate(() => {
    const state = window.__chartCardFrameObservation;
    state.active = false;
    cancelAnimationFrame(state.frameId);
    clearTimeout(state.timerId);
    const button = document.getElementById("cardPaneBtn");
    button.removeEventListener("pointerdown", state.onPointerDown, true);
    button.removeEventListener("click", state.onClick, true);
    state.take("end");
    const result = { startMs: state.startMs, endMs: performance.now(), pointerDownMs: state.pointerDownMs,
      clickEventMs: state.clickEventMs, samples: state.samples, timerSamples: state.timerSamples,
      longTaskObserverSupported: state.longTaskObserverSupported };
    delete window.__chartCardFrameObservation;
    return result;
  });
  const result = { condition: selected.condition, clickMs: roundMs(clickMs),
    summary: summarize(observation, selected, clickStartNodeMs, clickEndNodeMs),
    timerSamples: observation.timerSamples.map((sample) => ({
      plannedSinceStartMs: roundMs(sample.plannedAtMs - observation.startMs),
      firedSinceStartMs: roundMs(sample.firedAtMs - observation.startMs),
      delayMs: roundMs(Math.max(0, sample.firedAtMs - sample.plannedAtMs)) })),
    samples: observation.samples.map((sample) => ({ ...sample, sinceStartMs: roundMs(sample.atMs - observation.startMs) })) };
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, `${selected.name}.json`), `${JSON.stringify(result, null, 2)}\n`);
  const { firstLongGap, eventLoopMaxDelayMs, gapMaxTimerDelayMs, gapTimerCallbackCount,
    gapOverlapWithDelayedTimer, timerProbeSampleCount, clickStartEstimateMs, clickEndEstimateMs,
    clockAlignmentErrorBoundMs, clickCompletedAfterGap, clickEventAfterGap,
    longTaskObserverSupported, preClick } = result.summary;
  console.log(`[CARD_FRAME_OBSERVATION] ${JSON.stringify({ condition: result.condition, clickMs: result.clickMs,
    firstLongGap, eventLoopMaxDelayMs, gapMaxTimerDelayMs, gapTimerCallbackCount,
    gapOverlapWithDelayedTimer, timerProbeSampleCount, clickStartEstimateMs, clickEndEstimateMs,
    clockAlignmentErrorBoundMs, clickCompletedAfterGap, clickEventAfterGap, longTaskObserverSupported,
    preClickGeometryChanges: preClick.button.changes + preClick.parent.changes })}`);
}

module.exports = { startCardFrameObservation, finishCardFrameObservation, summarizeStates, summarizeFrameGap };
