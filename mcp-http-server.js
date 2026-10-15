"use strict";
const http = require("node:http");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { WebStandardStreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
const { ListToolsRequestSchema, CallToolRequestSchema, McpError } = require("@modelcontextprotocol/sdk/types.js");
const { createMcpHandler, submitText, submitNotes } = require("./dummy-preview-mcp.js");
const { MAX_NOTES_INPUT_BYTES } = require("./dummy-preview-queue.js");
const { validateConfig, loadConfig, createTokenVerifier, receiverRequestId, requireAdapterToken } = require("./mcp-http-auth.js");
const { MCP_PATH, METADATA_PATH } = require("./mcp-http-discovery.js");
const MAX_HTTP_BYTES = MAX_NOTES_INPUT_BYTES + 8192;
const DIAGNOSTIC_ERRORS = new Set(["duplicate_header", "invalid_host", "invalid_origin", "invalid_forwarding_header",
  "rate_limit", "method_not_allowed", "not_found", "invalid_token", "subject_forbidden", "insufficient_scope",
  "sessions_not_supported", "input_too_large_or_encoded", "json_required", "input_too_large", "mcp_unavailable"]);
function diagnosticError(value) {
  if (typeof value === "string" && DIAGNOSTIC_ERRORS.has(value)) return value;
  return new Map([[-32700, "parse_error"], [-32600, "invalid_request"], [-32601, "method_not_found"],
    [-32602, "invalid_params"], [-32603, "internal_error"]]).get(value?.code) || "protocol_error";
}
async function createProtocolServer(principal, adapterToken, receiverPort, diagnostic) {
  const forward = submit => async input => {
    const record = await submit({ ...input, requestId: receiverRequestId(principal, input.requestId) }, adapterToken, receiverPort);
    return { ...record, requestId: input.requestId };
  };
  const handler = createMcpHandler({ submitArbitrary: forward(submitText), submitMultiple: forward(submitNotes) });
  // Reuse only the existing tool schemas, validators and result contracts.
  // HTTP lifecycle and JSON-RPC transport belong to the official SDK.
  await handler({ jsonrpc: "2.0", method: "notifications/initialized" });
  const tools = (await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools
    .filter(tool => ["submit_text_preview", "submit_notes_preview"].includes(tool.name))
    .map(tool => ({ ...tool, securitySchemes: [{ type: "oauth2", scopes: ["memo:submit"] }],
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["memo:submit"] }] } }));
  diagnostic("tools_prepared", { toolCount: tools.length,
    expectedTools: ["submit_text_preview", "submit_notes_preview"].every(name => tools.some(tool => tool.name === name)) });
  const server = new Server({ name: "memo-unsaved-oauth-preview", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (!tools.some(tool => tool.name === request.params.name)) throw new McpError(-32602, "Unknown tool");
    const reply = await handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: request.params });
    if (reply.error) throw new McpError(reply.error.code, reply.error.message);
    return reply.result;
  });
  return server;
}
async function readMessage(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_HTTP_BYTES) throw Object.assign(new Error("input_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw Object.assign(new Error("invalid_json"), { status: 400 }); }
}
async function createAuthenticatedServer(input, { adapterToken, receiverPort = 8791, fetchImpl, now = Date.now,
  diagnostics = false, diagnosticWriter = line => console.log(line) } = {}) {
  const config = validateConfig(input);
  requireAdapterToken(adapterToken);
  if (!Number.isInteger(receiverPort) || receiverPort < 1 || receiverPort > 65535) throw new Error("invalid_receiver_port");
  const verify = await createTokenVerifier(config, { fetchImpl, now });
  const metadata = { resource: config.resource, authorization_servers: config.authorization_servers, scopes_supported: config.scopes_supported };
  const challenge = `Bearer resource_metadata="${config.resource_metadata}", scope="memo:submit"`;
  let windowStart = now(), count = 0, inflight = 0;
  let diagnosticSequence = 0;
  const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    const sequence = diagnostics === true ? ++diagnosticSequence : 0;
    let stage = "headers", classification = "none";
    // Call sites supply only fixed labels, booleans and counts. Never pass request,
    // principal, exception, token or body objects to this writer.
    const diagnostic = (event, fields = {}) => {
      if (diagnostics !== true) return;
      try { diagnosticWriter(JSON.stringify({ diagnostic: "memo_http_oauth", timestamp: new Date().toISOString(), sequence, event, stage, ...fields })); }
      catch { /* Observability must not change HTTP/authentication behavior. */ }
    };
    diagnostic("request_received", { path: req.url === MCP_PATH ? "mcp"
      : [METADATA_PATH, "/.well-known/oauth-protected-resource"].includes(req.url) ? "metadata" : "other",
      method: ["GET", "POST", "DELETE"].includes(req.method) ? req.method : "other",
      bearerPresent: typeof req.headers.authorization === "string" && /^Bearer\s/i.test(req.headers.authorization) });
    let completed = false;
    res.once("finish", () => { completed = true; diagnostic("response", { status: res.statusCode, classification }); });
    res.once("close", () => { if (!completed) diagnostic("response_aborted", { classification: "connection_closed" }); });
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Connection", "close");
    const send = (status, value, headers = {}) => {
      if (res.headersSent || res.destroyed) return;
      classification = status >= 400 ? diagnosticError(value.error) : "none";
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers }); res.end(JSON.stringify(value));
    };
    const expectedHost = `127.0.0.1:${server.address().port}`;
    const sensitive = new Set(["host", "origin", "authorization", "content-type", "content-length", "mcp-session-id", "mcp-protocol-version"]);
    const seen = new Set();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i].toLowerCase();
      if (sensitive.has(name) && seen.has(name)) return send(400, { error: "duplicate_header" });
      seen.add(name);
    }
    if (!seen.has("host") || req.headers.host !== expectedHost) return send(403, { error: "invalid_host" });
    if (req.headers.origin !== undefined && req.headers.origin !== `http://${expectedHost}`) return send(403, { error: "invalid_origin" });
    if (Object.hasOwn(req.headers, "forwarded") || Object.keys(req.headers).some(key => key.startsWith("x-forwarded-") && key !== "x-forwarded-client-cert") || Object.hasOwn(req.headers, "x-http-method-override")) {
      if (diagnostics === true) {
        // Node normalizes names to lowercase. Emit only these fixed labels,
        // in this order, regardless of request order; never emit names or values.
        const forwardingHeaders = [
          ["forwarded", Object.hasOwn(req.headers, "forwarded")],
          ["x_forwarded_for", Object.hasOwn(req.headers, "x-forwarded-for")],
          ["x_forwarded_host", Object.hasOwn(req.headers, "x-forwarded-host")],
          ["x_forwarded_proto", Object.hasOwn(req.headers, "x-forwarded-proto")],
          ["x_forwarded_port", Object.hasOwn(req.headers, "x-forwarded-port")],
          ["x_forwarded_server", Object.hasOwn(req.headers, "x-forwarded-server")],
          ["x_forwarded_prefix", Object.hasOwn(req.headers, "x-forwarded-prefix")],
          ["x_forwarded_uri", Object.hasOwn(req.headers, "x-forwarded-uri")],
          ["x_forwarded_method", Object.hasOwn(req.headers, "x-forwarded-method")],
          ["x_forwarded_other", Object.keys(req.headers).some(key => key.startsWith("x-forwarded-")
            && !["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
              "x-forwarded-client-cert", "x-forwarded-server", "x-forwarded-prefix", "x-forwarded-uri", "x-forwarded-method"].includes(key))],
          ["method_override", Object.hasOwn(req.headers, "x-http-method-override")]
        ].filter(([, present]) => present).map(([label]) => label);
        diagnostic("headers_rejected", { classification: "invalid_forwarding_header", forwardingDiagnosticVersion: 3, forwardingHeaders });
      }
      return send(403, { error: "invalid_forwarding_header" });
    }
    diagnostic("headers_accepted"); stage = "routing";
    if (now() - windowStart >= 60000) { windowStart = now(); count = 0; }
    if (++count > 120 || inflight >= 4) return send(429, { error: "rate_limit" });
    if (req.url === METADATA_PATH || req.url === "/.well-known/oauth-protected-resource") {
      if (req.method !== "GET") return send(405, { error: "method_not_allowed" }, { Allow: "GET" });
      return send(200, metadata);
    }
    if (req.url !== MCP_PATH) return send(404, { error: "not_found" });
    if (!["POST", "GET", "DELETE"].includes(req.method)) return send(405, { error: "method_not_allowed" }, { Allow: "POST" });
    diagnostic("route_accepted"); stage = "authentication";
    inflight++;
    let protocol;
    try {
      let principal;
      try { principal = await verify(req.headers.authorization); diagnostic("authentication", { status: "accepted" }); }
      catch (error) {
        const forbidden = error.status === 403;
        diagnostic("authentication", { status: "rejected", httpStatus: forbidden ? 403 : 401,
          classification: forbidden ? diagnosticError(error.code) : "invalid_token" });
        return send(forbidden ? 403 : 401, { error: forbidden ? error.code : "invalid_token" }, {
          "WWW-Authenticate": challenge + (forbidden ? (error.code === "insufficient_scope" ? ', error="insufficient_scope"' : "") : (req.headers.authorization ? ', error="invalid_token"' : ""))
        });
      }
      stage = "body";
      // No sessions or standalone SSE. Every HTTP request has just been verified.
      if (req.method !== "POST") return send(405, { error: "method_not_allowed" }, { Allow: "POST" });
      if (req.headers["mcp-session-id"] !== undefined || req.headers["last-event-id"] !== undefined) return send(400, { error: "sessions_not_supported" });
      if (req.headers["content-encoding"] !== undefined || req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"] || 0) > MAX_HTTP_BYTES) return send(413, { error: "input_too_large_or_encoded" });
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] || "")) return send(415, { error: "json_required" });
      let message;
      try { message = await readMessage(req); }
      catch (error) { return error.status === 413 ? send(413, { error: "input_too_large" })
        : send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
      if (Array.isArray(message)) return send(400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch not supported" } });
      stage = message?.method === "initialize" ? "initialize" : message?.method === "tools/list" ? "tools_list" : "mcp_other";
      diagnostic("protocol_request");
      protocol = await createProtocolServer(principal, adapterToken, receiverPort, diagnostic);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await protocol.connect(transport);
      // Use the SDK's standard Web transport directly. No SSE or Node-adapter
      // framing optimizations are needed for bounded JSON responses.
      const headers = new Headers();
      // Ignore the exact normalized Client-Cert name; never inspect its value or pass it to the SDK.
      for (const key of Object.keys(req.headers)) {
        if (key === "authorization" || key === "x-forwarded-client-cert") continue;
        const value = req.headers[key];
        if (value !== undefined) headers.set(key, String(value));
      }
      const response = await transport.handleRequest(new Request(`http://${expectedHost}${MCP_PATH}`, { method: "POST", headers, body: JSON.stringify(message) }), { parsedBody: message });
      const body = Buffer.from(await response.arrayBuffer());
      if (diagnostics === true) {
        let reply; try { reply = JSON.parse(body.toString("utf8")); } catch { /* No raw response logging. */ }
        classification = reply?.error ? diagnosticError(reply.error)
          : response.status >= 400 ? "http_rejected" : response.status === 200 && !reply?.result ? "protocol_error" : "none";
        const fields = { status: response.status, classification, success: response.status === 200 && !!reply?.result && !reply?.error };
        if (stage === "tools_list" && Array.isArray(reply?.result?.tools)) {
          fields.toolCount = reply.result.tools.length;
          fields.expectedTools = ["submit_text_preview", "submit_notes_preview"].every(name => reply.result.tools.some(tool => tool.name === name));
        }
        diagnostic("protocol_result", fields);
      }
      res.writeHead(response.status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(body);
    } catch { diagnostic("protocol_failure", { classification: "mcp_unavailable", status: 500 }); send(500, { error: "mcp_unavailable" }); }
    finally { inflight--; if (protocol) await protocol.close().catch(() => {}); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.timeout = 10000;
  server.maxConnections = 8; server.maxRequestsPerSocket = 1;
  server.on("clientError", (error, socket) => {
    if (diagnostics === true) {
      const sequence = ++diagnosticSequence;
      const parseFailure = typeof error.code === "string" && /^HPE_[A-Z_]+$/.test(error.code);
      const classification = parseFailure ? "http_parse_error"
        : ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ERR_STREAM_PREMATURE_CLOSE", "ERR_SOCKET_CLOSED"].includes(error.code)
          ? "connection_closed" : "transport_error";
      const diagnostic = (event, fields = {}) => {
        try { diagnosticWriter(JSON.stringify({ diagnostic: "memo_http_oauth", timestamp: new Date().toISOString(),
          sequence, event, stage: "headers", classification, ...fields })); } catch {}
      };
      diagnostic(parseFailure ? "http_parse_failure" : "client_error");
      if (socket.writable) {
        let completed = false;
        socket.once("finish", () => { completed = true; diagnostic("response", { status: 400 }); });
        socket.once("close", () => { if (!completed) diagnostic("response_aborted", { classification: "connection_closed" }); });
        diagnostic("response_attempt", { attemptedStatus: 400 });
      }
    }
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return server;
}
async function run(file) {
  try {
    const config = loadConfig(file);
    const server = await createAuthenticatedServer(config, { adapterToken: process.env.MEMO_PREVIEW_ADAPTER_TOKEN,
      diagnostics: process.env.MEMO_MCP_HTTP_DIAGNOSTICS === "1" });
    server.once("error", () => { console.error("Authenticated HTTP listener failed"); process.exitCode = 1; });
    server.listen(config.port, "127.0.0.1", () => console.log(`Authenticated HTTP MCP on 127.0.0.1:${config.port}; receive only, manual browser save required`));
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { server.close(); server.closeAllConnections(); });
  } catch { console.error("Authenticated HTTP startup refused: check explicit configuration, adapter token and issuer metadata"); process.exitCode = 1; }
}
if (require.main === module) {
  if (process.argv.length !== 3) { console.error("Usage: node mcp-http-server.js CONFIG_FILE"); process.exitCode = 1; }
  else void run(process.argv[2]);
}
module.exports = { createAuthenticatedServer, MAX_HTTP_BYTES };
