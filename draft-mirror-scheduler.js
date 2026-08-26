(function initDraftMirrorScheduler(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.MemoNexusDraftMirror = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function draftMirrorSchedulerFactory() {
  function createDraftMirrorScheduler({
    delay = 200,
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
    let lastFlushedRequest = null;

    function clearArmedTimer() {
      if (timerId !== null) clearTimer(timerId);
      timerId = null;
    }

    function sameRevision(left, right) {
      return left === right || (
        Number.isFinite(Number(left))
        && Number.isFinite(Number(right))
        && Number(left) === Number(right)
      );
    }

    function invoke(request) {
      if (!request || getCurrentNoteId() !== request.noteId) return false;
      const written = onFlush(request.noteId, request.revision) !== false;
      if (written) lastFlushedRequest = { noteId: request.noteId, revision: request.revision };
      return written;
    }

    function schedule(noteId, revision) {
      if (!noteId) return false;
      generation += 1;
      clearArmedTimer();
      const request = { noteId, revision };
      const requestGeneration = generation;
      pendingRequest = request;
      timerId = setTimer(() => {
        // clearTimer済みのcallbackが実行されても、旧世代は現在の予約へ触れません。
        if (requestGeneration !== generation || pendingRequest !== request) return;
        timerId = null;
        pendingRequest = null;
        invoke(request);
      }, delay);
      return true;
    }

    function consumePendingRequest(noteId, revision) {
      if (!noteId || pendingRequest?.noteId !== noteId) return null;
      const request = { noteId, revision: revision ?? pendingRequest.revision };
      generation += 1;
      clearArmedTimer();
      pendingRequest = null;
      return request;
    }

    function invokeUnlessDuplicate(request) {
      // visibilitychangeの直後にpagehideが続いても、同じ内容を二重保存しません。
      if (
        lastFlushedRequest?.noteId === request.noteId
        && sameRevision(lastFlushedRequest.revision, request.revision)
      ) return false;
      return invoke(request);
    }

    function flush(noteId, revision) {
      const request = consumePendingRequest(noteId, revision);
      if (!request) return false;
      return invokeUnlessDuplicate(request);
    }

    function forceFlush(noteId, revision) {
      if (!noteId) return false;
      const request = consumePendingRequest(noteId, revision) || { noteId, revision };
      return invokeUnlessDuplicate(request);
    }

    function cancelNote(noteId) {
      if (!noteId) return false;
      if (lastFlushedRequest?.noteId === noteId) lastFlushedRequest = null;
      if (pendingRequest?.noteId !== noteId) return false;
      generation += 1;
      clearArmedTimer();
      pendingRequest = null;
      return true;
    }

    return {
      cancelNote,
      flush,
      forceFlush,
      pendingNoteId: () => pendingRequest?.noteId || null,
      pendingRevision: () => pendingRequest?.revision ?? null,
      schedule
    };
  }

  return { createDraftMirrorScheduler };
});
