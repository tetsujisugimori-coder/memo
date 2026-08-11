(() => {
  const id = new URLSearchParams(location.hash.slice(1)).get("clip-transfer");
  const key = id && /^[-a-f0-9]{36}$/i.test(id) ? `memoNexusTransfer:${id}` : "";
  const ttl = 10 * 60 * 1000;
  if (!key) return;
  let timer = 0;
  let attempts = 0;
  let delivered = false;
  async function transfer() {
    if (delivered || attempts++ >= 30) {
      if (timer) clearInterval(timer);
      if (!delivered) window.postMessage({ type: "memo-nexus-web-clip-transfer-error", transferId: id, code: "timeout" }, location.origin);
      return;
    }
    const stored = (await chrome.storage.local.get(key))[key];
    if (!stored || !stored.clip || Date.now() - stored.createdAt > ttl) {
      if (stored) await chrome.storage.local.remove(key);
      if (timer) clearInterval(timer);
      window.postMessage({ type: "memo-nexus-web-clip-transfer-error", transferId: id, code: "expired-or-missing" }, location.origin);
      return;
    }
    window.postMessage({ type: "memo-nexus-web-clip-transfer", transferId: id, clip: stored.clip }, location.origin);
  }
  timer = setInterval(() => { transfer().catch(() => {}); }, 400);
  transfer().catch(() => {});
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === "memo-nexus-web-clip-transfer-ack" && event.data.transferId === id) { delivered = true; clearInterval(timer); await chrome.storage.local.remove(key); }
  });
})();
