"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const http = require("node:http");
const { notesRequest, textRequest, dummyRequest, createQueue, TTL_MS, MAX_HISTORY, MAX_NOTES_INPUT_BYTES } = require("./dummy-preview-queue.js");
const { createPreviewService } = require("./dummy-preview-service.js");
const { createMcpHandler } = require("./dummy-preview-mcp.js");
const input = (n = 5) => ({ requestId: randomUUID(), notes: Array.from({ length: n }, (_, i) => ({ title: ` 日本語${i} `, body: `原文${i}\r\n\n末尾  ` })) });

test("batch validates 1..5 notes atomically, preserving text and every per-note boundary", () => {
  const queue = createQueue(), value = input(); const before = queue.submit(notesRequest(value));
  assert.deepEqual(before.notes.map(({ title, body }) => ({ title, body })), value.notes);
  for (const bad of [null, {}, { ...input(), notes: [] }, input(6), { ...input(), notes: "x" }, { ...input(), requestId: "x" },
    { ...input(), noteId: "external" }, { ...input(), notes: [{ title: "ok", body: "ok", itemId: randomUUID() }] }]) {
    assert.throws(() => notesRequest(bad)); assert.deepEqual(queue.peek(), before);
  }
  for (const patch of [{ title: "" }, { body: " \n" }, { title: null }, { body: [] }, { title: "😀".repeat(201) }, { body: "a".repeat(65537) }, { body: "日".repeat(21846) }]) {
    const bad = input(); Object.assign(bad.notes[4], patch);
    assert.throws(() => queue.submit(notesRequest(bad))); assert.deepEqual(queue.peek(), before);
  }
  const boundary = input(); boundary.notes = Array.from({ length: 5 }, () => ({ title: "😀".repeat(200), body: "a".repeat(65536) }));
  assert.deepEqual(notesRequest(boundary).notes, boundary.notes);
  boundary.notes[4].body = "日".repeat(21845) + "a"; assert.deepEqual(notesRequest(boundary).notes, boundary.notes);
  boundary.notes[4].body += "a"; assert.throws(() => notesRequest(boundary), /size_limit/);
  boundary.notes = Array.from({ length: 5 }, () => ({ title: "x", body: "\u0001".repeat(65536) }));
  assert.ok(Buffer.byteLength(JSON.stringify(boundary)) <= MAX_NOTES_INPUT_BYTES);
  assert.deepEqual(notesRequest(boundary).notes, boundary.notes);
  assert.throws(() => queue.submit({ ...notesRequest(input()), extra: true }), /invalid_format/);
});

test("five unsaved -> two saved, one discarded, two pending; stable IDs and detached receipts", () => {
  const queue = createQueue(), value = input(), first = queue.submit(notesRequest(value));
  assert.equal(new Set(first.notes.map((item) => item.itemId)).size, 5);
  assert.ok(first.notes.every((item) => !item.saved && item.state === "queued" && item.savePlan === null));
  assert.deepEqual(queue.submit(notesRequest(value)), first);
  assert.throws(() => queue.submit(notesRequest({ ...value, notes: [...value.notes].reverse() })), /request_id_conflict/);
  for (const item of first.notes.slice(0, 2)) {
    const plan = queue.begin(value.requestId, "system-unclassified", null, item.itemId);
    queue.complete(value.requestId, plan.attemptId, item.itemId);
    plan.savePlan.collectionId = "tampered";
    assert.equal(queue.status(value.requestId, item.itemId).savePlan.collectionId, "system-unclassified");
  }
  queue.reject(value.requestId, first.notes[2].itemId);
  const partial = queue.status(value.requestId);
  assert.deepEqual(partial.notes.map((item) => item.state), ["saved", "saved", "rejected", "queued", "queued"]);
  assert.deepEqual(queue.submit(notesRequest(value)), partial);
  assert.equal(queue.submit(textRequest({ requestId: randomUUID(), title: "single", body: "text" })).state, "queue_full");
  for (const item of first.notes.slice(3)) queue.reject(value.requestId, item.itemId);
  assert.equal(queue.peek(), null); assert.equal(queue.status(value.requestId).state, "completed");
  assert.equal(queue.submit(notesRequest(value)).state, "completed");
  assert.equal(queue.submit(dummyRequest(randomUUID())).state, "queued");
});

