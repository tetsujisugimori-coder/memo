"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
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

function request(noteId, revision, body, saveTargetGeneration = 0) {
  return createSaveRequest({
    noteId,
    revision,
    saveTargetGeneration,
    snapshot: { id: noteId, title: noteId, body, revision },
    saveRequestId: `${noteId}-${revision}`
  });
}

test("保存先変更なしでは要求作成時のgenerationを固定して通常どおり保存済みにする", async () => {
  let generation = 1;
  const successes = [];
  const foundation = createNoteSaveFoundation({
    getCurrentSaveTargetGeneration: () => generation,
    writeSnapshot: async () => {},
    onSaveSuccess: (saveRequest) => successes.push(saveRequest.saveTargetGeneration)
  });
  foundation.registerNote("A", 0);
  foundation.markChanged("A", 0);
  const saveRequest = request("A", 1, "generation 1", generation);
  generation = 1;
  const result = await foundation.enqueueSave(saveRequest);

  assert.equal(saveRequest.saveTargetGeneration, 1);
  assert.equal(Object.isFrozen(saveRequest), true);
  assert.equal(result.staleSaveTarget, false);
  assert.equal(foundation.getState("A").dirty, false);
  assert.deepEqual(successes, [1]);
});

test("保存中に保存先generationが変わると旧成功ではdirtyを解除せず成功通知もしない", async () => {
  const gate = deferred();
  let generation = 1;
  let successCount = 0;
  const foundation = createNoteSaveFoundation({
    getCurrentSaveTargetGeneration: () => generation,
    writeSnapshot: async () => gate.promise,
    onSaveSuccess: () => { successCount += 1; }
  });
  foundation.registerNote("A", 0);
  foundation.markChanged("A", 0);
  const saving = foundation.enqueueSave(request("A", 1, "old target", 1));
  await Promise.resolve();

  generation = 2;
  gate.resolve();
  const result = await saving;

  assert.equal(result.staleSaveTarget, true);
  assert.equal(foundation.getState("A").lastSavedRevision, 0);
  assert.equal(foundation.getState("A").dirty, true);
  assert.equal(foundation.getState("A").status, "dirty");
  assert.equal(successCount, 0);
});

test("保存先変更後は同じrevisionでも新generationの保存だけを現在成功として確定する", async () => {
  const firstGate = deferred();
  let generation = 1;
  const writes = [];
  const foundation = createNoteSaveFoundation({
    getCurrentSaveTargetGeneration: () => generation,
    writeSnapshot: async (_snapshot, saveRequest) => {
      writes.push(saveRequest.saveTargetGeneration);
      if (saveRequest.saveTargetGeneration === 1) await firstGate.promise;
    }
  });
  foundation.registerNote("A", 0);
  foundation.markChanged("A", 0);
  const oldSave = foundation.enqueueSave(request("A", 1, "same revision", 1));
  await Promise.resolve();
  generation = 2;
  const newSave = foundation.enqueueSave(request("A", 1, "same revision", 2));
  firstGate.resolve();
  const [oldResult, newResult] = await Promise.all([oldSave, newSave]);

  assert.equal(oldResult.staleSaveTarget, true);
  assert.equal(newResult.staleSaveTarget, false);
  assert.deepEqual(writes, [1, 2]);
  assert.equal(foundation.getState("A").lastSavedRevision, 1);
  assert.equal(foundation.getState("A").dirty, false);
});

test("revisionとsaveTargetGenerationは独立した保存済み判定軸として変化する", async () => {
  let generation = 1;
  const foundation = createNoteSaveFoundation({
    getCurrentSaveTargetGeneration: () => generation,
    writeSnapshot: async () => {}
  });
  foundation.registerNote("A", 0);

  foundation.markChanged("A", 0);
  await foundation.enqueueSave(request("A", 1, "revision only", 1));
  assert.equal(foundation.getState("A").dirty, false);

  generation = 2;
  assert.equal(foundation.getState("A").dirty, true);
  await foundation.enqueueSave(request("A", 1, "generation only", 2));
  assert.equal(foundation.getState("A").dirty, false);

  generation = 3;
  foundation.markChanged("A", 1);
  assert.equal(foundation.getState("A").dirty, true);
  await foundation.enqueueSave(request("A", 2, "revision and generation", 3));
  assert.equal(foundation.getState("A").dirty, false);
});

