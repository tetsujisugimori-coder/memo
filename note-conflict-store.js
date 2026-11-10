(function initNoteConflictStore(globalScope) {
  "use strict";
  const STORE = "note-conflicts";

  // Only an absent field on an existing legacy record has the documented v6
  // initial generation 0. Null, strings, negative and unsafe integers are invalid.
  function revisionOf(note) {
    if (!note) return null;
    if (!Object.hasOwn(note, "revision")) return 0;
    return Number.isSafeInteger(note.revision) && note.revision >= 0 ? note.revision : undefined;
  }

  function installStore(database) {
    if (database.objectStoreNames.contains(STORE)) return;
    const store = database.createObjectStore(STORE, { keyPath: "id" });
    store.createIndex("noteId", "noteId");
  }

  function conflictRecords(note, base, committed, requestId, ownerId, now = Date.now()) {
    const common = { noteId: note.id, requestId, ownerId, createdAt: now, schemaVersion: 1 };
    return {
      draft: { ...common, id: `draft:${requestId}`, kind: "memo-conflict-draft",
        body: note.body, title: note.title, snapshot: note, baseBody: base?.body ?? "",
        baseRevision: revisionOf(base) ?? null, committedRevision: revisionOf(committed) ?? null },
      receipt: { ...common, id: `rejection:${requestId}`, kind: "memo-conflict-rejection",
        expectedRevision: revisionOf(base) ?? null, committedRevision: revisionOf(committed) ?? null,
        attemptedBody: note.body, committedBody: committed?.body ?? "", committedSnapshot: committed || null }
    };
  }

  function conflictError(note, records, preserved, cause = null) {
    return Object.assign(new Error(preserved
      ? "別のタブでこのメモが更新されました。保存を停止し、原稿を保全しました。"
      : "保存競合を検出しましたが原稿を保全できませんでした。このタブを閉じず、原稿を書き出してください。"), {
      code: preserved ? "NOTE_SAVE_CONFLICT" : "NOTE_CONFLICT_PRESERVATION_FAILED",
      noteId: note.id, conflictDetected: true, preserved, recovery: records, cause
    });
  }

  function stageRecovery(transaction, records, abort) {
    const recovery = transaction.objectStore(STORE);
    for (const [slot, record] of Object.entries(records)) {
      const existing = recovery.get(record.id);
      existing.onsuccess = () => {
        try {
          if (!existing.result) { recovery.add(record); return; }
          const previous = existing.result;
          const fields = slot === "draft"
            ? ["id", "schemaVersion", "kind", "noteId", "requestId", "body", "title", "baseBody", "baseRevision", "parentRequestId"]
            : ["id", "schemaVersion", "kind", "noteId", "requestId", "expectedRevision", "attemptedBody"];
          if (!fields.every((field) => previous[field] === record[field])
            || (slot === "draft" ? !["id", "body", "title", "revision"].every((field) => previous.snapshot?.[field] === record.snapshot?.[field])
              : !validReceipt(previous))) {
            throw new Error("回復原稿の識別子が競合しました。原稿を書き出してください。");
          }
          records[slot] = previous;
        } catch (error) { abort(error); }
      };
    }
  }

  function validReceipt(receipt) {
    const committed = receipt?.committedSnapshot;
    return Boolean(receipt && receipt.kind === "memo-conflict-rejection" && receipt.schemaVersion === 1
      && receipt.id === `rejection:${receipt.requestId}` && typeof receipt.attemptedBody === "string"
      && (committed ? committed.id === receipt.noteId && committed.body === receipt.committedBody
        && (revisionOf(committed) ?? null) === receipt.committedRevision
        : receipt.committedRevision === null && receipt.committedBody === ""));
  }

  function validRecovery({ draft, receipt } = {}, requestId) {
    return Boolean(draft && validReceipt(receipt) && draft.kind === "memo-conflict-draft" && draft.schemaVersion === 1
      && draft.id === `draft:${requestId}` && draft.noteId === receipt.noteId
      && draft.requestId === requestId && receipt.requestId === requestId
      && typeof draft.body === "string" && draft.body === receipt.attemptedBody && draft.baseRevision === receipt.expectedRevision
      && draft.snapshot?.id === draft.noteId && draft.snapshot.body === draft.body && draft.snapshot.title === draft.title);
  }

  function matches(base, committed, noteId) {
    const current = revisionOf(committed), expected = revisionOf(base);
    return base !== undefined && current !== undefined && expected !== undefined && current === expected
      && (!committed || (base?.id === noteId && base.body === committed.body && base.title === committed.title));
  }

  function writeNote({ database, note, base, requestId, ownerId, guard, transactionError,
    merge = (incoming) => incoming, resolveRequestId = null }) {
    return new Promise((resolve, reject) => {
      let transaction, prepared, records, failure;
      const abort = (error) => { failure = error; try { transaction.abort(); } catch {} };
      try {
        transaction = database.transaction(["notes", "note-tombstones", STORE], "readwrite");
        transaction.oncomplete = () => records ? reject(conflictError(note, records, true)) : resolve(prepared);
        transaction.onabort = () => {
          const cause = failure || transactionError?.(transaction) || transaction.error || new Error("保存transactionを中止しました");
          reject(records ? conflictError(note, records, false, cause) : cause);
        };
        // Request errors normally abort the transaction; success is never
        // inferred here, and error is reported only after the abort boundary.
        transaction.onerror = () => { failure ||= transaction.error; };
        const store = transaction.objectStore("notes");
        guard(transaction, [note.id], () => {
          const read = store.get(note.id);
          read.onsuccess = () => {
            try {
              const committed = read.result;
              const current = revisionOf(committed);
              if (!matches(base, committed, note.id)) {
                records = conflictRecords(note, base, committed, requestId, ownerId);
                if (resolveRequestId) records.draft.parentRequestId = resolveRequestId;
                // Same request ID overwrites the same two records on retry.
                // Existing recovery records from other attempts are untouched.
                stageRecovery(transaction, records, abort);
                return;
              }
              if (!Number.isSafeInteger(note.revision) || note.revision < 0 || (current != null && current >= Number.MAX_SAFE_INTEGER)) {
                return abort(Object.assign(new Error("保存世代が不正です。原稿を書き出して保全してください。"), { code: "INVALID_NOTE_REVISION" }));
              }
              prepared = merge({ ...committed, ...note, revision: Math.max(note.revision, current == null ? 0 : current + 1) }, committed);
              store.put(prepared);
              if (resolveRequestId) {
                const recovery = transaction.objectStore(STORE);
                const seen = new Set();
                const markResolved = (id) => {
                  if (seen.has(id)) return;
                  if (seen.size >= 128) return abort(new Error("回復履歴が多いため安全に確定できません。原稿を書き出してください。"));
                  seen.add(id);
                  for (const prefix of ["draft:", "rejection:"]) {
                    const readRecovery = recovery.get(prefix + id);
                    readRecovery.onsuccess = () => {
                      try {
                        const record = readRecovery.result;
                        if (record?.noteId !== note.id) return;
                        recovery.put({ ...record, resolvedAt: Date.now(), resolvedRevision: prepared.revision });
                        if (prefix === "draft:" && record.parentRequestId) markResolved(record.parentRequestId);
                      } catch (error) { abort(error); }
                    };
                  }
                };
                markResolved(resolveRequestId);
              }
            } catch (error) { abort(error); }
          };
        });
      } catch (error) {
        if (transaction) abort(error); else reject(error);
      }
    });
  }

  function readDrafts(database, noteId = null) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const store = transaction.objectStore(STORE);
      const request = noteId ? store.index("noteId").getAll(noteId) : store.getAll();
      transaction.oncomplete = () => resolve(request.result.filter((row) => row.kind === "memo-conflict-draft" && !row.resolvedAt)
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)));
      transaction.onabort = () => reject(transaction.error || new Error("保全原稿を読めませんでした"));
    });
  }

  function readRecovery(database, requestId) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly"), store = transaction.objectStore(STORE);
      const draft = store.get(`draft:${requestId}`), receipt = store.get(`rejection:${requestId}`);
      transaction.oncomplete = () => {
        const held = draft.result, rejected = receipt.result;
        if (!validRecovery({ draft: held, receipt: rejected }, requestId)) {
          return reject(new Error("保全原稿と競合記録を確認できません。原稿の整合性は未確認です。"));
        }
        resolve({ draft: draft.result, receipt: receipt.result });
      };
      transaction.onabort = () => reject(transaction.error || new Error("保全原稿を読めませんでした"));
    });
  }

  const api = { STORE, revisionOf, matches, installStore, conflictRecords, conflictError, stageRecovery, validRecovery, writeNote, readDrafts, readRecovery };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusNoteConflictStore = api;
})(typeof window !== "undefined" ? window : globalThis);
