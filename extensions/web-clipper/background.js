if (typeof importScripts === "function") importScripts("image-fetcher.js");

(function (root) {
  const imageFetcher = root.MemoNexusClipImageFetcher
    || (typeof require === "function" ? require("./image-fetcher.js") : null);

  function imageOriginPattern(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "http:" || url.protocol === "https:" ? `${url.origin}/*` : "";
    } catch (_) {
      return "";
    }
  }

  async function fetchImagesForMessage(message, dependencies = {}) {
    const candidates = Array.isArray(message?.candidates) ? message.candidates.slice(0, 20) : [];
    const hasPermission = dependencies.hasPermission || (async (origin) => chrome.permissions.contains({ origins: [origin] }));
    const fetchImages = dependencies.fetchImages || imageFetcher?.fetchClipImages;
    if (typeof fetchImages !== "function") {
      return candidates.map((candidate) => ({ ...candidate, status: "failed", selected: false, error: "画像取得処理を開始できませんでした" }));
    }

    const permissions = await Promise.all(candidates.map(async (candidate) => {
      const origin = imageOriginPattern(candidate.url);
      if (!origin) return false;
      try { return await hasPermission(origin); } catch (_) { return false; }
    }));
    const allowed = candidates.filter((_candidate, index) => permissions[index]);
    let fetched = [];
    try {
      fetched = await fetchImages(allowed, {
        perImageLimit: Math.max(1, Number(message?.options?.perImageLimit) || 5 * 1024 * 1024),
        totalLimit: Math.max(1, Number(message?.options?.totalLimit) || 20 * 1024 * 1024),
        timeoutMs: Math.max(1000, Number(message?.options?.timeoutMs) || 15000)
      });
    } catch (_) {
      fetched = allowed.map((candidate) => ({ ...candidate, status: "failed", selected: false, error: "画像取得処理でエラーが発生しました" }));
    }
    const resultsByToken = new Map(fetched.map((image) => [image.token, image]));
    return candidates.map((candidate, index) => {
      if (!permissions[index]) return { ...candidate, status: "permission-denied", selected: false, error: "この画像ホストへのアクセス権限がありません" };
      return resultsByToken.get(candidate.token)
        || { ...candidate, status: "failed", selected: false, error: "画像取得結果を受信できませんでした" };
    });
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onInstalled.addListener(() => {});
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "memo-nexus-fetch-clip-images") return undefined;
      fetchImagesForMessage(message)
        .then((images) => sendResponse({ ok: true, images }))
        .catch(() => sendResponse({ ok: false, images: [], error: "画像取得処理でエラーが発生しました" }));
      return true;
    });
  }

  const api = { fetchImagesForMessage, imageOriginPattern };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusClipImageService = api;
})(globalThis);
