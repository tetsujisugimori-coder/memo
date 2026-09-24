"use strict";

const fs = require("node:fs");
const path = require("node:path");

const artifactDir = path.join(__dirname, "e2e-artifacts", "chart-card-frame-observation");
const rectTolerancePx = 0.1;

function selectedCondition({ configIndex, theme, width }) {
  if (process.env.MEMO_NEXUS_E2E_BROWSER !== "webkit"
    || process.env.MEMO_NEXUS_E2E_TOOLTIP_PROFILE !== "1"
    || process.env.MEMO_NEXUS_E2E_CARD_CLICK_TRACE !== "1"
    || theme !== "light") return null;
  if (configIndex === 10 && width === 320) return "tooltip-c10-light-320";
  if (configIndex === 4 && width === 390) return "tooltip-c4-light-390";
  return null;
}

async function startCardFrameObservation(page, condition) {
  const name = selectedCondition(condition);
  if (!name) return null;
  await page.evaluate(() => {
    const button = document.getElementById("cardPaneBtn");
    if (!button) throw new Error("#cardPaneBtn is missing");
    const parent = button.parentElement;
    const rect = (element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const observation = {
      startMs: performance.now(), samples: [], pointerDownMs: null, clickEventMs: null,
      active: true, frameId: null
    };
    observation.take = (kind) => {
      const style = getComputedStyle(button);
      observation.samples.push({ kind, atMs: performance.now(), button: rect(button), parent: rect(parent),
        display: style.display, visibility: style.visibility, opacity: style.opacity,
        disabled: button.disabled, ariaDisabled: button.getAttribute("aria-disabled") });
    };
    observation.onPointerDown = () => { observation.pointerDownMs ??= performance.now(); };
    observation.onClick = () => { observation.clickEventMs ??= performance.now(); };
    button.addEventListener("pointerdown", observation.onPointerDown, true);
    button.addEventListener("click", observation.onClick, true);
    observation.take("start");
    const tick = () => {
      if (!observation.active) return;
      observation.take("frame");
      observation.frameId = requestAnimationFrame(tick);
    };
    observation.frameId = requestAnimationFrame(tick);
    window.__chartCardFrameObservation = observation;
  });
  return { name, condition };
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
  return Object.fromEntries(["display", "visibility", "opacity", "disabled", "ariaDisabled"]
    .map((key) => [key, samples.some((sample) => sample[key] !== samples[0][key])]));
}

function summarize(observation) {
  const { startMs, endMs, pointerDownMs, clickEventMs, samples } = observation;
  const preClickBoundaryMs = pointerDownMs ?? clickEventMs ?? endMs;
  const preClickSamples = samples.filter((sample) => sample.atMs < preClickBoundaryMs);
  return {
    rectTolerancePx,
    frameCount: samples.filter((sample) => sample.kind === "frame").length,
    startToEndMs: roundMs(endMs - startMs),
    startToPointerDownMs: pointerDownMs === null ? null : roundMs(pointerDownMs - startMs),
    startToClickEventMs: clickEventMs === null ? null : roundMs(clickEventMs - startMs),
    preClickBoundary: pointerDownMs !== null ? "pointerdown" : clickEventMs !== null ? "click" : "observation-end",
    preClick: { sampleCount: preClickSamples.length, button: summarizeRect(preClickSamples, "button", startMs),
      parent: summarizeRect(preClickSamples, "parent", startMs), stateChanges: summarizeStates(preClickSamples) },
    allSamples: { sampleCount: samples.length, button: summarizeRect(samples, "button", startMs),
      parent: summarizeRect(samples, "parent", startMs), stateChanges: summarizeStates(samples) }
  };
}

async function finishCardFrameObservation(page, selected, clickMs) {
  if (!selected) return;
  const observation = await page.evaluate(() => {
    const state = window.__chartCardFrameObservation;
    state.active = false;
    cancelAnimationFrame(state.frameId);
    const button = document.getElementById("cardPaneBtn");
    button.removeEventListener("pointerdown", state.onPointerDown, true);
    button.removeEventListener("click", state.onClick, true);
    state.take("end");
    const result = { startMs: state.startMs, endMs: performance.now(), pointerDownMs: state.pointerDownMs,
      clickEventMs: state.clickEventMs, samples: state.samples };
    delete window.__chartCardFrameObservation;
    return result;
  });
  const result = { condition: selected.condition, clickMs: roundMs(clickMs), summary: summarize(observation),
    samples: observation.samples.map((sample) => ({ ...sample, sinceStartMs: roundMs(sample.atMs - observation.startMs) })) };
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, `${selected.name}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[CARD_FRAME_OBSERVATION] ${JSON.stringify({ condition: result.condition, clickMs: result.clickMs, ...result.summary })}`);
}

module.exports = { startCardFrameObservation, finishCardFrameObservation };
