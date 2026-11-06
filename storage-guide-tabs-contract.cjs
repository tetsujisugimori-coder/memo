"use strict";

// Pure evaluation only. A producer must supply measured records/UI/downloads.
// Synthetic inputs exercise this contract; they do not certify the product.
const PHASES = ["terminal", "reloaded", "reopened"];
const PASS = "PASS", FAIL = "FAIL", UNKNOWN = "UNKNOWN";

function requirement(id, status, detail) { return { id, status, detail }; }
function all(items) { return items.every((item) => item.status === PASS) ? PASS : items.some((item) => item.status === FAIL) ? FAIL : UNKNOWN; }
function pair(states, id) {
  return Array.isArray(states) && states.length === 2 && ["A", "B"].every((tab) => states.filter((s) => s?.tab === tab && s.currentId === id).length === 1);
}
function bodies(spec) {
  const base = spec?.baselineBody?.split("\n"), a = spec?.drafts?.A?.split("\n"), b = spec?.drafts?.B?.split("\n");
  if (!spec?.noteId || !Number.isSafeInteger(spec.baselineRevision) || spec.baselineRevision < 0 || ![base, a, b].every((rows) => rows?.length === 2)
    || a[0] === base[0] || a[1] !== base[1] || b[0] !== base[0] || b[1] === base[1]) return null;
  return { merged: `${a[0]}\n${b[1]}`, edits: [a[0], b[1]] };
}
function rows(state) {
  if (!state?.storage?.stores) return [];
  return Object.entries(state.storage.stores).flatMap(([store, records]) => Array.isArray(records) ? records.map((record) => ({ store, record })) : []);
}
function validRecord(state, id) {
  const note = state?.stored;
  const raw = state?.storage?.stores?.notes?.filter((row) => row.id === id);
  return note?.id === id && typeof note.body === "string" && Number.isSafeInteger(note.revision) && note.revision >= 0
    && raw?.length === 1 && raw[0].body === note.body && raw[0].revision === note.revision;
}
function exactState(state, id, body) { return validRecord(state, id) && state.stored.body === body; }
function idle(state) { return state?.save && state.save.activeRevision == null && state.save.pendingRevision == null && state.saveTimerPending === false; }
function savedUi(state) { return state?.badgeState === "saved" && state.save?.status === "saved" && !state.save.dirty && idle(state) && state.editor === state.stored?.body; }
function knownStorage(state) {
  return state?.storageComplete === true && state.storage?.stores && state.storage.local && state.storage.session;
}
function uiConsistency(states) {
  if (!Array.isArray(states) || states.length !== 2) return UNKNOWN;
  return states.every((s) => s.badgeState === "saved" ? savedUi(s) : s.conflictUi?.visible && s.badgeState !== "saved") ? PASS : FAIL;
}
function containsEdit(value, edit) { return typeof value === "string" && value.split("\n").includes(edit); }
function storedValues(state) {
  const values = rows(state).map(({ record }) => JSON.stringify(record));
  return [...values, ...Object.values(state.storage.local), ...Object.values(state.storage.session)];
}
function editPresent(state, edit) {
  // JSON strings escape newlines, so search exact line tokens after parsing too.
  const strings = [state.editor, state.conflictUi?.draftBody, state.conflictUi?.committedBody];
  function visit(value) {
    if (typeof value === "string") { strings.push(value); try { visit(JSON.parse(value)); } catch {} }
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  }
  storedValues(state).forEach(visit);
  return strings.some((value) => containsEdit(value, edit));
}

