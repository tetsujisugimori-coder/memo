"use strict";
const fs = require("node:fs/promises"), path = require("node:path"), http = require("node:http"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process"), { webkit } = require("playwright");
const { buildF } = require("./source.cjs"), { analyze } = require("./analyze.cjs");
const base = path.resolve(__dirname, "../mcp-search-worker-feasibility"), prior = path.resolve(__dirname, "../idb-upgrade-lifecycle");
const { bounded } = require(path.join(base, "context-harness.cjs"));
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: __dirname, encoding: "utf8" }).trim();
const files = ["index.html", "suite.js", "worker.js", "cleanup.js", "controls.js", "diagnostic-plan.js", "diagnostic.js", "diagnostic-worker.js"];
(async () => {
  if (process.platform !== "linux") throw new Error("Linux-only; no local browser trials permitted");
  if (process.env.GITHUB_RUN_ATTEMPT && process.env.GITHUB_RUN_ATTEMPT !== "1") throw new Error("Retries forbidden: allowance exhausted or uncertain");
  const out = path.resolve(__dirname, "../../e2e-artifacts/idb-transaction-complete-only");
  await fs.mkdir(out, { recursive: true });
  // Exclusive reservation: rerunning in the same workspace cannot start another browser.
  await fs.writeFile(path.join(out, "trial-reservation.json"), JSON.stringify({ maximum: 1, priorTrials: 7, retries: 0, reservedAtJST: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }) + " JST" }), { flag: "wx" });
  const source = Object.fromEntries(await Promise.all(files.map(async n => [n, await fs.readFile(path.join(base, n), "utf8")])));
  const observer = await fs.readFile(path.join(prior, "observer.js"), "utf8"), generated = buildF(source["suite.js"], source["worker.js"], observer);
  for (const [name, content] of Object.entries({ "generated-F-suite.js": generated.suite, "generated-F-worker.js": generated.worker,
    "generated-D-suite.js": generated.baselineSuite, "generated-D-worker.js": generated.baselineWorker,
    "changes-F.json": JSON.stringify({ changes: generated.changes, prefix: generated.prefix, baselineChanges: generated.baselineChanges }, null, 2) })) {
    await fs.writeFile(path.join(out, name), content, { flag: "wx" });
  }
  const trial = { runId: crypto.randomUUID(), engine: "webkit", condition: "F", outcome: "NOT_RUN", contextClose: "NOT_RUN", browserClose: "NOT_RUN", pageErrors: [], controller: [] };
  const report = { testedCommit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"), dirty: Boolean(git("status", "--porcelain", "--untracked-files=no")),
    recordedAtJST: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }) + " JST", platform: process.platform, node: process.version,
    priorTrials: 7, maxTrials: 1, totalLimit: 8, executedTrials: 0, retries: 0, trials: [trial], sourceHashes: {},
    generatedHashes: { suite: hash(generated.suite), worker: hash(generated.worker), baselineSuite: hash(generated.baselineSuite), baselineWorker: hash(generated.baselineWorker) },
    limits: { maxIterations: 12, openMs: 8000, cleanupMs: 2000, trialMs: 180000, closeMs: 5000, heartbeatMs: 100, maxEvents: 10000 }, outcome: "NOT_RUN", physicalRelease: "UNKNOWN" };
  const input = [...files.map(n => path.join(base, n)), path.join(base, "context-harness.cjs"), ...["observer.js", "source.cjs"].map(n => path.join(prior, n)), ...["wait.cjs", "source.cjs", "analyze.cjs", "run.cjs"].map(n => path.join(__dirname, n))];
  for (const p of input) report.sourceHashes[path.relative(path.resolve(__dirname, "../.."), p).replaceAll("\\", "/")] = hash(await fs.readFile(p));
  const save = () => fs.writeFile(path.join(out, "results.json"), JSON.stringify(report, null, 2) + "\n");
  await save();
  const server = http.createServer((req, res) => {
    const n = new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
    const content = n === "suite.js" ? generated.suite : n === "worker.js" ? generated.worker : files.includes(n) ? source[n] : undefined;
    if (content === undefined) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": n.endsWith("html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-store" }); res.end(content);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  let browser, context, page;
  const nodeStart = performance.now(), log = (event, details = {}) => trial.controller.push({ event, nodeMs: performance.now() - nodeStart, ...details });
  try {
    report.executedTrials = 1; trial.outcome = "UNKNOWN"; await save();
    log("browser_launch_start"); browser = await bounded(webkit.launch({ headless: true }), 30000, "browser_launch_timeout");
    trial.browserVersion = browser.version(); log("browser_launch_returned");
    const creation = browser.newContext();
    creation.then(c => { if (trial.contextCreate === "UNKNOWN") void c.close().catch(() => {}); }, () => {});
    context = await bounded(creation, 8000, "context_create_timeout"); trial.contextCreate = "OBSERVED";
    page = await bounded(context.newPage(), 8000, "page_create_timeout");
    let rejectPageError;
    const pageError = new Promise((_, reject) => { rejectPageError = reject; });
    pageError.catch(() => {});
    page.on("pageerror", e => { trial.pageErrors.push(e.message); rejectPageError(new Error(`F_measurement_or_page_error: ${e.message}`)); });
    await page.exposeFunction("__saveBeforeCleanup", async snapshot => {
      await fs.writeFile(path.join(out, `${trial.runId}-precleanup.json`), JSON.stringify({ testedCommit: report.testedCommit, tree: report.tree, runId: trial.runId,
        engine: trial.engine, browserVersion: trial.browserVersion, condition: "F", snapshot }, null, 2) + "\n", { flag: "wx" });
      trial.precleanupSaved = true; log("precleanup_saved"); await save();
    });
    await page.addInitScript({ content: `${observer}\nwindow.__runId=${JSON.stringify(trial.runId)};window.__lifeEvents=[];window.__overflow=false;
window.__receiveLife=e=>{if(__lifeEvents.length>=10000){window.__overflow=true;throw new Error("F_telemetry_overflow");}__lifeEvents.push({...e,receivedMainMs:performance.now(),receiveSeq:__lifeEvents.length+1});};
window.__life=installLifecycleObserver(window.__receiveLife,{runId:window.__runId,owner:"main"});
window.__heartbeat=setInterval(()=>window.__life.log("main_heartbeat"),100);` });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 8000 });
    log("trial_start");
    trial.value = await bounded(Promise.race([pageError, page.evaluate(async () => {
      const value = await window.runWorkerStudy({ t7Only: true }); clearInterval(window.__heartbeat);
      return { value, events: window.__lifeEvents, mainState: window.__life.state, overflow: window.__overflow };
    })]), 180000, "trial_timeout");
    log("trial_returned");
    trial.dbName = trial.value.events.find(e => e.dbName !== "UNKNOWN")?.dbName || "UNKNOWN";
  } catch (e) {
    trial.error = e.message; trial.outcome = "FAIL"; log("trial_error", { outcome: e.message });
    if (!context) trial.contextCreate = "UNKNOWN";
    if (page) try { trial.partial = await bounded(page.evaluate(() => ({ events: window.__lifeEvents, mainState: window.__life?.state, overflow: window.__overflow })), 500, "partial_timeout"); } catch { trial.partial = "UNKNOWN"; }
  } finally {
    // A persistence failure must not prevent bounded teardown. No extra IDB request here.
    try { await save(); } catch (e) { trial.evidenceError = e.message; process.exitCode = 1; }
    if (context) { log("context_close_start"); try { await bounded(context.close(), 5000, "context_close_timeout"); trial.contextClose = "RETURNED"; } catch { trial.contextClose = "UNKNOWN"; } log("context_close_end"); }
    if (browser) { log("browser_close_start"); try { await bounded(browser.close(), 5000, "browser_close_timeout"); trial.browserClose = "RETURNED"; } catch { trial.browserClose = "UNKNOWN"; } log("browser_close_end"); }
    server.closeAllConnections?.(); await bounded(new Promise(resolve => server.close(resolve)), 5000, "server_close_timeout");
    report.analysis = analyze(trial); trial.outcome = report.analysis.execution;
    report.outcome = trial.evidenceError ? "FAIL" : trial.outcome;
    await save();
  }
  console.log(JSON.stringify({ testedCommit: report.testedCommit, runId: trial.runId, dbName: trial.dbName, outcome: report.outcome, condition: report.analysis.condition,
    completedUpgrades: report.analysis.completedUpgrades, cleanup: report.analysis.cleanup, failure: report.analysis.failure, executedTrials: report.executedTrials, retries: report.retries }));
  if (report.outcome !== "PASS") process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
