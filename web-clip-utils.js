(function (root) {
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
      selection: cleanText(input.selection, 100000),
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

  const api = { safeExternalUrl, normalizeWebClip, buildWebClipMarkdown };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusWebClipUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
