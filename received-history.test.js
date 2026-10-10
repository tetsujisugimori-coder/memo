"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { openHistory, validateHistory } = require("./dummy-preview-history.js");
const { createQueue, textRequest, notesRequest, TTL_MS, MAX_HISTORY } = require("./dummy-preview-queue.js");
const input = () => textRequest({ requestId: randomUUID(), title: "PRIVATE TITLE", body: "PRIVATE BODY bearerSECRET" });
async function fixture(t, io) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "memo-history-"));
  // Keep failed-test data inside this isolated directory for inspection; no user state.
  const store = await openHistory({ directory, ...(io ? { io } : {}) });
  t.after(() => store.close()); return { store, directory, queue: createQueue({ initial: store.records, persist: store.commit }) };
}
test("metadata-only durable receipts restore IDs, replay and per-item states without plaintext", async (t) => {
  const { store, directory, queue } = await fixture(t);
  const request = notesRequest({ requestId: randomUUID(), notes: [{ title: "PRIVATE TITLE", body: "PRIVATE BODY bearerSECRET" }, { title: "other", body: "remaining" }] });
  const original = queue.submit(request); const first = original.notes[0];
  const plan = queue.begin(request.requestId, "system-unclassified", null, first.itemId);
  queue.complete(request.requestId, plan.attemptId, first.itemId);
  const bytes = fs.readFileSync(path.join(directory, "history.json"), "utf8");
  for (const secret of ["PRIVATE TITLE", "PRIVATE BODY", "bearerSECRET", "remaining", "Authorization", "token"]) assert.equal(bytes.includes(secret), false);
  const restored = createQueue({ initial: JSON.parse(bytes).records, persist: store.commit });
  assert.equal(restored.peek().notes[1].bodyAvailable, false);
  assert.throws(() => restored.begin(request.requestId, "system-unclassified", null, original.notes[1].itemId), /replay_required/);
  assert.throws(() => restored.submit({ ...request, notes: [...request.notes].reverse() }), /request_id_conflict/);
  const replay = restored.submit(request); assert.equal(replay.notes[0].state, "saved");
  assert.equal(replay.notes[0].recoveryRequired, true); assert.deepEqual(replay.notes[0].savePlan, plan.savePlan);
  assert.equal(replay.notes[1].itemId, original.notes[1].itemId); assert.equal(replay.notes[1].body, "remaining");
});
test("saving/failure/rejected/expired history and 128-ID limit survive reload without eviction", async (t) => {
  const { store, directory } = await fixture(t); let time = Date.now();
  const queue = createQueue({ now: () => time, persist: store.commit });
  const saved = input(); queue.submit(saved); const plan = queue.begin(saved.requestId, "system-unclassified", null); queue.failed(saved.requestId, plan.attemptId);
  let restored = createQueue({ initial: JSON.parse(fs.readFileSync(path.join(directory, "history.json"))).records, persist: store.commit, now: () => time });
  assert.equal(restored.status(saved.requestId).state, "save_failed"); assert.deepEqual(restored.status(saved.requestId).savePlan, plan.savePlan);
  restored.submit(saved); restored.reject(saved.requestId);
  const expired = input(); restored.submit(expired); time += TTL_MS; assert.equal(restored.status(expired.requestId).state, "expired");
  for (let i = 2; i < MAX_HISTORY; i++) { const value = input(); restored.submit(value); restored.reject(value.requestId); }
  restored = createQueue({ initial: JSON.parse(fs.readFileSync(path.join(directory, "history.json"))).records, persist: store.commit, now: () => time });
  assert.equal(restored.submit(saved).state, "rejected"); assert.equal(restored.submit(expired).state, "expired");
  assert.throws(() => restored.submit(input()), /history_full/);
});
test("exclusive OS lock releases on close; corrupted journal never opens fresh", async (t) => {
  const { directory } = await fixture(t);
  await assert.rejects(openHistory({ directory }), /history_locked/);
  // Direct journal damage cannot be papered over by a new queue.
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), "memo-corrupt-")); fs.writeFileSync(path.join(broken, "history.json"), "{truncated");
  await assert.rejects(openHistory({ directory: broken }), /history_corrupt/);
  const value = { version: 1, records: [{ invalid: true }], checksum: "wrong" };
  fs.writeFileSync(path.join(broken, "history.json"), JSON.stringify(value)); await assert.rejects(openHistory({ directory: broken }), /history_corrupt/);
  value.checksum = createHash("sha256").update(JSON.stringify(value.records)).digest("hex");
  fs.writeFileSync(path.join(broken, "history.json"), JSON.stringify(value)); await assert.rejects(openHistory({ directory: broken }), /history_corrupt/);
});
test("write/fsync/rename failures preserve old record and permanently stop operations", async (t) => {
  for (const stage of ["writeFileSync", "fsyncSync", "renameSync"]) {
    let fail = false; const io = { ...fs, [stage]: (...args) => { if (fail) throw new Error("private token must not escape"); return fs[stage](...args); } };
    const { directory, queue } = await fixture(t, io); const request = input(); queue.submit(request);
    const before = fs.readFileSync(path.join(directory, "history.json"), "utf8"); fail = true;
    assert.throws(() => queue.begin(request.requestId, "system-unclassified", null), /history_write_failed/);
    assert.equal(fs.readFileSync(path.join(directory, "history.json"), "utf8"), before);
    for (const operation of [() => queue.peek(), () => queue.submit(request), () => queue.status(request.requestId)]) assert.throws(operation, /history_unavailable/);
  }
});
test("semantic damage fails closed even with recomputed checksum", async (t) => {
  const { store, directory, queue } = await fixture(t); const request = input(); queue.submit(request); queue.begin(request.requestId, "system-unclassified", null);
  const records = JSON.parse(fs.readFileSync(path.join(directory, "history.json"))).records;
  for (const mutate of [(r) => { delete r[0].savePlan; }, (r) => { r[0].body = "secret"; }, (r) => { r[0].state = "queued"; }, (r) => r.push(structuredClone(r[0]))]) {
    const damaged = structuredClone(records); mutate(damaged); assert.throws(() => validateHistory(damaged), /history_corrupt/);
  }
  assert.equal(typeof store.commit, "function");
});

