"use strict";
const { createHash, randomUUID } = require("node:crypto");
const FIXTURE = Object.freeze({
  formatVersion: 1,
  dummy: true,
  title: "Memo-Nexus 受信実証（固定ダミー・未保存）",
  body: "# 固定ダミーメモ\n\n日本語の受信確認です。\nこの内容は保存されません。\n\n- 箇条書きの一つ目\n- 箇条書きの二つ目\n\n`inline code`\n\n```js\nconst message = \"未保存\";\n```\n\n<img src=\"https://example.invalid/preview.png\" onerror=\"window.previewExecuted=true\">\n[アクセスしないURL](https://example.invalid/)\n"
});
const TTL_MS = 10 * 60 * 1000;
const MAX_HISTORY = 128;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_CHARS = 65536;
const MAX_TEXT_INPUT_BYTES = 400 * 1024;
const MAX_NOTES = 5;
const MAX_NOTES_INPUT_BYTES = MAX_NOTES * MAX_TEXT_INPUT_BYTES;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fault(code, status = 400) { return Object.assign(new Error(code), { code, status }); }
function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function validateRequest(value) {
  if (!exactKeys(value, ["formatVersion", "requestId", "dummy", "title", "body"])) throw fault("invalid_format");
  if (value.formatVersion !== 1 || typeof value.dummy !== "boolean" || !REQUEST_ID_PATTERN.test(value.requestId)
    || typeof value.requestId !== "string" || typeof value.title !== "string" || typeof value.body !== "string") throw fault("invalid_format");
  if (!value.title.trim() || !value.body.trim()) throw fault("empty_input");
  if (Array.from(value.title).length > 200 || Array.from(value.body).length > MAX_TEXT_CHARS || Buffer.byteLength(value.body, "utf8") > MAX_BODY_BYTES) throw fault("size_limit", 413);
  return { formatVersion: value.formatVersion, requestId: value.requestId, dummy: value.dummy, title: value.title, body: value.body };
}
function dummyRequest(requestId) { return validateRequest({ ...FIXTURE, requestId }); }
function textRequest(value) {
  if (!exactKeys(value, ["requestId", "title", "body"])) throw fault("invalid_format");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_TEXT_INPUT_BYTES) throw fault("size_limit", 413);
  return validateRequest({ formatVersion: 1, dummy: false, ...value });
}
function notesRequest(value) {
  if (!exactKeys(value, ["requestId", "notes"]) || typeof value.requestId !== "string" || !REQUEST_ID_PATTERN.test(value.requestId)
    || !Array.isArray(value.notes) || value.notes.length < 1 || value.notes.length > MAX_NOTES) throw fault("invalid_format");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_NOTES_INPUT_BYTES) throw fault("size_limit", 413);
  const validatedNotes = value.notes.map((note) => {
    if (!exactKeys(note, ["title", "body"])) throw fault("invalid_format");
    const validated = textRequest({ requestId: value.requestId, ...note });
    return { title: validated.title, body: validated.body };
  });
  return { formatVersion: 1, requestId: value.requestId, notes: validatedNotes };
}
function createQueue({ now = Date.now, initial = [], persist = null } = {}) {
  const history = new Map(initial.map((record) => [record.request.requestId, record]));
  let stopped = false;
  const leaves = (record) => record.items || [record];
  for (const record of history.values()) {
    for (const item of leaves(record)) {
      item.request = { ...item.request, title: "", body: "" };
      item.bodyAvailable = false;
      if (item.savePlan) item.recoveryRequired = true;
    }
  }
  let activeId = [...history.values()].find((record) => leaves(record).some((item) => ["queued", "saving", "save_failed"].includes(item.state)))?.request.requestId || null;
  const unresolved = (record) => ["queued", "saving", "save_failed"].includes(record.state);
  function refresh(record) {
    if (!record.items) return;
    record.state = record.items.some(unresolved) ? "queued" : "completed";
    if (activeId === record.request.requestId && !record.items.some(unresolved)) activeId = null;
  }
  function expire() {
    if (!activeId) return;
    const record = history.get(activeId);
    if (record.items) {
      for (const item of record.items) if (item.state === "queued" && now() >= item.expiresAt) item.state = "expired";
      refresh(record);
    } else if (record.state === "queued" && now() >= record.expiresAt) { record.state = "expired"; activeId = null; }
  }
  function publicRecord(record) {
    if (record.items) return { ...record.request, notes: record.items.map(publicRecord), state: record.state,
      receivedAt: record.receivedAt, expiresAt: record.expiresAt, saved: record.items.every((item) => item.state === "saved") };
    return { ...record.request, state: record.state, receivedAt: record.receivedAt, expiresAt: record.expiresAt, saved: record.state === "saved",
      ...(record.bodyAvailable === false ? { bodyAvailable: false } : {}),
      ...(record.recoveryRequired ? { recoveryRequired: true } : {}),
      ...(!record.request.dummy ? { savePlan: record.savePlan ? { ...record.savePlan } : null, attemptId: record.attemptId || null } : {}) };
  }
  function internalRecord(requestId, itemId) {
    const record = history.get(requestId);
    if (!record) throw fault("request_not_found", 404);
    if (itemId === undefined) return record;
    if (typeof itemId !== "string" || !REQUEST_ID_PATTERN.test(itemId)) throw fault("invalid_item_id");
    const item = record.items?.find((item) => item.request.itemId === itemId);
    if (!item) throw fault("item_not_found", 404);
    return item;
  }
  function changed(requestId) { refresh(history.get(requestId)); }
  function submit(input) {
    const multiple = Object.hasOwn(input || {}, "notes");
    if (multiple && (!exactKeys(input, ["formatVersion", "requestId", "notes"]) || input.formatVersion !== 1)) throw fault("invalid_format");
    const request = multiple ? notesRequest({ requestId: input.requestId, notes: input.notes }) : validateRequest(input);
    expire();
    const digest = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const known = history.get(request.requestId);
    if (known) {
      if (known.digest !== digest) throw fault("request_id_conflict", 409);
      // Verified replay restores only volatile text, never IDs, deadlines or states.
      known.request = request;
      if (known.items) known.items.forEach((item, index) => {
        item.request = { ...item.request, ...request.notes[index] }; delete item.bodyAvailable;
      });
      else delete known.bodyAvailable;
      return publicRecord(known);
    }
    if (request.dummy && (request.title !== FIXTURE.title || request.body !== FIXTURE.body)) throw fault("fixed_dummy_only");
    // Never evict an idempotency record, including across service restarts.
    if (history.size >= MAX_HISTORY) throw fault("history_full", 503);
    const receivedAt = now();
    const record = { request, digest, receivedAt, expiresAt: receivedAt + TTL_MS, state: activeId ? "queue_full" : "queued" };
    if (request.notes) record.items = request.notes.map((note) => ({
      request: { formatVersion: 1, requestId: request.requestId, itemId: randomUUID(), dummy: false, ...note },
      receivedAt, expiresAt: record.expiresAt, state: record.state
    }));
    history.set(request.requestId, record);
    if (!activeId) activeId = request.requestId;
    return publicRecord(record);
  }
  function peek() { expire(); return activeId ? publicRecord(history.get(activeId)) : null; }
  function status(requestId, itemId) {
    expire();
    if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) throw fault("invalid_request_id");
    return publicRecord(internalRecord(requestId, itemId));
  }
  function reject(requestId, itemId) {
    const record = status(requestId, itemId);
    if (record.notes) throw fault("item_id_required");
    if (["queued", "save_failed"].includes(record.state)) { internalRecord(requestId, itemId).state = "rejected"; if (!history.get(requestId).items && activeId === requestId) activeId = null; changed(requestId); }
    if (record.state === "saving") throw fault("save_in_progress", 409);
    return publicRecord(internalRecord(requestId, itemId));
  }
  function begin(requestId, collectionId, previousAttemptId, itemId) {
    const record = status(requestId, itemId);
    if (record.notes) throw fault("item_id_required");
    if (previousAttemptId !== null && (typeof previousAttemptId !== "string" || !REQUEST_ID_PATTERN.test(previousAttemptId))) throw fault("invalid_save_attempt");
    if (previousAttemptId !== record.attemptId) throw fault("stale_save_attempt", 409);
    if (!record.dummy && record.state === "saved") return record;
    if (record.dummy || !["queued", "saving", "save_failed"].includes(record.state)) throw fault("invalid_state", 409);
    if (typeof collectionId !== "string" || !collectionId || collectionId.length > 200) throw fault("invalid_collection");
    const internal = internalRecord(requestId, itemId);
    if (internal.bodyAvailable === false) throw fault("replay_required", 409);
    internal.savePlan ||= { noteId: randomUUID(), collectionId };
    internal.attemptId = randomUUID();
    internal.state = "saving";
    return publicRecord(internal);
  }
  function validateAttempt(record, attemptId) {
    if (typeof attemptId !== "string" || !REQUEST_ID_PATTERN.test(attemptId)) throw fault("invalid_save_attempt");
    if (record.attemptId !== attemptId) throw fault("stale_save_attempt", 409);
  }
  function complete(requestId, attemptId, itemId) {
    const record = status(requestId, itemId);
    if (record.notes) throw fault("item_id_required");
    validateAttempt(record, attemptId);
    if (record.dummy || !["saving", "saved"].includes(record.state)) throw fault("invalid_state", 409);
    internalRecord(requestId, itemId).state = "saved";
    delete internalRecord(requestId, itemId).recoveryRequired;
    if (!history.get(requestId).items && activeId === requestId) activeId = null;
    changed(requestId);
    return publicRecord(internalRecord(requestId, itemId));
  }
  function failed(requestId, attemptId, itemId) {
    const record = status(requestId, itemId);
    if (record.notes) throw fault("item_id_required");
    validateAttempt(record, attemptId);
    if (record.dummy || !["saving", "save_failed"].includes(record.state)) throw fault("invalid_state", 409);
    internalRecord(requestId, itemId).state = "save_failed"; changed(requestId);
    return publicRecord(internalRecord(requestId, itemId));
  }
  function snapshot() {
    function metadata(record) {
      return { request: { formatVersion: 1, requestId: record.request.requestId,
        ...(record.items ? {} : { dummy: record.request.dummy, ...(record.request.itemId ? { itemId: record.request.itemId } : {}) }) },
        ...(record.digest ? { digest: record.digest } : {}), state: record.state,
        receivedAt: record.receivedAt, expiresAt: record.expiresAt,
        ...(record.savePlan ? { savePlan: { ...record.savePlan }, attemptId: record.attemptId } : {}),
        ...(record.items ? { items: record.items.map(metadata) } : {}) };
    }
    return [...history.values()].map(metadata);
  }
  let last = JSON.stringify(snapshot());
  function durable(operation) {
    return (...args) => {
      if (stopped) throw fault("history_unavailable", 503);
      // Capacity is rejected before any journal write. Roll back the volatile mutation.
      const before = persist ? [...history.entries()].map(([id, record]) => [id, { ...record, ...(record.items ? { items: record.items.map((item) => ({ ...item })) } : {}) }]) : null, previousActiveId = activeId;
      let result, failure;
      try { result = operation(...args); } catch (error) { failure = error; }
      const next = snapshot(), encoded = JSON.stringify(next);
      if (persist && encoded !== last) {
        try { persist(next); last = encoded; }
        catch (error) {
          if (error.code === "history_capacity") {
            history.clear(); for (const [id, record] of before) history.set(id, record); activeId = previousActiveId;
            throw fault("history_capacity", 503);
          }
          stopped = true; throw fault("history_write_failed", 503);
        }
      }
      if (failure) throw failure;
      return result;
    };
  }
  return Object.fromEntries(Object.entries({ submit, peek, status, reject, begin, complete, failed }).map(([key, operation]) => [key, durable(operation)]));
}
module.exports = { MAX_NOTES, MAX_NOTES_INPUT_BYTES, notesRequest, FIXTURE, TTL_MS, MAX_HISTORY, MAX_BODY_BYTES, MAX_TEXT_CHARS, MAX_TEXT_INPUT_BYTES, REQUEST_ID_PATTERN, fault, exactKeys, validateRequest, dummyRequest, textRequest, createQueue };
