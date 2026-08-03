const test = require("node:test");
const assert = require("node:assert/strict");

const { AI_PROMPTS, aiAppendMarkdown, aiMemoTitle, buildAiMessages } = require("./ai-prompts");

test("all four AI purposes have versioned prompt metadata", () => {
  assert.deepEqual(Object.keys(AI_PROMPTS), ["summarize", "organize", "translate", "question"]);
  Object.values(AI_PROMPTS).forEach((prompt) => {
    assert.equal(prompt.outputFormat, "Markdown");
    assert.equal(prompt.version, 1);
  });
});

test("prompt keeps purpose, optional instruction, and memo in distinct sections", () => {
  const messages = buildAiMessages({
    purpose: "organize",
    targetText: "# 会議\nTODOを確認",
    userInstruction: "短くしてください",
    systemInstruction: "system"
  });
  assert.equal(messages[0].role, "system");
  assert.match(messages[1].content, /\[用途\]/);
  assert.match(messages[1].content, /\[追加指示\]\n短くしてください/);
  assert.match(messages[1].content, /\[対象メモ\]\n# 会議/);
});

test("Markdown and fenced code remain intact in the target section", () => {
  const source = "# 見出し\n\n```js\nconst value = 1;\n```";
  const messages = buildAiMessages({ purpose: "summarize", targetText: source });
  assert.match(messages.at(-1).content, /\[対象メモ\]\n# 見出し\n\n```js\nconst value = 1;\n```/);
});

test("translation target is explicit", () => {
  const english = buildAiMessages({ purpose: "translate", targetText: "本文", translationLanguage: "en" });
  const japanese = buildAiMessages({ purpose: "translate", targetText: "text", translationLanguage: "ja" });
  assert.match(english.at(-1).content, /英語へ翻訳/);
  assert.match(japanese.at(-1).content, /日本語へ翻訳/);
});

test("free question requires an instruction and all purposes reject empty targets", () => {
  assert.throws(() => buildAiMessages({ purpose: "question", targetText: "本文" }), /自由質問/);
  assert.throws(() => buildAiMessages({ purpose: "summarize", targetText: "" }), /対象メモ/);
});

test("AI result helpers create confirmed append body and a bounded title", () => {
  assert.equal(aiAppendMarkdown("回答"), "\n\n## AI回答\n\n回答");
  assert.equal(aiAppendMarkdown(""), "");
  assert.match(aiMemoTitle("summarize", "会議"), /会議.*要約/);
  assert.equal(aiMemoTitle("question", "とても長い題名", 12).length <= 12, true);
});
