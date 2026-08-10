(function (root) {
  const MAX_WEB_CLIP_SELECTION_LENGTH = 100000;
  const MAX_WEB_CLIP_FRAGMENT_LENGTH = 600000;
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

  function normalizeWebClip(value) {
    const input = value && typeof value === "object" ? value : {};
    const url = safeExternalUrl(input.url);
    return {
      title: cleanText(input.title, 300),
      url,
      host: cleanText(input.host, 255),
      selection: cleanText(input.selection, MAX_WEB_CLIP_SELECTION_LENGTH),
      capturedAt: Number.isFinite(Date.parse(input.capturedAt)) ? new Date(input.capturedAt).toISOString() : new Date().toISOString()
    };
  }

  function quoteMarkdown(value) {
    const text = String(value || "").replace(/\r\n?/g, "\n").trim();
    return text ? text.split("\n").map((line) => `> ${line}`).join("\n") : "";
  }

  function buildWebClipMarkdown(clip) {
    const normalized = normalizeWebClip(clip);
    const lines = [];
    const quote = quoteMarkdown(normalized.selection);
    if (quote) lines.push(quote, "");
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
    if (typeof value.selection !== "string" || value.selection.length > MAX_WEB_CLIP_SELECTION_LENGTH) return false;
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

  const api = { MAX_WEB_CLIP_SELECTION_LENGTH, MAX_WEB_CLIP_FRAGMENT_LENGTH, safeExternalUrl, normalizeWebClip, buildWebClipMarkdown, encodeWebClipPayload, decodeWebClipPayload, readWebClipFragment };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusWebClipUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
