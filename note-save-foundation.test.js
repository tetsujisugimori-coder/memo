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

function request(noteId, revision, body) {
  return createSaveRequest({
    noteId,
    revision,
    snapshot: { id: noteId, title: noteId, body, revision },
    saveRequestId: `${noteId}-${revision}`
  });
}

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