test("旧generationの保存失敗はrejectとエラー通知を維持しつつ現在保存先を失敗扱いにしない", async () => {
  const gate = deferred();
  const oldError = new Error("old target failed");
  let generation = 1;
  const errors = [];
  const foundation = createNoteSaveFoundation({
    getCurrentSaveTargetGeneration: () => generation,
    writeSnapshot: async (_snapshot, saveRequest) => {
      if (saveRequest.saveTargetGeneration === 1) {
        await gate.promise;
        throw oldError;
      }
    },
    onSaveError: (saveRequest, error, state, context) => errors.push({ saveRequest, error, state, context })
  });
  foundation.registerNote("A", 0);
  foundation.markChanged("A", 0);
  const oldSave = foundation.enqueueSave(request("A", 1, "old target", 1));
  await Promise.resolve();
  generation = 2;
  gate.resolve();
  await assert.rejects(oldSave, (error) => error === oldError);

  const staleState = foundation.getState("A");
  assert.equal(staleState.status, "dirty");
  assert.equal(staleState.lastError, null);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].context.staleSaveTarget, true);

  await foundation.enqueueSave(request("A", 1, "new target", 2));
  assert.equal(foundation.getState("A").status, "saved");
});

test("同一保存先での通常連続保存は同じgenerationのまま各revisionを保存する", async () => {
  const generation = 4;
  const writes = [];
  const foundation = createNoteSaveFoundation({
    getCurrentSaveTargetGeneration: () => generation,
    writeSnapshot: async (_snapshot, saveRequest) => writes.push([saveRequest.revision, saveRequest.saveTargetGeneration])
  });
  foundation.registerNote("A", 0);
  foundation.markChanged("A", 0);
  await foundation.enqueueSave(request("A", 1, "first", generation));
  foundation.markChanged("A", 1);
  await foundation.enqueueSave(request("A", 2, "second", generation));

  assert.deepEqual(writes, [[1, 4], [2, 4]]);
  assert.equal(foundation.getState("A").dirty, false);
});

test("atomic batchも旧generationの完了を確定せず新generationの保存を待つ", async () => {
  const started = deferred();
  const gate = deferred();
  let generation = 1;
  let successCount = 0;
  const foundation = createNoteSaveFoundation({
    getCurrentSaveTargetGeneration: () => generation,
    writeSnapshot: async () => {},
    onSaveSuccess: () => { successCount += 1; }
  });
  foundation.registerNote("A", 0);
  foundation.registerNote("B", 0);
  const batch = foundation.beginAtomicBatch(["A", "B"]);
  const requests = ["A", "B"].map((noteId) => {
    const revision = foundation.markBatchChanged(batch, noteId, 0);
    return request(noteId, revision, `${noteId} old target`, 1);
  });
  const saving = foundation.enqueueBatchSave({
    batch,
    noteIds: ["A", "B"],
    createRequests: () => requests,
    writeSnapshots: async () => {
      started.resolve();
      await gate.promise;
    }
  });
  await started.promise;
  generation = 2;
  gate.resolve();
  const results = await saving;
  foundation.completeAtomicBatch(batch);

  assert.equal(results.every((result) => result.staleSaveTarget), true);
  assert.equal(results.every((result) => result.state.dirty), true);
  assert.equal(successCount, 0);
  await Promise.all([
    foundation.enqueueSave(request("A", 1, "A new target", 2)),
    foundation.enqueueSave(request("B", 1, "B new target", 2))
  ]);
  assert.equal(foundation.getState("A").dirty, false);
  assert.equal(foundation.getState("B").dirty, false);
});

