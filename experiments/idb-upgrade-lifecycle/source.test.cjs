"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { build } = require("./source.cjs"), { installLifecycleObserver } = require("./observer.js");
const base = path.resolve(__dirname, "../mcp-search-worker-feasibility"), read = n => fs.readFileSync(path.join(base, n), "utf8");
for (const [condition, cooperative, noWorker] of [["C", false, true], ["D", false, false], ["E", true, false]]) test(`generated ${condition} restores original sources and parses`, () => {
  const suite = read("suite.js"), worker = read("worker.js"), observer = fs.readFileSync(path.join(__dirname, "observer.js"), "utf8");
  const g = build(suite, worker, observer, cooperative, noWorker); new vm.Script(g.suite); new vm.Script(g.worker);
  let s = g.suite, w = g.worker.slice(g.workerPrefix.length);
  for (const c of [...g.changes].reverse()) if (c.file === "suite.js") s = s.replace(c.after, c.before); else w = w.replace(c.after, c.before);
  assert.equal(s, suite); assert.equal(w, worker);
  assert.ok(g.suite.includes('await window.__saveBeforeCleanup('));
  assert.equal(g.worker.includes('const terminal = await transactionDone'), cooperative);
});
test("observer preserves handlers, issues no additional IDB calls, and never claims normal closure", () => {
  let calls = 0, closes = 0; const records = [];
  class Database extends EventTarget {
    constructor() { super(); this.name = "dummy"; this.version = 1; }
    transaction() { return Object.assign(new EventTarget(), { mode: "readonly", error: null }); }
    close() { closes++; }
  }
  class Factory { open() { calls++; return new EventTarget(); } deleteDatabase() { calls++; return new EventTarget(); } }
  const scope = { IDBFactory: Factory, IDBDatabase: Database, performance, initial: { runId: "r", owner: "main" }, emit: e => records.push(e) };
  vm.runInNewContext(`(${installLifecycleObserver.toString()})(emit,initial)`, scope);
  const factory = new Factory(), req = factory.open("dummy", 1), db = new Database(); req.result = db;
  const handler = () => {}; req.onsuccess = handler; req.dispatchEvent(new Event("success"));
  assert.equal(req.onsuccess, handler); assert.equal(calls, 1); assert.equal(closes, 0);
  const tx = db.transaction("notes", "readonly"); tx.dispatchEvent(new Event("complete")); db.close();
  assert.equal(closes, 1); assert.equal(calls, 1);
  assert.ok(records.some(e => e.event === "transaction_complete"));
  assert.ok(records.some(e => e.event === "close_returned" && e.connectionClosed === "UNKNOWN" && e.physicalRelease === "UNKNOWN"));
  assert.equal(records.some(e => e.event === "connection_closed"), false);
  assert.ok(records.every(e => e.clockDomain === "r/main"));
});
test("source drift rejects instrumentation before any browser trial", () => assert.throws(() => build("changed", "changed", "", false, false), /anchor count/));
