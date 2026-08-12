(function (root) {
  const MAX_WEB_CLIP_SELECTION_LENGTH = 100000;
  const MAX_WEB_CLIP_PAGE_LENGTH = 500000;
  const MAX_WEB_CLIP_FRAGMENT_LENGTH = 600000;
  const MAX_WEB_CLIP_IMAGES = 20;
  const MAX_WEB_CLIP_IMAGE_BYTES = 5 * 1024 * 1024;
  const WEB_CLIP_IMAGE_MARKER_PATTERN = /<!-- memo-nexus:web-clip-image:(web-clip-image-[1-9][0-9]*) -->/g;
  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function cleanText(value, limit) {
    return String(value || "").replace(/\u0000/g, "").trim().slice(0, limit);
  }

  function normalizeWebClipImage(value, index) {
    const input = value && typeof value === "object" ? value : {};
    const token = /^web-clip-image-[1-9][0-9]*$/.test(String(input.token || ""))
      ? String(input.token)
      : `web-clip-image-${index + 1}`;
    const status = ["ready", "failed", "unsupported", "too-large"].includes(input.status) ? input.status : "failed";
    const supportedMimeType = ["image/jpeg", "image/png", "image/webp"].includes(input.mimeType);
    const mimeType = supportedMimeType ? input.mimeType : cleanText(input.mimeType, 100);
    const size = Math.max(0, Number(input.size) || 0);
    const dataBase64 = status === "ready" && typeof input.dataBase64 === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64)
      ? input.dataBase64.slice(0, Math.ceil(MAX_WEB_CLIP_IMAGE_BYTES / 3) * 4 + 8)
      : "";
    const resolvedStatus = status === "ready" && !supportedMimeType
      ? "unsupported"
      : status === "ready" && (!dataBase64 || !size || size > MAX_WEB_CLIP_IMAGE_BYTES) ? "failed" : status;
    return {
      token,
      url: safeExternalUrl(input.url),
      alt: cleanText(input.alt, 500),
      caption: cleanText(input.caption, 500),
      width: Math.max(0, Number(input.width) || 0),
      height: Math.max(0, Number(input.height) || 0),
      status: resolvedStatus,
      error: cleanText(input.error, 500),
      mimeType,
      size,
      fileName: cleanText(input.fileName, 140),
      dataBase64,
      selected: input.selected !== false && resolvedStatus === "ready"
    };
  }

  function normalizeWebClip(value) {
    const input = value && typeof value === "object" ? value : {};
    const url = safeExternalUrl(input.url);
    const clipMode = ["selection", "page", "link", "memo"].includes(input.clipMode) ? input.clipMode : "selection";
    const images = clipMode === "page" || clipMode === "selection"
      ? (Array.isArray(input.images) ? input.images : []).slice(0, MAX_WEB_CLIP_IMAGES).map(normalizeWebClipImage)
      : [];
    return {
      title: cleanText(input.title, 300),
      url,
      host: cleanText(input.host, 255),
      clipMode,
      userMemo: cleanText(input.userMemo, 1000),
      selection: cleanText(input.selection, input.clipMode === "page" ? MAX_WEB_CLIP_PAGE_LENGTH : MAX_WEB_CLIP_SELECTION_LENGTH),
      capturedAt: Number.isFinite(Date.parse(input.capturedAt)) ? new Date(input.capturedAt).toISOString() : new Date().toISOString(),
      images,
      omittedImageCount: Math.max(0, Math.floor(Number(input.omittedImageCount) || 0))
    };
  }

  function quoteMarkdown(value) {
    const text = String(value || "").replace(/\r\n?/g, "\n").trim();
    return text ? text.split("\n").map((line) => `> ${line}`).join("\n") : "";
  }

  function quoteMarkdownPreservingImageMarkers(value) {
    const source = String(value || "").replace(/\r\n?/g, "\n");
    const parts = source.split(WEB_CLIP_IMAGE_MARKER_PATTERN);
    return parts.map((part, index) => {
      if (index % 2 === 1) return `<!-- memo-nexus:web-clip-image:${part} -->`;
      return quoteMarkdown(part);
    }).filter(Boolean).join("\n\n");
  }

  function webClipImageFailureMarkdown(image, reason = "画像を取得できませんでした") {
    const label = cleanText(image?.alt || image?.caption || "画像", 120).replace(/[\r\n]+/g, " ");
    const detail = cleanText(reason || image?.error, 180).replace(/[\r\n]+/g, " ");
    return `> 画像を保存できませんでした: ${label}${detail ? `（${detail}）` : ""}`;
  }

  function replaceWebClipImageMarkers(markdown, replacements = new Map(), images = []) {
    const imageMap = new Map((Array.isArray(images) ? images : []).map((image) => [image.token, image]));
    return String(markdown || "").replace(WEB_CLIP_IMAGE_MARKER_PATTERN, (_match, token) => {
      if (replacements instanceof Map && replacements.has(token)) return replacements.get(token) || "";
      const replacement = replacements && !(replacements instanceof Map) ? replacements[token] : undefined;
      if (replacement !== undefined) return replacement || "";
      const image = imageMap.get(token);
      return image && image.status !== "ready" ? webClipImageFailureMarkdown(image, image.error) : "";
    }).replace(/\n{3,}/g, "\n\n").trim();
  }

  function buildWebClipMarkdown(clip) {
    const normalized = normalizeWebClip(clip);
    const lines = [];
    const quote = normalized.clipMode === "page" ? normalized.selection : quoteMarkdownPreservingImageMarkers(normalized.selection);
    if (quote) lines.push(quote, "");
    if (normalized.userMemo) lines.push(`メモ: ${normalized.userMemo}`, "");
    if (normalized.title) lines.push(`出典: ${normalized.title}`);
    if (normalized.url) lines.push(`URL: [${normalized.url}](${normalized.url})`);
    lines.push(`取得日時: ${normalized.capturedAt}`);
    return lines.join("\n");
  }

  function isValidWebClipInput(value) {
    if (!value || typeof value !== "object") return false;
    if (typeof value.title !== "string" || !value.title.trim()) return false;
    if (!safeExternalUrl(value.url)) return false;
    if (typeof value.host !== "string" || !value.host.trim()) return false;
    const mode = ["selection", "page", "link", "memo"].includes(value.clipMode) ? value.clipMode : "selection";
    if (typeof value.selection !== "string" || value.selection.length > (mode === "page" ? MAX_WEB_CLIP_PAGE_LENGTH : MAX_WEB_CLIP_SELECTION_LENGTH)) return false;
    if (value.images && (!Array.isArray(value.images) || value.images.length > MAX_WEB_CLIP_IMAGES)) return false;
    return Number.isFinite(Date.parse(value.capturedAt));
  }

  function encodeUtf8Base64Url(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodeUtf8Base64Url(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > MAX_WEB_CLIP_FRAGMENT_LENGTH) throw new Error("invalid payload");
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function encodeWebClipPayload(value) {
    if (!isValidWebClipInput(value)) throw new Error("invalid clip");
    const payload = encodeUtf8Base64Url(JSON.stringify(normalizeWebClip(value)));
    if (payload.length > MAX_WEB_CLIP_FRAGMENT_LENGTH) throw new Error("clip too large");
    return payload;
  }

  function decodeWebClipPayload(value) {
    try {
      const input = JSON.parse(decodeUtf8Base64Url(value));
      if (!isValidWebClipInput(input)) return null;
      return normalizeWebClip(input);
    } catch (_) {
      return null;
    }
  }

  function readWebClipFragment(hash) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    if (!params.has("clip")) return { present: false, clip: null };
    return { present: true, clip: decodeWebClipPayload(params.get("clip")) };
  }

  const api = {
    MAX_WEB_CLIP_SELECTION_LENGTH,
    MAX_WEB_CLIP_PAGE_LENGTH,
    MAX_WEB_CLIP_FRAGMENT_LENGTH,
    MAX_WEB_CLIP_IMAGES,
    MAX_WEB_CLIP_IMAGE_BYTES,
    safeExternalUrl,
    normalizeWebClip,
    buildWebClipMarkdown,
    replaceWebClipImageMarkers,
    webClipImageFailureMarkdown,
    encodeWebClipPayload,
    decodeWebClipPayload,
    readWebClipFragment
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusWebClipUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
