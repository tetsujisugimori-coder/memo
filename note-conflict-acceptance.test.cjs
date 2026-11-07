"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateSafety, evaluateTabReport } = require("./note-conflict-acceptance.cjs");
const { pollOutcome } = require("./note-conflict-observer.cjs");

// These are PURE SYNTHETIC INPUTS, never observations of Memo-Nexus.
const copy = (value) => structuredClone(value);
const spec = { noteId: "synthetic-contract-note", baselineRevision: 4, baselineBody: "lineA=single\nlineB=sequential",
  drafts: { A: "lineA=overlap-A\nlineB=sequential", B: "lineA=single\nlineB=overlap-B" } };
const merged = "lineA=overlap-A\nlineB=overlap-B";
const phases = ["terminal", "reloaded", "reopened"];

function state(tab, body, revision = 6) {
  const record = { id: spec.noteId, body, revision };
  return { tab, currentId: spec.noteId, editor: body, stored: record, badgeState: "saved", saveTimerPending: false,
    save: { status: "saved", dirty: false, activeRevision: null, pendingRevision: null },
    storage: { stores: { notes: [copy(record)] }, local: {}, session: {} }, storageComplete: true,
    conflictUi: { visible: false, text: "", committedBody: null, draftBody: null, exportEnabled: false } };
}
function before() {
  return ["A", "B"].map((tab) => ({ ...state(tab, spec.baselineBody, 4), editor: spec.drafts[tab], badgeState: "editing", saveTimerPending: true,
    save: { status: "dirty", dirty: true, activeRevision: null, pendingRevision: null } }));
}
function automatic() {
  const pair = [state("A", merged), state("B", merged)];
  return { source: "SYNTHETIC", spec: copy(spec), execution: { completed: true, errors: [] },
    wait: { kind: "saved", samples: [{ readOrder: 0, states: before() }, { readOrder: 1, states: copy(pair) }] },
    observations: { before: before(), ...Object.fromEntries(phases.map((phase) => [phase, copy(pair)])) }, recovery: { status: "UNAVAILABLE" } };
}
function stopped() {
  const evidence = automatic();
  const receipt = { kind: "memo-conflict-rejection", id: "rejection-B", requestId: "request-B", noteId: spec.noteId,
    expectedRevision: 4, committedRevision: 5, attemptedBody: spec.drafts.B, committedBody: spec.drafts.A };
  const draft = { kind: "memo-conflict-draft", id: "draft-B", requestId: receipt.requestId, noteId: spec.noteId,
    body: spec.drafts.B, baseBody: spec.baselineBody, baseRevision: 4 };
  const pair = [state("A", spec.drafts.A, 5), state("B", spec.drafts.A, 5)];
  for (const s of pair) { s.storage.stores.conflicts = [copy(receipt)]; s.storage.stores.conflictDrafts = [copy(draft)]; }
  pair[1].editor = spec.drafts.B;
  pair[1].badgeState = "conflict";
  pair[1].save.dirty = true;
  pair[1].save.status = "dirty";
  pair[1].conflictUi = { visible: true, text: "競合した未保存原稿", noteId: spec.noteId, requestId: receipt.requestId,
    committedBody: spec.drafts.A, draftBody: spec.drafts.B, exportEnabled: true };
  evidence.observations = { before: before(), ...Object.fromEntries(phases.map((phase) => [phase, copy(pair)])) };
  evidence.wait = { kind: "conflict-stopped", samples: [{ readOrder: 0, states: before() }, { readOrder: 1, states: copy(pair) }] };
  evidence.recovery = { action: "export-draft", selector: "[data-memo-conflict-export]", tab: "B", before: copy(pair[1]),
    download: { fileName: "conflict-draft.txt", text: spec.drafts.B }, after: copy(pair[1]) };
  return evidence;
}
function silentLoss() {
  const evidence = automatic();
  const pair = [state("A", spec.drafts.B, 5), state("B", spec.drafts.B, 5)];
  evidence.observations = { before: before(), ...Object.fromEntries(phases.map((phase) => [phase, copy(pair)])) };
  evidence.wait.samples = [{ readOrder: 0, states: before() }, { readOrder: 1, states: copy(pair) }];
  return evidence;
}
function suite(evidence) {
  const decision = evaluateSafety(evidence);
  const log = { exceptions: [], consoleErrors: [], failedResponses: [], failedRequests: [] };
  return { testedHead: "1".repeat(40), startedAt: "synthetic-start", finishedAt: "synthetic-finish",
    browsers: ["chromium", "webkit"].map((browser) => ({ browser, status: decision.status === "PASS" ? "PASS" : "FAIL", executionStatus: "COMPLETED", evidence: copy(evidence), logs: [copy(log), copy(log)],
      checks: Array.from({ length: 10 }, (_, index) => ({ number: index + 1, status: [5, 7, 8].includes(index + 1) ? decision.status : "PASS" })) })) };
}

