const test = require("node:test");
const assert = require("node:assert/strict");

const { AI_PROMPTS, aiAppendMarkdown, aiMemoTitle, buildAiMessages } = require("./ai-prompts");

test("all four AI purposes have versioned prompt metadata", () => {
  assert.deepEqual(Object.keys(AI_PROMPTS), ["summarize", "organize", "translate", "question"]);
  Object.values(AI_PROMPTS).forEach((prompt) => assert.equal(prompt.version, 1));
});

test("free chat sends no memo title or body when reference is none", () => {
  const messages = buildAiMessages({
    purpose: "question",
    reference: { mode: "none", noteTitle: "秘密メモ", content: "秘密本文" },
    userInstruction: "一般的な質問",
    systemInstruction: "system"
  });
  assert.deepEqual(messages, [
    { role: "system", content: "system" },
    { role: "user", content: "一般的な質問" }
  ]);
  assert.doesNotMatch(JSON.stringify(messages), /秘密/);
});

test("system instruction, reference, history, and question remain distinct messages", () => {
  const messages = buildAiMessages({
    purpose: "question",
    reference: { mode: "specified-note", noteId: "1", noteTitle: "会議", content: "TODOを確認" },
    history: [{ role: "user", content: "前の質問" }, { role: "assistant", content: "前の回答" }],
    userInstruction: "次の質問",
    systemInstruction: "system"
  });
  assert.deepEqual(messages.map((message) => message.role), ["system", "system", "user", "assistant", "user"]);
  assert.match(messages[1].content, /参照本文:\nTODOを確認/);
  assert.equal(messages.at(-1).content, "次の質問");
});

test("memo tasks require a reference and keep task separate from reference", () => {
  assert.throws(() => buildAiMessages({ purpose: "summarize", reference: { mode: "none" } }), /参照/);
  const messages = buildAiMessages({
    purpose: "translate",
    reference: { mode: "selected-text", content: "本文" },
    userInstruction: "翻訳してください",
    translationLanguage: "en"
  });
  assert.match(messages.at(-1).content, /英語へ翻訳/);
  assert.match(messages[0].content, /参照本文:\n本文/);
});

test("free questions require input while memo tasks allow optional additional instructions", () => {
  assert.throws(() => buildAiMessages({ purpose: "question", reference: { mode: "none" } }), /自由質問を入力してください/);
  assert.throws(() => buildAiMessages({ purpose: "question", reference: { mode: "none" }, userInstruction: "  " }), /自由質問を入力してください/);
  ["summarize", "organize", "translate"].forEach((purpose) => {
    const messages = buildAiMessages({ purpose, reference: { mode: "current-note", content: "本文" }, translationLanguage: "en" });
    assert.match(messages.at(-1).content, /^\[タスク\]/);
    assert.doesNotMatch(messages.at(-1).content, /利用者の追加指示|なし/);
  });
  const withInstruction = buildAiMessages({ purpose: "summarize", reference: { mode: "current-note", content: "本文" }, userInstruction: "箇条書きで" });
  assert.match(withInstruction.at(-1).content, /\[利用者の追加指示\]\n箇条書きで/);
});

test("every purpose can be combined with a selected reference mode", () => {
  ["current-note", "selected-text", "specified-note", "all-notes", "collection"].forEach((mode) => {
    ["question", "summarize", "organize", "translate"].forEach((purpose) => {
      const messages = buildAiMessages({
        purpose,
        reference: { mode, noteId: "1", noteTitle: "対象", content: "本文" },
        userInstruction: "実行してください",
        translationLanguage: "en"
      });
      assert.equal(messages.at(-1).role, "user");
    });
  });
});

test("free question with input remains sendable without a reference", () => {
  assert.equal(buildAiMessages({ purpose: "question", reference: { mode: "none" }, userInstruction: "質問" }).at(-1).content, "質問");
});

test("multiple memo reference stays in one separate system message", () => {
  const messages = buildAiMessages({
    purpose: "question",
    reference: {
      mode: "all-notes",
      notes: [
        { id: "1", title: "A", collectionId: "c1", collectionName: "未分類", body: "本文A" },
        { id: "2", title: "B", collectionId: "c2", collectionName: "IT", body: "本文B" }
      ]
    },
    userInstruction: "比較してください"
  });
  assert.equal(messages.filter((message) => message.role === "system").length, 1);
  assert.match(messages[0].content, /\[参照メモ 1\]/);
  assert.match(messages[0].content, /\[参照メモ 2\]/);
  assert.equal(messages.at(-1).content, "比較してください");
});

test("AI result helpers create append body and a bounded title", () => {
  assert.equal(aiAppendMarkdown("回答"), "\n\n## AI回答\n\n回答");
  assert.match(aiMemoTitle("summarize", "会議"), /会議.*要約/);
  assert.equal(aiMemoTitle("question", "とても長い題名", 12).length <= 12, true);
});
