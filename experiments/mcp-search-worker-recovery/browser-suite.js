'use strict';
window.runRecoveryStudy = async () => {
  const dbName = `recovery-fixture-${crypto.randomUUID()}`;
  const checks = []; const assert = (ok, label) => { checks.push({ label, passed: Boolean(ok) }); if (!ok) throw new Error(label); };
  let supervisor, db;
  const opening = indexedDB.open(dbName, 1);
  await new Promise((resolve, reject) => { opening.onupgradeneeded = () => opening.result.createObjectStore('notes', { keyPath: 'id' }); opening.onsuccess = () => { db = opening.result; resolve(); }; opening.onerror = () => reject(opening.error); });
  const fixture = [{ id: 'n1', title: '架空の研究', body: '# 架空\nUnicode 🐈' }, { id: 'n2', title: '架空の資料', body: 'fixture only' }];
  const tx = db.transaction('notes', 'readwrite'); fixture.forEach(row => tx.objectStore('notes').put(row));
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = reject; }); db.close();
  const snapshot = () => new Promise((resolve, reject) => {
    const r = indexedDB.open(dbName); r.onerror = () => reject(r.error); r.onsuccess = () => {
      const conn = r.result, transaction = conn.transaction('notes', 'readonly'), read = transaction.objectStore('notes').getAll(); let rows;
      read.onsuccess = () => { rows = read.result; }; transaction.oncomplete = () => { conn.close(); resolve(JSON.stringify(rows)); }; transaction.onabort = () => { conn.close(); reject(new Error('snapshot_abort')); };
    };
  });
  const before = await snapshot(); const events = [];
  const createWorker = () => {
    const worker = new Worker('worker.js'); worker.addEventListener('message', event => { if (event.data.phase === 'held') events.push('held_after_transaction_complete'); }); worker.postMessage({ initialize: dbName }); events.push('worker_created'); return worker;
  };
  supervisor = new RecoverySupervisor({ createWorker });
  let error = null;
  try {
    supervisor.authorize({ id: 'synthetic-A', expiresAt: Date.now() + 10000, allowRead: true });
    const found = await supervisor.execute({ operation: 'search', query: '架空' }); assert(found.length === 2, 'normal_search');
    const read = await supervisor.execute({ operation: 'read', id: 'n1' }); assert(read[0]?.body === fixture[0].body, 'normal_fulltext');
    assert(events.length === 1, 'normal_worker_reuse');
    let timeout; const start = performance.now(); try { await supervisor.execute({ operation: 'search', mode: 'unresolved', timeoutMs: 1000 }); } catch (e) { timeout = e.message; }
    assert(timeout === 'timeout', 'unresolved_request_timed_out'); assert(events.includes('held_after_transaction_complete'), 'actual_worker_unresolved_gate_observed'); events.push({ timeoutElapsedMs: performance.now() - start });
    supervisor.authorize({ id: 'synthetic-B', expiresAt: Date.now() + 10000, allowRead: true });
    const recovered = await supervisor.execute({ operation: 'search', query: '資料' }); assert(recovered.length === 1 && recovered[0].id === 'n2', 'new_session_recovery');
    const held = supervisor.execute({ operation: 'read', mode: 'unresolved' }); const rejection = held.then(() => 'unexpected_success', e => e.message); supervisor.cancel(); assert(await rejection === 'cancelled', 'cancelled_no_result');
    supervisor.authorize({ id: 'synthetic-C', expiresAt: Date.now() + 10000, allowRead: true });
    const blocked = await supervisor.execute({ operation: 'search' }).then(() => 'unexpected_success', e => e.message); assert(blocked === 'resource_release_unconfirmed', 'lifetime_cap_fail_closed'); assert(events.filter(x => x === 'worker_created').length === 2, 'maximum_two_worker_creations');
    assert(await snapshot() === before, 'stored_rows_unchanged');
  } catch (e) { error = e.message; }
  const state = supervisor.status(); supervisor.close();
  const cleanup = await new Promise(resolve => {
    const result = { status: 'UNKNOWN', blocked: false }; const timer = setTimeout(() => resolve(result), 2000);
    const r = indexedDB.deleteDatabase(dbName); r.onblocked = () => { result.blocked = true; }; r.onsuccess = () => { clearTimeout(timer); resolve({ ...result, status: 'PASS' }); }; r.onerror = () => { clearTimeout(timer); resolve({ ...result, status: 'FAIL' }); };
  });
  return { checks, error, state, events, cleanup, realAuthorization: 'NOT_TESTED', physicalResources: 'UNKNOWN', productionAdoption: 'HOLD' };
};