test("per-item failed/unknown retry retains plan, rejects stale and cross-item attempts", () => {
  const queue = createQueue(), value = input(), batch = queue.submit(notesRequest(value));
  const [a, b] = batch.notes;
  assert.throws(() => queue.begin(value.requestId, "collection", null), /item_id_required/);
  assert.throws(() => queue.status(value.requestId, randomUUID()), /item_not_found/);
  const first = queue.begin(value.requestId, "A", null, a.itemId);
  assert.throws(() => queue.reject(value.requestId, a.itemId), /save_in_progress/);
  queue.failed(value.requestId, first.attemptId, a.itemId);
  const retry = queue.begin(value.requestId, "B", first.attemptId, a.itemId);
  assert.deepEqual(retry.savePlan, first.savePlan);
  for (const method of ["complete", "failed"]) {
    assert.throws(() => queue[method](value.requestId, first.attemptId, a.itemId), /stale_save_attempt/);
    assert.throws(() => queue[method](value.requestId, retry.attemptId, b.itemId), /stale_save_attempt/);
  }
  const saved = queue.complete(value.requestId, retry.attemptId, a.itemId);
  assert.deepEqual(queue.complete(value.requestId, retry.attemptId, a.itemId), saved);
  assert.deepEqual(queue.begin(value.requestId, "B", retry.attemptId, a.itemId), saved);
  assert.throws(() => queue.failed(value.requestId, retry.attemptId, a.itemId), /invalid_state/);
  assert.equal(queue.status(value.requestId, b.itemId).state, "queued");
});

test("TTL expires only untouched items; failed/unknown remain, history cap shared with singles", () => {
  let now = 10; const queue = createQueue({ now: () => now }); const value = input(); const first = queue.submit(notesRequest(value));
  const begun = queue.begin(value.requestId, "A", null, first.notes[0].itemId);
  const failed = queue.begin(value.requestId, "B", null, first.notes[1].itemId); queue.failed(value.requestId, failed.attemptId, first.notes[1].itemId);
  queue.reject(value.requestId, first.notes[2].itemId);
  now += TTL_MS;
  assert.deepEqual(queue.peek().notes.map((item) => item.state), ["saving", "save_failed", "rejected", "expired", "expired"]);
  queue.complete(value.requestId, begun.attemptId, first.notes[0].itemId); queue.reject(value.requestId, first.notes[1].itemId);
  assert.equal(queue.peek(), null); assert.equal(queue.status(value.requestId).state, "completed");
  const active = queue.submit(dummyRequest(randomUUID()));
  const refused = input(); assert.equal(queue.submit(notesRequest(refused)).state, "queue_full");
  queue.reject(active.requestId);
  assert.equal(queue.submit(notesRequest(refused)).state, "queue_full");
  for (let i = 3; i < MAX_HISTORY; i++) { const v = input(1); queue.submit(notesRequest(v)); queue.reject(v.requestId, queue.peek().notes[0].itemId); }
  assert.throws(() => queue.submit(notesRequest(input())), /history_full/);
  assert.equal(queue.submit(notesRequest(value)).state, "completed");
  assert.equal(createQueue().peek(), null);
});

test("MCP contract does not expose save plans or attempts or save automatically", async () => {
  const queue = createQueue(); let submissions = 0;
  const handler = createMcpHandler({ submitMultiple: async (value) => { submissions++; return queue.submit(notesRequest(value)); } });
  await handler({ jsonrpc: "2.0", method: "notifications/initialized" });
  const call = (value) => handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "submit_notes_preview", arguments: value, _meta: { progressToken: "pr3" } } });
  const value = input(), first = await call(value); assert.equal(first.result.isError, false);
  const record = JSON.parse(first.result.content[0].text);
  assert.ok(record.notes.every((item) => !item.saved && !Object.hasOwn(item, "savePlan") && !Object.hasOwn(item, "attemptId")));
  assert.deepEqual(await call(value), first);
  for (const invalid of [{ ...value, collectionId: "A" }, input(6), { ...value, notes: [{ title: "x", body: "x", itemId: randomUUID() }] }]) assert.equal((await call(invalid)).error.code, -32602);
  assert.equal(submissions, 2);
  assert.equal(JSON.parse((await call({ ...value, notes: [{ title: "x", body: "different" }] })).result.content[0].text).state, "request_id_conflict");
  for (const item of queue.peek().notes) { const plan = queue.begin(value.requestId, "A", null, item.itemId); queue.complete(value.requestId, plan.attemptId, item.itemId); }
  const receipt = JSON.parse((await call(value)).result.content[0].text);
  assert.equal(receipt.saved, true); assert.equal(receipt.state, "completed"); assert.ok(receipt.notes.every((item) => item.saved));
});

