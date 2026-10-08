"use strict";
const { createHash } = require("node:crypto");
const FIXTURE = Object.freeze({
  formatVersion: 1,
  dummy: true,
  title: "Memo-Nexus 受信実証（固定ダミー・未保存）",
  body: "# 固定ダミーメモ\n\n日本語の受信確認です。\nこの内容は保存されません。\n\n- 箇条書きの一つ目\n- 箇条書きの二つ目\n\n`inline code`\n\n```js\nconst message = \"未保存\";\n```\n\n<img src=\"https://example.invalid/preview.png\" onerror=\"window.previewExecuted=true\">\n[アクセスしないURL](https://example.invalid/)\n"
});
const TTL_MS = 10 * 60 * 1000;
const MAX_HISTORY = 128;
const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fault(code, status = 400) { return Object.assign(new Error(code), { code, status }); }
function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function validateRequest(value) {
  if (!exactKeys(value, ["formatVersion", "requestId", "dummy", "title", "body"])) throw fault("invalid_format");
  if (value.formatVersion !== 1 || value.dummy !== true || !REQUEST_ID_PATTERN.test(value.requestId)
    || typeof value.requestId !== "string" || typeof value.title !== "string" || typeof value.body !== "string") throw fault("invalid_format");
  if (Array.from(value.title).length > 200 || Buffer.byteLength(value.body, "utf8") > MAX_BODY_BYTES) throw fault("size_limit", 413);
  return { formatVersion: value.formatVersion, requestId: value.requestId, dummy: value.dummy, title: value.title, body: value.body };
}
function dummyRequest(requestId) { return validateRequest({ ...FIXTURE, requestId }); }
function createQueue({ now = Date.now } = {}) {
  const history = new Map();
  let activeId = null;
  function expire() {
    if (activeId && now() >= history.get(activeId).expiresAt) {
      history.get(activeId).state = "expired";
      activeId = null;
    }
  }
  function publicRecord(record) {
    return { ...record.request, state: record.state, receivedAt: record.receivedAt, expiresAt: record.expiresAt, saved: false };
  }
  function submit(input) {
    expire();
    const request = validateRequest(input);
    const digest = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const known = history.get(request.requestId);
    if (known) {
      if (known.digest !== digest) throw fault("request_id_conflict", 409);
      return publicRecord(known);
    }
    if (request.title !== FIXTURE.title || request.body !== FIXTURE.body) throw fault("fixed_dummy_only");
    // Never evict an idempotency record: fail closed until restart at the history cap.
    if (history.size >= MAX_HISTORY) throw fault("history_full", 503);
    const receivedAt = now();
    const record = { request, digest, receivedAt, expiresAt: receivedAt + TTL_MS, state: activeId ? "queue_full" : "queued" };
    history.set(request.requestId, record);
    if (!activeId) activeId = request.requestId;
    return publicRecord(record);
  }
  function peek() { expire(); return activeId ? publicRecord(history.get(activeId)) : null; }
  function status(requestId) {
    expire();
    if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) throw fault("invalid_request_id");
    const record = history.get(requestId);
    if (!record) throw fault("request_not_found", 404);
    return publicRecord(record);
  }
  function reject(requestId) {
    const record = status(requestId);
    if (record.state === "queued") { history.get(requestId).state = "rejected"; activeId = null; }
    return publicRecord(history.get(requestId));
  }
  return { submit, peek, status, reject };
}
module.exports = { FIXTURE, TTL_MS, MAX_HISTORY, MAX_BODY_BYTES, REQUEST_ID_PATTERN, fault, exactKeys, validateRequest, dummyRequest, createQueue };
