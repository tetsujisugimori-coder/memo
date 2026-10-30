'use strict';
// Dedicated synthetic fixture only; never accepts a product DB name or credentials.
let dbName;
onmessage = async ({ data }) => {
  if (data.initialize) { if (!dbName && /^recovery-fixture-[a-f0-9-]+$/.test(data.initialize)) dbName = data.initialize; return; }
  const { workerId, generation, requestId, session } = data;
  let db;
  try {
    if (!dbName) throw new Error('fixture_required');
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('fixture_missing')); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    db.onversionchange = () => db.close();
    const tx = db.transaction('notes', 'readonly');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(new Error('aborted')); tx.onerror = () => reject(new Error('transaction_error')); });
    const rows = await new Promise((resolve, reject) => { const r = tx.objectStore('notes').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await done;
    db.close(); db = null; // Call observed, physical connection release remains UNKNOWN.
    if (data.mode === 'unresolved') { postMessage({ workerId, generation, requestId, session, phase: 'held', transaction: 'complete', closeRequested: true }); await new Promise(() => {}); }
    const result = data.operation === 'read' ? rows.filter(r => r.id === data.id).map(r => ({ id: r.id, body: r.body })) : rows.filter(r => r.title.includes(data.query)).map(r => ({ id: r.id, title: r.title }));
    postMessage({ workerId, generation, requestId, session, phase: 'complete', transaction: 'complete', closeRequested: true, result });
  } catch { if (db) db.close(); throw new Error('fixture_read_failed'); }
};
