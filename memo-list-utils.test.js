"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { buildMemoListView, normalizeMemoTags, normalizeTagFilter } = require("./memo-list-utils");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

const notes = [
  { id: "history", collectionId: "history", tags: ["歴史", "資料"], deletedAt: null },
  { id: "child", collectionId: "history-child", tags: ["歴史"], deletedAt: null },
  { id: "unclassified", collectionId: "system-unclassified", tags: ["資料"], deletedAt: null },
  { id: "deleted-history", collectionId: "history", tags: ["歴史"], deletedAt: 100 },
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

test("タグ正規化は空文字と大文字小文字をまたぐ重複を除外する", () => {
  assert.deepEqual(normalizeMemoTags([" Work ", "", "work", "WORK", " 資料 ", null, undefined]), ["work", "資料"]);
  assert.deepEqual(normalizeMemoTags([" Work ", "", "work", null, undefined]), ["work"]);
  assert.deepEqual(normalizeMemoTags("work"), []);
  assert.equal(normalizeTagFilter(" WORK "), "work");
  assert.equal(normalizeTagFilter("  "), null);
});

test("タグ選択は該当する未削除メモだけを表示する", () => {
  const view = buildMemoListView(notes, null, " 歴史 ");
  assert.equal(view.heading, "メモ一覧（タグ: 歴史）");
  assert.deepEqual(ids(view), ["history", "child"]);
});

test("コレクションとタグを選択すると両方に一致するメモだけを表示する", () => {
  assert.deepEqual(ids(buildMemoListView(notes, "history", "歴史")), ["history"]);
  assert.deepEqual(ids(buildMemoListView(notes, "system-unclassified", "資料")), ["unclassified"]);
});

test("タグを持たない旧メモはタグ絞り込みでエラーにならない", () => {
  assert.deepEqual(ids(buildMemoListView(notes, null, "missing")), []);
  const trashView = buildMemoListView(notes, "trash", "歴史");
  assert.equal(trashView.heading, "ゴミ箱（タグ: 歴史）");
  assert.deepEqual(ids(trashView), ["deleted-history"]);
});

test("タグ編集UIと右サイドバーのタグタブを保存・解除処理へ接続する", () => {
  assert.match(html, /id="noteTagForm"[\s\S]*id="noteTagInput"/);
  assert.match(html, /id="contextTagTab"[^>]+aria-controls="tagPanel"/);
  assert.match(html, /id="clearTagFilterBtn"/);
  assert.match(app, /function updateCurrentNoteTags\(value\)[\s\S]*await saveCurrentNote\(\)/);
  assert.match(app, /function updateCurrentNoteTags\(value\)[\s\S]*renderNoteTags\(note\);[\s\S]*renderTagPanel\(\);[\s\S]*renderList\(\);[\s\S]*await saveCurrentNote\(\)/);
  assert.match(app, /chip\.className = "note-tag-chip"/);
  assert.match(app, /button\.className = "tag-list-item"/);
  assert.match(app, /buildMemoListView\(notes, selectedCollectionId, selectedTagFilter\)/);
  assert.match(app, /function clearTagFilter\(\)[\s\S]*selectedTagFilter = null/);
  assert.match(app, /tags: normalizeMemoTags\(draft\.tags \|\| existingNote\?\.tags\)/);
});

test("タグ関連スクリプトのキャッシュ番号を更新する", () => {
  assert.match(html, /src="memo-list-utils\.js\?v=0\.4\.0-4"/);
  assert.match(html, /src="local-markdown\.js\?v=0\.4\.0-3"/);
  assert.match(html, /src="app\.js\?v=0\.4\.0-85"/);
  assert.doesNotMatch(html, /memo-list-utils\.js\?v=0\.4\.0-3/);
  assert.doesNotMatch(html, /local-markdown\.js\?v=0\.4\.0-2/);
});
