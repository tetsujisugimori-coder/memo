(function initFigureMetadataUtils(globalScope) {
  "use strict";

  const FIELDS = ["caption", "dateLabel", "sourceName", "sourceUrl", "sourceType", "license", "note"];
  const SOURCE_TYPES = Object.freeze({
    primary: "一次資料",
    secondary: "二次資料",
    "report-created": "本レポート作成図"
  });
  const MARKER_PATTERN = /^<!-- memo-nexus:figure-metadata:([0-9a-f]+) -->$/i;

  function normalizeFigureMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const metadata = Object.fromEntries(FIELDS.map((field) => [field, typeof value[field] === "string" ? value[field] : ""]));
    if (!Object.hasOwn(SOURCE_TYPES, metadata.sourceType)) metadata.sourceType = "";
    return metadata;
  }

  function hasFigureMetadata(value) {
    const metadata = normalizeFigureMetadata(value);
    return Boolean(metadata && FIELDS.some((field) => metadata[field].trim()));
  }

  function serializeFigureMetadata(value) {
    if (!hasFigureMetadata(value)) return "";
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, ...normalizeFigureMetadata(value) }));
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `<!-- memo-nexus:figure-metadata:${hex} -->`;
  }

  function parseFigureMetadata(line) {
    const match = String(line || "").trim().match(MARKER_PATTERN);
    if (!match || match[1].length % 2) return null;
    try {
      const bytes = Uint8Array.from(match[1].match(/../g), (pair) => Number.parseInt(pair, 16));
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return value?.version === 1 && hasFigureMetadata(value) ? normalizeFigureMetadata(value) : null;
    } catch (_) {
      return null;
    }
  }

  function figureSourceTypeLabel(value) {
    return SOURCE_TYPES[value] || "";
  }

  function safeFigureSourceUrl(value) {
    const source = String(value || "").trim();
    if (!/^https?:\/\//i.test(source)) return "";
    try {
      const url = new URL(source);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  const api = { figureSourceTypeLabel, hasFigureMetadata, normalizeFigureMetadata, parseFigureMetadata, safeFigureSourceUrl, serializeFigureMetadata };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusFigureMetadataUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
