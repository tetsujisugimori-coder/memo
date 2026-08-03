(function initAiPrompts(globalScope) {
  "use strict";

  const contextApi = typeof module !== "undefined" && module.exports
    ? require("./ai-context")
    : globalScope.MemoNexusAiContext;
  const { buildReferenceMessage, createAiReferenceContext } = contextApi;

  const AI_PROMPTS = Object.freeze({
    summarize: Object.freeze({
      id: "summarize",
      name: "要約",
      category: "memo",
      template: "内容の重要な点を失わないように、日本語で簡潔に要約してください。見出しや箇条書きを使い、読みやすく整理してください。本文にない事実を追加しないでください。",
      inputVariables: ["memo", "instruction"],
      outputFormat: "Markdown",
      version: 1
    }),
    organize: Object.freeze({
      id: "organize",
      name: "整理",
      category: "memo",
      template: "内容を確認し、話題ごとに見出しを付けて整理してください。決定事項、未解決事項、TODOがあれば分けてください。本文にない事実を追加しないでください。",
      inputVariables: ["memo", "instruction"],
      outputFormat: "Markdown",
      version: 1
    }),
    translate: Object.freeze({
      id: "translate",
      name: "翻訳",
      category: "language",
      template: "意味、固有名詞、コード、Markdown構造を可能な限り保って{{language}}へ翻訳してください。不要な解説は追加せず、翻訳結果だけを返してください。",
      inputVariables: ["memo", "instruction", "language"],
      outputFormat: "Markdown",
      version: 1
    }),
    question: Object.freeze({
      id: "question",
      name: "自由質問",
      category: "question",
      template: "対象メモを参考資料として使い、利用者の質問へ答えてください。対象メモにない内容を推測する場合は、そのことが分かるようにしてください。",
      inputVariables: ["memo", "instruction"],
      outputFormat: "Markdown",
      version: 1
    })
  });

  function promptPreset(purpose) {
    return AI_PROMPTS[purpose] || AI_PROMPTS.summarize;
  }

  function buildAiMessages(options = {}) {
    const purpose = options.purpose || "question";
    const preset = promptPreset(purpose);
    const reference = options.reference
      ? createAiReferenceContext(options.reference)
      : createAiReferenceContext({ mode: "current-note", content: options.targetText });
    const userInstruction = String(options.userInstruction || "").trim();
    const language = options.translationLanguage === "en" ? "英語" : "日本語";
    if (!userInstruction) throw new Error("質問または指示を入力してください。");
    if (preset.id !== "question" && reference.mode === "none") throw new Error("この操作には参照する文章が必要です。");
    const purposeInstruction = preset.template.replace("{{language}}", language);
    const messages = [];
    const systemInstruction = String(options.systemInstruction || "").trim();
    if (systemInstruction) messages.push({ role: "system", content: systemInstruction });
    const referenceMessage = buildReferenceMessage(reference);
    if (referenceMessage) messages.push(referenceMessage);
    const history = Array.isArray(options.history) ? options.history : [];
    history.forEach((message) => {
      if ((message?.role === "user" || message?.role === "assistant") && String(message.content || "").trim()) {
        messages.push({ role: message.role, content: String(message.content) });
      }
    });
    messages.push({
      role: "user",
      content: preset.id === "question"
        ? userInstruction
        : `[タスク]\n${purposeInstruction}\n\n[利用者の指示]\n${userInstruction}`
    });
    return messages;
  }

  function aiAppendMarkdown(answer, heading = "AI回答") {
    const content = String(answer || "").trim();
    return content ? `\n\n## ${heading}\n\n${content}` : "";
  }

  function aiMemoTitle(purpose, sourceTitle, maxLength = 60) {
    const name = String(sourceTitle || "無題メモ").trim() || "無題メモ";
    const preset = promptPreset(purpose);
    const prefix = preset.id === "question" ? "AI回答" : preset.name;
    const title = preset.id === "question" ? `${prefix}: ${name}` : `「${name}」の${prefix}`;
    return title.length <= maxLength ? title : `${title.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
  }

  const api = { AI_PROMPTS, aiAppendMarkdown, aiMemoTitle, buildAiMessages, promptPreset };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusAiPrompts = api;
})(typeof window !== "undefined" ? window : globalThis);
