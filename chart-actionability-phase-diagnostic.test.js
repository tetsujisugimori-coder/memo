"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { analyzeTrace, summarize, summarizeCalls, classifyMeasurement } = require("./chart-actionability-phase-diagnostic.e2e.js");
const { instrumentCoreBundle } = require("./chart-actionability-phase-preload.e2e.js");
const { traceCardOpen, stopCardClickTracing } = require("./chart-card-click-trace.e2e.js");

function clickTrace(messages, endTime = 250) {
  return [
    { type: "before", callId: "click", method: "click", startTime: 0 },
    ...messages.map(([time, message]) => ({ type: "log", callId: "click", time, message })),
    { type: "after", callId: "click", endTime }
  ];
}

test("diagnostic source has all four Playwright phase anchors", () => {
  const source = fs.readFileSync(path.join(path.dirname(require.resolve("playwright-core")), "lib", "coreBundle.js"), "utf8");
  const instrumented = instrumentCoreBundle(source);
  assert.match(instrumented, /memo actionability end stableMs=/);
  assert.match(instrumented, /memo hit testing start/);
  assert.match(instrumented, /memo hit testing end/);
  assert.match(instrumented, /stableMs \+= performance\.now\(\) - stableStarted/);
  assert.notEqual(instrumented, source);
});

test("retry attempts partition total wait without counting Stable twice", () => {
  const [call] = analyzeTrace(clickTrace([
    [10, "attempting click action"],
    [20, "  waiting for element to be visible, enabled and stable"],
    [55, "  memo actionability end stableMs=30"],
    [56, "  scrolling into view if needed"], [61, "  done scrolling"],
    [65, "  memo hit testing start"], [70, "  memo hit testing end"],
    [100, "retrying click action"],
    [110, "  waiting for element to be visible, enabled and stable"],
    [150, "  memo actionability end stableMs=32"],
    [151, "  scrolling into view if needed"], [159, "  done scrolling"],
    [165, "  memo hit testing start"], [169, "  memo hit testing end"],
    [180, "  performing click action"]
  ]));
  assert.equal(call.status, "ready");
  assert.equal(call.retries, 1);
  assert.equal(call.totalWaitMs, 170);
  assert.deepEqual(Object.fromEntries(Object.entries(call.phases).map(([name, value]) => [name, [value.count, value.totalMs]])), {
    actionability: [2, 13], stable: [2, 62], scroll: [2, 13], hitTesting: [2, 9]
  });
  assert.equal(call.otherMs, 73);
  assert.equal(call.accountingValid, true);
});

test("summary keeps call counts separate from retry attempt counts", () => {
  const [retryCall] = analyzeTrace(clickTrace([
    [0, "attempting click action"], [1, "  waiting for element to be visible, enabled and stable"],
    [11, "  memo actionability end stableMs=8"], [12, "  scrolling into view if needed"],
    [14, "  done scrolling"], [15, "retrying click action"],
    [20, "  waiting for element to be visible, enabled and stable"],
    [30, "  memo actionability end stableMs=8"], [31, "  scrolling into view if needed"],
    [33, "  done scrolling"], [40, "  memo hit testing start"],
    [42, "  memo hit testing end"], [50, "  performing click action"]
  ]));
  const summary = summarizeCalls([retryCall]);
  assert.equal(summary.clickCount, 1);
  assert.equal(summary.retryCount, 1);
  assert.equal(summary.phases.stable.count, 1);
  assert.equal(summary.phases.stable.attempts, 2);
  assert.equal(summary.phases.stable.totalMs, 16);
  assert.equal(summary.totalWait.totalMs, 50);
  assert.equal(summary.dominantByTotal, "other");
});

test("unreached phases consistently report zero count and null percentiles", () => {
  const [call] = analyzeTrace(clickTrace([[10, "attempting click action"], [20, "  performing click action"]]));
  for (const stats of Object.values(call.phases)) assert.deepEqual(stats, summarize([]));
  assert.equal(call.totalWaitMs, 10);
  assert.equal(call.otherMs, 10);
  assert.equal(call.accountingValid, true);
});

