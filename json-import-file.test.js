"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const routerApi = require("./json-import-router.js");

const app = fs.readFileSync("app.js", "utf8");

function extractFunction(name) {
  const start = app.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const afterStart = app.slice(start);
  const boundary = /\r?\n}\r?\n\r?\nfunction buildPlainTextImport/.exec(afterStart);
  assert.ok(boundary, `${name} body should close`);
  return app.slice(start, start + boundary.index + boundary[0].indexOf("}") + 1);
}

function createFileParser(buildNewsNoteFromJson) {
  const source = extractFunction("parseImportedNote");
  return new Function(
    "parseFlaggedMarkdown",
    "extractJsonCodeBlock",
    "buildNewsNoteFromJson",
    "buildPlainTextImport",
    "jsonImportRouterApi",
    `${source}; return parseImportedNote;`
  )(
    (text) => ({ body: text, isFlagged: false }),
    () => "",
    buildNewsNoteFromJson,
    (fileName, text) => ({ title: `Plain ${fileName}`, body: text }),
    routerApi
  );
}

test("未知JSONファイルは既存どおりプレーンテキストへfallbackする", () => {
  const parseImportedNote = createFileParser(() => {
    throw new Error("このテストでは未知JSONを未対応として扱います。");
  });

  const imported = parseImportedNote("unknown.json", '{"app":"unknown"}');
  assert.deepEqual(imported, {
    title: "Plain unknown.json",
    body: '{"app":"unknown"}',
    isFlagged: false
  });
});

test("認識済みAdapterの変換エラーはJSONファイル取り込みでfallbackしない", () => {
  const adapterError = new routerApi.AdapterConversionError("future-app-v1", new Error("必須フィールドがありません。"));
  const parseImportedNote = createFileParser(() => {
    throw adapterError;
  });

  assert.throws(
    () => parseImportedNote("future.json", '{"app":"future-app"}'),
    (error) => error === adapterError
  );
});
