(function initAiSelectionSnapshot(globalScope) {
  "use strict";
  function captureAiSelection({ noteId, noteTitle, body, start, end } = {}) {
    if (!noteId || typeof body !== "string" || !Number.isInteger(start) || !Number.isInteger(end)
        || start < 0 || end <= start || end > body.length) return null;
    const selectedText = body.slice(start, end);
    if (!selectedText.trim()) return null;
    return Object.freeze({ noteId: String(noteId), noteTitle: String(noteTitle || ""), body, start, end, selectedText });
  }
  function isAiSelectionCurrent(snapshot, { noteId, noteTitle, body } = {}) {
    return Boolean(snapshot && noteId && snapshot.noteId === String(noteId)
      && snapshot.noteTitle === String(noteTitle || "")
      && typeof body === "string" && snapshot.body === body
      && Number.isInteger(snapshot.start) && Number.isInteger(snapshot.end)
      && snapshot.end > snapshot.start && snapshot.end <= body.length
      && snapshot.selectedText === body.slice(snapshot.start, snapshot.end));
  }
  const api = Object.freeze({ captureAiSelection, isAiSelectionCurrent });
  if (typeof module === "object" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusAiSelectionSnapshot = api;
})(typeof window !== "undefined" ? window : globalThis);
