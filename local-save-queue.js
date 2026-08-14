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

  const api = { createLocalSaveQueue };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusLocalSaveQueue = api;
})(typeof window !== "undefined" ? window : globalThis);
