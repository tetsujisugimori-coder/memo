"use strict";

(function attachNoteFlagUtils(global) {
  const EXPORT_PREFIX = "<!-- memo-nexus-note:";
  const EXPORT_SUFFIX = " -->";

  function normalizeIsFlagged(value) { return value === true; }
  function withNormalizedFlag(note) { return { ...note, isFlagged: normalizeIsFlagged(note?.isFlagged) }; }
  function serializeNoteForMarkdown(note, body, { includeTitle = false } = {}) {
    const metadata = `${EXPORT_PREFIX}${JSON.stringify({ isFlagged: normalizeIsFlagged(note?.isFlagged) })}${EXPORT_SUFFIX}`;
    const content = String(body == null ? "" : body);
    return `${metadata}\n\n${includeTitle ? `# ${note?.title || "無題のメモ"}\n\n` : ""}${content}`;
  }
  function parseFlaggedMarkdown(text) {
    const source = String(text == null ? "" : text);
    const match = source.match(/^<!-- memo-nexus-note:(\{[^\n]*\}) -->\s*(?:\r?\n)?/);
    if (!match) return { body: source, isFlagged: false };
    try {
      const metadata = JSON.parse(match[1]);
      return { body: source.slice(match[0].length).replace(/^\r?\n/, ""), isFlagged: normalizeIsFlagged(metadata?.isFlagged) };
    } catch (_) { return { body: source, isFlagged: false }; }
  }
  const api = { normalizeIsFlagged, parseFlaggedMarkdown, serializeNoteForMarkdown, withNormalizedFlag };
  global.MemoNexusNoteFlagUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
