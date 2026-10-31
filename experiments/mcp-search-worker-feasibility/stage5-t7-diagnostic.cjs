"use strict";
const fs = require("node:fs/promises"), path = require("node:path"), http = require("node:http");
const { chromium, webkit } = require("playwright"), { bounded } = require("./context-harness.cjs");
const { replaceOnce, evidenceHeader, saveDiagnostic, hash } = require("./stage5-diagnostic-source.cjs");
const engine = process.env.WORKER_POC_BROWSER || "webkit";
if (!["chromium", "webkit"].includes(engine)) throw new Error("unsupported engine");
const smoke = process.env.STAGE5_DIAG_SMOKE === "1";
const plan = smoke ? ["observed-primary"] : ["original-primary", "observed-primary", "observed-complete"];
const served = ["index.html", "suite.js", "worker.js", "cleanup.js", "controls.js", "diagnostic.js", "diagnostic-plan.js", "diagnostic-worker.js"];
(async () => {
  const sources = Object.fromEntries(await Promise.all(served.map(async f => [f, await fs.readFile(path.join(__dirname, f), "utf8")])));
  const observer = await fs.readFile(path.join(__dirname, "stage5-idb-observer.js"), "utf8");
  const workerPrefix = `${observer}\nlet diagnosticWorkerId="unidentified"; addEventListener("message",e=>{if(e.data.workerId)diagnosticWorkerId=e.data.workerId;});\ninstallStage5IdbObserver(e=>postMessage({__stage5IdbTrace:e}),()=>diagnosticWorkerId);\n`;
  const tracedSuite = replaceOnce(sources["suite.js"], 'worker.onmessage = ({ data }) => receive(session, entry, data, "worker");',
    'worker.onmessage = ({ data }) => { if(data.__stage5IdbTrace) { window.__stage5RecordIdb(data.__stage5IdbTrace); return; } receive(session, entry, data, "worker"); };');
  const completeWorker = replaceOnce(sources["worker.js"], 'if (mode === "unresolved") { send("unresolved");',
    'if (mode === "unresolved") { if (testId === "T7" && await transactionDone !== "complete") throw new Error("fixture_transaction_failed"); send("unresolved");');
  const variants = Object.fromEntries(plan.map(v => [v, { ...sources,
    "suite.js": v === "original-primary" ? sources["suite.js"] : tracedSuite,
    "worker.js": v === "original-primary" ? sources["worker.js"] : workerPrefix + (v === "observed-complete" ? completeWorker : sources["worker.js"]) }]));
  const report = { ...await evidenceHeader([...served, "stage5-t7-diagnostic.cjs", "stage5-idb-observer.js", "stage5-diagnostic-source.cjs", "context-harness.cjs"]), engine, smoke, plan,
    limits: { runsPerCondition: 1, maxT7Iterations: 12, primaryMs: 180000, openMs: 8000, cleanupMs: 2000, closeMs: 5000, maxTraceEvents: 4096 },
    generatedSourceHashes: Object.fromEntries(plan.map(v => [v, { suite: hash(variants[v]["suite.js"]), worker: hash(variants[v]["worker.js"]) }])),
    trials: [], diagnostic: "PARTIAL", outcome: "FAIL", clockRule: "mainMs, worker sourceMs and Node elapsedMs have independent origins; correlate IDs/sequence, never subtract origins" };
  const server = http.createServer((req, res) => {
    const [variant, file = "index.html"] = new URL(req.url, "http://fixture.invalid").pathname.slice(1).split("/");
    if (!plan.includes(variant) || !served.includes(file)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": file.endsWith("html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-store" }); res.end(variants[variant][file]);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  let halt = false;
  try {
    for (let i = 0; i < plan.length; i++) {
      const variant = plan[i], trial = { variant, order: i + 1, outcome: "NOT_RUN", contextClose: "NOT_RUN", browserClose: "NOT_RUN", pageerrors: [], controller: [] }; report.trials.push(trial);
      if (halt) { trial.reason = "previous_close_unknown"; continue; }
      const started = performance.now(), log = event => trial.controller.push({ event, elapsedMs: performance.now() - started });
      let browser, context, page;
      try {
        log("browser_launch_start"); browser = await ({ chromium, webkit })[engine].launch({ headless: true, timeout: 30000 }); log("browser_launch_return"); report.browserVersion = browser.version();
        context = await bounded(browser.newContext(), 8000, "context_create_timeout"); page = await bounded(context.newPage(), 8000, "page_create_timeout");
        page.on("pageerror", e => trial.pageerrors.push({ name: e.name, message: e.message }));
        if (variant !== "original-primary") await page.addInitScript({ content: `${observer}\nwindow.__stage5IdbEvents=[];window.__stage5Overflow=false;window.__stage5RecordIdb=e=>{if(__stage5IdbEvents.length>=4096){window.__stage5Overflow=true;return;} __stage5IdbEvents.push({...e,receiveSeq:__stage5IdbEvents.length+1,receivedMainMs:performance.now()});};installStage5IdbObserver(window.__stage5RecordIdb,()=>"main");` });
        await page.goto(`http://127.0.0.1:${server.address().port}/${variant}/index.html`, { timeout: 8000 });
        log("primary_start"); trial.primary = await bounded(page.evaluate(() => runWorkerStudy()), 180000, "primary_timeout"); log("primary_return");
        if (variant !== "original-primary") {
          const observed = await bounded(page.evaluate(() => ({ events: window.__stage5IdbEvents, overflow: window.__stage5Overflow })), 3000, "trace_read_timeout");
          trial.idbEvents = observed.events; trial.traceOverflow = observed.overflow;
          const opens = observed.events.filter(e => e.event === "open_call");
          trial.requests = opens.map(open => {
            const events = observed.events.filter(e => e.requestId === open.requestId && e.source === open.source);
            return { source: open.source, requestId: open.requestId, dbName: open.dbName, requestedVersion: open.requestedVersion,
              observedEvents: events.map(e => e.event), unobserved: ["open_upgradeneeded", "open_blocked", "open_success", "open_error"].filter(event => !events.some(e => e.event === event)),
              interpretation: "UNOBSERVED is not proof the event never occurred; worker telemetry may be terminated before receipt" };
          });
          trial.dbNames = [...new Set(observed.events.map(e => e.dbName).filter(Boolean))];
        }
        trial.outcome = trial.primary.failure || trial.primary.cleanup?.status !== "PASS" || trial.pageerrors.length || trial.traceOverflow ? "FAIL" : "PARTIAL";
      } catch (e) { trial.error = e.message; trial.outcome = "FAIL"; }
      finally {
        if (context) { log("context_close_start"); try { await bounded(context.close(), 5000, "context_close_timeout"); trial.contextClose = "RETURNED"; } catch { trial.contextClose = "UNKNOWN"; halt = true; } log("context_close_end"); }
        if (browser) { log("browser_close_start"); try { await bounded(browser.close(), 5000, "browser_close_timeout"); trial.browserClose = "RETURNED"; } catch { trial.browserClose = "UNKNOWN"; halt = true; } log("browser_close_end"); }
        else { halt = true; trial.browserClose = "UNKNOWN"; }
      }
    }
    report.diagnostic = report.trials.every(t => t.primary && !t.traceOverflow && !t.pageerrors.length && t.browserClose === "RETURNED" && t.contextClose === "RETURNED" && (t.variant === "original-primary" || t.idbEvents?.length)) ? "PASS" : "PARTIAL";
    report.outcome = report.trials.some(t => t.outcome === "FAIL" || t.outcome === "NOT_RUN") ? "FAIL" : "PARTIAL";
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await saveDiagnostic(`t7-diagnostic-${engine}`, report); }
  if (report.outcome === "FAIL" || report.diagnostic !== "PASS") process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
