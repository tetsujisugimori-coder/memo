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

    function publicState(fontId) {
      const state = states.get(fontId);
      return state ? { status: state.status, error: state.error || null } : { status: "idle", error: null };
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

    function loadStylesheetFont(font) {
      return loadStylesheet(font.loading.url).then(async () => {
        if (documentObject.fonts?.load) {
          await Promise.all([400, 700].map((weight) => documentObject.fonts.load(`${weight} 1em "${font.loading.family}"`)));
        }
      });
    }

    function loadFontFaces(font) {
      if (!FontFaceClass || !documentObject.fonts?.add) return Promise.reject(new Error("FontFace APIを利用できません"));
      return Promise.all(Object.entries(font.loading.files).map(([weight, url]) => {
        const face = new FontFaceClass(font.loading.family, `url(${url}) format("opentype")`, {
          weight: String(weight),
          style: "normal",
          display: "swap"
        });
        return face.load().then((loadedFace) => documentObject.fonts.add(loadedFace));
      }));
    }

    function requestFont(fontId) {
      const font = typeof fontLookup === "function" ? fontLookup(fontId) : null;
      if (!font) return Promise.resolve({ status: "error", error: "未登録のフォントです" });
      if (font.sourceType !== "web") return Promise.resolve({ status: "idle", error: null });
      const current = states.get(fontId);
      if (current?.status === "loading" || current?.status === "loaded") return current.promise;

      const state = { status: "loading", error: null, promise: null };
      states.set(fontId, state);
      emit(fontId);
      const operation = font.loading?.type === "stylesheet"
        ? loadStylesheetFont(font)
        : font.loading?.type === "font-face"
          ? loadFontFaces(font)
          : Promise.reject(new Error("Webフォントの読込設定が不正です"));
      state.promise = operation.then(() => {
        state.status = "loaded";
        state.error = null;
        emit(fontId);
        return publicState(fontId);
      }).catch((error) => {
        state.status = "error";
        state.error = error?.message || String(error);
        emit(fontId);
        return publicState(fontId);
      });
      return state.promise;
    }

    return { getState: publicState, getStates, requestFont };
  }

  const api = { createWebFontLoader };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusWebFontLoader = api;
})(typeof window !== "undefined" ? window : globalThis);
