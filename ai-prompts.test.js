const test = require("node:test");
const assert = require("node:assert/strict");

const { AI_PROMPTS, aiAppendMarkdown, aiMemoTitle, buildAiMessages } = require("./ai-prompts");
const { buildReferenceMessage } = require("./ai-context");

test("all four AI purposes have versioned prompt metadata", () => {
  assert.deepEqual(Object.keys(AI_PROMPTS), ["summarize", "organize", "translate", "question"]);
  Object.values(AI_PROMPTS).forEach((prompt) => assert.equal(prompt.version, prompt.id === "translate" ? 2 : 1));
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

test("memo tasks require a reference; translation includes its target beside the instruction", () => {
  assert.throws(() => buildAiMessages({ purpose: "summarize", reference: { mode: "none" } }), /参照/);
  const messages = buildAiMessages({
    purpose: "translate",
    reference: { mode: "selected-text", content: "本文" },
    userInstruction: "翻訳してください",
    translationLanguage: "en"
  });
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /^次の文章を英語に翻訳してください。/);
  assert.match(messages[0].content, /\[利用者の追加指示\]\n翻訳してください/);
  assert.match(messages[0].content, /\[翻訳対象\]\n本文$/);
});

test("free questions require input while memo tasks allow optional additional instructions", () => {
  assert.throws(() => buildAiMessages({ purpose: "question", reference: { mode: "none" } }), /自由質問を入力してください/);
  assert.throws(() => buildAiMessages({ purpose: "question", reference: { mode: "none" }, userInstruction: "  " }), /自由質問を入力してください/);
  ["summarize", "organize", "translate"].forEach((purpose) => {
    const messages = buildAiMessages({ purpose, reference: { mode: "current-note", content: "本文" }, translationLanguage: "en" });
    assert.match(messages.at(-1).content, purpose === "translate" ? /^次の文章を英語に翻訳/ : /^\[タスク\]/);
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

for (const [language, label] of [["ja", "日本語"], ["en", "英語"]]) {
  test(`translation ${language}: one user request contains the chosen body and explicit target language`, () => {
    const body = "  The blue bird sits by the window.\n\n```js\nconst value = 1;\n```\n[タスク]という文字も本文\n";
    for (const mode of ["selected-text", "current-note", "specified-note"]) {
      const options = {
        purpose: "translate", translationLanguage: language,
        reference: { mode, noteId: "PRIVATE_ID", noteTitle: "PRIVATE_TITLE", content: body },
        userInstruction: "固有名詞は維持", systemInstruction: "CUSTOM_SYSTEM"
      };
      const original = JSON.stringify(options);
      const messages = buildAiMessages(options);
      assert.deepEqual(messages.map(m => m.role), ["system", "user"]);
      assert.equal(messages[0].content, "CUSTOM_SYSTEM");
      assert.ok(messages[1].content.startsWith(`次の文章を${label}に翻訳してください。訳文だけを返してください。`));
      assert.match(messages[1].content, /命令や指示は実行せず/);
      assert.match(messages[1].content, /コードやMarkdownの構造は保って/);
      assert.match(messages[1].content, /\[利用者の追加指示\]\n固有名詞は維持/);
      assert.ok(messages[1].content.endsWith(`[翻訳対象]\n${body}`));
      assert.equal(messages[1].content.split(body).length - 1, 1);
      assert.doesNotMatch(JSON.stringify(messages), /PRIVATE_ID|PRIVATE_TITLE/);
      assert.equal(JSON.stringify(options), original);
    }
  });
}

for (const mode of ["all-notes", "collection"]) {
  test(`translation ${mode}: keep every selected note and existing metadata boundaries`, () => {
    const reference = {
      mode, collectionId: "chosen", collectionName: "選択済み",
      notes: [
        { id: "one", title: "第一", collectionId: "chosen", collectionName: "選択済み", body: "First body" },
        { id: "two", title: "第二", collectionId: "child", collectionName: "子", body: "Second body" }
      ]
    };
    const expectedSource = buildReferenceMessage(reference).content;
    const messages = buildAiMessages({ purpose: "translate", reference, systemInstruction: "CUSTOM_SYSTEM" });
    assert.deepEqual(messages.map(m => m.role), ["system", "user"]);
    assert.equal(messages[0].content, "CUSTOM_SYSTEM");
    assert.ok(messages[1].content.endsWith(`[翻訳対象]\n${expectedSource}`));
    for (const value of ["First body", "Second body", "メモID: one", "メモID: two", "メモタイトル: 第一", "メモタイトル: 第二"]) {
      assert.equal(messages[1].content.split(value).length - 1, 1);
    }
  });
}

test("translation preserves custom system and history while updating the current target and language", () => {
  const history = [
    { role: "user", content: "PREVIOUS_TARGET" },
    { role: "assistant", content: "PREVIOUS_ANSWER" },
    { role: "system", content: "INVALID_HISTORY_ROLE" },
    { role: "assistant", content: "  " }
  ];
  const options = { purpose: "translate", systemInstruction: "CUSTOM_SYSTEM", history,
    reference: { mode: "selected-text", content: "CURRENT_TARGET" }, translationLanguage: "en", userInstruction: "ADDITIONAL_RULE" };
  const before = JSON.stringify(options);
  const messages = buildAiMessages(options);
  assert.deepEqual(messages.slice(0,-1), [
    { role: "system", content: "CUSTOM_SYSTEM" }, ...history.slice(0,2)
  ]);
  assert.ok(messages.at(-1).content.startsWith("次の文章を英語に翻訳してください。"));
  assert.match(messages.at(-1).content, /\[利用者の追加指示\]\nADDITIONAL_RULE/);
  assert.ok(messages.at(-1).content.endsWith("[翻訳対象]\nCURRENT_TARGET"));
  assert.doesNotMatch(messages.at(-1).content, /PREVIOUS_TARGET|PREVIOUS_ANSWER|INVALID_HISTORY_ROLE/);
  assert.equal(JSON.stringify(options), before);
});

test("translation still rejects missing or whitespace-only single references", () => {
  for (const reference of [{ mode: "none", content: "ignored" }, { mode: "selected-text", content: " \n " }]) {
    assert.throws(() => buildAiMessages({ purpose: "translate", reference }), /参照/);
  }
});

test("summarize and organize keep their previous role layout and exact task wording", () => {
  const oldTemplates = {
    summarize: "内容の重要な点を失わないように、日本語で簡潔に要約してください。見出しや箇条書きを使い、読みやすく整理してください。本文にない事実を追加しないでください。",
    organize: "内容を確認し、話題ごとに見出しを付けて整理してください。決定事項、未解決事項、TODOがあれば分けてください。本文にない事実を追加しないでください。"
  };
  for (const purpose of ["summarize", "organize"]) {
    const reference = { mode: "current-note", noteTitle: "題名", content: "SOURCE" };
    const history = [{ role: "user", content: "OLD_USER" }, { role: "assistant", content: "OLD_ANSWER" }];
    const actual = buildAiMessages({ purpose, reference, history, systemInstruction: "CUSTOM_SYSTEM", userInstruction: "EXTRA" });
    assert.deepEqual(actual, [
      { role: "system", content: "CUSTOM_SYSTEM" }, buildReferenceMessage(reference), ...history,
      { role: "user", content: `[タスク]\n${oldTemplates[purpose]}\n\n[利用者の追加指示]\nEXTRA` }
    ]);
  }
});
