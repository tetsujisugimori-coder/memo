(function initIndexedDbLifecycle(globalScope) {
  "use strict";

  function openManagedDatabase({
    indexedDB,
    name,
    version,
    upgrade,
    onBlocked,
    onVersionChange
  }) {
    return new Promise((resolve, reject) => {
      if (!indexedDB || typeof indexedDB.open !== "function") {
        reject(new Error("IndexedDBを利用できません"));
        return;
      }

      let request;
      try {
        request = indexedDB.open(name, version);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = (event) => {
        if (typeof upgrade === "function") upgrade(request.result, event, request.transaction);
      };
      request.onblocked = (event) => {
        if (typeof onBlocked === "function") onBlocked(event);
      };
      request.onerror = () => reject(request.error || new Error("IndexedDBを開けませんでした"));
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = (event) => {
          try {
            if (typeof onVersionChange === "function") onVersionChange(event, database);
          } finally {
            database.close();
          }
        };
        resolve(database);
      };
    });
  }

  async function runGuardedStartup({ start, onLoading, onReady, onFailure }) {
    if (typeof onLoading === "function") onLoading();
    try {
      const result = await start();
      if (typeof onReady === "function") onReady(result);
      return { ok: true, result };
    } catch (error) {
      if (typeof onFailure === "function") onFailure(error);
      return { ok: false, error };
    }
  }

  function startupFailureReason(error) {
    if (error?.name === "VersionError") return "このタブより新しい保存形式が使われています。ページを再読み込みしてください。";
    if (error?.name === "QuotaExceededError") return "ブラウザの保存領域に空きがない可能性があります。";
    if (["InvalidStateError", "NotReadableError"].includes(error?.name)) return "ブラウザの保存領域を開けませんでした。別のタブを閉じてから再試行してください。";
    return "ブラウザ内の保存領域を開けませんでした。";
  }

  const api = { openManagedDatabase, runGuardedStartup, startupFailureReason };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusIndexedDbLifecycle = api;
})(typeof window !== "undefined" ? window : globalThis);