test("保存中に再編集しても古いrevisionの完了ではdirtyを解除しない", async () => {
  const gate = deferred();
  const writes = [];
  const foundation = createNoteSaveFoundation({
    writeSnapshot: async (snapshot) => {
      writes.push(snapshot);
      await gate.promise;
    }
  });
  foundation.registerNote("A", 9);
  assert.equal(foundation.markChanged("A", 9), 10);
  const saving = foundation.enqueueSave(request("A", 10, "rev10"));
  await Promise.resolve();

  assert.equal(foundation.markChanged("A", 10), 11);
  gate.resolve();
  await saving;

  assert.equal(writes[0].body, "rev10");
  assert.deepEqual(foundation.getState("A"), {
    noteId: "A", currentRevision: 11, lastSavedRevision: 10, dirty: true,
    status: "dirty", activeRevision: null, pendingRevision: null, lastError: null
  });
});

test("保存中に表示メモが切り替わっても要求作成時のnoteIdとsnapshotだけを保存する", async () => {
  const gate = deferred();
  const writes = [];
  let currentId = "A";
  const foundation = createNoteSaveFoundation({
    writeSnapshot: async (snapshot, saveRequest) => {
      await gate.promise;
      writes.push({ currentId, noteId: saveRequest.noteId, snapshot });
    }
  });
  foundation.registerNote("A", 0);
  foundation.markChanged("A", 0);
  const snapshot = { id: "A", title: "A", body: "Aの本文" };
  const saving = foundation.enqueueSave(createSaveRequest({ noteId: "A", revision: 1, snapshot }));
  snapshot.id = "B";
  snapshot.body = "変更後";
  currentId = "B";
  gate.resolve();
  await saving;

  assert.equal(writes[0].currentId, "B");
  assert.equal(writes[0].noteId, "A");
  assert.equal(writes[0].snapshot.id, "A");
  assert.equal(writes[0].snapshot.body, "Aの本文");
});

test("debounce待機中に切り替えても事前確定したAのsnapshotをAとして保存する", async () => {
  const writes = [];
  const foundation = createNoteSaveFoundation({ writeSnapshot: async (snapshot) => writes.push(snapshot) });
  foundation.registerNote("A", 3);
  const revision = foundation.markChanged("A", 3);
  const pendingSnapshot = { id: "A", title: "A", body: "切替前の本文" };

  let currentId = "B";
  await foundation.enqueueSave(createSaveRequest({ noteId: "A", revision, snapshot: pendingSnapshot }));

  assert.equal(currentId, "B");
  assert.deepEqual(writes.map(({ id, body, revision: savedRevision }) => ({ id, body, revision: savedRevision })), [
    { id: "A", body: "切替前の本文", revision: 4 }
  ]);
});

test("開始前の古い保存要求を最新revisionへ集約する", async () => {
  const writes = [];
  const foundation = createNoteSaveFoundation({ writeSnapshot: async (snapshot) => writes.push(snapshot) });
  foundation.registerNote("A", 9);
  const promises = [];
  for (const revision of [10, 11, 12]) {
    foundation.markChanged("A", revision - 1);
    promises.push(foundation.enqueueSave(request("A", revision, `rev${revision}`)));
  }
  const results = await Promise.all(promises);

  assert.deepEqual(writes.map((snapshot) => snapshot.revision), [12]);
  assert.equal(results.every((result) => result.request.revision === 12), true);
  assert.equal(foundation.getState("A").lastSavedRevision, 12);

  const gate = deferred();
  const activeWrites = [];
  const activeFoundation = createNoteSaveFoundation({
    writeSnapshot: async (snapshot) => {
      activeWrites.push(snapshot.revision);
      await gate.promise;
    }
  });
  activeFoundation.registerNote("A", 9);
  activeFoundation.markChanged("A", 9);
  activeFoundation.markChanged("A", 10);
  activeFoundation.markChanged("A", 11);
  const latestSave = activeFoundation.enqueueSave(request("A", 12, "rev12"));
  await Promise.resolve();
  const staleSave = activeFoundation.enqueueSave(request("A", 11, "rev11"));
  gate.resolve();
  const [, staleResult] = await Promise.all([latestSave, staleSave]);
  assert.deepEqual(activeWrites, [12]);
  assert.equal(staleResult.request.revision, 12);
});