test("an incomplete failed attempt stays unclassified and retains its failure", () => {
  const events = clickTrace([[10, "attempting click action"],
    [20, "  waiting for element to be visible, enabled and stable"]], 80);
  events.at(-1).error = { message: "Timeout" };
  const [call] = analyzeTrace(events);
  assert.equal(call.status, "failed");
  assert.equal(call.totalWaitMs, 70);
  assert.equal(call.phases.actionability.count, 0);
  assert.equal(call.otherMs, 70);
  assert.equal(call.accountingValid, true);
});

test("unavailable instrumentation never reports an other-only measurement", () => {
  const [call] = analyzeTrace(clickTrace([[10, "attempting click action"], [20, "  performing click action"]]));
  assert.equal(call.otherMs, 10);
  assert.deepEqual(classifyMeasurement({ state: "unavailable", reason: "anchor changed" }, [call]),
    { measurementStatus: "unavailable", reason: "anchor changed" });
  assert.deepEqual(classifyMeasurement({ state: "active", reason: null }, []),
    { measurementStatus: "unavailable", reason: "No click calls in trace" });
  assert.deepEqual(classifyMeasurement({ state: "active", reason: null }, [call]),
    { measurementStatus: "unavailable", reason: "No phase samples for a ready click" });
  const [measured] = analyzeTrace(clickTrace([[10, "attempting click action"],
    [11, "  waiting for element to be visible, enabled and stable"],
    [21, "  memo actionability end stableMs=8"], [22, "  performing click action"]]));
  assert.deepEqual(classifyMeasurement({ state: "active", reason: null }, [measured]),
    { measurementStatus: "measured", calls: [measured] });
});

test("disabled diagnostic calls the original operation without touching tracing", async () => {
  const priorBrowser = process.env.MEMO_NEXUS_E2E_BROWSER;
  const priorPhases = process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
  try {
    process.env.MEMO_NEXUS_E2E_BROWSER = "webkit";
    delete process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
    const result = await traceCardOpen({ context() { throw new Error("tracing touched"); } },
      "tooltip", { configIndex: 0, theme: "light", width: 320 }, () => 42);
    assert.equal(result, 42);
  } finally {
    if (priorBrowser === undefined) delete process.env.MEMO_NEXUS_E2E_BROWSER;
    else process.env.MEMO_NEXUS_E2E_BROWSER = priorBrowser;
    if (priorPhases === undefined) delete process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
    else process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES = priorPhases;
  }
});

test("diagnostic setup failure does not change operation result or error", async () => {
  const priorBrowser = process.env.MEMO_NEXUS_E2E_BROWSER;
  const priorPhases = process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
  const priorError = console.error;
  try {
    process.env.MEMO_NEXUS_E2E_BROWSER = "webkit";
    process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES = "1";
    console.error = () => {};
    const page = { context: () => ({ tracing: { start: async () => { throw new Error("diagnostic failure"); } } }) };
    const condition = { configIndex: 0, theme: "light", width: 320 };
    assert.equal(await traceCardOpen(page, "tooltip", condition, () => "clicked"), "clicked");
    const operationError = new Error("original click failed");
    await assert.rejects(traceCardOpen(page, "tooltip", condition, () => { throw operationError; }),
      (error) => error === operationError);
  } finally {
    console.error = priorError;
    if (priorBrowser === undefined) delete process.env.MEMO_NEXUS_E2E_BROWSER;
    else process.env.MEMO_NEXUS_E2E_BROWSER = priorBrowser;
    if (priorPhases === undefined) delete process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
    else process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES = priorPhases;
  }
});

test("diagnostic collection failure does not change a successful operation", async () => {
  const priorBrowser = process.env.MEMO_NEXUS_E2E_BROWSER;
  const priorPhases = process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
  const priorError = console.error;
  try {
    process.env.MEMO_NEXUS_E2E_BROWSER = "webkit";
    process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES = "1";
    console.error = () => {};
    const context = { tracing: {
      start: async () => {}, startChunk: async () => {},
      stopChunk: async () => { throw new Error("diagnostic collection failure"); },
      stop: async () => {}
    } };
    const page = { context: () => context };
    assert.equal(await traceCardOpen(page, "tooltip", { configIndex: 0, theme: "light", width: 320 },
      () => "clicked"), "clicked");
    await stopCardClickTracing(page);
  } finally {
    console.error = priorError;
    if (priorBrowser === undefined) delete process.env.MEMO_NEXUS_E2E_BROWSER;
    else process.env.MEMO_NEXUS_E2E_BROWSER = priorBrowser;
    if (priorPhases === undefined) delete process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
    else process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES = priorPhases;
  }
});

