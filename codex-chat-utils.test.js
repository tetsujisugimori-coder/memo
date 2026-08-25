const test = require("node:test");
const assert = require("node:assert/strict");
const { BRIDGE_TOKEN_SESSION_KEY, buildAttachment, buildBridgeRequestHeaders, clearSessionBridgeToken, codexThreadResourceKey, createCodexChatState, createCodexThreadSaveCoordinator, extractEditorSelection, formatPrompt, isCodexThreadSaveRequest, loadSessionBridgeToken, mergeStoredCodexThread, normalizeBridgeToken, normalizeThreadInfo, readCodexEventStream, saveSessionBridgeToken, withCodexThread, withoutCodexThread } = require("./codex-chat-utils.js");
const { createNoteSaveFoundation, createSaveRequest } = require("./note-save-foundation.js");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createSaveHarness(writeSnapshot) {
  const foundation = createNoteSaveFoundation({ writeSnapshot, logError() {} });
  return {
    coordinator: createCodexThreadSaveCoordinator({ foundation, createSaveRequest }),
    foundation
  };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
}

function createProductionSaveHarness({ initialNotes, beforeCodexPersist, beforeNormalPersist } = {}) {
  const sourceNotes = initialNotes || [{
    id: "memo-a",
    title: "題名",
    body: "本文0",
    revision: 0,
    codexChat: { threadId: "thread-a", title: "会話A", lastUsedAt: "2026-08-25T00:00:00.000Z" }
  }];
  const stored = new Map(sourceNotes.map((note) => [note.id, structuredClone(note)]));
  const notes = new Map(sourceNotes.map((note) => [note.id, structuredClone(note)]));
  const liveDrafts = new Map();
  const codexWriterCalls = [];
  const normalWriterCalls = [];
  const staleRequests = [];
  let foundation;
  let coordinator;

  function applyCodex(note, codexChat) {
    if (!note) return;
    if (codexChat) note.codexChat = structuredClone(codexChat);
    else delete note.codexChat;
  }

  foundation = createNoteSaveFoundation({
    async writeSnapshot(snapshot, request) {
      if (isCodexThreadSaveRequest(request)) {
        return foundation.runExclusive([snapshot.noteId], async () => {
          if (!coordinator.isCurrentRequest(request)) {
            staleRequests.push(request);
            return snapshot;
          }
          codexWriterCalls.push({ request, snapshot: structuredClone(snapshot) });
          if (beforeCodexPersist) await beforeCodexPersist({ request, snapshot });
          const current = stored.get(snapshot.noteId);
          if (!current) throw new Error("missing memo");
          const saved = structuredClone(current);
          applyCodex(saved, snapshot.codexChat);
          stored.set(snapshot.noteId, saved);
          coordinator.markPersisted(request);
          return snapshot;
        });
      }
      normalWriterCalls.push({ request, snapshot: structuredClone(snapshot) });
      if (beforeNormalPersist) await beforeNormalPersist({ request, snapshot });
      const saved = mergeStoredCodexThread(structuredClone(snapshot), stored.get(snapshot.id));
      stored.set(snapshot.id, structuredClone(saved));
      return saved;
    },
    logError() {}
  });
  coordinator = createCodexThreadSaveCoordinator({ foundation, createSaveRequest });
  sourceNotes.forEach((note) => foundation.registerNote(note.id, note.revision));

  function applyCodexResult(result) {
    if (!result?.request || !coordinator.wasPersisted(result.request)) return;
    const { noteId, codexChat } = result.request.snapshot;
    applyCodex(notes.get(noteId), codexChat);
    applyCodex(liveDrafts.get(noteId), codexChat);
  }

  async function saveCodex({ noteId, threadId, codexChat }) {
    const result = await coordinator.enqueue({ noteId, threadId, codexChat });
    applyCodexResult(result);
    return result;
  }

  async function retryCodex(threadId) {
    const result = await coordinator.retry(threadId);
    applyCodexResult(result);
    return result;
  }

  async function saveNormal(noteId, mutate) {
    const note = liveDrafts.get(noteId) || structuredClone(notes.get(noteId));
    if (typeof mutate === "function") mutate(note);
    note.revision = foundation.markChanged(noteId, note.revision);
    liveDrafts.set(noteId, note);
    notes.set(noteId, note);
    const request = createSaveRequest({ noteId, revision: note.revision, snapshot: note });
    const result = await foundation.enqueueSave(request);
    if (result.state.currentRevision === request.revision) {
      const saved = structuredClone(mergeStoredCodexThread(request.snapshot, liveDrafts.get(noteId) || notes.get(noteId)));
      notes.set(noteId, saved);
      if (liveDrafts.get(noteId)?.revision === request.revision) liveDrafts.delete(noteId);
    }
    return result;
  }

  return {
    codexWriterCalls,
    coordinator,
    foundation,
    liveDrafts,
    normalWriterCalls,
    notes,
    retryCodex,
    saveCodex,
    saveNormal,
    staleRequests,
    stored
  };
}

