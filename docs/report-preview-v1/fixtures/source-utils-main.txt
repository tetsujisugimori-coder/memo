(function initSourceUtils(globalScope) {
  "use strict";

  const timelineUtils = typeof module !== "undefined" && module.exports
    ? require("./timeline-block-utils.js") : globalScope.MemoNexusTimelineBlockUtils;
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

  function sourceDisplayLabel(source) {
    return [source.title, source.author, source.url].find((value) => typeof value === "string" && value.trim()) || source.id;
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

  function sourceDocumentParts(body) {
    const text = String(body || "");
    if (!text.includes("<!-- memo-nexus:sources-v1:")) return { body: text, sources: [], removedStart: null, removedEnd: null };
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
    if (!candidate) return { body: text, sources: [], removedStart: null, removedEnd: null };
    const before = text.slice(0, candidate.start);
    const removedStart = candidate.hasLineBreak ? candidate.start : candidate.start - (before.match(/\r?\n$/)?.[0].length || 0);
    return {
      body: text.slice(0, removedStart) + text.slice(candidate.end),
      sources: candidate.sources,
      removedStart,
      removedEnd: candidate.end
    };
  }

  function parseSourceDocument(body) {
    const { body: content, sources } = sourceDocumentParts(body);
    return { body: content, sources };
  }

  function sourceSelectionFromRaw(body, start, end) {
    const text = String(body || "");
    const { removedStart, removedEnd } = sourceDocumentParts(text);
    const toBodyOffset = (rawOffset) => {
      const offset = Math.max(0, Math.min(text.length, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0));
      if (removedStart === null || offset <= removedStart) return offset;
      if (offset < removedEnd) return removedStart;
      return offset - (removedEnd - removedStart);
    };
    const first = toBodyOffset(start);
    const last = toBodyOffset(end);
    return { start: Math.min(first, last), end: Math.max(first, last) };
  }

  function insertSourceCitation(body, sourceId, selection) {
    if (typeof sourceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sourceId)) return null;
    const document = parseSourceDocument(body);
    const limit = document.body.length;
    const clamp = (value) => Math.max(0, Math.min(limit, Number.isFinite(value) ? Math.floor(value) : limit));
    const start = clamp(selection?.start);
    const end = Math.max(start, clamp(selection?.end));
    const citation = `[@${sourceId}]`;
    const content = document.body.slice(0, start) + citation + document.body.slice(end);
    return { body: withSources(content, document.sources), caret: start + citation.length };
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

  function extractTextCitations(body) {
    const text = String(body || "").replace(/\r\n?/g, "\n");
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

  function extractGeometryCitations(body) {
    const geometryUtils = typeof module !== "undefined" && module.exports
      ? require("./geometry-block-utils.js") : globalScope.MemoNexusGeometryBlockUtils;
    return geometryUtils.splitGeometryBlocks(body).flatMap((segment) => segment.type === "text"
      ? extractTextCitations(segment.text)
      : [...extractTextCitations(segment.geometry.diagram?.description), ...(segment.geometry.diagram?.citationIds || [])]);
  }

  function extractCitations(body) {
    return timelineUtils.splitTimelineBlocks(parseSourceDocument(body).body).flatMap((segment) => {
      if (segment.type === "text") return extractGeometryCitations(segment.text);
      return segment.timeline.items.flatMap((item) => [...extractTextCitations(item.body), ...item.citationIds]);
    });
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

  const api = { SOURCE_TYPES, sourceDisplayLabel, normalizeSource, normalizeSources, serializeSources, parseSourceMarker,
    parseSourceDocument, sourceSelectionFromRaw, insertSourceCitation, withSources, safeSourceUrl, extractCitations, referencedSources };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusSourceUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
