const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAttachment, extractEditorSelection, formatPrompt, normalizeThreadInfo, withCodexThread, withoutCodexThread } = require("./codex-chat-utils.js");

test("Codex添付は明示指定された本文または選択範囲だけを整形する", () => {
  assert.equal(buildAttachment({ title: "A", body: "本文" }, "selection"), null);
  const attachment = buildAttachment({ title: "A", body: "本文", selection: "選択" }, "selection");
  assert.equal(attachment.kind, "selection");
  assert.match(formatPrompt("質問", attachment), /\[Memo Nexus 添付: 選択範囲\]/);
});

test("Codexスレッド関連情報はIDがある場合だけ保存対象にする", () => {
  assert.equal(normalizeThreadInfo({}), null);
  assert.deepEqual(normalizeThreadInfo({ threadId: "thread-a", title: "会話" }), { threadId: "thread-a", lastUsedAt: null, title: "会話" });
});

test("textareaの選択範囲だけをスナップショットする", () => {
  assert.equal(extractEditorSelection({ value: "本文の選択範囲です", selectionStart: 3, selectionEnd: 7 }), "選択範囲");
  assert.equal(extractEditorSelection({ value: "本文", selectionStart: 1, selectionEnd: 1 }), "");
});

test("スレッド保存と解除は対象メモだけを不変に更新する", () => {
  const noteA = { id: "a", title: "A", body: "本文A", tags: ["work"] };
  const noteB = { id: "b", codexChat: { threadId: "thread-b" } };
  const savedA = withCodexThread(noteA, { threadId: "thread-a" }, "2026-08-17T00:00:00.000Z");
  assert.equal(savedA.codexChat.threadId, "thread-a");
  assert.equal(noteB.codexChat.threadId, "thread-b");
  assert.deepEqual(withoutCodexThread(savedA), noteA);
  assert.equal(withCodexThread({ id: "deleted", deletedAt: 1 }, { threadId: "thread-x" }).codexChat, undefined);
});
