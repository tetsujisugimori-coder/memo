"use strict";
// Finite, read-only source variants. Never overwrite the primary suite or its evidence.
const fs = require("node:fs/promises"), http = require("node:http"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium, webkit } = require("playwright"), { bounded } = require("./context-harness.cjs");
const { metadata, save, hash } = require("./stage5-evidence.cjs");
const engine = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engine)) throw new Error("unsupported engine");
const variants = ["primary", "minimal", "complete-no-close", "complete-close", "before-complete-gate"];
const files = ["index.html", "suite.js", "worker.js", "cleanup.js", "controls.js", "diagnostic.js", "diagnostic-plan.js", "diagnostic-worker.js"];
function replaceOnce(source, before, after) { assert.equal(source.split(before).length, 2, "primary source changed; review variant"); return source.replace(before, after); }
function variantSource(source, variant) {
  if (variant === "primary") return source;
  if (variant === "minimal") return replaceOnce(source, 'const send = (phase, extra = {}) => postMessage(', 'const send = (phase, extra = {}) => { if (testId === "T7" && !["unresolved", "error"].includes(phase)) return; postMessage(')
    .replace('phase, ...extra });', 'phase, ...extra }); };');
  if (variant === "before-complete-gate") return replaceOnce(source, 'send("request_success");', 'send("request_success"); if (testId === "T7" && mode === "unresolved") { send("unresolved"); while (true) {} }');
  const close = variant === "complete-close" ? ' db.close(); send("db_close_called", {outcome:"returned"});' : '';
  return replaceOnce(source, 'if (mode === "unresolved") { send("unresolved");', `if (mode === "unresolved") { if (testId === "T7") { if (await transactionDone !== "complete") throw new Error("transaction_not_complete");${close} } send("unresolved");`);
}
(async () => {
  const sources = Object.fromEntries(await Promise.all(files.map(async f => [f, await fs.readFile(path.join(__dirname, f), "utf8")])));
  const workers = Object.fromEntries(variants.map(v => [v, variantSource(sources["worker.js"], v)]));
  const report = { ...await metadata([...files, "stage5-t7.cjs", "context-harness.cjs", "stage5-evidence.cjs"].map(f => `experiments/mcp-search-worker-feasibility/${f}`)), engine,
    limits: { primaryMs: 180000, openMs: 8000, cleanupMs: 2000, variants: 5, repetitionsPerVariant: 1, maxT7Iterations: 12 },
    generatedWorkerHashes: Object.fromEntries(variants.map(v => [v, hash(workers[v])])), trials: [], physicalRelease: "UNKNOWN", outcome: "PARTIAL" };
  const server = http.createServer((req, res) => {
    const [variant, filename = "index.html"] = new URL(req.url, "http://localhost").pathname.slice(1).split("/");
    if (!variants.includes(variant) || !files.includes(filename)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": filename.endsWith("html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(filename === "worker.js" ? workers[variant] : sources[filename]);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const probe = page => bounded(page.evaluate(async () => {
    const name = "stage5-followup-" + crypto.randomUUID();
    let db;
    try {
      db = await new Promise((resolve, reject) => { const r = indexedDB.open(name, 1), timer = setTimeout(() => reject(new Error("open_timeout")), 8000);
        r.onupgradeneeded = () => r.result.createObjectStore("fixture");
        r.onsuccess = () => { clearTimeout(timer); resolve(r.result); }; r.onerror = () => { clearTimeout(timer); reject(r.error); }; });
      db.close(); return { open: "PASS", cleanup: await WorkerPocCleanup.deleteDatabaseObserved({ factory: indexedDB, dbName: name, record() {} }) };
    } catch { return { open: "UNKNOWN", cleanup: "UNKNOWN" }; }
  }), 11000, "followup timeout");
  let halt = false;
  try {
    for (const variant of variants) {
      const trial = { variant, outcome: "NOT_RUN", browserClose: "NOT_RUN", contextClose: "NOT_RUN", pageErrors: [] }; report.trials.push(trial);
      if (halt) continue;
      let browser, context;
      try {
        browser = await ({ chromium, webkit })[engine].launch({ headless: true, timeout: 30000 }); report.browserVersion = browser.version();
        context = await bounded(browser.newContext(), 8000, "context create timeout");
        const page = await bounded(context.newPage(), 8000, "page create timeout"); page.on("pageerror", () => trial.pageErrors.push("pageerror"));
        const url = `http://127.0.0.1:${server.address().port}/${variant}/index.html`;
        await page.goto(url, { timeout: 8000 });
        trial.primary = await bounded(page.evaluate(() => runWorkerStudy()), 180000, "primary timeout");
        trial.sameContextFollowup = await probe(page);
        await bounded(context.close(), 5000, "context close timeout"); trial.contextClose = "RETURNED"; context = null;
        context = await bounded(browser.newContext(), 8000, "followup context create timeout");
        const next = await bounded(context.newPage(), 8000, "followup page create timeout"); await next.goto(url, { timeout: 8000 });
        trial.separateContextFollowup = await probe(next);
        const p = trial.primary;
        const follows = [trial.sameContextFollowup, trial.separateContextFollowup];
        trial.outcome = !p.failure && p.cleanup?.status === "PASS" && !trial.pageErrors.length && follows.every(x => x.open === "PASS" && x.cleanup?.status === "PASS") ? "PARTIAL" : "FAIL";
        // Failure and NOT_RUN in the original T7 are never replaced by a variant success.
        if (trial.outcome === "FAIL") process.exitCode = 1;
      } catch (error) { trial.error = error.message; trial.outcome = "FAIL"; process.exitCode = 1; }
      finally {
        if (context) try { await bounded(context.close(), 5000, "close"); trial.contextClose = "RETURNED"; } catch { trial.contextClose = "UNKNOWN"; halt = true; process.exitCode = 1; }
        if (browser) try { await bounded(browser.close(), 5000, "close"); trial.browserClose = "RETURNED"; } catch { trial.browserClose = "UNKNOWN"; halt = true; process.exitCode = 1; }
        else { halt = true; trial.browserClose = "UNKNOWN"; }
      }
      console.log(JSON.stringify({ variant, outcome: trial.outcome, T7: trial.primary?.states?.T7, failure: trial.primary?.failure, cleanup: trial.primary?.cleanup?.status }));
    }
    if (report.trials.some(t => t.outcome === "FAIL" || t.outcome === "NOT_RUN")) report.outcome = "FAIL";
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await save(`t7-${engine}`, report); }
})().catch(e => { console.error(e); process.exitCode = 1; });
