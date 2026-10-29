"use strict";

// 実データに接続しないPoC。認証情報や配送先は受け取らない。
let releaseGate;
onmessage = async ({ data }) => {
  if (data.control === "release") { if (releaseGate) releaseGate(); return; }
  const { workerId, generation, requestId, dbName, mode, session, testId, iteration } = data;
  const send = (phase, extra = {}) => postMessage({ workerId, generation, requestId, session, testId, iteration, workerMs: performance.now(), phase, ...extra });
  send("worker_ready");
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      send("db_open_start");
      const request = indexedDB.open(dbName);
      request.onblocked = () => send("db_open_blocked");
      request.onsuccess = () => { send("db_open_success", { dbVersion: request.result.version }); resolve(request.result); };
      request.onerror = () => { send("db_open_error", { code: request.error?.name }); reject(request.error); };
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error("fixture_missing")); };
    });
    db.onversionchange = () => { send("db_versionchange", { dbVersion: db.version }); try { db.close(); send("db_close_called", { outcome: "returned" }); } catch (error) { send("db_close_called", { outcome: "threw", code: error.name }); } };
    db.onclose = () => send("db_close_event");
    const transaction = db.transaction("notes", "readonly");
    send("transaction", { transactionMode: transaction.mode, dbVersion: db.version });
    const transactionDone = new Promise(resolve => {
      transaction.oncomplete = () => { send("transaction_complete"); resolve("complete"); };
      transaction.onabort = () => { send("transaction_abort"); resolve("abort"); };
      transaction.onerror = () => send("transaction_error");
    });
    const request = transaction.objectStore("notes").getAll();
    if (mode === "transaction_wait") {
      send("transaction_wait");
      while (true) {} // 強制停止対象。transactionの完了を待たない。
    }
    const rows = await new Promise((resolve, reject) => {
      request.onsuccess = () => {
        send("request_success");
        if (mode === "reading") { send("reading"); while (true) {} }
        resolve(request.result);
      };
      request.onerror = () => { send("request_error", { code: request.error?.name }); reject(request.error); };
    });
    if (mode === "unresolved") { send("unresolved"); await new Promise(() => {}); }
    if (mode === "gate") { send("gate_wait"); await new Promise(resolve => { releaseGate = resolve; }); send("gate_released"); }
    if (mode === "close") {
      if (await transactionDone !== "complete") throw new Error("fixture_transaction_failed");
      try { db.close(); send("db_close_called", { outcome: "returned" }); } catch (error) { send("db_close_called", { outcome: "threw", code: error.name }); }
      send("closed_ready"); return;
    }
    const result = [];
    for (const row of rows) {
      if (mode === "generating") { send("generating"); while (true) {} }
      if (data.operation === "read" && row.id === "n1") result.push({ id: row.id, body: row.body });
      else if (data.operation === "search" && row.title.includes(data.query)) result.push({ id: row.id, title: row.title });
    }
    if (mode === "ready") { send("ready", { result }); await new Promise(() => {}); }
    send("result", { result });
    if (mode === "race") await new Promise(() => {});
    db.close(); send("db_close_called", { outcome: "returned" });
  } catch (error) {
    if (db) { try { db.close(); send("db_close_called", { outcome: "returned" }); } catch (closeError) { send("db_close_called", { outcome: "threw", code: closeError.name }); } } send("error", { code: error.name || "Error" });
  }
};
