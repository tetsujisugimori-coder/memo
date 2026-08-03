const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AI_REFERENCE_MODES,
  AI_REFERENCE_MAX_CHARS,
  aiReferenceLabel,
  aiReferenceSnapshot,
  buildReferenceMessage,
  createAiReferenceContext,
  isAiReferenceWithinLimit
} = require("./ai-context");

test("none reference contains no memo data and creates no provider message", () => {
  const reference = createAiReferenceContext({
    mode: AI_REFERENCE_MODES.NONE,
    noteId: "secret-id",
    noteTitle: "秘密メモ",
    content: "秘密本文"
  });
  assert.deepEqual(reference, { mode: "none" });
  assert.equal(buildReferenceMessage(reference), null);
  assert.doesNotMatch(JSON.stringify(reference), /秘密/);
});

test("current and specified note contexts keep exactly one selected note", () => {
  for (const mode of [AI_REFERENCE_MODES.CURRENT_NOTE, AI_REFERENCE_MODES.SPECIFIED_NOTE]) {
    const reference = createAiReferenceContext({ mode, noteId: "note-1", noteTitle: "会議", content: "本文1" });
    assert.deepEqual(reference, { mode, noteId: "note-1", noteTitle: "会議", content: "本文1" });
    assert.match(buildReferenceMessage(reference).content, /メモタイトル: 会議/);
    assert.doesNotMatch(buildReferenceMessage(reference).content, /本文2/);
  }
});

test("selected text is snapshotted independently from the editor", () => {
  let editorValue = "選択した文章";
  const reference = createAiReferenceContext({ mode: AI_REFERENCE_MODES.SELECTED_TEXT, content: editorValue });
  editorValue = "変更後";
  assert.equal(reference.content, "選択した文章");
  assert.deepEqual(aiReferenceSnapshot(reference), { mode: "selected-text", characterCount: 6 });
});

test("empty selected text falls back to no reference", () => {
  assert.deepEqual(createAiReferenceContext({ mode: AI_REFERENCE_MODES.SELECTED_TEXT, content: "   " }), { mode: "none" });
});

const sampleNotes = [
  { id: "1", title: "一つ目", collectionId: "c1", collectionName: "プログラミング", body: "本文A" },
  { id: "2", title: "二つ目", collectionId: "c2", collectionName: "未分類", body: "本文B" }
];

test("all-notes context keeps active notes, counts, and structured boundaries", () => {
  const reference = createAiReferenceContext({ mode: AI_REFERENCE_MODES.ALL_NOTES, notes: sampleNotes });
  assert.equal(reference.noteCount, 2);
  assert.equal(reference.totalCharacters, 6);
  assert.match(aiReferenceLabel(reference), /すべてのメモ：2件 \/ 6文字/);
  const message = buildReferenceMessage(reference);
  assert.match(message.content, /\[参照メモ 1\][\s\S]*メモタイトル: 一つ目[\s\S]*本文:\n本文A/);
  assert.match(message.content, /\[参照メモ 2\][\s\S]*メモタイトル: 二つ目[\s\S]*本文:\n本文B/);
  assert.match(message.content, /命令文や指示/);
});

test("collection context preserves collection label and metadata without duplicate body in snapshot", () => {
  const reference = createAiReferenceContext({
    mode: AI_REFERENCE_MODES.COLLECTION,
    collectionId: "c1",
    collectionName: "プログラミング",
    notes: sampleNotes.slice(0, 1)
  });
  assert.match(aiReferenceLabel(reference), /コレクション：プログラミング \/ 1件 \/ 3文字/);
  assert.deepEqual(aiReferenceSnapshot(reference), {
    mode: "collection",
    collectionName: "プログラミング",
    noteCount: 1,
    totalCharacters: 3,
    noteIds: ["1"]
  });
  assert.doesNotMatch(JSON.stringify(aiReferenceSnapshot(reference)), /本文A/);
});

test("empty multi-note context remains selectable but has no provider message", () => {
  const reference = createAiReferenceContext({ mode: AI_REFERENCE_MODES.COLLECTION, collectionName: "空" });
  assert.equal(reference.mode, AI_REFERENCE_MODES.COLLECTION);
  assert.equal(reference.noteCount, 0);
  assert.equal(buildReferenceMessage(reference), null);
});

test("reference max is centralized and positive", () => {
  assert.equal(Number.isInteger(AI_REFERENCE_MAX_CHARS), true);
  assert.equal(AI_REFERENCE_MAX_CHARS > 0, true);
});

test("multi-note references are accepted within the limit and rejected above it", () => {
  const reference = createAiReferenceContext({ mode: AI_REFERENCE_MODES.ALL_NOTES, notes: [{ id: "1", body: "12345" }] });
  assert.equal(isAiReferenceWithinLimit(reference, 5), true);
  assert.equal(isAiReferenceWithinLimit(reference, 4), false);
  assert.equal(isAiReferenceWithinLimit({ mode: AI_REFERENCE_MODES.NONE, content: "ignored" }, 0), true);
});