test("SYNTHETIC method A: exact integrated DB + UI + reload + close/reopen passes", () => {
  const result = evaluateSafety(automatic());
  assert.equal(result.status, "PASS"); assert.equal(result.acceptedMethod, "A");
});
test("SYNTHETIC method B: dirty remains true, measured rejection/durable draft/export passes", () => {
  const evidence = stopped(), result = evaluateSafety(evidence);
  assert.equal(evidence.observations.terminal[1].save.dirty, true);
  assert.equal(result.status, "PASS"); assert.equal(result.acceptedMethod, "B");
});
test("warning plus disappeared draft is FAIL", () => {
  const e = silentLoss(); for (const phase of phases) for (const s of e.observations[phase]) { s.badgeState = "error"; s.notice = "競合"; }
  assert.equal(evaluateSafety(e).status, "FAIL");
});
test("existing both-saved/no-warning/reload-loss counterexample stays FAIL", () => assert.equal(evaluateSafety(silentLoss()).status, "FAIL"));
test("stopped but exercised recovery failed is FAIL", () => {
  const e = stopped(); e.recovery = { status: "FAILED", reason: "UI download failed" };
  assert.equal(evaluateSafety(e).status, "FAIL");
});
test("dirty=false and old DB is FAIL", () => {
  const e = automatic(); for (const phase of phases) for (const s of e.observations[phase]) { s.stored.body = spec.baselineBody; s.storage.stores.notes[0].body = spec.baselineBody; }
  assert.equal(evaluateSafety(e).status, "FAIL");
});
test("unobserved preservation store is UNKNOWN, never PASS", () => {
  const e = stopped(); for (const phase of phases) e.observations[phase][1].storageComplete = false;
  assert.equal(evaluateSafety(e).status, "UNKNOWN");
});
test("draft absent after reload is FAIL despite a surviving rejection receipt", () => {
  const e = stopped(); delete e.observations.reloaded[1].storage.stores.conflictDrafts;
  assert.equal(evaluateSafety(e).status, "FAIL");
});
test("draft absent after close/reopen is FAIL", () => {
  const e = stopped(); delete e.observations.reopened[1].storage.stores.conflictDrafts;
  assert.equal(evaluateSafety(e).status, "FAIL");
});
test("session-only draft cannot qualify as durable preservation", () => {
  const e = stopped(); for (const phase of phases) { const s = e.observations[phase][1]; s.storage.session.draft = JSON.stringify(s.storage.stores.conflictDrafts[0]); delete s.storage.stores.conflictDrafts; }
  assert.equal(evaluateSafety(e).status, "FAIL");
});
test("warning/dirty flags without concrete version-bound receipt never pass", () => {
  const e = stopped(); for (const phase of phases) e.observations[phase][1].storage.stores.conflicts = [];
  assert.notEqual(evaluateSafety(e).status, "PASS");
});
test("wrong expected revision never passes", () => {
  const e = stopped(); for (const phase of phases) e.observations[phase][1].storage.stores.conflicts[0].expectedRevision = 0;
  assert.notEqual(evaluateSafety(e).status, "PASS");
});
test("blocked edit labelled saved is FAIL", () => {
  const e = stopped(); e.observations.reopened[1].badgeState = "saved";
  assert.equal(evaluateSafety(e).status, "FAIL");
});
test("a recovery configuration declaration without a read-back download never passes", () => {
  const e = stopped(); e.recovery = { available: true, recoverable: true };
  assert.notEqual(evaluateSafety(e).status, "PASS");
});
test("wrong recovery bytes are FAIL", () => {
  const e = stopped(); e.recovery.download.text = spec.baselineBody;
  assert.equal(evaluateSafety(e).status, "FAIL");
});
test("recovery must not roll back committed content", () => {
  const e = stopped(); e.recovery.after.stored.body = spec.baselineBody;
  assert.equal(evaluateSafety(e).status, "FAIL");
});
test("a rejection receipt cannot hide an observed stale overwrite", () => {
  const e = stopped(); e.wait.samples.splice(1, 0, { readOrder: 1, states: [state("A", spec.drafts.B, 5), state("B", spec.drafts.B, 5)] });
  assert.notEqual(evaluateSafety(e).status, "PASS");
});
test("in-flight save is not a terminal success", () => {
  const e = automatic(); e.observations.terminal[0].save.activeRevision = 6;
  assert.equal(evaluateSafety(e).status, "FAIL");
});
test("timeout never passes, even with convincing saved labels", () => {
  const e = automatic(); e.wait.kind = "timeout";
  assert.notEqual(evaluateSafety(e).status, "PASS");
});
test("mid-execution exception never passes", () => {
  const e = stopped(); e.execution.errors.push("synthetic execution exception");
  assert.notEqual(evaluateSafety(e).status, "PASS");
});
test("unreached restart phase is UNKNOWN", () => {
  const e = automatic(); delete e.observations.reopened;
  assert.equal(evaluateSafety(e).status, "UNKNOWN");
});
test("declared edits without measured dirty preconditions never pass", () => {
  const e = automatic(); delete e.observations.before;
  assert.notEqual(evaluateSafety(e).status, "PASS");
});
test("JSON missing or invalid is rejected", () => {
  for (const input of [null, "", "{broken", {}]) assert.equal(evaluateTabReport(input).status, "FAIL");
});
test("report cannot pass with a missing or duplicate condition", () => {
  const r = suite(automatic()); r.browsers[0].checks.pop(); assert.equal(evaluateTabReport(r).status, "FAIL");
  const duplicate = suite(automatic()); duplicate.browsers[0].checks[9].number = 9; assert.equal(evaluateTabReport(duplicate).status, "FAIL");
});
test("UNKNOWN, skipped or false PASS check cannot make the report pass", () => {
  const r = suite(automatic()); r.browsers[0].checks[2].status = "UNKNOWN"; assert.equal(evaluateTabReport(r).status, "FAIL");
  const falsePass = suite(silentLoss()); falsePass.browsers.forEach((b) => b.checks.forEach((c) => { c.status = "PASS"; })); assert.equal(evaluateTabReport(falsePass).status, "FAIL");
});
test("report requires measured error logs and source HEAD", () => {
  const r = suite(automatic()); delete r.browsers[0].logs; assert.equal(evaluateTabReport(r).status, "FAIL");
  const noHead = suite(automatic()); delete noHead.testedHead; assert.equal(evaluateTabReport(noHead).status, "FAIL");
});
test("browser launch failure with ten placeholders is not product PASS", () => {
  const r = suite(automatic()); r.browsers[0].error = "launch failure";
  assert.equal(evaluateTabReport(r).status, "FAIL"); assert.equal(evaluateTabReport(r).productSafety, "UNKNOWN");
});
test("SYNTHETIC complete A/B suite reports pass; existing product counterexample reports FAIL", () => {
  assert.equal(evaluateTabReport(suite(automatic())).status, "PASS");
  assert.equal(evaluateTabReport(suite(stopped())).status, "PASS");
  assert.equal(evaluateTabReport(suite(silentLoss())).productSafety, "FAIL");
});

