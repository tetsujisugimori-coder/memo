"use strict";
const fs = require("node:fs"), path = require("node:path");
function validateHistory(data, runId, sha) {
  if (data.total_count !== 1 || data.workflow_runs.length !== 1) throw new Error("G history is not exactly one run; no further trial permitted");
  const current = data.workflow_runs[0];
  if (String(current.id) !== String(runId) || current.head_sha !== sha || current.run_attempt !== 1 || current.head_branch !== "investigate/idb-time-delay-only") throw new Error("G run identity/attempt mismatch");
}
async function reserveHistory() {
  const { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: runId, GITHUB_SHA: sha, GITHUB_TOKEN: token, GITHUB_RUN_ATTEMPT: attempt } = process.env;
  if (repo !== "tetsujisugimori-coder/memo" || !runId || !sha || !token || attempt !== "1") throw new Error("G requires first GitHub run with authenticated history check");
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/idb-time-delay-only.yml/runs?per_page=100`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`G history unavailable: ${response.status}`);
  const data = await response.json(); validateHistory(data, runId, sha);
  const dir = path.resolve(__dirname, "../../e2e-artifacts/idb-time-delay-only"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "github-history.json"), JSON.stringify({ checkedAtJST: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }) + " JST", runId, sha, data }, null, 2) + "\n", { flag: "wx" });
  return { runId, sha, total_count: data.total_count };
}
module.exports = { validateHistory, reserveHistory };
