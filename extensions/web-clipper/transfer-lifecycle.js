(function (root) {
  const TRANSFER_STORAGE_PREFIX = "memoNexusTransfer:";
  const TRANSFER_SESSION_STORAGE_KEY = "memoNexusPendingClipTransferId";
  const TRANSFER_TTL_MS = 10 * 60 * 1000;
  const TRANSFER_MESSAGE_TYPES = {
    CONTENT_READY: "memo-nexus-web-clip-content-ready",
    RECEIVER_READY: "memo-nexus-web-clip-receiver-ready",
    PAYLOAD: "memo-nexus-web-clip-transfer",
    ACK: "memo-nexus-web-clip-transfer-ack",
    ACK_CONFIRMED: "memo-nexus-web-clip-transfer-ack-confirmed",
    ERROR: "memo-nexus-web-clip-transfer-error",
    RETRY: "memo-nexus-web-clip-transfer-retry",
    CANCEL: "memo-nexus-web-clip-transfer-cancel",
    CANCEL_CONFIRMED: "memo-nexus-web-clip-transfer-cancel-confirmed"
  };

  function isTransferId(id) {
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(id || ""));
  }

  function transferStorageKey(id) {
    return isTransferId(id) ? `${TRANSFER_STORAGE_PREFIX}${id}` : "";
  }

  function validateTransferRecord(value, now = Date.now()) {
    if (value === undefined || value === null) return { ok: false, code: "record_missing" };
    if (typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "record_invalid" };
    if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt) || value.createdAt <= 0) return { ok: false, code: "created_at_missing" };
    const age = Number(now) - value.createdAt;
    if (!Number.isFinite(age)) return { ok: false, code: "created_at_invalid" };
    if (age < 0) return { ok: false, code: "created_at_future" };
    if (age > TRANSFER_TTL_MS) return { ok: false, code: "transfer_expired" };
    const clip = value.clip;
    if (!clip || typeof clip !== "object" || Array.isArray(clip)) return { ok: false, code: "clip_invalid" };
    if (typeof clip.title !== "string" || !clip.title.trim()) return { ok: false, code: "title_invalid" };
    if (!/^https?:\/\//i.test(String(clip.url || ""))) return { ok: false, code: "url_invalid" };
    if (typeof clip.host !== "string" || !clip.host.trim()) return { ok: false, code: "host_invalid" };
    if (typeof clip.selection !== "string") return { ok: false, code: "selection_invalid" };
    if (!Number.isFinite(Date.parse(clip.capturedAt))) return { ok: false, code: "captured_at_invalid" };
    return { ok: true, code: "ok" };
  }

  function isActiveTransferRecord(value, now = Date.now()) {
    return validateTransferRecord(value, now).ok;
  }

  function isTerminalTransferRecordError(code) {
    return !["ok", "record_missing", "storage_unavailable", "ack_timeout"].includes(String(code || ""));
  }

  function inspectTransferEntries(stored, now = Date.now()) {
    const invalidKeys = [];
    const activeKeys = [];
    Object.entries(stored && typeof stored === "object" ? stored : {}).forEach(([key, value]) => {
      if (!key.startsWith(TRANSFER_STORAGE_PREFIX)) return;
      (isActiveTransferRecord(value, now) ? activeKeys : invalidKeys).push(key);
    });
    return { activeKeys, invalidKeys, hasActiveTransfer: activeKeys.length > 0 };
  }

  const api = {
    TRANSFER_SESSION_STORAGE_KEY,
    TRANSFER_MESSAGE_TYPES,
    TRANSFER_STORAGE_PREFIX,
    TRANSFER_TTL_MS,
    inspectTransferEntries,
    isActiveTransferRecord,
    isTerminalTransferRecordError,
    isTransferId,
    transferStorageKey,
    validateTransferRecord
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusClipperTransferLifecycle = api;
})(globalThis);
