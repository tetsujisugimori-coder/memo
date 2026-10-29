"use strict";
const http = require("node:http"), fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto"), cp = require("node:child_process"), { performance } = require("node:perf_hooks");
const { PLAN, LIMITS } = require("./diagnostic-plan.js"), { bounded, inContext } = require("./context-harness.cjs");
module.exports = async ({ engineName, engines }) => {
  const root = __dirname, started = performance.now(), contextEvents = [], runs = [], timeline = [];
  const names = ["index.html", "worker.js", "suite.js", "controls.js", "cleanup.js", "diagnostic-plan.js", "diagnostic.js", "diagnostic-worker.js"];
  const sources = [...names, "run.cjs", "isolated-run.cjs", "context-harness.cjs"];
  const sourceHashes = {};
  for (const name of sources) sourceHashes[name] = crypto.createHash("sha256").update(await fs.readFile(path.join(root, name))).digest("hex");
  let gitHead = "UNKNOWN", gitTree = "UNKNOWN";
  try { gitHead = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 5000 }).trim(); gitTree = cp.execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8", timeout: 5000 }).trim(); } catch {}
  const output = { engine: engineName, platform: process.platform, nodeVersion: process.version, gitHead, gitTree, sourceHashes,
    githubRunId: process.env.GITHUB_RUN_ID || null, githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
    isolation: "browser-context", separateBrowserProcesses: false, plan: PLAN, limits: LIMITS, contextEvents, contextRuns: runs, diagnostics: PLAN.map(spec => ({ ...spec, outcome: "NOT_RUN" })), timeline,
    clockPolicy: "nodeMsはrunner内のみ。mainMsはcontextごと、workerMsはWorkerごと。異なる時計原点を比較しない。collectionSeqは収集順であり内部の同時順序の証明ではない。" };
  const server = http.createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
    if (!names.includes(name)) return res.writeHead(404).end();
    try { res.writeHead(200, { "Content-Type": name.endsWith(".html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-store" }); res.end(await fs.readFile(path.join(root, name))); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser, forceExit = false;
  async function run(label, action, maxMs = LIMITS.contextMs) {
    const remaining = LIMITS.runnerMs - (performance.now() - started);
    if (remaining <= 0 || runs.length >= LIMITS.maxContexts) { const skipped = { contextId: label, status: "NOT_RUN", reason: "predeclared runner limit" }; runs.push(skipped); return skipped; }
    const item = await inContext(browser, label, `http://127.0.0.1:${server.address().port}/`, action, contextEvents, { contextMs: Math.min(maxMs, remaining), closeMs: LIMITS.closeMs });
    runs.push({ contextId: item.contextId, error: item.error || null, contextCreate: item.contextCreate, contextClose: item.contextClose, pageErrors: item.pageErrors, partial: item.partial || null });
    for (const event of item.value?.timeline || []) timeline.push({ ...event, contextId: label, clockScope: label, collectionSeq: timeline.length + 1 });
    if (item.error || item.contextClose !== "RETURNED" || item.pageErrors.length) process.exitCode = 1;
    return item;
  }
  try {
    browser = await bounded(engines[engineName].launch({ headless: true }), 30000, "browser launch timeout"); output.browserVersion = browser.version();
    const primary = await run("primary-context", page => page.evaluate(() => window.runWorkerStudy()), 180000);
    output.primary = primary.value || { error: primary.error || primary.reason, states: "UNKNOWN" };
    output.states = primary.value?.states || null; output.failure = primary.value?.failure || primary.error || null; output.cleanup = primary.value?.cleanup || null;
    output.controls = {};
    for (const id of ["control-A", "control-B"]) {
      const item = await run(`${id}-context`, page => page.evaluate(selected => window.runWorkerControls([selected]), id));
      output.controls[id] = { contextId: item.contextId, ...(item.value?.results[id] || { outcome: "NOT_RUN", error: item.error || item.reason }) };
    }
    const regression = await run("regression-context", async page => {
      const injection = await page.evaluate(() => window.runWorkerStudy({ injectAt: "T6.gate" }));
      const expected = ["T1.search", "T2.unresolved", "T3.terminate", "T4.recovery", "T5.stale", "T6.gate", "T7 iteration 1.upgrade", "T9.reading", "T10.race", "T12.failure-injection", "T8.snapshot", "T8.compare", "T11.summary"];
      const probes = await page.evaluate(labels => Promise.all(labels.map(label => window.runWorkerStudy({ stageProbe: true, injectAt: label }))), expected);
      return { timeline: injection.timeline, injection: { valid: injection.failure?.startsWith("T6.gate:") && injection.states.T6 === "FAIL" && injection.states.T7 === "NOT_RUN", failure: injection.failure, states: injection.states, cleanup: injection.cleanup }, stageProbes: { count: expected.length, valid: probes.every((probe, i) => probe.failure?.startsWith(expected[i] + ":") && probe.states[expected[i].match(/^T[0-9]+/)[0]] === "FAIL") } };
    });
    output.realInjection = regression.value?.injection || null; output.stageProbes = regression.value?.stageProbes || null;
    for (const spec of PLAN) {
      const item = await run(`diagnostic-${spec.id}-context`, page => page.evaluate(condition => window.runIndependentDiagnostic(condition), spec));
      output.diagnostics[PLAN.indexOf(spec)] = { ...spec, contextId: item.contextId, engine: engineName, browserVersion: output.browserVersion, separateBrowserProcess: false, ...(item.value || { outcome: item.error ? "UNKNOWN" : "NOT_RUN", error: item.error || item.reason, partial: item.partial || null }) };
    }
    if (output.primary.failure || output.primary.error || output.primary.cleanup?.status !== "PASS" || Object.values(output.controls).some(item => item.outcome !== "PASS" || item.cleanup?.status !== "PASS") || !output.realInjection?.valid || output.realInjection.cleanup?.status !== "PASS" || !output.stageProbes?.valid || output.diagnostics.some(item => item.outcome !== "PASS")) process.exitCode = 1;
  } catch (error) { output.fatal = String(error.stack || error); process.exitCode = 1; }
  finally {
    if (browser) {
      try { await bounded(browser.close(), LIMITS.closeMs, "browser close timeout"); output.browserClose = "RETURNED"; }
      catch { output.browserClose = "UNKNOWN"; process.exitCode = 1; forceExit = true; }
    }
    server.closeAllConnections?.();
    try { await bounded(new Promise(resolve => server.close(resolve)), LIMITS.closeMs, "fixture server close timeout"); } catch { output.serverClose = "UNKNOWN"; process.exitCode = 1; forceExit = true; }
    const directory = path.resolve(root, "../../e2e-artifacts/mcp-worker-diagnostics"); await fs.mkdir(directory, { recursive: true });
    const filename = `results-${engineName}-isolated-${process.env.GITHUB_RUN_ID || "local"}-${process.env.GITHUB_RUN_ATTEMPT || "1"}-${crypto.randomUUID()}.json`;
    output.elapsedMs = performance.now() - started;
    await fs.writeFile(path.join(directory, filename), JSON.stringify(output, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ file: filename, gitHead, engine: engineName, failure: output.failure || output.fatal || null, states: output.states, cleanup: output.cleanup, controls: output.controls, stageProbes: output.stageProbes, diagnostics: output.diagnostics.map(item => ({ id: item.id, contextId: item.contextId, established: item.conditionEstablished, upgrade: item.upgradeStatus, cleanup: item.cleanup?.status, outcome: item.outcome })) }));
    if (forceExit) process.exit(1);
  }
};