function evaluateSafety(evidence) {
  const spec = evidence?.spec, expected = bodies(spec);
  const a = [], b = [];
  const result = { status: UNKNOWN, acceptedMethod: null, methods: { A: { status: UNKNOWN, requirements: a }, B: { status: UNKNOWN, requirements: b } }, reasons: [] };
  if (!expected) { result.reasons.push("Missing/invalid two-line baseline and independent drafts"); return result; }
  const obs = evidence.observations || {};
  const precondition = pair(obs.before, spec.noteId) && obs.before.every((s) => s.editor === spec.drafts[s.tab] && s.save?.dirty === true
    && exactState(s, spec.noteId, spec.baselineBody) && s.stored.revision === spec.baselineRevision);
  const complete = PHASES.every((phase) => pair(obs[phase], spec.noteId));
  const executionReady = evidence.execution?.completed === true && evidence.execution.errors?.length === 0
    && ["saved", "conflict-stopped"].includes(evidence.wait?.kind) && complete && precondition;
  a.push(requirement("A0-measured-drafts", precondition ? PASS : UNKNOWN, "Both independent dirty drafts were read against the same baseline"));
  b.push(requirement("B0-measured-drafts", precondition ? PASS : UNKNOWN, "A configured draft string alone is not an observed edit"));
  const phaseCheck = (phase, predicate) => !pair(obs[phase], spec.noteId) ? UNKNOWN : obs[phase].every(predicate) ? PASS : FAIL;
  a.push(requirement("A1-terminal-merged-record", phaseCheck("terminal", (s) => exactState(s, spec.noteId, expected.merged)), "Both changed lines must exist in the measured DB record"));
  a.push(requirement("A2-saved-ui", phaseCheck("terminal", savedUi), "No in-flight/pending save or false saved label"));
  a.push(requirement("A3-reload", phaseCheck("reloaded", (s) => exactState(s, spec.noteId, expected.merged) && savedUi(s)), "DB and UI after reload"));
  a.push(requirement("A4-close-reopen", phaseCheck("reopened", (s) => exactState(s, spec.noteId, expected.merged) && savedUi(s)), "New tabs in the same context retain the merge"));
  const sampled = [...(evidence.wait?.samples || []).flatMap((sample) => sample.states || []), ...PHASES.flatMap((phase) => obs[phase] || [])];
  let rollback = false;
  const seenEdits = new Set();
  for (const s of sampled) {
    if (!validRecord(s, spec.noteId)) continue;
    for (const edit of expected.edits) {
      if (containsEdit(s.stored.body, edit)) seenEdits.add(edit);
      else if (seenEdits.has(edit)) rollback = true;
    }
  }
  a.push(requirement("A5-no-observed-rollback", sampled.length ? rollback ? FAIL : PASS : UNKNOWN, "Read order is not asserted to be every commit's order"));

  const terminal = obs.terminal;
  const committed = pair(terminal, spec.noteId) && terminal.every((s) => validRecord(s, spec.noteId)) ? terminal[0].stored : null;
  const blockedTab = committed?.body === spec.drafts.A ? "B" : committed?.body === spec.drafts.B ? "A" : null;
  const blocked = terminal?.find((s) => s.tab === blockedTab);
  const receipt = rows(blocked).find(({ record: r }) => r?.kind === "memo-conflict-rejection" && r.noteId === spec.noteId
    && typeof r.id === "string" && typeof r.requestId === "string" && r.attemptedBody === spec.drafts[blockedTab]
    && r.committedBody === committed?.body && r.expectedRevision === spec.baselineRevision
    && Number.isSafeInteger(r.committedRevision) && r.committedRevision > r.expectedRevision && r.committedRevision === committed?.revision)?.record;
  b.push(requirement("B1-version-bound-rejection", receipt ? PASS : knownStorage(blocked) ? FAIL : UNKNOWN, "Read a persisted rejection tied to attempted/committed bodies and revisions; warning alone is insufficient"));
  b.push(requirement("B2-committed-content-retained", !committed || !complete ? UNKNOWN : blockedTab && PHASES.every((phase) => obs[phase].every((s) => exactState(s, spec.noteId, committed.body) && s.stored.revision >= committed.revision)) ? PASS : FAIL, "No stale overwrite across terminal/reload/close-reopen"));
  function preserved(s) {
    if (!receipt || !knownStorage(s)) return UNKNOWN;
    const draft = rows(s).find(({ record: r }) => r?.kind === "memo-conflict-draft" && r.noteId === spec.noteId
      && typeof r.id === "string" && r.requestId === receipt.requestId && r.body === spec.drafts[blockedTab]
      && r.baseBody === spec.baselineBody && r.baseRevision === spec.baselineRevision);
    const rejection = rows(s).some(({ record: r }) => r?.id === receipt.id && JSON.stringify(r) === JSON.stringify(receipt));
    return draft && rejection ? PASS : FAIL;
  }
  const held = PHASES.map((phase) => (obs[phase] || []).find((s) => s.tab === blockedTab));
  b.push(requirement("B3-durable-draft", complete ? all(held.map((s) => requirement("readback", preserved(s)))) : UNKNOWN, "Read actual IDB draft and rejection after reload AND tab closure; session/memory alone cannot qualify"));
  function conflictUi(s) {
    const ui = s?.conflictUi;
    return ui?.visible && ui.noteId === spec.noteId && ui.requestId === receipt?.requestId
      && ui.committedBody === committed?.body && ui.draftBody === spec.drafts[blockedTab]
      && /競合|未保存|conflict|unsaved/iu.test(ui.text || "") && s.badgeState !== "saved" && idle(s);
  }
  b.push(requirement("B4-visible-unsaved-and-both-bodies", complete && blockedTab ? held.every(conflictUi) ? PASS : FAIL : UNKNOWN, "Both contents must be inspectable and the blocked edit must not be labelled saved"));
  b.push(requirement("B5-confirmed-side-ui", complete && blockedTab ? PHASES.every((phase) => obs[phase].filter((s) => s.tab !== blockedTab).every(savedUi)) ? PASS : FAIL : UNKNOWN, "Saved label on confirmed side agrees with DB"));
  const recovery = evidence.recovery;
  let recoveryStatus = UNKNOWN;
  if (recovery?.status === "FAILED") recoveryStatus = FAIL;
  else if (recovery?.action === "export-draft" && receipt && recovery.tab === blockedTab) {
    recoveryStatus = conflictUi(recovery.before) && preserved(recovery.before) === PASS
      && recovery.selector === "[data-memo-conflict-export]" && recovery.before.conflictUi.exportEnabled === true
      && typeof recovery.download?.fileName === "string" && recovery.download.fileName.length > 0
      && recovery.download.text === spec.drafts[blockedTab]
      && exactState(recovery.after, spec.noteId, committed.body) && preserved(recovery.after) === PASS ? PASS : FAIL;
  }
  b.push(requirement("B6-exercised-recovery-after-reopen", recoveryStatus, "A real UI-triggered download is read back; manual-copy assumptions/configuration flags do not qualify"));
  b.push(requirement("B7-finite-stopped-outcome", evidence.wait?.kind === "conflict-stopped" ? PASS : evidence.wait?.kind === "saved" ? FAIL : UNKNOWN, "Dirty may remain true; queue/timer must be idle, and full preservation/recovery proof is still required"));
  b.push(requirement("B8-no-observed-rollback", sampled.length ? rollback ? FAIL : PASS : UNKNOWN, "A rejection receipt cannot excuse an already observed stale overwrite"));

  result.methods.A.status = all(a);
  result.methods.B.status = all(b);
  const final = obs.reopened;
  const loss = expected.edits.some((edit) => pair(final, spec.noteId) && final.every(knownStorage) && final.every((s) => !editPresent(s, edit)));
  result.lossDemonstrated = loss;
  result.observedRollback = rollback;
  const silentOverwrite = precondition && pair(terminal, spec.noteId) && evidence.wait?.kind === "saved"
    && terminal.every((s) => validRecord(s, spec.noteId) && s.badgeState === "saved" && !s.conflictUi?.visible)
    && terminal.every((s) => s.stored.body !== expected.merged && s.editor !== expected.merged)
    && expected.edits.some((edit) => terminal.every((s) => !containsEdit(s.stored.body, edit) && !containsEdit(s.editor, edit)));
  result.silentOverwrite = silentOverwrite;
  const brokenPreservation = receipt && complete && held.every(knownStorage) && b.some((item) => item.id === "B3-durable-draft" && item.status === FAIL);
  const hardFailure = loss || silentOverwrite || brokenPreservation || recoveryStatus === FAIL || PHASES.some((phase) => pair(obs[phase], spec.noteId) && obs[phase].some((s) => s.badgeState === "saved" && !savedUi(s)));
  if (executionReady && !hardFailure && [a, b].some((items) => all(items) === PASS)) {
    result.status = PASS;
    result.acceptedMethod = all(a) === PASS ? "A" : "B";
  } else if (hardFailure) result.status = FAIL;
  result.reasons.push(!executionReady ? "Incomplete/failed execution or unsettled outcome: PASS forbidden" : result.status === PASS ? `All method ${result.acceptedMethod} obligations observed` : loss ? "An edit is absent from both reopened UIs and all enumerated persistence data" : "Neither complete method A nor complete method B was demonstrated");
  return result;
}

