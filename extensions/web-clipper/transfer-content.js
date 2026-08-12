(() => {
  const id = new URLSearchParams(location.hash.slice(1)).get("clip-transfer");
  const lifecycle = globalThis.MemoNexusClipperTransferLifecycle;
  const key = lifecycle.transferStorageKey(id);
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
