"use strict";
// One Linux WebKit trial. Serve the original suite with one identity-only insertion.
const fs = require("node:fs/promises"), path = require("node:path"), http = require("node:http");
const crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const { webkit } = require("playwright");
const root = path.resolve(__dirname, "../mcp-search-worker-feasibility");
const { bounded, inContext } = require(path.join(root, "context-harness.cjs"));
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: __dirname, encoding: "utf8" }).trim();
const files = ["index.html", "suite.js", "worker.js", "cleanup.js", "controls.js", "diagnostic-plan.js", "diagnostic.js", "diagnostic-worker.js"];
const anchor = '  const checks = {}, observations = {}, dbName = `worker-poc-${crypto.randomUUID()}`;';
const insertion = '\n  window.t7DbIdentity = { runId: options.identityRunId, testId: "T7", iteration: 0, iterationMeaning: "before T7; this DB is shared by iterations 1..12", dbName, requestedVersion: 1, observedAt: new Date().toISOString(), mainMs: performance.now(), environment: "Linux WebKit", phase: "db_generated_before_first_open" };';

(async () => {
  const sources = Object.fromEntries(await Promise.all(files.map(async name => [name, await fs.readFile(path.join(root, name), "utf8")])));
  if (sources["suite.js"].split(anchor).length !== 2) throw new Error("identity insertion anchor must occur exactly once");
  const servedSuite = sources["suite.js"].replace(anchor, anchor + insertion);
  if (servedSuite.replace(anchor + insertion, anchor) !== sources["suite.js"]) throw new Error("unexpected suite mutation");
  const output = path.resolve(__dirname, "../../e2e-artifacts/t7-db-identity");
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "suite-identity.patch"), `--- original/suite.js\n+++ diagnostic/suite.js\n@@ -4,1 +4,2 @@\n ${anchor}\n+${insertion.trimStart()}\n`, { flag: "wx" });
  const result = { runId: crypto.randomUUID(), testedCommit: git("rev-parse", "HEAD"), testedTree: git("rev-parse", "HEAD^{tree}"),
    dirty: Boolean(git("status", "--porcelain", "--untracked-files=no")), recordedAt: new Date().toISOString(), platform: process.platform,
    node: process.version, engine: "webkit", runs: 1, options: { t7Only: true },
    limits: { openMs: 8000, cleanupMs: 2000, maxIterations: 12, contextMs: 180000, closeMs: 5000 },
    sourceHashes: Object.fromEntries(files.map(name => [name, hash(sources[name])])), servedSuiteHash: hash(servedSuite),
    runnerHash: hash(await fs.readFile(__filename)), harnessHash: hash(await fs.readFile(path.join(root, "context-harness.cjs"))),
    identity: null, iterations: [], processRelease: "UNKNOWN", outcome: "FAIL", contextEvents: [] };
  // Static verification performs no browser or IndexedDB operations.
  if (process.argv.includes("--verify-source")) { console.log(JSON.stringify({ sourceVerified: true, originalSuite: result.sourceHashes["suite.js"], servedSuite: result.servedSuiteHash })); return; }
  if (process.platform !== "linux") throw new Error("this diagnostic requires Linux WebKit");
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
    if (!files.includes(name)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": name.endsWith(".html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(name === "suite.js" ? servedSuite : sources[name]);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser, forced = false;
  try {
    browser = await bounded(webkit.launch({ headless: true }), 30000, "browser launch timeout");
    result.browserVersion = browser.version();
    result.trial = await inContext(browser, result.runId, `http://127.0.0.1:${server.address().port}/`,
      page => page.evaluate(async runId => {
        const value = await window.runWorkerStudy({ t7Only: true, identityRunId: runId });
        return { identity: window.t7DbIdentity, value };
      }, result.runId), result.contextEvents, { contextMs: 180000, closeMs: 5000 });
    result.identity = result.trial.value?.identity || null;
    // Store the DB identifier once. Iterations refer to the run's identity record.
    if (result.trial.value) result.trial.value = result.trial.value.value;
    const value = result.trial.value, events = value?.timeline || [];
    result.iterations = events.filter(e => e.testId === "T7" && e.iteration && e.event === "open_start").map(open => {
      const end = events.find(e => e.seq > open.seq && e.testId === "T7" && e.iteration === open.iteration && ["open_success", "open_timeout_or_error"].includes(e.event));
      return { runId: result.runId, identityRef: "identity", iteration: open.iteration, requestedVersion: open.requestedVersion,
        openSeq: open.seq, endSeq: end?.seq ?? null, upgrade: end?.event || "UNKNOWN", elapsedMs: end ? end.mainMs - open.mainMs : null,
        timeout: end ? end.outcome === "IndexedDB open timeout" : "UNKNOWN", cleanup: value.cleanup?.status || "UNKNOWN" };
    });
    const observed = result.identity?.runId === result.runId && result.identity.dbName && result.iterations.length;
    result.observation = observed ? "PASS" : "PARTIAL";
    result.failedIteration = result.iterations.find(row => row.timeout === true)?.iteration ?? null;
    result.goal = observed && result.failedIteration !== null ? "PASS" : "PARTIAL";
    result.outcome = result.trial.error || result.trial.pageErrors.length || result.trial.contextClose !== "RETURNED" || value?.failure || value?.cleanup?.status !== "PASS" || value?.states?.T7 !== "PARTIAL" ? "FAIL" : "PARTIAL";
  } catch (error) { result.fatal = String(error); }
  finally {
    if (browser) { try { await bounded(browser.close(), 5000, "browser close timeout"); result.browserClose = "RETURNED"; } catch { result.browserClose = "UNKNOWN"; forced = true; } }
    server.closeAllConnections?.();
    try { await bounded(new Promise(resolve => server.close(resolve)), 5000, "server close timeout"); } catch { result.serverClose = "UNKNOWN"; forced = true; }
    const filename = `t7-db-identity-${result.runId}.json`;
    await fs.writeFile(path.join(output, filename), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ file: filename, runId: result.runId, goal: result.goal, outcome: result.outcome, failedIteration: result.failedIteration, cleanup: result.trial?.value?.cleanup?.status, fatal: result.fatal }));
    if (forced || result.outcome === "FAIL" || result.observation !== "PASS") process.exitCode = 1;
    if (forced) process.exit(1);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
