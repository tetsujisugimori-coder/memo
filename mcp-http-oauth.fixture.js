"use strict";
// Test-only signing keys and issuer/JWKS responses. Never contacts an Auth0 tenant.
const { once } = require("node:events");
const http = require("node:http");
const { randomBytes } = require("node:crypto");
const { createAuthenticatedServer } = require("./mcp-http-server.js");
const config = { mode: "authenticated", port: 8792, resource: "https://gateway.example.invalid/v1/mcp/tunnel_fixture",
  audience: "https://gateway.example.invalid/v1/mcp/tunnel_fixture",
  resource_metadata: "http://127.0.0.1:8792/.well-known/oauth-protected-resource/mcp",
  authorization_servers: ["https://issuer.example.invalid/"], scopes_supported: ["memo:submit"], allowedSubjects: ["auth0|fixture-one", "auth0|fixture-two"] };
async function issuerFixture() {
  const jose = await import("jose");
  const pair = await jose.generateKeyPair("RS256", { extractable: true });
  const other = await jose.generateKeyPair("RS256", { extractable: true });
  const jwk = { ...await jose.exportJWK(pair.publicKey), kid: "fixture-one", alg: "RS256", use: "sig" };
  const rotated = { ...await jose.exportJWK(other.publicKey), kid: "fixture-two", alg: "RS256", use: "sig" };
  const state = { keys: [jwk], calls: [], fail: false, metadata: { issuer: config.authorization_servers[0], jwks_uri: config.authorization_servers[0] + ".well-known/jwks.json" } };
  const fetchImpl = async (url, options) => {
    state.calls.push({ url: String(url), redirect: options.redirect, signal: !!options.signal });
    if (String(url) === config.authorization_servers[0] + ".well-known/openid-configuration") return Response.json(state.metadata);
    if (String(url) !== config.authorization_servers[0] + ".well-known/jwks.json") throw new Error("untrusted_fetch");
    if (state.fail) throw new Error("TEST_SECRET_FETCH_FAILURE");
    return Response.json({ keys: state.keys });
  };
  const sign = async (changes = {}, header = {}, key = pair.privateKey) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const claims = { iss: config.authorization_servers[0], aud: config.audience, sub: config.allowedSubjects[0], scope: "memo:submit", iat: timestamp, exp: timestamp + 300, ...changes };
    for (const name of Object.keys(claims)) if (claims[name] === undefined) delete claims[name];
    return new jose.SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "fixture-one", ...header }).sign(key);
  };
  return { jose, pair, other, jwk, rotated, state, fetchImpl, sign };
}
async function listen(server) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return server.address().port; }
async function close(server) { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
function wire(port, token, message, { method = "POST", target = "/mcp", headers = {}, body } = {}) {
  const data = body !== undefined ? body : message === undefined ? "" : JSON.stringify(message);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: target, method, agent: false,
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25",
        "Content-Length": Buffer.byteLength(data), ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }), ...headers } }, res => {
      let text = ""; res.on("data", chunk => { text += chunk; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text,
        json: text ? JSON.parse(text) : null }));
    }); req.on("error", reject); req.end(data);
  });
}
async function httpFixture(receiverPort, adapterToken = randomBytes(32).toString("base64url")) {
  const issuer = await issuerFixture();
  const server = await createAuthenticatedServer(config, { adapterToken, receiverPort, fetchImpl: issuer.fetchImpl });
  const port = await listen(server);
  return { ...issuer, server, port, adapterToken, token: await issuer.sign() };
}
module.exports = { config, issuerFixture, httpFixture, listen, close, wire };
