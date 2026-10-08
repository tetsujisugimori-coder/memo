"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const http = require("node:http");
const { textRequest, createQueue, TTL_MS, MAX_TEXT_INPUT_BYTES } = require("./dummy-preview-queue.js");
const { createPreviewService } = require("./dummy-preview-service.js");
const { createMcpHandler } = require("./dummy-preview-mcp.js");
const input = () => ({ requestId: randomUUID(), title: " 日本語タイトル ", body: "\n日本語\n\n- 項目\n`inline`\n```js\nlet x = 1;\n```\n<script>alert(1)</script>\n" });

test("text validation preserves strings and rejects invalid inputs before queue mutation", () => {
  const queue = createQueue(); const value = input();
  const expected = textRequest(value); assert.equal(expected.body, value.body); assert.equal(expected.title, value.title);
  const baseline = queue.submit(expected);
  for (const patch of [{ title: "" }, { title: " \n\t" }, { body: "" }, { body: " \n" }, { title: null }, { body: 1 }, { body: [] },
    { title: "😀".repeat(201) }, { body: "日".repeat(21846) }, { body: "a".repeat(65537) }, { noteId: "existing" }, { collectionId: "other" }]) {
    assert.throws(() => queue.submit(textRequest({ ...input(), ...patch })));
    assert.deepEqual(queue.peek(), baseline);
  }
  assert.equal(textRequest({ ...input(), title: "😀".repeat(200), body: "a".repeat(65536) }).body.length, 65536);
  assert.equal(textRequest({ ...input(), body: "日".repeat(21845) + "a" }).body.length, 21846);
});

test("stable save plan survives failure, TTL and reload; terminal IDs never resurrect", () => {
  let now = 10; const queue = createQueue({ now: () => now }); const value = textRequest(input());
  const first = queue.submit(value); assert.equal(first.saved, false);
  assert.deepEqual(queue.submit(value), first);
  assert.throws(() => queue.submit({ ...value, body: "different" }), /request_id_conflict/);
  const plan = queue.begin(value.requestId, "system-unclassified", null);
  assert.equal(plan.saved, false); assert.equal(plan.state, "saving");
  assert.throws(() => queue.reject(value.requestId), /save_in_progress/);
  now += TTL_MS * 2; assert.deepEqual(queue.peek(), plan);
  queue.failed(value.requestId, plan.attemptId); assert.equal(queue.peek().state, "save_failed");
  const retry = queue.begin(value.requestId, "other", plan.attemptId); assert.deepEqual(retry.savePlan, plan.savePlan);
  const saved = queue.complete(value.requestId, retry.attemptId); assert.equal(saved.saved, true); assert.equal(queue.peek(), null);
  assert.deepEqual(queue.complete(value.requestId, retry.attemptId), saved); assert.deepEqual(queue.submit(value), saved);
  assert.deepEqual(queue.begin(value.requestId, "other", saved.attemptId), saved);
  const discard = textRequest(input()); queue.submit(discard); const discardPlan = queue.begin(discard.requestId, "system-unclassified", null); queue.failed(discard.requestId, discardPlan.attemptId);
  assert.equal(queue.reject(discard.requestId).state, "rejected"); assert.equal(queue.submit(discard).state, "rejected");
  assert.equal(createQueue().peek(), null);
});

test("arbitrary MCP receives without saving, distinguishes saved receipts and rejects conflicts", async () => {
  const queue = createQueue(); const handler = createMcpHandler({ submitArbitrary: async (value) => queue.submit(textRequest(value)) });
  await handler({ jsonrpc: "2.0", method: "notifications/initialized" });
  const value = input();
  const call = (argumentsValue) => handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "submit_text_preview", arguments: argumentsValue, _meta: { progressToken: "pr2" } } });
  const first = await call(value); assert.equal(JSON.parse(first.result.content[0].text).saved, false);
  assert.deepEqual(await call(value), first);
  assert.equal(JSON.parse((await call({ ...value, body: "changed" })).result.content[0].text).state, "request_id_conflict");
  assert.equal((await call({ ...value, noteId: "existing" })).error.code, -32602);
  assert.equal((await call({ ...value, body: "" })).error.code, -32602);
  const plan = queue.begin(value.requestId, "system-unclassified", null); queue.complete(value.requestId, plan.attemptId);
  const receipt = JSON.parse((await call(value)).result.content[0].text);
  assert.equal(receipt.saved, true); assert.match(receipt.message, /このMCP呼び出しは保存しません/);
  assert.equal(Object.hasOwn(receipt, "savePlan"), false);
  assert.equal(Object.hasOwn(receipt, "attemptId"), false);
});

