"use strict";
// Pure design model: no runtime adapter, timers, I/O, browser, Worker or IDB calls.
const keys = ["runId", "dbName", "workerId", "connectionId", "transactionId", "iteration"];
function judgeTrace({ identity, events, profile = "public-observation-v1" }) {
  const out = { syntheticOnly: true, realExperiment: "NOT_RUN", validTrace: "PASS", workerObservation: "UNKNOWN", callbackHold: "UNKNOWN",
    stopCondition: "UNKNOWN", upgrade: "NOT_RUN", cleanup: "NOT_RUN", connectionClosed: "UNKNOWN", physicalRelease: "UNKNOWN", reasons: [] };
  const reject = reason => { out.validTrace = "FAIL"; out.stopCondition = "FAIL"; out.reasons.push(reason); return out; };
  if (!identity || keys.some(k => identity[k] === undefined || identity[k] === "UNKNOWN") || !Array.isArray(events) || events.length > 512) return reject("invalid_schema_or_limit");
  if (!["public-observation-v1", "synthetic-oracle-v1"].includes(profile)) return reject("unknown_profile");
  const ids = new Set(), seqs = new Map();
  for (const e of events) {
    if (keys.some(k => e[k] !== identity[k])) return reject("foreign_identity");
    if (!e.eventId || ids.has(e.eventId) || !["worker", "main", "oracle"].includes(e.source) || !Number.isInteger(e.sourceSeq) || e.sourceSeq <= (seqs.get(e.source) || 0)) return reject("duplicate_or_bad_source_sequence");
    if (e.source === "oracle" && profile !== "synthetic-oracle-v1") return reject("oracle_forbidden_in_public_profile");
    ids.add(e.eventId); seqs.set(e.source, e.sourceSeq);
  }
  const find = (type, source) => events.find(e => e.type === type && (!source || e.source === source));
  const pos = e => events.indexOf(e);
  const ordered = list => list.every(Boolean) && list.every((e,i) => !i || pos(list[i-1]) < pos(e));
  const sends = events.filter(e => e.type === "send" && e.source === "worker");
  for (const e of events.filter(e => e.type === "receive" && e.source === "main")) if (!sends.some(s => s.eventId === e.sendId)) return reject("unmatched_send");
  const accepted = find("request_accepted", "worker"), send = sends[0], receive = find("receive", "main"), stop = find("stop_requested", "main"), call = find("terminate_called", "main"), returned = find("terminate_returned", "main");
  const localPositive = accepted?.requestId && accepted.mode === "readonly" && accepted.result === "accepted";
  if (localPositive) out.workerObservation = "PASS";
  const chain = localPositive && ordered([accepted, send, receive, stop, call, returned]) && receive.sendId === send.eventId && accepted.sourceSeq < send.sourceSeq && returned.result === "returned";
  const held = find("gate_held", "worker"), claim = find("gate_claim", "main"), post = find("gate_postcheck", "main");
  if (held || claim || post) {
    const sameGate = held?.nonce && held?.epoch !== undefined && [claim,post].every(e => e && e.nonce === held.nonce && e.epoch === held.epoch);
    const released = events.some(e => ["gate_exit", "gate_expired"].includes(e.type));
    out.callbackHold = released ? "FAIL" : chain && sameGate && ordered([accepted,held,send,receive,claim,stop,call,returned,post]) && claim.result === "claimed" && post.state === "CLAIMED" ? "PASS" : "UNKNOWN";
    if (out.callbackHold === "PASS") out.reasons.push("callback_protocol_only_not_backend_proof");
  }
  const abnormal = events.some(e => ["transaction_abort", "transaction_error", "collection_error"].includes(e.type));
  const complete = events.filter(e => e.type === "transaction_complete" || e.type === "complete_received");
  if (abnormal) { out.stopCondition = "FAIL"; out.reasons.push("abnormal_not_normal_unfinished"); }
  else if (stop && complete.some(e => pos(e) < pos(stop))) { out.stopCondition = "FAIL"; out.reasons.push("complete_observed_before_stop"); }
  else if (complete.length) out.reasons.push("late_terminal_has_no_cross_clock_order_proof");
  else if (chain && profile === "synthetic-oracle-v1") {
    // An artificial, reviewed proof assumption, never an implementation of such a witness.
    const begin = find("oracle_unfinished_begin", "oracle"), end = find("oracle_unfinished_end", "oracle");
    if (begin?.proofId && end?.proofId === begin.proofId && end.stopId === stop.eventId && end.sendId === send.eventId &&
        begin.result === "normal_unfinished" && end.result === "normal_unfinished" && ordered([accepted,begin,send,receive,stop,call,returned,end])) {
      out.stopCondition = "PASS"; out.reasons.push("synthetic_proof_assumption_only");
    }
  }
  if (out.stopCondition === "UNKNOWN") out.reasons.push("no_independent_unfinished_stop_witness");
  const opens = events.filter(e => e.type === "upgrade_open" && e.source === "main");
  if (opens.length > 1) return reject("additional_upgrade_request");
  const open = opens[0], terminals = events.filter(e => ["upgrade_success", "upgrade_error", "upgrade_timeout"].includes(e.type));
  if (terminals.some(e => !open || e.source !== "main" || e.requestId !== open.requestId || pos(e) < pos(open))) return reject("unmatched_upgrade_terminal");
  if (open) out.upgrade = terminals.some(e => e.type !== "upgrade_success") ? "FAIL" : terminals.length ? "PASS" : "UNKNOWN";
  const cleanups = events.filter(e => e.type === "cleanup_start");
  if (cleanups.length > 1 || (cleanups.length && !ordered([find("evidence_saved", "main"),cleanups[0]]))) return reject("cleanup_without_saved_evidence_or_repeated");
  const cleanupEnds = events.filter(e => e.type === "cleanup_end");
  if (cleanups.some(e => e.source !== "main") || cleanupEnds.length > 1 || cleanupEnds.some(e => e.source !== "main" || !cleanups.length || pos(e) < pos(cleanups[0]))) return reject("unmatched_cleanup_terminal");
  if (cleanups.length) {
    const status = find("cleanup_end", "main")?.result;
    out.cleanup = status === "success" ? "PASS" : status === "error" ? "FAIL" : "UNKNOWN";
  }
  return out;
}
module.exports = { judgeTrace };
