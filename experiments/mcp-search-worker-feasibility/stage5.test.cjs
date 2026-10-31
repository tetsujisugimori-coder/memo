"use strict";
const nodeTest = require("node:test"), assert = require("node:assert/strict");
const test = (name, fn) => nodeTest(name, { timeout: 1500 }, fn);
const { createRecoveryModel, createSharedRecoveryModel } = require("./recovery-model.cjs");
function fixture(extra = {}) {
  let wall = 100, mono = 0, worker, creates = 0;
  const model = createRecoveryModel({ maxWorkers: 2, now: () => wall, monotonic: () => mono,
    schedule: fn => { const timer = setTimeout(fn, 1000); timer.unref(); return timer; },
    createWorker: () => { creates++; return worker = { postMessage(m) { this.message = m; }, terminate() {} }; }, ...extra });
  model.setSession("a", 200);
  return { model, get worker() { return worker; }, get creates() { return creates; }, advance(n) { wall += n; mono += n; }, rollback(n) { wall -= n; } };
}
test("Stage5 delivery rechecks permission after terminate returns", async () => {
  const f = fixture(), pending = f.model.start("read", 1000);
  f.worker.terminate = () => f.advance(100);
  f.worker.onmessage({ data: { ...f.worker.message, value: "expired" } });
  assert.equal((await pending).status, "session_expired");
});
test("Stage5 reentrant start while terminate executes cannot allocate", async () => {
  const f = fixture(), pending = f.model.start("read", 1000); let nested;
  f.worker.terminate = () => { nested = f.model.start("search", 1); };
  f.worker.onmessage({ data: { ...f.worker.message, value: "valid" } });
  assert.equal(f.creates, 1); assert.equal((await nested).status, "busy");
  assert.equal((await pending).status, "result");
});
test("Stage5 cancellation permanently retires that grant identity", async () => {
  const f = fixture(), pending = f.model.start("search", 1000), reply = f.worker.onmessage;
  f.model.cancel(); reply({ data: { ...f.worker.message, value: "cancelled" } });
  assert.equal((await pending).status, "cancelled");
  assert.throws(() => f.model.setSession("a", 1000), /retired_session/);
  assert.equal((await f.model.start("read", 10)).status, "session_expired");
});
test("Stage5 permission lifetime is not extended by wall clock rollback", async () => {
  const f = fixture(), pending = f.model.start("read", 1000);
  f.advance(100); f.rollback(1000);
  f.worker.onmessage({ data: { ...f.worker.message, value: "expired" } });
  assert.equal((await pending).status, "session_expired");
});
test("Stage5 request identity and generation reject duplicate or old delivery", async () => {
  const f = fixture(), first = f.model.start("read", 1000, "same"), old = f.worker, receive = old.onmessage;
  receive({ data: { ...old.message, value: "first" } }); assert.equal((await first).status, "result");
  assert.equal((await f.model.start("read", 1000, "same")).status, "duplicate_request");
  f.model.setSession("b", 1000); const next = f.model.start("read", 1000, "new"), fresh = f.worker;
  fresh.onmessage({ data: { ...fresh.message, generation: old.message.generation, value: "wrong" } });
  receive({ data: { ...old.message, value: "late" } });
  fresh.onmessage({ data: { ...fresh.message, value: "fresh" } });
  assert.deepEqual(await next, { status: "result", value: "fresh" });
});
test("Stage5 terminate exception latches failure even when a second slot exists", async () => {
  const f = fixture(), pending = f.model.start("read", 1000);
  f.worker.terminate = () => { throw new Error("injected_terminate"); };
  f.worker.onmessage({ data: { ...f.worker.message, value: "discard" } });
  assert.equal((await pending).status, "worker_stop_unknown");
  f.model.setSession("b", 1000);
  assert.equal((await f.model.start("read", 10)).status, "failed_closed"); assert.equal(f.creates, 1);
  assert.equal(f.model.state().admission, "FAILED_CLOSED");
});
test("Stage5 cancelled asynchronous reservation cannot create a Worker", async () => {
  let reserve, creates = 0, released = 0;
  const ledger = { reserve: () => new Promise(r => { reserve = r; }), releaseReserved: async () => { released++; }, transition: async () => { throw new Error("must_not_transition"); } };
  const model = createSharedRecoveryModel({ ledger, name: "fixture", owner: "owner", maxWorkers: 2, createWorker: () => { creates++; } });
  model.setSession("a", Date.now() + 10000); const pending = model.start("search", 1000);
  model.cancel(); reserve({ status: "reserved", id: "r" });
  assert.equal((await pending).status, "session_changed"); assert.equal(creates, 0); assert.equal(released, 1);
});
test("Stage5 ledger failure is sticky and creates nothing", async () => {
  let attempts = 0, creates = 0;
  const model = createSharedRecoveryModel({ ledger: { reserve: async () => { attempts++; throw new Error("ledger_invalid"); } }, name: "fixture", owner: "owner", maxWorkers: 2, createWorker: () => { creates++; } });
  model.setSession("a", Date.now() + 10000);
  assert.equal((await model.start("read", 1000)).status, "failed_closed");
  model.setSession("b", Date.now() + 10000);
  assert.equal((await model.start("read", 1000)).status, "failed_closed");
  assert.equal(attempts, 1); assert.equal(creates, 0);
});
test("Stage5 permission expiring during final ledger commit cannot be delivered", async () => {
  let wall = 100;
  const ledger = { reserve: async () => ({ status: "reserved", id: "r" }),
    transition: async (_n, _c, _o, _i, next) => { if (next === "unknown") wall = 200; } };
  const model = createSharedRecoveryModel({ ledger, name: "fixture", owner: "owner", now: () => wall,
    createWorker: () => ({ postMessage(m) { this.onmessage({ data: { ...m, value: "expired" } }); }, terminate() {} }) });
  model.setSession("a", 200);
  assert.equal((await model.start("read", 1000)).status, "session_expired");
  assert.equal(model.state().history[0].coreResolved, true);
  assert.equal(model.state().history[0].delivered, false);
});
test("Stage5 reservation wait consumes the request deadline without creating a Worker", async () => {
  let elapsed = 0, released = 0, created = 0;
  const ledger = { reserve: async () => { elapsed = 10; return { status: "reserved", id: "r" }; },
    releaseReserved: async () => { released++; }, transition: async () => { throw new Error("must_not_start"); } };
  const model = createSharedRecoveryModel({ ledger, name: "fixture", owner: "owner", monotonic: () => elapsed,
    createWorker: () => { created++; } }); model.setSession("a", Date.now() + 10000);
  assert.equal((await model.start("read", 10)).status, "timeout"); assert.equal(released, 1); assert.equal(created, 0);
});
