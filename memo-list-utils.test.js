"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildMemoListView } = require("./memo-list-utils");

const notes = [
  { id: "history", collectionId: "history", deletedAt: null },
  { id: "child", collectionId: "history-child", deletedAt: null },
  { id: "unclassified", collectionId: "system-unclassified", deletedAt: null },
  { id: "deleted-history", collectionId: "history", deletedAt: 100 },
  { id: "deleted-unclassified", collectionId: "system-unclassified", deletedAt: 200 }
];

function ids(view) {
  return view.notes.map((note) => note.id);
}

test("通常のメモ一覧はすべての未削除メモと一致する", () => {
  const view = buildMemoListView(notes, null);
  assert.equal(view.heading, "メモ一覧");
  assert.deepEqual(ids(view), ["history", "child", "unclassified"]);
});

test("通常コレクション選択は従来どおり左一覧を絞り込まない", () => {
  const view = buildMemoListView(notes, "history");
  assert.equal(view.heading, "メモ一覧");
  assert.deepEqual(ids(view), ["history", "child", "unclassified"]);
});

test("未分類選択も従来どおり左一覧を絞り込まない", () => {
  const view = buildMemoListView(notes, "system-unclassified");
  assert.equal(view.heading, "メモ一覧");
  assert.deepEqual(ids(view), ["history", "child", "unclassified"]);
});

test("ゴミ箱は削除済みメモだけを表示して見出しと一致する", () => {
  const view = buildMemoListView(notes, "trash");
  assert.equal(view.heading, "ゴミ箱");
  assert.deepEqual(ids(view), ["deleted-history", "deleted-unclassified"]);
});

test("長いコレクション名を選択しても通常の見出しを維持する", () => {
  const view = buildMemoListView(notes, "非常に長いコレクション名が続いても上部へは表示しない");
  assert.equal(view.heading, "メモ一覧");
  assert.deepEqual(ids(view), ["history", "child", "unclassified"]);
});
