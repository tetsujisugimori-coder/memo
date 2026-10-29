(function (root) {
  "use strict";
  const DELETE_DEADLINE_MS = 2000;
  function deleteDatabaseObserved({ factory, dbName, record, timeoutMs = DELETE_DEADLINE_MS, timers = globalThis, now = () => performance.now() }) {
    const started = now();
    return new Promise(resolve => {
      let settled = false, blocked = false, timer;
      const events = [];
      const emit = (event, details = {}) => { events.push(event); record(event, { ...details, late: settled }); };
      const finish = (status, terminal, error = null) => {
        if (settled) return;
        settled = true; timers.clearTimeout(timer);
        record("delete_finished", { outcome: status, terminal, blockedObserved: blocked, elapsedMs: now() - started });
        resolve({ status, terminal, error, blockedObserved: blocked, elapsedMs: now() - started, events: [...events] });
      };
      emit("delete_start", { deadlineMs: timeoutMs });
      timer = timers.setTimeout(() => { emit("delete_timeout"); finish("UNKNOWN", "timeout"); }, timeoutMs);
      try {
        const request = factory.deleteDatabase(dbName);
        request.onsuccess = () => { emit("delete_success"); finish("PASS", "success"); };
        request.onerror = () => { const code = request.error?.name || "UNKNOWN"; emit("delete_error", { outcome: code }); finish("FAIL", "error", code); };
        request.onblocked = () => { blocked = true; emit("delete_blocked"); };
      } catch (error) { emit("delete_throw", { outcome: error.name || "Error" }); finish("FAIL", "throw", error.name || "Error"); }
    });
  }
  const api = { DELETE_DEADLINE_MS, deleteDatabaseObserved };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WorkerPocCleanup = api;
})(globalThis);
