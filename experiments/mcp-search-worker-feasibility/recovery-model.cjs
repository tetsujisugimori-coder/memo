"use strict";
// Research only: caller resolution is not authorization at a network sink.
function createRecoveryModel({ createWorker, maxWorkers, now = Date.now, monotonic = () => performance.now(),
  schedule = (fn, ms) => setTimeout(fn, ms), unschedule = id => clearTimeout(id) }) {
  if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1) throw new Error("invalid capacity");
  let allocated = 0, serial = 0, generation = 0, current = null, session = null, stopping = false, failureCause = null;
  const fail = cause => { failureCause ||= cause; };
  const retired = new Set(), requests = new Set(), history = [];
  const mark = (entry, state) => { entry.states.push(state); };
  function retire() { if (session) retired.add(session.id); session = null; }
  function expired() { return !session || now() >= session.expiresAt || monotonic() >= session.deadline; }
  function stop(entry) {
    stopping = true;
    entry.worker.onmessage = null; entry.worker.onerror = null;
    mark(entry, "TERMINATE_REQUESTED");
    try { entry.worker.terminate(); entry.terminate = "RETURNED"; }
    catch { entry.terminate = "THREW"; fail("worker_stop_unknown"); }
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
    if (retired.size >= 64) { fail("identity_capacity"); throw new Error("identity_capacity"); }
    session = { id, expiresAt, deadline: monotonic() + Math.max(0, expiresAt - now()) };
  }
  function cancel() { retire(); generation++; invalidate("cancelled"); }
  function preflight(timeoutMs, requestId) {
    if (failureCause) return "failed_closed";
    if (stopping || current) return "busy";
    if (expired()) { retire(); return "session_expired"; }
    if (allocated >= maxWorkers) return "capacity_unknown";
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
    catch { mark(entry, "RELEASE_UNKNOWN"); fail("worker_create_unknown"); return Promise.resolve({ status: "worker_create_unknown" }); }
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
    expireRequest(reason) {
      if (!["timeout", "session_expired"].includes(reason)) throw new Error("invalid expiry");
      if (reason === "session_expired") retire();
      invalidate(reason);
    },
    deliveryStatus() {
      const entry = history.at(-1);
      if (failureCause) return "failed_closed";
      if (!entry || !entry.delivered || generation !== entry.generation || session?.id !== entry.sessionId) return "session_changed";
      if (expired()) { retire(); return "session_expired"; }
      return monotonic() >= entry.deadline ? "timeout" : null;
    },
    state: () => ({ admission: failureCause || allocated >= maxWorkers ? "FAILED_CLOSED" : stopping ? "STOPPING" : "BOUNDED", failureCause,
      history: history.map(e => ({ requestId: e.requestId, sessionId: e.sessionId, generation: e.generation,
        states: [...e.states], terminate: e.terminate, delivered: e.delivered === true, physicalRelease: e.physicalRelease })) }),
    stats: () => ({ allocatedUnknown: allocated, capacity: maxWorkers, active: current ? 1 : 0 }) };
}
// Same-origin/same-partition, cooperative participants only. No production imports.
function createSharedRecoveryModel({ ledger, name, owner, createWorker, maxWorkers = 2, ...options }) {
  let owned = null, last = null, grant = null, epoch = 0, failureCause = null, reservedForFactory = false;
  const delivered = new Set(), requests = new Set();
  const clock = options.monotonic || (() => performance.now());
  const wall = options.now || Date.now;
  const schedule = options.schedule || ((fn, ms) => setTimeout(fn, ms));
  const unschedule = options.unschedule || (id => clearTimeout(id));
  const core = createRecoveryModel({ ...options, maxWorkers, createWorker: () => {
    if (!reservedForFactory) throw new Error("reservation_required");
    reservedForFactory = false; return createWorker();
  } });
  const fail = cause => { failureCause ||= core.state().failureCause || cause; };
  function settleCaller(job, result) {
    if (job.callerSettled) return;
    job.callerSettled = true; job.responseStatus = result.status; job.responseAt = clock(); job.resolve(result);
  }
  function boundary(job) {
    if (job.token !== epoch) return "session_changed";
    if (wall() >= job.grant.expiresAt || clock() >= job.grant.deadline) { job.deadlineExpired = true; return "session_expired"; }
    if (clock() >= job.deadline) { job.deadlineExpired = true; return "timeout"; }
    return null;
  }
  function arm(job) {
    const wait = Math.min(job.deadline - clock(), job.grant.deadline - clock(), job.grant.expiresAt - wall());
    job.timer = schedule(() => {
      // Cancellation settles the caller, but does not abandon the owned ledger operation or its deadline.
      const reason = wall() >= job.grant.expiresAt || clock() >= job.grant.deadline ? "session_expired"
        : clock() >= job.deadline ? "timeout" : null;
      if (!reason) return arm(job);
      job.deadlineExpired = true;
      // A core timeout can run first. Its subsequent unknown commit is cleanup, not a late result commit.
      const timeoutCleanup = job.ledgerOperation === "unknown" && job.coreStatus === "timeout";
      if (job.ledgerOperation && !timeoutCleanup) fail(`ledger_${job.ledgerOperation}_deadline`);
      if (job.token === epoch) core.expireRequest(reason);
      settleCaller(job, { status: reason });
    }, Math.max(0, wait));
  }
  async function operation(job, phase, action) {
    job.ledgerOperation = phase;
    const record = { phase, status: "PENDING" }; job.operations.push(record);
    try { const value = await action(); record.status = "SETTLED"; return value; }
    catch { record.status = "REJECTED"; fail(`ledger_${phase}_failed`); throw new Error("ledger_operation_failed"); }
    finally { job.ledgerOperation = null; }
  }
  async function run(job, payload, requestId) {
    let began = false;
    try {
      const allocation = await operation(job, "reserve", () => ledger.reserve(name, maxWorkers, owner));
      if (allocation?.status === "capacity_unknown") { fail("capacity_unknown"); return { status: "capacity_unknown" }; }
      if (allocation?.status !== "reserved" || typeof allocation.id !== "string" || !allocation.id) {
        fail("ledger_reserve_invalid"); return { status: "failed_closed" };
      }
      job.reservationId = allocation.id;
      const rejected = boundary(job);
      if (rejected) {
        // Only this pre-running path may release; the real ledger atomically checks id, owner AND reserved state.
        const release = await operation(job, "release", () => ledger.releaseReserved(name, maxWorkers, owner, allocation.id));
        if (!["released_before_creation", "already_absent"].includes(release?.status)) fail("ledger_release_unconfirmed");
        return { status: rejected };
      }
      // A lost commit acknowledgement can mean running was persisted. Never release from this point onward.
      job.runningAttempted = true;
      const committed = await operation(job, "running", () => ledger.transition(name, maxWorkers, owner, allocation.id, "running"));
      if (committed?.status !== "running") { fail("ledger_running_unconfirmed"); return { status: "failed_closed" }; }
      began = true;
      const afterCommit = boundary(job);
      if (afterCommit) return { status: afterCommit };
      reservedForFactory = true;
      const result = await core.start(payload, job.deadline - clock(), requestId);
      job.coreStatus = result.status;
      if (result.status === "timeout") { job.deadlineExpired = true; settleCaller(job, result); }
      return result;
    } catch { return { status: "failed_closed" }; }
    finally {
      reservedForFactory = false;
      if (began) {
        try {
          const committed = await operation(job, "unknown", () => ledger.transition(name, maxWorkers, owner, job.reservationId, "unknown"));
          if (committed?.status !== "unknown") fail("ledger_unknown_unconfirmed");
        }
        catch { /* failure is latched by operation; the slot remains consumed */ }
      }
    }
  }
  function finish(job, result) {
    // This is workflow completion, separate from the possibly earlier caller timeout/cancellation.
    const rejected = boundary(job) || (result.status === "result" ? core.deliveryStatus() : null);
    if (failureCause && result.status !== "capacity_unknown") result = { status: "failed_closed" };
    else if (rejected) result = { status: rejected };
    if (!job.callerSettled && result.status === "result") delivered.add(core.state().history.at(-1).requestId);
    unschedule(job.timer); job.workPending = false; owned = null;
    settleCaller(job, result);
  }
  function abandon(status = "session_changed") {
    epoch++;
    if (owned) { owned.cancelRequested = true; settleCaller(owned, { status }); }
  }
  return {
    setSession(id, expiresAt) {
      abandon(); grant = null; core.setSession(id, expiresAt);
      grant = { expiresAt, deadline: clock() + Math.max(0, expiresAt - wall()) };
    },
    cancel() { abandon(core.stats().active ? "cancelled" : "session_changed"); grant = null; core.cancel(); }, stats: core.stats,
    state: () => { const state = core.state(); return { ...state,
      failureCause: failureCause || state.failureCause,
      ...(failureCause || owned?.callerSettled ? { admission: "FAILED_CLOSED" } : {}),
      workPending: !!owned,
      request: last ? { requestId: last.requestId, epoch: last.token, ledgerName: name, owner,
        callerSettled: last.callerSettled, responseStatus: last.responseStatus, responseAt: last.responseAt,
        deadline: last.deadline, deadlineExpired: last.deadlineExpired, cancelRequested: last.cancelRequested,
        ledgerOperation: last.ledgerOperation, operations: last.operations.map(o => ({ ...o })), coreStatus: last.coreStatus,
        reservationId: last.reservationId, runningAttempted: last.runningAttempted, workPending: last.workPending } : null,
      history: state.history.map(entry => ({ ...entry, coreResolved: entry.delivered, delivered: delivered.has(entry.requestId) })) }; },
    async start(payload, timeoutMs, requestId) {
      if (failureCause || core.state().failureCause || owned?.callerSettled) return Promise.resolve({ status: "failed_closed" });
      if (owned) return Promise.resolve({ status: "busy" });
      if (!grant) return Promise.resolve({ status: "session_expired" });
      const before = core.preflight(timeoutMs, requestId);
      if (before) return Promise.resolve({ status: before });
      if (requestId !== undefined && requests.has(requestId)) return Promise.resolve({ status: "duplicate_request" });
      if (requests.size >= 64) { fail("identity_capacity"); return Promise.resolve({ status: "failed_closed" }); }
      if (requestId !== undefined) requests.add(requestId);
      const job = owned = last = { requestId, token: epoch, grant: { ...grant }, deadline: clock() + timeoutMs, callerSettled: false,
        deadlineExpired: false, cancelRequested: false, ledgerOperation: null, operations: [], runningAttempted: false, workPending: true };
      const caller = new Promise(resolve => { job.resolve = resolve; });
      arm(job);
      // Keep the workflow (and operation) reachable after caller completion; no orphaned Promise.race branch.
      job.task = run(job, payload, requestId).then(result => finish(job, result));
      return caller;
    }
  };
}
module.exports = { createRecoveryModel, createSharedRecoveryModel };
