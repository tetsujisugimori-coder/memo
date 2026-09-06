(function exposeJsonImportRouter(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MemoJsonImportRouter = api;
}(typeof globalThis === "object" ? globalThis : this, function createJsonImportRouterApi() {
  "use strict";

  const INVALID_JSON_MESSAGE = "JSONの読み込みに失敗しました。JSONの構文を確認してください。";
  const INVALID_ROOT_MESSAGE = "JSONのルートはオブジェクトにしてください。";
  const UNSUPPORTED_JSON_MESSAGE = "対応していないJSON形式です。JSONの形式または取り込み元アプリを確認してください。";

  function compareAdapters(left, right) {
    return (Number(left.priority) || 0) - (Number(right.priority) || 0);
  }

  function validateAdapter(adapter) {
    if (!adapter || typeof adapter !== "object" || !adapter.id) {
      throw new Error("JSON取り込みアダプターには id が必要です。");
    }
    if (typeof adapter.canHandle !== "function" || typeof adapter.convert !== "function") {
      throw new Error(`JSON取り込みアダプター ${adapter.id} には canHandle() と convert() が必要です。`);
    }
  }

  function createJsonImportRouter(initialAdapters = []) {
    const adapters = [];

    function registerAdapter(adapter) {
      validateAdapter(adapter);
      if (adapters.some((registered) => registered.id === adapter.id)) {
        throw new Error(`JSON取り込みアダプター ${adapter.id} はすでに登録されています。`);
      }
      adapters.push(adapter);
      adapters.sort(compareAdapters);
      return adapter;
    }

    function findAdapter(payload) {
      return adapters.find((adapter) => adapter.canHandle(payload)) || null;
    }

    function convert(payload, context) {
      const adapter = findAdapter(payload);
      if (!adapter) return null;
      const converted = adapter.convert(payload, context || {});
      if (!converted || typeof converted !== "object") {
        throw new Error(`JSON取り込みアダプター ${adapter.id} の変換結果が不正です。`);
      }
      return { adapterId: adapter.id, ...converted };
    }

    initialAdapters.forEach(registerAdapter);
    return { registerAdapter, findAdapter, convert };
  }

  function parseJsonImportText(text, router, context) {
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(INVALID_JSON_MESSAGE);
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(INVALID_ROOT_MESSAGE);
    }

    const converted = router.convert(payload, context);
    if (!converted) throw new Error(UNSUPPORTED_JSON_MESSAGE);
    return converted;
  }

  return {
    INVALID_JSON_MESSAGE,
    INVALID_ROOT_MESSAGE,
    UNSUPPORTED_JSON_MESSAGE,
    createJsonImportRouter,
    parseJsonImportText
  };
}));
