(function (root) {
  const TRANSFER_STORAGE_PREFIX = "memoNexusTransfer:";
  const TRANSFER_TTL_MS = 10 * 60 * 1000;

  function transferStorageKey(id) {
    return /^[-a-f0-9]{36}$/i.test(String(id || "")) ? `${TRANSFER_STORAGE_PREFIX}${id}` : "";
  }

  function isActiveTransferRecord(value, now = Date.now()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const clip = value.clip;
    if (!clip || typeof clip !== "object" || Array.isArray(clip)
      || typeof clip.title !== "string" || !clip.title.trim()
      || !/^https?:\/\//i.test(String(clip.url || ""))
      || typeof clip.host !== "string" || !clip.host.trim()
      || typeof clip.selection !== "string"
      || !Number.isFinite(Date.parse(clip.capturedAt))) return false;
    if (typeof value.createdAt !== "number") return false;
    const createdAt = value.createdAt;
    const age = Number(now) - createdAt;
    return Number.isFinite(createdAt) && Number.isFinite(age) && createdAt > 0 && age >= 0 && age <= TRANSFER_TTL_MS;
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

  const api = { TRANSFER_STORAGE_PREFIX, TRANSFER_TTL_MS, inspectTransferEntries, isActiveTransferRecord, transferStorageKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusClipperTransferLifecycle = api;
})(globalThis);
