"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { captureAiSelection, isAiSelectionCurrent } = require("./ai-selection-snapshot.js");
const input = { noteId: "memo-a", noteTitle: "架空のメモ", body: "alpha beta gamma", start: 6, end: 10 };
test("選択文字列と位置、元のメモ識別情報を固定する", () => {
  const snapshot = captureAiSelection(input);
  assert.equal(snapshot.selectedText, "beta");
  assert.deepEqual([snapshot.start, snapshot.end], [6, 10]);
  assert.ok(Object.isFrozen(snapshot));
  assert.equal(isAiSelectionCurrent(snapshot, input), true);
});
test("選択がない・空白のみ・不正位置なら保存しない", () => {
  for (const change of [{ start: 1, end: 1 }, { start: -1 }, { start: 0, end: 100 }, { start: 10, end: 6 }, { noteId: "" }, { start: NaN }, { body: "   ", start: 0, end: 3 }]) {
    assert.equal(captureAiSelection({ ...input, ...change }), null);
  }
});
test("別メモ、タイトル変更、選択外を含む本文変更も拒否する", () => {
  const snapshot = captureAiSelection(input);
  for (const change of [{ noteId: "memo-b" }, { noteTitle: "更新後" }, { body: "alpha beta gamma!" }, { body: "alpha zeta gamma" }, { body: "beta" }]) {
    assert.equal(isAiSelectionCurrent(snapshot, { ...input, ...change }), false);
  }
});
test("同じ文章を持つ別メモを取り違えない", () => {
  const original = captureAiSelection(input);
  const other = captureAiSelection({ ...input, noteId: "memo-b" });
  assert.equal(isAiSelectionCurrent(original, { ...input, noteId: "memo-b" }), false);
  assert.equal(isAiSelectionCurrent(other, { ...input, noteId: "memo-b" }), true);
});
test("日本語・改行・空白も送信する全文を保持する", () => {
  const body = "冒頭\n 青い鳥が窓辺にいる。 \n末尾";
  const start = body.indexOf(" 青い鳥"), end = body.indexOf("\n末尾");
  const snap = captureAiSelection({ ...input, body, start, end });
  assert.equal(snap.selectedText, " 青い鳥が窓辺にいる。 ");
  assert.equal(isAiSelectionCurrent(snap, { ...input, body }), true);
});
