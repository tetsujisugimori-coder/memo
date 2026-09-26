"use strict";

const fs = require("node:fs");
const path = require("node:path");

const traceDir = path.join(__dirname, "e2e-artifacts", "chart-card-click-traces");
const startedContexts = new WeakSet();

function selectedTrace(feature, condition) {
  if (feature === "tooltip") {
    const { configIndex, theme, width } = condition;
    if (configIndex === 0 && theme === "light" && width === 320) return "tooltip-first-c0-light-320";
    if (configIndex === 4 && theme === "light" && width === 390) return "tooltip-repeat-c4-light-390";
    if (configIndex === 10 && theme === "light" && width === 320) return "tooltip-slow-c10-light-320";
  }
  if (feature === "dual-axis") {
    const { seriesCount, dataset, theme, width } = condition;
    if (seriesCount === 2 && dataset === 0 && theme === "light" && width === 320) return "dual-first-s2-d0-light-320";
    if (seriesCount === 2 && dataset === 3 && theme === "dark" && width === 390) return "dual-repeat-s2-d3-dark-390";
    if (seriesCount === 3 && dataset === 0 && theme === "light" && width === 430) return "dual-slow-s3-d0-light-430";
  }
  return null;
}

async function traceCardOpen(page, feature, condition, operation) {
  const profile = feature === "tooltip" ? "MEMO_NEXUS_E2E_TOOLTIP_PROFILE" : "MEMO_NEXUS_E2E_DUAL_AXIS_PROFILE";
  const name = selectedTrace(feature, condition);
  const focusedDiagnostic = feature === "tooltip"
    && process.env.MEMO_NEXUS_E2E_TOOLTIP_T0_T1_TRACE === "1";
  if (process.env.MEMO_NEXUS_E2E_BROWSER !== "webkit"
    || (!focusedDiagnostic && (process.env.MEMO_NEXUS_E2E_CARD_CLICK_TRACE !== "1"
      || process.env[profile] !== "1")) || !name) return operation();

  const context = page.context();
  if (!startedContexts.has(context)) {
    await context.tracing.start({ snapshots: true });
    startedContexts.add(context);
  }
  fs.mkdirSync(traceDir, { recursive: true });
  const tracePath = path.join(traceDir, `${name}.zip`);
  await context.tracing.startChunk({
    title: `${feature} T0 locator.click start to T1 DOM click event ${JSON.stringify(condition)}`
  });
  try {
    return await operation();
  } finally {
    await context.tracing.stopChunk({ path: tracePath });
    console.log(`[CARD_CLICK_TRACE] ${JSON.stringify({ feature, condition, file: path.relative(__dirname, tracePath), bytes: fs.statSync(tracePath).size })}`);
  }
}

async function stopCardClickTracing(page) {
  const context = page.context();
  if (!startedContexts.has(context)) return;
  try {
    await context.tracing.stop();
  } finally {
    startedContexts.delete(context);
  }
}

module.exports = { traceCardOpen, stopCardClickTracing };
