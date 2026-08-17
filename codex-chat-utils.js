(function (globalScope) {
  "use strict";
  const CONTEXT_LIMIT = 12000;
  function clipText(value, limit = CONTEXT_LIMIT) {
    const text = String(value || "");
    return { text: text.slice(0, limit), truncated: text.length > limit };
  }
  function buildAttachment(note, kind) {
    if (!note) return null;
    if (kind === "selection") {
      const selected = clipText(note.selection || "");
      return selected.text ? { kind, title: note.title || "無題メモ", text: selected.text, truncated: selected.truncated } : null;
    }
    const body = clipText(note.body || "");
    return { kind: "note", title: note.title || "無題メモ", text: body.text, truncated: body.truncated };
  }
  function formatPrompt(message, attachment) {
    const question = String(message || "").trim();
    if (!attachment) return question;
    const label = attachment.kind === "selection" ? "選択範囲" : "このメモ";
    return `${question}\n\n[Memo Nexus 添付: ${label}]\nタイトル: ${attachment.title}\n内容:\n${attachment.text}${attachment.truncated ? "\n（安全上の上限で末尾を省略）" : ""}\n[/Memo Nexus 添付]`;
  }
  function normalizeThreadInfo(value) {
    if (!value || typeof value !== "object" || !String(value.threadId || "").trim()) return null;
    return { threadId: String(value.threadId), lastUsedAt: value.lastUsedAt || null, title: String(value.title || "").slice(0, 80) };
  }
  const api = { CONTEXT_LIMIT, buildAttachment, clipText, formatPrompt, normalizeThreadInfo };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusCodexChatUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
