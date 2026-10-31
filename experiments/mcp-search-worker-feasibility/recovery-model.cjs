"use strict";
// Research only: caller resolution is not authorization at a network sink.
function createRecoveryModel({ createWorker, maxWorkers, now = Date.now, monotonic = () => performance.now(),
  schedule = (fn, ms) => setTimeout(fn, ms), unschedule = id => clearTimeout(id) }) {
  if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1) throw new Error("invalid capacity");
  let allocated = 0, serial = 0, generation = 0, current = null, session = null, stopping = false, failed = false;
  const retired = new Set(), requests = new Set(), history = [];
  const mark = (entry, state) => { entry.states.push(state); };
  function retire() { if (session) retired.add(session.id); session = null; }
  function expired() { return !session || now() >= session.expiresAt || monotonic() >= session.deadline; }
  function stop(entry) {
    stopping = true;
    entry.worker.onmessage = null; entry.worker.onerror = null;
    mark(entry, "TERMINATE_REQUESTED");
    try { entry.worker.terminate(); entry.terminate = "RETURNED"; }
    catch { entry.terminate = "THREW"; failed = true; }
    mark(entry, "RELEASE_UNKNOWN");
    stopping = false;
  }
  function invalidate(reason) {
    const entry = current;
    if (!entry) return;
    current = null; unschedule(entry.timer);
    mark(entry, reason === "timeout" || reason === "session_expired" ? "TIMED_OUT" : "CANCEL_REQUESTED");
    stop(entry); entry.resolve({ status: reason });
  }
  function setSession(id, expiresAt) {
    if (session?.id === id) throw new Error("duplicate_session");
    retire(); invalidate("session_changed"); generation++;
    if (typeof id !== "string" || !id || !Number.isFinite(expiresAt)) throw new Error("invalid session");
    if (retired.has(id)) throw new Error("retired_session");
    if (retired.size >= 64) { failed = true; throw new Error("identity_capacity"); }
    session = { id, expiresAt, deadline: monotonic() + Math.max(0, expiresAt - now()) };
  }
  function cancel() { retire(); generation++; invalidate("cancelled"); }
  function preflight(timeoutMs, requestId) {
    if (stopping || current) return "busy";
    if (expired()) { retire(); return "session_expired"; }
    if (allocated >= maxWorkers) return "capacity_unknown";
    if (failed) return "failed_closed";
    if (!(timeoutMs > 0 && Number.isFinite(timeoutMs) && timeoutMs <= 2147483647)) throw new Error("invalid timeout");
    if (requestId !== undefined && (typeof requestId !== "string" || !requestId)) throw new Error("invalid requestId");
    if (requestId !== undefined && requests.has(requestId)) return "duplicate_request";
    return null;
  }
  function start(payload, timeoutMs, suppliedId) {
    const rejection = preflight(timeoutMs, suppliedId);
    if (rejection) return Promise.resolve({ status: rejection });
    const requestId = suppliedId === undefined ? ++serial : suppliedId;
    requests.add(requestId); allocated++;
    const entry = { requestId, sessionId: session.id, generation, deadline: monotonic() + timeoutMs,
      states: [], terminate: "NOT_REQUESTED", physicalRelease: "UNKNOWN", timer: null };
    history.push(entry);
    try { entry.worker = createWorker(); }
    catch { mark(entry, "RELEASE_UNKNOWN"); failed = true; return Promise.resolve({ status: "worker_create_unknown" }); }
    mark(entry, "RUNNING");
    return new Promise(resolve => {
      entry.resolve = resolve; current = entry;
      entry.worker.onmessage = ({ data }) => {
        if (current !== entry || !session || session.id !== entry.sessionId || generation !== entry.generation) return;
        if (expired()) { retire(); invalidate("session_expired"); return; }
        if (monotonic() >= entry.deadline) { invalidate("timeout"); return; }
        if (!data || data.requestId !== requestId || data.sessionId !== entry.sessionId || data.generation !== entry.generation) return;
        current = null; unschedule(entry.timer); stop(entry);
        if (entry.terminate !== "RETURNED") return resolve({ status: "worker_stop_unknown" });
        if (generation !== entry.generation || session?.id !== entry.sessionId) return resolve({ status: "session_changed" });
        if (expired()) { retire(); return resolve({ status: "session_expired" }); }
        if (monotonic() >= entry.deadline) return resolve({ status: "timeout" });
        entry.delivered = true; resolve({ status: "result", value: data.value });
      };
      entry.worker.onerror = () => invalidate("worker_error");
      function arm() {
        const wait = Math.min(entry.deadline - monotonic(), session.deadline - monotonic(), session.expiresAt - now());
        entry.timer = schedule(() => {
          if (current !== entry) return;
          if (expired()) { retire(); invalidate("session_expired"); }
          else if (monotonic() >= entry.deadline) invalidate("timeout");
          else arm();
        }, Math.max(0, wait));
      }
      arm();
      try { entry.worker.postMessage({ requestId, sessionId: entry.sessionId, generation: entry.generation, payload }); }
      catch { invalidate("worker_error"); }
    });
  }
  return { setSession, cancel, start, preflight,
    deliveryStatus() {
      const entry = history.at(-1);
      if (failed) return "failed_closed";
      if (!entry || !entry.delivered || generation !== entry.generation || session?.id !== entry.sessionId) return "session_changed";
      if (expired()) { retire(); return "session_expired"; }
      return monotonic() >= entry.deadline ? "timeout" : null;
    },
    state: () => ({ admission: failed || allocated >= maxWorkers ? "FAILED_CLOSED" : stopping ? "STOPPING" : "BOUNDED",
      history: history.map(e => ({ requestId: e.requestId, sessionId: e.sessionId, generation: e.generation,
        states: [...e.states], terminate: e.terminate, delivered: e.delivered === true, physicalRelease: e.physicalRelease })) }),
    stats: () => ({ allocatedUnknown: allocated, capacity: maxWorkers, active: current ? 1 : 0 }) };
}
// Same-origin/same-partition, cooperative participants only. No production imports.
function createSharedRecoveryModel({ ledger, name, owner, createWorker, maxWorkers = 2, ...options }) {
  let pending = false, epoch = 0, failed = false, reservedForFactory = false;
  const clock = options.monotonic || (() => performance.now());
  const core = createRecoveryModel({ ...options, maxWorkers, createWorker: () => {
    if (!reservedForFactory) throw new Error("reservation_required");
    reservedForFactory = false; return createWorker();
  } });
  return {
    setSession(id, expiresAt) { epoch++; core.setSession(id, expiresAt); },
    cancel() { epoch++; core.cancel(); }, stats: core.stats,
    state: () => ({ ...core.state(), ...(failed ? { admission: "FAILED_CLOSED" } : {}) }),
    async start(payload, timeoutMs, requestId) {
      if (failed) return { status: "failed_closed" };
      if (pending) return { status: "busy" };
      const before = core.preflight(timeoutMs, requestId);
      if (before) return { status: before };
      pending = true; const token = epoch, deadline = clock() + timeoutMs; let allocation, began = false, result;
      try {
        allocation = await ledger.reserve(name, maxWorkers, owner);
        if (allocation.status !== "reserved") { failed = true; return { status: "capacity_unknown" }; }
        const rejected = token !== epoch ? "session_changed" : clock() >= deadline ? "timeout" : core.preflight(timeoutMs, requestId);
        if (rejected) { await ledger.releaseReserved(name, maxWorkers, owner, allocation.id); return { status: rejected }; }
        await ledger.transition(name, maxWorkers, owner, allocation.id, "running"); began = true;
        if (token !== epoch) return { status: "session_changed" };
        if (clock() >= deadline) return { status: "timeout" };
        reservedForFactory = true;
        result = await core.start(payload, deadline - clock(), requestId);
      } catch { failed = true; result = { status: "failed_closed" }; }
      finally {
        reservedForFactory = false;
        if (began) {
          try { await ledger.transition(name, maxWorkers, owner, allocation.id, "unknown"); }
          catch { failed = true; }
        }
        pending = false;
      }
      if (failed) return { status: "failed_closed" };
      // Ledger commit is asynchronous: recheck AFTER the last await before caller delivery.
      const rejected = result.status === "result" ? core.deliveryStatus() || (clock() >= deadline ? "timeout" : null) : null;
      return rejected ? { status: rejected } : result;
    }
  };
}
module.exports = { createRecoveryModel, createSharedRecoveryModel };
