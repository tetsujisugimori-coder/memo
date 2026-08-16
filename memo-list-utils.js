(function initMemoListUtils(global) {
  "use strict";

  function normalizeMemoTags(value) {
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

  function normalizeTagFilter(selectedTagFilter) {
    const tag = String(selectedTagFilter || "").trim().toLowerCase();
    return tag || null;
  }

  function buildMemoListView(notes, selectedCollectionId, selectedTagFilter = null) {
    const filter = normalizeTagFilter(selectedTagFilter);
    const trashSelected = selectedCollectionId === "trash";
    const scoped = notes.filter((note) => trashSelected ? Boolean(note.deletedAt) : !note.deletedAt).filter((note) => {
      if (!filter) return true;
      const noteTags = normalizeMemoTags(note.tags);
      const collectionMatches = !selectedCollectionId || trashSelected || note.collectionId === selectedCollectionId;
      return collectionMatches && noteTags.includes(filter);
    });
    const baseHeading = trashSelected ? "ゴミ箱" : "メモ一覧";
    const heading = filter ? `${baseHeading}（タグ: ${filter}）` : baseHeading;
    return { heading, notes: scoped };
  }

  const api = { buildMemoListView, normalizeMemoTags, normalizeTagFilter };
  global.MemoNexusMemoListUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
