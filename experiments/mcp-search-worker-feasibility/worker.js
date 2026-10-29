"use strict";

// 実データに接続しないPoC。認証情報や配送先は受け取らない。
onmessage = async ({ data }) => {
  const { workerId, generation, requestId, dbName, mode } = data;
  const send = (phase, extra = {}) => postMessage({ workerId, generation, requestId, phase, ...extra });
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error("fixture_missing")); };
    });
    db.onversionchange = () => db.close();
    const transaction = db.transaction("notes", "readonly");
    send("transaction", { transactionMode: transaction.mode });
    const request = transaction.objectStore("notes").getAll();
    if (mode === "transaction_wait") {
      send("transaction_wait");
      while (true) {} // 強制停止対象。transactionの完了を待たない。
    }
    const rows = await new Promise((resolve, reject) => {
      request.onsuccess = () => {
        if (mode === "reading") { send("reading"); while (true) {} }
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
    if (mode === "unresolved") { send("unresolved"); await new Promise(() => {}); }
    const result = [];
    for (const row of rows) {
      if (mode === "generating") { send("generating"); while (true) {} }
      if (data.operation === "read" && row.id === "n1") result.push({ id: row.id, body: row.body });
      else if (data.operation === "search" && row.title.includes(data.query)) result.push({ id: row.id, title: row.title });
    }
    if (mode === "ready") { send("ready", { result }); await new Promise(() => {}); }
    send("result", { result });
    if (mode === "race") await new Promise(() => {});
    db.close();
  } catch (error) {
    db?.close(); send("error", { code: error.name || "Error" });
  }
};
