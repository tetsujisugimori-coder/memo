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
test("opt-in diagnostics track authentication/discovery without changing responses or exposing inputs", async t => {
  const f = await issuerFixture(), adapterToken = randomBytes(32).toString("base64url"), logs = [];
  const servers = [];
  t.after(async () => { for (const server of servers) await close(server); });
  const ports = [];
  for (const diagnostics of [false, true]) {
    const server = await createAuthenticatedServer(config, { adapterToken, receiverPort: 1, fetchImpl: f.fetchImpl,
      diagnostics, diagnosticWriter: line => logs.push(line) });
    servers.push(server); ports.push(await listen(server));
  }
  const token = await f.sign(), other = await f.sign({ sub: "auth0|PRIVATE_USER" }), scope = await f.sign({ scope: "openid" });
  const privateInput = rpc("PRIVATE_METHOD", { title: "PRIVATE_TITLE", body: "PRIVATE_BODY", requestId: "PRIVATE_ID" });
  const cases = [
    [undefined, privateInput, {}, 401, "invalid_token", "authentication"],
    ["PRIVATE_INVALID_TOKEN", undefined, { body: "PRIVATE_INVALID_JSON" }, 401, "invalid_token", "authentication"],
    [other, privateInput, {}, 403, "subject_forbidden", "authentication"],
    [scope, privateInput, {}, 403, "insufficient_scope", "authentication"],
    [token, initialize, {}, 200, "none", "initialize"],
    [token, rpc("tools/list"), {}, 200, "none", "tools_list"],
    [token, rpc("initialize", { clientInfo: "PRIVATE_CLIENT" }), {}, 200, "internal_error", "initialize"],
    [token, privateInput, {}, 200, "method_not_found", "mcp_other"],
    [token, undefined, { body: "PRIVATE_INVALID_JSON" }, 400, "parse_error", "body"],
    [token, privateInput, { target: "/PRIVATE_PATH?code=PRIVATE_CODE" }, 404, "not_found", "routing"],
    [token, initialize, { headers: { Origin: "PRIVATE_ORIGIN" } }, 403, "invalid_origin", "headers"],
    [token, initialize, { headers: { Accept: "text/plain", Cookie: "PRIVATE_COOKIE" } }, 406, "protocol_error", "initialize"],
    [undefined, undefined, { target: "/.well-known/oauth-protected-resource/mcp", method: "GET" }, 200, "none", "routing"]
  ];
  for (const [bearer, message, options, status, classification, stage] of cases) {
    const before = logs.length;
    const off = await wire(ports[0], bearer, message, options);
    assert.equal(logs.length, before, "OFF emits no diagnostic events");
    const on = await wire(ports[1], bearer, message, options);
    assert.equal(on.status, status); assert.equal(on.status, off.status); assert.equal(on.text, off.text);
    if (message?.params?.clientInfo === "PRIVATE_CLIENT") assert.equal(on.json.error.code, -32603, "SDK's existing invalid initialize response is preserved");
    if (options.headers?.Accept === "text/plain") assert.equal(on.json.error.code, -32000, "SDK's generic HTTP rejection remains a generic diagnostic");
    for (const name of ["www-authenticate", "content-type", "cache-control", "x-content-type-options", "allow"]) assert.equal(on.headers[name], off.headers[name]);
    const events = logs.slice(before).map(line => JSON.parse(line));
    assert.equal(events[0].event, "request_received");
    assert.equal(events[0].bearerPresent, bearer !== undefined);
    assert.ok(events.every(event => event.sequence === events[0].sequence && /^\d{4}-\d\d-\d\dT.*Z$/.test(event.timestamp)));
    const final = events.find(event => event.event === "response");
    assert.deepEqual([final.status, final.classification, final.stage], [status, classification, stage]);
    if (stage === "authentication") assert.ok(!events.some(event => ["protocol_request", "tools_prepared", "protocol_result"].includes(event.event)));
    if (stage === "initialize" || stage === "tools_list") {
      assert.ok(events.some(event => event.event === "protocol_request"));
      const prepared = events.find(event => event.event === "tools_prepared");
      assert.equal(prepared.toolCount, 2); assert.equal(prepared.expectedTools, true);
      const result = events.find(event => event.event === "protocol_result");
      assert.equal(result.success, classification === "none");
      if (stage === "tools_list") { assert.equal(result.toolCount, 2); assert.equal(result.expectedTools, true); }
    }
  }
  const text = logs.join("\n");
  for (const secret of [token, other, scope, adapterToken, ...config.allowedSubjects, "PRIVATE_", config.resource, config.authorization_servers[0]]) assert.ok(!text.includes(secret));
  const allowedKeys = new Set(["diagnostic", "timestamp", "sequence", "event", "stage", "path", "method", "bearerPresent", "status", "httpStatus", "classification", "success", "toolCount", "expectedTools"]);
  assert.ok(logs.every(line => Object.keys(JSON.parse(line)).every(key => allowedKeys.has(key))));
  const sequences = logs.map(line => JSON.parse(line)).filter(event => event.event === "request_received").map(event => event.sequence);
  assert.deepEqual(sequences, cases.map((_, i) => i + 1));
});
test("forwarding diagnostics use complete fixed ordered labels without leaking headers or changing HTTP", async t => {
  const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
  const connect = t.mock.method(Server.prototype, "connect", async () => { assert.fail("rejected requests must not reach MCP"); });
  const f = await issuerFixture(), logs = [], servers = [], ports = [];
  const adapterToken = randomBytes(32).toString("base64url");
  t.after(async () => { for (const server of servers) await close(server); });
  for (const mode of ["off", "on", "throw"]) {
    const server = await createAuthenticatedServer(config, { adapterToken, fetchImpl: f.fetchImpl,
      diagnostics: mode !== "off", diagnosticWriter: line => {
        if (mode === "throw") throw new Error("PRIVATE_WRITER_MESSAGE_STACK");
        logs.push(line);
      } });
    servers.push(server); ports.push(await listen(server));
  }
  const labels = ["forwarded", "x_forwarded_for", "x_forwarded_host", "x_forwarded_proto", "x_forwarded_port", "x_forwarded_other", "method_override"];
  const names = ["Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-Port", "X-Forwarded-PRIVATE_NAME", "X-HTTP-Method-Override"];
  const values = ["for=192.0.2.123;by=PRIVATE_PROXY", "198.51.100.42", "PRIVATE_HOST", "PRIVATE_PROTO", "PRIVATE_PORT", "PRIVATE_VALUE", "PRIVATE_METHOD"];
  const token = await f.sign(), message = rpc("PRIVATE_RPC", { body: "PRIVATE_BODY", requestId: "PRIVATE_ID" });
  const cases = [];
  for (let i = 0; i < names.length; i++) {
    for (const name of [names[i], names[i].toLowerCase(), names[i].toUpperCase()]) cases.push([{ [name]: values[i] }, [labels[i]]]);
    cases.push([{ [names[i]]: "" }, [labels[i]]]);
  }
  const combined = Object.fromEntries(names.map((name, i) => [name, values[i]]));
  cases.push([combined, labels], [Object.fromEntries(Object.entries(combined).reverse()), labels],
    [{ "x-FoRwArDeD-pOrT": "PRIVATE_PORT" }, ["x_forwarded_port"]],
    [{ "X-Forwarded-Port": ["PRIVATE_PORT_ONE", "PRIVATE_PORT_TWO"] }, ["x_forwarded_port"]],
    [{ "X-Forwarded-Port": ["", ""] }, ["x_forwarded_port"]],
    [{ "X-Forwarded-PRIVATE_ONE": "PRIVATE_ONE", "x-FoRwArDeD-PRIVATE_TWO": "PRIVATE_TWO" }, ["x_forwarded_other"]]);
  const portAndUnknown = { "X-Forwarded-Port": "PRIVATE_PORT", "X-Forwarded-PRIVATE_ONE": "PRIVATE_ONE", "x-FoRwArDeD-PRIVATE_TWO": "PRIVATE_TWO" };
  for (const headers of [portAndUnknown, Object.fromEntries(Object.entries(portAndUnknown).reverse())])
    cases.push([headers, ["x_forwarded_port", "x_forwarded_other"]]);
  const compare = (actual, expected) => {
    assert.equal(actual.status, expected.status); assert.equal(actual.text, expected.text);
    const { date: actualDate, ...actualHeaders } = actual.headers;
    const { date: expectedDate, ...expectedHeaders } = expected.headers;
    assert.deepEqual(actualHeaders, expectedHeaders);
  };
  for (const [headers, expected] of cases) {
    const options = { headers: { ...headers, Cookie: "PRIVATE_COOKIE", "X-PRIVATE-UNRELATED": "PRIVATE_UNRELATED" } };
    const before = logs.length;
    const off = await wire(ports[0], token, message, options);
    assert.equal(logs.length, before);
    assert.equal(off.status, 403); assert.deepEqual(off.json, { error: "invalid_forwarding_header" });
    compare(await wire(ports[1], token, message, options), off);
    const events = logs.slice(before).map(JSON.parse);
    assert.deepEqual(events.map(event => event.event), ["request_received", "headers_rejected", "response"]);
    const rejection = events[1];
    assert.deepEqual(rejection.forwardingHeaders, expected);
    assert.deepEqual(Object.keys(rejection).sort(), ["diagnostic", "timestamp", "sequence", "event", "stage", "classification", "forwardingHeaders"].sort());
    assert.ok(events.every(event => event.diagnostic === "memo_http_oauth" && event.stage === "headers"
      && event.sequence === events[0].sequence && !Number.isNaN(Date.parse(event.timestamp))));
    assert.equal(rejection.classification, "invalid_forwarding_header");
    assert.equal(events[2].classification, rejection.classification); assert.equal(events[2].status, 403);
    const after = logs.length;
    compare(await wire(ports[2], token, message, options), off);
    assert.equal(logs.length, after);
  }
  // Earlier checks retain their existing precedence and never claim a forwarding rejection.
  for (const [headers, status, error] of [
    [{ ...combined, Host: "PRIVATE_BAD_HOST" }, 403, "invalid_host"],
    [{ ...combined, Origin: "PRIVATE_ORIGIN" }, 403, "invalid_origin"],
    [{ ...combined, Authorization: ["Bearer PRIVATE_ONE", "Bearer PRIVATE_TWO"] }, 400, "duplicate_header"]
  ]) {
    const before = logs.length, options = { headers };
    const off = await wire(ports[0], token, message, options);
    assert.equal(logs.length, before);
    compare(await wire(ports[1], token, message, options), off);
    assert.equal(off.status, status); assert.deepEqual(off.json, { error });
    assert.ok(!logs.slice(before).map(JSON.parse).some(event => event.event === "headers_rejected"));
  }
  assert.equal(f.state.calls.length, 3, "only startup metadata fetches; rejected requests never verify tokens");
  assert.equal(connect.mock.callCount(), 0, "rejected requests never enter MCP transport");
  const text = logs.join("\n");
  for (const secret of [token, adapterToken, ...config.allowedSubjects, ...names.slice(1), ...values, "PRIVATE_", '"Authorization"', '"Bearer"', '"Cookie"'])
    assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), "no private values or raw names in diagnostics");
});

