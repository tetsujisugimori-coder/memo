(function initMemoListUtils(global) {
  "use strict";

  const tagUtils = global.MemoNexusTags || (typeof require === "function" ? require("./tags.js") : null);

  function buildMemoListView(notes, selectedCollectionId, selectedTagFilter = null) {
    const filter = tagUtils.normalizeTagId(selectedTagFilter);
    const trashSelected = selectedCollectionId === "trash";
    const scoped = notes.filter((note) => trashSelected ? Boolean(note.deletedAt) : !note.deletedAt);
    const filtered = tagUtils.filterMemosByTag(scoped, filter, selectedCollectionId);
    const baseHeading = trashSelected ? "ゴミ箱" : "メモ一覧";
    const heading = filter ? `${baseHeading}（タグ: ${filter}）` : baseHeading;
    return { heading, notes: filtered };
  }

  const api = { buildMemoListView };
  global.MemoNexusMemoListUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