test("phase Trace directory is removed after collection failure without changing the operation result", async () => {
  const priorBrowser = process.env.MEMO_NEXUS_E2E_BROWSER;
  const priorPhases = process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
  const priorError = console.error;
  const priorMkdtemp = fs.mkdtempSync;
  let directory;
  try {
    process.env.MEMO_NEXUS_E2E_BROWSER = "webkit";
    process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES = "1";
    console.error = () => {};
    fs.mkdtempSync = (...args) => {
      directory = priorMkdtemp(...args);
      return directory;
    };
    const context = { tracing: {
      start: async () => {}, startChunk: async () => {},
      stopChunk: async () => { throw new Error("collection failed"); },
      stop: async () => { throw new Error("stop failed"); }
    } };
    const page = { context: () => context };
    const condition = { configIndex: 0, theme: "light", width: 320 };
    assert.equal(await traceCardOpen(page, "tooltip", condition, () => "clicked"), "clicked");
    assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.equal(fs.existsSync(directory), true);
    await stopCardClickTracing(page);
    assert.equal(fs.existsSync(directory), false);
  } finally {
    fs.mkdtempSync = priorMkdtemp;
    console.error = priorError;
    if (priorBrowser === undefined) delete process.env.MEMO_NEXUS_E2E_BROWSER;
    else process.env.MEMO_NEXUS_E2E_BROWSER = priorBrowser;
    if (priorPhases === undefined) delete process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
    else process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES = priorPhases;
  }
});

test("phase Trace cleanup failure is logged and its directory state is reset", async () => {
  const priorBrowser = process.env.MEMO_NEXUS_E2E_BROWSER;
  const priorPhases = process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
  const priorError = console.error;
  const priorMkdtemp = fs.mkdtempSync;
  const priorRm = fs.rmSync;
  const directories = [];
  const errors = [];
  try {
    process.env.MEMO_NEXUS_E2E_BROWSER = "webkit";
    process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES = "1";
    console.error = (line) => errors.push(line);
    fs.mkdtempSync = (...args) => {
      const directory = priorMkdtemp(...args);
      directories.push(directory);
      return directory;
    };
    const condition = { configIndex: 0, theme: "light", width: 320 };
    const page = () => {
      const context = { tracing: {
        start: async () => {}, startChunk: async () => {},
        stopChunk: async () => { throw new Error("collection failed"); }, stop: async () => {}
      } };
      return { context: () => context };
    };
    const first = page();
    assert.equal(await traceCardOpen(first, "tooltip", condition, () => "clicked"), "clicked");
    fs.rmSync = () => { throw new Error("cleanup failed"); };
    await stopCardClickTracing(first);
    assert.equal(fs.existsSync(directories[0]), true);
    assert.ok(errors.some((line) => line.includes('"stage":"cleanup"')));

    fs.rmSync = priorRm;
    const second = page();
    assert.equal(await traceCardOpen(second, "tooltip", condition, () => "clicked again"), "clicked again");
    assert.notEqual(directories[1], directories[0]);
    await stopCardClickTracing(second);
    assert.equal(fs.existsSync(directories[1]), false);
  } finally {
    fs.mkdtempSync = priorMkdtemp;
    fs.rmSync = priorRm;
    for (const directory of directories) {
      if (path.dirname(path.resolve(directory)).toLowerCase() === path.resolve(os.tmpdir()).toLowerCase()
        && path.basename(directory).startsWith(`memo-actionability-phases-${process.pid}-`)
        && fs.existsSync(directory)) priorRm(directory, { recursive: true, force: true });
    }
    console.error = priorError;
    if (priorBrowser === undefined) delete process.env.MEMO_NEXUS_E2E_BROWSER;
    else process.env.MEMO_NEXUS_E2E_BROWSER = priorBrowser;
    if (priorPhases === undefined) delete process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
    else process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES = priorPhases;
  }
});
