"use strict";
function analyze(trial) {
  const events = trial.value?.events || trial.partial?.events || [], primary = trial.value?.value;
  const point = e => e ? { receiveSeq: e.receiveSeq, sourceSeq: e.sourceSeq, sourceMs: e.sourceMs, clockDomain: e.clockDomain,
    event: e.event, outcome: e.outcome, connectionId: e.connectionId, requestId: e.requestId, transactionId: e.transactionId, requestedDelayMs: e.requestedDelayMs, observedTerminal: e.observedTerminal } : "NOT_OBSERVED";
  const rows = Array.from({ length: 12 }, (_, i) => {
    const iteration = i + 1, ev = events.filter(e => e.iteration === iteration);
    const first = (name, predicate = () => true) => ev.find(e => e.event === name && predicate(e));
    const worker = ev.find(e => e.source !== "main"), owner = worker?.owner;
    const w = name => first(name, e => e.source === owner);
    const get = w("getAll_success"), complete = w("transaction_complete"), start = w("delay_start"), end = w("delay_end"), send = w("unresolved_send");
    const received = first("worker_message_received", e => e.workerEvent === "unresolved" && e.owner === owner);
    const stop = first("worker_stop_requested"), terminate = first("worker_terminate_called"), returned = first("worker_terminate_returned");
    const open = first("open_start", e => e.source === "main" && e.requestedVersion === iteration + 1);
    const req = name => first(name, e => e.source === "main" && e.requestId === open?.requestId);
    const errors = ev.filter(e => e.source === owner && ["transaction_abort", "transaction_error"].includes(e.event));
    const ordered = list => list.every(Boolean) && list.every((e, j) => j === 0 || list[j - 1].receiveSeq < e.receiveSeq);
    const workerOrder = [get, start, end, send].every(Boolean) && [get, start, end, send].every((e, j, list) => j === 0 || (e.clockDomain === list[j - 1].clockDomain && e.sourceSeq > list[j - 1].sourceSeq));
    const waitValid = workerOrder && start && get.sourceSeq < start.sourceSeq && start.sourceSeq < end.sourceSeq && end.outcome === "timer_returned" && start.requestedDelayMs === 1 && end.requestedDelayMs === 1;
    const sequence = waitValid && ordered([send, received, stop, terminate, returned, open]);
    const success = req("open_success"), timeout = req("upgrade_timeout"), error = req("open_error");
    return { iteration, runId: trial.runId, dbName: trial.dbName || events.find(e => e.dbName !== "UNKNOWN")?.dbName || "UNKNOWN",
      workerId: owner || "NOT_RUN", logicalRequestId: worker?.logicalRequestId || "UNKNOWN", connectionId: get?.connectionId || "UNKNOWN", transactionId: get?.transactionId || "UNKNOWN", version: iteration,
      condition: !worker ? "NOT_RUN" : errors.length || ["abort", "error"].includes(send?.observedTerminal) ? "FAIL" : sequence ? "PASS" : "UNKNOWN",
      sendTerminal: send?.observedTerminal || "UNKNOWN", stopKnowledge: errors.some(e=>e.receiveSeq<stop?.receiveSeq && e.event==="transaction_error") ? "error" : errors.some(e=>e.receiveSeq<stop?.receiveSeq) ? "abort" : complete && stop && complete.receiveSeq < stop.receiveSeq ? "complete" : "UNKNOWN",
      actualStopTerminal: "UNKNOWN", delayMs: start && end && start.clockDomain === end.clockDomain ? end.sourceMs-start.sourceMs : null,
      getAllToSendMs: get && send && get.clockDomain === send.clockDomain ? send.sourceMs-get.sourceMs : null,
      category: errors.length ? "OTHER_ABNORMAL" : !stop || !complete || complete.receiveSeq >= stop.receiveSeq ? "E" : timeout ? "D" : success ? "A" : "OTHER", upgrade: timeout || error ? "FAIL" : success ? "PASS" : open ? "UNKNOWN" : "NOT_RUN",
      getAll: point(get), waitStart: point(start), transactionComplete: point(complete), transactionErrors: errors.map(point), waitEnd: point(end), unresolvedSend: point(send), unresolvedReceived: point(received),
      stop: point(stop), terminateCalled: point(terminate), terminateReturned: point(returned), open: point(open), upgradeneeded: point(req("open_upgradeneeded")), success: point(success), timeout: point(timeout), error: point(error),
      versionchange: ev.filter(e => e.event === "versionchange").map(point), blocked: point(req("open_blocked")), workerClose: ev.filter(e => e.source === owner && ["close_called", "close_returned", "connection_closed_abnormal_event"].includes(e.event)).map(point),
      upgradeTransaction: ev.filter(e => e.source === "main" && e.requestId === open?.requestId && e.event.startsWith("transaction_")).map(point), physicalRelease: "UNKNOWN" };
  });
  const started = rows.filter(r => r.workerId !== "NOT_RUN"), condition = started.some(r => r.condition === "FAIL") ? "FAIL" : started.length && started.every(r => r.condition === "PASS") ? "PASS" : "UNKNOWN";
  const cleanup = primary?.cleanup?.status || "UNKNOWN";
  const abnormal = events.some(e => ["transaction_abort", "transaction_error"].includes(e.event) || ["abort", "error"].includes(e.observedTerminal));
  const passed = !abnormal && rows.every(r => r.condition === "PASS" && r.upgrade === "PASS") && !primary?.failure && !primary?.error && cleanup === "PASS" && trial.precleanupSaved && !trial.pageErrors?.length && !trial.value?.overflow && !trial.error && trial.contextClose === "RETURNED" && trial.browserClose === "RETURNED";
  const upgrade = rows.every(r=>r.upgrade === "PASS") ? "PASS" : rows.some(r=>r.upgrade === "FAIL") ? "FAIL" : rows.some(r=>r.upgrade === "PASS") ? "PARTIAL" : "UNKNOWN";
  return { condition, upgrade, causalComparison: rows.some(r=>r.category === "E" && r.workerId !== "NOT_RUN") ? "UNKNOWN" : "INCONCLUSIVE", abnormal, execution: passed ? "PASS" : "FAIL", completedUpgrades: rows.filter(r => r.upgrade === "PASS").length, cleanup, failure: primary?.failure || trial.error || null, rows,
    physicalRelease: "UNKNOWN", clockRule: "Worker sourceSeq only within same clockDomain; cross-owner order uses main receipt sequence and message causality, never subtract clock values" };
}
module.exports = { analyze };
