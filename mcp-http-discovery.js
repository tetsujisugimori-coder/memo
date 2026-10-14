"use strict";
// PR-4 preparation only: authentication discovery, never an authenticated MCP backend.
// Intentionally imports no receiver, queue, persistence, or stdio MCP code.
const http = require("node:http");
const fs = require("node:fs");
const DEFAULT_PORT = 8792;
const MCP_PATH = "/mcp";
const METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";
function validateConfig(input) {
  const fail = () => { throw new Error("Invalid discovery configuration"); };
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["port", "resource", "authorization_servers", "scopes_supported"].includes(key))) fail();
  const port = input.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [5500, 8787, 8791].includes(port)) fail();
  function url(value, issuer = false) {
    if (typeof value !== "string" || !/^[\x21-\x7e]+$/.test(value) || /["\\<>]/.test(value)) fail();
    let parsed; try { parsed = new URL(value); } catch { fail(); }
    if (parsed.href !== value || parsed.username || parsed.password || parsed.search || parsed.hash) fail();
    if (issuer) {
      if (parsed.protocol !== "https:" || parsed.pathname !== "/") fail();
    } else if (parsed.pathname !== MCP_PATH || !(parsed.protocol === "https:"
      || (parsed.protocol === "http:" && parsed.host === `127.0.0.1:${port}`))) fail();
    return parsed;
  }
  const resource = url(input.resource);
  if (!Array.isArray(input.authorization_servers) || input.authorization_servers.length !== 1) fail();
  input.authorization_servers.forEach(value => url(value, true));
  const scopes = input.scopes_supported;
  if (!Array.isArray(scopes) || !scopes.length || scopes.length > 16
    || scopes.some(value => typeof value !== "string" || !/^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/.test(value))
    || new Set(scopes).size !== scopes.length) fail();
  return Object.freeze({ port, resource: resource.href,
    authorization_servers: Object.freeze([...input.authorization_servers]), scopes_supported: Object.freeze([...scopes]),
    metadataUrl: resource.origin + METADATA_PATH });
}
function loadConfig(file) {
  try { return validateConfig(JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""))); }
  catch { throw new Error("Unable to load valid discovery configuration"); }
}
function createDiscoveryServer(input) {
  const config = validateConfig(input);
  const metadata = { resource: config.resource, authorization_servers: config.authorization_servers, scopes_supported: config.scopes_supported };
  const challenge = `Bearer resource_metadata="${config.metadataUrl}", scope="${config.scopes_supported.join(" ")}"`;
  const server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Close rather than retaining arbitrary bodies. No body parsing or request logging.
    res.setHeader("Connection", "close");
    const send = (status, value, headers = {}) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
      res.end(JSON.stringify(value));
    };
    const expectedHost = `127.0.0.1:${server.address().port}`;
    const hosts = req.rawHeaders.filter((_, index) => index % 2 === 0).filter(key => key.toLowerCase() === "host");
    if (hosts.length !== 1 || req.headers.host !== expectedHost) return send(403, { error: "invalid_host" });
    if (req.headers.origin !== undefined && req.headers.origin !== `http://${expectedHost}`) return send(403, { error: "invalid_origin" });
    // Forwarding headers never participate in URLs or trust decisions.
    if (req.headers.forwarded || Object.keys(req.headers).some(key => key.startsWith("x-forwarded-"))
      || req.headers["x-http-method-override"]) return send(403, { error: "invalid_forwarding_header" });
    if (req.url === METADATA_PATH || req.url === "/.well-known/oauth-protected-resource") {
      if (req.method !== "GET") return send(405, { error: "method_not_allowed" }, { Allow: "GET" });
      return send(200, metadata);
    }
    if (req.url !== MCP_PATH) return send(404, { error: "not_found" });
    if (!["POST", "GET", "DELETE"].includes(req.method)) return send(405, { error: "method_not_allowed" }, { Allow: "GET, POST, DELETE" });
    // Authentication gate BEFORE Streamable HTTP initialization or business dispatch.
    // Every token remains unverified; do not suggest that a token was validated.
    return send(401, { error: "oauth_not_enabled", message: "Discovery only; all MCP operations disabled" }, { "WWW-Authenticate": challenge });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxRequestsPerSocket = 1;
  server.on("clientError", (_error, socket) => { if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); });
  return server;
}
function run(file) {
  let server;
  try {
    const config = loadConfig(file);
    server = createDiscoveryServer({ port: config.port, resource: config.resource,
      authorization_servers: config.authorization_servers, scopes_supported: config.scopes_supported });
    server.once("error", () => { console.error("Discovery listener failed; check configuration and port availability"); process.exitCode = 1; });
    server.listen(config.port, "127.0.0.1", () => console.log(`OAuth discovery only on 127.0.0.1:${config.port}; MCP operations disabled`));
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { server.close(); server.closeAllConnections(); });
  } catch { console.error("Discovery startup refused: valid explicit configuration required"); process.exitCode = 1; }
  return server;
}
if (require.main === module) {
  if (process.argv.length !== 3) { console.error("Usage: node mcp-http-discovery.js CONFIG_FILE"); process.exitCode = 1; }
  else run(process.argv[2]);
}
module.exports = { DEFAULT_PORT, MCP_PATH, METADATA_PATH, validateConfig, loadConfig, createDiscoveryServer };
