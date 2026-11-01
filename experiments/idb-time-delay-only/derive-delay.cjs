"use strict";
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib"), crypto = require("node:crypto"), assert = require("node:assert/strict");
function derive() {
  const dir = path.resolve(__dirname, "../idb-transaction-complete-only/evidence"), gz = fs.readFileSync(path.join(dir, "results.json.gz")), raw = zlib.gunzipSync(gz);
  const hash = b => crypto.createHash("sha256").update(b).digest("hex"), index = JSON.parse(fs.readFileSync(path.join(dir, "index.json")));
  const expected = index.files.find(f => f.file === "results.json.gz"); assert.equal(hash(gz), expected.sha256); assert.equal(hash(raw), expected.rawSha256);
  const report = JSON.parse(raw), trial = report.trials[0];
  assert.equal(report.testedCommit, "6b25f7ecf1d3b290958556708fee9899f188c5f2"); assert.equal(trial.condition, "F");
  const rows = Array.from({ length: 12 }, (_, i) => {
    const ev = trial.value.events.filter(e => e.iteration === i + 1 && e.source !== "main"), gets = ev.filter(e => e.event === "getAll_success"), sends = ev.filter(e => e.event === "unresolved_send");
    assert.equal(gets.length, 1); assert.equal(sends.length, 1); const a = gets[0], b = sends[0];
    for (const field of ["runId", "dbName", "clockDomain", "source", "connectionId", "requestId", "transactionId"]) assert.equal(a[field], b[field]);
    assert.ok(a.sourceSeq < b.sourceSeq && b.sourceMs >= a.sourceMs && Number.isFinite(a.sourceMs) && Number.isFinite(b.sourceMs));
    return { iteration: i + 1, workerId: a.source, clockDomain: a.clockDomain, connectionId: a.connectionId, requestId: a.requestId, transactionId: a.transactionId,
      getAllMs: a.sourceMs, sendMs: b.sourceMs, getAllSourceSeq: a.sourceSeq, sendSourceSeq: b.sourceSeq, deltaMs: b.sourceMs - a.sourceMs };
  });
  const sorted = rows.map(r => r.deltaMs).sort((a,b) => a-b), medianMs = (sorted[5]+sorted[6])/2;
  // A zero median would leave the typical interval unresolved at the recorded clock precision.
  const measurable = medianMs > 0;
  return { baselineCommit: "105d80a467e96aa7038052f501c4a1776a6e69bb", testedFCommit: report.testedCommit, testedFTree: report.tree,
    runId: trial.runId, dbName: trial.dbName, browser: trial.browserVersion, rawSha256: hash(raw), gzipSha256: hash(gz), rows, medianMs,
    formula: "min(100, max(1, ceil(medianMs)))", delayMs: measurable ? Math.min(100, Math.max(1, Math.ceil(medianMs))) : null,
    eligibility: measurable ? "PASS" : "PARTIAL", zeroSamples: rows.filter(r=>r.deltaMs===0).length,
    limits: "Integer-ms recorded timestamps; zero differences do not establish zero elapsed time. Exact clock resolution and sub-ms intervals UNKNOWN. Nine nonzero samples and a nonzero median permit the requested ms-level candidate; no interpolation or cross-clock subtraction." };
}
if (require.main === module) process.stdout.write(JSON.stringify(derive(), null, 2) + "\n");
module.exports = { derive };
