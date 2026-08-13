"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");

function extractAsyncFunction(name) {
  const start = app.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = app.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }
  assert.fail(`${name} body should close`);
}

function createImporter({ input = '{"items":[]}', parseError, saveError } = {}) {
  const events = [];
  const jsonImportText = { value: input };
  const jsonImportError = { textContent: "" };
  const saveStatus = { textContent: "" };
  const source = extractAsyncFunction("importPastedItNewsJson");
  const importPastedItNewsJson = new Function(
    "jsonImportText",
    "jsonImportError",
    "setSaveStatusNotice",
    "clearJsonImportError",
    "showJsonImportError",
    "parsePastedJson",
    "saveCurrentNote",
    "createNote",
    "getAllNotes",
    "renderAll",
    "openNote",
    "closeJsonImportDialog",
    `${source}; return importPastedItNewsJson;`
  )(
    jsonImportText,
    jsonImportError,
    (message) => { saveStatus.textContent = message; },
    () => {
      jsonImportError.textContent = "";
    },
    (message) => {
      jsonImportError.textContent = message;
    },
    () => {
      if (parseError) throw parseError;
      return { title: "Imported", body: "Body", importMessage: "取り込み成功" };
    },
    async () => {
      events.push("save-current");
    },
    async () => {
      events.push("create-note");
      if (saveError) throw saveError;
      return { id: "imported-note" };
    },
    async () => {
      events.push("reload-notes");
      return [{ id: "imported-note" }];
    },
    () => events.push("render"),
    () => events.push("open-note"),
    () => events.push("close-dialog")
  );

  return { events, importPastedItNewsJson, jsonImportError, jsonImportText, saveStatus };
}

test("JSON貼り付け取り込み成功後だけ入力欄を空にして既存通知を維持する", async () => {
  const context = createImporter();

  await context.importPastedItNewsJson();

  assert.equal(context.jsonImportText.value, "");
  assert.equal(context.saveStatus.textContent, "取り込み成功");
  assert.deepEqual(context.events, [
    "save-current",
    "create-note",
    "reload-notes",
    "render",
    "open-note",
    "close-dialog"
  ]);

  context.jsonImportText.value = '{"items":[{"title":"Next"}]}';
  await context.importPastedItNewsJson();
  assert.equal(context.jsonImportText.value, "");
  assert.equal(context.events.filter((event) => event === "create-note").length, 2);
});

test("空欄と不正なJSONでは案内を表示して入力内容を保持する", async () => {
  const empty = createImporter({ input: "   " });
  await empty.importPastedItNewsJson();
  assert.equal(empty.jsonImportText.value, "   ");
  assert.equal(empty.jsonImportError.textContent, "JSONを貼り付けてください。");
  assert.deepEqual(empty.events, []);

  const invalid = createImporter({
    input: "{ invalid json",
    parseError: new Error("JSONの読み込みに失敗しました。JSONの構文を確認してください。")
  });
  await invalid.importPastedItNewsJson();
  assert.equal(invalid.jsonImportText.value, "{ invalid json");
  assert.equal(invalid.jsonImportError.textContent, "JSONの読み込みに失敗しました。JSONの構文を確認してください。");
  assert.deepEqual(invalid.events, []);
});

test("保存に失敗した場合はエラーを表示して入力内容を保持する", async () => {
  const context = createImporter({ saveError: new Error("IndexedDB unavailable") });

  await context.importPastedItNewsJson();

  assert.equal(context.jsonImportText.value, '{"items":[]}');
  assert.equal(context.jsonImportError.textContent, "保存に失敗しました: IndexedDB unavailable");
  assert.deepEqual(context.events, ["save-current", "create-note"]);
});
