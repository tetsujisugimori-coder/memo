"use strict";

// 各条件は一度だけ、別の架空DBで実行する。成功するまで再試行しない。
window.runWorkerControls = async () => {
  const timeline = [], results = {};
  const log = (testId, event, details = {}) => timeline.push({ seq: timeline.length + 1, source: details.source || "main", mainMs: performance.now(), workerMs: details.workerMs ?? null, testId, iteration: 1, workerId: details.workerId || null, session: details.session || null, requestId: details.requestId || null, dbVersion: details.dbVersion ?? null, event, outcome: details.outcome ?? null, ...details });
  const deadline = (promise, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(label)), 8000))]);
  for (const [testId, mode] of [["control-A", "close"], ["control-B", "unresolved"]]) {
    const dbName = `worker-poc-control-${crypto.randomUUID()}`;
    let worker, expired = false, blocked = false, versionChanged = false, terminal = "UNKNOWN", closed = "UNKNOWN";
    const entry = { workerId: `${testId}-worker`, requestId: `${testId}-request`, session: `${testId}-session` };
    try {
      log(testId, "fixture_open_start", { requestedVersion: 1 });
      const fixture = await deadline(new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => { log(testId, "fixture_upgradeneeded", { dbVersion: 1 }); req.result.createObjectStore("notes", { keyPath: "id" }); };
        req.onerror = () => reject(req.error); req.onsuccess = () => resolve(req.result);
      }), "fixture open timeout");
      await deadline(new Promise((resolve, reject) => {
        const tx = fixture.transaction("notes", "readwrite"); log(testId, "fixture_transaction_start", { mode: tx.mode });
        tx.objectStore("notes").put({ id: "n1", title: "架空", body: "架空" });
        tx.oncomplete = () => { log(testId, "fixture_transaction_complete"); resolve(); };
        tx.onabort = tx.onerror = () => reject(tx.error);
      }), "fixture transaction timeout");
      fixture.close(); log(testId, "fixture_close_called", { outcome: "returned", connectionClosed: "UNKNOWN" });
      worker = new Worker("worker.js"); log(testId, "worker_created", entry);
      const ready = new Promise((resolve, reject) => {
        worker.onerror = event => reject(new Error(event.message));
        worker.onmessage = ({ data }) => {
          log(testId, "worker_message", { ...entry, source: "worker", workerMs: data.workerMs, dbVersion: data.dbVersion, workerEvent: data.phase, mode: data.transactionMode || null, outcome: data.outcome || null });
          if (["transaction_complete", "transaction_abort", "transaction_error"].includes(data.phase)) terminal = data.phase;
          if (data.phase === "db_close_event") closed = "close_event";
          if (data.phase === "db_versionchange") versionChanged = true;
          if (data.phase === (mode === "close" ? "closed_ready" : "unresolved")) resolve();
        };
      });
      worker.postMessage({ ...entry, dbName, mode, generation: 1, operation: "search", query: "架空", testId, iteration: 1 });
      await deadline(ready, `${testId} ready timeout`);
      log(testId, "worker_stop_requested", entry); log(testId, "terminate_call", entry);
      worker.terminate(); log(testId, "terminate_return", { ...entry, connectionClosed: "UNKNOWN" });
      log(testId, "upgrade_open_start", { oldVersion: 1, requestedVersion: 2 });
      try {
        const upgraded = await deadline(new Promise((resolve, reject) => {
          const req = indexedDB.open(dbName, 2);
          req.onblocked = event => { blocked = true; log(testId, "upgrade_blocked", { oldVersion: event.oldVersion, requestedVersion: event.newVersion }); };
          req.onupgradeneeded = event => log(testId, "upgrade_upgradeneeded", { oldVersion: event.oldVersion, requestedVersion: event.newVersion });
          req.onerror = () => { log(testId, "upgrade_error", { outcome: req.error?.name }); reject(req.error); };
          req.onsuccess = () => { log(testId, "upgrade_success", { dbVersion: req.result.version, outcome: expired ? "late" : "received" }); if (expired) req.result.close(); else resolve(req.result); };
        }), "upgrade timeout");
        upgraded.close(); log(testId, "upgrade_close_called", { outcome: "returned", connectionClosed: "UNKNOWN" });
        results[testId] = { outcome: "PASS", mode, blockedObserved: blocked, transactionTerminal: terminal, workerConnectionClosed: closed, versionchangeObserved: versionChanged };
      } catch (error) {
        expired = true; log(testId, "upgrade_timeout_or_error", { outcome: error.message, blockedObserved: blocked });
        results[testId] = { outcome: "FAIL", mode, reason: error.message, blockedObserved: blocked, transactionTerminal: terminal, workerConnectionClosed: closed, versionchangeObserved: versionChanged };
      }
    } catch (error) { log(testId, "control_error", { outcome: error.message }); results[testId] = { outcome: "FAIL", mode, reason: error.message, transactionTerminal: terminal, workerConnectionClosed: closed }; }
    finally { try { worker?.terminate(); } catch {} indexedDB.deleteDatabase(dbName); }
  }
  return { results, timeline, roundsPerCondition: 1, deadlineMs: 8000, measurementEffects: "ログのmessageとイベント処理はタイミングを変化させ得る。Worker時計とmain時計は別基準。" };
};
