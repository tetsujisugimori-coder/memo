"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto"), zlib = require("node:zlib");
const { buildF } = require("./source.cjs"), { waitForTransactionComplete } = require("./wait.cjs"), { analyze } = require("./analyze.cjs");
const root = path.resolve(__dirname, "../.."), prior = path.join(root, "experiments/idb-upgrade-lifecycle"), original = path.join(root, "experiments/mcp-search-worker-feasibility");
const read = p => fs.readFileSync(p, "utf8"), hash = b => crypto.createHash("sha256").update(b).digest("hex");
test("F restores exactly D; main suite, all original closes and handlers are preserved", () => {
  const worker = read(path.join(original, "worker.js"));
  const g = buildF(read(path.join(original, "suite.js")), worker, read(path.join(prior, "observer.js")));
  new vm.Script(g.suite); new vm.Script(g.worker);
  assert.equal(g.suite, g.baselineSuite);
  let restored = g.worker.slice(g.prefix.length);
  for (const c of [...g.changes].reverse()) { assert.equal(restored.split(c.after).length, 2); restored = restored.replace(c.after, c.before); }
  assert.equal(restored, g.baselineWorker);
  assert.equal(g.changes.length, 3);
  assert.equal((g.worker.match(/db\.close\(\)/g) || []).length, (g.baselineWorker.match(/db\.close\(\)/g) || []).length);
  assert.ok(g.worker.includes(worker.match(/  db.onversionchange = .*;/)[0]));
  assert.ok(g.worker.endsWith(worker.slice(worker.lastIndexOf("  } catch (error)"))));
  assert.ok(!g.worker.includes("cooperative_ack"));
  for (const [file, source] of [["suite", g.baselineSuite], ["worker", g.baselineWorker]]) {
    const saved = zlib.gunzipSync(fs.readFileSync(path.join(prior, `evidence/generated-D-${file}.js.gz`))).toString();
    assert.equal(source.replaceAll("\r\n", "\n"), saved);
  }
});
test("original files and prior observation sources equal the previous evidence hashes (canonical LF)", () => {
  const index = JSON.parse(read(path.join(prior, "evidence/index.json")));
  for (const [file, expected] of Object.entries(index.sourceChecks)) assert.equal(hash(read(path.join(root, file)).replaceAll("\r\n", "\n")), expected.sha256, file);
});
test("all previous raw evidence remains verifiable without running any browser", () => {
  const index = JSON.parse(read(path.join(prior, "evidence/index.json")));
  const items = Object.values(index).find(v => Array.isArray(v) && v[0]?.gzipSha256);
  assert.ok(items?.length);
  for (const item of items) { const b = fs.readFileSync(path.join(prior, "evidence", item.file)); assert.equal(hash(b), item.gzipSha256); assert.equal(hash(zlib.gunzipSync(b)), item.rawSha256); }
});
function fixture() {
  const tx = new EventTarget(), events = [], state = { transactionId: "w/tx1", terminal: "UNKNOWN" }, errors = new Set();
  const life = { state: { transactions: [state] }, log: (event, detail) => events.push({ event, ...detail }) };
  let finish; const done = new Promise(r => { finish = r; });
  return { tx, state, errors, events, wait: () => waitForTransactionComplete(done, tx, life, errors), finish };
}
test("only observed complete releases wait; existing handlers are not replaced", async () => {
  const f = fixture(), handler = () => {}; f.tx.onerror = handler;
  let released = false; const waiting = f.wait().then(() => { released = true; });
  await Promise.resolve(); assert.equal(released, false); assert.equal(f.events.length, 1);
  f.state.terminal = "complete"; f.finish("complete"); await waiting;
  assert.equal(f.events.at(-1).outcome, "complete"); assert.equal(f.tx.onerror, handler);
});
test("abort, unobserved complete, prior error, and error followed by complete all reject", async () => {
  for (const mode of ["abort", "unobserved", "prior_error", "later_error"]) {
    const f = fixture(); if (mode === "prior_error") f.errors.add("w/tx1");
    const waiting = f.wait(), rejected = assert.rejects(waiting, /F_transaction_/);
    if (mode === "later_error") f.tx.dispatchEvent(new Event("error"));
    if (mode !== "unobserved") f.state.terminal = mode === "abort" ? "abort" : "complete";
    f.finish(mode === "abort" ? "abort" : "complete"); await rejected;
    assert.notEqual(f.events.at(-1).outcome, "complete");
  }
});
test("unknown/missing condition or upgrade failure never passes CI classifier", () => {
  for (const value of [{}, { value: { cleanup: { status: "PASS" }, failure: "upgrade timeout" }, events: [] }]) {
    const a = analyze({ runId: "r", value, precleanupSaved: true, contextClose: "RETURNED", browserClose: "RETURNED" });
    assert.equal(a.execution, "FAIL"); assert.equal(a.condition, "UNKNOWN");
  }
});
test("twelve causal sequences pass; missing complete, timeout, cleanup UNKNOWN and page errors fail", () => {
  const events = [];
  for (let iteration = 1; iteration <= 12; iteration++) {
    const owner = `w${iteration}`;
    const add = (event, source, extra = {}) => events.push({ event, source, owner: source, iteration, clockDomain: `r/${source}`, sourceSeq: events.length + 1, receiveSeq: events.length + 1, dbName: "dummy", ...extra });
    for (const event of ["getAll_success", "transaction_wait_start", "transaction_complete", "transaction_wait_end", "unresolved_send"]) add(event, owner, { outcome: event === "transaction_wait_end" ? "complete" : "OBSERVED" });
    add("worker_message_received", "main", { owner, workerEvent: "unresolved" });
    for (const event of ["worker_stop_requested", "worker_terminate_called", "worker_terminate_returned"]) add(event, "main");
    add("open_start", "main", { requestId: `main/r${iteration}`, requestedVersion: iteration + 1 });
    add("open_success", "main", { requestId: `main/r${iteration}` });
  }
  const good = { runId: "r", value: { events, value: { cleanup: { status: "PASS" } } }, precleanupSaved: true, contextClose: "RETURNED", browserClose: "RETURNED", pageErrors: [] };
  assert.equal(analyze(good).execution, "PASS");
  for (const mode of ["missing", "timeout", "cleanup", "page"]) {
    const t = structuredClone(good);
    if (mode === "missing") t.value.events = t.value.events.filter(e => !(e.iteration === 2 && e.event === "transaction_complete"));
    if (mode === "timeout") t.value.events.find(e => e.iteration === 2 && e.event === "open_success").event = "upgrade_timeout";
    if (mode === "cleanup") t.value.value.cleanup.status = "UNKNOWN";
    if (mode === "page") t.pageErrors.push("instrumentation error");
    assert.equal(analyze(t).execution, "FAIL", mode);
  }
});
test("only one browser launch, no prior runner, no retry, bounded isolated F workflow", () => {
  const runner = read(path.join(__dirname, "run.cjs")), workflow = read(path.join(root, ".github/workflows/idb-transaction-complete-only.yml"));
  assert.equal((runner.match(/webkit\.launch\(/g) || []).length, 1);
  assert.ok(!runner.includes('require("../idb-upgrade-lifecycle/run.cjs")'));
  assert.ok(runner.includes('GITHUB_RUN_ATTEMPT !== "1"'));
  assert.ok(runner.includes('if (report.outcome !== "PASS") process.exitCode = 1'));
  assert.ok(runner.includes('flag: "wx"'));
  assert.ok(!workflow.includes("continue-on-error")); assert.ok(!workflow.includes("idb-upgrade-lifecycle/run.cjs"));
  assert.equal((workflow.match(/node experiments\/idb-transaction-complete-only\/run.cjs/g) || []).length, 1);
  assert.ok(!workflow.includes("workflow_dispatch"));
});
