(function (globalScope) {
  "use strict";

  function createWebFontLoader({
    fontLookup,
    documentObject = globalScope?.document,
    FontFaceClass = globalScope?.FontFace,
    onStateChange = () => {}
  } = {}) {
    const states = new Map();
    const stylesheetPromises = new Map();

    function emptyState() {
      return {
        loadedWeights: new Set(),
        loadingWeights: new Set(),
        failedWeights: new Set(),
        promises: new Map(),
        errors: new Map()
      };
    }

    function stateStatus(state) {
      if (state.loadingWeights.size) return "loading";
      if (state.failedWeights.size) return "error";
      if (state.loadedWeights.size) return "loaded";
      return "idle";
    }

    function sortedWeights(values) {
      return [...values].sort((first, second) => first - second);
    }

    function publicState(fontId) {
      const state = states.get(fontId);
      if (!state) return { status: "idle", loadedWeights: [], loadingWeights: [], failedWeights: [], error: null };
      const errors = sortedWeights(state.failedWeights).map((weight) => state.errors.get(weight)).filter(Boolean);
      return {
        status: stateStatus(state),
        loadedWeights: sortedWeights(state.loadedWeights),
        loadingWeights: sortedWeights(state.loadingWeights),
        failedWeights: sortedWeights(state.failedWeights),
        error: errors[0] || null
      };
    }

    function getStates() {
      return [...states.keys()].map((fontId) => ({ fontId, ...publicState(fontId) }));
    }

    function emit(fontId) {
      onStateChange(fontId, publicState(fontId));
    }

    function loadStylesheet(url) {
      if (stylesheetPromises.has(url)) return stylesheetPromises.get(url);
      const promise = new Promise((resolve, reject) => {
        const link = documentObject.createElement("link");
        link.rel = "stylesheet";
        link.href = url;
        link.dataset.memoNexusWebFont = url;
        link.onload = resolve;
        link.onerror = () => {
          link.remove?.();
          stylesheetPromises.delete(url);
          reject(new Error("配布元のCSSを取得できませんでした"));
        };
        documentObject.head.appendChild(link);
      });
      stylesheetPromises.set(url, promise);
      return promise;
    }

    function loadStylesheetFont(font, weight) {
      return loadStylesheet(font.loading.url).then(async () => {
        if (documentObject.fonts?.load) {
          await documentObject.fonts.load(`${weight} 1em "${font.loading.family}"`);
        }
      });
    }

    function loadFontFace(font, weight) {
      if (!FontFaceClass || !documentObject.fonts?.add) return Promise.reject(new Error("FontFace APIを利用できません"));
      const url = font.loading.files?.[weight];
      if (!url) return Promise.reject(new Error("WebフォントのWeight設定が不正です"));
      const face = new FontFaceClass(font.loading.family, `url(${url}) format("opentype")`, {
        weight: String(weight),
        style: "normal",
        display: "swap"
      });
      return face.load().then((loadedFace) => documentObject.fonts.add(loadedFace));
    }

    function normalizedWeights(weights) {
      return [...new Set((Array.isArray(weights) ? weights : [weights])
        .map(Number)
        .filter((weight) => weight === 400 || weight === 700))].sort((first, second) => first - second);
    }

    function requestFont(fontId, weights) {
      const font = typeof fontLookup === "function" ? fontLookup(fontId) : null;
      if (!font) return Promise.resolve({ ...publicState(fontId), status: "error", error: "未登録のフォントです" });
      if (font.sourceType !== "web") return Promise.resolve(publicState(fontId));
      const requestedWeights = normalizedWeights(weights);
      if (!requestedWeights.length) return Promise.resolve(publicState(fontId));

      const state = states.get(fontId) || emptyState();
      states.set(fontId, state);
      let started = false;
      const operations = requestedWeights.map((weight) => {
        if (state.loadedWeights.has(weight)) return Promise.resolve();
        if (state.promises.has(weight)) return state.promises.get(weight);
        started = true;
        state.loadingWeights.add(weight);
        const operation = font.loading?.type === "stylesheet"
          ? loadStylesheetFont(font, weight)
          : font.loading?.type === "font-face"
            ? loadFontFace(font, weight)
            : Promise.reject(new Error("Webフォントの読込設定が不正です"));
        const tracked = operation.then(() => {
          state.loadedWeights.add(weight);
          state.failedWeights.delete(weight);
          state.errors.delete(weight);
        }).catch((error) => {
          state.failedWeights.add(weight);
          state.errors.set(weight, error?.message || String(error));
        }).finally(() => {
          state.loadingWeights.delete(weight);
          state.promises.delete(weight);
          emit(fontId);
        });
        state.promises.set(weight, tracked);
        return tracked;
      });
      if (started) emit(fontId);
      return Promise.all(operations).then(() => publicState(fontId));
    }

    return { getState: publicState, getStates, requestFont };
  }

  const api = { createWebFontLoader };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusWebFontLoader = api;
})(typeof window !== "undefined" ? window : globalThis);
