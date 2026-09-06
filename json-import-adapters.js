(function exposeJsonImportAdapters(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MemoJsonImportAdapters = api;
}(typeof globalThis === "object" ? globalThis : this, function createJsonImportAdaptersApi() {
  "use strict";

  function createLangBenchResultAdapter({ buildNote }) {
    return {
      id: "langbench-result",
      priority: 10,
      canHandle(payload) {
        return Boolean(payload && typeof payload === "object" && payload.type === "langbench_result");
      },
      convert(payload) {
        return {
          ...buildNote(payload),
          importMessage: "LangBench Result を取り込みました。"
        };
      }
    };
  }

  function createLegacyItNewsAdapter({ buildPastedNote, buildFileNote }) {
    return {
      id: "legacy-it-news",
      priority: 1000,
      canHandle(payload) {
        return Boolean(payload && typeof payload === "object" && Array.isArray(payload.items));
      },
      convert(payload, context) {
        if (context && context.source === "file") {
          return {
            ...buildFileNote(payload, context),
            importMessage: "JSONから1件のニュースメモを作成しました"
          };
        }
        return {
          ...buildPastedNote(payload),
          importMessage: "JSONから1件のニュースメモを作成しました"
        };
      }
    };
  }

  return { createLangBenchResultAdapter, createLegacyItNewsAdapter };
}));
