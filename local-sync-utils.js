(function initLocalSyncUtils(globalScope) {
  "use strict";

  const MIME_EXTENSIONS = Object.freeze({
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf"
  });

  function contentHash(value) {
    const bytes = new TextEncoder().encode(String(value == null ? "" : value));
    let hash = 2166136261;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function attachmentExtension(attachment) {
    return MIME_EXTENSIONS[String(attachment?.mimeType || attachment?.blob?.type || "").toLowerCase()] || "bin";
  }

  function safeStableNoteFileName(note, sanitize) {
    const title = sanitize(note?.title || "無題のメモ", "無題のメモ", 60);
    const id = String(note?.id || "note").replace(/[^A-Za-z0-9-]/g, "_");
    return `${title}--${id}.md`;
  }

  function normalizeSyncState(value) {
    return {
      formatVersion: 1,
      savedAt: value?.savedAt || null,
      notes: value?.notes && typeof value.notes === "object" ? value.notes : {},
      assets: value?.assets && typeof value.assets === "object" ? value.assets : {},
      excluded: Array.isArray(value?.excluded) ? value.excluded.map(String) : []
    };
  }

  function buildManifest({ appVersion, savedAt, notes, collections, assetsCount }) {
    return {
      formatVersion: 1,
      appVersion,
      savedAt,
      notesCount: (notes || []).length,
      collectionsCount: (collections || []).length,
      assetsCount: Number(assetsCount || 0)
    };
  }

  function serializeCollections(collections) {
    return JSON.stringify((collections || []).map((item) => ({
      id: item.id,
      name: item.name,
      parentId: item.parentId ?? null,
      sortOrder: Number(item.sortOrder || 0),
      isSystem: Boolean(item.isSystem),
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null
    })), null, 2);
  }

  function parseCollections(text) {
    const value = JSON.parse(String(text || "[]"));
    if (!Array.isArray(value)) throw new Error("collections.jsonの形式が不正です");
    return value.filter((item) => item && item.id && item.name).map((item) => ({
      id: String(item.id), name: String(item.name), parentId: item.parentId == null ? null : String(item.parentId),
      sortOrder: Number(item.sortOrder || 0), isSystem: Boolean(item.isSystem), createdAt: item.createdAt || null, updatedAt: item.updatedAt || null
    }));
  }

  function hasExternalModification(lastWrittenHash, currentHash, nextHash) {
    return Boolean(lastWrittenHash && currentHash && currentHash !== lastWrittenHash && currentHash !== nextHash);
  }

  function classifyMarkdownCandidate(candidate, existingNotes, importedHashes = new Set()) {
    const id = candidate?.metadata?.memoNexusId ? String(candidate.metadata.memoNexusId) : "";
    const bodyHash = contentHash(`${candidate?.metadata?.title || ""}\n${candidate?.body || ""}`);
    if (importedHashes.has(bodyHash)) return { type: "duplicate", bodyHash, existing: null };
    const sameId = id ? (existingNotes || []).find((note) => note.id === id) : null;
    if (id && !sameId) return { type: "restore", bodyHash, existing: null };
    if (sameId) {
      const existingHash = contentHash(`${sameId.title || ""}\n${sameId.body || ""}`);
      return { type: existingHash === bodyHash ? "unchanged" : "conflict", bodyHash, existing: sameId };
    }
    const duplicate = (existingNotes || []).find((note) => contentHash(`${note.title || ""}\n${note.body || ""}`) === bodyHash);
    return { type: duplicate ? "duplicate" : "new", bodyHash, existing: duplicate || null };
  }

  const api = {
    MIME_EXTENSIONS, attachmentExtension, buildManifest, classifyMarkdownCandidate, contentHash,
    hasExternalModification, normalizeSyncState, parseCollections, safeStableNoteFileName, serializeCollections
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusLocalSyncUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