test("IndexedDB保存失敗後もdirtyと編集内容を維持し、同じrevisionを再保存できる", async () => {
  const persisted = new Map();
  let shouldFail = true;
  const foundation = createNoteSaveFoundation({
    writeSnapshot: async (snapshot) => {
      if (shouldFail) throw new Error("IndexedDB failure");
      persisted.set(snapshot.id, snapshot);
    }
  });
  foundation.registerNote("A", 19);
  foundation.markChanged("A", 19);
  const saveRequest = request("A", 20, "失われない本文");

  await assert.rejects(foundation.enqueueSave(saveRequest), /IndexedDB failure/);
  assert.equal(foundation.getState("A").dirty, true);
  assert.equal(foundation.getState("A").currentRevision, 20);
  assert.match(foundation.getState("A").lastError.message, /IndexedDB failure/);

  shouldFail = false;
  await foundation.enqueueSave(saveRequest);
  assert.equal(persisted.get("A").body, "失われない本文");
  assert.equal(foundation.getState("A").dirty, false);
});

test("保存失敗後の再編集は新revisionの成功時だけ保存済みになる", async () => {
  const writes = [];
  let attempts = 0;
  const foundation = createNoteSaveFoundation({
    writeSnapshot: async (snapshot) => {
      attempts += 1;
      if (attempts === 1) throw new Error("first failure");
      writes.push(snapshot);
    }
  });
  foundation.registerNote("A", 19);
  foundation.markChanged("A", 19);
  await assert.rejects(foundation.enqueueSave(request("A", 20, "rev20")), /first failure/);
  assert.equal(foundation.markChanged("A", 20), 21);
  await foundation.enqueueSave(request("A", 21, "rev21"));

  assert.equal(writes.at(-1).body, "rev21");
  assert.equal(foundation.getState("A").lastSavedRevision, 21);
  assert.equal(foundation.getState("A").dirty, false);
  assert.equal(foundation.getState("A").lastError, null);
});

test("複数メモのキューはnoteId・revision・失敗状態を共有しない", async () => {
  const gates = { A: deferred(), B: deferred() };
  const writes = [];
  const foundation = createNoteSaveFoundation({
    writeSnapshot: async (snapshot) => {
      await gates[snapshot.id].promise;
      writes.push(snapshot);
    }
  });
  foundation.registerNote("A", 0);
  foundation.registerNote("B", 6);
  foundation.markChanged("A", 0);
  foundation.markChanged("B", 6);
  const saveA = foundation.enqueueSave(request("A", 1, "A-1"));
  const saveB = foundation.enqueueSave(request("B", 7, "B-7"));
  await Promise.resolve();

  gates.B.resolve();
  await saveB;
  assert.equal(foundation.getState("B").dirty, false);
  assert.equal(foundation.getState("A").dirty, true);
  gates.A.resolve();
  await saveA;

  assert.deepEqual(new Set(writes.map((snapshot) => `${snapshot.id}:${snapshot.revision}`)), new Set(["A:1", "B:7"]));
});

test("高頻度編集でも最終revisionのsnapshotが最後に残る", async () => {
  const persisted = new Map();
  const writes = [];
  const foundation = createNoteSaveFoundation({
    writeSnapshot: async (snapshot) => {
      writes.push(snapshot.revision);
      persisted.set(snapshot.id, snapshot);
    }
  });
  foundation.registerNote("A", 0);
  const promises = [];
  for (let revision = 1; revision <= 200; revision += 1) {
    foundation.markChanged("A", revision - 1);
    promises.push(foundation.enqueueSave(request("A", revision, `本文${revision}`)));
  }
  await Promise.all(promises);

  assert.equal(writes.at(-1), 200);
  assert.equal(persisted.get("A").body, "本文200");
  assert.equal(foundation.getState("A").lastSavedRevision, 200);
  assert.equal(foundation.getState("A").dirty, false);
});

