"use strict";
function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`source anchor count: ${anchor}`);
  return source.replace(anchor, replacement);
}
function build(suite, worker, observer, cooperative = false, noWorker = false) {
  const changes = [];
  const edit = (file, src, before, after) => { changes.push({ file, before, after }); return replaceOnce(src, before, after); };
  const db = '  const checks = {}, observations = {}, dbName = `worker-poc-${crypto.randomUUID()}`;';
  suite = edit("suite.js", suite, db, db + '\n  window.__life.set({dbName});');
  suite = edit("suite.js", suite, '    stage = value; const current', '    window.__life.stage(value);\n    stage = value; const current');
  const record = '      event, outcome: details.outcome ?? null, ...details });';
  suite = edit("suite.js", suite, record, record + '\n    window.__life.note(event, details);');
  suite = edit("suite.js", suite, 'worker.onmessage = ({ data }) => receive(session, entry, data, "worker");',
    'worker.onmessage = ({ data }) => { if (data.__lifecycle) { window.__receiveLife(data.__lifecycle); return; } receive(session, entry, data, "worker"); };');
  const cleanup = '    const cleanup = await window.WorkerPocCleanup.deleteDatabaseObserved';
  suite = edit("suite.js", suite, cleanup, '    await window.__saveBeforeCleanup({ primary: report || null, events: window.__lifeEvents, mainState: window.__life.state });\n' + cleanup);
  if (noWorker) {
    const original = 'const item = start("A", "unresolved"); await phase(item, "unresolved"); stop(item);';
    suite = edit("suite.js", suite, original,
      'const local = await open(); try { await new Promise((resolve,reject)=>{const tx=local.transaction("notes","readonly"), r=tx.objectStore("notes").getAll();r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);}); } finally { local.close(); }');
  }
  if (cooperative) {
    const before = 'if (mode === "unresolved") { send("unresolved");';
    worker = edit("worker.js", worker, before,
      'if (mode === "unresolved") { if (testId === "T7") { const terminal = await transactionDone; if (terminal !== "complete") throw new Error("cooperative_transaction_failed"); db.close(); __workerLife.log("cooperative_ack", { ...__workerLife.state.connections.at(-1), transactionTerminal: terminal, closeReturned: true, connectionClosed: "UNKNOWN" }); } send("unresolved");');
  }
  const prefix = observer + '\nconst __workerLife = installLifecycleObserver(event => postMessage({__lifecycle:event}), {runId:"UNKNOWN",owner:"unassigned"});\naddEventListener("message",({data})=>{if(data.workerId)__workerLife.set({runId:data.lifecycleRunId,dbName:data.dbName,owner:data.workerId,logicalRequestId:data.requestId,iteration:data.iteration});});\n';
  suite = edit("suite.js", suite, 'worker.postMessage({ workerId, generation, requestId, dbName,',
    'worker.postMessage({ lifecycleRunId: window.__runId, workerId, generation, requestId, dbName,');
  return { suite, worker: prefix + worker, changes, workerPrefix: prefix };
}
module.exports = { replaceOnce, build };