test("HTTP batch boundary, scopes, host, origin, per-item control and malformed input", async (t) => {
  const browserToken = randomBytes(32).toString("base64url"), adapterToken = randomBytes(32).toString("base64url");
  const { server, queue } = createPreviewService({ browserToken, adapterToken });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const adapter = { Authorization: `Bearer ${adapterToken}` }, browser = { Origin: "http://127.0.0.1:5500", Authorization: `Bearer ${browserToken}` };
  const call = (path, value, headers) => new Promise((resolve, reject) => {
    const body = typeof value === "string" ? value : JSON.stringify(value);
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path, method: "POST", headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      const chunks = []; res.on("data", (data) => chunks.push(data)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    }); req.on("error", reject); req.end(body);
  });
  const value = input();
  value.notes = Array.from({ length: 5 }, () => ({ title: "😀".repeat(200), body: "\u0001".repeat(65536) }));
  assert.equal((await call("/notes", value, {})).status, 401);
  assert.equal((await call("/notes", value, browser)).status, 403);
  assert.equal((await call("/notes", value, { ...adapter, Host: "evil.test" })).status, 403);
  assert.equal((await call("/notes", value, { ...adapter, Origin: "https://evil.test" })).status, 403);
  assert.equal((await call("/notes", input(6), adapter)).status, 400); assert.equal(queue.peek(), null);
  const json = JSON.stringify(value); const boundary = json + " ".repeat(MAX_NOTES_INPUT_BYTES - Buffer.byteLength(json));
  assert.equal((await call("/notes", boundary + " ", adapter)).status, 413); assert.equal(queue.peek(), null);
  assert.equal((await call("/notes", boundary, adapter)).status, 200);
  const item = queue.peek().notes[0]; const control = { requestId: value.requestId, itemId: item.itemId, collectionId: "A", previousAttemptId: null };
  assert.equal((await call("/begin", control, adapter)).status, 403);
  assert.equal((await call("/begin", control, { ...browser, Authorization: adapter.Authorization })).status, 401);
  assert.equal((await call("/begin", { ...control, noteId: "external" }, browser)).status, 400);
  const plan = (await call("/begin", control, browser)).body.request; assert.equal(plan.state, "saving");
  assert.equal((await call("/complete", { requestId: value.requestId, itemId: item.itemId, attemptId: plan.attemptId }, browser)).body.request.saved, true);
  assert.equal((await call("/status", { requestId: value.requestId }, browser)).body.request.notes[0].state, "saved");
  assert.equal((await call("/status", { requestId: value.requestId, itemId: randomUUID() }, browser)).status, 404);
  assert.equal((await call("/notes", { ...value, notes: [{ title: "changed", body: "changed" }] }, adapter)).status, 409);
  assert.equal((await call("/notes", value, adapter)).body.request.notes[0].saved, true);
});

test("stdio accepts the exact enlarged buffer boundary and closes above it", async (t) => {
  const { spawn } = require("node:child_process");
  const path = require("node:path");
  const child = spawn(process.execPath, [path.join(__dirname, "dummy-preview-mcp.js")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  const limit = MAX_NOTES_INPUT_BYTES + 4096;
  let buffer = "", resolveLine;
  child.stdout.on("data", (chunk) => { buffer += chunk.toString(); const index = buffer.indexOf("\n"); if (index >= 0 && resolveLine) { const done = resolveLine; resolveLine = null; done(JSON.parse(buffer.slice(0, index))); buffer = buffer.slice(index + 1); } });
  child.stdin.on("error", () => {});
  const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
  const reply = new Promise((resolve) => { resolveLine = resolve; });
  child.stdin.write(ping + " ".repeat(limit - Buffer.byteLength(ping) - 1) + "\n");
  assert.deepEqual(await Promise.race([reply, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("stdio boundary timeout")), 10000); timer.unref(); })]), { jsonrpc: "2.0", id: 1, result: {} });
  const ended = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  child.stdin.write(" ".repeat(limit + 1));
  assert.equal(await Promise.race([ended, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("stdio limit timeout")), 10000); timer.unref(); })]), 1);
});
