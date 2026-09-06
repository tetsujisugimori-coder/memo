"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const routerApi = require("./json-import-router.js");
const adaptersApi = require("./json-import-adapters.js");

function createExistingAdapters() {
  return [
    adaptersApi.createLangBenchResultAdapter({
      buildNote: (payload) => ({ title: `LangBench ${payload.language || "unknown"}`, body: "langbench body" })
    }),
    adaptersApi.createLegacyItNewsAdapter({
      buildPastedNote: (payload) => ({ title: payload.items[0].title, body: "news body" }),
      buildFileNote: (payload) => ({ title: payload.items[0].title, body: "file news body" })
    })
  ];
}

test("LangBench Result は LangBench Adapter へルーティングされる", () => {
  const router = routerApi.createJsonImportRouter(createExistingAdapters());
  const result = router.convert({ type: "langbench_result", language: "JavaScript" });

  assert.equal(result.adapterId, "langbench-result");
  assert.equal(result.title, "LangBench JavaScript");
  assert.equal(result.importMessage, "LangBench Result を取り込みました。");
});

test("items 配列を持つ既存ニュースJSONは legacy IT News Adapter へルーティングされる", () => {
  const router = routerApi.createJsonImportRouter(createExistingAdapters());
  const result = router.convert({ items: [{ title: "example" }] });

  assert.equal(result.adapterId, "legacy-it-news");
  assert.equal(result.title, "example");
  assert.equal(result.body, "news body");
  assert.equal(result.importMessage, "JSONから1件のニュースメモを作成しました");
});

test("明示形式アダプターは legacy items 判定より優先される", () => {
  const router = routerApi.createJsonImportRouter(createExistingAdapters());
  router.registerAdapter({
    id: "sample-app-v1",
    priority: 20,
    canHandle: (payload) => payload.app === "sample-app" && payload.domain === "sample" && payload.schemaVersion === 1,
    convert: () => ({ title: "Sample", body: "sample body", importMessage: "Sampleを取り込みました。" })
  });

  const result = router.convert({ app: "sample-app", domain: "sample", schemaVersion: 1, items: [] });
  assert.equal(result.adapterId, "sample-app-v1");
});

test("未知形式は非対応として扱える", () => {
  const router = routerApi.createJsonImportRouter(createExistingAdapters());
  assert.equal(router.convert({ app: "unknown" }), null);
  assert.throws(
    () => routerApi.parseJsonImportText('{"app":"unknown"}', router),
    { message: routerApi.UNSUPPORTED_JSON_MESSAGE }
  );
});

test("Adapterが認識後に変換へ失敗した場合は識別可能なエラーを返す", () => {
  const router = routerApi.createJsonImportRouter([{
    id: "broken-app-v1",
    canHandle: (payload) => payload.app === "broken-app",
    convert: () => { throw new Error("必須フィールドがありません。"); }
  }]);

  assert.throws(
    () => router.convert({ app: "broken-app" }),
    (error) => error instanceof routerApi.AdapterConversionError
      && error.adapterId === "broken-app-v1"
      && error.message === "必須フィールドがありません。"
  );
});

test("Adapterが返したadapterIdではなくRouterが選択したadapterIdを確定する", () => {
  const router = routerApi.createJsonImportRouter([{
    id: "actual-adapter",
    canHandle: () => true,
    convert: () => ({ title: "Title", body: "Body", importMessage: "Imported", adapterId: "forged-adapter" })
  }]);

  assert.equal(router.convert({}).adapterId, "actual-adapter");
});

test("不正JSONは既存と同等の案内を返す", () => {
  const router = routerApi.createJsonImportRouter(createExistingAdapters());
  assert.throws(
    () => routerApi.parseJsonImportText("{ invalid json", router),
    { message: routerApi.INVALID_JSON_MESSAGE }
  );
});

test("Router本体を変更せず新しいAdapterを登録できる", () => {
  const router = routerApi.createJsonImportRouter(createExistingAdapters());
  router.registerAdapter({
    id: "future-app-v1",
    canHandle: (payload) => payload.app === "future-app" && payload.schemaVersion === 1,
    convert: (payload) => ({ title: payload.title, body: payload.body, importMessage: "Future Appを取り込みました。" })
  });

  const result = routerApi.parseJsonImportText(
    '{"app":"future-app","schemaVersion":1,"title":"Future","body":"Body"}',
    router
  );
  assert.deepEqual(result, {
    adapterId: "future-app-v1",
    title: "Future",
    body: "Body",
    importMessage: "Future Appを取り込みました。"
  });
});
