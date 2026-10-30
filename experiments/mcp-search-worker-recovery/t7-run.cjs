"use strict";
// Synthetic fixture only. Never imports app.js or opens the application's DB.
const fs = require("node:fs/promises"), path = require("node:path"), http = require("node:http"), crypto = require("node:crypto"), cp = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { chromium, webkit } = require("playwright");
const root = path.resolve(__dirname, "../mcp-search-worker-feasibility");
const engine = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engine)) throw new Error("unsupported browser");
const limits = { launchMs: 30000, contextMs: 8000, primaryMs: 180000, t7OnlyMs: 30000, closeMs: 2000, openMs: 8000, deleteMs: 2000, trials: 2 };
const bounded = (operation, ms, label) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(label)), ms); Promise.resolve(operation).then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); }); });
async function t7Only() {
  const timeline = [], dbName = `worker-recovery-t7-${crypto.randomUUID()}`;
  const output = { kind: "t7-only", outcome: "UNKNOWN", transactionTerminal: "UNKNOWN", connectionClosed: "UNKNOWN", timeline, cleanup: null };
  window.t7Progress = output;
  const record = (event, detail = {}) => timeline.push({ seq: timeline.length + 1, mainMs: performance.now(), event, ...detail });
  const wait = (operation, ms, label) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(label)), ms); Promise.resolve(operation).then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); }); });
  async function open(version, initialize = false) {
    let expired = false;
    record("open_start", { version });
    try { return await wait(new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, version);
      request.onblocked = () => record("open_blocked", { version });
      request.onupgradeneeded = () => { record("open_upgradeneeded", { version, late: expired }); if (expired) { request.transaction.abort(); return; } if (initialize) { request.result.createObjectStore("notes", { keyPath: "id" }); request.result.createObjectStore("metadata", { keyPath: "id" }); } };
      request.onerror = () => { record("open_error", { version, code: request.error?.name }); reject(request.error); };
      request.onsuccess = () => { record("open_success", { version, late: expired }); if (expired) request.result.close(); else resolve(request.result); };
    }), 8000, "open timeout"); } catch (error) { expired = true; record("open_timeout_or_error", { version, error: error.message }); throw error; }
  }
  let worker;
  try {
    const db = await open(1, true);
    try { await wait(new Promise((resolve, reject) => {
      const tx = db.transaction(["notes", "metadata"], "readwrite");
      tx.objectStore("notes").put({ id: "n1", title: "架空のメモ", body: "架空本文" });
      tx.objectStore("notes").put({ id: "n2", title: "別のメモ", body: "別の架空本文" });
      tx.objectStore("metadata").put({ id: "m1", value: "fixture" });
      tx.oncomplete = () => { record("fixture_transaction_complete"); resolve(); };
      tx.onabort = tx.onerror = () => reject(tx.error || new Error("fixture transaction failed"));
    }), 8000, "fixture timeout"); } finally { db.close(); record("fixture_close_called", { actualRelease: "UNKNOWN" }); }
    worker = new Worker("worker.js"); record("worker_created");
    await wait(new Promise((resolve, reject) => {
      worker.onerror = event => reject(new Error(event.message));
      worker.onmessage = ({ data }) => {
        record("worker_message", { ...data, workerTimestampOrigin: "worker performance clock" });
        if (["transaction_complete", "transaction_abort"].includes(data.phase)) output.transactionTerminal = data.phase;
        if (data.phase === "db_close_event") output.connectionClosed = "close_event";
        if (data.phase === "unresolved") resolve();
        if (data.phase === "error") reject(new Error(data.code));
      };
      worker.postMessage({ workerId: "t7-worker", generation: 1, requestId: "t7-request", session: "synthetic-session", testId: "T7", iteration: 1, dbName, mode: "unresolved", operation: "search", query: "架空" });
    }), 8000, "unresolved boundary timeout");
    record("terminate_call", { transactionTerminal: output.transactionTerminal, connectionClosed: output.connectionClosed }); worker.terminate(); record("terminate_return", { actualRelease: "UNKNOWN" }); worker = null;
    const upgraded = await open(2); upgraded.close(); record("upgrade_close_called", { actualRelease: "UNKNOWN" }); output.upgrade = "PASS";
  } catch (error) { output.failure = error.message; output.upgrade = "UNKNOWN"; record("trial_failure", { error: error.message }); }
  finally {
    if (worker) { record("cleanup_terminate_call"); try { worker.terminate(); record("cleanup_terminate_return", { actualRelease: "UNKNOWN" }); } catch (error) { record("cleanup_terminate_error", { error: error.message }); } }
    output.cleanup = await window.WorkerPocCleanup.deleteDatabaseObserved({ factory: indexedDB, dbName, record });
    output.outcome = output.upgrade === "PASS" && output.cleanup.status === "PASS" ? "PASS" : "UNKNOWN";
  }
  return output;
}
(async () => {
  const names = ["index.html", "worker.js", "suite.js", "controls.js", "cleanup.js", "diagnostic-plan.js", "diagnostic.js", "diagnostic-worker.js"];
  const output = { engine, platform: process.platform, node: process.version, limits, trials: [{ kind: "original-primary", outcome: "NOT_RUN" }, { kind: "t7-only", outcome: "NOT_RUN" }], sources: {}, startedAt: new Date().toISOString(), processIsolation: "separate browser.launch per condition; OS release UNKNOWN", clockPolicy: "mainMs is per page and workerMs per Worker; origins not compared" };
  for (const name of names) output.sources[name] = crypto.createHash("sha256").update(await fs.readFile(path.join(root, name))).digest("hex");
  output.sources["t7-run.cjs"] = crypto.createHash("sha256").update(await fs.readFile(__filename)).digest("hex");
  try { output.head = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim(); output.tree = cp.execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: __dirname, encoding: "utf8" }).trim(); } catch { output.head = "UNKNOWN"; }
  const directory = path.resolve(__dirname, "../../e2e-artifacts/mcp-worker-recovery"); await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `t7-${engine}-${crypto.randomUUID()}.json`);
  let saved = false;
  async function save() { if (saved) return; saved = true; output.endedAt = new Date().toISOString(); await fs.writeFile(file, JSON.stringify(output, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ file, trials: output.trials.map(t => ({ kind: t.kind, outcome: t.outcome, error: t.error, close: t.browserClose, failure: t.value?.failure })) })); }
  const server = http.createServer(async (req, res) => { const name = new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html"; if (!names.includes(name)) return res.writeHead(404).end(); try { res.writeHead(200, { "Content-Type": name.endsWith(".html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-store" }); res.end(await fs.readFile(path.join(root, name))); } catch { res.writeHead(404).end(); } });
  try {
    await bounded(new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }), 2000, "server launch timeout");
    for (const trial of output.trials) {
      let browser, page; trial.startedAt = new Date().toISOString(); trial.events = []; trial.pageErrors = [];
      try {
        trial.events.push("browser_launch_requested");
        const launch = ({ chromium, webkit })[engine].launch({ headless: true });
        launch.then(late => { if (trial.launch === "UNKNOWN") void late.close().catch(() => {}); }, () => {});
        browser = await bounded(launch, limits.launchMs, "browser launch timeout"); trial.launch = "RETURNED"; trial.browserVersion = browser.version(); trial.events.push("browser_launch_returned");
        const context = await bounded(browser.newContext(), limits.contextMs, "context timeout");
        page = await bounded(context.newPage(), limits.contextMs, "page timeout"); page.on("pageerror", e => trial.pageErrors.push(e.message));
        await bounded(page.goto(`http://127.0.0.1:${server.address().port}/`), limits.contextMs, "navigation timeout");
        trial.value = await bounded(trial.kind === "original-primary" ? page.evaluate(() => window.runWorkerStudy()) : page.evaluate(t7Only), trial.kind === "original-primary" ? limits.primaryMs : limits.t7OnlyMs, "trial timeout");
        trial.outcome = trial.value.failure || trial.value.cleanup?.status !== "PASS" || trial.pageErrors.length ? "FAIL" : trial.kind === "original-primary" ? "PARTIAL" : "PASS";
      } catch (error) { trial.error = error.message; trial.outcome = "UNKNOWN"; if (!browser) trial.launch = "UNKNOWN"; if (page) { try { trial.partial = await bounded(page.evaluate(() => window.t7Progress || null), 500, "partial timeout"); } catch { trial.partial = "UNKNOWN"; } } }
      finally {
        if (browser) { trial.events.push("browser_close_requested"); try { await bounded(browser.close(), limits.closeMs, "browser close timeout"); trial.browserClose = "RETURNED"; } catch { trial.browserClose = "UNKNOWN"; } trial.events.push("browser_close_finished"); }
        trial.endedAt = new Date().toISOString();
      }
      if (!["PASS", "PARTIAL"].includes(trial.outcome)) process.exitCode = 1;
      // No new browser is created if previous process lifetime is uncertain.
      if (trial.browserClose !== "RETURNED") { output.stopReason = "browser release boundary unconfirmed; later trial NOT_RUN"; process.exitCode = 1; break; }
    }
  } catch (error) { output.fatal = error.message; process.exitCode = 1; }
  finally { server.closeAllConnections?.(); try { await bounded(new Promise(resolve => server.close(resolve)), 2000, "server close timeout"); } catch { output.serverClose = "UNKNOWN"; process.exitCode = 1; } await save(); }
  // A timed-out Playwright lifecycle may retain handles. Exit after evidence, without claiming resource release.
  if (output.stopReason || output.serverClose === "UNKNOWN") process.exit(1);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