async function runSameMemoThreadReplacement(pendingCodexChat) {
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const harness = createProductionSaveHarness({
    initialNotes: [{ id: "memo-a", title: "題名", body: "本文", revision: 0 }],
    async beforeCodexPersist({ snapshot }) {
      if (snapshot.threadId === "thread-a" && snapshot.revision === 1) {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
    }
  });
  const firstSave = harness.saveCodex({
    noteId: "memo-a",
    threadId: "thread-a",
    codexChat: { threadId: "thread-a", title: "A1", lastUsedAt: "2026-08-25T00:00:00.000Z" }
  });
  await firstStarted.promise;
  const pendingSave = harness.saveCodex({
    noteId: "memo-a",
    threadId: "thread-a",
    codexChat: pendingCodexChat
  });
  const replacementSave = harness.saveCodex({
    noteId: "memo-a",
    threadId: "thread-b",
    codexChat: { threadId: "thread-b", title: "B", lastUsedAt: "2026-08-25T00:02:00.000Z" }
  });
  await waitFor(() => harness.coordinator.getState("thread-b")?.status === "saving", "thread B did not reserve the memo lock");
  releaseFirst.resolve();
  await Promise.all([firstSave, pendingSave, replacementSave]);
  return harness;
}

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

test("接続tokenはsessionStorageだけへ保持し通信時だけBearerへ設定する", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const token = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
  assert.equal(normalizeBridgeToken("short"), "");
  assert.equal(saveSessionBridgeToken(storage, token), token);
  assert.equal(values.get(BRIDGE_TOKEN_SESSION_KEY), token);
  assert.equal(loadSessionBridgeToken(storage), token);
  assert.deepEqual(buildBridgeRequestHeaders(token, true), {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  });
  clearSessionBridgeToken(storage);
  assert.equal(loadSessionBridgeToken(storage), "");

  const savedNote = withCodexThread({ id: "a", body: "本文" }, { threadId: "thread-a" });
  assert.equal(JSON.stringify(savedNote).includes(token), false);
  assert.deepEqual(Object.keys(savedNote.codexChat).sort(), ["lastUsedAt", "threadId", "title"]);
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

test("同一Codexスレッドの保存中更新は古い完了をdirtyのままにし最新revisionを追従保存する", async () => {
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const secondStarted = deferred();
  const releaseSecond = deferred();
  const writes = [];
  const { coordinator } = createSaveHarness(async (snapshot) => {
    writes.push(structuredClone(snapshot));
    if (writes.length === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
    } else {
      secondStarted.resolve();
      await releaseSecond.promise;
    }
  });
  const firstThread = { threadId: "thread-a", title: "1件目", lastUsedAt: "2026-08-25T00:00:00.000Z" };
  const firstSave = coordinator.enqueue({ noteId: "memo-a", threadId: "thread-a", codexChat: firstThread });
  await firstStarted.promise;
  const secondThread = { threadId: "thread-a", title: "2件目", lastUsedAt: "2026-08-25T00:01:00.000Z" };
  const secondSave = coordinator.enqueue({ noteId: "memo-a", threadId: "thread-a", codexChat: secondThread });
  firstThread.title = "要求後に変更";
  secondThread.title = "要求後に変更";
  releaseFirst.resolve();
  await secondStarted.promise;
  const firstResult = await firstSave;
  assert.equal(firstResult.state.dirty, true);
  assert.equal(firstResult.state.lastSavedRevision, 1);
  assert.equal(coordinator.getState("thread-a").currentRevision, 2);
  assert.equal(writes[0].codexChat.title, "1件目");
  releaseSecond.resolve();
  await secondSave;
  assert.equal(writes[1].codexChat.title, "2件目");
  assert.equal(writes[1].revision, 2);
  assert.equal(coordinator.getState("thread-a").dirty, false);
});

test("スレッドA保存中にBへ切り替えてもresource key・noteId・snapshotを混同しない", async () => {
  const releaseA = deferred();
  const startedA = deferred();
  const writes = [];
  const { coordinator } = createSaveHarness(async (snapshot, request) => {
    writes.push({ request, snapshot: structuredClone(snapshot) });
    if (snapshot.threadId === "thread-a") {
      startedA.resolve();
      await releaseA.promise;
    }
  });
  const saveA = coordinator.enqueue({ noteId: "memo-a", threadId: "thread-a", codexChat: { threadId: "thread-a", title: "A" } });
  await startedA.promise;
  const saveB = coordinator.enqueue({ noteId: "memo-b", threadId: "thread-b", codexChat: { threadId: "thread-b", title: "B" } });
  await saveB;
  assert.deepEqual(writes.map(({ snapshot }) => [snapshot.noteId, snapshot.threadId, snapshot.codexChat.title]), [
    ["memo-a", "thread-a", "A"],
    ["memo-b", "thread-b", "B"]
  ]);
  assert.equal(writes[0].request.resourceKey, codexThreadResourceKey("thread-a"));
  assert.equal(writes[1].request.resourceKey, codexThreadResourceKey("thread-b"));
  assert.equal(coordinator.getState("thread-b").dirty, false);
  assert.equal(coordinator.getState("thread-a").dirty, true);
  releaseA.resolve();
  await saveA;
});

test("Codexスレッド保存失敗はdirtyとsnapshotを保持し、後続変更と明示再試行で最新内容を保存する", async () => {
  const writes = [];
  let failuresRemaining = 2;
  const { coordinator } = createSaveHarness(async (snapshot) => {
    writes.push(structuredClone(snapshot));
    if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      throw new Error("IndexedDB failure");
    }
  });
  await assert.rejects(
    coordinator.enqueue({ noteId: "memo-a", threadId: "thread-a", codexChat: { threadId: "thread-a", title: "古い内容" } }),
    /IndexedDB failure/
  );
  assert.equal(coordinator.getState("thread-a").dirty, true);
  await assert.rejects(
    coordinator.enqueue({ noteId: "memo-a", threadId: "thread-a", codexChat: { threadId: "thread-a", title: "最新内容" } }),
    /IndexedDB failure/
  );
  const failedState = coordinator.getState("thread-a");
  assert.equal(failedState.currentRevision, 2);
  assert.equal(failedState.lastSavedRevision, 0);
  await coordinator.retry("thread-a");
  assert.equal(writes.at(-1).codexChat.title, "最新内容");
  assert.equal(writes.at(-1).revision, 2);
  assert.equal(coordinator.getState("thread-a").dirty, false);
});

test("Codex writerは実メモIDの共通ロックを使い、先行する通常メモsnapshotの後へ部分更新する", async () => {
  const normalStarted = deferred();
  const releaseNormal = deferred();
  let stored = { id: "memo-a", title: "題名", body: "本文0", revision: 0 };
  let foundation;
  foundation = createNoteSaveFoundation({
    async writeSnapshot(snapshot, request) {
      if (isCodexThreadSaveRequest(request)) {
        return foundation.runExclusive([snapshot.noteId], async () => {
          stored = snapshot.codexChat ? { ...stored, codexChat: structuredClone(snapshot.codexChat) } : (() => {
            const { codexChat: _removed, ...rest } = stored;
            return rest;
          })();
        });
      }
      normalStarted.resolve();
      await releaseNormal.promise;
      stored = structuredClone(snapshot);
    },
    logError() {}
  });
  const coordinator = createCodexThreadSaveCoordinator({ foundation, createSaveRequest });
  const normalRevision = foundation.markChanged("memo-a", 0);
  const normalSave = foundation.enqueueSave(createSaveRequest({
    noteId: "memo-a",
    revision: normalRevision,
    snapshot: { ...stored, body: "本文1", revision: normalRevision }
  }));
  await normalStarted.promise;
  const codexSave = coordinator.enqueue({
    noteId: "memo-a",
    threadId: "thread-a",
    codexChat: { threadId: "thread-a", title: "会話A", lastUsedAt: "2026-08-25T00:00:00.000Z" }
  });
  releaseNormal.resolve();
  await Promise.all([normalSave, codexSave]);
  assert.equal(stored.body, "本文1");
  assert.equal(stored.codexChat.threadId, "thread-a");
  assert.equal(foundation.getState("memo-a").dirty, false);
  assert.equal(coordinator.getState("thread-a").dirty, false);
});

test("失敗した旧スレッド要求は同じメモの新スレッド保存後に再試行されない", async () => {
  const writes = [];
  let failThreadA = true;
  const { coordinator } = createSaveHarness(async (snapshot) => {
    writes.push(structuredClone(snapshot));
    if (snapshot.threadId === "thread-a" && failThreadA) {
      failThreadA = false;
      throw new Error("old thread failed");
    }
  });
  await assert.rejects(
    coordinator.enqueue({ noteId: "memo-a", threadId: "thread-a", codexChat: { threadId: "thread-a", title: "旧会話" } }),
    /old thread failed/
  );
  await coordinator.enqueue({ noteId: "memo-a", threadId: "thread-b", codexChat: { threadId: "thread-b", title: "新会話" } });
  const retryResult = await coordinator.retry("thread-a");
  assert.equal(retryResult, null);
  assert.deepEqual(writes.map((snapshot) => snapshot.threadId), ["thread-a", "thread-b"]);
});

test("同じメモでA1保存中・A2 pending・B移行時はA2をDB直前で無効化しBを最終値にする", async () => {
  const harness = await runSameMemoThreadReplacement({
    threadId: "thread-a",
    title: "A2",
    lastUsedAt: "2026-08-25T00:01:00.000Z"
  });

  assert.equal(harness.stored.get("memo-a").codexChat.threadId, "thread-b");
  assert.equal(harness.notes.get("memo-a").codexChat.threadId, "thread-b");
  assert.deepEqual(harness.codexWriterCalls.map(({ snapshot }) => `${snapshot.threadId}:${snapshot.revision}`), ["thread-a:1", "thread-b:1"]);
  assert.equal(harness.staleRequests.length, 1);
  assert.equal(harness.staleRequests[0].snapshot.revision, 2);
  assert.equal(harness.coordinator.getState("thread-a").lastSavedRevision, 2);
  assert.equal(harness.coordinator.getState("thread-a").dirty, false);
  assert.equal((await harness.foundation.whenIdle(codexThreadResourceKey("thread-a"))).dirty, false);
  const writesBeforeRetry = harness.codexWriterCalls.length;
  assert.equal(await harness.retryCodex("thread-a"), null);
  assert.equal(harness.codexWriterCalls.length, writesBeforeRetry);
});

test("同じメモのstaleなA2解除要求は新しいBを削除しない", async () => {
  const harness = await runSameMemoThreadReplacement(null);

  assert.equal(harness.stored.get("memo-a").codexChat.threadId, "thread-b");
  assert.equal(harness.notes.get("memo-a").codexChat.threadId, "thread-b");
  assert.deepEqual(harness.codexWriterCalls.map(({ snapshot }) => `${snapshot.threadId}:${snapshot.revision}`), ["thread-a:1", "thread-b:1"]);
  assert.equal(harness.staleRequests.length, 1);
  assert.equal(harness.staleRequests[0].snapshot.codexChat, null);
});

test("Codex追加失敗後の通常保存は未確定threadを保存せず、再試行成功時だけDB・notes・live draftへ反映する", async () => {
  let failCodex = true;
  const harness = createProductionSaveHarness({
    async beforeCodexPersist({ snapshot }) {
      if (snapshot.threadId === "thread-b" && failCodex) throw new Error("Codex IndexedDB failure");
    }
  });
  const pendingThread = { threadId: "thread-b", title: "会話B", lastUsedAt: "2026-08-25T01:00:00.000Z" };
  await assert.rejects(harness.saveCodex({ noteId: "memo-a", threadId: "thread-b", codexChat: pendingThread }), /Codex IndexedDB failure/);
  pendingThread.title = "要求後の変更";
  assert.equal(harness.coordinator.getState("thread-b").dirty, true);
  assert.equal(harness.notes.get("memo-a").codexChat.threadId, "thread-a");

  await harness.saveNormal("memo-a", (note) => { note.body = "本文1"; });
  assert.equal(harness.stored.get("memo-a").body, "本文1");
  assert.equal(harness.stored.get("memo-a").codexChat.threadId, "thread-a");
  assert.equal(harness.normalWriterCalls.at(-1).snapshot.codexChat.threadId, "thread-a");

  harness.liveDrafts.set("memo-a", { ...structuredClone(harness.notes.get("memo-a")), body: "未保存本文" });
  failCodex = false;
  await harness.retryCodex("thread-b");
  assert.equal(harness.stored.get("memo-a").codexChat.threadId, "thread-b");
  assert.equal(harness.stored.get("memo-a").codexChat.title, "会話B");
  assert.equal(harness.notes.get("memo-a").codexChat.threadId, "thread-b");
  assert.equal(harness.liveDrafts.get("memo-a").codexChat.threadId, "thread-b");
});

test("Codex解除失敗後の通常保存は確定済み旧threadを削除しない", async () => {
  let failRemoval = true;
  const harness = createProductionSaveHarness({
    async beforeCodexPersist({ snapshot }) {
      if (snapshot.threadId === "thread-a" && snapshot.codexChat === null && failRemoval) throw new Error("remove failed");
    }
  });

  await assert.rejects(harness.saveCodex({ noteId: "memo-a", threadId: "thread-a", codexChat: null }), /remove failed/);
  await harness.saveNormal("memo-a", (note) => { note.body = "解除失敗後の本文"; });
  assert.equal(harness.stored.get("memo-a").body, "解除失敗後の本文");
  assert.equal(harness.stored.get("memo-a").codexChat.threadId, "thread-a");
  assert.equal(harness.notes.get("memo-a").codexChat.threadId, "thread-a");
  assert.equal(harness.coordinator.getState("thread-a").dirty, true);
  failRemoval = false;
});

test("失敗した旧要求の完了処理は後続の新threadを巻き戻さない", async () => {
  const oldStarted = deferred();
  const releaseOld = deferred();
  const harness = createProductionSaveHarness({
    async beforeCodexPersist({ snapshot }) {
      if (snapshot.threadId !== "thread-b") return;
      oldStarted.resolve();
      await releaseOld.promise;
      throw new Error("old request failed");
    }
  });
  const oldSave = harness.saveCodex({
    noteId: "memo-a",
    threadId: "thread-b",
    codexChat: { threadId: "thread-b", title: "失敗するB" }
  });
  await oldStarted.promise;
  const latestSave = harness.saveCodex({
    noteId: "memo-a",
    threadId: "thread-c",
    codexChat: { threadId: "thread-c", title: "最新C" }
  });
  releaseOld.resolve();
  await assert.rejects(oldSave, /old request failed/);
  await latestSave;
  assert.equal(harness.stored.get("memo-a").codexChat.threadId, "thread-c");
  assert.equal(harness.notes.get("memo-a").codexChat.threadId, "thread-c");
  assert.equal(await harness.retryCodex("thread-b"), null);
});

test("新しい未確定threadが失敗しても直前に成功した旧要求を確定値としてメモリへ反映する", async () => {
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const harness = createProductionSaveHarness({
    async beforeCodexPersist({ snapshot }) {
      if (snapshot.threadId === "thread-b") {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
      if (snapshot.threadId === "thread-c") throw new Error("latest request failed");
    }
  });
  const committedSave = harness.saveCodex({
    noteId: "memo-a",
    threadId: "thread-b",
    codexChat: { threadId: "thread-b", title: "確定B" }
  });
  await firstStarted.promise;
  const failedLatestSave = harness.saveCodex({
    noteId: "memo-a",
    threadId: "thread-c",
    codexChat: { threadId: "thread-c", title: "未確定C" }
  });
  releaseFirst.resolve();
  await committedSave;
  await assert.rejects(failedLatestSave, /latest request failed/);
  assert.equal(harness.stored.get("memo-a").codexChat.threadId, "thread-b");
  assert.equal(harness.notes.get("memo-a").codexChat.threadId, "thread-b");
  assert.equal(harness.coordinator.getState("thread-c").dirty, true);
});

test("通常保存先行とCodex保存先行の両方で本文と最新threadを維持する", async (t) => {
  await t.test("通常保存が先行する", async () => {
    const normalStarted = deferred();
    const releaseNormal = deferred();
    const harness = createProductionSaveHarness({
      async beforeNormalPersist() {
        normalStarted.resolve();
        await releaseNormal.promise;
      }
    });
    const normalSave = harness.saveNormal("memo-a", (note) => { note.body = "通常先行本文"; });
    await normalStarted.promise;
    const codexSave = harness.saveCodex({ noteId: "memo-a", threadId: "thread-b", codexChat: { threadId: "thread-b", title: "B" } });
    await waitFor(() => harness.coordinator.getState("thread-b")?.status === "saving", "Codex save did not wait for normal save");
    releaseNormal.resolve();
    await Promise.all([normalSave, codexSave]);
    assert.equal(harness.stored.get("memo-a").body, "通常先行本文");
    assert.equal(harness.stored.get("memo-a").codexChat.threadId, "thread-b");
  });

  await t.test("Codex保存が先行する", async () => {
    const codexStarted = deferred();
    const releaseCodex = deferred();
    const harness = createProductionSaveHarness({
      async beforeCodexPersist({ snapshot }) {
        if (snapshot.threadId !== "thread-b") return;
        codexStarted.resolve();
        await releaseCodex.promise;
      }
    });
    const codexSave = harness.saveCodex({ noteId: "memo-a", threadId: "thread-b", codexChat: { threadId: "thread-b", title: "B" } });
    await codexStarted.promise;
    const normalSave = harness.saveNormal("memo-a", (note) => { note.body = "Codex先行本文"; });
    releaseCodex.resolve();
    await Promise.all([codexSave, normalSave]);
    assert.equal(harness.stored.get("memo-a").body, "Codex先行本文");
    assert.equal(harness.stored.get("memo-a").codexChat.threadId, "thread-b");
    assert.equal(harness.notes.get("memo-a").codexChat.threadId, "thread-b");
  });
});

test("異なるメモのCodex保存は実メモIDロックでも相互待機しない", async () => {
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const harness = createProductionSaveHarness({
    initialNotes: [
      { id: "memo-a", title: "A", body: "A", revision: 0 },
      { id: "memo-b", title: "B", body: "B", revision: 0 }
    ],
    async beforeCodexPersist({ snapshot }) {
      if (snapshot.noteId === "memo-a") {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
    }
  });
  const saveA = harness.saveCodex({ noteId: "memo-a", threadId: "thread-a", codexChat: { threadId: "thread-a", title: "A" } });
  await firstStarted.promise;
  await harness.saveCodex({ noteId: "memo-b", threadId: "thread-b", codexChat: { threadId: "thread-b", title: "B" } });
  assert.equal(harness.stored.get("memo-b").codexChat.threadId, "thread-b");
  assert.equal(harness.coordinator.getState("thread-a").status, "saving");
  releaseFirst.resolve();
  await saveA;
});

test("既存形式のCodexスレッド情報を保存coordinator導入後もそのまま読み込める", () => {
  const legacy = { threadId: "thread-existing", title: "既存会話", lastUsedAt: "2026-08-24T12:00:00.000Z" };
  const controller = createCodexChatState(() => legacy);
  controller.switchNote("memo-existing");
  assert.deepEqual(controller.conversation().thread, legacy);
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
