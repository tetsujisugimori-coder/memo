"use strict";
onmessage = async ({ data }) => {
  const { condition, measurement, dbName, conditionId, workerId, requestId, session } = data;
  const observed = { requestSuccess: false, transactionTerminal: "UNKNOWN", closeCalled: false, connectionClosed: "UNKNOWN", versionchange: false };
  const events = [];
  const event = (name, details = {}) => {
    const entry = { event: name, workerMs: performance.now(), ...details }; events.push(entry);
    if (measurement === "detailed") postMessage({ kind: "event", conditionId, workerId, requestId, session, entry });
  };
  const ready = () => postMessage({ kind: "boundary", conditionId, workerId, requestId, session, observed: { ...observed }, events: [...events], workerMs: performance.now() });
  let db;
  try {
    event("worker_ready"); event("db_open_start", { requestedVersion: null });
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onupgradeneeded = () => { req.transaction.abort(); reject(new Error("fixture_missing")); };
      req.onblocked = () => event("db_open_blocked");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { event("db_open_success", { dbVersion: req.result.version }); resolve(req.result); };
    });
    db.onversionchange = eventObject => { observed.versionchange = true; event("versionchange", { oldVersion: eventObject.oldVersion, newVersion: eventObject.newVersion }); };
    db.onclose = () => { observed.connectionClosed = "close_event"; event("connection_close_event"); };
    const tx = db.transaction("notes", "readonly"); event("transaction_start", { mode: tx.mode });
    tx.oncomplete = () => {
      observed.transactionTerminal = "complete"; event("transaction_complete");
      if (condition === "A") { db.close(); observed.closeCalled = true; event("db_close_called", { outcome: "returned", connectionClosed: "UNKNOWN" }); }
      if (condition === "A" || condition === "C") ready();
    };
    tx.onabort = () => { observed.transactionTerminal = "abort"; event("transaction_abort"); ready(); };
    tx.onerror = () => event("transaction_error");
    const req = tx.objectStore("notes").getAll();
    req.onerror = () => { event("request_error"); ready(); };
    req.onsuccess = () => {
      observed.requestSuccess = true; observed.rowCount = req.result.length; event("request_success", { rowCount: req.result.length });
      if (condition === "B") { ready(); while (true) {} }
    };
  } catch (error) { event("worker_error", { code: error.name || "Error" }); ready(); }
};
