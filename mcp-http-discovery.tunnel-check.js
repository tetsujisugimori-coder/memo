"use strict";
// Optional actual-client check with loopback-only mock control plane and AS metadata.
// No login/token implementation, user keys, real tunnel, or ChatGPT connection.
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { randomBytes } = require("node:crypto");
const { createDiscoveryServer, METADATA_PATH } = require("./mcp-http-discovery.js");
async function listen(server) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return server.address().port; }
async function check() {
  const [binary, openssl] = process.argv.slice(2);
  assert.ok(binary && openssl, "Usage: node mcp-http-discovery.tunnel-check.js TUNNEL_EXE OPENSSL_EXE");
  const version = execFileSync(binary, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
  assert.match(version, /^0\.0\.16\+5f99daabd4aa4a77049e6d81d54a0d8c18335397\b/);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memo-http-tunnel-"));
  let child; const servers = []; let closed;
  try {
    const key = path.join(dir, "test.key"), cert = path.join(dir, "test.pem");
    execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "pipe", windowsHide: true });
    let issuer; let asRequests = 0;
    const auth = https.createServer({ key: await fs.readFile(key), cert: await fs.readFile(cert) }, (req, res) => {
      if (!["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"].includes(req.url)) { res.writeHead(404); res.end(); return; }
      asRequests++; res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ issuer, authorization_endpoint: issuer + "authorize", token_endpoint: issuer + "oauth/token", jwks_uri: issuer + ".well-known/jwks.json" }));
    }); servers.push(auth); issuer = `https://127.0.0.1:${await listen(auth)}/`;
    const holder = http.createServer(); const port = await listen(holder); await new Promise(resolve => holder.close(resolve));
    const resource = `http://127.0.0.1:${port}/mcp`;
    const mcp = createDiscoveryServer({ port, resource, authorization_servers: [issuer], scopes_supported: ["memo:submit"] });
    const seen = [];
    mcp.on("request", (req, res) => { res.once("finish", () => seen.push({ path: req.url, status: res.statusCode })); });
    servers.push(mcp); mcp.listen(port, "127.0.0.1"); await once(mcp, "listening");
    const commands = [
      { request_id: "offline-jsonrpc", shard_token: "test-only", command_type: "jsonrpc", channel: "main", created_at: new Date().toISOString(), headers: {}, jsonrpc: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "submit_notes_preview", arguments: { body: "PRIVATE_BODY" } } } },
      { request_id: "offline-oauth", shard_token: "test-only", command_type: "oauth_discovery", channel: "main", created_at: new Date().toISOString(), headers: {} }
    ];
    const responses = [];
    const control = http.createServer((req, res) => {
      let data = ""; req.on("data", chunk => { data += chunk; }); req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.url.split("?")[0].endsWith("/poll")) {
          setTimeout(() => res.end(JSON.stringify({ commands: commands.length ? [commands.shift()] : [] })), 100);
        } else { if (req.url.endsWith("/response")) responses.push(JSON.parse(data)); res.end("{}"); }
      });
    }); servers.push(control); const controlPort = await listen(control);
    const env = {};
    for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "Path", "PATHEXT"]) if (process.env[name]) env[name] = process.env[name];
    const apiKey = randomBytes(32).toString("base64url");
    Object.assign(env, { CONTROL_PLANE_API_KEY: apiKey, CONTROL_PLANE_TUNNEL_ID: "tunnel_" + "0".repeat(32), CONTROL_PLANE_BASE_URL: `http://127.0.0.1:${controlPort}`, LOG_HTTP_RAW_UNSAFE: "true" });
    child = spawn(binary, ["run", "--mcp.server-url", resource, "--mcp.oauth-trusted-origin", issuer.slice(0, -1), "--ca-bundle", cert, "--harpoon.allow-plaintext-http", "--health.listen-addr", "127.0.0.1:0", "--log.format", "struct-text", "--log.level", "warn", "--log.http-raw-unsafe=false"], { env, windowsHide: true });
    closed = once(child, "close"); let output = "";
    child.stdout.on("data", value => { output += value; }); child.stderr.on("data", value => { output += value; });
    for (let i = 0; i < 200 && !responses.some(value => value.request_id === "offline-oauth"); i++) {
      if (child.exitCode !== null) throw new Error(output);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const oauth = responses.find(value => value.request_id === "offline-oauth");
    assert.ok(oauth, output); assert.equal(oauth.resp_code, 200, JSON.stringify(oauth));
    const payload = typeof oauth.resp_json === "string" ? JSON.parse(oauth.resp_json) : oauth.resp_json;
    assert.equal(payload.resource, resource, JSON.stringify(payload));
    assert.ok(seen.some(value => value.path === "/mcp" && value.status === 401));
    assert.ok(seen.some(value => value.path === METADATA_PATH && value.status === 200));
    // This Windows build rejects the self-signed mock AS even with --ca-bundle.
    // PRM can still return 200; never treat that alone as AS discovery success.
    assert.ok(asRequests > 0 || output.includes("certificate signed by unknown authority"));
    assert.ok(!output.includes(apiKey)); assert.doesNotMatch(output, /PRIVATE_BODY/);
    console.log(JSON.stringify({ version, context: "actual client + loopback mock control plane; NOT ChatGPT", localResource: resource, clientResponseResource: payload.resource, resourceChangedByClient: false, mcp401: true, pathMetadata200: true, mockAsMetadata: asRequests > 0 ? "retrieved" : "TLS rejected; AS discovery NOT successful", realTunnel: "unverified", chatgptResource: "unverified" }, null, 2));
  } finally {
    if (child && child.exitCode === null) { child.kill(); await closed; }
    for (const server of servers.reverse()) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(dir, { recursive: true, force: true });
  }
}
check().catch(error => { console.error(error); process.exitCode = 1; });
