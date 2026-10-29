(function (root) {
  "use strict";
  const PLAN = Object.freeze(["detailed", "minimal"].flatMap(measurement => ["A", "B", "C"].map(condition => Object.freeze({ id: `${condition}-${measurement}-1`, condition, measurement, repetition: 1 }))));
  const LIMITS = Object.freeze({ openMs: 8000, cleanupMs: 2000, contextMs: 30000, runnerMs: 480000, closeMs: 2000, maxContexts: 10 });
  function conditionEstablished(condition, observed) {
    if (!observed || observed.requestSuccess !== true || observed.rowCount !== 2) return false;
    if (condition === "A") return observed.transactionTerminal === "complete" && observed.closeCalled === true;
    if (condition === "B") return observed.transactionTerminal === "UNKNOWN" && observed.closeCalled === false;
    if (condition === "C") return observed.transactionTerminal === "complete" && observed.closeCalled === false;
    return false;
  }
  function outcome(established, upgrade, cleanup) {
    if (!established) return "CONDITION_NOT_MET";
    if (upgrade !== "PASS") return upgrade === "TIMEOUT" ? "UNKNOWN" : "FAIL";
    return cleanup === "PASS" ? "PASS" : "HOLD";
  }
  const api = { PLAN, LIMITS, conditionEstablished, outcome };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.WorkerDiagnosticPlan = api;
})(globalThis);
