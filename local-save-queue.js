(function initLocalSaveQueue(globalScope) {
  "use strict";

  function createLocalSaveQueue(run, delay = 350) {
    let timer = null;
    let tail = Promise.resolve();
    let waiting = [];
    let pendingReason = "change";

    function start() {
      if (!waiting.length) return tail;
      const batch = waiting;
      waiting = [];
      const reason = pendingReason;
      const execution = tail.catch(() => undefined).then(() => run(reason));
      tail = execution;
      execution.then(
        (value) => batch.forEach(({ resolve }) => resolve(value)),
        (error) => batch.forEach(({ reject }) => reject(error))
      );
      return tail;
    }

    function enqueue(reason = "change") {
      pendingReason = reason;
      clearTimeout(timer);
      const promise = new Promise((resolve, reject) => waiting.push({ resolve, reject }));
      timer = setTimeout(() => {
        timer = null;
        start();
      }, delay);
      return promise;
    }

    function flush(reason) {
      if (reason) pendingReason = reason;
      clearTimeout(timer);
      timer = null;
      start();
      return tail;
    }

    return { enqueue, flush, hasPending: () => Boolean(timer || waiting.length) };
  }

  async function runLocalScanAfterQueue({ queue, scan, reason = "before-scan", onSaveError = () => {} }) {
    try {
      await queue.flush(reason);
    } catch (error) {
      onSaveError(error);
    }
    return scan();
  }

  async function runLocalReconnectSequence({
    requestPermission,
    onPermissionGranted = () => {},
    scan,
    shouldSave = () => false,
    save
  }) {
    async function runStage(stage, task) {
      try {
        return await task();
      } catch (error) {
        if (error && typeof error === "object" && !error.localSaveStage) error.localSaveStage = stage;
        throw error;
      }
    }

    const permission = await runStage("permission", requestPermission);
    if (permission !== "granted") {
      return { permission, scanResult: null, saveAttempted: false, saved: false };
    }
    await runStage("permission", onPermissionGranted);
    const scanResult = await runStage("scan", scan);
    if (!shouldSave(scanResult)) {
      return { permission, scanResult, saveAttempted: false, saved: false };
    }
    const saved = await runStage("save", save);
    return { permission, scanResult, saveAttempted: true, saved };
  }

  const api = { createLocalSaveQueue, runLocalReconnectSequence, runLocalScanAfterQueue };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusLocalSaveQueue = api;
})(typeof window !== "undefined" ? window : globalThis);