test("UIコールバックが例外を出しても保存成功・idle解放・次revisionを維持する", async () => {
  const writes = [];
  const callbackErrors = [];
  const foundation = createNoteSaveFoundation({
    writeSnapshot: async (snapshot) => writes.push(snapshot.revision),
    onStateChange: () => { throw new Error("state UI failed"); },
    onSaveSuccess: () => { throw new Error("success UI failed"); },
    logError: (message, error) => callbackErrors.push(`${message}:${error.message}`)
  });
  foundation.registerNote("A", 0);
  foundation.markChanged("A", 0);
  await foundation.enqueueSave(request("A", 1, "rev1"));
  assert.equal((await foundation.whenIdle("A")).status, "saved");
  assert.equal(foundation.getState("A").lastError, null);

  foundation.markChanged("A", 1);
  await foundation.enqueueSave(request("A", 2, "rev2"));
  assert.deepEqual(writes, [1, 2]);
  assert.equal(foundation.getState("A").status, "saved");
  assert.equal(callbackErrors.some((item) => item.includes("state UI failed")), true);
  assert.equal(callbackErrors.some((item) => item.includes("success UI failed")), true);
});

test("onSaveError例外はwriterエラーを置き換えず同revisionを再試行できる", async () => {
  const writerError = new Error("IndexedDB unavailable");
  let fail = true;
  const foundation = createNoteSaveFoundation({
    writeSnapshot: async () => { if (fail) throw writerError; },
    onSaveError: () => { throw new Error("error UI failed"); },
    logError: () => {}
  });
  foundation.registerNote("A", 4);
  foundation.markChanged("A", 4);
  const rev5 = request("A", 5, "rev5");
  await assert.rejects(foundation.enqueueSave(rev5), (error) => error === writerError);
  assert.equal((await foundation.whenIdle("A")).lastError, writerError);

  fail = false;
  await foundation.enqueueSave(rev5);
  assert.equal(foundation.getState("A").status, "saved");
  assert.equal(foundation.getState("A").lastError, null);
});

test("入力200回ではcloneせず保存要求作成時だけ固定snapshotをcloneする", () => {
  let cloneCount = 0;
  const liveDraft = { id: "A", revision: 0, body: "", tags: ["one"], nested: { value: 1 } };
  const foundation = createNoteSaveFoundation({ writeSnapshot: async () => {} });
  foundation.registerNote("A", 0);
  for (let index = 1; index <= 200; index += 1) {
    liveDraft.body = "x".repeat(index * 100);
    liveDraft.revision = foundation.markChanged("A", liveDraft.revision);
  }
  assert.equal(cloneCount, 0);

  const saveRequest = createSaveRequest({
    noteId: "A",
    revision: liveDraft.revision,
    snapshot: liveDraft,
    clone: (value) => {
      cloneCount += 1;
      return structuredClone(value);
    }
  });
  assert.equal(cloneCount, 1);
  liveDraft.body = "要求作成後の本文";
  liveDraft.tags.push("two");
  liveDraft.nested.value = 2;
  assert.notEqual(saveRequest.snapshot.body, liveDraft.body);
  assert.deepEqual(saveRequest.snapshot.tags, ["one"]);
  assert.equal(saveRequest.snapshot.nested.value, 1);
  assert.equal(Object.isFrozen(saveRequest.snapshot), true);
  assert.equal(Object.isFrozen(saveRequest.snapshot.nested), true);
});