test("dedicated directory permissions exclude other users and oversized journals stop", async (t) => {
  const { directory } = await fixture(t);
  if (process.platform === "win32") {
    const script = "$taskSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User; $taskAcl = [System.IO.Directory]::GetAccessControl($env:MEMO_HISTORY_PERMISSION_PATH); $taskRules = $taskAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]); [Console]::Write(($taskAcl.AreAccessRulesProtected -and $taskRules.Count -eq 1 -and $taskRules[0].IdentityReference.Value -eq $taskSid.Value -and $taskRules[0].AccessControlType -eq 'Allow' -and $taskRules[0].FileSystemRights -eq 'FullControl'))";
    assert.equal(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, encoding: "utf8", env: { ...process.env, MEMO_HISTORY_PERMISSION_PATH: directory } }), "True");
  } else {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(directory, "history.json")).mode & 0o777, 0o600);
  }
  const oversized = fs.mkdtempSync(path.join(os.tmpdir(), "memo-oversized-"));
  fs.writeFileSync(path.join(oversized, "history.json"), "x".repeat(1024 * 1024 + 1));
  await assert.rejects(openHistory({ directory: oversized }), /history_corrupt/);
});

test("receiver bind failure releases the persistent-state lock", async (t) => {
  const net = require("node:net");
  const { randomBytes } = require("node:crypto");
  const { createPersistentPreviewService } = require("./dummy-preview-service.js");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "memo-bind-failure-"));
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const service = await createPersistentPreviewService({ directory, browserToken: randomBytes(32).toString("base64url"), adapterToken: randomBytes(32).toString("base64url") });
  await new Promise((resolve) => { service.server.once("error", resolve); service.server.listen(occupied.address().port, "127.0.0.1"); });
  await service.history.close();
  const reopened = await openHistory({ directory }); await reopened.close();
});


test("capacity rejection rolls back uncommitted state and keeps known operations available", () => {
  let journal = [], capacity = false, blockMutation = false;
  const queue = createQueue({ persist: (records) => {
    if (blockMutation || (capacity && records.length > 1)) throw Object.assign(new Error("private path/token"), { code: "history_capacity" });
    journal = structuredClone(records);
  } });
  const known = input(); queue.submit(known); capacity = true;
  const intact = structuredClone(journal), refused = input();
  assert.throws(() => queue.submit(refused), { code: "history_capacity" });
  assert.deepEqual(journal, intact); assert.throws(() => queue.status(refused.requestId), /request_not_found/);
  assert.equal(queue.submit(known).state, "queued");
  blockMutation = true;
  assert.throws(() => queue.begin(known.requestId, "system-unclassified", null), { code: "history_capacity" });
  assert.equal(queue.status(known.requestId).state, "queued"); assert.equal(queue.status(known.requestId).savePlan, null);
  assert.deepEqual(journal, intact); blockMutation = false;
  const plan = queue.begin(known.requestId, "system-unclassified", null);
  queue.complete(known.requestId, plan.attemptId); assert.equal(queue.status(known.requestId).state, "saved");
});

test("MCP distinguishes capacity errors and never forwards unknown error details", async () => {
  const { createMcpHandler } = require("./dummy-preview-mcp.js");
  for (const code of ["history_full", "history_capacity", "PRIVATE-path-token-body"]) {
    const handle = createMcpHandler({ submitArbitrary: async () => { throw Object.assign(new Error("PRIVATE-path-token-body"), { code }); } });
    await handle({ jsonrpc: "2.0", method: "notifications/initialized" });
    const reply = await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "submit_text_preview", arguments: { requestId: randomUUID(), title: "title", body: "body" } } });
    const result = JSON.parse(reply.result.content[0].text);
    assert.equal(result.state, code.startsWith("history_") ? code : "unconfirmed");
    assert.equal(JSON.stringify(reply).includes("PRIVATE-path-token-body"), false);
    if (code.startsWith("history_")) { assert.match(result.message, /上限/); assert.match(result.message, /保全/); }
    assert.equal(reply.result.isError, true); assert.equal(result.saved, false);
  }
});
