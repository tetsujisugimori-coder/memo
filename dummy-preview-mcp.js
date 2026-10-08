"use strict";
const http = require("node:http");
const { REQUEST_ID_PATTERN, exactKeys } = require("./dummy-preview-queue.js");
const { PORT, validateToken } = require("./dummy-preview-service.js");
function submitDummy(requestId, token) {
  validateToken(token);
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ requestId });
    const req = http.request({ hostname: "127.0.0.1", port: PORT, path: "/dummy", method: "POST", timeout: 3000,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      const chunks = []; let size = 0;
      res.on("data", (chunk) => { size += chunk.length; if (size > 70000) res.destroy(new Error("response_limit")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => {
        if (res.statusCode !== 200 && res.statusCode !== 409) return reject(new Error("queue_request_failed"));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")).request); } catch { reject(new Error("invalid_response")); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("queue_timeout")));
    req.on("error", reject); req.end(body);
  });
}
function createMcpHandler({ submit = (id) => submitDummy(id, process.env.MEMO_PREVIEW_ADAPTER_TOKEN) } = {}) {
  let initialized = false;
  return async (message) => {
    const reply = (result) => ({ jsonrpc: "2.0", id: message.id, result });
    const error = (code, text) => ({ jsonrpc: "2.0", id: message?.id ?? null, error: { code, message: text } });
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return error(-32600, "Invalid request");
    if (message.method === "notifications/initialized") { initialized = true; return null; }
    if (!Object.hasOwn(message, "id")) return null;
    if (message.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "memo-unsaved-dummy-preview", version: "1.0.0" } });
    if (message.method === "ping") return reply({});
    if (!initialized) return error(-32000, "Initialize first");
    if (message.method === "tools/list") return reply({ tools: [{ name: "submit_dummy_preview", description: "固定ダミー1件を一時キューで受信・未保存。ブラウザ表示やメモ保存を行わない。requestIdは呼び出し側がUUID v4を生成し、再送には同じ値を使う。",
      inputSchema: { type: "object", properties: { requestId: { type: "string", pattern: REQUEST_ID_PATTERN.source } }, required: ["requestId"], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }] });
    if (message.method !== "tools/call") return error(-32601, "Method not found");
    if (!exactKeys(message.params, ["name", "arguments"]) || message.params.name !== "submit_dummy_preview"
      || !exactKeys(message.params.arguments, ["requestId"]) || typeof message.params.arguments.requestId !== "string"
      || !REQUEST_ID_PATTERN.test(message.params.arguments.requestId)) return error(-32602, "Only a dummy requestId (UUID v4) is accepted");
    try {
      const record = await submit(message.params.arguments.requestId);
      const result = { requestId: record.requestId, title: record.title, body: record.body, state: record.state, saved: false,
        message: record.state === "queued" ? "一時キューで受信・未保存（ブラウザ表示は未確認）" : `一時要求の状態: ${record.state}・未保存` };
      return reply({ content: [{ type: "text", text: JSON.stringify(result) }], isError: record.state === "queue_full" });
    } catch { return reply({ content: [{ type: "text", text: JSON.stringify({ requestId: message.params.arguments.requestId, state: "unconfirmed", saved: false, message: "一時キューへの受信を確認できません。未保存。同じrequestIdで再試行してください。" }) }], isError: true }); }
  };
}
function runStdio() {
  const handle = createMcpHandler();
  let buffer = Buffer.alloc(0); let busy = false; let count = 0; let start = Date.now();
  const write = (value) => { if (value) process.stdout.write(`${JSON.stringify(value)}\n`); };
  process.stdin.on("data", async (chunk) => {
    // Bound queued input, including oversized lines without newlines.
    if (busy || buffer.length + chunk.length > 4096) { process.stdin.destroy(); process.exitCode = 1; return; }
    buffer = Buffer.concat([buffer, chunk]); busy = true; process.stdin.pause();
    try {
      let newline;
      while ((newline = buffer.indexOf(10)) !== -1) {
        const line = buffer.subarray(0, newline).toString("utf8"); buffer = buffer.subarray(newline + 1);
        if (Date.now() - start >= 60000) { count = 0; start = Date.now(); }
        if (++count > 120) { process.stdin.destroy(); process.exitCode = 1; return; }
        try { write(await handle(JSON.parse(line))); }
        catch { write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
      }
    } finally { busy = false; process.stdin.resume(); }
  });
}
if (require.main === module) runStdio();
module.exports = { submitDummy, createMcpHandler };
