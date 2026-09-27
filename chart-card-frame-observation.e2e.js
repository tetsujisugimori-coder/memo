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
    || (process.env.MEMO_NEXUS_E2E_STABLE_FRAMES !== "1"
      && (process.env.MEMO_NEXUS_E2E_TOOLTIP_PROFILE !== "1"
        || process.env.MEMO_NEXUS_E2E_CARD_CLICK_TRACE !== "1"))
    || theme !== "light") return null;
  if (configIndex === 10 && width === 320) return "tooltip-c10-light-320";
  if (configIndex === 4 && width === 390) return "tooltip-c4-light-390";
  if (configIndex === 0 && width === 320) return "tooltip-c0-light-320";
  return null;
}

async function startCardFrameObservation(page, condition, options = {}) {
  const name = options.smoke && process.env.MEMO_NEXUS_E2E_STABLE_FRAMES === "1"
    ? "actionability-smoke-target" : selectedCondition(condition);
  if (!name) return null;
  const nodeBeforeMs = performance.now();
  await page.evaluate(({ timerIntervalMs, targetId, smoke }) => {
    const button = document.getElementById(targetId);
    if (!button) throw new Error(`#${targetId} is missing`);
    const parent = button.parentElement;
    if (!smoke && (!parent || !parent.matches(".layout-primary-actions"))) {
      throw new Error("#cardPaneBtn direct parent must be .layout-primary-actions");
    }
    const rect = (element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const observation = {
      startMs: performance.now(), samples: [], timerSamples: [], pointerDownMs: null, clickEventMs: null,
      mutations: [], resizes: [], animations: [], animationError: null,
      longTaskObserverSupported: typeof PerformanceObserver !== "undefined"
        && PerformanceObserver.supportedEntryTypes?.includes("longtask") === true,
      active: true, frameId: null, timerId: null
    };
    observation.take = (kind, frameTimestampMs = null) => {
      const style = button.isConnected ? getComputedStyle(button) : null;
      const parentStyle = kind === "frame" || !parent.isConnected ? null : getComputedStyle(parent);
      observation.samples.push({ kind, atMs: performance.now(), frameTimestampMs,
        button: button.isConnected ? rect(button) : null, parent: parent.isConnected ? rect(parent) : null,
        display: style?.display ?? null, visibility: style?.visibility ?? null, opacity: style?.opacity ?? null,
        animationName: style?.animationName ?? null, animationDuration: style?.animationDuration ?? null,
        transitionProperty: style?.transitionProperty ?? null, transitionDuration: style?.transitionDuration ?? null,
        transform: style?.transform ?? null,
        parentAnimationName: parentStyle?.animationName ?? null,
        parentTransitionProperty: parentStyle?.transitionProperty ?? null,
        parentTransitionDuration: parentStyle?.transitionDuration ?? null,
        parentTransform: parentStyle?.transform ?? null,
        disabled: button.isConnected ? button.disabled : null,
        ariaDisabled: button.isConnected ? button.getAttribute("aria-disabled") : null });
    };
    observation.mutationObserver = new MutationObserver((records) => {
      const atMs = performance.now();
      for (const record of records) observation.mutations.push({ atMs, type: record.type,
        target: record.target === button ? "button" : "parent", attribute: record.attributeName || null });
    });
    observation.mutationObserver.observe(button, { attributes: true });
    observation.mutationObserver.observe(parent, { attributes: true });
    if (typeof ResizeObserver !== "undefined") {
      const resizeSeen = new Set();
      observation.resizeObserver = new ResizeObserver((entries) => {
        const atMs = performance.now();
        for (const entry of entries) {
          const target = entry.target === button ? "button" : "parent";
          observation.resizes.push({ atMs, target, initial: !resizeSeen.has(target) });
          resizeSeen.add(target);
        }
      });
      observation.resizeObserver.observe(button);
      observation.resizeObserver.observe(parent);
    }
    observation.sampleAnimations = (atMs) => {
      try {
        if (typeof document.getAnimations !== "function") return;
        const active = document.getAnimations().filter((animation) => {
          const target = animation.effect?.target;
          return (target === button || target === parent) && animation.playState === "running";
        });
        observation.animations.push({ atMs, active: active.map((animation) => ({
          name: animation.animationName || null, playState: animation.playState,
          target: animation.effect?.target === button ? "button" : "parent" })) });
      } catch (error) { observation.animationError = String(error); }
    };
    observation.onPointerDown = () => { observation.pointerDownMs ??= performance.now(); };
    observation.onClick = () => { observation.clickEventMs ??= performance.now(); };
    button.addEventListener("pointerdown", observation.onPointerDown, true);
    button.addEventListener("click", observation.onClick, true);
    observation.take("start");
    observation.sampleAnimations(observation.startMs);
    const tick = (frameTimestampMs) => {
      if (!observation.active) return;
      observation.take("frame", frameTimestampMs);
      observation.sampleAnimations(performance.now());
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
  }, { timerIntervalMs, targetId: options.smoke ? "target" : "cardPaneBtn", smoke: Boolean(options.smoke) });
  const nodeAfterMs = performance.now();
  return { name, condition, targetId: options.smoke ? "target" : "cardPaneBtn",
    nodeMidpointMs: (nodeBeforeMs + nodeAfterMs) / 2,
    clockAlignmentErrorBoundMs: (nodeAfterMs - nodeBeforeMs) / 2 };
}

function roundMs(value) { return value === null ? null : Math.round(value * 1000) / 1000; }

function summarizeStableFrames(observation) {
  // This is a sampled browser timeline, not Playwright's internal Stable decision.
  const frames = observation.samples.filter((sample) => sample.kind === "frame");
  const start = observation.startMs;
  const deltas = [];
  let previous = observation.samples.find((sample) => sample.kind === "start")?.button ?? null;
  let changes = 0;
  let firstChangeMs = null;
  let lastChangeMs = null;
  const detailed = frames.map((sample, index) => {
    const current = sample.button;
    const delta = previous && current ? Object.fromEntries(["x", "y", "width", "height"]
      .map((axis) => [axis, current[axis] - previous[axis]])) : null;
    const changed = delta ? Object.values(delta).some((value) => value !== 0) : null;
    if (changed) {
      changes++;
      firstChangeMs ??= roundMs(sample.atMs - start);
      lastChangeMs = roundMs(sample.atMs - start);
    }
    const interval = index ? sample.frameTimestampMs - frames[index - 1].frameTimestampMs : null;
    if (Number.isFinite(interval)) deltas.push(interval);
    previous = current;
    return { index, timestampMs: roundMs(sample.frameTimestampMs - start),
      deltaMs: roundMs(interval), box: current, geometryChanged: changed,
      deltaX: roundMs(delta?.x ?? null), deltaY: roundMs(delta?.y ?? null),
      deltaWidth: roundMs(delta?.width ?? null), deltaHeight: roundMs(delta?.height ?? null) };
  });
  const sorted = deltas.sort((a, b) => a - b);
  const median = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]
    + sorted[Math.floor(sorted.length / 2)]) / 2 : null;
  const activeNames = new Set((observation.animations || []).flatMap((sample) => sample.active.map((item) =>
    `${item.target}:${item.name || "unnamed"}`)));
  return { summary: { totalDurationMs: roundMs(observation.endMs - start), frameCount: frames.length,
    frameDeltaMinMs: roundMs(sorted[0] ?? null), frameDeltaMedianMs: roundMs(median),
    frameDeltaP95Ms: roundMs(sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null),
    frameDeltaMaxMs: roundMs(sorted.at(-1) ?? null), geometryChangeCount: changes,
    frameDeltaTotalMs: roundMs(sorted.reduce((sum, value) => sum + value, 0)),
    longFrameGapCount: sorted.filter((value) => value >= longFrameGapMs).length,
    longFrameGapTotalMs: roundMs(sorted.filter((value) => value >= longFrameGapMs)
      .reduce((sum, value) => sum + value, 0)),
    firstGeometryChangeMs: firstChangeMs, lastGeometryChangeMs: lastChangeMs,
    mutationCount: observation.mutations?.length ?? 0,
    resizeCount: observation.resizes?.filter((item) => !item.initial).length ?? 0,
    resizeInitialCount: observation.resizes?.filter((item) => item.initial).length ?? 0,
    animationCount: Math.max(0, ...(observation.animations || []).map((sample) => sample.active.length)),
    animationNames: [...activeNames], animationError: observation.animationError || null,
    detachedFrameCount: frames.filter((frame) => !frame.button).length }, frames: detailed };
}

