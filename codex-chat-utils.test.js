const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAttachment, createCodexChatState, extractEditorSelection, formatPrompt, normalizeThreadInfo, readCodexEventStream, withCodexThread, withoutCodexThread } = require("./codex-chat-utils.js");

function readerFromChunks(chunks, failure = null) {
  let index = 0;
  return {
    async read() {
      if (failure && index === failure.at) throw failure.error;
      if (index >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[index++] };
    }
  };
}

const bytes = (value) => new TextEncoder().encode(value);

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

test("Codex SSEは分割chunkと1chunk内の複数イベントを順番に復元する", async () => {
  const events = [];
  const source = 'data: {"type":"delta","delta":"日本語"}\n\ndata: {"type":"delta","delta":"です"}\n\ndata: {"type":"done"}\n\n';
  const encoded = bytes(source);
  await readCodexEventStream(readerFromChunks([encoded.slice(0, 18), encoded.slice(18, 37), encoded.slice(37)]), (event) => events.push(event));
  assert.deepEqual(events.map((event) => event.type), ["delta", "delta", "done"]);
  assert.equal(events[0].delta, "日本語");
});

test("Codex SSEはUTF-8文字の途中でchunkが分かれても文字化けしない", async () => {
  const events = [];
  const prefix = bytes('data: {"type":"delta","delta":"');
  const japanese = bytes("調査");
  const suffix = bytes('"}\n\ndata: {"type":"done"}');
  const first = new Uint8Array(prefix.length + 1);
  first.set(prefix); first.set(japanese.slice(0, 1), prefix.length);
  const second = new Uint8Array(japanese.length - 1 + suffix.length);
  second.set(japanese.slice(1)); second.set(suffix, japanese.length - 1);
  await readCodexEventStream(readerFromChunks([first, second]), (event) => events.push(event));
  assert.equal(events[0].delta, "調査");
  assert.equal(events.at(-1).type, "done");
});

test("Codex SSEは最後に改行がなくてもdoneを正常完了として扱う", async () => {
  const result = await readCodexEventStream(readerFromChunks([bytes('data: {"type":"done"}') ]));
  assert.deepEqual(result, { type: "done" });
});

test("Codex SSEはdoneなしEOFとerrorイベントを失敗として扱う", async () => {
  await assert.rejects(readCodexEventStream(readerFromChunks([bytes('data: {"type":"delta","delta":"途中"}\n\n')])), /接続が途中で終了/);
  await assert.rejects(readCodexEventStream(readerFromChunks([bytes('data: {"type":"error","error":"応答失敗"}\n\n')])), /応答失敗/);
});

test("Codex SSEはreader.readのrejectを呼出元へ伝える", async () => {
  const failure = new Error("reader failed");
  await assert.rejects(readCodexEventStream(readerFromChunks([], { at: 0, error: failure })), (error) => error === failure);
});

test("Codex SSEは不正JSONを診断可能にし、done後の追加イベントは二重処理しない", async () => {
  await assert.rejects(readCodexEventStream(readerFromChunks([bytes("data: {broken}\n\n")])), /JSONを解析できません/);
  const events = [];
  await readCodexEventStream(readerFromChunks([bytes('data: {"type":"done"}\n\ndata: {broken}\n\ndata: {"type":"error","error":"遅延"}\n\n')]), (event) => events.push(event));
  assert.deepEqual(events, [{ type: "done" }]);
});

test("送信元メモの会話・busy・選択スナップショットをメモ切替から分離する", () => {
  const saved = new Map([["a", { threadId: "thread-a" }], ["b", { threadId: "thread-b" }]]);
  const controller = createCodexChatState((noteId) => saved.get(noteId));
  controller.switchNote("a");
  controller.state.selectionSnapshot = "メモAの選択";
  const requestA = controller.startRequest("a");
  requestA.history.push({ role: "assistant", content: "Aの回答" });
  controller.switchNote("b");
  assert.equal(controller.state.selectionSnapshot, "");
  assert.equal(controller.conversation("b").history.length, 0);
  assert.equal(controller.conversation("b").thread.threadId, "thread-b");
  assert.equal(controller.state.busyRequestNoteId, "a");
  controller.finishRequest("a");
  assert.equal(controller.state.busyRequestNoteId, null);
  assert.equal(controller.conversation("a").history[0].content, "Aの回答");
  controller.state.selectionSnapshot = "メモBの選択";
  controller.switchNote("b");
  assert.equal(controller.state.selectionSnapshot, "メモBの選択");
});

test("添付スナップショットは送信時のタイトル・editor.value・選択範囲を固定する", () => {
  const editor = { value: "編集中の本文です", selectionStart: 4, selectionEnd: 6 };
  const noteAttachment = buildAttachment({ title: "編集中タイトル", body: editor.value }, "note");
  const selectionAttachment = buildAttachment({ title: "編集中タイトル", selection: extractEditorSelection(editor) }, "selection");
  editor.value = "送信後に変更した本文";
  assert.equal(noteAttachment.title, "編集中タイトル");
  assert.equal(noteAttachment.text, "編集中の本文です");
  assert.equal(selectionAttachment.text, "本文");
});
