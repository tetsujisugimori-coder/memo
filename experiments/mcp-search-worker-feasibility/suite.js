"use strict";

window.runWorkerStudy = async () => {
  const checks = {}, observations = {}, dbName = `worker-poc-${crypto.randomUUID()}`;
  const assert = (condition, label) => { if (!condition) throw new Error(label); };
  const deadline = (promise, label, ms = 8000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))]);
  async function open(version, initialize = false) {
    let blocked = false, expired = false;
    try { return await deadline(new Promise((resolve, reject) => {
      const request = version ? indexedDB.open(dbName, version) : indexedDB.open(dbName);
      request.onblocked = () => { blocked = true; };
      request.onupgradeneeded = () => {
        if (initialize) {
          request.result.createObjectStore("notes", { keyPath: "id" });
          request.result.createObjectStore("metadata", { keyPath: "id" });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { if (expired) request.result.close(); else resolve(request.result); };
    }), "IndexedDB open timeout"); }
    catch (error) { expired = true; throw new Error(`${error.message}; blocked event: ${blocked}`); }
  }
  async function snapshot() {
    const db = await open();
    try {
      const names = [...db.objectStoreNames].sort();
      const transaction = db.transaction(names, "readonly");
      const data = await Promise.all(names.map(name => new Promise((resolve, reject) => {
        const request = transaction.objectStore(name).getAll();
        request.onsuccess = () => resolve([name, request.result]); request.onerror = () => reject(request.error);
      })));
      return JSON.stringify(data);
    } finally { db.close(); }
  }
  let version = 1, sequence = 0, created = 0, terminated = 0, maxActive = 0, readwrite = 0;
  const active = new Map(), generations = new Map(), deliveries = [];
  const transactionModes = [];
  function accept(session, entry, message) {
    return active.get(session) === entry && entry.enabled && message.workerId === entry.workerId
      && message.generation === entry.generation && message.requestId === entry.requestId;
  }
  function start(session, mode = "normal", operation = "search") {
    if (active.has(session) || active.size >= 2) throw new Error("capacity");
    const generation = (generations.get(session) || 0) + 1; generations.set(session, generation);
    const workerId = `worker-${++sequence}`, requestId = `request-${sequence}`, worker = new Worker("worker.js");
    const entry = { session, generation, workerId, requestId, worker, enabled: true, deferResult: mode === "race", events: [], waiters: [] };
    active.set(session, entry); created++; maxActive = Math.max(maxActive, active.size);
    worker.onmessage = ({ data }) => {
      if (!accept(session, entry, data)) return;
      if (data.phase === "transaction") { transactionModes.push(data.transactionMode); if (data.transactionMode === "readwrite") readwrite++; }
      if (data.phase === "result" && !entry.deferResult) deliveries.push({ session, workerId, generation, requestId, result: data.result });
      entry.events.push(data);
      for (const waiter of [...entry.waiters]) if (waiter.phase === data.phase) { entry.waiters.splice(entry.waiters.indexOf(waiter), 1); waiter.resolve(data); }
    };
    worker.onerror = event => { for (const waiter of entry.waiters.splice(0)) waiter.reject(new Error(event.message)); };
    worker.postMessage({ workerId, generation, requestId, dbName, mode, operation, query: "架空" });
    return entry;
  }
  function phase(entry, name) {
    const found = entry.events.find(event => event.phase === name);
    return found ? Promise.resolve(found) : deadline(new Promise((resolve, reject) => entry.waiters.push({ phase: name, resolve, reject })), `phase ${name}`);
  }
  function stop(entry, injectedFailure = false) {
    entry.enabled = false; // 先に配送権限を無効化。
    try {
      if (injectedFailure) throw new Error("injected termination failure");
      entry.worker.terminate();
      terminated++; active.delete(entry.session);
      entry.worker.onmessage = null; entry.worker.onerror = null;
      return true;
    } catch { return false; } // 終了未確認の枠は再利用しない。
  }
  async function upgrade() { const db = await open(++version); db.close(); }
  const db = await open(version, true);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["notes", "metadata"], "readwrite"); // fixture初期化のみ。検索対象期間外。
    tx.objectStore("notes").put({ id: "n1", title: "架空のメモ", body: "架空本文" });
    tx.objectStore("notes").put({ id: "n2", title: "別のメモ", body: "別の架空本文" });
    tx.objectStore("metadata").put({ id: "m1", value: "fixture" });
    tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
  });
  db.close(); const before = await snapshot();
  let stage = "T1";
  try {
    const startupStart = performance.now(); let a = start("A"); const normal = await phase(a, "result");
    observations.searchStartupToResultMs = performance.now() - startupStart;
    assert(normal.result.length === 1 && normal.result[0].id === "n1", "T1 search"); stop(a);
    const read = start("A", "normal", "read"); assert((await phase(read, "result")).result[0].body === "架空本文", "T1 read"); stop(read); checks.T1 = "PASS（検索・全文のPoC）";
    a = start("A", "unresolved"); await phase(a, "unresolved");
    assert(!a.events.some(event => event.phase === "result"), "T2 pending"); checks.T2 = "PASS";
    const stopStart = performance.now(); assert(stop(a), "T3 stop");
    observations.terminateCallMs = performance.now() - stopStart; checks.T3 = "PASS";
    let next = start("A"); assert((await phase(next, "result")).result[0].id === "n1", "T4 recovery"); stop(next); checks.T4 = "PASS";
    a = start("A", "ready"); const ready = await phase(a, "ready"); stop(a);
    next = start("A"); assert(!accept("A", a, { ...ready, phase: "result" }), "T5 stale");
    await phase(next, "result"); stop(next); checks.T5 = "PASS";
    a = start("A", "unresolved"); const b = start("B"); await phase(a, "unresolved");
    stop(a); assert((await phase(b, "result")).result[0].id === "n1", "T6 B"); stop(b); checks.T6 = "PARTIAL（PoCのセッション結果分離のみ、実認可状態は未実装）";
    stage = "T7";
    for (let i = 0; i < 12; i++) { stage = `T7 iteration ${i + 1}`; const item = start("A", "unresolved"); await phase(item, "unresolved"); stop(item); await upgrade(); }
    assert(active.size === 0 && maxActive <= 2 && created === terminated, "T7 bounds");
    observations.repetitions = 12; observations.created = created; observations.terminated = terminated; observations.maxManagedWorkers = maxActive;
    checks.T7 = "PARTIAL（12回の管理参照・DB upgrade観測のみ。実メモリとOS資源は未測定）";
    for (const mode of ["reading", "transaction_wait", "generating"]) {
      stage = `T9 ${mode}`;
      const item = start("A", mode); await phase(item, mode); stop(item);
      const replacement = start("A"); assert((await phase(replacement, "result")).result[0].id === "n1", `T9 ${mode}`); stop(replacement); await upgrade();
    }
    checks.T9 = "PARTIAL（読取コールバック・要求待機・生成中の停止後に読取・upgradeを観測。実際のロック競合待機は未試験）";
    stage = "T10"; a = start("A", "race"); const queued = await phase(a, "result");
    const deliveredBefore = deliveries.length; stop(a); next = start("A");
    assert(!accept("A", a, { ...queued, phase: "result" }), "T10 stale envelope");
    await phase(next, "result"); assert(deliveries.length === deliveredBefore + 1, "T10 delivery"); stop(next); checks.T10 = "PASS（実メッセージの採用保留後に停止・再照合）";
    stage = "T12"; const failing = start("A", "unresolved"); await phase(failing, "unresolved");
    assert(!stop(failing, true) && active.has("A") && !failing.enabled, "T12 hold");
    let denied = false; try { start("A"); } catch { denied = true; }
    assert(denied, "T12 no replacement");
    assert(stop(failing), "T12 cleanup"); await upgrade();
    checks.T12 = "HOLD（終了失敗を注入すると枠を保持し配送・再利用を拒否。実際の失敗と解放の確認は未実証）";
    assert(before === await snapshot(), "T8 unchanged"); assert(readwrite === 0, "T8 worker write");
    checks.T8 = "PASS（全2ストア内容一致、Workerのreadwrite 0件。fixture生成時の初期書込は別）";
    observations.workerTransactions = transactionModes.length; observations.workerReadwrite = readwrite;
    observations.finalActive = active.size; observations.finalCreated = created; observations.finalTerminated = terminated;
    observations.deliveryCount = deliveries.length; observations.finalVersion = version;
    return { checks, observations, limitations: ["実メモ・実認可・実配送は使わない", "メモリ・OSスレッド・ブラウザ内部の実資源解放時刻は未測定", "terminateは完了通知を返さない", "fixture生成だけはreadwrite"] };
  } catch (error) {
    return { checks, observations: { ...observations, activeAtFailure: active.size, createdAtFailure: created, terminatedAtFailure: terminated },
      failure: `${stage}: ${error.message}`, limitations: ["未完了の試験は未実証", "内部資源の解放時刻は未測定"] };
  }
  finally {
    for (const item of active.values()) { try { item.worker.terminate(); } catch {} }
    indexedDB.deleteDatabase(dbName);
  }
};
