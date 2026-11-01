"use strict";
const { build, replaceOnce } = require("../idb-upgrade-lifecycle/source.cjs");
const { waitForTransactionComplete } = require("./wait.cjs");
function buildF(suite, worker, observer) {
  const baseline = build(suite, worker, observer, false, false), changes = [];
  let generated = baseline.worker;
  const edit = (before, after) => { changes.push({ file: "worker.js", before, after }); generated = replaceOnce(generated, before, after); };
  edit('const __workerLife = installLifecycleObserver(event => postMessage({__lifecycle:event}),',
    'const __fTransactionErrors = new Set();\nconst __workerLife = installLifecycleObserver(event => { if(event.event === "transaction_error") __fTransactionErrors.add(event.transactionId); postMessage({__lifecycle:event}); },');
  const send = 'const send = (phase, extra = {}) => postMessage({ workerId, generation, requestId, session, testId, iteration, workerMs: performance.now(), phase, ...extra });';
  edit(send, 'const send = (phase, extra = {}) => { if (phase === "request_success" || phase === "unresolved") __workerLife.log(phase === "request_success" ? "getAll_success" : "unresolved_send", { ...__workerLife.state.transactions.at(-1), logicalRequestId: requestId }); postMessage({ workerId, generation, requestId, session, testId, iteration, workerMs: performance.now(), phase, ...extra }); };');
  edit('if (mode === "unresolved") { send("unresolved");',
    'if (mode === "unresolved") { if (testId === "T7") await waitForTransactionComplete(transactionDone, transaction, __workerLife, __fTransactionErrors); send("unresolved");');
  const prefix = waitForTransactionComplete.toString() + "\n";
  return { suite: baseline.suite, worker: prefix + generated, changes, prefix, baselineChanges: baseline.changes,
    baselineSuite: baseline.suite, baselineWorker: baseline.worker };
}
module.exports = { buildF };
