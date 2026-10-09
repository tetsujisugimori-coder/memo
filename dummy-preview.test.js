"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const { FIXTURE, TTL_MS, MAX_HISTORY, MAX_BODY_BYTES, validateRequest, dummyRequest, createQueue } = require("./dummy-preview-queue.js");
const { createPreviewService } = require("./dummy-preview-service.js");
const { createMcpHandler } = require("./dummy-preview-mcp.js");
const id = () => randomUUID();
test("strict schema and UTF-8/code point size boundaries on internal validation path", () => {
  const value = dummyRequest(id());
  assert.deepEqual(validateRequest(value), value);
  for (const key of ["id", "noteId", "update", "delete", "tags", "collectionId", "image", "attachments", "report", "unknown"]) {
    assert.throws(() => validateRequest({ ...value, [key]: "forbidden" }), /invalid_format/);
  }
  for (const patch of [{ formatVersion: 2 }, { dummy: "false" }, { requestId: "memo-id" }, { title: null }, { body: [] }]) assert.throws(() => validateRequest({ ...value, ...patch }), /invalid_format/);
  assert.equal(validateRequest({ ...value, title: "😀".repeat(200), body: "a".repeat(MAX_BODY_BYTES) }).body.length, MAX_BODY_BYTES);
  assert.throws(() => validateRequest({ ...value, title: "😀".repeat(201) }), /size_limit/);
  assert.throws(() => validateRequest({ ...value, body: "a".repeat(MAX_BODY_BYTES + 1) }), /size_limit/);
  assert.equal(Buffer.byteLength(validateRequest({ ...value, body: "日".repeat(21845) + "a" }).body), MAX_BODY_BYTES);
  assert.throws(() => validateRequest({ ...value, body: "日".repeat(21846) }), /size_limit/);
  assert.throws(() => createQueue().submit({ ...value, body: "任意本文" }), /fixed_dummy_only/);
});
test("one slot, stable full refusal, repeated rejection, conflict, expiry and bounded history", () => {
  let time = 1000; const queue = createQueue({ now: () => time }); const first = dummyRequest(id()); const other = dummyRequest(id());
  const queued = queue.submit(first);
  assert.equal(queued.state, "queued"); assert.equal(queued.saved, false);
  assert.deepEqual(queue.peek(), queued); assert.deepEqual(queue.peek(), queued);
  assert.deepEqual(queue.submit(first), queued);
  assert.throws(() => queue.submit({ ...first, body: "different" }), /request_id_conflict/);
  const full = queue.submit(other); assert.equal(full.state, "queue_full");
  const rejected = queue.reject(first.requestId); assert.equal(rejected.state, "rejected");
  assert.deepEqual(queue.reject(first.requestId), rejected);
  assert.deepEqual(queue.submit(other), full); assert.equal(queue.peek(), null);
  assert.equal(queue.submit(first).state, "rejected");
  const third = dummyRequest(id()); queue.submit(third); time += TTL_MS - 1;
  assert.equal(queue.peek().state, "queued"); time++;
  assert.equal(queue.peek(), null); assert.equal(queue.status(third.requestId).state, "expired");
  assert.equal(queue.reject(third.requestId).state, "expired"); assert.equal(queue.submit(third).state, "expired");
  for (let n = 3; n < MAX_HISTORY; n++) { const item = dummyRequest(id()); queue.submit(item); queue.reject(item.requestId); }
  assert.throws(() => queue.submit(dummyRequest(id())), /history_full/);
  assert.equal(createQueue().peek(), null);
});
function wire(port, { path = "/pending", method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers: { ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      const chunks = []; res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => { const text = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }); });
    }); req.on("error", reject); req.end(body);
  });
}
test("HTTP auth, exact Origin/Host/routes/headers/preflight, bounded input and independent scopes", async (t) => {
  const browserToken = randomBytes(32).toString("base64url"); const adapterToken = randomBytes(32).toString("base64url");
  const { server, queue } = createPreviewService({ browserToken, adapterToken });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const port = server.address().port; const origin = "http://127.0.0.1:5500";
  const browser = { Origin: origin, Authorization: `Bearer ${browserToken}` };
  const adapter = { Authorization: `Bearer ${adapterToken}`, "Content-Type": "application/json" };
  assert.equal((await wire(port)).status, 403);
  assert.equal((await wire(port, { headers: { Origin: origin } })).status, 401);
  for (const invalid of ["null", "https://evil.invalid", "https://tetsujisugimori-coder.github.io/memo/"]) assert.equal((await wire(port, { headers: { ...browser, Origin: invalid } })).status, 403);
  assert.equal((await wire(port, { headers: { ...browser, Host: `localhost:${port}` } })).status, 403);
  assert.equal((await wire(port, { headers: { ...browser, "X-Forwarded-Host": "evil.invalid" } })).status, 403);
  assert.equal((await wire(port, { headers: { ...browser, Authorization: `Bearer ${adapterToken}` } })).status, 401);
  assert.equal((await wire(port, { path: "/pending?token=forbidden", headers: browser })).status, 404);
  assert.equal((await wire(port, { method: "DELETE", headers: browser })).status, 405);
  const cors = await wire(port, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Authorization", "Access-Control-Request-Private-Network": "true" } });
  assert.equal(cors.status, 204); assert.equal(cors.headers["access-control-allow-origin"], origin); assert.equal(cors.headers["access-control-allow-private-network"], "true");
  assert.equal((await wire(port, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Authorization, X-Evil" } })).status, 400);
  assert.equal((await wire(port, { headers: { ...browser, Authorization: [browser.Authorization, browser.Authorization] } })).status, 400);
  assert.equal((await wire(port, { headers: { ...browser, "X-Unknown": "forbidden" } })).status, 400);
  assert.equal((await wire(port, { headers: { ...browser, "Cache-Control": "no-cache", Pragma: "no-cache" } })).status, 200);
  const requestId = id(); const body = JSON.stringify({ requestId });
  assert.equal((await wire(port, { path: "/dummy", method: "POST", body, headers: { ...adapter, Origin: origin } })).status, 403);
  assert.equal((await wire(port, { path: "/dummy", method: "POST", body, headers: { ...adapter, Authorization: `Bearer ${browserToken}` } })).status, 401);
  for (const input of [{ requestId, body: FIXTURE.body }, { requestId, noteId: "existing" }, { requestId: "wrong" }, []]) assert.equal((await wire(port, { path: "/dummy", method: "POST", body: JSON.stringify(input), headers: adapter })).status, 400);
  assert.equal((await wire(port, { path: "/dummy", method: "POST", body: "x".repeat(1025), headers: adapter })).status, 413);
  assert.equal((await wire(port, { path: "/dummy", method: "POST", body: "{", headers: adapter })).status, 400);
  assert.equal((await wire(port, { path: "/dummy", method: "POST", body, headers: { ...adapter, "Content-Type": "text/plain" } })).status, 415);
  const submitted = await wire(port, { path: "/dummy", method: "POST", body, headers: adapter }); assert.equal(submitted.status, 200);
  const fetched = await wire(port, { headers: browser }); assert.equal(fetched.body.pending.requestId, requestId);
  assert.equal(fetched.body.pending.body, FIXTURE.body); assert.equal(queue.peek().state, "queued");
  assert.deepEqual((await wire(port, { path: "/dummy", method: "POST", body, headers: adapter })).body, submitted.body);
  const other = JSON.stringify({ requestId: id() }); assert.equal((await wire(port, { path: "/dummy", method: "POST", body: other, headers: adapter })).status, 409);
  const rejection = await wire(port, { path: "/reject", method: "POST", body, headers: { ...browser, "Content-Type": "application/json" } });
  assert.equal(rejection.body.request.state, "rejected"); assert.equal((await wire(port, { headers: browser })).body.pending, null);
  assert.deepEqual((await wire(port, { path: "/reject", method: "POST", body, headers: { ...browser, "Content-Type": "application/json" } })).body, rejection.body);
  assert.equal((await wire(port, { headers: { ...browser, Origin: "https://tetsujisugimori-coder.github.io" } })).status, 200);
  let limited; for (let n = 0; n < 130; n++) { limited = await wire(port, { headers: browser }); if (limited.status === 429) break; }
  assert.equal(limited.status, 429);
});
test("MCP retains fixed dummy submission alongside text preview; requestId is caller generated and preserved", async () => {
  const queue = createQueue(); const handler = createMcpHandler({ submit: async (requestId) => queue.submit(dummyRequest(requestId)) });
  assert.equal((await handler(null)).error.code, -32600);
  const call = (method, params) => handler({ jsonrpc: "2.0", id: 1, method, params });
  await call("initialize", { protocolVersion: "2025-06-18" }); await handler({ jsonrpc: "2.0", method: "notifications/initialized" });
  const list = await call("tools/list"); assert.deepEqual(list.result.tools.map((tool) => tool.name), ["submit_dummy_preview", "submit_text_preview", "submit_notes_preview"]);
  const requestId = id(); const params = { name: "submit_dummy_preview", arguments: { requestId } };
  const response = await call("tools/call", params); const result = JSON.parse(response.result.content[0].text);
  assert.equal(result.requestId, requestId); assert.equal(result.state, "queued"); assert.equal(result.saved, false);
  assert.match(result.message, /一時キューで受信・未保存/); assert.equal(queue.peek().requestId, requestId);
  assert.deepEqual(await call("tools/call", params), response);
  assert.equal((await call("tools/call", { ...params, arguments: { requestId, body: "arbitrary" } })).error.code, -32602);
  assert.equal((await call("tools/call", { ...params, name: "create_memo" })).error.code, -32602);
});
test("MCP standard metadata is validated independently and never passed to submission", async () => {
  const queue = createQueue(); const submissions = [];
  const handler = createMcpHandler({ submit: async (...args) => { submissions.push(args); return queue.submit(dummyRequest(args[0])); } });
  await handler({ jsonrpc: "2.0", method: "notifications/initialized" });
  const requestId = id(); const params = { name: "submit_dummy_preview", arguments: { requestId } };
  const call = (value) => handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: value });
  const original = await call(params); const record = queue.peek();
  const valid = [{}, { progressToken: "test" }, { progressToken: 0 }, { progressToken: 1.5 }, { progressToken: "" },
    { "com.example/trace_id": { nested: [true, null, "opaque"] }, "mcp.io/test": false, "": null, "example.org/": 42, body: "ignored metadata" }];
  for (const _meta of valid) {
    assert.deepEqual(await call({ ...params, _meta }), original);
    assert.deepEqual(queue.peek(), record);
  }
  assert.deepEqual(submissions, Array.from({ length: valid.length + 1 }, () => [requestId]));
  assert.equal(Object.hasOwn(record, "_meta"), false);
  const count = submissions.length;
  for (const _meta of [null, [], "test", 3, true, { progressToken: null }, { progressToken: true }, { progressToken: {} },
    { progressToken: [] }, { progressToken: NaN }, { progressToken: Infinity }, { "bad key": 1 }, { "_name": 1 },
    { "1example.org/name": 1 }, { "example..org/name": 1 }, { "example.org-/name": 1 }, { "example.org/name/extra": 1 }, { "name-": 1 }, { "name\n": 1 }]) {
    assert.equal((await call({ ...params, _meta })).error.code, -32602);
  }
  const _meta = { progressToken: "test", "com.example/trace": "opaque" };
  for (const key of ["body", "title", "noteId", "id", "update", "delete", "unknown", "_meta"]) {
    assert.equal((await call({ ...params, _meta, arguments: { requestId, [key]: "forbidden" } })).error.code, -32602);
  }
  for (const value of [{ ...params, _meta, arguments: { requestId: "memo-id" } }, { ...params, _meta, name: "create_memo" },
    { ...params, _meta, unknown: true }, { name: params.name, _meta }, { arguments: params.arguments, _meta }]) {
    assert.equal((await call(value)).error.code, -32602);
  }
  assert.equal(submissions.length, count);
  assert.deepEqual(queue.peek(), record);
});

test("MCP metadata retries preserve rejection, full refusal and expiry without resurrection", async () => {
  let time = 1000; const queue = createQueue({ now: () => time });
  const handler = createMcpHandler({ submit: async (requestId) => queue.submit(dummyRequest(requestId)) });
  await handler({ jsonrpc: "2.0", method: "notifications/initialized" });
  const call = async (requestId) => JSON.parse((await handler({ jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "submit_dummy_preview", arguments: { requestId }, _meta: { progressToken: "test" } } })).result.content[0].text);
  const first = id(); const second = id();
  const queued = await call(first); assert.equal(queued.state, "queued"); assert.deepEqual(await call(first), queued);
  const full = await call(second); assert.equal(full.state, "queue_full");
  queue.reject(first); assert.equal((await call(first)).state, "rejected"); assert.equal(queue.peek(), null);
  assert.deepEqual(await call(second), full); assert.equal(queue.peek(), null);
  const third = id(); await call(third); time += TTL_MS;
  assert.equal((await call(third)).state, "expired"); assert.equal(queue.peek(), null);
  assert.equal((await call(third)).state, "expired"); assert.equal(queue.peek(), null);
});

test("incoming modules have no persistence, editor, Import or clipper capabilities", () => {
  for (const file of ["dummy-preview-ui.js", "dummy-preview-queue.js", "dummy-preview-service.js", "dummy-preview-mcp.js"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\b(createNote|persistIncomingNote|putNote|indexedDB|localStorage|sessionStorage|noteSaveFoundation|enqueueNoteSave|draftMirror|saveWebClip|importJson|importMarkdownZip)\b/);
    assert.doesNotMatch(source, /\b(?:let|const|var)\s+notes\b|(?<![.\w])notes\s*(?:\.|\[|\()|\b(?:window|globalThis)\.notes\b/);
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|\beval\b|WebSocket|EventSource/);
  }
});