test("名前空間付きresource keyは通常メモID契約を維持しつつsnapshotの実IDを上書きしない", async () => {
  const writes = [];
  const foundation = createNoteSaveFoundation({ writeSnapshot: async (snapshot, request) => writes.push({ snapshot, request }) });
  const resourceKey = "codex-thread:thread-a";
  const revision = foundation.markChanged(resourceKey, 0);
  const source = { noteId: "memo-a", threadId: "thread-a", codexChat: { threadId: "thread-a", title: "会話" } };
  const saveRequest = createSaveRequest({ resourceKey, resourceType: "codex-thread", revision, snapshot: source });
  source.codexChat.title = "要求後の変更";
  await foundation.enqueueSave(saveRequest);
  assert.equal(saveRequest.noteId, null);
  assert.equal(saveRequest.resourceKey, resourceKey);
  assert.equal(writes[0].snapshot.noteId, "memo-a");
  assert.equal(writes[0].snapshot.id, undefined);
  assert.equal(writes[0].snapshot.codexChat.title, "会話");
  assert.equal(foundation.getState(resourceKey).lastSavedRevision, 1);
});

test("通常保存と複数メモbatchをID順ロックで調停し原子性と最新値を維持する", async () => {
  const firstWrite = deferred();
  const persisted = new Map();
  const events = [];
  const foundation = createNoteSaveFoundation({
    writeSnapshot: async (snapshot) => {
      events.push(`single:${snapshot.id}:${snapshot.revision}`);
      await firstWrite.promise;
      persisted.set(snapshot.id, snapshot);
    }
  });
  const drafts = new Map([
    ["A", { id: "A", revision: 0, body: "A0", collectionId: "old" }],
    ["B", { id: "B", revision: 0, body: "B0", collectionId: "old" }]
  ]);
  foundation.registerNote("A", 0);
  foundation.registerNote("B", 0);
  drafts.get("A").revision = foundation.markChanged("A", 0);
  const savingA = foundation.enqueueSave(request("A", 1, "A1"));
  await Promise.resolve();

  const atomicBatch = foundation.beginAtomicBatch(["A", "B"]);
  drafts.forEach((draft) => {
    draft.collectionId = "new";
    draft.revision = foundation.markBatchChanged(atomicBatch, draft.id, draft.revision);
  });
  const batch = foundation.enqueueBatchSave({
    batch: atomicBatch,
    noteIds: ["B", "A"],
    createRequests: () => ["A", "B"].map((id) => createSaveRequest({ noteId: id, revision: drafts.get(id).revision, snapshot: drafts.get(id) })),
    writeSnapshots: async (snapshots) => {
      events.push(`batch:${snapshots.map((item) => item.id).join("")}`);
      snapshots.forEach((snapshot) => persisted.set(snapshot.id, snapshot));
    }
  });
  firstWrite.resolve();
  await Promise.all([savingA, batch]);
  foundation.completeAtomicBatch(atomicBatch);

  assert.deepEqual(events, ["single:A:1", "batch:AB"]);
  assert.equal(persisted.get("A").collectionId, "new");
  assert.equal(persisted.get("B").collectionId, "new");
  assert.equal(foundation.getState("A").dirty, false);
  assert.equal(foundation.getState("B").dirty, false);
});

test("batch成功通知は各メモの状態を保ったまま同じbatch文脈で識別できる", async () => {
  const notifications = [];
  const foundation = createNoteSaveFoundation({
    writeSnapshot: async () => {},
    onSaveSuccess: (saveRequest, state, context) => notifications.push({ saveRequest, state, context })
  });
  foundation.registerNote("A", 0);
  foundation.registerNote("B", 0);
  const atomicBatch = foundation.beginAtomicBatch(["A", "B"]);
  const drafts = ["A", "B"].map((id) => ({
    id,
    revision: foundation.markBatchChanged(atomicBatch, id, 0),
    body: `${id} batch`
  }));

  const results = await foundation.enqueueBatchSave({
    batch: atomicBatch,
    noteIds: ["A", "B"],
    createRequests: () => drafts.map((draft) => createSaveRequest({ noteId: draft.id, revision: draft.revision, snapshot: draft })),
    writeSnapshots: async () => {}
  });
  foundation.completeAtomicBatch(atomicBatch);

  assert.equal(notifications.length, 2);
  assert.equal(notifications.every(({ context }) => context.batch === atomicBatch), true);
  assert.deepEqual(notifications.map(({ state }) => state.lastSavedRevision), [1, 1]);
  assert.equal(results.every(({ state }) => state.dirty === false), true);
});

