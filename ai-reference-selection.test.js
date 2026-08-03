const test = require("node:test");
const assert = require("node:assert/strict");

const {
  selectAllReferenceNotes,
  selectCollectionReferenceNotes
} = require("./ai-reference-selection");

const collections = [
  { id: "root", name: "プログラミング", parentId: null },
  { id: "child", name: "子", parentId: "root" },
  { id: "grandchild", name: "孫", parentId: "child" },
  { id: "other", name: "別コレクション", parentId: null },
  { id: "system-unclassified", name: "未分類", parentId: null, isSystem: true }
];
const notes = [
  { id: "root-note", collectionId: "root", body: "root" },
  { id: "child-note", collectionId: "child", body: "child" },
  { id: "grandchild-note", collectionId: "grandchild", body: "grandchild" },
  { id: "other-note", collectionId: "other", body: "other" },
  { id: "unclassified-note", collectionId: "missing", body: "unclassified" },
  { id: "deleted-note", collectionId: "root", deletedAt: "2026-01-01", body: "deleted" },
  { id: "trash-note", collectionId: "other", deletedAt: "2026-01-02", body: "trash" }
];

test("all reference notes include active unclassified notes but exclude deleted and trash notes", () => {
  assert.deepEqual(selectAllReferenceNotes(notes).map((note) => note.id), [
    "root-note", "child-note", "grandchild-note", "other-note", "unclassified-note"
  ]);
});

test("collection selection includes descendants recursively and excludes other collections", () => {
  assert.deepEqual(selectCollectionReferenceNotes(notes, collections, "root").map((note) => note.id), [
    "root-note", "child-note", "grandchild-note"
  ]);
  assert.deepEqual(selectCollectionReferenceNotes(notes, collections, "child").map((note) => note.id), [
    "child-note", "grandchild-note"
  ]);
});

test("empty collection selection returns no notes", () => {
  assert.deepEqual(selectCollectionReferenceNotes(notes, collections, "other").filter((note) => note.id === "missing"), []);
});
