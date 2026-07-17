(function initMemoListUtils(global) {
  "use strict";

  function buildMemoListView(notes, selectedCollectionId) {
    const trashSelected = selectedCollectionId === "trash";
    return {
      heading: trashSelected ? "ゴミ箱" : "メモ一覧",
      notes: notes.filter((note) => trashSelected ? Boolean(note.deletedAt) : !note.deletedAt)
    };
  }

  const api = { buildMemoListView };
  global.MemoNexusMemoListUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
