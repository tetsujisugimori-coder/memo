"use strict";
// Additional listeners only. No abort, close, delete, retry, DB reads, or transaction writes are initiated here.
function installStage5IdbObserver(emit, realm) {
  let sequence = 0, connectionSerial = 0, requestSerial = 0, transactionSerial = 0;
  const connections = new WeakMap(), transactions = new WeakSet();
  const started = performance.now();
  const record = (event, details = {}) => emit({ source: realm(), sourceSeq: ++sequence, sourceMs: performance.now(),
    elapsedMs: performance.now() - started, event, ...details });
  function watchTransaction(tx, connection, kind) {
    if (!tx || transactions.has(tx)) return;
    transactions.add(tx); const transactionId = `${connection.connectionId}/tx-${++transactionSerial}`;
    const details = { ...connection, transactionId, mode: tx.mode, kind };
    record("transaction_created", details);
    for (const event of ["complete", "abort", "error"]) tx.addEventListener(event, () => record(`transaction_${event}`, details));
  }
  function watchConnection(db, name) {
    if (connections.has(db)) return connections.get(db);
    const details = { dbName: name, connectionId: `${realm()}/connection-${++connectionSerial}`, dbVersion: db.version };
    connections.set(db, details); record("connection_observed", details);
    for (const event of ["close", "versionchange", "error"]) db.addEventListener(event, e => record(`connection_${event}`, { ...details, oldVersion: e.oldVersion, newVersion: e.newVersion }));
    return details;
  }
  for (const operation of ["open", "deleteDatabase"]) {
    const original = IDBFactory.prototype[operation];
    IDBFactory.prototype[operation] = function (...args) {
      const dbName = String(args[0]), requestId = `${realm()}/request-${++requestSerial}`;
      const details = { requestId, dbName, requestedVersion: args[1] ?? null };
      record(`${operation}_call`, details);
      let request;
      try { request = Reflect.apply(original, this, args); }
      catch (e) { record(`${operation}_throw`, { ...details, error: e.name }); throw e; }
      record(`${operation}_returned`, { ...details, readyState: request.readyState });
      for (const event of ["upgradeneeded", "blocked", "success", "error"]) request.addEventListener(event, e => {
        let connection = {};
        if (operation === "open" && ["upgradeneeded", "success"].includes(event)) {
          connection = watchConnection(request.result, dbName);
          if (event === "upgradeneeded") watchTransaction(request.transaction, connection, "upgrade");
        }
        record(`${operation}_${event}`, { ...details, ...connection, oldVersion: e.oldVersion, newVersion: e.newVersion,
          readyState: request.readyState, error: event === "error" ? request.error?.name : null });
      });
      return request;
    };
  }
  const transaction = IDBDatabase.prototype.transaction, close = IDBDatabase.prototype.close;
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = Reflect.apply(transaction, this, args);
    watchTransaction(tx, watchConnection(this, this.name), "explicit"); return tx;
  };
  IDBDatabase.prototype.close = function (...args) {
    const details = watchConnection(this, this.name); record("connection_close_call", details);
    try { const result = Reflect.apply(close, this, args); record("connection_close_return", { ...details, physicalRelease: "UNKNOWN" }); return result; }
    catch (e) { record("connection_close_throw", { ...details, error: e.name }); throw e; }
  };
  record("observer_installed");
}
