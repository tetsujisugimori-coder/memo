"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  CALCULATOR_MEMO_URL,
  MAX_CALCULATOR_EXPRESSION_LENGTH,
  buildCalculatorMemoUrl,
  openCalculatorMemo,
  selectedEditorText
} = require("./calculator-link");

const html = fs.readFileSync("index.html", "utf8");

test("計算ボタンは本文エディタの操作列にアクセシブルな形で置く", () => {
  const editorTools = html.match(/<div class="editor-tools"[\s\S]*?<\/div>/)?.[0] || "";
  assert.match(editorTools, /id="calculatorLinkBtn"[^>]*type="button"[^>]*title="[^"]+"[^>]*aria-label="選択中の式をCalculator Memoで開く"[^>]*>計算<\/button>/);
});

test("選択文字列の前後にある空白と改行を除去する", () => {
  const value = "前文\n  2 * (5 + 3) \n後文";
  const editor = { value, selectionStart: value.indexOf("  2"), selectionEnd: value.indexOf("後文") };
  assert.equal(selectedEditorText(editor), "2 * (5 + 3)");
});

test("選択文字列がある場合はexpr付きURLを安全に生成する", () => {
  const url = new URL(buildCalculatorMemoUrl(" 2 + (3 * 4) & 5% "));
  assert.equal(`${url.origin}${url.pathname}`, CALCULATOR_MEMO_URL);
  assert.equal(url.searchParams.get("expr"), "2 + (3 * 4) & 5%");
});

test("選択文字列がない場合はexprなしURLを生成する", () => {
  const url = new URL(buildCalculatorMemoUrl(" \n "));
  assert.equal(url.toString(), CALCULATOR_MEMO_URL);
  assert.equal(url.searchParams.has("expr"), false);
});

test("上限を超える選択文字列ではURLを開かず分かりやすいエラーにする", () => {
  let openCalls = 0;
  const editor = { value: "1".repeat(MAX_CALCULATOR_EXPRESSION_LENGTH + 1), selectionStart: 0, selectionEnd: MAX_CALCULATOR_EXPRESSION_LENGTH + 1 };
  assert.throws(() => openCalculatorMemo(editor, () => { openCalls += 1; }), /2000文字以内/);
  assert.equal(openCalls, 0);
});

test("新しいタブをnoopenerとnoreferrer付きで開き本文を変更しない", () => {
  const editor = { value: "before 2+3 after", selectionStart: 7, selectionEnd: 10 };
  const before = { ...editor };
  const opened = { opener: "parent" };
  const calls = [];

  openCalculatorMemo(editor, (...args) => {
    calls.push(args);
    return opened;
  });

  assert.deepEqual(calls, [[`${CALCULATOR_MEMO_URL}?expr=2%2B3`, "_blank", "noopener,noreferrer"]]);
  assert.equal(opened.opener, null);
  assert.deepEqual(editor, before);
});
