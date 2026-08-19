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

  function managedMarkdownComparableHash(markdown) {
    const source = String(markdown == null ? "" : markdown);
    const firstLineEnd = source.indexOf("\n");
    if (firstLineEnd === -1 || source.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") {
      return contentHash(source);
    }
    let lineStart = firstLineEnd + 1;
    while (lineStart < source.length) {
      const nextLineEnd = source.indexOf("\n", lineStart);
      const lineEnd = nextLineEnd === -1 ? source.length : nextLineEnd;
      const line = source.slice(lineStart, lineEnd).replace(/\r$/, "");
      if (line === "---") break;
      if (/^localSavedAt:\s*/.test(line)) {
        const afterLine = nextLineEnd === -1 ? source.length : nextLineEnd + 1;
        return contentHash(`${source.slice(0, lineStart)}${source.slice(afterLine)}`);
      }
      if (nextLineEnd === -1) break;
      lineStart = nextLineEnd + 1;
    }
    return contentHash(source);
  }

  function normalizedLocalPath(path) {
    return String(path || "").replace(/\\/g, "/");
  }

  function localConflictResolutionPaths({ candidatePath, managedFileName } = {}) {
    const confirmedPath = normalizedLocalPath(candidatePath);
    const managedPath = managedFileName ? `notes/${String(managedFileName).replace(/\\/g, "/")}` : "";
    if (managedPath) {
      return confirmedPath === managedPath ? { confirmedPath, writePath: managedPath } : null;
    }
    return /^notes\/[^/]+\.md$/i.test(confirmedPath) ? { confirmedPath, writePath: confirmedPath } : null;
  }

  function createLocalConflictResolution({ noteId, action, confirmedPath, writePath, confirmedLocalHash } = {}) {
    if (!noteId || !action || !confirmedPath || !writePath || !confirmedLocalHash) return null;
    return {
      noteId: String(noteId),
      action: String(action),
      confirmedPath: normalizedLocalPath(confirmedPath),
      writePath: normalizedLocalPath(writePath),
      confirmedLocalHash: String(confirmedLocalHash)
    };
  }

  function localConflictResolutionMatches(resolution, { noteId, confirmedPath, writePath, currentLocalHash } = {}) {
    return Boolean(
      resolution &&
      String(resolution.noteId) === String(noteId || "") &&
      normalizedLocalPath(resolution.confirmedPath) === normalizedLocalPath(confirmedPath) &&
      normalizedLocalPath(resolution.writePath) === normalizedLocalPath(writePath) &&
      String(resolution.confirmedLocalHash) === String(currentLocalHash || "")
    );
  }

  function localConflictResolutionFileName(resolution, noteId) {
    if (!resolution || String(resolution.noteId) !== String(noteId || "")) return null;
    const match = normalizedLocalPath(resolution.writePath).match(/^notes\/([^/]+\.md)$/i);
    return match ? match[1] : null;
  }

  function deleteLocalConflictResolution(resolutions, noteId, resolution = null) {
    if (!resolutions?.get || !resolutions?.delete) return false;
    if (resolution && resolutions.get(noteId) !== resolution) return false;
    return resolutions.delete(noteId);
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

  function buildManifest({ appVersion, savedAt, exportedAt = savedAt, notes, collections, tags, assetsCount }) {
    return {
      format: "memo-nexus-backup",
      version: 2,
      exportedAt: exportedAt || new Date().toISOString(),
      formatVersion: 2,
      appVersion,
      savedAt,
      notesCount: (notes || []).length,
      collectionsCount: (collections || []).length,
      tagsCount: (tags || []).length,
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

  function hasExternalModification(
    lastWrittenHash,
    currentHash,
    nextHash,
    currentComparableHash = null,
    nextComparableHash = null
  ) {
    if (!lastWrittenHash || !currentHash) return false;
    return classifyManagedMarkdownHashes(
      lastWrittenHash,
      currentHash,
      nextHash,
      currentComparableHash,
      nextComparableHash
    ) === "conflict";
  }

  function managedNoteForPath(syncState, path) {
    const normalizedPath = String(path || "").replace(/\\/g, "/");
    return Object.entries(normalizeSyncState(syncState).notes).find(([, value]) => (
      value?.fileName && normalizedPath === `notes/${value.fileName}`
    )) || null;
  }

  function classifyManagedMarkdownHashes(
    lastWrittenHash,
    currentLocalHash,
    nextAppHash,
    currentComparableHash = null,
    nextComparableHash = null
  ) {
    if (!lastWrittenHash) return "unmanaged";
    if (currentLocalHash === lastWrittenHash) {
      return currentLocalHash === nextAppHash ? "last-written" : "app-ahead";
    }
    if (currentLocalHash === nextAppHash) return "app-current";
    if (currentComparableHash && nextComparableHash && currentComparableHash === nextComparableHash) return "app-ahead";
    return "conflict";
  }

  async function buildLocalScanAnalysis({
    files = [], syncState, notes = [], parseNote, serializeNote,
    getAttachmentsForNote = async () => [], resolvedConflicts = new Map()
  } = {}) {
    const normalizedSync = normalizeSyncState(syncState);
    const excluded = new Set(normalizedSync.excluded);
    const candidates = [];
    const appAheadNoteIds = [];
    const resolvedConflictNoteIds = [];
    const invalidatedResolutionNoteIds = [];
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
        const resolution = resolvedConflicts.get?.(managedNoteId);
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
          const nextAppMarkdown = serializeNote(managedNote, managedNote.body, attachmentFiles);
          const nextAppHash = contentHash(nextAppMarkdown);
          const currentLocalHash = contentHash(source);
          const resolutionMatches = localConflictResolutionMatches(resolution, {
            noteId: managedNoteId,
            confirmedPath: entry.path,
            writePath: entry.path,
            currentLocalHash
          });
          if (resolution && !resolutionMatches) invalidatedResolutionNoteIds.push(managedNoteId);
          const currentComparableHash = managedMarkdownComparableHash(source);
          const nextComparableHash = managedMarkdownComparableHash(nextAppMarkdown);
          const disposition = classifyManagedMarkdownHashes(
            managedState.hash,
            currentLocalHash,
            nextAppHash,
            currentComparableHash,
            nextComparableHash
          );
          if (disposition === "app-ahead") appAheadNoteIds.push(managedNoteId);
          if (disposition !== "conflict") continue;
          if (resolutionMatches) {
            resolvedConflictNoteIds.push(managedNoteId);
            continue;
          }
          candidates.push({
            ...entry,
            parsed,
            classification: {
              type: "conflict",
              existing: managedNote,
              bodyHash: contentHash(`${parsed.metadata.title || ""}\n${parsed.body || ""}`),
              lastWrittenHash: managedState.hash,
              currentLocalHash,
              nextAppHash,
              currentComparableHash,
              nextComparableHash
            }
          });
          continue;
        }
      }
      const classification = classifyMarkdownCandidate(parsed, notes);
      if (classification.type === "conflict") {
        const managedNoteId = classification.existing?.id;
        const resolution = resolvedConflicts.get?.(managedNoteId);
        const currentLocalHash = contentHash(source);
        const resolutionMatches = localConflictResolutionMatches(resolution, {
          noteId: managedNoteId,
          confirmedPath: entry.path,
          writePath: entry.path,
          currentLocalHash
        });
        if (resolution && !resolutionMatches) invalidatedResolutionNoteIds.push(managedNoteId);
        if (resolutionMatches) {
          resolvedConflictNoteIds.push(managedNoteId);
          continue;
        }
        candidates.push({
          ...entry,
          parsed,
          classification: { ...classification, currentLocalHash }
        });
        continue;
      }
      if (classification.type === "unchanged") continue;
      candidates.push({ ...entry, parsed, classification });
    }
    return {
      candidates,
      appAheadNoteIds,
      needsLocalSave: appAheadNoteIds.length > 0,
      resolvedConflictNoteIds: [...new Set(resolvedConflictNoteIds)],
      invalidatedResolutionNoteIds: [...new Set(invalidatedResolutionNoteIds)]
    };
  }

  async function buildLocalScanCandidates(options = {}) {
    return (await buildLocalScanAnalysis(options)).candidates;
  }

  function comparableTags(value) {
    return [...new Set((Array.isArray(value) ? value : []).filter((tag) => tag != null).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))];
  }

  function noteContentHash(title, body, tags) {
    return contentHash(`${title || ""}\n${body || ""}\n${JSON.stringify(comparableTags(tags))}`);
  }

  function classifyMarkdownCandidate(candidate, existingNotes, importedHashes = new Set()) {
    const id = candidate?.metadata?.memoNexusId ? String(candidate.metadata.memoNexusId) : "";
    const bodyHash = noteContentHash(candidate?.metadata?.title, candidate?.body, candidate?.metadata?.tags);
    if (importedHashes.has(bodyHash)) return { type: "duplicate", bodyHash, existing: null };
    const sameId = id ? (existingNotes || []).find((note) => note.id === id) : null;
    if (id && !sameId) return { type: "restore", bodyHash, existing: null };
    if (sameId) {
      const existingHash = noteContentHash(sameId.title, sameId.body, sameId.tags);
      return { type: existingHash === bodyHash ? "unchanged" : "conflict", bodyHash, existing: sameId };
    }
    const duplicate = (existingNotes || []).find((note) => noteContentHash(note.title, note.body, note.tags) === bodyHash);
    return { type: duplicate ? "duplicate" : "new", bodyHash, existing: duplicate || null };
  }

  const api = {
    MIME_EXTENSIONS, attachmentExtension, buildLocalScanAnalysis, buildLocalScanCandidates, buildManifest, classifyManagedMarkdownHashes,
    classifyMarkdownCandidate, contentHash, createLocalConflictResolution, deleteLocalConflictResolution, hasExternalModification, localConflictResolutionFileName, localConflictResolutionMatches, localConflictResolutionPaths, managedMarkdownComparableHash, managedNoteForPath,
    normalizeSyncState, parseCollections, safeStableNoteFileName, serializeCollections
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusLocalSyncUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
