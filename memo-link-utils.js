(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusMemoLinkUtils = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  function parseMemoLinks(body) {
    const source = String(body || "");
    const links = [];
    let index = 0;
    let inFence = false;

    while (index < source.length) {
      const lineEnd = source.indexOf("\n", index);
      const end = lineEnd === -1 ? source.length : lineEnd;
      const rawLine = source.slice(index, end);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (/^```\s*([^\s`]*)\s*$/.test(line)) {
        inFence = !inFence;
        index = lineEnd === -1 ? source.length : lineEnd + 1;
        continue;
      }
      if (inFence) {
        index = lineEnd === -1 ? source.length : lineEnd + 1;
        continue;
      }

      let cursor = index;
      while (cursor < end) {
        if (source[cursor] === "`") {
          const codeEnd = source.indexOf("`", cursor + 1);
          if (codeEnd !== -1 && codeEnd < end) {
            cursor = codeEnd + 1;
            continue;
          }
        }
        if (source.startsWith("[[*", cursor)) {
          const close = source.indexOf("]]", cursor + 3);
          if (close !== -1 && close <= end) {
            const rawTarget = source.slice(cursor + 3, close);
            if (/^ +/.test(rawTarget)) {
              const title = rawTarget.trim();
              if (title) {
                const leadingSpaceLength = rawTarget.match(/^ +/)[0].length;
                const trailingSpaceLength = rawTarget.match(/ +$/)?.[0].length || 0;
                links.push({
                  title,
                  start: cursor,
                  end: close + 2,
                  titleStart: cursor + 3 + leadingSpaceLength,
                  titleEnd: close - trailingSpaceLength
                });
              }
            }
            cursor = close + 2;
            continue;
          }
        }
        cursor += 1;
      }
      index = lineEnd === -1 ? source.length : lineEnd + 1;
    }

    return links;
  }

  function uniqueMemoLinks(links) {
    const seen = new Set();
    return Array.from(links || []).filter((link) => {
      const title = String(link?.title || "").trim();
      if (!title || seen.has(title)) return false;
      seen.add(title);
      return true;
    });
  }

  function activeMemoLinkNotes(notes) {
    return (Array.isArray(notes) ? notes : []).filter((note) => note && !note.deletedAt);
  }

  function buildMemoLinkTitleIndex(notes) {
    const activeNotes = activeMemoLinkNotes(notes);
    const noteIdsByTitle = new Map();
    activeNotes.forEach((note) => {
      const title = String(note.title || "");
      const noteIds = noteIdsByTitle.get(title) || [];
      noteIds.push(note.id);
      noteIdsByTitle.set(title, noteIds);
    });
    return { activeNotes, noteIdsByTitle };
  }

  function resolveMemoLinkTitleFromIndex(rawTitle, titleIndex) {
    const title = String(rawTitle || "").trim();
    const noteIds = titleIndex?.noteIdsByTitle?.get(title) || [];
    if (noteIds.length === 1) {
      return { status: "resolved", title, noteId: noteIds[0] };
    }
    if (noteIds.length > 1) {
      return { status: "ambiguous", title, noteId: null, candidateNoteIds: [...noteIds] };
    }
    return { status: "missing", title, noteId: null };
  }

  function resolveMemoLinkTitle(rawTitle, notes) {
    return resolveMemoLinkTitleFromIndex(rawTitle, buildMemoLinkTitleIndex(notes));
  }

  function buildMemoLinkRelationIndex(notes, { onTitleIndexBuilt } = {}) {
    const titleIndex = buildMemoLinkTitleIndex(notes);
    if (typeof onTitleIndexBuilt === "function") onTitleIndexBuilt(titleIndex);
    const { activeNotes, noteIdsByTitle } = titleIndex;
    const bySourceNoteId = new Map();
    const backlinksByTargetId = new Map();
    const targetNoteIdsBySourceId = new Map();

    activeNotes.forEach((sourceNote) => {
      const relations = uniqueMemoLinks(parseMemoLinks(sourceNote.body)).map((link) => {
        const resolution = resolveMemoLinkTitleFromIndex(link.title, titleIndex);
        return {
          sourceNoteId: sourceNote.id,
          targetTitle: link.title,
          targetNoteId: resolution.noteId,
          resolutionStatus: resolution.status,
          ...(resolution.candidateNoteIds ? { candidateNoteIds: resolution.candidateNoteIds } : {})
        };
      });
      bySourceNoteId.set(sourceNote.id, relations);

      const targetIds = new Set();
      relations.forEach((relation) => {
        if (relation.resolutionStatus !== "resolved") return;
        targetIds.add(relation.targetNoteId);
        if (relation.targetNoteId === sourceNote.id) return;
        const backlinks = backlinksByTargetId.get(relation.targetNoteId) || [];
        if (!backlinks.some((item) => item.sourceNoteId === sourceNote.id)) backlinks.push(relation);
        backlinksByTargetId.set(relation.targetNoteId, backlinks);
      });
      targetNoteIdsBySourceId.set(sourceNote.id, targetIds);
    });

    return { activeNotes, backlinksByTargetId, bySourceNoteId, noteIdsByTitle, targetNoteIdsBySourceId };
  }

  function rewriteResolvedMemoLinks(body, {
    oldTitle,
    newTitle,
    targetNoteId,
    sourceNoteId,
    relationIndex
  } = {}) {
    const source = String(body || "");
    const replacementTitle = String(newTitle || "").trim();
    const expectedOldTitle = oldTitle == null ? null : String(oldTitle).trim();
    if (!replacementTitle || !targetNoteId || !sourceNoteId || !relationIndex) {
      return { body: source, changed: false, replacementCount: 0, replacements: [] };
    }

    const eligibleTitles = new Set((relationIndex.bySourceNoteId.get(sourceNoteId) || [])
      .filter((relation) => relation.resolutionStatus === "resolved"
        && relation.targetNoteId === targetNoteId
        && (expectedOldTitle === null || relation.targetTitle === expectedOldTitle))
      .map((relation) => relation.targetTitle));
    return rewriteMemoLinkTitles(source, eligibleTitles, replacementTitle);
  }

  function rewriteMemoLinkTitles(source, eligibleTitles, replacementTitle) {
    if (!eligibleTitles.size) return { body: source, changed: false, replacementCount: 0, replacements: [] };

    const replacements = parseMemoLinks(source)
      .filter((link) => eligibleTitles.has(link.title))
      .sort((left, right) => right.titleStart - left.titleStart);
    let rewritten = source;
    replacements.forEach((link) => {
      rewritten = `${rewritten.slice(0, link.titleStart)}${replacementTitle}${rewritten.slice(link.titleEnd)}`;
    });
    return {
      body: rewritten,
      changed: replacements.length > 0,
      replacementCount: replacements.length,
      replacements: replacements.map((link) => ({
        start: link.titleStart,
        end: link.titleEnd,
        replacementLength: replacementTitle.length
      })).sort((left, right) => left.start - right.start)
    };
  }

  function rewriteMemoLinksFromRenameNotification(body, {
    oldTitle,
    newTitle,
    sourceNoteId,
    resolvedSourceNoteIds
  } = {}) {
    const source = String(body || "");
    const expectedOldTitle = String(oldTitle || "").trim();
    const replacementTitle = String(newTitle || "").trim();
    const allowedSources = new Set(Array.isArray(resolvedSourceNoteIds) ? resolvedSourceNoteIds : []);
    if (!sourceNoteId || !allowedSources.has(sourceNoteId) || !expectedOldTitle || !replacementTitle) {
      return { body: source, changed: false, replacementCount: 0, replacements: [] };
    }
    return rewriteMemoLinkTitles(source, new Set([expectedOldTitle]), replacementTitle);
  }

  function createMemoLinkRelationCache() {
    let index = null;
    return {
      get(notes) {
        if (!index) index = buildMemoLinkRelationIndex(notes);
        return index;
      },
      invalidate() {
        index = null;
      }
    };
  }

  return {
    buildMemoLinkRelationIndex,
    buildMemoLinkTitleIndex,
    createMemoLinkRelationCache,
    parseMemoLinks,
    resolveMemoLinkTitleFromIndex,
    resolveMemoLinkTitle,
    rewriteMemoLinksFromRenameNotification,
    rewriteResolvedMemoLinks,
    uniqueMemoLinks
  };
});