function summarizeRect(samples, key, startMs) {
  const maxDeltaPx = { x: 0, y: 0, width: 0, height: 0 };
  let changes = 0;
  let lastChangeMs = null;
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1][key];
    const current = samples[index][key];
    if (!previous || !current) continue;
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

async function finishCardFrameObservation(page, selected, clickMs, clickStartNodeMs = null,
  clickEndNodeMs = null, phaseOverride = null) {
  if (!selected) return;
  const observation = await page.evaluate((targetId) => {
    const state = window.__chartCardFrameObservation;
    if (!state) return null;
    state.active = false;
    cancelAnimationFrame(state.frameId);
    clearTimeout(state.timerId);
    state.mutationObserver?.disconnect();
    state.resizeObserver?.disconnect();
    const button = document.getElementById(targetId);
    button?.removeEventListener("pointerdown", state.onPointerDown, true);
    button?.removeEventListener("click", state.onClick, true);
    state.take("end");
    const result = { startMs: state.startMs, endMs: performance.now(), pointerDownMs: state.pointerDownMs,
      clickEventMs: state.clickEventMs, samples: state.samples, timerSamples: state.timerSamples,
      longTaskObserverSupported: state.longTaskObserverSupported, mutations: state.mutations,
      resizes: state.resizes, animations: state.animations, animationError: state.animationError };
    delete window.__chartCardFrameObservation;
    return result;
  }, selected.targetId);
  if (!observation) return;
  const stableFrames = summarizeStableFrames(observation);
  // Pointer dispatch bounds the end of actionability without assuming an exact Stable start.
  // Strictly exclude equal timestamps because WebKit may quantize a post-click mutation
  // to the same millisecond as pointerdown.
  const preClickEndMs = observation.pointerDownMs ?? observation.clickEventMs ?? observation.endMs;
  const preClickFrames = summarizeStableFrames({ ...observation, endMs: preClickEndMs,
    samples: observation.samples.filter((sample) => sample.kind === "start" || sample.atMs < preClickEndMs),
    mutations: observation.mutations.filter((item) => item.atMs < preClickEndMs),
    resizes: observation.resizes.filter((item) => item.atMs < preClickEndMs),
    animations: observation.animations.filter((item) => item.atMs < preClickEndMs) });
  const { getCardClickPhase } = require("./chart-card-click-trace.e2e.js");
  const phase = phaseOverride || getCardClickPhase(page, selected.condition);
  const result = { condition: selected.condition, clickMs: roundMs(clickMs),
    stableMs: phase?.calls?.[0]?.phases?.stable?.totalMs ?? null,
    phaseMeasurementStatus: phase?.measurementStatus || "not-observable",
    phaseCalls: phase?.calls || null,
    stableFrames,
    preClickFrames,
    summary: summarize(observation, selected, clickStartNodeMs, clickEndNodeMs),
    mutations: observation.mutations.map((item) => ({ ...item, sinceStartMs: roundMs(item.atMs - observation.startMs) })),
    resizes: observation.resizes.map((item) => ({ ...item, sinceStartMs: roundMs(item.atMs - observation.startMs) })),
    animations: observation.animations.map((item) => ({ ...item, sinceStartMs: roundMs(item.atMs - observation.startMs) })),
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
    stableMs: result.stableMs, preClickFrames: preClickFrames.summary,
    stableFrames: stableFrames.summary,
    firstLongGap, eventLoopMaxDelayMs, gapMaxTimerDelayMs, gapTimerCallbackCount,
    gapOverlapWithDelayedTimer, timerProbeSampleCount, clickStartEstimateMs, clickEndEstimateMs,
    clockAlignmentErrorBoundMs, clickCompletedAfterGap, clickEventAfterGap, longTaskObserverSupported,
    preClickGeometryChanges: preClick.button.changes + preClick.parent.changes })}`);
}

module.exports = { startCardFrameObservation, finishCardFrameObservation, summarizeStates,
  summarizeFrameGap, summarizeStableFrames };