test("HTTP text input limits and browser-only save state routes retain authentication scopes", async (t) => {
  const browserToken = randomBytes(32).toString("base64url"), adapterToken = randomBytes(32).toString("base64url");
  const { server, queue } = createPreviewService({ browserToken, adapterToken });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const adapter = { Authorization: `Bearer ${adapterToken}` };
  const browser = { Origin: "http://127.0.0.1:5500", Authorization: `Bearer ${browserToken}` };
  const call = (path, value, headers) => new Promise((resolve, reject) => {
    const body = typeof value === "string" ? value : JSON.stringify(value);
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path, method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      const chunks = []; res.on("data", (data) => chunks.push(data)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    }); req.on("error", reject); req.end(body);
  });
  const value = input();
  assert.equal((await call("/text", value, browser)).status, 403);
  assert.equal((await call("/text", { ...value, collectionId: "other" }, adapter)).status, 400);
  assert.equal(queue.peek(), null);
  assert.equal((await call("/text", "x".repeat(MAX_TEXT_INPUT_BYTES + 1), adapter)).status, 413);
  // Near-worst JSON escaping remains accepted within the body byte contract.
  const large = { ...value, body: "\u0001".repeat(65536) };
  assert.equal((await call("/text", large, adapter)).status, 200);
  const before = queue.peek();
  assert.equal((await call("/text", value, adapter)).status, 409);
  assert.deepEqual(queue.peek(), before);
  for (const path of ["/begin", "/complete", "/failed", "/reject"]) {
    assert.equal((await call(path, { requestId: value.requestId, ...(path === "/begin" ? { collectionId: "system-unclassified" } : {}) }, adapter)).status, 403);
  }
  assert.equal((await call("/begin", { requestId: value.requestId, collectionId: "system-unclassified", noteId: "existing" }, browser)).status, 400);
  const begun = (await call("/begin", { requestId: value.requestId, collectionId: "system-unclassified", previousAttemptId: null }, browser)).body.request;
  assert.equal(begun.saved, false);
  assert.equal((await call("/failed", { requestId: value.requestId }, browser)).status, 400);
  assert.equal((await call("/failed", { requestId: value.requestId, attemptId: begun.attemptId }, browser)).body.request.state, "save_failed");
  assert.equal((await call("/complete", { requestId: value.requestId, attemptId: begun.attemptId }, browser)).status, 409);
  const retry = (await call("/begin", { requestId: value.requestId, collectionId: "system-unclassified", previousAttemptId: begun.attemptId }, browser)).body.request;
  const snapshot = queue.status(value.requestId);
  for (const route of ["/complete", "/failed"]) assert.equal((await call(route, { requestId: value.requestId, attemptId: begun.attemptId }, browser)).status, 409);
  assert.deepEqual(queue.status(value.requestId), snapshot);
  assert.equal((await call("/begin", { requestId: value.requestId, collectionId: "system-unclassified", previousAttemptId: begun.attemptId }, browser)).status, 409);
  assert.deepEqual(queue.status(value.requestId), snapshot);
  assert.equal((await call("/complete", { requestId: value.requestId, attemptId: retry.attemptId }, browser)).body.request.saved, true);
});

test("stale attempt notifications cannot fail or complete a later attempt or terminal receipt", () => {
  const queue = createQueue(); const value = textRequest(input()); queue.submit(value);
  const first = queue.begin(value.requestId, "system-unclassified", null), second = queue.begin(value.requestId, "other", first.attemptId);
  assert.deepEqual(first.savePlan, second.savePlan); assert.notEqual(first.attemptId, second.attemptId);
  assert.throws(() => queue.begin(value.requestId, "other", null), /stale_save_attempt/);
  assert.deepEqual(queue.status(value.requestId), second);
  for (const method of ["failed", "complete"]) {
    assert.throws(() => queue[method](value.requestId, first.attemptId), /stale_save_attempt/);
    assert.deepEqual(queue.status(value.requestId), second);
  }
  queue.failed(value.requestId, second.attemptId);
  const recovered = queue.begin(value.requestId, "system-unclassified", second.attemptId);
  assert.throws(() => queue.failed(value.requestId, second.attemptId), /stale_save_attempt/);
  const saved = queue.complete(value.requestId, recovered.attemptId);
  assert.throws(() => queue.failed(value.requestId, recovered.attemptId), /invalid_state/);
  assert.throws(() => queue.complete(value.requestId, first.attemptId), /stale_save_attempt/);
  assert.deepEqual(queue.status(value.requestId), saved);
});
