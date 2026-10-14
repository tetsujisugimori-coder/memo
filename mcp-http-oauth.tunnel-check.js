"use strict";
// Optional actual fixed-build client; mock loopback control plane only.
// No real runtime keys, Auth0 tenant, ChatGPT registration or user receiver.
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { randomBytes, randomUUID } = require("node:crypto");
const { createPreviewService } = require("./dummy-preview-service.js");
const { httpFixture, listen, close, config } = require("./mcp-http-oauth.fixture.js");
(async () => {
  const binary = process.argv[2]; assert.ok(binary, "Usage: node mcp-http-oauth.tunnel-check.js TUNNEL_EXE");
  const version = execFileSync(binary, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
  assert.match(version, /^0\.0\.16\+5f99daabd4aa4a77049e6d81d54a0d8c18335397\b/);
  const adapterToken = randomBytes(32).toString("base64url"), browserToken = randomBytes(32).toString("base64url");
  const receiver = createPreviewService({ adapterToken, browserToken }); let gateway, control, child, closed;
  try {
    gateway = await httpFixture(await listen(receiver.server), adapterToken);
    const seen = []; gateway.server.on("request", (req, res) => res.once("finish", () => seen.push({ method: req.method, path: req.url, status: res.statusCode,
      localHost: req.headers.host === `127.0.0.1:${gateway.port}`, forwarded: Object.keys(req.headers).some(key => key.startsWith("x-forwarded-") || key === "forwarded"),
      authenticated: req.headers.authorization === `Bearer ${gateway.token}` })));
    const base = { shard_token: "test-only", command_type: "jsonrpc", channel: "main", created_at: new Date().toISOString() };
    const command = (id, method, params, authenticated = true) => ({ ...base, request_id: id,
      headers: authenticated ? { Authorization: [`Bearer ${gateway.token}`], "Mcp-Protocol-Version": ["2025-11-25"] } : {},
      jsonrpc: { jsonrpc: "2.0", id, method, params } });
    const text = { requestId: randomUUID(), title: "fixture", body: "PRIVATE_BODY_TEXT" };
    const notes = { requestId: randomUUID(), notes: [{ title: "fixture one", body: "PRIVATE_BODY_NOTES" }, { title: "fixture two", body: "two" }] };
    const commands = [command("initialize", "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "offline", version: "1" } }),
      command("tools", "tools/list", {}), command("text", "tools/call", { name: "submit_text_preview", arguments: text }),
      command("notes", "tools/call", { name: "submit_notes_preview", arguments: notes }),
      command("unauthenticated", "tools/call", { name: "submit_text_preview", arguments: { ...text, requestId: randomUUID() } }, false),
      { ...base, request_id: "discovery", command_type: "oauth_discovery", headers: {} }];
    const responses = [];
    control = http.createServer((req, res) => {
      let data = ""; req.on("data", chunk => { data += chunk; }); req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.url.split("?")[0].endsWith("/poll")) setTimeout(() => res.end(JSON.stringify({ commands: commands.length ? [commands.shift()] : [] })), 100);
        else {
          if (req.url.endsWith("/response")) {
            const value = JSON.parse(data); responses.push(value);
            if (value.request_id === "text" && receiver.queue.peek()) receiver.queue.reject(receiver.queue.peek().requestId);
          }
          res.end("{}");
        }
      });
    }); const controlPort = await listen(control);
    const env = {}; for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "Path", "PATHEXT"]) if (process.env[name]) env[name] = process.env[name];
    const key = randomBytes(32).toString("base64url");
    Object.assign(env, { CONTROL_PLANE_API_KEY: key, CONTROL_PLANE_TUNNEL_ID: "tunnel_" + "0".repeat(32), CONTROL_PLANE_BASE_URL: `http://127.0.0.1:${controlPort}` });
    child = spawn(binary, ["run", "--mcp.server-url", `http://127.0.0.1:${gateway.port}/mcp`, "--mcp.oauth-trusted-origin", "https://issuer.example.invalid",
      "--harpoon.allow-plaintext-http", "--health.listen-addr", "127.0.0.1:0", "--mcp.max-concurrent-requests", "1", "--log.format", "struct-text", "--log.level", "warn", "--log.http-raw-unsafe=false"], { env, windowsHide: true });
    closed = once(child, "close"); let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !responses.some(value => value.request_id === "discovery")) {
      if (child.exitCode !== null) throw new Error("Offline tunnel exited"); await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (const id of ["initialize", "tools", "text", "notes"]) {
      const response = responses.find(value => value.request_id === id); assert.ok(response, `missing ${id}`);
      assert.equal(response.resp_code, 200, `${id}: ${JSON.stringify(response)}`);
      const rpc = typeof response.resp_json === "string" ? JSON.parse(response.resp_json) : response.resp_json;
      assert.equal(rpc.error, undefined);
      if (["text", "notes"].includes(id)) { assert.equal(rpc.result.isError, false); assert.equal(JSON.parse(rpc.result.content[0].text).saved, false); }
    }
    assert.ok(seen.some(value => value.status === 401 && !value.authenticated));
    assert.ok(seen.filter(value => value.authenticated).every(value => value.localHost && !value.forwarded));
    const discovery = responses.find(value => value.request_id === "discovery"); assert.ok(discovery);
    const metadata = typeof discovery.resp_json === "string" ? JSON.parse(discovery.resp_json) : discovery.resp_json;
    assert.equal(metadata.resource, config.resource);
    assert.equal(receiver.queue.peek().notes.length, 2);
    for (const forbidden of [key, gateway.token, adapterToken, browserToken, "PRIVATE_BODY"]) assert.ok(!output.includes(forbidden), "unsafe tunnel log");
    console.log("Fixed tunnel-client + isolated mock control plane: Bearer forwarding, local Host, strict header checks, initialize/list/text/notes, unauthenticated 401, exact public PRM resource, safe warn logs passed; real ChatGPT/Auth0 unverified");
  } finally {
    if (child && child.exitCode === null) { child.kill(); await closed; }
    if (control) await close(control); if (gateway) await close(gateway.server); await close(receiver.server);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
