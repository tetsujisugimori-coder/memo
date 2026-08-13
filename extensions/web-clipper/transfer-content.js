(() => {
  function installRetryBridge() {
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== "memo-nexus-web-clip-retry-images") return;
      const requestId = String(event.data.requestId || "");
      const candidates = Array.isArray(event.data.candidates) ? event.data.candidates.slice(0, 20).filter((candidate) => /^https?:\/\//i.test(String(candidate?.url || ""))) : [];
      if (!requestId || !candidates.length) return;
      chrome.runtime.sendMessage({ type: "memo-nexus-fetch-clip-images", requestId, candidates }, (response) => {
        const error = chrome.runtime.lastError;
        window.postMessage({ type: "memo-nexus-web-clip-retry-images-result", requestId, ok: !error && response?.ok, images: response?.images || [], error: error?.message || response?.error || "画像を再取得できませんでした" }, location.origin);
      });
    });
  }
  const id = new URLSearchParams(location.hash.slice(1)).get("clip-transfer");
  const lifecycle = globalThis.MemoNexusClipperTransferLifecycle;
  const key = lifecycle.transferStorageKey(id);
  installRetryBridge();
  if (!key) return;
  let timer = 0;
  let attempts = 0;
  let delivered = false;
  let finished = false;
  async function fail(code) {
    if (delivered || finished) return;
    finished = true;
    if (timer) clearInterval(timer);
    try {
      await chrome.storage.local.remove(key);
    } finally {
      window.postMessage({ type: "memo-nexus-web-clip-transfer-error", transferId: id, code }, location.origin);
    }
  }
  async function transfer() {
    if (delivered || finished) return;
    if (attempts++ >= 30) return fail("timeout");
    const stored = (await chrome.storage.local.get(key))[key];
    if (!lifecycle.isActiveTransferRecord(stored)) return fail("expired-or-missing");
    window.postMessage({ type: "memo-nexus-web-clip-transfer", transferId: id, clip: stored.clip }, location.origin);
  }
  timer = setInterval(() => { transfer().catch(() => {}); }, 400);
  transfer().catch(() => {});
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === "memo-nexus-web-clip-transfer-ack" && event.data.transferId === id) { delivered = true; finished = true; clearInterval(timer); await chrome.storage.local.remove(key); }
  });
})();
