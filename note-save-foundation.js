(function initNoteSaveFoundation(globalScope) {
  "use strict";

  let fallbackRequestId = 0;

  function normalizeRevision(value) {
    const revision = Number(value);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  }

  function cloneSnapshot(value) {
    if (typeof globalScope?.structuredClone === "function") return globalScope.structuredClone(value);
    if (Array.isArray(value)) return value.map(cloneSnapshot);
    if (value && Object.prototype.toString.call(value) === "[object Object]") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneSnapshot(item)]));
    }
    return value;
  }

  function defaultRequestId() {
    if (globalScope?.crypto?.randomUUID) return globalScope.crypto.randomUUID();
    fallbackRequestId += 1;
    return `save-${Date.now()}-${fallbackRequestId}`;
  }

  function createSaveRequest({ noteId, revision, snapshot, saveRequestId = defaultRequestId() } = {}) {
    if (!noteId) throw new Error("noteId is required");
    if (!snapshot || typeof snapshot !== "object") throw new Error("snapshot is required");
    const normalizedRevision = normalizeRevision(revision);
    const fixedSnapshot = cloneSnapshot({ ...snapshot, id: noteId, revision: normalizedRevision });
    return Object.freeze({
      noteId,
      revision: normalizedRevision,
      snapshot: fixedSnapshot,
      saveRequestId: String(saveRequestId)
    });
  }

  function createNoteSaveFoundation({
    writeSnapshot,
    onStateChange = () => {},
    onSaveSuccess = () => {},
    onSaveError = () => {}
  } = {}) {
    if (typeof writeSnapshot !== "function") throw new Error("writeSnapshot is required");

    const entries = new Map();

    function publicState(entry) {
      return {
        noteId: entry.noteId,
        currentRevision: entry.currentRevision,
        lastSavedRevision: entry.lastSavedRevision,
        dirty: entry.currentRevision !== entry.lastSavedRevision,
        status: entry.status,
        activeRevision: entry.active?.request.revision ?? null,
        pendingRevision: entry.pending?.request.revision ?? null,
        lastError: entry.lastError
      };
    }

    function emit(entry) {
      onStateChange(entry.noteId, publicState(entry));
    }

    function createEntry(noteId, revision, saved) {
      const normalizedRevision = normalizeRevision(revision);
      const entry = {
        noteId,
        currentRevision: normalizedRevision,
        lastSavedRevision: saved ? normalizedRevision : Math.max(0, normalizedRevision - 1),
        status: saved ? "saved" : "dirty",
        lastError: null,
        active: null,
        pending: null,
        drainScheduled: false,
        draining: false,
        idleWaiters: []
      };
      entries.set(noteId, entry);
      return entry;
    }

    function registerNote(noteId, revision = 0) {
      if (!noteId) throw new Error("noteId is required");
      const normalizedRevision = normalizeRevision(revision);
      const existing = entries.get(noteId);
      if (existing) {
        if (!existing.active && !existing.pending && existing.currentRevision === existing.lastSavedRevision) {
          existing.currentRevision = normalizedRevision;
          existing.lastSavedRevision = normalizedRevision;
          existing.status = "saved";
        }
        return publicState(existing);
      }
      return publicState(createEntry(noteId, normalizedRevision, true));
    }

    function ensureEntry(noteId, revision = 0, saved = true) {
      return entries.get(noteId) || createEntry(noteId, revision, saved);
    }

    function markChanged(noteId, revision = 0) {
      if (!noteId) throw new Error("noteId is required");
      const entry = ensureEntry(noteId, revision, true);
      entry.currentRevision = Math.max(entry.currentRevision, normalizeRevision(revision)) + 1;
      entry.status = "dirty";
      emit(entry);
      return entry.currentRevision;
    }

    function finishIdle(entry) {
      if (entry.draining || entry.drainScheduled || entry.active || entry.pending) return;
      const waiters = entry.idleWaiters;
      entry.idleWaiters = [];
      waiters.forEach((resolve) => resolve(publicState(entry)));
    }

    async function drain(entry) {
      if (entry.draining) return;
      entry.drainScheduled = false;
      entry.draining = true;
      try {
        while (entry.pending) {
          const batch = entry.pending;
          entry.pending = null;
          entry.active = batch;
          entry.status = "saving";
          emit(entry);

          try {
            await writeSnapshot(cloneSnapshot(batch.request.snapshot), batch.request);
            entry.lastSavedRevision = Math.max(entry.lastSavedRevision, batch.request.revision);
            entry.lastError = null;
            entry.status = entry.currentRevision === entry.lastSavedRevision ? "saved" : "dirty";
            const state = publicState(entry);
            batch.waiters.forEach(({ resolve }) => resolve({ request: batch.request, state }));
            onSaveSuccess(batch.request, state);
          } catch (error) {
            entry.lastError = error;
            entry.status = "error";
            const state = publicState(entry);
            batch.waiters.forEach(({ reject }) => reject(error));
            onSaveError(batch.request, error, state);
          } finally {
            entry.active = null;
            emit(entry);
          }
        }
      } finally {
        entry.draining = false;
        finishIdle(entry);
      }
    }

    function scheduleDrain(entry) {
      if (entry.draining || entry.drainScheduled) return;
      entry.drainScheduled = true;
      queueMicrotask(() => drain(entry));
    }

    function enqueueSave(request) {
      if (!request || !request.noteId || !request.snapshot) throw new Error("valid save request is required");
      const entry = ensureEntry(request.noteId, request.revision, false);
      entry.currentRevision = Math.max(entry.currentRevision, normalizeRevision(request.revision));

      if (request.revision <= entry.lastSavedRevision) {
        return Promise.resolve({ request, state: publicState(entry), skipped: true });
      }

      if (entry.active && request.revision <= entry.active.request.revision) {
        return new Promise((resolve, reject) => entry.active.waiters.push({ resolve, reject }));
      }

      const promise = new Promise((resolve, reject) => {
        if (!entry.pending) {
          entry.pending = { request, waiters: [{ resolve, reject }] };
        } else if (request.revision >= entry.pending.request.revision) {
          entry.pending.request = request;
          entry.pending.waiters.push({ resolve, reject });
        } else {
          entry.pending.waiters.push({ resolve, reject });
        }
      });
      if (!entry.active) entry.status = "dirty";
      emit(entry);
      scheduleDrain(entry);
      return promise;
    }

    function getState(noteId) {
      const entry = entries.get(noteId);
      return entry ? publicState(entry) : null;
    }

    function isDirty(noteId) {
      return Boolean(getState(noteId)?.dirty);
    }

    function whenIdle(noteId) {
      const entry = entries.get(noteId);
      if (!entry || (!entry.draining && !entry.drainScheduled && !entry.active && !entry.pending)) {
        return Promise.resolve(entry ? publicState(entry) : null);
      }
      return new Promise((resolve) => entry.idleWaiters.push(resolve));
    }

    return { enqueueSave, getState, isDirty, markChanged, registerNote, whenIdle };
  }

  const api = { cloneSnapshot, createNoteSaveFoundation, createSaveRequest, normalizeRevision };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusNoteSaveFoundation = api;
})(typeof window !== "undefined" ? window : globalThis);