test("SYNTHETIC finite poll explicitly awaits async reads and records read order", async () => {
  let reads = 0;
  const pair = automatic().observations.terminal;
  const result = await pollOutcome(async () => { await new Promise((resolve) => setTimeout(resolve, 3)); reads++; return copy(pair); }, { timeout: 200, interval: 2, stableMs: 4 });
  assert.equal(result.kind, "saved"); assert.ok(reads >= 2);
  assert.deepEqual(result.samples.map((s) => s.readOrder), result.samples.map((_, i) => i));
});
test("SYNTHETIC finite poll accepts stopped candidate while dirty remains true", async () => {
  const result = await pollOutcome(async () => copy(stopped().observations.terminal), { timeout: 200, interval: 2, stableMs: 4 });
  assert.equal(result.kind, "conflict-stopped"); assert.equal(result.states[1].save.dirty, true);
});
test("finite poll times out on pending saves and never equates dirty=false with settled DB", async () => {
  const pair = automatic().observations.terminal; pair[0].saveTimerPending = true;
  const pending = await pollOutcome(async () => copy(pair), { timeout: 30, interval: 2, stableMs: 4 });
  assert.equal(pending.kind, "timeout");
  pair[0].saveTimerPending = false; delete pair[0].stored;
  const absent = await pollOutcome(async () => copy(pair), { timeout: 30, interval: 2, stableMs: 4 });
  assert.equal(absent.kind, "timeout");
});
test("a read that never resolves has a finite deadline", async () => {
  const result = await pollOutcome(() => new Promise(() => {}), { timeout: 30, interval: 2, stableMs: 4 });
  assert.equal(result.kind, "timeout"); assert.match(result.reason, /read exceeded/);
});
test("read exception is execution-error, not saved", async () => {
  const result = await pollOutcome(async () => { throw new Error("synthetic read exception"); }, { timeout: 100, interval: 2, stableMs: 4 });
  assert.equal(result.kind, "execution-error");
});
test("non-finite wait configuration is rejected", async () => {
  await assert.rejects(pollOutcome(async () => [], { timeout: Infinity }), /Finite/);
});
test("a summary field cannot substitute for a contradictory raw DB record", () => {
  const e = automatic(); e.observations.terminal[0].storage.stores.notes[0].body = spec.baselineBody;
  assert.notEqual(evaluateSafety(e).status, "PASS");
});
test("independent P2 regression: recovery-after cannot label an unsaved draft saved", () => {
  const e = stopped(); e.recovery.after.badgeState = "saved";
  e.recovery.after.save = { status: "saved", dirty: false, activeRevision: null, pendingRevision: null };
  assert.equal(evaluateSafety(e).status, "FAIL");
});
test("independent P2 regression: explicit failed/not-tested execution cannot become product PASS", () => {
  const r = suite(automatic()); r.browsers[0].status = "FAIL"; r.browsers[0].executionStatus = "NOT_TESTED";
  assert.equal(evaluateTabReport(r).status, "FAIL"); assert.notEqual(evaluateTabReport(r).productSafety, "PASS");
});
test("missing logs cannot be reported as product safety PASS", () => {
  const r = suite(automatic()); delete r.browsers[0].logs;
  assert.equal(evaluateTabReport(r).status, "FAIL"); assert.equal(evaluateTabReport(r).productSafety, "UNKNOWN");
});
test("poll sleep is clamped to the remaining finite deadline", async () => {
  const pair = before(), start = performance.now();
  const result = await pollOutcome(async () => copy(pair), { timeout: 30, interval: 1000, stableMs: 4 });
  assert.equal(result.kind, "timeout"); assert.ok(performance.now() - start < 500);
});
test("SYNTHETIC B may return to correctly saved committed content after verified export", () => {
  const e = stopped(); const after = e.recovery.after;
  after.editor = spec.drafts.A; after.badgeState = "saved";
  after.save = { status: "saved", dirty: false, activeRevision: null, pendingRevision: null };
  after.conflictUi.visible = false;
  assert.equal(evaluateSafety(e).status, "PASS"); assert.equal(evaluateSafety(e).acceptedMethod, "B");
});
