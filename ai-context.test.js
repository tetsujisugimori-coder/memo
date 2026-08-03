const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AI_REFERENCE_MODES,
  aiReferenceSnapshot,
  buildReferenceMessage,
  createAiReferenceContext
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
