"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const { createPreviewService } = require("./dummy-preview-service.js");
const { createQueue } = require("./dummy-preview-queue.js");
const { validateConfig, loadConfig, createTokenVerifier, receiverRequestId, JWKS_COOLDOWN_MS, JWKS_CACHE_MS } = require("./mcp-http-auth.js");
const { createAuthenticatedServer, MAX_HTTP_BYTES } = require("./mcp-http-server.js");
const { config, issuerFixture, httpFixture, listen, close, wire } = require("./mcp-http-oauth.fixture.js");
const rpc = (method, params = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
const initialize = rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
test("authenticated mode requires explicit configuration and subjects, preserves public path/case/slash", async () => {
  assert.equal(validateConfig(config).resource, config.resource);
  assert.throws(() => loadConfig(require("node:path").join(__dirname, "mcp-http-oauth.config.example.json")), /invalid_configuration/);
  assert.equal(validateConfig({ ...config, resource: config.resource + "/" }).resource, config.resource + "/");
  assert.equal(validateConfig({ ...config, audience: config.audience + "/Case" }).audience, config.audience + "/Case");
  for (const bad of [null, {}, { ...config, mode: "discovery" }, { ...config, allowedSubjects: [] }, { ...config, allowedSubjects: ["client@clients"] },
    { ...config, extra: "secret" }, { ...config, port: 8791 }, { ...config, scopes_supported: ["memo:submit-other"] },
    ...["https://User:secret@host/path", "https://host/path?token=x", "https://host/path#secret", "https://HOST/path", "https://host/a/../path", "http://outside.invalid/mcp"].map(resource => ({ ...config, resource })),
    { ...config, resource_metadata: "https://host/other" }, { ...config, authorization_servers: ["http://issuer.invalid/"] }]) assert.throws(() => validateConfig(bad), /invalid_configuration/);
  const fixture = await issuerFixture();
  await assert.rejects(createAuthenticatedServer(config, { fetchImpl: fixture.fetchImpl }), /adapter_configuration_required/);
  assert.equal(fixture.state.calls.length, 0);
});
test("real RS256 verification rejects invalid claims/signatures and returns 403 only after authentication", async () => {
  const f = await issuerFixture(); const verify = await createTokenVerifier(config, { fetchImpl: f.fetchImpl });
  const bearer = token => `Bearer ${token}`;
  assert.deepEqual(await verify(bearer(await f.sign())), { issuer: config.authorization_servers[0], sub: config.allowedSubjects[0] });
  assert.ok(await verify(bearer(await f.sign({ aud: ["https://issuer.example.invalid/userinfo", config.audience], scope: "openid memo:submit profile" }))));
  const timestamp = Math.floor(Date.now() / 1000);
  const invalid = [undefined, "", "Bearer runtime-key", "Bearer " + "a".repeat(43), "Bearer aaa.bbb.ccc",
    bearer(await f.sign({}, {}, f.other.privateKey)), bearer(await f.sign({}, { alg: "HS256" }, randomBytes(32))),
    ...await Promise.all([{ iss: "https://other.invalid/" }, { aud: "dcr-client-id" }, { aud: config.audience + "/" }, { aud: [config.audience, 1] },
      { exp: timestamp - 60 }, { nbf: timestamp + 60 }, { nbf: "future" }, { iat: timestamp + 60 }, { exp: "9999999999" }, { sub: 1 }, { scope: ["memo:submit"] },
      { scope: "memo:submit\topenid" }, { nonce: "id-token" }, ...["iss", "aud", "exp", "iat", "sub", "scope"].map(name => ({ [name]: undefined }))].map(async value => bearer(await f.sign(value))))];
  for (const header of invalid) await assert.rejects(verify(header), e => e.status === 401 && e.code === "invalid_token");
  for (const claims of [{ scope: "memo:submit-more" }, { scope: "openid" }, { sub: "auth0|unapproved" }, { gty: "client-credentials" }, { sub: "client@clients" }]) {
    await assert.rejects(verify(bearer(await f.sign(claims))), e => e.status === 403);
  }
  assert.ok(f.state.calls.every(call => call.redirect === "error" && call.signal));
  assert.ok(await verify(bearer(await f.sign({ nbf: timestamp + 4 }))));
});
test("JWKS timeout aborts verification and rejects instead of trusting a decoded token", async () => {
  const f = await issuerFixture(); let aborted = false;
  const verify = await createTokenVerifier(config, { fetchImpl: async (url, options) => {
    if (String(url).endsWith("openid-configuration")) return f.fetchImpl(url, options);
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => { aborted = true; reject(options.signal.reason); }, { once: true }));
  } });
  const keepAlive = setTimeout(() => {}, 6000); // Mock fetch has no socket to keep Node alive.
  try { await assert.rejects(verify(`Bearer ${await f.sign()}`), /invalid_token/); assert.equal(aborted, true); }
  finally { clearTimeout(keepAlive); }
});
test("JWKS cache, rotation, unknown kid cooldown, failure throttling and metadata trust", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = await issuerFixture(); const verify = await createTokenVerifier(config, { fetchImpl: f.fetchImpl });
  const check = token => verify(`Bearer ${token}`);
  await check(await f.sign({}, { jku: "https://untrusted.invalid/keys", x5u: "https://untrusted.invalid/cert" }));
  for (let i = 0; i < 4; i++) await assert.rejects(check(await f.sign({}, { kid: "unknown-" + i })), /invalid_token/);
  assert.equal(f.state.calls.length, 2);
  f.state.keys = [f.jwk, f.rotated]; t.mock.timers.tick(JWKS_COOLDOWN_MS + 1);
  await check(await f.sign({}, { kid: "fixture-two" }, f.other.privateKey));
  assert.equal(f.state.calls.length, 3);
  f.state.fail = true; t.mock.timers.tick(JWKS_CACHE_MS + 1);
  await assert.rejects(check(await f.sign()), /invalid_token/);
  for (let i = 0; i < 4; i++) await assert.rejects(check(await f.sign()), /invalid_token/);
  assert.equal(f.state.calls.length, 4, "failed fetch must also be throttled");
  f.state.fail = false; t.mock.timers.tick(JWKS_COOLDOWN_MS + 1); await check(await f.sign());
  f.state.metadata = { issuer: "https://wrong.invalid/", jwks_uri: "https://untrusted.invalid/keys" };
  await assert.rejects(createTokenVerifier(config, { fetchImpl: f.fetchImpl }), /issuer_metadata_mismatch/);
  await assert.rejects(createTokenVerifier(config, { fetchImpl: async () => { throw new Error("TEST_SECRET"); } }), /issuer_metadata_unavailable/);
  await assert.rejects(createTokenVerifier(config, { fetchImpl: async () => new Response("x".repeat(300000)) }), /issuer_metadata_unavailable/);
});
async function setup(t) {
  const queue = createQueue(); let admissions = 0, requests = 0;
  const browserToken = randomBytes(32).toString("base64url"), adapterToken = randomBytes(32).toString("base64url");
  const receiver = createPreviewService({ browserToken, adapterToken, queue: { ...queue, submit(input) { admissions++; return queue.submit(input); } } });
  receiver.server.on("request", () => { requests++; }); const receiverPort = await listen(receiver.server);
  const f = await httpFixture(receiverPort, adapterToken);
  t.after(async () => { await close(f.server); await close(receiver.server); });
  return { ...f, queue, receiverPort, browserToken, sideEffects: () => ({ admissions, requests }) };
}
test("all denied HTTP calls leave receiver, queue and save plans untouched; fixed responses leak nothing", async t => {
  const f = await setup(t);
  const call = rpc("tools/call", { name: "submit_text_preview", arguments: { requestId: randomUUID(), title: "PRIVATE_TITLE", body: "PRIVATE_BODY" } });
  const timestamp = Math.floor(Date.now() / 1000);
  const cases = [[undefined, 401], [f.adapterToken, 401], [f.browserToken, 401], ["TUNNEL_RUNTIME_KEY", 401],
    [await f.sign({}, {}, f.other.privateKey), 401], [await f.sign({}, { alg: "HS256" }, randomBytes(32)), 401],
    ...await Promise.all([{ iss: "https://other.invalid/" }, { aud: "id-token-client" }, { exp: timestamp - 60 }, { nbf: timestamp + 60 },
      { scope: undefined }, { sub: undefined }, { scope: ["memo:submit"] }].map(async claims => [await f.sign(claims), 401])),
    [await f.sign({ scope: "openid" }), 403], [await f.sign({ sub: "auth0|other" }), 403]];
  for (const [token, status] of cases) {
    const response = await wire(f.port, token, call); assert.equal(response.status, status);
    assert.match(response.headers["www-authenticate"], /^Bearer resource_metadata=/);
    assert.doesNotMatch(response.text, /PRIVATE_|TUNNEL_|auth0\||TEST_SECRET/);
    if (token) assert.ok(!response.text.includes(token));
  }
  assert.deepEqual(f.sideEffects(), { admissions: 0, requests: 0 }); assert.equal(f.queue.peek(), null);
  // A signed token with an unknown key is never a queue admission.
  assert.equal((await wire(f.port, await f.sign({}, { kid: "unknown" }), call)).status, 401);
  const failed = await setup(t); failed.state.fail = true;
  assert.equal((await wire(failed.port, failed.token, call)).status, 401);
  assert.deepEqual(failed.sideEffects(), { admissions: 0, requests: 0 }); assert.equal(failed.queue.peek(), null);
});
test("SDK initialize, notification, ping, only two tools, text/notes, replay and principal isolation", async t => {
  const f = await setup(t);
  const send = message => wire(f.port, f.token, message);
  const init = await send(initialize); assert.equal(init.status, 200); assert.equal(init.json.result.protocolVersion, "2025-11-25"); assert.equal(init.headers["mcp-session-id"], undefined);
  assert.equal((await send({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  assert.deepEqual((await send(rpc("ping"))).json.result, {});
  assert.deepEqual((await send(rpc("tools/list"))).json.result.tools.map(tool => tool.name), ["submit_text_preview", "submit_notes_preview"]);
  const input = { requestId: randomUUID(), title: "original", body: "line 1\r\n[[link]]\n" };
  const call = rpc("tools/call", { name: "submit_text_preview", arguments: input });
  const response = await send(call); assert.equal(response.status, 200); assert.equal(response.json.result.isError, false);
  const record = JSON.parse(response.json.result.content[0].text); assert.equal(record.requestId, input.requestId); assert.equal(record.saved, false);
  const internalId = receiverRequestId({ issuer: config.authorization_servers[0], sub: config.allowedSubjects[0] }, input.requestId);
  assert.equal(f.queue.peek().requestId, internalId); assert.equal(f.queue.peek().body, input.body); assert.equal(f.queue.peek().savePlan, null);
  assert.deepEqual((await send(call)).json.result, response.json.result);
  const conflict = await send(rpc("tools/call", { name: "submit_text_preview", arguments: { ...input, body: "changed" } }));
  assert.equal(JSON.parse(conflict.json.result.content[0].text).state, "request_id_conflict"); assert.equal(conflict.json.result.isError, true);
  const other = await wire(f.port, await f.sign({ sub: config.allowedSubjects[1] }), rpc("tools/call", { name: "submit_text_preview", arguments: { ...input, body: "other principal's content" } }));
  assert.equal(JSON.parse(other.json.result.content[0].text).state, "queue_full"); assert.equal(other.json.result.isError, true);
  assert.equal(JSON.parse(other.json.result.content[0].text).body, "other principal's content"); assert.equal(f.queue.peek().body, input.body);
  assert.notEqual(receiverRequestId({ issuer: config.authorization_servers[0], sub: config.allowedSubjects[1] }, input.requestId), internalId);
  f.queue.reject(internalId);
  const notes = { requestId: randomUUID(), notes: [{ title: "one", body: "one body" }, { title: "two", body: "two body" }] };
  const multiple = await send(rpc("tools/call", { name: "submit_notes_preview", arguments: notes }));
  const result = JSON.parse(multiple.json.result.content[0].text); assert.equal(result.notes.length, 2); assert.equal(result.saved, false);
  assert.ok(f.queue.peek().notes.every(item => item.saved === false && item.savePlan === null));
  const before = f.sideEffects();
  for (const params of [{ name: "submit_dummy_preview", arguments: { requestId: randomUUID() } }, { name: "read_memo", arguments: {} },
    { name: "submit_text_preview", arguments: { ...input, extra: "no" } }, { name: "submit_notes_preview", arguments: { ...notes, notes: [] } }]) {
    assert.equal((await send(rpc("tools/call", params))).json.error.code, -32602);
  }
  assert.deepEqual(f.sideEffects(), before);
  assert.equal((await wire(f.port, undefined, rpc("ping"))).status, 401);
  assert.equal((await wire(f.port, await f.sign({ exp: Math.floor(Date.now() / 1000) - 60 }), rpc("ping"))).status, 401);
});
test("HTTP security, body bounds, JSON/protocol errors, sessions and receiver failure", async t => {
  const f = await setup(t); const before = f.sideEffects();
  for (const headers of [{ Host: "evil.invalid" }, { Origin: "null" }, { Origin: "https://evil.invalid" }, { Forwarded: "for=evil" }, { Forwarded: "" }, { "X-Http-Method-Override": "" }, { "X-Forwarded-Proto": "https" }]) assert.equal((await wire(f.port, f.token, initialize, { headers })).status, 403);
  assert.equal((await wire(f.port, f.token, initialize, { headers: { "MCP-Session-Id": "someone-else" } })).status, 400);
  assert.equal((await wire(f.port, f.token, initialize, { headers: { "Content-Type": "text/plain" } })).status, 415);
  const invalidJson = await wire(f.port, f.token, undefined, { body: "{oops" });
  assert.equal(invalidJson.status, 400); assert.equal(invalidJson.json.error.code, -32700);
  assert.equal((await wire(f.port, f.token, undefined, { body: "", headers: { "Content-Length": MAX_HTTP_BYTES + 1 } })).status, 413);
  assert.equal((await wire(f.port, f.token, rpc("ping"), { headers: { "MCP-Protocol-Version": "unknown" } })).status, 400);
  assert.equal((await wire(f.port, f.token, [initialize])).status, 400);
  for (const method of ["GET", "DELETE"]) assert.equal((await wire(f.port, f.token, undefined, { method })).status, 405);
  assert.equal((await wire(f.port, undefined, undefined, { method: "GET" })).status, 401);
  assert.equal((await wire(f.port, undefined, undefined, { method: "GET", target: "/.well-known/oauth-protected-resource/mcp" })).json.resource, config.resource);
  assert.deepEqual(f.sideEffects(), before);
  const badReceiver = await httpFixture(1); t.after(() => close(badReceiver.server));
  const response = await wire(badReceiver.port, badReceiver.token, rpc("tools/call", { name: "submit_text_preview", arguments: { requestId: randomUUID(), title: "test", body: "PRIVATE_BODY" } }));
  assert.equal(response.json.result.isError, true); assert.equal(JSON.parse(response.json.result.content[0].text).state, "unconfirmed");
  assert.doesNotMatch(response.text, /PRIVATE_BODY/);
});
test("official SDK HTTP client connects and submits through the authenticated gate", async t => {
  const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const f = await setup(t);
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${f.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${f.token}` } } });
  const client = new Client({ name: "official-sdk-fixture", version: "1" }); t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 2);
  const result = await client.callTool({ name: "submit_text_preview", arguments: { requestId: randomUUID(), title: "SDK", body: "SDK body" } });
  assert.equal(result.isError, false); assert.equal(JSON.parse(result.content[0].text).saved, false);
  assert.equal(f.sideEffects().admissions, 1);
});
