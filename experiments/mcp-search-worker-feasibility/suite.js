"use strict";

window.runWorkerStudy = async (options = {}) => {
  const checks = {}, observations = {}, dbName = `worker-poc-${crypto.randomUUID()}`;
  const states = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`T${i + 1}`, "NOT_RUN"]));
  const timeline = []; let stage = "fixture.open", lastVersion = null;
  function record(event, details = {}) {
    const match = stage.match(/^(T\d+)(?: iteration (\d+))?/);
    timeline.push({ seq: timeline.length + 1, source: details.source || "main", mainMs: performance.now(),
      workerMs: details.workerMs ?? null, testId: details.testId || match?.[1] || null,
      iteration: details.iteration ?? (match?.[2] ? Number(match[2]) : null), workerId: details.workerId || null,
      session: details.session || null, requestId: details.requestId || null, dbVersion: details.dbVersion ?? null,
      event, outcome: details.outcome ?? null, ...details });
  }
  function begin(value) {
    const previous = stage.match(/^(T\d+)/)?.[1];
    if (previous && checks[previous]) states[previous] = checks[previous].startsWith("PASS") ? "PASS" : checks[previous].startsWith("HOLD") ? "HOLD" : "PARTIAL";
    stage = value; const current = value.match(/^(T\d+)/)?.[1];
    if (current) states[current] = "RUNNING";
    record("stage_start", { outcome: value });
    if (options.injectAt === value) throw new Error("injected stage failure");
  }
  if (options.stageProbe) {
    try { for (const label of ["T1.search", "T2.unresolved", "T3.terminate", "T4.recovery", "T5.stale", "T6.gate", "T7 iteration 1.upgrade", "T9.reading", "T10.race", "T12.failure-injection", "T8.snapshot", "T8.compare", "T11.summary"]) begin(label); }
    catch (error) { const id = stage.match(/^(T\d+)/)?.[1]; if (id) states[id] = "FAIL"; return { failure: `${stage}: ${error.message}`, states, timeline }; }
    return { failure: "stage probe did not inject", states, timeline };
  }
  const assert = (condition, label) => { if (!condition) throw new Error(label); };
  const deadline = (promise, label, ms = 8000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))]);
  async function open(version, initialize = false) {
    let blocked = false, expired = false;
    record("open_start", { requestedVersion: version || null, oldVersion: lastVersion });
    try { return await deadline(new Promise((resolve, reject) => {
      const request = version ? indexedDB.open(dbName, version) : indexedDB.open(dbName);
      request.onblocked = event => { blocked = true; record("open_blocked", { oldVersion: event.oldVersion, requestedVersion: event.newVersion }); };
      request.onupgradeneeded = event => {
        record("open_upgradeneeded", { dbVersion: request.result.version, oldVersion: event.oldVersion, requestedVersion: event.newVersion });
        if (initialize) {
          request.result.createObjectStore("notes", { keyPath: "id" });
          request.result.createObjectStore("metadata", { keyPath: "id" });
        }
      };
      request.onerror = () => { record("open_error", { outcome: request.error?.name }); reject(request.error); };
      request.onsuccess = () => { lastVersion = request.result.version; record("open_success", { dbVersion: lastVersion, outcome: expired ? "late" : "received" }); if (expired) request.result.close(); else resolve(request.result); };
    }), "IndexedDB open timeout"); }
    catch (error) { expired = true; record("open_timeout_or_error", { outcome: error.message, blockedObserved: blocked, requestedVersion: version || null, oldVersion: lastVersion }); throw new Error(`${error.message}; blocked event: ${blocked}`); }
  }
  async function snapshot() {
    const db = await open();
    try {
      const names = [...db.objectStoreNames].sort();
      const transaction = db.transaction(names, "readonly");
      record("snapshot_transaction_start", { mode: transaction.mode, dbVersion: db.version });
      transaction.oncomplete = () => record("snapshot_transaction_complete");
      transaction.onabort = () => record("snapshot_transaction_abort");
      transaction.onerror = () => record("snapshot_transaction_error");
      const data = await Promise.all(names.map(name => new Promise((resolve, reject) => {
        const request = transaction.objectStore(name).getAll();
        request.onsuccess = () => { record("snapshot_request_success", { store: name }); resolve([name, request.result]); }; request.onerror = () => { record("snapshot_request_error", { store: name }); reject(request.error); };
      })));
      return JSON.stringify(data);
    } finally { db.close(); record("snapshot_close_called", { outcome: "returned", connectionClosed: "UNKNOWN" }); }
  }
  let version = 1, sequence = 0, created = 0, terminated = 0, maxActive = 0, readwrite = 0;
  const active = new Map(), generations = new Map(), deliveries = [];
  const transactionModes = [];
  function accept(session, entry, message) {
    return active.get(session) === entry && entry.enabled && message.workerId === entry.workerId
      && message.generation === entry.generation && message.requestId === entry.requestId;
  }
  function start(session, mode = "normal", operation = "search", query = "架空", destination = `destination-${session}`) {
    if (active.has(session) || active.size >= 2) throw new Error("capacity");
    const generation = (generations.get(session) || 0) + 1; generations.set(session, generation);
    const workerId = `worker-${++sequence}`, requestId = `request-${sequence}`, worker = new Worker("worker.js");
    const entry = { session, generation, workerId, requestId, worker, destination, enabled: true, deferResult: mode === "race", events: [], waiters: [] };
    active.set(session, entry); created++; maxActive = Math.max(maxActive, active.size);
    record("worker_created", { session, workerId, requestId, generation, dbVersion: version });
    worker.onmessage = ({ data }) => {
      record("worker_message", { source: "worker", workerMs: data.workerMs, testId: data.testId, iteration: data.iteration, session, workerId, requestId, generation, dbVersion: data.dbVersion ?? version, workerEvent: data.phase, mode: data.transactionMode || null, outcome: data.outcome || null });
      if (!accept(session, entry, data)) { record("old_message_rejected", { session, workerId, requestId, generation }); return; }
      if (data.phase === "transaction") { transactionModes.push(data.transactionMode); if (data.transactionMode === "readwrite") readwrite++; }
      if (data.phase === "result" && !entry.deferResult) { deliveries.push({ session, destination, workerId, generation, requestId, result: data.result }); record("result_delivered", { session, workerId, requestId, generation, destination }); }
      entry.events.push(data);
      for (const waiter of [...entry.waiters]) if (waiter.phase === data.phase) { entry.waiters.splice(entry.waiters.indexOf(waiter), 1); waiter.resolve(data); }
    };
    worker.onerror = event => { record("worker_error", { session, workerId, requestId, outcome: event.message }); for (const waiter of entry.waiters.splice(0)) waiter.reject(new Error(event.message)); };
    worker.postMessage({ workerId, generation, requestId, dbName, mode, operation, query, session, testId: stage.match(/^(T\d+)/)?.[1] || null, iteration: Number(stage.match(/iteration (\d+)/)?.[1]) || null });
    return entry;
  }
  function phase(entry, name) {
    const found = entry.events.find(event => event.phase === name);
    return found ? Promise.resolve(found) : deadline(new Promise((resolve, reject) => entry.waiters.push({ phase: name, resolve, reject })), `phase ${name}`);
  }
  function stop(entry, injectedFailure = false) {
    entry.enabled = false; // 先に配送権限を無効化。
    record("worker_stop_requested", { session: entry.session, workerId: entry.workerId, requestId: entry.requestId, generation: entry.generation });
    record("worker_state_at_stop", { session: entry.session, workerId: entry.workerId, requestId: entry.requestId,
      transactionTerminal: entry.events.findLast(event => ["transaction_complete", "transaction_abort", "transaction_error"].includes(event.phase))?.phase || "UNKNOWN",
      connectionClosed: entry.events.some(event => event.phase === "db_close_event") ? "close_event" : "UNKNOWN" });
    try {
      if (injectedFailure) throw new Error("injected termination failure");
      record("terminate_call", { session: entry.session, workerId: entry.workerId, requestId: entry.requestId });
      entry.worker.terminate();
      record("terminate_return", { session: entry.session, workerId: entry.workerId, requestId: entry.requestId, outcome: "returned", connectionClosed: "UNKNOWN" });
      terminated++; active.delete(entry.session);
      entry.worker.onmessage = null; entry.worker.onerror = null;
      return true;
    } catch { record("terminate_failure", { session: entry.session, workerId: entry.workerId, requestId: entry.requestId }); return false; } // 終了未確認の枠は再利用しない。
  }
  async function upgrade() { const db = await open(++version); db.close(); record("upgrade_close_called", { dbVersion: version, outcome: "returned", connectionClosed: "UNKNOWN" }); }
  try {
  begin("fixture.open"); const db = await open(version, true);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["notes", "metadata"], "readwrite"); // fixture初期化のみ。検索対象期間外。
    record("fixture_transaction_start", { mode: tx.mode });
    tx.objectStore("notes").put({ id: "n1", title: "架空のメモ", body: "架空本文" });
    tx.objectStore("notes").put({ id: "n2", title: "別のメモ", body: "別の架空本文" });
    tx.objectStore("metadata").put({ id: "m1", value: "fixture" });
    tx.oncomplete = () => { record("fixture_transaction_complete"); resolve(); };
    tx.onerror = () => { record("fixture_transaction_error"); reject(tx.error); };
    tx.onabort = () => { record("fixture_transaction_abort"); reject(tx.error); };
  });
  db.close(); record("fixture_close_called", { outcome: "returned", connectionClosed: "UNKNOWN" });
  begin("fixture.snapshot"); const before = await snapshot();
    begin("T1.search");
    const startupStart = performance.now(); let a = start("A"); const normal = await phase(a, "result");
    observations.searchStartupToResultMs = performance.now() - startupStart;
    assert(normal.result.length === 1 && normal.result[0].id === "n1", "T1 search"); stop(a);
    begin("T1.read"); const read = start("A", "normal", "read"); assert((await phase(read, "result")).result[0].body === "架空本文", "T1 read"); stop(read); checks.T1 = "PASS（検索・全文のPoC）";
    begin("T2.unresolved");
    a = start("A", "unresolved"); await phase(a, "unresolved");
    assert(!a.events.some(event => event.phase === "result"), "T2 pending"); checks.T2 = "PASS";
    begin("T3.terminate"); const stopStart = performance.now(); assert(stop(a), "T3 stop");
    observations.terminateCallMs = performance.now() - stopStart; checks.T3 = "PASS";
    begin("T4.recovery"); let next = start("A"); assert((await phase(next, "result")).result[0].id === "n1", "T4 recovery"); stop(next); checks.T4 = "PASS";
    begin("T5.stale");
    a = start("A", "ready"); const ready = await phase(a, "ready"); stop(a);
    next = start("A"); assert(!accept("A", a, { ...ready, phase: "result" }), "T5 stale");
    await phase(next, "result"); stop(next); checks.T5 = "PASS";
    begin("T6.gate"); a = start("A", "unresolved", "search", "架空", "destination-A");
    const b = start("B", "gate", "search", "別", "destination-B"); await phase(a, "unresolved"); await phase(b, "gate_wait");
    assert(a.workerId !== b.workerId && a.requestId !== b.requestId && a.session !== b.session && a.destination !== b.destination, "T6 distinct identities");
    assert(!b.events.some(event => event.phase === "result") && !deliveries.some(item => item.workerId === b.workerId), "T6 premature B result");
    for (const [field, value] of [["workerId", "wrong-worker"], ["generation", b.generation + 1], ["requestId", "wrong-request"]]) {
      assert(!accept("B", b, { workerId: b.workerId, generation: b.generation, requestId: b.requestId, [field]: value }), `T6 ${field}`);
    }
    assert(!accept("A", b, { workerId: b.workerId, generation: b.generation, requestId: b.requestId }), "T6 wrong session");
    begin("T6.stop-A"); assert(stop(a), "T6 A stop request");
    assert(!b.events.some(event => event.phase === "result") && !deliveries.some(item => item.workerId === b.workerId), "T6 result before gate release");
    record("gate_release", { session: b.session, workerId: b.workerId, requestId: b.requestId, destination: b.destination });
    b.worker.postMessage({ control: "release" }); begin("T6.B-result");
    const afterStop = await phase(b, "result");
    assert(afterStop.result.length === 1 && afterStop.result[0].id === "n2", "T6 fresh B result");
    assert(deliveries.some(item => item.workerId === b.workerId && item.session === "B" && item.destination === "destination-B" && item.result[0].id === "n2"), "T6 destination");
    assert(!deliveries.some(item => item.workerId === a.workerId) && !accept("A", a, { workerId: a.workerId, generation: a.generation, requestId: a.requestId }), "T6 no A delivery");
    observations.T6 = { aSession: a.session, bSession: b.session, aWorkerId: a.workerId, bWorkerId: b.workerId,
      aRequestId: a.requestId, bRequestId: b.requestId, aDestination: a.destination, bDestination: b.destination,
      aExpectedResultId: "n1", bResultId: afterStop.result[0].id, aStopRequestedBeforeGateRelease: true, bResultBeforeStop: false };
    stop(b); checks.T6 = "PASS（停止要求後のB新規配送。実認可は未実装）";
    begin("T7");
    for (let i = 0; i < 12; i++) { begin(`T7 iteration ${i + 1}.worker`); const item = start("A", "unresolved"); await phase(item, "unresolved"); stop(item); begin(`T7 iteration ${i + 1}.upgrade`); await upgrade(); }
    assert(active.size === 0 && maxActive <= 2 && created === terminated, "T7 bounds");
    observations.repetitions = 12; observations.created = created; observations.terminated = terminated; observations.maxManagedWorkers = maxActive;
    checks.T7 = "PARTIAL（12回の管理参照・DB upgrade観測のみ。実メモリとOS資源は未測定）";
    for (const mode of ["reading", "transaction_wait", "generating"]) {
      begin(`T9.${mode}`);
      const item = start("A", mode); await phase(item, mode); stop(item);
      const replacement = start("A"); assert((await phase(replacement, "result")).result[0].id === "n1", `T9 ${mode}`); stop(replacement); await upgrade();
    }
    checks.T9 = "PARTIAL（読取コールバック・要求待機・生成中の停止後に読取・upgradeを観測。実際のロック競合待機は未試験）";
    begin("T10.race"); a = start("A", "race"); const queued = await phase(a, "result");
    const deliveredBefore = deliveries.length; stop(a); next = start("A");
    assert(!accept("A", a, { ...queued, phase: "result" }), "T10 stale envelope");
    await phase(next, "result"); assert(deliveries.length === deliveredBefore + 1, "T10 delivery"); stop(next); checks.T10 = "PASS（実メッセージの採用保留後に停止・再照合）";
    begin("T12.failure-injection"); const failing = start("A", "unresolved"); await phase(failing, "unresolved");
    assert(!stop(failing, true) && active.has("A") && !failing.enabled, "T12 hold");
    let denied = false; try { start("A"); } catch { denied = true; }
    assert(denied, "T12 no replacement");
    assert(stop(failing), "T12 cleanup"); await upgrade();
    checks.T12 = "HOLD（終了失敗を注入すると枠を保持し配送・再利用を拒否。実際の失敗と解放の確認は未実証）";
    begin("T8.snapshot"); const after = await snapshot(); begin("T8.compare"); assert(before === after, "T8 unchanged"); assert(readwrite === 0, "T8 worker write");
    checks.T8 = "PASS（全2ストア内容一致、Workerのreadwrite 0件。fixture生成時の初期書込は別）";
    observations.workerTransactions = transactionModes.length; observations.workerReadwrite = readwrite;
    observations.finalActive = active.size; observations.finalCreated = created; observations.finalTerminated = terminated;
    observations.deliveryCount = deliveries.length; observations.finalVersion = version;
    begin("T11.summary"); checks.T11 = "PARTIAL（エンジン間比較と実機は別途）"; states.T11 = "PARTIAL";
    return { checks, states, timeline, observations, limitations: ["実メモ・実認可・実配送は使わない", "メモリ・OSスレッド・ブラウザ内部の実資源解放時刻は未測定", "terminateは完了通知を返さない", "fixture生成だけはreadwrite"] };
  } catch (error) {
    const failed = stage.match(/^(T\d+)/)?.[1]; if (failed) states[failed] = "FAIL";
    record("stage_failure", { outcome: error.message });
    return { checks, states, timeline, observations: { ...observations, activeAtFailure: active.size, createdAtFailure: created, terminatedAtFailure: terminated },
      failure: `${stage}: ${error.message}`, limitations: ["未完了の試験は未実証", "内部資源の解放時刻は未測定"] };
  }
  finally {
    for (const item of active.values()) { try { item.worker.terminate(); } catch {} }
    indexedDB.deleteDatabase(dbName);
  }
};