function evaluateTabReport(input) {
  let report;
  try { report = typeof input === "string" ? JSON.parse(input) : input; } catch { return { status: FAIL, productSafety: UNKNOWN, reason: "Invalid JSON" }; }
  if (!report || report.error || !/^[a-f0-9]{40}$/.test(report.testedHead || "") || !report.startedAt || !report.finishedAt
    || report.browsers?.length !== 2 || !["chromium", "webkit"].every((name) => report.browsers.filter((b) => b.browser === name).length === 1)) return { status: FAIL, productSafety: UNKNOWN, reason: "Missing/failed browser execution or provenance" };
  const decisions = report.browsers.map((browser) => {
    const checks = browser.checks;
    if (browser.error || checks?.length !== 10 || !Array.from({ length: 10 }, (_, i) => i + 1).every((n) => checks.filter((c) => c.number === n).length === 1)) return { status: UNKNOWN, integrity: FAIL, reason: "Missing, duplicate or unreached conditions" };
    const decision = evaluateSafety(browser.evidence);
    const matches = [5, 7, 8].every((n) => checks.find((c) => c.number === n).status === decision.status);
    const logsComplete = Array.isArray(browser.logs) && browser.logs.length >= 2 && browser.logs.every((log) => ["exceptions", "consoleErrors", "failedResponses", "failedRequests"].every((key) => Array.isArray(log[key]) && log[key].length === 0));
    return { ...decision, integrity: matches && logsComplete ? PASS : FAIL, conditionsPass: checks.every((c) => c.status === PASS) };
  });
  return { status: decisions.every((d) => d.status === PASS && d.integrity === PASS && d.conditionsPass) ? PASS : FAIL,
    productSafety: decisions.some((d) => d.status === FAIL) ? FAIL : decisions.every((d) => d.status === PASS) ? PASS : UNKNOWN, decisions };
}

module.exports = { evaluateSafety, evaluateTabReport, uiConsistency, bodies };
