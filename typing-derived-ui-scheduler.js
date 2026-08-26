(function initTypingDerivedUiScheduler(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.MemoNexusTypingDerivedUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function typingDerivedUiSchedulerFactory() {
  const REQUEST_TYPE_FULL = "full";
  const REQUEST_TYPE_AUXILIARY = "auxiliary";
  const RENDERED_PRIMARY = 1;
  const RENDERED_AUXILIARY = 2;
  const RENDERED_FULL = RENDERED_PRIMARY | RENDERED_AUXILIARY;

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
    let renderedState = null;
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
        if (onFlush(request.noteId, request.revision, request.type) !== false) {
          markRendered(request.noteId, request.revision, request.type);
        }
      }, delay);
    }

    function scheduleRequest(noteId, revision, type) {
      if (!noteId) return;
      generation += 1;
      clearArmedTimer();
      pendingRequest = { noteId, revision, type };
      // IME中は要求を捨てず、compositionend後に同じtrailing debounceへ戻します。
      armPendingRequest();
    }

    function schedule(noteId, revision) {
      scheduleRequest(noteId, revision, REQUEST_TYPE_FULL);
    }

    function scheduleAuxiliary(noteId, revision) {
      // カード・表は呼び出し側で同期済み。補助UIだけをtrailing要求として保持します。
      markRendered(noteId, revision, "primary");
      scheduleRequest(noteId, revision, REQUEST_TYPE_AUXILIARY);
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

    function renderedCoverage(type) {
      if (type === REQUEST_TYPE_AUXILIARY) return RENDERED_AUXILIARY;
      if (type === "primary") return RENDERED_PRIMARY;
      return RENDERED_FULL;
    }

    function markRendered(noteId, revision, type = REQUEST_TYPE_FULL) {
      if (!noteId) return;
      const coverage = renderedCoverage(type);
      if (renderedState?.noteId === noteId && renderedState.revision === revision) {
        renderedState.coverage |= coverage;
      } else if (!renderedState || renderedState.noteId !== noteId || !revisionCovers(renderedState.revision, revision)) {
        renderedState = { noteId, revision, coverage };
      }
    }

    function revisionCovers(candidate, target) {
      if (candidate === target) return true;
      const candidateNumber = Number(candidate);
      const targetNumber = Number(target);
      return Number.isFinite(candidateNumber) && Number.isFinite(targetNumber) && candidateNumber > targetNumber;
    }

    function requiredDerivedUiAfterSave(noteId, revision) {
      let coverage = 0;
      if (renderedState?.noteId === noteId && revisionCovers(renderedState.revision, revision)) {
        coverage |= renderedState.coverage;
      }
      if (pendingRequest?.noteId === noteId && revisionCovers(pendingRequest.revision, revision)) {
        coverage |= pendingRequest.type === REQUEST_TYPE_FULL ? RENDERED_FULL : RENDERED_AUXILIARY;
      }
      if (coverage === RENDERED_FULL) return null;
      if (coverage === RENDERED_PRIMARY) return REQUEST_TYPE_AUXILIARY;
      return REQUEST_TYPE_FULL;
    }

    function needsDerivedUiAfterSave(noteId, revision) {
      return requiredDerivedUiAfterSave(noteId, revision) !== null;
    }

    return {
      beginComposition,
      cancelNote,
      endComposition,
      markRendered,
      needsDerivedUiAfterSave,
      pendingNoteId: () => pendingRequest?.noteId || null,
      pendingRequestType: () => pendingRequest?.type || null,
      requiredDerivedUiAfterSave,
      schedule,
      scheduleAuxiliary
    };
  }

  return { createTypingDerivedUiScheduler, REQUEST_TYPE_AUXILIARY, REQUEST_TYPE_FULL };
});
