(function initLocalMarkdown(globalScope) {
  "use strict";

  const FRONT_MATTER_KEYS = [
    "memoNexusId", "title", "collectionId", "createdAt", "localCreatedAt", "updatedAt",
    "bodyUpdatedAt", "localSavedAt", "flagged", "trashed", "deletedAt", "sortOrder",
    "source", "tags", "explanations", "fontSettings", "attachments", "formatVersion"
  ];

  function normalizeTags(value) {
    const normalized = [];
    const seen = new Set();
    (Array.isArray(value) ? value : []).forEach((tag) => {
      if (tag == null) return;
      const next = String(tag).trim().toLowerCase();
      if (!next || seen.has(next)) return;
      seen.add(next);
      normalized.push(next);
    });
    return normalized;
  }

  function yamlScalar(value) {
    if (value == null) return "null";
    if (typeof value === "boolean" || typeof value === "number") return String(value);
    return JSON.stringify(value);
  }

  function parseYamlScalar(value) {
    const source = String(value || "").trim();
    if (source === "null" || source === "~") return null;
    if (source === "true") return true;
    if (source === "false") return false;
    if (/^-?\d+(?:\.\d+)?$/.test(source)) return Number(source);
    if (source.startsWith('"') || source.startsWith("{") || source.startsWith("[")) {
      try { return JSON.parse(source); } catch (_) { return source.slice(1, -1); }
    }
    return source.replace(/^['"]|['"]$/g, "");
  }

  function localNoteMetadata(note, attachments = []) {
    return {
      memoNexusId: note.id,
      title: note.title || "無題のメモ",
      collectionId: note.collectionId || null,
      createdAt: note.createdAt || null,
      localCreatedAt: note.localCreatedAt || null,
      updatedAt: note.updatedAt || null,
      bodyUpdatedAt: note.bodyUpdatedAt || note.updatedAt || null,
      localSavedAt: note.localSavedAt || null,
      flagged: Boolean(note.isFlagged),
      trashed: Boolean(note.deletedAt),
      deletedAt: note.deletedAt || null,
      sortOrder: Number(note.sortOrder || 0),
      source: note.source || null,
      tags: normalizeTags(note.tags),
      explanations: Array.isArray(note.explanations) ? note.explanations : [],
      fontSettings: note.fontSettings || null,
      attachments: (attachments || []).map((attachment) => ({
        id: String(attachment.id || ""),
        fileName: String(attachment.fileName || ""),
        mimeType: String(attachment.mimeType || attachment.blob?.type || "application/octet-stream"),
        kind: attachment.kind || null
      })).filter((attachment) => attachment.id && attachment.fileName),
      formatVersion: 1
    };
  }

  function serializeFrontMatter(metadata) {
    const lines = FRONT_MATTER_KEYS.map((key) => `${key}: ${yamlScalar(metadata[key])}`);
    return `---\n${lines.join("\n")}\n---`;
  }

  function replaceAttachmentReferences(body, attachments) {
    const byId = new Map((attachments || []).map((item) => [String(item.id), item.fileName]));
    return String(body || "").replace(/\(attachment:\/\/([A-Za-z0-9-]+)\)/g, (match, id) => {
      const fileName = byId.get(id);
      return fileName ? `(../assets/${encodeURIComponent(fileName)})` : match;
    });
  }

  function serializeLocalNote(note, body = note?.body || "", attachments = []) {
    return `${serializeFrontMatter(localNoteMetadata(note, attachments))}\n\n${replaceAttachmentReferences(body, attachments)}`;
  }

  function parseFrontMatter(text) {
    const source = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
    if (!source.startsWith("---\n")) return { metadata: {}, body: source };
    const end = source.indexOf("\n---\n", 4);
    if (end === -1) return { metadata: {}, body: source };
    const metadata = {};
    source.slice(4, end).split("\n").forEach((line) => {
      const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
      if (match) metadata[match[1]] = parseYamlScalar(match[2]);
    });
    return { metadata, body: source.slice(end + 5).replace(/^\n/, "") };
  }

  function attachmentPaths(body) {
    const paths = [];
    String(body || "").replace(/!\[[^\]\n]*\]\((\.\.\/assets\/[^)\r\n]+)\)/g, (_, path) => {
      paths.push(decodeURIComponent(path));
      return _;
    });
    return [...new Set(paths)];
  }

  function restoreAttachmentReferences(body, assets = []) {
    const byPath = new Map((assets || []).map((asset) => [String(asset.path), asset.id]));
    return String(body || "").replace(/\((\.\.\/assets\/[^)\r\n]+)\)/g, (match, encodedPath) => {
      const path = decodeURIComponent(encodedPath);
      const id = byPath.get(path);
      return id ? `(attachment://${id})` : match;
    });
  }

  function resolveImportedCreatedAt(metadata, fileLastModified, importedAt = Date.now()) {
    return metadata.localCreatedAt || metadata.createdAt || (fileLastModified ? new Date(fileLastModified).toISOString() : new Date(importedAt).toISOString());
  }

  function parseLocalNote(text, options = {}) {
    const parsed = parseFrontMatter(text);
    parsed.metadata.tags = normalizeTags(parsed.metadata.tags);
    return {
      metadata: parsed.metadata,
      body: restoreAttachmentReferences(parsed.body, options.assets),
      assetPaths: attachmentPaths(parsed.body),
      displayedCreatedAt: resolveImportedCreatedAt(parsed.metadata, options.fileLastModified, options.importedAt)
    };
  }

  const api = {
    FRONT_MATTER_KEYS, attachmentPaths, localNoteMetadata, parseFrontMatter, parseLocalNote,
    replaceAttachmentReferences, resolveImportedCreatedAt, restoreAttachmentReferences,
    serializeFrontMatter, serializeLocalNote
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusLocalMarkdown = api;
})(typeof window !== "undefined" ? window : globalThis);
