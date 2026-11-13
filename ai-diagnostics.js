(function initAiDiagnostics(scope) {
  "use strict";
  const UNKNOWN = "UNKNOWN";
  const count = (n) => Number.isSafeInteger(n) && n >= 0 ? n : 0;
  const choice = (value, values) => values.includes(value) ? value : UNKNOWN;
  const errorCodes = ["aborted", "timeout", "connection", "model_missing", "provider", "invalid_response", "empty_response", "stream_parse", "stream_content_type", "authentication", "permission", "rate_limit", "quota_exceeded", "server_error", "safety_blocked", "api_key_required"];
  function createStore({ now = Date.now, maxRecords = 20, maxAgeMs = 1800000, maxBytes = 65536 } = {}) {
    let enabled = true, sequence = 0;
    const session = scope.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const records = new Map();
    let expiryTimer;
    function scheduleExpiry() {
      clearTimeout(expiryTimer);
      if (!records.size) return;
      const earliest = Math.min(...[...records.values()].map(r => r.startedMs));
      expiryTimer = setTimeout(() => { prune(); scheduleExpiry(); }, Math.max(1, earliest + maxAgeMs - now()));
      expiryTimer.unref?.();
    }
    const bytes = () => new TextEncoder().encode(JSON.stringify([...records.values()])).length;
    function prune() {
      for (const [id, record] of records) if (now() - record.startedMs >= maxAgeMs) records.delete(id);
      while (records.size && (records.size > maxRecords || bytes() > maxBytes)) records.delete(records.keys().next().value);
    }
    function snapshot() {
      prune();
      return [...records.values()].map(({ startedMs, ...record }) => ({ ...record, messageRoles: [...record.messageRoles] }));
    }
    function begin(input = {}) {
      const requestId = `${session}-${++sequence}`;
      const messages = Array.isArray(input.messages) ? input.messages : [];
      let model = typeof input.model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/.test(input.model) ? input.model : UNKNOWN;
      if ((input.secrets || []).some(secret => secret && model.includes(secret))) model = "REDACTED";
      const record = {
        requestId, startedMs: now(), startedAt: new Date(now()).toISOString(), durationMs: 0,
        provider: choice(input.provider, ["ollama", "gemini"]), model,
        purpose: choice(input.purpose, ["translate", "question", "summarize", "organize"]),
        uiPurpose: choice(input.uiPurpose, ["translate", "question", "summarize", "organize"]),
        uiTranslationLanguage: choice(input.uiTranslationLanguage, ["ja", "en"]),
        translationLanguage: choice(input.translationLanguage, ["ja", "en"]),
        referenceMode: choice(input.referenceMode, ["none", "current-note", "selected-text", "specified-note", "all-notes", "collection"]),
        historyMessageCount: count(input.historyMessageCount), sentMessageCount: messages.length,
        inputCharacters: messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0),
        messageRoles: messages.slice(0, 128).map(m => choice(m.role, ["system", "user", "assistant"])),
        messageRolesTruncated: messages.length > 128,
        httpStatus: UNKNOWN, streamStarted: false, receivedChunks: 0, bodyChunks: 0, bodyCharacters: 0,
        thinkingPresent: false, thinkingCharacters: 0, doneReceived: false, doneCount: 0,
        streamEndedNormally: false, finalAnswerCharacters: UNKNOWN, uiCharacters: UNKNOWN,
        uiApplied: false, staleResponse: false, errorType: UNKNOWN, result: UNKNOWN, finalized: false
      };
      if (enabled) records.set(requestId, record);
      prune();
      scheduleExpiry();
      function update(fn) {
        prune();
        if (!enabled || !records.has(requestId)) return;
        fn(record);
        prune();
      }
      return Object.freeze({
        requestId,
        observe(type, data = {}) {
          update(r => {
            if (r.finalized) return;
            if (type === "http") r.httpStatus = Number.isInteger(data.status) && data.status >= 100 && data.status <= 599 ? data.status : UNKNOWN;
            if (type === "stream-start") r.streamStarted = true;
            if (type === "chunk") r.receivedChunks += 1;
            if (type === "body") { r.bodyChunks += 1; r.bodyCharacters += count(data.characters); }
            if (type === "thinking") { r.thinkingCharacters += count(data.characters); r.thinkingPresent ||= count(data.characters) > 0; }
            if (type === "done") { r.doneReceived = true; r.doneCount += 1; }
            if (type === "stream-end") r.streamEndedNormally = true;
          });
        },
        ui(characters) { update(r => { if (!r.finalized) { r.uiCharacters = count(characters); r.uiApplied = true; } }); },
        finish({ characters, errorCode, stale = false } = {}) {
          update(r => {
            if (r.finalized) return;
            r.finalized = true;
            r.durationMs = Math.max(0, now() - r.startedMs);
            r.finalAnswerCharacters = count(characters);
            r.staleResponse = stale === true;
            r.errorType = choice(errorCode, errorCodes);
            r.result = errorCode === "timeout" ? "TIMEOUT"
              : errorCode === "aborted" || stale ? "INTERRUPTED"
              : errorCode ? "ERROR"
              : !r.streamEndedNormally ? UNKNOWN
              : !r.doneReceived ? "STREAM_ENDED_WITHOUT_DONE"
              : r.finalAnswerCharacters > 0 && r.bodyCharacters > 0 ? "COMPLETED_WITH_TEXT" : "COMPLETED_EMPTY";
          });
        }
      });
    }
    return Object.freeze({ begin, snapshot, exportJson: () => JSON.stringify(snapshot(), null, 2),
      setEnabled(value) { enabled = value === true; if (!enabled) { records.clear(); clearTimeout(expiryTimer); } },
      isEnabled: () => enabled, clear: () => { records.clear(); clearTimeout(expiryTimer); }, prune });
  }
  const api = { createStore };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (scope) scope.MemoNexusAiDiagnostics = api;
})(typeof window !== "undefined" ? window : globalThis);
