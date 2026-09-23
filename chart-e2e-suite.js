"use strict";

const { spawnSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");

const started = performance.now();
let failed = false;
for (const script of ["chart-block.e2e.js", "chart-file-export.e2e.js"]) {
  console.log(`[START] Chart E2E script ${script}`);
  const result = spawnSync(process.execPath, [script], { cwd: __dirname, env: process.env, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.error(`[FAIL] Chart E2E script ${script}: ${result.error || `exit ${result.status}`}`);
    failed = true;
    break;
  }
  console.log(`[PASS] Chart E2E script ${script}`);
}
console.log(`[TOTAL] Chart E2E all scripts ${((performance.now() - started) / 1000).toFixed(1)}s`);
if (failed) process.exitCode = 1;