test("batch writerが返した実保存snapshotを結果へ対応するメモIDごとに載せる", async () => {
  const foundation = createNoteSaveFoundation({ writeSnapshot: async () => {} });
  foundation.registerNote("A", 0);
  foundation.registerNote("B", 0);
  const atomicBatch = foundation.beginAtomicBatch(["A", "B"]);
  const drafts = ["A", "B"].map((id) => ({
    id,
    revision: foundation.markBatchChanged(atomicBatch, id, 0),
    codexChat: { threadId: "thread-a" }
  }));

  const results = await foundation.enqueueBatchSave({
    batch: atomicBatch,
    noteIds: ["A", "B"],
    createRequests: () => drafts.map((draft) => createSaveRequest({ noteId: draft.id, revision: draft.revision, snapshot: draft })),
    writeSnapshots: async (snapshots) => snapshots.map((snapshot) => ({
      ...snapshot,
      ...(snapshot.id === "A" ? { codexChat: { threadId: "thread-b" } } : {})
    }))
  });
  foundation.completeAtomicBatch(atomicBatch);

  assert.equal(results.find(({ request: saveRequest }) => saveRequest.noteId === "A").savedSnapshot.codexChat.threadId, "thread-b");
  assert.equal(results.find(({ request: saveRequest }) => saveRequest.noteId === "B").savedSnapshot.codexChat.threadId, "thread-a");
});

test("batch transaction失敗中は通常保存を遮断し、解除後はbatch revisionだけを戻す", async () => {
  const drafts = new Map([
    ["A", { id: "A", revision: 0, body: "A", fontSettings: { enabled: true } }],
    ["B", { id: "B", revision: 0, body: "B", fontSettings: { enabled: true } }]
  ]);
  const foundation = createNoteSaveFoundation({ writeSnapshot: async () => {} });
  const atomicBatch = foundation.beginAtomicBatch(["A", "B"]);
  drafts.forEach((draft) => {
    foundation.registerNote(draft.id, 0);
    delete draft.fontSettings;
    draft.revision = foundation.markBatchChanged(atomicBatch, draft.id, 0);
  });
  const transactionError = new Error("atomic transaction aborted");
  await assert.rejects(foundation.enqueueBatchSave({
    batch: atomicBatch,
    noteIds: ["A", "B"],
    createRequests: () => [...drafts.values()].map((draft) => createSaveRequest({ noteId: draft.id, revision: draft.revision, snapshot: draft })),
    writeSnapshots: async () => { throw transactionError; }
  }), (error) => error === transactionError);

  await assert.rejects(foundation.enqueueSave(request("A", 1, "batch field must not escape")), (error) => error.code === "NOTE_BATCH_ACTIVE");
  const states = foundation.abortAtomicBatch(atomicBatch);

  for (const draft of drafts.values()) {
    assert.equal(draft.revision, 1);
    assert.equal(Object.hasOwn(draft, "fontSettings"), false);
    assert.equal(foundation.getState(draft.id).currentRevision, 0);
    assert.equal(foundation.getState(draft.id).dirty, false);
    assert.equal(foundation.getState(draft.id).lastError, transactionError);
  }
  assert.equal(states.length, 2);
});

