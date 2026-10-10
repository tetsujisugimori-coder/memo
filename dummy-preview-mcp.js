"use strict";
const http = require("node:http");
const { REQUEST_ID_PATTERN, MAX_TEXT_INPUT_BYTES, MAX_NOTES_INPUT_BYTES, notesRequest, textRequest, exactKeys } = require("./dummy-preview-queue.js");
const { PORT, validateToken } = require("./dummy-preview-service.js");
function submitPayload(payload, token, path) {
  validateToken(token);
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({ hostname: "127.0.0.1", port: PORT, path, method: "POST", timeout: 3000,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      const chunks = []; let size = 0;
      res.on("data", (chunk) => { size += chunk.length; if (size > (path === "/notes" ? MAX_NOTES_INPUT_BYTES : MAX_TEXT_INPUT_BYTES) + 4096) res.destroy(new Error("response_limit")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (result.error) return reject(Object.assign(new Error(result.error), { code: result.error }));
          if ((res.statusCode !== 200 && res.statusCode !== 409) || !result.request) throw new Error("invalid_response");
          resolve(result.request);
        } catch { reject(new Error("invalid_response")); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("queue_timeout")));
    req.on("error", reject); req.end(body);
  });
}
function submitDummy(requestId, token) { return submitPayload({ requestId }, token, "/dummy"); }
function submitText(input, token) { textRequest(input); return submitPayload(input, token, "/text"); }
function submitNotes(input, token) { notesRequest(input); return submitPayload(input, token, "/notes"); }
// MCP 2025-06-18 Request._meta: opaque metadata, with an optional string/number progressToken.
// Key syntax follows basic/general-fields; reserved prefixes remain valid metadata.
const META_LABEL = "[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
const META_KEY = new RegExp(`^(?:${META_LABEL}(?:\\.${META_LABEL})*/)?(?:[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?)?$`);
function validRequestMetadata(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => META_KEY.test(key))
    && (!Object.hasOwn(value, "progressToken") || typeof value.progressToken === "string"
      || (typeof value.progressToken === "number" && Number.isFinite(value.progressToken)));
}
function createMcpHandler({ submit = (id) => submitDummy(id, process.env.MEMO_PREVIEW_ADAPTER_TOKEN), submitArbitrary = (input) => submitText(input, process.env.MEMO_PREVIEW_ADAPTER_TOKEN), submitMultiple = (input) => submitNotes(input, process.env.MEMO_PREVIEW_ADAPTER_TOKEN) } = {}) {
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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
      { name: "submit_text_preview", description: "任意文章を一時キューに受信。保存はブラウザの明示的ボタン操作のみ。requestIdはUUID v4、titleは空白のみ不可・200コードポイント、bodyは空白のみ不可・65536コードポイントかつUTF-8 65536 byteまで。本文を変換しない。",
        inputSchema: { type: "object", properties: { requestId: { type: "string", pattern: REQUEST_ID_PATTERN.source }, title: { type: "string", minLength: 1, maxLength: 200 }, body: { type: "string", minLength: 1, maxLength: 65536 } }, required: ["requestId", "title", "body"], additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
      { name: "submit_notes_preview", description: "1～5件の文章を1要求で未保存受信。各メモの保存・破棄はブラウザで個別に明示操作。requestIdは要求全体のUUID v4。同じID・順序・原文で再送する。各titleは200コードポイント、bodyは65536コードポイントかつUTF-8 65536 byte、要求JSONは2048000 byteまで。",
        inputSchema: { type: "object", properties: { requestId: { type: "string", pattern: REQUEST_ID_PATTERN.source }, notes: { type: "array", minItems: 1, maxItems: 5,
          items: { type: "object", properties: { title: { type: "string", minLength: 1, maxLength: 200 }, body: { type: "string", minLength: 1, maxLength: 65536 } }, required: ["title", "body"], additionalProperties: false } } }, required: ["requestId", "notes"], additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }] });
    if (message.method !== "tools/call") return error(-32601, "Method not found");
    const hasMeta = message.params != null && Object.hasOwn(message.params, "_meta");
    if (!exactKeys(message.params, hasMeta ? ["name", "arguments", "_meta"] : ["name", "arguments"])
      || (hasMeta && !validRequestMetadata(message.params._meta))) return error(-32602, "Invalid tool parameters");
    const multiple = message.params.name === "submit_notes_preview";
    const arbitrary = message.params.name === "submit_text_preview";
    try {
      if (multiple) notesRequest(message.params.arguments);
      else if (arbitrary) textRequest(message.params.arguments);
      else if (message.params.name !== "submit_dummy_preview" || !exactKeys(message.params.arguments, ["requestId"])
        || typeof message.params.arguments.requestId !== "string" || !REQUEST_ID_PATTERN.test(message.params.arguments.requestId)) throw new Error("invalid_format");
    } catch (invalid) { return error(-32602, invalid.code || "Invalid tool arguments"); }
    try {
      const record = multiple ? await submitMultiple(message.params.arguments) : arbitrary ? await submitArbitrary(message.params.arguments) : await submit(message.params.arguments.requestId);
      const result = { requestId: record.requestId, ...(multiple ? { notes: record.notes.map(({ itemId, title, body, state, saved }) => ({ itemId, title, body, state, saved })) } : { title: record.title, body: record.body }), state: record.state, saved: record.saved,
        message: multiple ? `一時要求の状態: ${record.state}。各メモのstateとsavedを確認してください。savedはブラウザ完了通知済みの結果です。このMCP呼び出しは保存しません。` : record.saved ? "ブラウザから保存完了の通知を受信済み（このMCP呼び出しは保存しません）" : record.state === "queued" ? "一時キューで受信・未保存（ブラウザ表示は未確認）" : `一時要求の状態: ${record.state}・保存完了は未確認` };
      return reply({ content: [{ type: "text", text: JSON.stringify(result) }], isError: record.state === "queue_full" });
    } catch (failure) {
      const capacity = { history_full: "受信履歴が128要求の上限に達したため新規受信を拒否しました。履歴を保全し、既知requestIdの再送・照会と未完了要求の処理を続けてください。履歴を削除・切替しないでください。", history_capacity: "受信履歴が容量上限に達したため操作を拒否しました。履歴を保全し、既知requestIdの状態を確認してください。履歴を削除・切替しないでください。" };
      const code = ["history_full", "history_capacity", "history_write_failed", "history_unavailable", "request_id_conflict", "unauthorized"].includes(failure.code) ? failure.code : "unconfirmed";
      return reply({ content: [{ type: "text", text: JSON.stringify({ requestId: message.params.arguments.requestId, state: code, saved: false, message: capacity[code] || (code === "request_id_conflict" ? "同じrequestIdの内容が異なるため拒否しました。既存の受信内容は維持します。" : multiple ? "受信を確認できません。同じrequestId・原文で再試行してください。各メモの保存結果は未確認です。" : "受信と保存結果を確認できません。同じrequestId・同じ原文で再試行してください。") }) }], isError: true }); }
  };
}
function runStdio() {
  const handle = createMcpHandler();
  let buffer = Buffer.alloc(0); let busy = false; let count = 0; let start = Date.now();
  const write = (value) => { if (value) process.stdout.write(`${JSON.stringify(value)}\n`); };
  process.stdin.on("data", async (chunk) => {
    // Bound queued input, including oversized lines without newlines.
    if (busy || buffer.length + chunk.length > MAX_NOTES_INPUT_BYTES + 4096) { process.stdin.destroy(); process.exitCode = 1; return; }
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
module.exports = { submitNotes, submitDummy, submitText, createMcpHandler };
