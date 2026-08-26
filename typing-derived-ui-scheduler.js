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
    let pendingRequest = null;
    let renderedRequest = null;
    const compositionDepthByNoteId = new Map();

    function isComposing(noteId) {
      return (compositionDepthByNoteId.get(noteId) || 0) > 0;
    }

    function clearArmedTimer() {
      if (timerId !== null) clearTimer(timerId);
      timerId = null;
    }

    function armPendingRequest() {
      if (!pendingRequest || isComposing(pendingRequest.noteId)) return;
      const request = pendingRequest;
      const requestGeneration = generation;
      timerId = setTimer(() => {
        // clearTimer済みのcallbackがキューへ入っていても、世代と要求自体の一致で旧表示を棄却します。
        if (requestGeneration !== generation || pendingRequest !== request) return;
        timerId = null;
        if (isComposing(request.noteId)) return;
        pendingRequest = null;
        if (getCurrentNoteId() !== request.noteId) return;
        if (onFlush(request.noteId, request.revision) !== false) renderedRequest = request;
      }, delay);
    }

    function schedule(noteId, revision) {
      if (!noteId) return;
      generation += 1;
      clearArmedTimer();
      pendingRequest = { noteId, revision };
      // IME中は要求を捨てず、compositionend後に同じtrailing debounceへ戻します。
      armPendingRequest();
    }

    function cancelNote(noteId) {
      if (!noteId) return false;
      compositionDepthByNoteId.delete(noteId);
      if (pendingRequest?.noteId !== noteId) return false;
      generation += 1;
      clearArmedTimer();
      pendingRequest = null;
      return true;
    }

    function beginComposition(noteId) {
      if (!noteId) return;
      compositionDepthByNoteId.set(noteId, (compositionDepthByNoteId.get(noteId) || 0) + 1);
      if (pendingRequest?.noteId !== noteId || timerId === null) return;
      generation += 1;
      clearArmedTimer();
    }

    function endComposition(noteId) {
      if (!noteId || !isComposing(noteId)) return;
      const depth = compositionDepthByNoteId.get(noteId) - 1;
      if (depth > 0) {
        compositionDepthByNoteId.set(noteId, depth);
        return;
      }
      compositionDepthByNoteId.delete(noteId);
      if (pendingRequest?.noteId !== noteId) return;
      generation += 1;
      clearArmedTimer();
      armPendingRequest();
    }

    function markRendered(noteId, revision) {
      if (!noteId) return;
      renderedRequest = { noteId, revision };
    }

    function revisionCovers(candidate, target) {
      if (candidate === target) return true;
      const candidateNumber = Number(candidate);
      const targetNumber = Number(target);
      return Number.isFinite(candidateNumber) && Number.isFinite(targetNumber) && candidateNumber > targetNumber;
    }

    function needsDerivedUiAfterSave(noteId, revision) {
      if (pendingRequest?.noteId === noteId && revisionCovers(pendingRequest.revision, revision)) return false;
      return renderedRequest?.noteId !== noteId || !revisionCovers(renderedRequest.revision, revision);
    }

    return {
      beginComposition,
      cancelNote,
      endComposition,
      markRendered,
      needsDerivedUiAfterSave,
      pendingNoteId: () => pendingRequest?.noteId || null,
      schedule
    };
  }

  return { createTypingDerivedUiScheduler };
});
