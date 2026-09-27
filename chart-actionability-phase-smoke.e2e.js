"use strict";

const { getInstrumentationStatus } = require("./chart-actionability-phase-preload.e2e.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { webkit } = require("playwright");
const { readTrace, analyzeTrace } = require("./chart-actionability-phase-diagnostic.e2e.js");
const { startCardFrameObservation, finishCardFrameObservation } = require("./chart-card-frame-observation.e2e.js");

if (process.argv.includes("--stable-frames")) process.env.MEMO_NEXUS_E2E_STABLE_FRAMES = "1";

async function main() {
  const browser = await webkit.launch({ headless: true });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "memo-actionability-phases-"));
  const frameDiagnostic = process.env.MEMO_NEXUS_E2E_STABLE_FRAMES === "1";
  const smokeTraceDir = path.join(__dirname, "e2e-artifacts", "chart-card-click-traces");
  if (frameDiagnostic) fs.mkdirSync(smokeTraceDir, { recursive: true });
  const tracePath = path.join(frameDiagnostic ? smokeTraceDir : directory, "smoke.zip");
  const retryTracePath = path.join(directory, "retry.zip");
  try {
    const instrumentation = getInstrumentationStatus();
    assert.equal(instrumentation.state, "active", `Playwright instrumentation unavailable: ${instrumentation.reason || instrumentation.state}`);
    const page = await browser.newPage();
    await page.setContent('<button id="target">Open</button><script>document.querySelector("button").onclick=() => document.body.dataset.clicked="yes"</script>');
    await page.context().tracing.start({ snapshots: frameDiagnostic, screenshots: frameDiagnostic });
    await page.context().tracing.startChunk({ title: "actionability phase smoke" });
    let selected = null;
    if (frameDiagnostic) {
      try { selected = await startCardFrameObservation(page, { fixture: "smoke" }, { smoke: true }); }
      catch (error) { console.error(`[CARD_FRAME_OBSERVATION] ${JSON.stringify({
        condition: "smoke", diagnosticError: String(error), stage: "start" })}`); }
    }
    const clickStartNodeMs = performance.now();
    await page.locator("#target").click();
    const clickEndNodeMs = performance.now();
    await page.context().tracing.stopChunk({ path: tracePath });
    assert.equal(await page.locator("body").getAttribute("data-clicked"), "yes");
    const calls = analyzeTrace(await readTrace(tracePath));
    if (selected) {
      try { await finishCardFrameObservation(page, selected, clickEndNodeMs - clickStartNodeMs,
        clickStartNodeMs, clickEndNodeMs, { measurementStatus: "measured", calls }); }
      catch (error) { console.error(`[CARD_FRAME_OBSERVATION] ${JSON.stringify({
        condition: "smoke", diagnosticError: String(error), stage: "finish" })}`); }
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, "ready");
    assert.equal(calls[0].accountingValid, true);
    for (const phase of Object.values(calls[0].phases)) assert.equal(phase.count, 1);
    console.log(`[ACTIONABILITY_PHASE_SMOKE] ${JSON.stringify(calls[0])}`);

    await page.locator("#target").evaluate((button) => { button.disabled = true; });
    await page.context().tracing.startChunk({ title: "actionability retry smoke" });
    const retryClick = page.locator("#target").click();
    // Keep the fixture disabled for several animation frames so Playwright takes its existing retry path.
    await page.evaluate(() => new Promise((resolve) => {
      let frames = 0;
      const nextFrame = () => {
        if (++frames === 15) {
          document.getElementById("target").disabled = false;
          resolve();
        } else requestAnimationFrame(nextFrame);
      };
      requestAnimationFrame(nextFrame);
    }));
    await retryClick;
    await page.context().tracing.stopChunk({ path: retryTracePath });
    const retryCalls = analyzeTrace(await readTrace(retryTracePath));
    assert.equal(retryCalls.length, 1);
    assert.equal(retryCalls[0].status, "ready");
    assert.ok(retryCalls[0].retries > 0);
    assert.equal(retryCalls[0].accountingValid, true);
    console.log(`[ACTIONABILITY_PHASE_RETRY_SMOKE] ${JSON.stringify(retryCalls[0])}`);
    await page.context().tracing.stop();
  } finally {
    await browser.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
