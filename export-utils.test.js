"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCollectionLocalPlan,
  hasNameCollision,
  sanitizeWindowsName,
  supportsDirectoryPicker,
  uniqueFileName
} = require("./export-utils.js");
const { createGeometryBlock, serializeGeometryBlock } = require("./geometry-block-utils.js");

test("通常Markdownエクスポートで幾何学ブロック本文をそのまま保持する", () => {
  const geometryMarker = serializeGeometryBlock(createGeometryBlock("export-round-trip"));
  const body = `前\n${geometryMarker}\n後`;
  const plan = buildCollectionLocalPlan(
    [{ id: "root", name: "Root", parentId: null }, { id: "child", name: "幾何", parentId: "root" }],
    [{ id: "geometry-note", title: "図形", body, collectionId: "child" }],
    "root"
  );
  assert.equal(plan.files[0].content, body);
});

test("Windowsで危険な文字、末尾、予約デバイス名を安全化する", () => {
  assert.equal(sanitizeWindowsName('A\\B/C:*?"<>|. ', "無題のメモ"), "A_B_C_______");
  assert.equal(sanitizeWindowsName("CON", "無題のメモ"), "_CON");
  assert.equal(sanitizeWindowsName("lpt1.txt", "無題のメモ"), "_lpt1.txt");
  assert.equal(sanitizeWindowsName("   ", "無題のメモ"), "無題のメモ");
});

test("同一フォルダでは大小文字を区別せず括弧付き連番を付ける", () => {
  const used = new Set();
  assert.equal(uniqueFileName("memo.md", used), "memo.md");
  assert.equal(uniqueFileName("Memo.md", used), "Memo (2).md");
  assert.equal(uniqueFileName("memo.md", used), "memo (3).md");
});

test("コレクション階層とフォルダ単位のファイル名衝突を出力計画へ変換する", () => {
  const collections = [
    { id: "root", name: "開発", parentId: null, sortOrder: 0 },
    { id: "js", name: "JavaScript", parentId: "root", sortOrder: 0 },
    { id: "db", name: "データベース", parentId: "root", sortOrder: 1 }
  ];
  const notes = [
    { id: "same-id", title: "IndexedDB", body: "JS側", collectionId: "js", deletedAt: null },
    { id: "same-id", title: "IndexedDB", body: "DB側", collectionId: "db", deletedAt: null },
    { id: "another", title: "indexeddb", body: "重複", collectionId: "js", deletedAt: null },
    { id: "trash", title: "削除済み", body: "除外", collectionId: "js", deletedAt: "2026-07-15" }
  ];

  const plan = buildCollectionLocalPlan(collections, notes, "root");
  assert.deepEqual(plan.directories, [["JavaScript"], ["データベース"]]);
  assert.deepEqual(plan.files.map((file) => `${file.directoryPath.join("/")}/${file.name}`), [
    "JavaScript/IndexedDB.md",
    "データベース/IndexedDB.md",
    "JavaScript/indexeddb (2).md"
  ]);
  assert.equal(plan.files[0].content, "JS側");
  assert.equal(plan.files[1].memoId, "same-id");
});

test("異なるフォルダでは同名ファイルをそのまま許容する", () => {
  const plan = buildCollectionLocalPlan(
    [
      { id: "root", name: "Root", parentId: null },
      { id: "a", name: "A", parentId: "root" },
      { id: "b", name: "B", parentId: "root" }
    ],
    [
      { id: "1", title: "同名", body: "a", collectionId: "a" },
      { id: "2", title: "同名", body: "b", collectionId: "b" }
    ],
    "root"
  );
  assert.deepEqual(plan.files.map((file) => file.name), ["同名.md", "同名.md"]);
});

test("File System Access APIを機能判定する", () => {
  assert.equal(supportsDirectoryPicker({ showDirectoryPicker() {} }), true);
  assert.equal(supportsDirectoryPicker({}), false);
  assert.equal(supportsDirectoryPicker(null), false);
});

test("同名ルートフォルダの衝突を大小文字を区別せず判定する", () => {
  assert.equal(hasNameCollision(["プログラミング", "Memo"], "プログラミング"), true);
  assert.equal(hasNameCollision(["プログラミング", "Memo"], "memo"), true);
  assert.equal(hasNameCollision(["プログラミング"], "プログラミング_2026-07-15"), false);
});
