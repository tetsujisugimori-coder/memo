"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRecoveryModel } = require("./recovery-model.cjs");

function fixture(maxWorkers = 2) {
  let time = 100, elapsed = 0, timers = [], workers = [];
  const model = createRecoveryModel({
    maxWorkers, now: () => time, monotonic: () => elapsed,
    schedule: fn => { const timer = { fn }; timers.push(timer); return timer; },
    unschedule: timer => { timers = timers.filter(item => item !== timer); },
    createWorker: () => { const w = { postMessage(m) { this.message = m; }, terminate() { this.stopped = true; } }; workers.push(w); return w; }
  });
  return { model, workers, advance: n => { time += n; elapsed += n; }, adjustWall: n => { time += n; }, fire: () => { const pending = timers; timers = []; pending.forEach(t => t.fn()); } };
}
test("timeout invalidates late messages, permits one bounded replacement, then fails closed", async () => {
  const f = fixture(); f.model.setSession("old", 1000);
  const first = f.model.start("search", 10), old = f.workers[0], late = old.onmessage;
  assert.equal((await f.model.start("duplicate", 10)).status, "busy");
  f.advance(10); f.fire(); assert.equal((await first).status, "timeout");
  f.model.setSession("new", 1000);
  const second = f.model.start("read", 10), fresh = f.workers[1];
  late({ data: { ...old.message, value: "secret" } });
  fresh.onmessage({ data: { ...old.message, value: "secret" } });
  const reply = fresh.onmessage;
  reply({ data: { ...fresh.message, value: "new" } });
  reply({ data: { ...fresh.message, value: "duplicate" } });
  assert.deepEqual(await second, { status: "result", value: "new" });
  assert.equal((await f.model.start("again", 10)).status, "capacity_unknown");
  assert.deepEqual(f.model.stats(), { allocatedUnknown: 2, capacity: 2, active: 0 });
});
test("cancellation, expiry and creation failure retain fail-closed boundaries", async () => {
  const f = fixture(3); f.model.setSession("a", 200);
  const cancelled = f.model.start("read", 10), late = f.workers[0].onmessage;
  f.model.cancel(); late({ data: { ...f.workers[0].message, value: "secret" } });
  assert.equal((await cancelled).status, "cancelled");
  f.model.setSession("b", 200); const expired = f.model.start("read", 10);
  f.advance(100); f.workers[1].onmessage({ data: { ...f.workers[1].message, value: "secret" } });
  assert.equal((await expired).status, "session_expired");
  assert.equal((await f.model.start("read", 10)).status, "session_expired");
  const failed = createRecoveryModel({ createWorker: () => { throw new Error("unknown"); }, maxWorkers: 1, now: () => 0 });
  failed.setSession("x", 100);
  assert.equal((await failed.start(null, 1)).status, "worker_create_unknown");
  assert.equal((await failed.start(null, 1)).status, "failed_closed");
  assert.equal(failed.state().failureCause, "worker_create_unknown");
});
test("a delayed timer cannot admit a result after the deadline", async () => {
  const f = fixture(); f.model.setSession("a", 1000);
  const pending = f.model.start("search", 10); f.advance(10);
  f.workers[0].onmessage({ data: { ...f.workers[0].message, value: "late" } });
  assert.equal((await pending).status, "timeout");
});
test("session expiry stops pending work and malformed expiry never enables a session", async () => {
  const f = fixture(3); f.model.setSession("a", 110);
  const pending = f.model.start("read", 100);
  f.advance(10); f.fire();
  assert.equal((await pending).status, "session_expired");
  assert.throws(() => f.model.setSession("b", NaN), /invalid session/);
  assert.throws(() => f.model.setSession("", 1000), /invalid session/);
  assert.equal((await f.model.start("read", 10)).status, "session_expired");
});
test("wall clock rollback cannot extend the request deadline", async () => {
  const f = fixture(); f.model.setSession("a", 1000);
  const pending = f.model.start("search", 10);
  f.advance(10); f.adjustWall(-1000);
  f.workers[0].onmessage({ data: { ...f.workers[0].message, value: "late" } });
  assert.equal((await pending).status, "timeout");
});
test("termination failure discards the result and keeps the uncertain slot", async () => {
  let worker;
  const model = createRecoveryModel({ maxWorkers: 1, now: () => 0, monotonic: () => 0,
    createWorker: () => (worker = { postMessage(m) { this.message = m; }, terminate() { throw new Error("unknown"); } }) });
  model.setSession("a", 1000);
  assert.throws(() => model.start("read", 2147483648), /invalid timeout/);
  const pending = model.start("read", 100);
  worker.onmessage({ data: { ...worker.message, value: "secret" } });
  assert.deepEqual(await pending, { status: "worker_stop_unknown" });
  assert.equal((await model.start("read", 100)).status, "failed_closed");
  assert.equal(model.state().failureCause, "worker_stop_unknown");
});
