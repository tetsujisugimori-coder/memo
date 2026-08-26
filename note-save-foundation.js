(function initNoteSaveFoundation(globalScope) {
  "use strict";

  let fallbackRequestId = 0;
  let fallbackOperationId = 0;

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

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function defaultRequestId() {
    if (globalScope?.crypto?.randomUUID) return globalScope.crypto.randomUUID();
    fallbackRequestId += 1;
    return `save-${Date.now()}-${fallbackRequestId}`;
  }

  function createSaveRequest({ noteId, resourceKey, resourceType, revision, snapshot, saveRequestId = defaultRequestId(), clone = cloneSnapshot } = {}) {
    const fixedResourceKey = resourceKey || noteId;
    if (!fixedResourceKey) throw new Error("noteId or resourceKey is required");
    if (!snapshot || typeof snapshot !== "object") throw new Error("snapshot is required");
    if (typeof clone !== "function") throw new Error("clone is required");
    const normalizedRevision = normalizeRevision(revision);
    const fixedSnapshot = deepFreeze(clone({
      ...snapshot,
      ...(noteId ? { id: noteId } : {}),
      revision: normalizedRevision
    }));
    return Object.freeze({
      noteId: noteId || null,
      resourceKey: fixedResourceKey,
      resourceType: resourceType || (noteId ? "note" : "resource"),
      revision: normalizedRevision,
      snapshot: fixedSnapshot,
      saveRequestId: String(saveRequestId)
    });
  }

  function createNoteSaveFoundation({
    writeSnapshot,
    onStateChange = () => {},
    onSaveSuccess = () => {},
    onSaveError = () => {},
    logError = (...args) => globalScope?.console?.error?.(...args)
  } = {}) {
    if (typeof writeSnapshot !== "function") throw new Error("writeSnapshot is required");

    function requestResourceKey(request) {
      return request?.resourceKey || request?.noteId || null;
    }

    const entries = new Map();
    const permanentlyDeletedNotes = new Map();

    function operationError(noteId, code, message) {
      const error = new Error(message);
      error.code = code;
      error.noteId = noteId;
      return error;
    }

    function permanentlyDeletedError(noteId) {
      const tombstone = permanentlyDeletedNotes.get(noteId) || null;
      const error = operationError(noteId, "NOTE_PERMANENTLY_DELETED", "note was permanently deleted");
      error.tombstone = tombstone;
      return error;
    }

    function publicState(entry) {
      return {
        noteId: entry.noteId,
        currentRevision: entry.currentRevision,
        lastSavedRevision: entry.lastSavedRevision,
        dirty: entry.currentRevision !== entry.lastSavedRevision,
        status: entry.status,
        activeRevision: entry.inFlight?.request.revision ?? entry.active?.request.revision ?? null,
        pendingRevision: entry.pending?.request.revision ?? null,
        lastError: entry.lastError
      };
    }

    function safeNotify(label, callback, args) {
      try {
        callback(...args);
      } catch (error) {
        try {
          logError(`Note save ${label} callback failed`, error);
        } catch (_) {
          // Logging must never affect persistence or queue progress.
        }
      }
    }

    function emit(entry) {
      safeNotify("state", onStateChange, [entry.noteId, publicState(entry)]);
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
        inFlight: null,
        pending: null,
        drainScheduled: false,
        draining: false,
        atomicBatch: null,
        terminal: null,
        lockTail: Promise.resolve(),
        reservations: 0,
        idleWaiters: []
      };
      entries.set(noteId, entry);
      return entry;
    }

    function registerNote(noteId, revision = 0) {
      if (!noteId) throw new Error("noteId is required");
      if (permanentlyDeletedNotes.has(noteId)) return null;
      const normalizedRevision = normalizeRevision(revision);
      const existing = entries.get(noteId);
      if (existing) {
        if (!existing.active && !existing.inFlight && !existing.pending && existing.currentRevision === existing.lastSavedRevision) {
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
      if (permanentlyDeletedNotes.has(noteId)) throw permanentlyDeletedError(noteId);
      const entry = ensureEntry(noteId, revision, true);
      if (entry.terminal) throw operationError(noteId, "NOTE_DELETING", "note is being permanently deleted");
      entry.currentRevision = Math.max(entry.currentRevision, normalizeRevision(revision)) + 1;
      entry.status = "dirty";
      emit(entry);
      return entry.currentRevision;
    }

    function finishIdle(entry) {
      if (entry.draining || entry.drainScheduled || entry.active || entry.inFlight || entry.pending || entry.reservations || entry.atomicBatch || entry.terminal) return;
      const waiters = entry.idleWaiters.splice(0);
      const state = publicState(entry);
      waiters.forEach((resolve) => resolve(state));
    }

    async function withNoteLocks(noteIds, operation) {
      const lockedEntries = [...new Set(noteIds)].filter(Boolean).sort()
        .map((noteId) => ensureEntry(noteId, 0, true));
      const ready = Promise.all(lockedEntries.map((entry) => entry.lockTail.catch(() => undefined)));
      let release;
      const held = ready.then(() => new Promise((resolve) => { release = resolve; }));
      lockedEntries.forEach((entry) => {
        entry.reservations += 1;
        entry.lockTail = held.catch(() => undefined);
      });
      await ready;
      try {
        return await operation();
      } finally {
        release();
        lockedEntries.forEach((entry) => {
          entry.reservations -= 1;
          finishIdle(entry);
        });
      }
    }

    function settleBatch(batch, method, value) {
      const waiters = batch.waiters.splice(0);
      waiters.forEach((waiter) => waiter[method](value));
    }

    async function persistBatch(entry, batch) {
      return withNoteLocks([entry.noteId], async () => {
        entry.active = batch;
        entry.status = "saving";
        emit(entry);

        let writeError = null;
        try {
          await writeSnapshot(batch.request.snapshot, batch.request);
        } catch (error) {
          writeError = error;
        }

        if (writeError) {
          entry.lastError = writeError;
          entry.status = "error";
        } else {
          entry.lastSavedRevision = Math.max(entry.lastSavedRevision, batch.request.revision);
          entry.lastError = null;
          entry.status = entry.currentRevision === entry.lastSavedRevision ? "saved" : "dirty";
        }

        entry.active = null;
        entry.inFlight = null;
        const state = publicState(entry);
        if (writeError) settleBatch(batch, "reject", writeError);
        else settleBatch(batch, "resolve", { request: batch.request, state });
        emit(entry);
        if (writeError) safeNotify("error", onSaveError, [batch.request, writeError, state]);
        else safeNotify("success", onSaveSuccess, [batch.request, state]);
        if (writeError?.code === "NOTE_PERMANENTLY_DELETED") {
          finishPermanentDeletion([writeError.noteId || entry.noteId], writeError.tombstone);
        }
      });
    }

    async function drain(entry) {
      if (entry.draining) return;
      entry.drainScheduled = false;
      entry.draining = true;
      try {
        while (entry.pending) {
          const batch = entry.pending;
          entry.pending = null;
          entry.inFlight = batch;
          try {
            await persistBatch(entry, batch);
          } catch (error) {
            entry.active = null;
            entry.inFlight = null;
            entry.lastError = error;
            entry.status = "error";
            settleBatch(batch, "reject", error);
            emit(entry);
            safeNotify("internal error", onSaveError, [batch.request, error, publicState(entry)]);
          } finally {
            entry.inFlight = null;
          }
        }
      } finally {
        entry.active = null;
        entry.inFlight = null;
        entry.draining = false;
        finishIdle(entry);
      }
    }

    function scheduleDrain(entry) {
      if (entry.draining || entry.drainScheduled) return;
      entry.drainScheduled = true;
      queueMicrotask(() => {
        drain(entry).catch((error) => {
          entry.active = null;
          entry.inFlight = null;
          entry.draining = false;
          entry.drainScheduled = false;
          entry.lastError = error;
          entry.status = "error";
          emit(entry);
          finishIdle(entry);
          try {
            logError("Note save drain failed", error);
          } catch (_) {
            // Logging must not produce another unhandled rejection.
          }
        });
      });
    }

    function startScheduledDrains(noteIds) {
      [...new Set(noteIds)].sort().forEach((noteId) => {
        const entry = entries.get(noteId);
        if (entry?.drainScheduled && !entry.draining) void drain(entry);
      });
    }

    function enqueueSave(request) {
      const resourceKey = requestResourceKey(request);
      if (!request || !resourceKey || !request.snapshot) throw new Error("valid save request is required");
      if (permanentlyDeletedNotes.has(resourceKey)) {
        return Promise.reject(permanentlyDeletedError(resourceKey));
      }
      const entry = ensureEntry(resourceKey, request.revision, false);
      if (entry.terminal) return Promise.reject(operationError(resourceKey, "NOTE_DELETING", "note is being permanently deleted"));
      if (entry.atomicBatch) return Promise.reject(operationError(resourceKey, "NOTE_BATCH_ACTIVE", "note is part of an atomic batch"));
      entry.currentRevision = Math.max(entry.currentRevision, normalizeRevision(request.revision));

      if (request.revision <= entry.lastSavedRevision) {
        return Promise.resolve({ request, state: publicState(entry), skipped: true });
      }

      if (entry.inFlight && request.revision <= entry.inFlight.request.revision) {
        return new Promise((resolve, reject) => entry.inFlight.waiters.push({ resolve, reject }));
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

    function runExclusive(noteIds, operation) {
      if (typeof operation !== "function") throw new Error("operation is required");
      const ids = [...new Set(noteIds || [])].filter(Boolean).sort();
      ids.forEach((noteId) => {
        if (permanentlyDeletedNotes.has(noteId)) throw permanentlyDeletedError(noteId);
        if (entries.get(noteId)?.terminal) throw operationError(noteId, "NOTE_DELETING", "note is being permanently deleted");
      });
      startScheduledDrains(ids);
      return withNoteLocks(ids, operation);
    }

    function beginAtomicBatch(noteIds) {
      const ids = [...new Set(noteIds || [])].filter(Boolean).sort();
      if (!ids.length) throw new Error("noteIds are required");
      const lockedEntries = ids.map((noteId) => {
        if (permanentlyDeletedNotes.has(noteId)) throw permanentlyDeletedError(noteId);
        const entry = ensureEntry(noteId, 0, true);
        if (entry.terminal) throw operationError(noteId, "NOTE_DELETING", "note is being permanently deleted");
        if (entry.atomicBatch) throw operationError(noteId, "NOTE_BATCH_ACTIVE", "note is already part of an atomic batch");
        return entry;
      });
      startScheduledDrains(ids);
      fallbackOperationId += 1;
      const token = Object.freeze({ id: `batch-${Date.now()}-${fallbackOperationId}`, noteIds: Object.freeze(ids) });
      lockedEntries.forEach((entry) => {
        entry.atomicBatch = { id: token.id, changeCount: 0 };
      });
      return token;
    }

    function requireAtomicBatch(token, noteId) {
      const entry = entries.get(noteId);
      if (!token || !entry || entry.atomicBatch?.id !== token.id || !token.noteIds?.includes(noteId)) {
        throw operationError(noteId, "NOTE_BATCH_INVALID", "atomic batch is not active for note");
      }
      return entry;
    }

    function markBatchChanged(token, noteId, revision = 0) {
      const entry = requireAtomicBatch(token, noteId);
      if (entry.terminal) throw operationError(noteId, "NOTE_DELETING", "note is being permanently deleted");
      entry.currentRevision = Math.max(entry.currentRevision, normalizeRevision(revision)) + 1;
      entry.atomicBatch.changeCount += 1;
      entry.status = "dirty";
      emit(entry);
      return entry.currentRevision;
    }

    function abortAtomicBatch(token) {
      if (!token?.noteIds) throw new Error("atomic batch token is required");
      return token.noteIds.map((noteId) => {
        if (permanentlyDeletedNotes.has(noteId) && !entries.has(noteId)) return null;
        const entry = requireAtomicBatch(token, noteId);
        entry.currentRevision = Math.max(entry.lastSavedRevision, entry.currentRevision - entry.atomicBatch.changeCount);
        entry.atomicBatch = null;
        entry.status = entry.lastError ? "error" : (entry.currentRevision === entry.lastSavedRevision ? "saved" : "dirty");
        emit(entry);
        finishIdle(entry);
        return publicState(entry);
      }).filter(Boolean);
    }

    function completeAtomicBatch(token) {
      if (!token?.noteIds) throw new Error("atomic batch token is required");
      return token.noteIds.map((noteId) => {
        if (permanentlyDeletedNotes.has(noteId) && !entries.has(noteId)) return null;
        const entry = requireAtomicBatch(token, noteId);
        entry.atomicBatch = null;
        entry.status = entry.currentRevision === entry.lastSavedRevision ? "saved" : "dirty";
        emit(entry);
        finishIdle(entry);
        return publicState(entry);
      }).filter(Boolean);
    }

    function enqueueBatchSave({ batch, noteIds, createRequests, validateBeforeWrite, writeSnapshots } = {}) {
      const ids = [...new Set(noteIds || [])].filter(Boolean).sort();
      if (!ids.length) return Promise.resolve([]);
      if (typeof createRequests !== "function") throw new Error("createRequests is required");
      if (validateBeforeWrite != null && typeof validateBeforeWrite !== "function") throw new Error("validateBeforeWrite must be a function");
      if (typeof writeSnapshots !== "function") throw new Error("writeSnapshots is required");
      if (!batch || batch.noteIds.length !== ids.length || ids.some((id) => !batch.noteIds.includes(id))) {
        throw new Error("matching atomic batch token is required");
      }
      ids.forEach((id) => requireAtomicBatch(batch, id));

      return runExclusive(ids, async () => {
        ids.forEach((id) => requireAtomicBatch(batch, id));
        if (validateBeforeWrite) validateBeforeWrite();
        const requests = createRequests();
        if (!Array.isArray(requests) || requests.length !== ids.length) throw new Error("one request per noteId is required");
        const byId = new Map(requests.map((request) => [requestResourceKey(request), request]));
        if (byId.size !== ids.length || ids.some((id) => !byId.has(id))) throw new Error("batch request noteIds must match");
        const notificationContext = Object.freeze({ batch });

        ids.forEach((id) => {
          const request = byId.get(id);
          const entry = ensureEntry(id, request.revision, false);
          entry.currentRevision = Math.max(entry.currentRevision, normalizeRevision(request.revision));
          entry.active = { request, waiters: [] };
          entry.status = "saving";
          emit(entry);
        });

        let writeError = null;
        let writtenSnapshots = null;
        try {
          const writeResult = await writeSnapshots(requests.map((request) => request.snapshot), requests);
          if (Array.isArray(writeResult)) {
            writtenSnapshots = new Map(writeResult
              .filter((snapshot) => snapshot && snapshot.id)
              .map((snapshot) => [snapshot.id, snapshot]));
          }
        } catch (error) {
          writeError = error;
        }

        const results = requests.map((request) => {
          const entry = entries.get(request.noteId);
          if (writeError) {
            entry.lastError = writeError;
            entry.status = "error";
          } else {
            entry.lastSavedRevision = Math.max(entry.lastSavedRevision, request.revision);
            entry.lastError = null;
            entry.status = entry.currentRevision === entry.lastSavedRevision ? "saved" : "dirty";
          }
          entry.active = null;
          const state = publicState(entry);
          emit(entry);
          if (writeError) safeNotify("error", onSaveError, [request, writeError, state, notificationContext]);
          else safeNotify("success", onSaveSuccess, [request, state, notificationContext]);
          finishIdle(entry);
          return {
            request,
            state,
            savedSnapshot: writtenSnapshots?.get(request.noteId) || request.snapshot
          };
        });
        if (writeError?.code === "NOTE_PERMANENTLY_DELETED") {
          finishPermanentDeletion([writeError.noteId], writeError.tombstone);
        }
        if (writeError) throw writeError;
        return results;
      });
    }

    function finishPermanentDeletion(noteIds, tombstone = {}) {
      const ids = [...new Set(noteIds || [])].filter(Boolean).sort();
      ids.forEach((noteId) => {
        const metadata = {
          deletionId: tombstone?.deletionId || tombstone?.id || null,
          deletedAt: tombstone?.deletedAt || null
        };
        permanentlyDeletedNotes.set(noteId, metadata);
        const entry = entries.get(noteId);
        if (!entry) return;
        const error = permanentlyDeletedError(noteId);
        if (entry.pending) {
          settleBatch(entry.pending, "reject", error);
          entry.pending = null;
        }
        const waiters = entry.idleWaiters.splice(0);
        entries.delete(noteId);
        waiters.forEach((resolve) => resolve(null));
      });
    }

    function beginExternalTerminalDelete(noteIds, tombstone = {}) {
      const ids = [...new Set(noteIds || [])].filter(Boolean).sort();
      ids.forEach((noteId) => {
        if (permanentlyDeletedNotes.has(noteId)) return;
        const entry = ensureEntry(noteId, 0, true);
        entry.terminal = {
          id: tombstone.deletionId || tombstone.id || null,
          deletedAt: tombstone.deletedAt || null,
          external: true
        };
        emit(entry);
      });
    }

    function abortExternalTerminalDelete(noteIds, deletionId) {
      [...new Set(noteIds || [])].filter(Boolean).forEach((noteId) => {
        const entry = entries.get(noteId);
        if (!entry?.terminal?.external || (deletionId && entry.terminal.id !== deletionId)) return;
        entry.terminal = null;
        entry.status = entry.lastError ? "error" : (entry.currentRevision === entry.lastSavedRevision ? "saved" : "dirty");
        emit(entry);
        finishIdle(entry);
      });
    }

    async function runTerminalDelete(noteIds, operation, options = {}) {
      if (typeof operation !== "function") throw new Error("operation is required");
      const ids = [...new Set(noteIds || [])].filter(Boolean).sort();
      if (!ids.length) return;
      const lockedEntries = ids.map((noteId) => {
        if (permanentlyDeletedNotes.has(noteId)) throw permanentlyDeletedError(noteId);
        const entry = ensureEntry(noteId, 0, true);
        if (entry.terminal) throw operationError(noteId, "NOTE_DELETING", "note is being permanently deleted");
        if (entry.atomicBatch) throw operationError(noteId, "NOTE_BATCH_ACTIVE", "note is part of an atomic batch");
        return entry;
      });
      startScheduledDrains(ids);
      fallbackOperationId += 1;
      const terminalId = options.deletionId || `delete-${Date.now()}-${fallbackOperationId}`;
      lockedEntries.forEach((entry) => {
        entry.terminal = { id: terminalId };
        emit(entry);
      });

      try {
        const result = await withNoteLocks(ids, operation);
        finishPermanentDeletion(ids, { deletionId: terminalId, deletedAt: options.deletedAt || null });
        return result;
      } catch (error) {
        lockedEntries.forEach((entry) => {
          entry.terminal = null;
          entry.status = entry.lastError ? "error" : (entry.currentRevision === entry.lastSavedRevision ? "saved" : "dirty");
          emit(entry);
          finishIdle(entry);
        });
        throw error;
      }
    }

    function getState(noteId) {
      const entry = entries.get(noteId);
      return entry ? publicState(entry) : null;
    }

    function isDirty(noteId) {
      return Boolean(getState(noteId)?.dirty);
    }

    function isTerminal(noteId) {
      return permanentlyDeletedNotes.has(noteId) || Boolean(entries.get(noteId)?.terminal);
    }

    function terminalError(noteId) {
      if (permanentlyDeletedNotes.has(noteId)) return permanentlyDeletedError(noteId);
      if (entries.get(noteId)?.terminal) return operationError(noteId, "NOTE_DELETING", "note is being permanently deleted");
      return null;
    }

    function whenIdle(noteId) {
      const entry = entries.get(noteId);
      if (!entry || (!entry.draining && !entry.drainScheduled && !entry.active && !entry.inFlight && !entry.pending && !entry.reservations && !entry.atomicBatch && !entry.terminal)) {
        return Promise.resolve(entry ? publicState(entry) : null);
      }
      return new Promise((resolve) => entry.idleWaiters.push(resolve));
    }

    function forgetNote(noteId) {
      const entry = entries.get(noteId);
      if (entry && (entry.draining || entry.drainScheduled || entry.active || entry.inFlight || entry.pending || entry.reservations)) {
        throw new Error("cannot forget a busy note");
      }
      entries.delete(noteId);
    }

    return {
      abortAtomicBatch,
      abortExternalTerminalDelete,
      beginAtomicBatch,
      beginExternalTerminalDelete,
      completeAtomicBatch,
      finishPermanentDeletion,
      enqueueBatchSave,
      enqueueSave,
      forgetNote,
      getState,
      isDirty,
      isTerminal,
      markBatchChanged,
      markChanged,
      registerNote,
      runExclusive,
      runTerminalDelete,
      terminalError,
      whenIdle
    };
  }

  const api = { cloneSnapshot, createNoteSaveFoundation, createSaveRequest, normalizeRevision };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusNoteSaveFoundation = api;
})(typeof window !== "undefined" ? window : globalThis);