test("MCP internal exceptions and failed diagnostic writers keep fixed HTTP behavior", async t => {
  const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
  const f = await issuerFixture(), logs = [], servers = [], adapterToken = randomBytes(32).toString("base64url");
  t.after(async () => { for (const server of servers) await close(server); });
  const token = await f.sign();
  t.mock.method(Server.prototype, "connect", async () => { throw new Error("PRIVATE_EXCEPTION_SECRET_STACK"); });
  for (const diagnostics of [false, true]) {
    const server = await createAuthenticatedServer(config, { adapterToken, fetchImpl: f.fetchImpl,
      diagnostics, diagnosticWriter: line => logs.push(line) });
    servers.push(server);
    const before = logs.length, response = await wire(await listen(server), token, initialize);
    assert.equal(response.status, 500); assert.deepEqual(response.json, { error: "mcp_unavailable" });
    if (!diagnostics) assert.equal(logs.length, before);
  }
  assert.ok(logs.map(JSON.parse).some(event => event.event === "protocol_failure" && event.classification === "mcp_unavailable" && event.stage === "initialize"));
  assert.doesNotMatch(logs.join("\n"), /PRIVATE_|auth0\|/); assert.ok(!logs.join("\n").includes(token));
  t.mock.restoreAll();
  const server = await createAuthenticatedServer(config, { adapterToken, fetchImpl: f.fetchImpl,
    diagnostics: true, diagnosticWriter: () => { throw new Error("PRIVATE_WRITER_FAILURE"); } });
  servers.push(server); const port = await listen(server);
  assert.equal((await wire(port, undefined, initialize)).status, 401);
  assert.equal((await wire(port, token, initialize)).status, 200);
});
test("HTTP parser failures produce only a fixed diagnostic when enabled", async t => {
  const f = await issuerFixture(), logs = [], servers = [], responses = [];
  t.after(async () => { for (const server of servers) await close(server); });
  for (const diagnostics of [false, true]) {
    const server = await createAuthenticatedServer(config, { adapterToken: randomBytes(32).toString("base64url"),
      fetchImpl: f.fetchImpl, diagnostics, diagnosticWriter: line => logs.push(line) });
    servers.push(server); const port = await listen(server), before = logs.length;
    const response = await new Promise((resolve, reject) => {
      const socket = require("node:net").connect(port, "127.0.0.1"); let text = "";
      socket.on("connect", () => socket.end("PRIVATE_INVALID_HTTP\r\nAuthorization: PRIVATE_SECRET\r\n\r\n"));
      socket.on("data", chunk => { text += chunk; }); socket.on("end", () => resolve(text)); socket.on("error", reject);
    });
    assert.match(response, /^HTTP\/1.1 400 Bad Request/);
    responses.push(response);
    if (!diagnostics) assert.equal(logs.length, before);
  }
  assert.equal(responses[0], responses[1], "real HTTP parser response is identical for ON/OFF");
  const events = logs.map(JSON.parse), event = events[0];
  assert.equal(event.event, "http_parse_failure"); assert.equal(event.classification, "http_parse_error");
  assert.equal(Object.hasOwn(event, "status"), false);
  assert.deepEqual(events.map(event => event.event), ["http_parse_failure", "response_attempt", "response"]);
  assert.equal(events[1].attemptedStatus, 400); assert.equal(Object.hasOwn(events[1], "status"), false);
  assert.equal(events[2].status, 400);
  assert.ok(events.every(event => event.sequence === events[0].sequence));
  assert.doesNotMatch(logs.join("\n"), /PRIVATE_/);
});
test("clientError fixed codes separate parser/connection failures and attempted/completed writes", async t => {
  const f = await issuerFixture(), servers = [], logs = [];
  t.after(async () => { for (const server of servers) await close(server); });
  const codes = ["HPE_INVALID_METHOD", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ERR_STREAM_PREMATURE_CLOSE", "ERR_SOCKET_CLOSED", "PRIVATE_UNKNOWN_CODE", undefined];
  const expectedReply = "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n";
  for (const diagnostics of [false, true]) {
    const server = await createAuthenticatedServer(config, { adapterToken: randomBytes(32).toString("base64url"),
      fetchImpl: f.fetchImpl, diagnostics, diagnosticWriter: line => logs.push(line) });
    servers.push(server);
    for (const code of codes) for (const outcome of ["not_writable", "aborted", "completed"]) {
      const before = logs.length, writes = [], socket = new (require("node:events").EventEmitter)();
      socket.writable = outcome !== "not_writable";
      socket.end = (...args) => { writes.push(args); };
      const error = Object.assign(new Error("PRIVATE_EXCEPTION_TOKEN"), { code, rawPacket: Buffer.from("PRIVATE_HEADER_BODY") });
      assert.doesNotThrow(() => server.emit("clientError", error, socket));
      assert.deepEqual(writes, socket.writable ? [[expectedReply]] : [], "same existing socket.end call for ON/OFF");
      const pending = logs.slice(before).map(JSON.parse);
      assert.ok(pending.every(event => !Object.hasOwn(event, "status")), "no completed status before finish");
      if (outcome === "completed") socket.emit("finish");
      socket.emit("close");
      const events = logs.slice(before).map(JSON.parse);
      if (!diagnostics) { assert.equal(events.length, 0); continue; }
      const parser = code === "HPE_INVALID_METHOD", connection = codes.slice(1, 6).includes(code);
      assert.equal(events[0].event, parser ? "http_parse_failure" : "client_error");
      assert.equal(events[0].classification, parser ? "http_parse_error" : connection ? "connection_closed" : "transport_error");
      assert.deepEqual(events.map(event => event.event), outcome === "not_writable"
        ? [events[0].event] : [events[0].event, "response_attempt", outcome === "completed" ? "response" : "response_aborted"]);
      if (outcome === "completed") assert.equal(events[2].status, 400);
      else assert.ok(events.every(event => !Object.hasOwn(event, "status")));
      assert.ok(events.every(event => event.sequence === events[0].sequence));
    }
  }
  assert.doesNotMatch(logs.join("\n"), /PRIVATE_|ECONNRESET|HPE_INVALID_METHOD/);
  const server = await createAuthenticatedServer(config, { adapterToken: randomBytes(32).toString("base64url"),
    fetchImpl: f.fetchImpl, diagnostics: true, diagnosticWriter: () => { throw new Error("PRIVATE_WRITER"); } });
  servers.push(server);
  for (const completed of [false, true]) {
    const socket = new (require("node:events").EventEmitter)(), writes = [];
    socket.writable = true; socket.end = (...args) => writes.push(args);
    assert.doesNotThrow(() => {
      server.emit("clientError", Object.assign(new Error("PRIVATE_ERROR"), { code: "ECONNRESET" }), socket);
      if (completed) socket.emit("finish");
      socket.emit("close");
    });
    assert.deepEqual(writes, [[expectedReply]]);
  }
});
test("real connection close before authentication response records response_aborted without status", { timeout: 10000 }, async t => {
  const f = await issuerFixture(), token = await f.sign();
  for (const diagnostics of [false, true]) {
    const logs = []; let release, entered, closed, finished = false;
    const gate = new Promise(resolve => { release = resolve; });
    const verifying = new Promise(resolve => { entered = resolve; });
    const responseClosed = new Promise(resolve => { closed = resolve; });
    const server = await createAuthenticatedServer(config, { adapterToken: randomBytes(32).toString("base64url"), diagnostics,
      diagnosticWriter: line => logs.push(line), fetchImpl: async (url, options) => {
        if (String(url).endsWith("jwks.json")) { entered(); await gate; }
        return f.fetchImpl(url, options);
      } });
    server.once("request", (_req, res) => { res.once("finish", () => { finished = true; }); res.once("close", closed); });
    const port = await listen(server);
    const request = require("node:http").request({ host: "127.0.0.1", port, path: "/mcp", method: "POST", agent: false,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": 0 } });
    request.on("error", () => {});
    t.after(async () => { release(); request.destroy(); await close(server); });
    request.end();
    await verifying;
    request.destroy();
    await responseClosed;
    assert.equal(finished, false, "real ServerResponse closed before finish");
    const events = logs.map(JSON.parse);
    if (diagnostics) {
      const aborted = events.find(event => event.event === "response_aborted");
      assert.ok(aborted); assert.equal(aborted.classification, "connection_closed");
      assert.equal(Object.hasOwn(aborted, "status"), false);
      assert.ok(!events.some(event => event.event === "response" || event.event === "http_parse_failure"));
      assert.doesNotMatch(logs.join("\n"), /auth0\||PRIVATE_/); assert.ok(!logs.join("\n").includes(token));
    } else assert.equal(logs.length, 0);
    release(); await close(server);
  }
});
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
  const listed = (await send(rpc("tools/list"))).json.result.tools;
  assert.deepEqual(listed.map(tool => tool.name), ["submit_text_preview", "submit_notes_preview"]);
  for (const tool of listed) { assert.deepEqual(tool.securitySchemes, [{ type: "oauth2", scopes: ["memo:submit"] }]); assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes); }
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
