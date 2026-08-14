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

  function managedNoteForPath(syncState, path) {
    const normalizedPath = String(path || "").replace(/\\/g, "/");
    return Object.entries(normalizeSyncState(syncState).notes).find(([, value]) => (
      value?.fileName && normalizedPath === `notes/${value.fileName}`
    )) || null;
  }

  function classifyManagedMarkdownHashes(lastWrittenHash, currentLocalHash, nextAppHash) {
    if (!lastWrittenHash) return "unmanaged";
    if (currentLocalHash === lastWrittenHash) {
      return currentLocalHash === nextAppHash ? "last-written" : "app-ahead";
    }
    if (currentLocalHash === nextAppHash) return "app-current";
    return "conflict";
  }

  async function buildLocalScanAnalysis({
    files = [], syncState, notes = [], parseNote, serializeNote,
    getAttachmentsForNote = async () => []
  } = {}) {
    const normalizedSync = normalizeSyncState(syncState);
    const excluded = new Set(normalizedSync.excluded);
    const candidates = [];
    const appAheadNoteIds = [];
    for (const entry of files) {
      if (excluded.has(entry.path)) continue;
      const source = await entry.file.text();
      const firstPass = parseNote(source, { fileLastModified: entry.file.lastModified });
      const assetMappings = firstPass.assetPaths.map((path) => {
        const fileName = path.split("/").pop();
        const known = Object.entries(normalizedSync.assets).find(([, value]) => value.fileName === fileName);
        return known ? { path, id: known[0] } : null;
      }).filter(Boolean);
      const parsed = parseNote(source, { fileLastModified: entry.file.lastModified, assets: assetMappings });
      const managedEntry = managedNoteForPath(normalizedSync, entry.path);
      if (managedEntry) {
        const [managedNoteId, managedState] = managedEntry;
        const managedNote = notes.find((note) => note.id === managedNoteId);
        if (!managedNote) {
          candidates.push({
            ...entry,
            parsed: { ...parsed, metadata: { ...parsed.metadata, memoNexusId: managedNoteId } },
            classification: {
              type: "restore",
              existing: null,
              bodyHash: contentHash(`${parsed.metadata.title || ""}\n${parsed.body || ""}`)
            }
          });
          continue;
        }
        if (managedState.hash) {
          const noteAttachments = await getAttachmentsForNote(managedNote.id);
          const attachmentFiles = noteAttachments.map((attachment) => ({
            id: attachment.id,
            fileName: normalizedSync.assets[attachment.id]?.fileName || `${attachment.id}.${attachmentExtension(attachment)}`
          }));
          const nextAppHash = contentHash(serializeNote(managedNote, managedNote.body, attachmentFiles));
          const currentLocalHash = contentHash(source);
          const disposition = classifyManagedMarkdownHashes(managedState.hash, currentLocalHash, nextAppHash);
          if (disposition === "app-ahead") appAheadNoteIds.push(managedNoteId);
          if (disposition !== "conflict") continue;
          candidates.push({
            ...entry,
            parsed,
            classification: {
              type: "conflict",
              existing: managedNote,
              bodyHash: contentHash(`${parsed.metadata.title || ""}\n${parsed.body || ""}`),
              lastWrittenHash: managedState.hash,
              currentLocalHash,
              nextAppHash
            }
          });
          continue;
        }
      }
      const classification = classifyMarkdownCandidate(parsed, notes);
      if (classification.type === "unchanged") continue;
      candidates.push({ ...entry, parsed, classification });
    }
    return {
      candidates,
      appAheadNoteIds,
      needsLocalSave: appAheadNoteIds.length > 0
    };
  }

  async function buildLocalScanCandidates(options = {}) {
    return (await buildLocalScanAnalysis(options)).candidates;
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
    MIME_EXTENSIONS, attachmentExtension, buildLocalScanAnalysis, buildLocalScanCandidates, buildManifest, classifyManagedMarkdownHashes,
    classifyMarkdownCandidate, contentHash, hasExternalModification, managedNoteForPath,
    normalizeSyncState, parseCollections, safeStableNoteFileName, serializeCollections
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusLocalSyncUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
