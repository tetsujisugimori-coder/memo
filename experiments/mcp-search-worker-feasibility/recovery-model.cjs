"use strict";

// 限定PoC: 管理台帳はこのインスタンス内だけ。ページやタブをまたぐ上限ではない。
function createRecoveryModel({ createWorker, maxWorkers, now = Date.now, monotonic = () => performance.now(), schedule = setTimeout, unschedule = clearTimeout }) {
  if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1) throw new Error("invalid capacity");
  let allocated = 0, serial = 0, current = null, session = null;
  function invalidate(reason) {
    const entry = current;
    if (!entry) return;
    current = null;
    unschedule(entry.timer);
    entry.worker.onmessage = null;
    entry.worker.onerror = null;
    try { entry.worker.terminate(); } catch { /* 解放は未確認のまま枠を保持 */ }
    entry.resolve({ status: reason });
  }
  function setSession(id, expiresAt) {
    invalidate("session_changed");
    session = null;
    if (typeof id !== "string" || !id || !Number.isFinite(expiresAt)) throw new Error("invalid session");
    session = { id, expiresAt };
  }
  function cancel() {
    session = null;
    invalidate("cancelled");
  }
  function start(payload, timeoutMs) {
    if (!session || now() >= session.expiresAt) return Promise.resolve({ status: "session_expired" });
    if (current) return Promise.resolve({ status: "busy" });
    if (allocated >= maxWorkers) return Promise.resolve({ status: "capacity_unknown", recovery: "isolated process disposal and external verification required" });
    if (!(timeoutMs > 0 && Number.isFinite(timeoutMs) && timeoutMs <= 2147483647)) throw new Error("invalid timeout");
    const requestId = ++serial;
    // 作成が部分的に失敗しても、内部資源の不存在は確認できない。
    allocated++;
    let worker;
    try { worker = createWorker(); } catch { return Promise.resolve({ status: "worker_create_unknown" }); }
    return new Promise(resolve => {
      const entry = { worker, requestId, sessionId: session.id, deadline: monotonic() + timeoutMs, resolve, timer: null };
      current = entry;
      worker.onmessage = ({ data }) => {
        if (current !== entry || !session || session.id !== entry.sessionId) return;
        if (now() >= session.expiresAt) { session = null; invalidate("session_expired"); return; }
        if (monotonic() >= entry.deadline) { invalidate("timeout"); return; }
        if (!data || data.requestId !== entry.requestId || data.sessionId !== entry.sessionId) return;
        current = null;
        unschedule(entry.timer);
        worker.onmessage = null;
        worker.onerror = null;
        try { worker.terminate(); } catch { resolve({ status: "worker_stop_unknown" }); return; }
        resolve({ status: "result", value: data.value });
      };
      worker.onerror = () => invalidate("worker_error");
      function arm() {
        const wait = Math.min(entry.deadline - monotonic(), session.expiresAt - now());
        entry.timer = schedule(() => {
          if (current !== entry) return;
          if (!session || now() >= session.expiresAt) { session = null; invalidate("session_expired"); }
          else if (monotonic() >= entry.deadline) invalidate("timeout");
          else arm();
        }, Math.max(0, wait));
      }
      arm();
      try { worker.postMessage({ requestId, sessionId: entry.sessionId, payload }); }
      catch { invalidate("worker_error"); }
    });
  }
  return { setSession, cancel, start, stats: () => ({ allocatedUnknown: allocated, capacity: maxWorkers, active: current ? 1 : 0 }) };
}
module.exports = { createRecoveryModel };
