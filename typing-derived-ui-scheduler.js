(function initTypingDerivedUiScheduler(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.MemoNexusTypingDerivedUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function typingDerivedUiSchedulerFactory() {
  function createTypingDerivedUiScheduler({
    delay = 180,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    getCurrentNoteId,
    onFlush
  } = {}) {
    if (typeof getCurrentNoteId !== "function") throw new TypeError("getCurrentNoteId is required");
    if (typeof onFlush !== "function") throw new TypeError("onFlush is required");

    let timerId = null;
    let generation = 0;
    let pendingNoteId = null;

    function invalidate() {
      generation += 1;
      if (timerId !== null) clearTimer(timerId);
      timerId = null;
      pendingNoteId = null;
    }

    function schedule(noteId) {
      if (!noteId) return;
      generation += 1;
      const requestGeneration = generation;
      pendingNoteId = noteId;
      if (timerId !== null) clearTimer(timerId);
      timerId = setTimer(() => {
        // clearTimer済みのcallbackが既にキューへ入っていても、世代とnoteIdの両方で旧表示を棄却します。
        if (requestGeneration !== generation) return;
        timerId = null;
        pendingNoteId = null;
        if (getCurrentNoteId() !== noteId) return;
        onFlush(noteId);
      }, delay);
    }

    return {
      invalidate,
      schedule,
      pendingNoteId: () => pendingNoteId
    };
  }

  return { createTypingDerivedUiScheduler };
});
