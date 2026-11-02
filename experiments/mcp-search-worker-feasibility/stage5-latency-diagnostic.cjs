"use strict";
const fs = require("node:fs/promises"), path = require("node:path"), { chromium, webkit } = require("playwright");
const { bounded } = require("./context-harness.cjs");
const { latencyModel, latencyCases, latencySummary, evidenceHeader, saveDiagnostic, hash } = require("./stage5-diagnostic-source.cjs");
const engine = process.env.WORKER_POC_BROWSER || "node";
if (!["node", "chromium", "webkit"].includes(engine)) throw new Error("unsupported engine");
// Exactly two paired comparisons; no retry on failure. The unchanged precursor reproduces the original case order.
const plan = ["original", "instrumented", "instrumented", "original"];
async function executeTrial({ model, cases, mode, trialId }) {
  const events = [], started = performance.now();
  let collecting = false;
  const trace = (event, details = {}) => {
    if (!collecting) return;
    if (events.length >= 256) throw new Error("diagnostic_event_budget");
    const at = performance.now(); events.push({ seq: events.length + 1, trialId, event, at, elapsedMs: at - started, ...details });
  };
  const m = { exports: {} }, c = { exports: {} };
  new Function("module", "trace", model)(m, trace); new Function("module", "trace", cases)(c, trace);
  const warmup = await c.exports.runDeadlineCase(m.exports, c.exports.deadlineCases[0]);
  collecting = true;
  const result = await c.exports.runDeadlineCase(m.exports, c.exports.deadlineCases.find(s => s.name === "reserve-late-duplicate-completion"));
  const completedAt = performance.now();
  return { mode, trialId, clock: "performance.now in this execution realm", timeOrigin: performance.timeOrigin,
    elapsedMs: completedAt - started, warmup, result, events };
}
(async () => {
  const files = ["recovery-model.cjs", "stage5-deadline-cases.cjs", "stage5-latency-diagnostic.cjs", "stage5-diagnostic-source.cjs", "context-harness.cjs", "stage5-evidence.cjs"];
  const source = await fs.readFile(path.join(__dirname, files[0]), "utf8"), cases = await fs.readFile(path.join(__dirname, files[1]), "utf8");
  const transformed = { model: latencyModel(source), cases: latencyCases(cases) };
  const report = { ...await evidenceHeader(files), engine, plan, limits: { requestMs: 60, observationMs: 160, trialMs: 3000, trials: 4, traceEvents: 256 },
    generatedSourceHashes: { model: hash(transformed.model), cases: hash(transformed.cases) },
    trials: [], diagnostic: "PARTIAL", outcome: "FAIL", clockRule: "Never subtract Node and browser absolute clocks; trialId joins event order only." };
  let browser, halt = false;
  try {
    if (engine !== "node") { browser = await ({ chromium, webkit })[engine].launch({ headless: true, timeout: 30000 }); report.browserVersion = browser.version(); }
    for (let i = 0; i < plan.length; i++) {
      const mode = plan[i], trialId = `${engine}-${i + 1}-${mode}`;
      if (halt) { report.trials.push({ trialId, outcome: "NOT_RUN", reason: "previous_close_unknown" }); continue; }
      const input = { mode, trialId, model: mode === "original" ? source : transformed.model, cases: mode === "original" ? cases : transformed.cases };
      const started = performance.now(), controller = [{ event: "invoke", elapsedMs: 0 }]; let context;
      const trial = { trialId, mode, order: i + 1, controllerClock: "Node performance.now", controller, pageerrors: [] }; report.trials.push(trial);
      try {
        if (browser) {
          context = await browser.newContext(); const page = await context.newPage();
          page.on("pageerror", e => trial.pageerrors.push({ name: e.name, message: e.message }));
          // Independent about:blank context; no application origin or storage.
          const value = await bounded(page.evaluate(executeTrial, input), 3000, "diagnostic_trial_timeout"); Object.assign(trial, value);
        } else Object.assign(trial, await bounded(executeTrial(input), 3000, "diagnostic_trial_timeout"));
        controller.push({ event: "returned", elapsedMs: performance.now() - started });
        trial.intervals = mode === "instrumented" ? latencySummary(trial.events) : { classification: "NOT_TESTED", reason: "original_uninstrumented_control" };
        trial.outcome = trial.result.violations.length || trial.warmup.violations.length || trial.pageerrors.length ? "FAIL" : "PASS";
      } catch (e) { trial.outcome = "FAIL"; trial.error = e.message; }
      finally {
        if (context) try { await bounded(context.close(), 5000, "context_close_timeout"); trial.contextClose = "RETURNED"; }
        catch { trial.contextClose = "UNKNOWN"; halt = true; }
      }
    }
    report.diagnostic = report.trials.every(t => t.result && !t.pageerrors.length && (t.mode !== "instrumented" || t.intervals.classification === "INTERVALS_OBSERVED")) ? "PASS" : "PARTIAL";
    report.outcome = report.trials.every(t => t.outcome === "PASS") ? "PASS" : "FAIL";
  } catch (e) { report.error = e.message; }
  finally {
    if (browser) try { await bounded(browser.close(), 5000, "browser_close_timeout"); report.browserClose = "RETURNED"; }
    catch { report.browserClose = "UNKNOWN"; report.diagnostic = "PARTIAL"; report.outcome = "FAIL"; }
    await saveDiagnostic(`latency-${engine}`, report);
    if (report.outcome !== "PASS" || report.diagnostic !== "PASS") process.exitCode = 1;
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
