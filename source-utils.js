(function initSourceUtils(globalScope) {
  "use strict";

  const FIELDS = ["title", "author", "publisher", "date", "url", "accessedAt", "page", "sourceType"];
  const SOURCE_TYPES = Object.freeze({ primary: "一次資料", secondary: "二次資料", "report-created": "本レポート作成図" });
  const MARKER = /^<!-- memo-nexus:sources-v1:([0-9a-f]+) -->$/i;
  const CITATION = /\[@([A-Za-z0-9_-]{1,128})\]/g;

  function normalizeSource(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id)) return null;
    const source = { id: value.id };
    FIELDS.forEach((field) => { source[field] = typeof value[field] === "string" ? value[field] : ""; });
    if (!Object.hasOwn(SOURCE_TYPES, source.sourceType)) source.sourceType = "";
    return source;
  }

  function normalizeSources(values) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    return values.map(normalizeSource).filter((source) => {
      if (!source || seen.has(source.id)) return false;
      seen.add(source.id);
      return true;
    });
  }

  function serializeSources(values) {
    const sources = normalizeSources(values);
    if (!sources.length) return "";
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, sources }));
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `<!-- memo-nexus:sources-v1:${hex} -->`;
  }

  function parseSourceMarker(line) {
    const match = String(line || "").trim().match(MARKER);
    if (!match || match[1].length % 2) return null;
    try {
      const bytes = Uint8Array.from(match[1].match(/../g), (pair) => Number.parseInt(pair, 16));
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return value?.version === 1 && Array.isArray(value.sources) ? normalizeSources(value.sources) : null;
    } catch (_) { return null; }
  }

  function parseSourceDocument(body) {
    const text = String(body || "");
    if (!text.includes("<!-- memo-nexus:sources-v1:")) return { body: text, sources: [] };
    // Keep the final valid record even if the user writes more Markdown below it.
    let candidate = null;
    let offset = 0;
    for (const line of text.match(/[^\n]*(?:\n|$)/g) || []) {
      if (!line) continue;
      const content = line.replace(/\r?\n$/, "");
      const sources = parseSourceMarker(content);
      if (sources !== null) candidate = { start: offset, end: offset + line.length, sources, hasLineBreak: line !== content };
      offset += line.length;
    }
    if (!candidate) return { body: text, sources: [] };
    const before = text.slice(0, candidate.start);
    return {
      body: (candidate.hasLineBreak ? before : before.replace(/\r?\n$/, "")) + text.slice(candidate.end),
      sources: candidate.sources
    };
  }

  function withSources(body, values) {
    const content = parseSourceDocument(body).body;
    const marker = serializeSources(values);
    return marker ? `${content}\n${marker}` : content;
  }

  function safeSourceUrl(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!/^https?:\/\//i.test(text)) return "";
    try {
      const url = new URL(text);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (_) { return ""; }
  }

  function extractCitations(body) {
    const text = parseSourceDocument(body).body.replace(/\r\n?/g, "\n");
    const ids = [];
    let inFence = false;
    for (const line of text.split("\n")) {
      if (/^```\s*[^`]*$/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      let plain = "";
      let inCode = false;
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === "`" && (i === 0 || line[i - 1] !== "\\")) { inCode = !inCode; plain += " "; }
        else plain += inCode ? " " : line[i];
      }
      for (const match of plain.matchAll(CITATION)) ids.push(match[1]);
    }
    return ids;
  }

  function referencedSources(body, values) {
    const byId = new Map(normalizeSources(values).map((source) => [source.id, source]));
    const seen = new Set();
    return extractCitations(body).map((id) => byId.get(id)).filter((source) => {
      if (!source || seen.has(source.id)) return false;
      seen.add(source.id);
      return true;
    });
  }

  const api = { SOURCE_TYPES, normalizeSource, normalizeSources, serializeSources, parseSourceMarker,
    parseSourceDocument, withSources, safeSourceUrl, extractCitations, referencedSources };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusSourceUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
