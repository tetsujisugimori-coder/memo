if (typeof importScripts === "function") importScripts("image-fetcher.js");

(function (root) {
  const imageFetcher = root.MemoNexusClipImageFetcher
    || (typeof require === "function" ? require("./image-fetcher.js") : null);
  let creatingOffscreenDocument = null;

  function imageOriginPattern(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "http:" || url.protocol === "https:" ? `${url.origin}/*` : "";
    } catch (_) { return ""; }
  }

  function terminalFailure(candidate, status, errorCode, error) {
    return { ...candidate, status, selected: false, dataBase64: "", errorCode, error };
  }

  async function hasOffscreenDocument() {
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL("offscreen.html")] });
      return contexts.length > 0;
    }
    const clients = await self.clients.matchAll();
    return clients.some((client) => client.url === chrome.runtime.getURL("offscreen.html"));
  }

  async function ensureOffscreenDocument() {
    if (await hasOffscreenDocument()) return;
    if (!creatingOffscreenDocument) {
      creatingOffscreenDocument = chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["BLOBS"],
        justification: "SVGとAVIFをスクリプトを実行しないローカル画像へ変換します"
      }).finally(() => { creatingOffscreenDocument = null; });
    }
    await creatingOffscreenDocument;
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve(response);
      });
    });
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
  }

  async function convertImageOffscreen({ bytes, mimeType, candidate }) {
    await ensureOffscreenDocument();
    const requestId = crypto.randomUUID();
    const response = await sendRuntimeMessage({
      type: "memo-nexus-convert-clip-image",
      requestId,
      mimeType,
      dataBase64: bytesToBase64(bytes),
      sourceUrl: candidate?.url || ""
    });
    if (response?.requestId !== requestId) throw new Error("画像変換の応答IDが一致しません");
    if (!response?.ok) throw new Error(response?.error || "画像を安全な形式へ変換できません");
    return response;
  }

  async function fetchImagesForMessage(message, dependencies = {}) {
    const candidates = Array.isArray(message?.candidates)
      ? message.candidates.slice(0, 20)
      : message?.candidate ? [message.candidate] : [];
    const hasPermission = dependencies.hasPermission || (async (origin) => chrome.permissions.contains({ origins: [origin] }));
    const fetchImages = dependencies.fetchImages || imageFetcher?.fetchClipImages;
    if (typeof fetchImages !== "function") return candidates.map((candidate) => terminalFailure(candidate, "failed", "FETCHER_UNAVAILABLE", "画像取得処理を開始できませんでした"));

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
        timeoutMs: Math.max(1000, Number(message?.options?.timeoutMs) || 15000),
        concurrency: Math.min(3, Math.max(1, Number(message?.options?.concurrency) || 3)),
        convertImage: dependencies.convertImage || convertImageOffscreen
      });
    } catch (error) {
      fetched = allowed.map((candidate) => terminalFailure(candidate, "failed", "FETCH_PIPELINE_ERROR", error?.message || "画像取得処理でエラーが発生しました"));
    }
    const resultsByToken = new Map(fetched.map((image) => [image.token, image]));
    return candidates.map((candidate, index) => {
      if (!permissions[index]) return terminalFailure(candidate, "permission-denied", "PERMISSION_DENIED", "この画像ホストへのアクセス権限がありません");
      return resultsByToken.get(candidate.token)
        || terminalFailure(candidate, "failed", "RESPONSE_MISSING", "画像取得結果を受信できませんでした");
    });
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onInstalled.addListener(() => {});
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "memo-nexus-fetch-clip-images" && message?.type !== "memo-nexus-fetch-clip-image") return undefined;
      const requestId = String(message?.requestId || "");
      fetchImagesForMessage(message)
        .then((images) => sendResponse({ ok: true, requestId, images }))
        .catch((error) => sendResponse({ ok: false, requestId, images: [], errorCode: "SERVICE_WORKER_ERROR", error: error?.message || "画像取得処理でエラーが発生しました" }));
      return true;
    });
  }

  const api = { fetchImagesForMessage, imageOriginPattern, terminalFailure };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusClipImageService = api;
})(globalThis);
