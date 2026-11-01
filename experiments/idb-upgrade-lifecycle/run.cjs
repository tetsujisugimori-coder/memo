"use strict";
const fs = require("node:fs/promises"), path = require("node:path"), http = require("node:http"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process"), { webkit, chromium } = require("playwright");
const { build } = require("./source.cjs"), base = path.resolve(__dirname, "../mcp-search-worker-feasibility");
const { bounded } = require(path.join(base, "context-harness.cjs"));
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: __dirname, encoding: "utf8" }).trim();
const files = ["index.html", "suite.js", "worker.js", "cleanup.js", "controls.js", "diagnostic-plan.js", "diagnostic.js", "diagnostic-worker.js"];
const plan = [["webkit", "A"], ["webkit", "B"], ["webkit", "C"], ["webkit", "D"], ["webkit", "E"], ["chromium", "A"], ["chromium", "B"]];
(async () => {
  if (process.platform !== "linux") throw new Error("Linux-only diagnostic; no local browser trials permitted");
  const out = path.resolve(__dirname, "../../e2e-artifacts/idb-upgrade-lifecycle"); await fs.mkdir(out, { recursive: true });
  const source = Object.fromEntries(await Promise.all(files.map(async n => [n, await fs.readFile(path.join(base, n), "utf8")])));
  const observer = await fs.readFile(path.join(__dirname, "observer.js"), "utf8"), controls = await fs.readFile(path.join(__dirname, "controls.js"), "utf8");
  const generated = Object.fromEntries(["C", "D", "E"].map(c => [c, build(source["suite.js"], source["worker.js"], observer, c === "E", c === "C")]));
  for (const [c, g] of Object.entries(generated)) {
    await fs.writeFile(path.join(out, `generated-${c}-suite.js`), g.suite, { flag: "wx" });
    await fs.writeFile(path.join(out, `generated-${c}-worker.js`), g.worker, { flag: "wx" });
    await fs.writeFile(path.join(out, `changes-${c}.json`), JSON.stringify(g.changes, null, 2) + "\n", { flag: "wx" });
  }
  const input = [...files.map(n => path.join(base, n)), ...["observer.js", "controls.js", "source.cjs", "run.cjs"].map(n => path.join(__dirname, n))];
  const report = { testedCommit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"), dirty: Boolean(git("status", "--porcelain", "--untracked-files=no")),
    recordedAtJST: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }) + " JST", platform: process.platform, node: process.version,
    plan, maxTrials: 8, plannedTrials: 7, unusedAllowance: 1, trials: [], sourceHashes: {}, generatedHashes: {}, outcome: "PARTIAL",
    limits: { openMs: 8000, cleanupMs: 2000, contextMs: 180000, closeMs: 5000, maxIterations: 12, maxEvents: 10000, heartbeatMs: 100 },
    clockRule: "sourceMs is comparable only within the same owner/run; receivedMainMs belongs to main, nodeMs to Node", physicalRelease: "UNKNOWN" };
  for (const p of input) report.sourceHashes[path.relative(path.resolve(__dirname, "../.."), p).replaceAll("\\", "/")] = hash(await fs.readFile(p));
  for (const [c, g] of Object.entries(generated)) report.generatedHashes[c] = { suite: hash(g.suite), worker: hash(g.worker) };
  const saveReport = () => fs.writeFile(path.join(out, "results.json"), JSON.stringify(report, null, 2) + "\n");
  let current, halt = false;
  const server = http.createServer((req, res) => {
    const n = new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
    let content;
    if (n === "control.html") content = '<!doctype html><script src="cleanup.js"></script><script src="lifecycle-controls.js"></script>';
    else if (n === "lifecycle-controls.js") content = controls;
    else if (files.includes(n)) content = generated[current]?.[n === "suite.js" ? "suite" : n === "worker.js" ? "worker" : "none"] || source[n];
    if (content === undefined) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": n.endsWith("html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-store" }); res.end(content);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    for (const [engine, condition] of plan) {
      const trial = { runId: crypto.randomUUID(), engine, condition, outcome: "NOT_RUN", contextClose: "NOT_RUN", browserClose: "NOT_RUN", pageErrors: [], controller: [] };
      report.trials.push(trial);
      if (halt) { trial.reason = "previous_anomaly_safe_stop"; continue; }
      current = condition;
      let browser, context, page;
      const nodeStart = performance.now(), log = (event, details = {}) => trial.controller.push({ event, nodeMs: performance.now() - nodeStart, ...details });
      try {
        log("browser_launch_start"); browser = await bounded(({ webkit, chromium })[engine].launch({ headless: true }), 30000, "browser_launch_timeout");
        trial.browserVersion = browser.version(); log("browser_launch_returned");
        const creation = browser.newContext();
        creation.then(c => { if (trial.contextCreate === "UNKNOWN") void c.close().catch(() => {}); }, () => {});
        context = await bounded(creation, 8000, "context_create_timeout"); trial.contextCreate = "OBSERVED";
        page = await bounded(context.newPage(), 8000, "page_create_timeout"); page.on("pageerror", e => trial.pageErrors.push(e.message));
        await page.exposeFunction("__saveBeforeCleanup", async snapshot => {
          // Persist the failing DB's evidence before the original delete request is issued.
          await fs.writeFile(path.join(out, `${trial.runId}-precleanup.json`), JSON.stringify({ testedCommit: report.testedCommit, tree: report.tree,
            runId: trial.runId, engine, browserVersion: trial.browserVersion, condition, snapshot }, null, 2) + "\n", { flag: "wx" });
          trial.precleanupSaved = true; log("precleanup_saved"); await saveReport();
        });
        await page.addInitScript({ content: `${observer}\nwindow.__runId=${JSON.stringify(trial.runId)};window.__lifeEvents=[];window.__overflow=false;
window.__receiveLife=e=>{if(__lifeEvents.length>=10000){window.__overflow=true;return;}__lifeEvents.push({...e,receivedMainMs:performance.now(),receiveSeq:__lifeEvents.length+1});};
window.__life=installLifecycleObserver(window.__receiveLife,{runId:window.__runId,owner:"main"});
window.__heartbeat=setInterval(()=>window.__life.log("main_heartbeat"),100);` });
        await page.goto(`http://127.0.0.1:${server.address().port}/${["A", "B"].includes(condition) ? "control.html" : "index.html"}`, { timeout: 8000 });
        log("trial_start");
        trial.value = await bounded(page.evaluate(async c => {
          const value = ["A", "B"].includes(c) ? await window.runLifecycleControl(c) : await window.runWorkerStudy({ t7Only: true });
          clearInterval(window.__heartbeat);
          return { value, events: window.__lifeEvents, mainState: window.__life.state, overflow: window.__overflow };
        }, condition), 180000, "trial_timeout");
        log("trial_returned");
        const value = trial.value.value, expectedTimeout = /^T7 iteration \d+\.upgrade: IndexedDB open timeout/.test(value.failure || "");
        trial.dbName = trial.value.events.find(e => e.dbName !== "UNKNOWN")?.dbName || "UNKNOWN";
        trial.outcome = value.failure || value.error || value.cleanup?.status !== "PASS" ? "FAIL" : ["A", "B"].includes(condition) ? "PASS" : "PARTIAL";
        trial.expectedUpgradeTimeout = expectedTimeout;
        if (!trial.precleanupSaved || trial.pageErrors.length || trial.value.overflow || (["A", "B"].includes(condition) && trial.outcome !== "PASS") || (value.failure && !expectedTimeout) || (value.cleanup?.status !== "PASS" && !expectedTimeout)) halt = true;
      } catch (e) {
        trial.error = e.message; trial.outcome = "FAIL"; halt = true; log("trial_error", { outcome: e.message });
        if (!context) trial.contextCreate = "UNKNOWN";
        if (page) try { trial.partial = await bounded(page.evaluate(() => ({ events: window.__lifeEvents, mainState: window.__life?.state, overflow: window.__overflow })), 500, "partial_timeout"); } catch { trial.partial = "UNKNOWN"; }
      } finally {
        // Save all available evidence before closing the isolated context/browser.
        await saveReport();
        if (context) { log("context_close_start"); try { await bounded(context.close(), 5000, "context_close_timeout"); trial.contextClose = "RETURNED"; } catch { trial.contextClose = "UNKNOWN"; halt = true; } log("context_close_end"); }
        if (browser) { log("browser_close_start"); try { await bounded(browser.close(), 5000, "browser_close_timeout"); trial.browserClose = "RETURNED"; } catch { trial.browserClose = "UNKNOWN"; halt = true; } log("browser_close_end"); }
        await saveReport();
      }
    }
    report.executedTrials = report.trials.filter(t => t.outcome !== "NOT_RUN").length;
    report.notRunTrials = report.trials.filter(t => t.outcome === "NOT_RUN").length;
    report.outcome = report.trials.some(t => t.outcome === "FAIL" || t.outcome === "NOT_RUN") ? "FAIL" : "PARTIAL";
  } finally { server.closeAllConnections?.(); await bounded(new Promise(resolve => server.close(resolve)), 5000, "server_close_timeout"); await saveReport(); }
  console.log(JSON.stringify({ testedCommit: report.testedCommit, trials: report.trials.map(t => ({ engine: t.engine, condition: t.condition, runId: t.runId, outcome: t.outcome, error: t.error, failure: t.value?.value?.failure, cleanup: t.value?.value?.cleanup?.status })) }));
  if (report.outcome === "FAIL") process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
