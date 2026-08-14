(function initManualLocalSave(globalScope) {
  "use strict";

  async function runManualLocalSave({
    flushBrowserSave,
    waitForLocalSave,
    scan,
    hasBlockingCandidates,
    requestLocalSave,
    flushLocalSave,
    onPreviousSaveError,
    scanAfterSaveError
  }) {
    await flushBrowserSave();
    try {
      await waitForLocalSave();
    } catch (error) {
      if (typeof onPreviousSaveError === "function") onPreviousSaveError(error);
    }

    const analysis = await scan();
    if (hasBlockingCandidates(analysis)) return { saved: false, blocked: true, analysis };

    requestLocalSave();
    try {
      const result = await flushLocalSave();
      return { saved: result !== false, blocked: false, analysis, result };
    } catch (error) {
      if (typeof scanAfterSaveError === "function") await scanAfterSaveError(error);
      throw error;
    }
  }

  const api = { runManualLocalSave };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusManualLocalSave = api;
})(typeof window !== "undefined" ? window : globalThis);
