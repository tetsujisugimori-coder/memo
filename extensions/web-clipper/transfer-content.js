(() => {
  const id = new URLSearchParams(location.hash.slice(1)).get("clip-transfer");
  const key = id && /^[-a-f0-9]{36}$/i.test(id) ? `memoNexusTransfer:${id}` : "";
  const ttl = 10 * 60 * 1000;
  if (!key) return;
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === "memo-nexus-web-clip-content-ready" && event.data.transferId === id) {
      const stored = (await chrome.storage.local.get(key))[key];
      if (!stored || !stored.clip || Date.now() - stored.createdAt > ttl) {
        if (stored) await chrome.storage.local.remove(key);
        window.postMessage({ type: "memo-nexus-web-clip-transfer-error", transferId: id, code: "expired-or-missing" }, location.origin);
        return;
      }
      window.postMessage({ type: "memo-nexus-web-clip-transfer", transferId: id, clip: stored.clip }, location.origin);
    }
    if (event.data?.type === "memo-nexus-web-clip-transfer-ack" && event.data.transferId === id) await chrome.storage.local.remove(key);
  });
})();
