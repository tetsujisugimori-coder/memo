"use strict";
// Diagnostic copies only: never write these transformations back to the study sources.
const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const { metadata } = require("./stage5-evidence.cjs");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error("diagnostic_source_mismatch");
  return source.replace(before, after);
}
function latencyModel(source) {
  source = replaceOnce(source, "    async start(payload, timeoutMs, requestId) {", '    async start(payload, timeoutMs, requestId) { trace("request_accept", { requestId, timeoutMs });');
  source = replaceOnce(source, "      const caller = new Promise(resolve => { job.resolve = resolve; });", '      trace("deadline_set", { deadline: job.deadline, requestId });\n      const caller = new Promise(resolve => { job.resolve = resolve; });');
  source = replaceOnce(source, "    job.timer = schedule(() => {", '    const diagnosticTimer = { deadline: job.deadline, delayMs: Math.max(0, wait), plannedAt: clock() + Math.max(0, wait) };\n    trace("timer_register", diagnosticTimer);\n    job.timer = schedule(() => { trace("timer_callback_start", diagnosticTimer);');
  source = replaceOnce(source, "    if (job.callerSettled) return;", '    if (job.callerSettled) return;\n    trace("settle_caller", { status: result.status, deadline: job.deadline });');
  source = replaceOnce(source, "job.resolve(result);", 'trace("caller_resolve_invoked", { status: result.status }); job.resolve(result); trace("caller_resolve_returned", { status: result.status });');
  source = replaceOnce(source, "    job.ledgerOperation = phase;", '    job.ledgerOperation = phase; trace("ledger_operation_start", { phase, reservationId: job.reservationId });');
  source = replaceOnce(source, 'const value = await action(); record.status = "SETTLED";', 'const value = await action(); trace("ledger_operation_complete", { phase, status: value?.status, reservationId: value?.id || job.reservationId }); record.status = "SETTLED";');
  source = replaceOnce(source, 'catch { record.status = "REJECTED";', 'catch { trace("ledger_operation_rejected", { phase }); record.status = "REJECTED";');
  return replaceOnce(source, "job.workPending = false; owned = null;", 'job.workPending = false; owned = null; trace("owned_task_end", { callerSettled: job.callerSettled });');
}
function latencyCases(source) {
  source = replaceOnce(source, ".then(result => { response = result;", '.then(result => { trace("caller_promise_reaction", { status: result.status }); response = result;');
  return replaceOnce(source, "  const observed = await within(pending, 160);", '  const observed = await within(pending, 160); trace("test_response_observed", { status: observed.status });');
}
function latencySummary(events) {
  const first = event => events.find(e => e.event === event);
  const deadline = first("deadline_set");
  const callback = events.find(e => e.event === "timer_callback_start" && e.at >= deadline?.deadline);
  const settle = first("settle_caller"), resolve = first("caller_resolve_invoked"), reaction = first("caller_promise_reaction"), observed = first("test_response_observed");
  if (![deadline, callback, settle, resolve, reaction, observed].every(Boolean)) return { classification: "UNKNOWN", reason: "required_event_not_observed" };
  return { classification: "INTERVALS_OBSERVED", timerDispatchLateMs: callback.at - callback.plannedAt,
    deadlineToCallbackMs: callback.at - deadline.deadline, callbackToSettleMs: settle.at - callback.at,
    callbackToResolveMs: resolve.at - callback.at, resolveToReactionMs: reaction.at - resolve.at,
    resolveToTestObservationMs: observed.at - resolve.at,
    limitation: "Same-realm intervals only. These locate delay, not its browser/OS cause; resolver invocation is not direct observation of Promise internal state." };
}
async function evidenceHeader(files) {
  return { ...await metadata(files.map(f => `experiments/mcp-search-worker-feasibility/${f}`)),
    baselineCommit: "62a9287870375900066ba24b917ccf26561540e1", physicalRelease: "UNKNOWN" };
}
async function saveDiagnostic(label, report) {
  const dir = path.join(__dirname, "evidence/stage5-diagnostics/raw"); await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${label}-${crypto.randomUUID()}.json`);
  await fs.writeFile(file, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ file, diagnostic: report.diagnostic, outcome: report.outcome }));
}
module.exports = { replaceOnce, latencyModel, latencyCases, latencySummary, evidenceHeader, saveDiagnostic, hash };
