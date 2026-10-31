"use strict";
const { test, after } = require("node:test"), assert = require("node:assert/strict");
const api = require("./recovery-model.cjs"), { deadlineCases, runDeadlineCase } = require("./stage5-deadline-cases.cjs");
const { metadata, save } = require("./stage5-evidence.cjs");
const results = [];
for (const spec of deadlineCases) test(`review deadline: ${spec.name}`, { timeout: 1500 }, async () => {
  const result = await runDeadlineCase(api, spec); results.push(result);
  assert.deepEqual(result.violations, [], JSON.stringify(result));
});
after(async () => {
  const files = ["recovery-model.cjs", "shared-ledger.js", "stage5-deadline-cases.cjs", "stage5-deadline.test.cjs", "stage5-evidence.cjs"];
  const evidence = { ...await metadata(files.map(f => `experiments/mcp-search-worker-feasibility/${f}`)), baselineCommit: "7e77de239e4a6ee581bb11f60c7a54423b3f201d",
    results, outcome: results.length === deadlineCases.length && results.every(r => !r.violations.length) ? "PASS" : "FAIL" };
  const phase = process.env.STAGE5_DEADLINE_PHASE === "red" ? "red" : "green";
  await save(`deadline-node-${phase}`, evidence);
});
