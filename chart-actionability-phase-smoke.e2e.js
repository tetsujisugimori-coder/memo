"use strict";

const { getInstrumentationStatus } = require("./chart-actionability-phase-preload.e2e.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { webkit } = require("playwright");
const { readTrace, analyzeTrace } = require("./chart-actionability-phase-diagnostic.e2e.js");

async function main() {
  const browser = await webkit.launch({ headless: true });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "memo-actionability-phases-"));
  const tracePath = path.join(directory, "smoke.zip");
  const retryTracePath = path.join(directory, "retry.zip");
  try {
    const instrumentation = getInstrumentationStatus();
    assert.equal(instrumentation.state, "active", `Playwright instrumentation unavailable: ${instrumentation.reason || instrumentation.state}`);
    const page = await browser.newPage();
    await page.setContent('<button id="target">Open</button><script>document.querySelector("button").onclick=() => document.body.dataset.clicked="yes"</script>');
    await page.context().tracing.start({ snapshots: false });
    await page.context().tracing.startChunk({ title: "actionability phase smoke" });
    await page.locator("#target").click();
    await page.context().tracing.stopChunk({ path: tracePath });
    assert.equal(await page.locator("body").getAttribute("data-clicked"), "yes");
    const calls = analyzeTrace(await readTrace(tracePath));
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
