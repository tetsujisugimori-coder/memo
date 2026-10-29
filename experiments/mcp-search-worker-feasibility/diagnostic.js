"use strict";
window.runIndependentDiagnostic = async spec => {
  const { PLAN, LIMITS, conditionEstablished, outcome } = window.WorkerDiagnosticPlan;
  if (!PLAN.some(item => item.id === spec.id && item.condition === spec.condition && item.measurement === spec.measurement)) throw new Error("unplanned condition");
  const dbName = `worker-poc-isolated-${crypto.randomUUID()}`;
  const identity = { conditionId: spec.id, workerId: `${spec.id}-worker`, requestId: `${spec.id}-request`, session: `${spec.id}-session` };
  const result = { ...spec, fixtureId: "fictional-two-notes-v1", dbId: dbName, ...identity, timeline: [], conditionEstablished: false, upgradeStatus: "NOT_RUN", observed: null, unknowns: ["Worker実終了時刻", "DB接続解放時刻", "実メモリ・OS資源"] };
  window.diagnosticProgress = result;
  const record = (event, details = {}) => result.timeline.push({ seq: result.timeline.length + 1, source: details.source || "main", mainMs: performance.now(), workerMs: details.workerMs ?? null, conditionId: spec.id, ...identity, dbVersion: details.dbVersion ?? null, event, outcome: details.outcome ?? null, ...details });
  const deadline = (promise, label) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), LIMITS.openMs);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  async function open(version, setup) {
    let expired = false;
    record("open_start", { requestedVersion: version, oldVersion: setup ? 0 : 1 });
    try { return await deadline(new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, version);
      req.onblocked = event => record("open_blocked", { oldVersion: event.oldVersion, requestedVersion: event.newVersion });
      req.onupgradeneeded = event => {
        record("open_upgradeneeded", { oldVersion: event.oldVersion, requestedVersion: event.newVersion });
        if (setup) { req.result.createObjectStore("notes", { keyPath: "id" }); req.result.createObjectStore("metadata", { keyPath: "id" }); }
      };
      req.onsuccess = () => { record("open_success", { dbVersion: req.result.version, late: expired }); if (expired) req.result.close(); else resolve(req.result); };
      req.onerror = () => { record("open_error", { outcome: req.error?.name }); reject(req.error); };
    }), "open timeout"); } catch (error) { expired = true; record("open_timeout_or_error", { requestedVersion: version, outcome: error.message }); throw error; }
  }
  let fixture, worker;
  try {
    fixture = await open(1, true);
    await deadline(new Promise((resolve, reject) => {
      const tx = fixture.transaction(["notes", "metadata"], "readwrite"); record("fixture_transaction_start", { mode: tx.mode });
      tx.objectStore("notes").put({ id: "n1", title: "架空のメモ", body: "架空本文" });
      tx.objectStore("notes").put({ id: "n2", title: "別のメモ", body: "別の架空本文" });
      tx.objectStore("metadata").put({ id: "m1", value: "fixture" });
      tx.oncomplete = () => { record("fixture_transaction_complete"); resolve(); };
      tx.onabort = () => { record("fixture_transaction_abort"); reject(tx.error); };
      tx.onerror = () => { record("fixture_transaction_error"); reject(tx.error); };
    }), "fixture transaction timeout");
    fixture.close(); fixture = null; record("fixture_close_called", { outcome: "returned", connectionClosed: "UNKNOWN" });
    worker = new Worker("diagnostic-worker.js"); record("worker_created");
    const boundary = await deadline(new Promise((resolve, reject) => {
      worker.onerror = event => reject(new Error(event.message));
      worker.onmessage = ({ data }) => {
        if (data.conditionId !== identity.conditionId || data.workerId !== identity.workerId || data.requestId !== identity.requestId || data.session !== identity.session) { record("worker_message_rejected"); return; }
        if (data.kind === "event") record("worker_event_received", { source: "worker", workerMs: data.entry.workerMs, workerEvent: data.entry.event, details: data.entry });
        if (data.kind === "boundary") { record("condition_boundary_received", { source: "worker-summary", workerMs: data.workerMs }); resolve(data); }
      };
      worker.postMessage({ ...identity, ...spec, dbName });
    }), "condition boundary timeout");
    result.observed = boundary.observed; result.workerLocalEvents = boundary.events;
    result.conditionEstablished = conditionEstablished(spec.condition, boundary.observed);
    record("condition_checked", { outcome: result.conditionEstablished ? "ESTABLISHED" : "NOT_ESTABLISHED" });
    if (!result.conditionEstablished) throw new Error("condition not established");
    record("terminate_call"); worker.terminate(); record("terminate_return", { outcome: "returned", workerTerminationComplete: "UNKNOWN" });
    worker.onmessage = null;
    try {
      const upgraded = await open(2, false); upgraded.close(); record("upgrade_close_called", { outcome: "returned", connectionClosed: "UNKNOWN" }); result.upgradeStatus = "PASS";
    } catch (error) { result.upgradeStatus = error.message.includes("timeout") ? "TIMEOUT" : "FAIL"; result.upgradeError = error.message; }
  } catch (error) { record("condition_error", { outcome: error.message }); result.error = error.message; }
  finally {
    if (fixture) { fixture.close(); record("fixture_close_called", { outcome: "returned", connectionClosed: "UNKNOWN" }); }
    if (worker) { try { worker.terminate(); record("cleanup_terminate_return", { outcome: "returned" }); } catch { record("cleanup_terminate_error"); } }
    result.cleanup = await window.WorkerPocCleanup.deleteDatabaseObserved({ factory: indexedDB, dbName, record });
  }
  result.outcome = outcome(result.conditionEstablished, result.upgradeStatus, result.cleanup.status);
  record("condition_end", { outcome: result.outcome });
  return result;
};
