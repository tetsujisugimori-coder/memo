"use strict";
// The same controlled, synthetic ledger cases run in Node and both browser engines.
const deadlineCases = [
  { name: "reserve-delayed", gate: "reserve", delay: 220 },
  { name: "reserve-late-duplicate-completion", gate: "reserve" },
  { name: "reserve-never", gate: "reserve", never: true },
  { name: "running-late", gate: "running" },
  { name: "running-never", gate: "running", never: true },
  { name: "unknown-late", gate: "unknown" },
  { name: "unknown-never", gate: "unknown", never: true },
  { name: "release-late", gate: "release", action: "cancel", at: 20 },
  { name: "release-never", gate: "release", action: "cancel", at: 20, never: true },
  { name: "cancel-before-deadline", gate: "reserve", action: "cancel", at: 20 },
  { name: "cancel-after-deadline", gate: "reserve", action: "cancel", at: 100 },
  { name: "session-change-late-reserve", gate: "reserve", action: "session", at: 20 },
  { name: "ledger-error-after-deadline", gate: "reserve", reject: true },
  { name: "ledger-error-before-deadline-with-capacity", gate: "reserve", reject: true, delay: 20, full: true },
  { name: "permission-expiry-with-wall-rollback", gate: "reserve", never: true, rollback: true },
  { name: "capacity-full", full: true },
  { name: "normal-second-reservation", normal: true },
  { name: "terminate-failure-with-capacity", core: true },
  { name: "terminate-failure-with-session-expiry", core: true, expire: true }
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function within(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve({ status: "OBSERVER_TIMEOUT" }), ms); })]); }
  finally { clearTimeout(timer); }
}
async function runDeadlineCase(api, spec) {
  const started = performance.now(), violations = [], check = (condition, label) => { if (!condition) violations.push(label); };
  let wallShift = 0, creates = 0, released = 0, releaseCalls = 0, serial = 0;
  const slots = spec.full ? [{ id: "existing-1", owner: "old", state: "unknown" }, { id: "existing-2", owner: "old", state: "unknown" }] : [];
  const gate = deferred(), reserveGate = deferred(), calls = [];
  const ledger = {
    async reserve(_name, capacity, owner) {
      calls.push("reserve");
      if (spec.gate === "reserve") await gate.promise;
      if (spec.gate === "release") await reserveGate.promise;
      if (slots.length >= capacity) return { status: "capacity_unknown" };
      const id = `reservation-${++serial}`; slots.push({ id, owner, state: "reserved" }); return { status: "reserved", id };
    },
    async transition(_name, _capacity, owner, id, next) {
      calls.push(next); const slot = slots.find(s => s.owner === owner && s.id === id);
      if (!slot) throw new Error("identity_mismatch");
      // running may have committed even when its acknowledgement is delayed forever.
      if (next === "running") slot.state = "running";
      if (spec.gate === next) await gate.promise;
      slot.state = next; return { status: next };
    },
    async releaseReserved(_name, _capacity, owner, id) {
      releaseCalls++; calls.push("release");
      if (spec.gate === "release") await gate.promise;
      const index = slots.findIndex(s => s.owner === owner && s.id === id);
      if (index < 0) return { status: "already_absent" };
      if (slots[index].state !== "reserved") throw new Error("attempted_running_release");
      slots.splice(index, 1); released++; return { status: "released_before_creation" };
    }
  };
  const worker = () => { creates++; return { postMessage(m) { if (m.payload !== "hang") this.onmessage({ data: { ...m, value: "synthetic" } }); }, terminate() { if (spec.core && creates === 2) throw new Error("injected_terminate"); } }; };
  const model = spec.core ? api.createRecoveryModel({ createWorker: worker, maxWorkers: 2, now: () => Date.now() + wallShift })
    : api.createSharedRecoveryModel({ ledger, name: "fictional-ledger", owner: "owner", createWorker: worker, now: () => Date.now() + wallShift });
  model.setSession("initial", Date.now() + (spec.rollback ? 50 : 10000));
  if (spec.core) {
    const first = await model.start("read", 60), failed = await model.start("read", 60);
    if (spec.expire) wallShift = 20000;
    const rejected = await model.start("read", 60), state = model.state();
    check(first.status === "result" && failed.status === "worker_stop_unknown", "termination injection did not establish failure");
    check(rejected.status === "failed_closed", "initial failure masked by capacity or expiry");
    check(state.failureCause === "worker_stop_unknown", "initial failure cause absent");
    return { name: spec.name, violations, first, failed, rejected, creates, released, releaseCalls, state, elapsedMs: performance.now() - started };
  }
  const deadlineMs = spec.rollback ? 80 : 60, requestedAt = performance.now(); let response = null, responseMs = null;
  const pending = model.start(spec.normal ? "hang" : "read", deadlineMs, "request-1").then(result => { response = result; responseMs = performance.now() - requestedAt; return result; });
  const timers = [];
  const complete = () => spec.reject ? gate.reject(new Error("injected_ledger_failure")) : gate.resolve();
  if (spec.delay) timers.push(setTimeout(complete, spec.delay));
  if (spec.rollback) timers.push(setTimeout(() => { wallShift -= 20000; }, 10));
  if (spec.action) timers.push(setTimeout(() => {
    if (spec.action === "cancel") model.cancel(); else model.setSession("replacement", Date.now() + 10000);
  }, spec.at));
  if (spec.gate === "release") timers.push(setTimeout(() => reserveGate.resolve(), 25));
  const observed = await within(pending, 160);
  const expected = spec.normal ? "timeout" : spec.name === "capacity-full" ? "capacity_unknown"
    : spec.rollback ? "session_expired" : spec.reject && spec.delay === 20 ? "failed_closed"
    : spec.action && spec.at < deadlineMs ? "session_changed" : "timeout";
  check(observed.status === expected, `caller expected ${expected}, observed ${observed.status}`);
  check(responseMs !== null && responseMs < 160, "caller did not finish within finite response observation window");
  const callerObservation = { response: observed, responseMs };
  await pause(Math.max(0, 180 - (performance.now() - requestedAt)));
  const during = model.state();
  if (spec.gate && !(spec.delay && spec.delay < deadlineMs)) {
    check(during.workPending === true && during.admission === "FAILED_CLOSED", "unfinished ledger task is not owned and fail closed");
    check(during.request?.callerSettled === true && during.request?.ledgerOperation === spec.gate, "caller completion and ledger completion not distinguished");
  }
  let following = null;
  if (!spec.normal) following = await within(model.start("read", 60, "request-2"), 160);
  if (spec.gate) check(following?.status === "failed_closed", "new work was not explicitly refused");
  if (!spec.never && !spec.delay) { complete(); complete(); } // duplicate settlement must remain harmless
  await pause(spec.delay === 220 ? 100 : 20);
  if (spec.normal) {
    model.setSession("fresh", Date.now() + 10000);
    const second = await within(model.start("read", 60, "request-2"), 160);
    const third = await within(model.start("read", 60, "request-3"), 160);
    following = { second, third };
    check(second.status === "result" && third.status === "capacity_unknown", "bounded second reservation recovery failed");
    check(creates === 2 && released === 0 && slots.length === 2, "two-slot non-reclamation contract broken");
  } else {
    const expectedCreates = spec.gate === "unknown" ? 1 : 0;
    check(creates === expectedCreates, `Worker creates ${creates}, expected ${expectedCreates}`);
    const expectedRelease = !spec.never && !spec.reject && ["reserve", "release"].includes(spec.gate) ? 1 : 0;
    check(released === expectedRelease, `reservation releases ${released}, expected ${expectedRelease}`);
    check(releaseCalls <= 1, "double release attempted");
    if (["running", "unknown"].includes(spec.gate)) check(slots.length === 1 && released === 0, "running slot reclaimed");
  }
  const final = model.state();
  if (spec.reject && spec.delay === 20) check(final.failureCause === "ledger_reserve_failed", "ledger initial cause lost to capacity");
  if (spec.never) check(final.workPending === true, "permanent pending operation lost ownership");
  if (spec.reject && !spec.delay) check(final.failureCause === "ledger_reserve_deadline", "late ledger exception replaced initial deadline failure");
  for (const timer of timers) clearTimeout(timer);
  return { name: spec.name, deadlineMs, violations, callerObservation, eventualResponse: response, eventualResponseMs: responseMs,
    during, final, following, slots, creates, released, releaseCalls, calls, elapsedMs: performance.now() - started };
}
module.exports = { deadlineCases, runDeadlineCase };
