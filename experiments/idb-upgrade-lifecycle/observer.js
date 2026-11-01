"use strict";
// Observation only: no additional IDB request, close, abort, or connection probe.
function installLifecycleObserver(emit, initial) {
  const meta = { ...initial }, connections = new WeakMap(), transactions = new WeakMap();
  let seq = 0, cs = 0, rs = 0, ts = 0, latestOpen = null;
  const state = { connections: [], requests: [], transactions: [] };
  function log(event, details = {}) {
    emit({ runId: meta.runId, dbName: meta.dbName || "UNKNOWN", connectionId: "UNKNOWN", requestId: "UNKNOWN",
      owner: meta.owner, logicalRequestId: meta.logicalRequestId || null, iteration: meta.iteration ?? 0,
      dbVersion: null, source: meta.owner, sourceSeq: ++seq, sourceMs: performance.now(),
      event, outcome: "OBSERVED", connectionClosed: "UNKNOWN", physicalRelease: "UNKNOWN", ...details,
      source: meta.owner, clockDomain: `${meta.runId}/${meta.owner}` });
  }
  function connection(db, requestDetails = {}) {
    if (connections.has(db)) return connections.get(db);
    const c = { dbName: db.name, connectionId: `${meta.owner}/c${++cs}`, owner: meta.owner,
      requestId: requestDetails.requestId || "UNKNOWN", iteration: meta.iteration ?? 0, dbVersion: db.version,
      createdMs: performance.now(), closeCalled: false, closeReturned: false, connectionClosed: "UNKNOWN", physicalRelease: "UNKNOWN" };
    connections.set(db, c); state.connections.push(c);
    log("connection_observed", c);
    db.addEventListener("versionchange", e => log("versionchange", { ...c, oldVersion: e.oldVersion, newVersion: e.newVersion }));
    db.addEventListener("close", () => log("connection_closed_abnormal_event", { ...c, connectionClosed: "ABNORMAL_CLOSE_EVENT", physicalRelease: "UNKNOWN" }));
    return c;
  }
  function transaction(tx, c, kind) {
    if (!tx || transactions.has(tx)) return;
    const t = { ...c, transactionId: `${meta.owner}/tx${++ts}`, mode: tx.mode, kind, terminal: "UNKNOWN" };
    transactions.set(tx, t); state.transactions.push(t); log("transaction_start", t);
    for (const type of ["complete", "abort", "error"]) tx.addEventListener(type, () => {
      if (type !== "error") t.terminal = type;
      log(`transaction_${type}`, { ...t, error: tx.error?.name || null });
    });
  }
  for (const op of ["open", "deleteDatabase"]) {
    const native = IDBFactory.prototype[op];
    IDBFactory.prototype[op] = function (...args) {
      const d = { dbName: String(args[0]), requestId: `${meta.owner}/r${++rs}`, iteration: meta.iteration ?? 0,
        requestedVersion: args[1] ?? null, dbVersion: args[1] ?? null, operation: op, terminal: "UNKNOWN" };
      state.requests.push(d); if (op === "open") latestOpen = d;
      log(op === "open" ? "open_start" : "cleanup_start", d);
      let request;
      try { request = Reflect.apply(native, this, args); }
      catch (e) { log(`${op}_throw`, { ...d, outcome: e.name }); throw e; }
      for (const type of ["upgradeneeded", "blocked", "success", "error"]) request.addEventListener(type, e => {
        let c = {};
        if (op === "open" && ["upgradeneeded", "success"].includes(type)) {
          c = connection(request.result, d);
          if (type === "upgradeneeded") transaction(request.transaction, c, "upgrade");
        }
        if (["success", "error"].includes(type)) d.terminal = type;
        log(op === "open" ? `open_${type}` : `cleanup_${type}`, { ...d, ...c, requestId: d.requestId,
          oldVersion: e.oldVersion, newVersion: e.newVersion, error: type === "error" ? request.error?.name : null });
      });
      return request;
    };
  }
  const nativeTx = IDBDatabase.prototype.transaction, nativeClose = IDBDatabase.prototype.close;
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = Reflect.apply(nativeTx, this, args); transaction(tx, connection(this), "explicit"); return tx;
  };
  IDBDatabase.prototype.close = function (...args) {
    const c = connection(this); c.closeCalled = true; log("close_called", c);
    try { const value = Reflect.apply(nativeClose, this, args); c.closeReturned = true; log("close_returned", { ...c, closeRequestAcceptance: "RETURNED_NO_EXCEPTION", connectionClosed: "UNKNOWN" }); return value; }
    catch (e) { log("close_throw", { ...c, outcome: e.name }); throw e; }
  };
  return { log, state, set: details => Object.assign(meta, details),
    stage: value => { meta.iteration = Number(value.match(/iteration (\d+)/)?.[1]) || 0; },
    note: (event, details) => {
      const names = { worker_stop_requested: "worker_stop_requested", terminate_call: "worker_terminate_called",
        terminate_return: "worker_terminate_returned", worker_message: "worker_message_received", delete_finished: "cleanup_end" };
      if (names[event]) log(names[event], { ...details, owner: details.workerId || meta.owner });
      if (event === "open_timeout_or_error" && details.outcome === "IndexedDB open timeout") log("upgrade_timeout", { ...latestOpen, ...details });
    } };
}
if (typeof module !== "undefined") module.exports = { installLifecycleObserver };
