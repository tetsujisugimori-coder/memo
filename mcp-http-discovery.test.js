"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { once } = require("node:events");
const { validateConfig, loadConfig, createDiscoveryServer, METADATA_PATH } = require("./mcp-http-discovery.js");
const config = { port: 8792, resource: "http://127.0.0.1:8792/mcp", authorization_servers: ["https://tenant.example/"], scopes_supported: ["memo:submit"] };
const nativeRequest = http.request;
function wire(port, target = "/mcp", method = "POST", headers = {}, body = "") {
  return new Promise((resolve, reject) => {
    const req = nativeRequest({ host: "127.0.0.1", port, path: target, method, headers,
      agent: false }, res => {
      let text = ""; res.setEncoding("utf8"); res.on("data", value => { text += value; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject); req.end(body);
  });
}
async function start(t) {
  const server = createDiscoveryServer(config);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return server.address().port;
}
test("explicit configuration fails closed; local and HTTPS resource retain complete value", () => {
  assert.equal(validateConfig(config).resource, config.resource);
  assert.equal(validateConfig({ ...config, resource: "https://resource.example/mcp" }).metadataUrl, "https://resource.example/.well-known/oauth-protected-resource/mcp");
  for (const bad of [null, {}, { ...config, port: 8791 }, { ...config, port: 0 }, { ...config, port: "8792" },
    { ...config, extra: true }, ...["", "not-url", "http://evil.example/mcp", "http://localhost:8792/mcp", "http://127.0.0.1:8793/mcp", "https://u:p@host/mcp", "https://host/mcp?q=x", "https://host/mcp#x", "https://host/mcp/", "https://host/a/../mcp", "https://host/mcp\r\nX: secret", "https://host/other"].map(resource => ({ ...config, resource })),
    ...[[], ["http://tenant.example/"], ["https://tenant.example/path"], ["https://tenant.example/?x=1"], ["https://tenant.example/#x"], ["https://tenant.example/", "https://other.example/"]].map(authorization_servers => ({ ...config, authorization_servers })),
    ...[[], ["memo:submit", "memo:submit"], ["x y"], ['x"y'], ["x\\y"], [null]].map(scopes_supported => ({ ...config, scopes_supported }))]) {
    assert.throws(() => validateConfig(bad), /^Error: Invalid discovery configuration$/);
  }
  assert.throws(() => loadConfig("nonexistent-config"), /Unable to load valid/);
});
test("path-specific and root well-known; 401 challenge leads to the exact configured metadata", async t => {
  const port = await start(t);
  for (const target of [METADATA_PATH, "/.well-known/oauth-protected-resource"]) {
    const res = await wire(port, target, "GET");
    assert.equal(res.status, 200); assert.equal(res.headers["cache-control"], "no-store");
    assert.deepEqual(JSON.parse(res.text), { resource: config.resource, authorization_servers: config.authorization_servers, scopes_supported: config.scopes_supported });
  }
  for (const method of ["GET", "POST", "DELETE"]) {
    const res = await wire(port, "/mcp", method);
    assert.equal(res.status, 401);
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(res.headers["www-authenticate"])[1];
    assert.equal(metadataUrl, config.resource.replace("/mcp", METADATA_PATH));
    assert.match(res.headers["www-authenticate"], /scope="memo:submit"/);
    // Ephemeral test listener differs from the explicit production authority.
    assert.equal((await wire(port, new URL(metadataUrl).pathname, "GET")).status, 200);
  }
});
test("reject Host, Origin, forwarding headers, ambiguous paths and unknown methods", async t => {
  const port = await start(t);
  const duplicate = await new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(`GET ${METADATA_PATH} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nHost: evil.example\r\nConnection: close\r\n\r\n`));
    let result = ""; socket.on("data", chunk => { result += chunk; }); socket.on("end", () => resolve(result)); socket.on("error", reject);
  });
  assert.match(duplicate, /^HTTP\/1.1 (400|403) /);
  for (const headers of [{ Host: "evil.example" }, { Host: `localhost:${port}` }, { Origin: "null" }, { Origin: "https://evil.example" },
    { Forwarded: "host=evil.example" }, { "X-Forwarded-Host": "evil.example" }, { "X-Forwarded-Proto": "https" }, { "X-Http-Method-Override": "GET" }]) {
    const res = await wire(port, METADATA_PATH, "GET", headers); assert.equal(res.status, 403); assert.equal(res.headers["www-authenticate"], undefined);
  }
  for (const target of ["/", "/submit", "/notes", "/status", "/save", "/mcp/", "/mcp?x=1", "/%6dcp", "/.well-known/oauth-protected-resource/other", "http://evil.example/mcp"]) assert.equal((await wire(port, target)).status, 404);
  for (const method of ["PUT", "PATCH", "OPTIONS", "HEAD"]) assert.equal((await wire(port, "/mcp", method)).status, 405);
  for (const method of ["POST", "DELETE", "HEAD"]) assert.equal((await wire(port, METADATA_PATH, method)).status, 405);
  assert.equal((await wire(port, "/mcp", "POST", { "Content-Type": "application/json" }, "malformed-json")).status, 401);
});
test("all operations denied for absent, plausible and malformed Bearer; outbound calls and queue admissions zero", async t => {
  const { createQueue } = require("./dummy-preview-queue.js");
  const { createPreviewService } = require("./dummy-preview-service.js");
  const queue = createQueue(); let admissions = 0; let outbound = 0; let receiverRequests = 0;
  const receiver = createPreviewService({ browserToken: "a".repeat(43), adapterToken: "b".repeat(43), queue: { ...queue, submit(...args) { admissions++; return queue.submit(...args); } } });
  receiver.server.on("request", () => { receiverRequests++; });
  receiver.server.listen(0, "127.0.0.1"); await once(receiver.server, "listening");
  t.after(() => new Promise(resolve => receiver.server.close(resolve)));
  const port = await start(t);
  // Instrument all outbound APIs; wire() above uses the saved original client.
  for (const [object, key] of [[http, "request"], [http, "get"], [https, "request"], [https, "get"], [globalThis, "fetch"]]) {
    t.mock.method(object, key, () => { outbound++; throw new Error("Unexpected outbound request"); });
  }
  for (const authorization of [undefined, "Bearer fixed-test-token", "Bearer eyJhbGciOiJub25lIn0.eyJhdWQiOiJtZW1vIn0.", "Bearer !!!", "Basic secret"])
    for (const method of ["initialize", "notifications/initialized", "ping", "tools/list", "tools/call", "submit_notes_preview", "status", "save", "update", "delete", "resources/read"]) {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { name: "submit_notes_preview", arguments: { title: "PRIVATE_TITLE", body: "PRIVATE_BODY" } } });
      const res = await wire(port, "/mcp", "POST", { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(authorization ? { Authorization: authorization } : {}) }, body);
      assert.equal(res.status, 401); assert.doesNotMatch(res.text, /PRIVATE_|fixed-test-token|eyJhbGci/);
    }
  assert.equal(outbound, 0); assert.equal(receiverRequests, 0); assert.equal(admissions, 0); assert.equal(queue.peek(), null);
});
test("real process emits only fixed diagnostics, refuses missing config and occupied port", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memo-discovery-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const port = await start(t);
  const file = path.join(dir, "config.json");
  await fs.writeFile(file, JSON.stringify({ ...config, port, resource: `http://127.0.0.1:${port}/mcp` }));
  async function invoke(arg) {
    const child = spawn(process.execPath, [path.join(__dirname, "mcp-http-discovery.js"), arg], { windowsHide: true });
    let output = ""; child.stdout.on("data", x => { output += x; }); child.stderr.on("data", x => { output += x; });
    const [code] = await once(child, "close"); assert.equal(code, 1); return output;
  }
  assert.match(await invoke(file), /Discovery listener failed/);
  await fs.writeFile(file, '{"resource":"SECRET_IN_INVALID_CONFIG"}');
  const bad = await invoke(file); assert.match(bad, /startup refused/); assert.doesNotMatch(bad, /SECRET_IN_INVALID_CONFIG/);
  assert.match(await invoke(path.join(dir, "missing")), /startup refused/);
});
