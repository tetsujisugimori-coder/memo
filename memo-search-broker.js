"use strict";
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const { exact, scope, conditions, validateResult, responseBytes, readConditions, validateReadResult } = require("./memo-search.js");
const secret = () => randomBytes(32).toString("base64url");
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const principalKey = value => {
  exact(value, ["issuer", "sub"]);
  if (![value.issuer, value.sub].every(v => typeof v === "string" && v.length > 0 && v.length <= 512)) fail("invalid_principal", 400);
  return JSON.stringify([value.issuer, value.sub]);
};
function createSearchBroker({ now = Date.now, timeoutMs = 6000 } = {}) {
  const sessions = new Map(), budgets = new Map();
  function finish(session, value) {
    const pending = session.pending;
    session.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      const rows = value.error ? 0 : pending.readConditions ? 1 : value.count, size = value.error ? 0 : responseBytes(value);
      session.rows += rows - pending.conditions.limit; session.bytes += size - 8192;
      pending.budget.rows += rows - pending.conditions.limit; pending.budget.bytes += size - 8192;
      pending.resolve(value);
    }
  }
  function invalidate(session, state) {
    session.state = state; session.capability = null; session.code = null; session.cursors.clear();
    finish(session, { error: state });
  }
  function sweep() {
    for (const [id, session] of sessions) {
      if (now() >= session.expiresAt && !["permission_expired", "permission_revoked"].includes(session.state)) invalidate(session, "permission_expired");
      if (now() >= session.expiresAt + 600000) sessions.delete(id);
    }
    for (const [key, budget] of budgets) if (now() >= budget.until) budgets.delete(key);
  }
  function get(id) { sweep(); const session = sessions.get(id); if (!session) fail("permission_required"); return session; }
  function active(session) { if (session.state !== "active") fail(session.state === "pairing" ? "permission_required" : session.state); }
  function browser(input, origin) {
    const session = get(input.sessionId); active(session);
    if (session.origin !== origin || typeof input.capability !== "string" || input.capability !== session.capability) fail("tab_forbidden", 403);
    return session;
  }
  function budgetFor(key) {
    let budget = budgets.get(key);
    if (!budget) { if (budgets.size >= 64) fail("search_capacity"); budget = { calls: 0, rows: 0, bytes: 0, until: now() + 3600000 }; budgets.set(key, budget); }
    return budget;
  }
  return {
    prepare(principal) {
      sweep(); const key = principalKey(principal);
      const budget = budgetFor(key);
      if (++budget.calls > 60) fail("search_budget_exhausted", 429);
      if (sessions.size >= 32 || [...sessions.values()].filter(s => s.key === key && ["pairing", "active"].includes(s.state)).length >= 4) fail("search_capacity");
      const sessionId = randomUUID(), pairingCode = secret();
      sessions.set(sessionId, { key, principal: { ...principal }, code: pairingCode, state: "pairing", expiresAt: now() + 120000,
        capability: null, pending: null, cursors: new Map(), calls: 0, rows: 0, bytes: 0 });
      return { sessionId, pairingCode, expiresAt: now() + 120000, instruction: "Memo-NexusのMCP検索許可画面でコードを入力し、主体と範囲を確認して許可してください。" };
    },
    inspect(input) {
      exact(input, ["pairingCode"]); sweep();
      const session = [...sessions.values()].find(s => s.code === input.pairingCode && s.state === "pairing");
      if (!session) fail("pairing_invalid_or_expired");
      return { principal: session.principal, expiresAt: session.expiresAt };
    },
    grant(input, origin) {
      exact(input, ["pairingCode", "scope"], ["allowRead"]); this.inspect({ pairingCode: input.pairingCode });
      if (input.allowRead !== undefined && typeof input.allowRead !== "boolean") fail("unsupported_conditions", 400);
      const session = [...sessions.values()].find(s => s.code === input.pairingCode);
      session.scope = scope(input.scope); session.allowRead = input.allowRead === true; session.code = null; session.state = "active";
      session.origin = origin; session.capability = secret(); session.expiresAt = now() + 600000; session.lastSeen = now();
      return { sessionId: [...sessions].find(([, s]) => s === session)[0], capability: session.capability, expiresAt: session.expiresAt, scope: session.scope, allowRead: session.allowRead };
    },
    revoke(input, origin) {
      exact(input, ["sessionId", "capability"]); const session = browser(input, origin); invalidate(session, "permission_revoked"); return { revoked: true };
    },
    poll(input, origin) {
      exact(input, ["sessionId", "capability"]); const session = browser(input, origin); session.lastSeen = now();
      const pending = session.pending;
      return { expiresAt: session.expiresAt, scope: session.scope, remaining: { requests: Math.max(0, 20 - session.calls), rows: 100 - session.rows, bytes: 65536 - session.bytes },
        request: pending ? { requestId: pending.id, conditions: pending.conditions, afterId: pending.afterId,
          ...(pending.readConditions ? { operation: "read", readConditions: pending.readConditions } : {}) } : null };
    },
    async read(principal, input) {
      exact(input, ["sessionId", "memoId"], ["offset"]);
      const request = readConditions({ memoId: input.memoId, ...(input.offset !== undefined ? { offset: input.offset } : {}) });
      const session = get(input.sessionId);
      return this.search(principal, { sessionId: input.sessionId, conditions: { query: "read", scope: session.scope || { type: "all" }, limit: 1 } }, request);
    },
    async search(principal, input, readRequest = null) {
      exact(input, ["sessionId", "conditions"]); const key = principalKey(principal), session = get(input.sessionId);
      if (key !== session.key) fail("subject_mismatch", 403);
      active(session);
      if (readRequest && !session.allowRead) fail("read_permission_required", 403);
      const request = conditions(input.conditions);
      if (session.scope.type === "collection" && (request.scope.type !== "collection" || request.scope.collectionId !== session.scope.collectionId)) fail("scope_forbidden", 403);
      if (now() - session.lastSeen > 5000) fail("browser_disconnected", 503);
      if (session.pending) fail("search_busy");
      // Leave receiver concurrency available for browser polling and cancellation.
      if ([...sessions.values()].filter(s => s.pending).length >= 2) fail("search_busy");
      const budget = budgetFor(key);
      if (session.calls >= 20 || session.rows + request.limit > 100 || session.bytes + 8192 > 65536
        || budget.calls >= 60 || budget.rows + request.limit > 200 || budget.bytes + 8192 > 262144) fail("search_budget_exhausted", 429);
      const fingerprint = createHash("sha256").update(JSON.stringify([request.query, request.scope, request.limit, request.fields, request.tagIds])).digest("hex");
      let afterId = null;
      if (request.cursor) {
        const cursor = session.cursors.get(request.cursor);
        if (!cursor || cursor.fingerprint !== fingerprint) fail("invalid_cursor", 400);
        afterId = cursor.afterId; session.cursors.delete(request.cursor);
      }
      session.calls++; budget.calls++;
      // Reserve before awaiting a browser; concurrent sessions cannot overspend the principal budget.
      session.rows += request.limit; session.bytes += 8192; budget.rows += request.limit; budget.bytes += 8192;
      return new Promise(resolve => {
        const pending = { id: randomUUID(), conditions: request, readConditions: readRequest, fingerprint, afterId, resolve, budget };
        session.pending = pending;
        pending.timer = setTimeout(() => finish(session, { error: now() >= session.expiresAt ? "permission_expired" : now() - session.lastSeen > 5000 ? "browser_disconnected" : "search_timeout" }), timeoutMs);
      });
    },
    result(input, origin) {
      exact(input, ["sessionId", "capability", "requestId"], ["result", "error"]);
      const session = browser(input, origin), pending = session.pending;
      if (!pending || input.requestId !== pending.id) fail("request_mismatch");
      if (now() - session.lastSeen > 5000) {
        finish(session, { error: "browser_disconnected" }); fail("browser_disconnected", 503);
      }
      if (Object.hasOwn(input, "error")) {
        const errors = pending.readConditions ? ["storage_unavailable", "memo_unavailable", "memo_too_large", "invalid_offset", "search_failed"] : ["storage_unavailable", "collection_unavailable", "search_failed"];
        if (Object.hasOwn(input, "result") || !errors.includes(input.error)) fail("invalid_search_result", 400);
        finish(session, { error: input.error }); return { accepted: true };
      }
      if (pending.readConditions) {
        const result = validateReadResult(input.result, pending.readConditions, session.scope);
        finish(session, result); return { accepted: true };
      }
      const result = validateResult(input.result, pending.conditions.limit, pending.conditions.scope);
      if (result.results.some(item => pending.afterId !== null && item.id <= pending.afterId)) fail("invalid_search_result", 400);
      const output = { ...result, nextCursor: null };
      if (result.hasMore) {
        output.nextCursor = secret(); session.cursors.set(output.nextCursor, { fingerprint: pending.fingerprint, afterId: result.results.at(-1).id });
      }
      finish(session, output); return { accepted: true };
    },
    close() { for (const session of sessions.values()) invalidate(session, "browser_disconnected"); sessions.clear(); budgets.clear(); }
  };
}
module.exports = { createSearchBroker };
