"use strict";
// Finite comparison; raw product exits are retained, including expected legacy RED.
const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const { evaluateSafety } = require("./note-conflict-acceptance.cjs");
const output = path.resolve("e2e-artifacts/issue436"); fs.mkdirSync(output, { recursive: true });
const summary = { platform: process.platform, startedAt: new Date().toISOString(), cases: [] };
for (const engine of ["webkit", "chromium"]) for (const variant of ["fixed", "old"]) {
  const dir = path.join(output, `${process.platform}-${variant}-${engine}-deep`);
  const run = spawnSync(process.execPath, ["issue436-startup-diagnostic.cjs", engine, variant, "deep"], {
    cwd: __dirname, env: { ...process.env, I436_OUTPUT: dir }, encoding: "utf8", timeout: 240000, windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(output, `${variant}-${engine}-supervisor.log`), (run.stdout || "") + (run.stderr || ""));
  const row = { engine, variant, childExit: run.status, signal: run.signal, error: run.error?.message,
    productAcceptance: "NOT_TESTED", comparison: "INCOMPLETE", directory: path.relative(output, dir) };
  try {
    const report = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
    const result = report.cases[0]; row.productAcceptance = report.status;
    if (!run.error && !run.signal && run.status === 0 && variant === "fixed" && report.status === "PASS"
      && report.cases.length === 1 && result.status === "PASS" && result.evidence.execution.completed) row.comparison = "FIXED_SCOPE_COMPLETE";
    if (variant === "old" && !run.error && !run.signal && run.status === 1 && report.cases.length === 1 && !result.error
      && result.evidence?.execution.completed && evaluateSafety(result.evidence).lossDemonstrated === true) row.comparison = "LEGACY_RED_ESTABLISHED";
  } catch (e) { row.readError = e.message; }
  summary.cases.push(row); fs.writeFileSync(path.join(output, "comparison.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(row));
}
summary.finishedAt = new Date().toISOString();
summary.status = summary.cases.every(x => x.comparison !== "INCOMPLETE") ? "COMPARISON_COMPLETE" : "PARTIAL";
fs.writeFileSync(path.join(output, "comparison.json"), JSON.stringify(summary, null, 2) + "\n");
if (summary.status !== "COMPARISON_COMPLETE") process.exitCode = 1;
