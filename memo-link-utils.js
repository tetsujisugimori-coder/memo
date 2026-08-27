(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusMemoLinkUtils = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  function parseMemoLinks(body) {
    const source = String(body || "").replace(/\r\n?/g, "\n");
    const links = [];
    let index = 0;
    let inFence = false;

    while (index < source.length) {
      const lineEnd = source.indexOf("\n", index);
      const end = lineEnd === -1 ? source.length : lineEnd;
      const line = source.slice(index, end);
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
              // 初期実装では # も含めた文字列全体をタイトルとし、位置指定への分解はresolverより前へ追加できます。
              const title = rawTarget.trim();
              if (title) links.push({ title, start: cursor, end: close + 2 });
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

  function resolveMemoLinkTitle(rawTitle, notes) {
    const title = String(rawTitle || "").trim();
    const matches = activeMemoLinkNotes(notes).filter((note) => String(note.title || "") === title);
    if (matches.length === 1) {
      return { status: "resolved", title, noteId: matches[0].id };
    }
    if (matches.length > 1) {
      return { status: "ambiguous", title, noteId: null, candidateNoteIds: matches.map((note) => note.id) };
    }
    return { status: "missing", title, noteId: null };
  }

  function buildMemoLinkRelationIndex(notes) {
    const activeNotes = activeMemoLinkNotes(notes);
    const bySourceNoteId = new Map();
    const backlinksByTargetId = new Map();
    const targetNoteIdsBySourceId = new Map();

    activeNotes.forEach((sourceNote) => {
      const relations = uniqueMemoLinks(parseMemoLinks(sourceNote.body)).map((link) => {
        const resolution = resolveMemoLinkTitle(link.title, activeNotes);
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

    return { activeNotes, backlinksByTargetId, bySourceNoteId, targetNoteIdsBySourceId };
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
    createMemoLinkRelationCache,
    parseMemoLinks,
    resolveMemoLinkTitle,
    uniqueMemoLinks
  };
});
