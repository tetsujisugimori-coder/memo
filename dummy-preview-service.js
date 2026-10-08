"use strict";
const http = require("node:http");
const { createHash, timingSafeEqual } = require("node:crypto");
const { TextDecoder } = require("node:util");
const { createQueue, dummyRequest, exactKeys, fault } = require("./dummy-preview-queue.js");
const PORT = 8791;
const ORIGINS = new Set(["http://127.0.0.1:5500", "https://tetsujisugimori-coder.github.io"]);
const MAX_INPUT_BYTES = 1024;
function validateToken(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(value)) throw new Error("Dedicated random preview token required (43–128 base64url characters)");
  return value;
}
function authorize(header, token) {
  if (typeof header !== "string" || !/^Bearer [A-Za-z0-9_-]{43,128}$/.test(header)) return false;
  const hash = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(header.slice(7)), hash(token));
}
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw fault("input_too_large", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw fault("invalid_json"); }
}
function createPreviewService({ browserToken, adapterToken, queue = createQueue(), now = Date.now } = {}) {
  validateToken(browserToken); validateToken(adapterToken);
  if (browserToken === adapterToken) throw new Error("Preview tokens must differ");
  let windowStart = now(); let requests = 0; let inflight = 0;
  const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    function send(code, value) { res.statusCode = code; res.end(JSON.stringify(value)); }
    if (now() - windowStart >= 60000) { windowStart = now(); requests = 0; }
    if (++requests > 120 || inflight >= 4) return send(429, { error: "rate_limit" });
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (req.headers.host !== expectedHost || req.headers["forwarded"] || req.headers["x-forwarded-host"]
      || req.headers["x-forwarded-for"] || req.headers["x-http-method-override"]) return send(403, { error: "invalid_host_or_header" });
    if (origin !== undefined && !ORIGINS.has(origin)) return send(403, { error: "invalid_origin" });
    const allowedHeaders = new Set(["host", "connection", "pragma", "cache-control", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "authorization", "content-type", "content-length", "origin", "accept", "accept-encoding", "accept-language", "user-agent", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-storage-access", "priority", "access-control-request-method", "access-control-request-headers", "access-control-request-private-network"]);
    if (Object.keys(req.headers).some((name) => !allowedHeaders.has(name))) return send(400, { error: "invalid_header" });
    const sensitive = new Set(["host", "origin", "authorization", "content-type", "content-length"]);
    const counts = new Map();
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      const name = req.rawHeaders[index].toLowerCase(); counts.set(name, (counts.get(name) || 0) + 1);
      if (sensitive.has(name) && counts.get(name) > 1) return send(400, { error: "duplicate_header" });
    }
    const routes = { "/dummy": "POST", "/pending": "GET", "/status": "POST", "/reject": "POST" };
    const method = routes[req.url];
    if (!method) return send(404, { error: "not_found" });
    const isAdapter = req.url === "/dummy";
    if (isAdapter && origin !== undefined) return send(403, { error: "adapter_origin_forbidden" });
    if (!isAdapter && origin === undefined) return send(403, { error: "browser_origin_required" });
    if (origin) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"); }
    if (req.method === "OPTIONS") {
      const headers = String(req.headers["access-control-request-headers"] || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
      const allowed = method === "GET" ? ["authorization"] : ["authorization", "content-type"];
      if (isAdapter || req.headers["access-control-request-method"] !== method || !headers.includes("authorization")
        || headers.some((x) => !allowed.includes(x)) || (req.headers["access-control-request-private-network"] !== undefined
        && req.headers["access-control-request-private-network"] !== "true")) return send(400, { error: "invalid_preflight" });
      res.setHeader("Access-Control-Allow-Methods", method);
      res.setHeader("Access-Control-Allow-Headers", allowed.join(", "));
      if (req.headers["access-control-request-private-network"] === "true") res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.statusCode = 204; return res.end();
    }
    if (req.method !== method) return send(405, { error: "invalid_method" });
    if (!authorize(req.headers.authorization, isAdapter ? adapterToken : browserToken)) return send(401, { error: "unauthorized" });
    if (req.headers["content-encoding"] !== undefined || req.headers["transfer-encoding"] !== undefined
      || Number(req.headers["content-length"] || 0) > MAX_INPUT_BYTES) return send(413, { error: "input_too_large_or_encoded" });
    if (method === "GET" && Number(req.headers["content-length"] || 0) !== 0) return send(400, { error: "unexpected_body" });
    if (method === "POST" && req.headers["content-type"] !== "application/json") return send(415, { error: "json_required" });
    inflight++;
    try {
      if (req.url === "/pending") return send(200, { pending: queue.peek() });
      const input = await readJson(req);
      if (!exactKeys(input, ["requestId"])) throw fault("invalid_format");
      const record = isAdapter ? queue.submit(dummyRequest(input.requestId))
        : req.url === "/reject" ? queue.reject(input.requestId) : queue.status(input.requestId);
      return send(record.state === "queue_full" ? 409 : 200, { request: record });
    } catch (error) { return send(error.status || 500, { error: error.code || "internal_error" }); }
    finally { inflight--; }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.timeout = 5000;
  server.keepAliveTimeout = 1000; server.maxRequestsPerSocket = 120;
  server.maxConnections = 8;
  return { server, queue };
}
if (require.main === module) {
  try {
    const { server } = createPreviewService({ browserToken: process.env.MEMO_PREVIEW_BROWSER_TOKEN, adapterToken: process.env.MEMO_PREVIEW_ADAPTER_TOKEN });
    server.on("error", () => { console.error("Preview service could not start"); process.exitCode = 1; });
    server.listen(PORT, "127.0.0.1", () => console.log(`Unsaved dummy preview listening on 127.0.0.1:${PORT}`));
    const stop = () => { server.close(); server.closeAllConnections(); };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
  } catch { console.error("Preview service requires two distinct dedicated random tokens"); process.exitCode = 1; }
}
module.exports = { PORT, ORIGINS, MAX_INPUT_BYTES, validateToken, authorize, createPreviewService };
