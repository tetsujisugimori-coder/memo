"use strict";
// Stage #436-B bounded ABBA comparison, fixed product sources only.
// Diagnostic completion and product acceptance are separate; failed app runs stay failed.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const branchModes = [
  { name: "baseline-1", trace: false },
  { name: "trace-1", trace: true },
  { name: "trace-2", trace: true },
  { name: "baseline-2", trace: false },
];
const engine = process.argv[2] || "webkit";
if (!["webkit", "chromium"].includes(engine)) throw new Error("Expected webkit or chromium");
const root = path.resolve(process.env.I436B_OUTPUT || "e2e-artifacts/issue436b");
fs.mkdirSync(root, { recursive: true });
if (fs.existsSync(path.join(root, "summary.json"))) throw new Error("Choose an unused I436B_OUTPUT; prior evidence is immutable");
const summary = { schema: "issue436b-abba-v1", engine, sourceHead: "478d8b3ea59b242e4ddd5cc82e12b44169223047",
  platform: process.platform, started: new Date().toISOString(), cases: [],
  allProductPASS: false, rootCause: "UNKNOWN", windowsLocalReacceptance: "NOT_TESTED",
  note: "Baseline is the existing passive Issue436 diagnostic, not zero-instrumentation. Traced adds in-memory timing; neither is timing-neutral." };
for (const option of branchModes) {
  const output = path.join(root, option.name);
  const env = { ...process.env, I436_OUTPUT: output, I436B_TELEMETRY: option.trace ? "1" : "0", I436B_MODE: "full" };
  const child = spawnSync(process.execPath, ["issue436-startup-diagnostic.cjs", engine, "fixed"], {
    cwd: __dirname, env, encoding: "utf8", timeout: 190000,
    maxBuffer: 16 * 1024 * 1024, windowsHide: true
  });
  fs.writeFileSync(path.join(root, option.name + "-supervisor.log"), (child.stdout || "") + "\n" + (child.stderr || ""));
  const row = { ...option, originalExit: child.status, originalSignal: child.signal,
    supervisionError: child.error?.message || null, originalProductAcceptance: "NOT_TESTED", evidence: "INCOMPLETE" };
  try {
    const report = JSON.parse(fs.readFileSync(path.join(output, "results.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
    row.originalProductAcceptance = report.status;
    row.childExpired = manifest.expired;
    row.executionCompleted = report.cases?.[0]?.evidence?.execution?.completed === true;
    row.sourceVerified = manifest.sourceVerified === true && manifest.sourceHead === summary.sourceHead;
    row.telemetryStatus = option.trace ? "MISSING" : "NOT_REQUESTED";
    if (option.trace) {
      const trace = JSON.parse(fs.readFileSync(path.join(output, "stage436b-telemetry.json"), "utf8"));
      if (trace.schema !== "issue436b-telemetry-v1" || trace.mode !== "full") throw new Error("Invalid telemetry schema");
      row.telemetryStatus = "CAPTURED";
      row.traceSummary = trace.summary;
      row.truncatedEvents = trace.droppedEvents;
    }
    // Product FAIL is a real observation, not diagnostic test success or legacy RED.
    if (!child.error && !child.signal && !manifest.expired && row.sourceVerified &&
        (child.status === 0 || child.status === 1) && report.cases?.length === 1 &&
        (!option.trace || row.telemetryStatus === "CAPTURED")) row.evidence = "COMPLETE";
  } catch (error) { row.readError = error.message; }
  summary.cases.push(row);
  fs.writeFileSync(path.join(root, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ mode: row.name, exit: row.originalExit, product: row.originalProductAcceptance,
    evidence: row.evidence, trace: row.telemetryStatus, error: row.readError || row.supervisionError }));
}
summary.finished = new Date().toISOString();
summary.diagnosticStatus = summary.cases.length === branchModes.length &&
  summary.cases.every(row => row.evidence === "COMPLETE") ? "COMPLETE" : "PARTIAL";
summary.allProductPASS = summary.cases.every(row => row.originalProductAcceptance === "PASS" &&
  row.executionCompleted && row.originalExit === 0);
summary.causalAttribution = "UNKNOWN: separate page/Node clock domains, non-randomized host conditions and small sample";
fs.writeFileSync(path.join(root, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
if (summary.diagnosticStatus !== "COMPLETE") process.exitCode = 1;
