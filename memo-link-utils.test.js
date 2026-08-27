"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildMemoLinkRelationIndex,
  createMemoLinkRelationCache,
  parseMemoLinks,
  resolveMemoLinkTitle
} = require("./memo-link-utils.js");
const { extractExplicitTerms } = require("./term-link-utils.js");

test("語句リンクと正式なメモリンクを別々に抽出する", () => {
  const body = "[[SQLite]] [[* SQLite実験]] [[*メモ名]] [[ * メモ名]] [[* ]] [[＊ メモ名]]";
  assert.deepEqual(extractExplicitTerms(body), ["SQLite"]);
  assert.deepEqual(parseMemoLinks(body).map((link) => link.title), ["SQLite実験"]);
});

test("コード領域を除外し通常本文・リスト・引用・見出しの本文順を保つ", () => {
  const body = [
    "通常 [[* A]]",
    "- [[* B]]",
    "> [[* C]]",
    "# [[* D]]",
    "`[[* inline]]` と [[* E]]",
    "```js",
    "[[* fenced]]",
    "```",
    "```mermaid",
    "A --> [[* mermaid]]",
    "```"
  ].join("\n");
  assert.deepEqual(parseMemoLinks(body).map((link) => link.title), ["A", "B", "C", "D", "E"]);
});

test("メモ名の前後空白を除去し # はタイトルの一部として保持する", () => {
  assert.deepEqual(parseMemoLinks("[[*   メモ名#見出し  ]]").map((link) => link.title), ["メモ名#見出し"]);
});

test("タイトル解決は完全一致・削除状態・同名件数から3状態を返す", () => {
  const notes = [
    { id: "a", title: "実験結果" },
    { id: "b", title: "実験結果", deletedAt: "2026-01-01" },
    { id: "c", title: "EXPERIMENT" }
  ];
  assert.deepEqual(resolveMemoLinkTitle(" 実験結果 ", notes), { status: "resolved", title: "実験結果", noteId: "a" });
  assert.deepEqual(resolveMemoLinkTitle("experiment", notes), { status: "missing", title: "experiment", noteId: null });
  assert.deepEqual(resolveMemoLinkTitle("削除済み", [{ id: "x", title: "削除済み", deletedAt: "now" }]), { status: "missing", title: "削除済み", noteId: null });
  assert.deepEqual(resolveMemoLinkTitle("同名", [{ id: "x", title: "同名" }, { id: "y", title: "同名" }]), {
    status: "ambiguous",
    title: "同名",
    noteId: null,
    candidateNoteIds: ["x", "y"]
  });
});

test("索引はresolvedだけをバックリンクにし参照元と重複リンクを一件へ整理する", () => {
  const notes = [
    { id: "a", title: "A", body: "[[* B]] と再び [[* B]] [[* Missing]] [[* Same]]" },
    { id: "b", title: "B", body: "[[* B]]" },
    { id: "s1", title: "Same", body: "" },
    { id: "s2", title: "Same", body: "" },
    { id: "trash", title: "Trash", body: "[[* B]]", deletedAt: "now" }
  ];
  const index = buildMemoLinkRelationIndex(notes);
  assert.deepEqual(index.bySourceNoteId.get("a").map((item) => item.resolutionStatus), ["resolved", "missing", "ambiguous"]);
  assert.deepEqual(index.backlinksByTargetId.get("b").map((item) => item.sourceNoteId), ["a"]);
  assert.equal(index.backlinksByTargetId.has("s1"), false);
  assert.equal(index.backlinksByTargetId.has("s2"), false);
  assert.equal(index.bySourceNoteId.has("trash"), false);
});

test("キャッシュは明示的な無効化まで同じ索引を共有し本文変更後に再構築する", () => {
  const notes = [{ id: "a", title: "A", body: "" }, { id: "b", title: "B", body: "" }];
  const cache = createMemoLinkRelationCache();
  const first = cache.get(notes);
  assert.equal(cache.get(notes), first);
  notes[0].body = "[[* B]]";
  assert.equal(cache.get(notes), first);
  cache.invalidate();
  const rebuilt = cache.get(notes);
  assert.notEqual(rebuilt, first);
  assert.deepEqual(rebuilt.backlinksByTargetId.get("b").map((item) => item.sourceNoteId), ["a"]);
});
