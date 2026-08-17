const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAttachment, formatPrompt, normalizeThreadInfo } = require("./codex-chat-utils.js");

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
