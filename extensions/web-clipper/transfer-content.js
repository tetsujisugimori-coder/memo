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
  installRetryBridge();
  const lifecycle = globalThis.MemoNexusClipperTransferLifecycle;
  const bridgeApi = globalThis.MemoNexusClipperTransferBridge;
  if (!lifecycle || !bridgeApi) return;
  const fragment = new URLSearchParams(location.hash.slice(1));
  const hasFragmentId = fragment.has("clip-transfer");
  const fragmentId = fragment.get("clip-transfer");
  let sessionId = "";
  try { sessionId = sessionStorage.getItem(lifecycle.TRANSFER_SESSION_STORAGE_KEY) || ""; } catch (_) {}
  const id = hasFragmentId
    ? lifecycle.isTransferId(fragmentId) ? fragmentId : ""
    : lifecycle.isTransferId(sessionId) ? sessionId : "";
  if (hasFragmentId && !id) {
    try { sessionStorage.removeItem(lifecycle.TRANSFER_SESSION_STORAGE_KEY); } catch (_) {}
  }
  if (!id) return;
  try { sessionStorage.setItem(lifecycle.TRANSFER_SESSION_STORAGE_KEY, id); } catch (_) {}

  const bridge = bridgeApi.createTransferBridge({
    transferId: id,
    lifecycle,
    extensionVersion: chrome.runtime.getManifest().version,
    read: async (key) => (await chrome.storage.local.get(key))[key],
    remove: async (key) => chrome.storage.local.remove(key),
    post: (message) => window.postMessage(message, location.origin),
    clearSession: () => {
      try {
        if (sessionStorage.getItem(lifecycle.TRANSFER_SESSION_STORAGE_KEY) === id) sessionStorage.removeItem(lifecycle.TRANSFER_SESSION_STORAGE_KEY);
      } catch (_) {}
    },
    log: (diagnostics) => console.info("Memo-Nexus Web Clipper transfer", diagnostics)
  });
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    await bridge.handleMessage(event.data).catch(() => {});
  });
  window.addEventListener("pagehide", bridge.stop, { once: true });
  bridge.start();
})();
