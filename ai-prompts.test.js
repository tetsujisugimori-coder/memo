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
  assert.throws(() => buildAiMessages({ purpose: "summarize", reference: { mode: "none" }, userInstruction: "要約" }), /参照/);
  const messages = buildAiMessages({
    purpose: "translate",
    reference: { mode: "selected-text", content: "本文" },
    userInstruction: "翻訳してください",
    translationLanguage: "en"
  });
  assert.match(messages.at(-1).content, /英語へ翻訳/);
  assert.match(messages[0].content, /参照本文:\n本文/);
});

test("all sends require a user question or instruction", () => {
  assert.throws(() => buildAiMessages({ purpose: "question", reference: { mode: "none" } }), /質問または指示/);
});

test("AI result helpers create append body and a bounded title", () => {
  assert.equal(aiAppendMarkdown("回答"), "\n\n## AI回答\n\n回答");
  assert.match(aiMemoTitle("summarize", "会議"), /会議.*要約/);
  assert.equal(aiMemoTitle("question", "とても長い題名", 12).length <= 12, true);
});