test("永久削除開始後は変更・保存・batch追加を拒否し、成功後も復活させない", async () => {
  const gate = deferred();
  const foundation = createNoteSaveFoundation({ writeSnapshot: async () => {} });
  foundation.registerNote("A", 2);
  foundation.registerNote("B", 3);
  const deleting = foundation.runTerminalDelete(["B", "A"], () => gate.promise);

  assert.equal(foundation.isTerminal("A"), true);
  assert.equal(foundation.isTerminal("B"), true);
  assert.throws(() => foundation.markChanged("A", 2), (error) => error.code === "NOTE_DELETING");
  await assert.rejects(foundation.enqueueSave(request("A", 3, "late")), (error) => error.code === "NOTE_DELETING");
  assert.throws(() => foundation.beginAtomicBatch(["A"]), (error) => error.code === "NOTE_DELETING");

  gate.resolve();
  await deleting;
  assert.equal(foundation.getState("A"), null);
  assert.equal(foundation.getState("B"), null);
  assert.equal(foundation.registerNote("A", 9), null);
  assert.doesNotThrow(() => foundation.forgetNote("A"));
  await assert.rejects(foundation.enqueueSave(request("B", 4, "resurrect")), (error) => error.code === "NOTE_PERMANENTLY_DELETED");
});

test("別ウィンドウの完全削除通知は開始・中止・完了をdeletionId単位で反映する", async () => {
  const foundation = createNoteSaveFoundation({ writeSnapshot: async () => {} });
  foundation.registerNote("A", 1);
  foundation.beginExternalTerminalDelete(["A"], { deletionId: "delete-1", deletedAt: "2026-08-23T00:00:00.000Z" });
  assert.throws(() => foundation.markChanged("A", 1), (error) => error.code === "NOTE_DELETING");
  foundation.abortExternalTerminalDelete(["A"], "older-delete");
  assert.equal(foundation.isTerminal("A"), true);
  foundation.abortExternalTerminalDelete(["A"], "delete-1");
  assert.equal(foundation.isTerminal("A"), false);
  foundation.beginExternalTerminalDelete(["A"], { deletionId: "delete-2" });
  foundation.finishPermanentDeletion(["A"], { deletionId: "delete-2", deletedAt: "2026-08-23T00:00:01.000Z" });
  await assert.rejects(foundation.enqueueSave(request("A", 2, "late")), (error) => {
    return error.code === "NOTE_PERMANENTLY_DELETED" && error.tombstone.deletionId === "delete-2";
  });
});

test("永久削除は開始済み保存を完了させてから削除し、開始後の保存は受け付けない", async () => {
  const saveGate = deferred();
  let deleteStarted = false;
  const foundation = createNoteSaveFoundation({ writeSnapshot: async () => saveGate.promise });
  foundation.registerNote("A", 0);
  const revision = foundation.markChanged("A", 0);
  const saving = foundation.enqueueSave(request("A", revision, "before delete"));
  await Promise.resolve();

  const deleting = foundation.runTerminalDelete(["A"], async () => { deleteStarted = true; });
  await Promise.resolve();
  assert.equal(deleteStarted, false);
  await assert.rejects(foundation.enqueueSave(request("A", revision + 1, "after delete start")), (error) => error.code === "NOTE_DELETING");

  saveGate.resolve();
  await saving;
  await deleting;
  assert.equal(deleteStarted, true);
  assert.equal(foundation.getState("A"), null);
});

test("永久削除失敗では終端状態を解除して編集・保存・再削除を再開できる", async () => {
  const deleteError = new Error("delete aborted");
  const writes = [];
  const foundation = createNoteSaveFoundation({ writeSnapshot: async (snapshot) => writes.push(snapshot) });
  foundation.registerNote("A", 0);
  await assert.rejects(foundation.runTerminalDelete(["A"], async () => { throw deleteError; }), (error) => error === deleteError);

  assert.equal(foundation.isTerminal("A"), false);
  const revision = foundation.markChanged("A", 0);
  await foundation.enqueueSave(request("A", revision, "after failure"));
  assert.equal(writes.at(-1).body, "after failure");
  await foundation.runTerminalDelete(["A"], async () => {});
  assert.equal(foundation.isTerminal("A"), true);
});
