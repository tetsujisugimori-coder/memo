(function initNoteTombstone(globalScope) {
  "use strict";

  const DEFAULT_STORE_NAME = "note-tombstones";
  const ERROR_CODE = "NOTE_PERMANENTLY_DELETED";
  const transactionErrors = new WeakMap();

  function uniqueNoteIds(noteIds) {
    return [...new Set((noteIds || []).filter(Boolean).map(String))].sort();
  }

  function installStore(database, storeName = DEFAULT_STORE_NAME) {
    if (!database.objectStoreNames.contains(storeName)) {
      const store = database.createObjectStore(storeName, { keyPath: "noteId" });
      store.createIndex("deletedAt", "deletedAt");
    }
  }

  function createError(noteId, tombstone) {
    const error = new Error("このメモは完全削除済みのため保存できません");
    error.code = ERROR_CODE;
    error.noteId = String(noteId);
    error.tombstone = tombstone || null;
    return error;
  }

  function transactionError(transaction, fallbackMessage = "メモの保存に失敗しました") {
    return transactionErrors.get(transaction) || transaction.error || new Error(fallbackMessage);
  }

  // Tombstone の確認と notes への書き込みを同一トランザクション内で直列化します。
  function guardWrites(transaction, noteIds, onAllowed, storeName = DEFAULT_STORE_NAME) {
    if (!transaction || typeof transaction.objectStore !== "function") throw new Error("transaction is required");
    if (typeof onAllowed !== "function") throw new Error("onAllowed is required");
    const ids = uniqueNoteIds(noteIds);
    const tombstoneStore = transaction.objectStore(storeName);
    let index = 0;

    const checkNext = () => {
      if (index >= ids.length) {
        onAllowed();
        return;
      }
      const noteId = ids[index++];
      const request = tombstoneStore.get(noteId);
      request.onsuccess = () => {
        if (!request.result) {
          checkNext();
          return;
        }
        transactionErrors.set(transaction, createError(noteId, request.result));
        try {
          transaction.abort();
        } catch (_) {
          // The transaction may already be aborting; its abort handler returns the saved error.
        }
      };
      request.onerror = () => {
        transactionErrors.set(transaction, request.error || new Error("完全削除情報を確認できませんでした"));
      };
    };

    checkNext();
  }

  function normalizeTombstone(value) {
    if (!value?.noteId || !value?.deletionId || !value?.deletedAt) throw new Error("valid tombstone is required");
    const tombstone = {
      noteId: String(value.noteId),
      deletionId: String(value.deletionId),
      deletedAt: String(value.deletedAt),
      schemaVersion: 1
    };
    if (value.source) tombstone.source = String(value.source);
    return tombstone;
  }

  function putTombstones(transaction, tombstones, storeName = DEFAULT_STORE_NAME) {
    const store = transaction.objectStore(storeName);
    return (tombstones || []).map((value) => {
      const tombstone = normalizeTombstone(value);
      store.put(tombstone);
      return tombstone;
    });
  }

  function writeAttachments({ database, items, attachmentStoreName = "attachments", tombstoneStoreName = DEFAULT_STORE_NAME } = {}) {
    if (!database || typeof database.transaction !== "function") return Promise.reject(new Error("database is required"));
    const attachments = Array.isArray(items) ? items : [];
    const invalid = attachments.find((item) => !String(item?.memoId || "").trim());
    if (invalid) {
      const error = new Error("attachment memoId is required");
      error.code = "ATTACHMENT_MEMO_ID_REQUIRED";
      error.attachmentId = invalid?.id || null;
      return Promise.reject(error);
    }
    if (!attachments.length) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = database.transaction([attachmentStoreName, tombstoneStoreName], "readwrite");
        const attachmentStore = transaction.objectStore(attachmentStoreName);
        guardWrites(transaction, attachments.map((item) => item.memoId), () => {
          attachments.forEach((item) => attachmentStore.put(item));
        }, tombstoneStoreName);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(attachments);
      transaction.onerror = () => reject(transactionError(transaction, "添付ファイルの保存に失敗しました"));
      transaction.onabort = () => reject(transactionError(transaction, "添付ファイルの保存を安全のため中止しました"));
    });
  }

  const api = {
    DEFAULT_STORE_NAME,
    ERROR_CODE,
    createError,
    guardWrites,
    installStore,
    normalizeTombstone,
    putTombstones,
    transactionError,
    uniqueNoteIds,
    writeAttachments
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusNoteTombstone = api;
})(typeof window !== "undefined" ? window : globalThis);
