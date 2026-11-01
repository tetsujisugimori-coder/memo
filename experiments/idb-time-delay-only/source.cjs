"use strict";
const { build, replaceOnce } = require("../idb-upgrade-lifecycle/source.cjs");
const { fixedDelay, observedTerminal } = require("./delay.cjs");
const decision = require("./delay-decision.json");
function buildG(suite, worker, observer) {
  if (decision.delayMs !== 1 || decision.eligibility !== "PASS") throw new Error("G_preregistration_mismatch");
  const baseline = build(suite, worker, observer, false, false), changes = [];
  let generated = baseline.worker;
  const edit = (before, after) => { changes.push({ file: "worker.js", before, after }); generated = replaceOnce(generated, before, after); };
  edit('const __workerLife = installLifecycleObserver(event => postMessage({__lifecycle:event}),',
    'const __gErrors = new Set();\nconst __workerLife = installLifecycleObserver(event => { if(event.event === "transaction_error") __gErrors.add(event.transactionId); postMessage({__lifecycle:event}); },');
  edit('const send = (phase, extra = {}) => postMessage({ workerId, generation, requestId, session, testId, iteration, workerMs: performance.now(), phase, ...extra });',
    'const send = (phase, extra = {}) => { if (phase === "request_success" || phase === "unresolved") { const state = __workerLife.state.transactions.at(-1); __workerLife.log(phase === "request_success" ? "getAll_success" : "unresolved_send", { ...state, logicalRequestId: requestId, observedTerminal: observedTerminal(state, __gErrors) }); } postMessage({ workerId, generation, requestId, session, testId, iteration, workerMs: performance.now(), phase, ...extra }); };');
  edit('if (mode === "unresolved") { send("unresolved");',
    'if (mode === "unresolved") { if (testId === "T7") await fixedDelay(1, __workerLife); send("unresolved");');
  const prefix = fixedDelay.toString() + "\n" + observedTerminal.toString() + "\n";
  return { suite: baseline.suite, worker: prefix + generated, changes, prefix, baselineChanges: baseline.changes, baselineSuite: baseline.suite, baselineWorker: baseline.worker };
}
module.exports = { buildG };
