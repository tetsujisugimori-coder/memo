"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createTypingDerivedUiScheduler } = require("./typing-derived-ui-scheduler.js");

function createTimerHarness() {
  let sequence = 0;
  const records = new Map();
  return {
    setTimer(callback) {
      sequence += 1;
      records.set(sequence, { callback, cleared: false, ran: false });
      return sequence;
    },
    clearTimer(id) {
      const record = records.get(id);
      if (record) record.cleared = true;
    },
    runAllIncludingCleared() {
      while (true) {
        const next = [...records.values()].find((record) => !record.ran);
        if (!next) return;
        next.ran = true;
        next.callback();
      }
    },
    clearedCount() {
      return [...records.values()].filter((record) => record.cleared).length;
    }
  };
}

function createUiHarness() {
  const timers = createTimerHarness();
  const notes = new Map([
    ["A", { body: "A0", revision: 0 }],
    ["B", { body: "B0", revision: 0 }]
  ]);
  const renders = [];
  const counts = {
    ai: 0, card: 0, dirty: 0, discovery: 0, draftMirror: 0, list: 0,
    memory: 0, meta: 0, related: 0, saveState: 0, saveTimer: 0,
    stats: 0, table: 0, undo: 0
  };
  let currentNoteId = "A";
  const ui = { ai: "A0", card: "A0", editor: "A0", list: "A0", table: "A0" };

  function renderRequest(noteId, revision, type = "full") {
    const note = notes.get(noteId);
    if (!note || note.revision !== revision) return false;
    const targets = type === "auxiliary"
      ? ["ai", "list"]
      : ["ai", "card", "list", "table"];
    targets.forEach((key) => {
      ui[key] = note.body;
      counts[key] += 1;
    });
    counts.related += 1;
    counts.stats += 1;
    renders.push({ noteId, revision, type, body: note.body });
    return true;
  }

  const scheduler = createTypingDerivedUiScheduler({
    delay: 180,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    getCurrentNoteId: () => currentNoteId,
    onFlush: renderRequest
  });

  function recordInput(value) {
    const note = notes.get(currentNoteId);
    note.body = value;
    note.revision += 1;
    ui.editor = value;
    counts.memory += 1;
    counts.dirty += 1;
    counts.draftMirror += 1;
    counts.saveState += 1;
    counts.saveTimer += 1;
    counts.undo += 1;
    return note;
  }

  function syncCurrentUi() {
    const note = notes.get(currentNoteId);
    ["ai", "card", "editor", "list", "table"].forEach((key) => { ui[key] = note.body; });
    scheduler.markRendered(currentNoteId, note.revision);
  }

  return {
    counts, notes, renders, scheduler, timers, ui,
    input(value) {
      const note = recordInput(value);
      scheduler.schedule(currentNoteId, note.revision);
      return note.revision;
    },
    beginComposition() { scheduler.beginComposition(currentNoteId); },
    endComposition() { scheduler.endComposition(currentNoteId); },
    changeLocalSaveTarget() {},
    moveToTrash(noteId) {
      scheduler.cancelNote(noteId);
      if (noteId === currentNoteId) {
        currentNoteId = "B";
        syncCurrentUi();
      }
    },
    permanentlyDelete(noteId) {
      scheduler.cancelNote(noteId);
      if (noteId === currentNoteId) {
        currentNoteId = "B";
        syncCurrentUi();
      }
    },
    switchTo(noteId) {
      scheduler.cancelNote(currentNoteId);
      currentNoteId = noteId;
      syncCurrentUi();
    },
    structuredEdit(value) {
      const note = recordInput(value);
      ui.card = value;
      ui.table = value;
      counts.card += 1;
      counts.table += 1;
      scheduler.scheduleAuxiliary(currentNoteId, note.revision);
      return note.revision;
    },
    saveSuccess(noteId, revision) {
      counts.saveState += 1;
      counts.meta += 1;
      counts.discovery += 1;
      const requiredType = scheduler.requiredDerivedUiAfterSave(noteId, revision);
      if (requiredType && renderRequest(noteId, revision, requiredType)) {
        scheduler.markRendered(noteId, revision, requiredType);
      }
    }
  };
}

test("continuous typing aggregates every derived UI into the final revision", () => {
  const harness = createUiHarness();
  harness.input("A1");
  harness.input("A12");
  const revision = harness.input("A123");
  assert.equal(harness.renders.length, 0);
  assert.equal(harness.timers.clearedCount(), 2);
  harness.timers.runAllIncludingCleared();
  assert.deepEqual(harness.renders, [{ noteId: "A", revision, type: "full", body: "A123" }]);
  assert.deepEqual(harness.ui, { ai: "A123", card: "A123", editor: "A123", list: "A123", table: "A123" });
});

test("moving unrelated B to trash preserves A's card, table, and AI request", () => {
  const harness = createUiHarness();
  harness.input("A after trash");
  harness.moveToTrash("B");
  harness.timers.runAllIncludingCleared();
  assert.equal(harness.renders.length, 1);
  assert.equal(harness.ui.card, "A after trash");
  assert.equal(harness.ui.table, "A after trash");
  assert.equal(harness.ui.ai, "A after trash");
});

test("permanently deleting unrelated B preserves A's pending request", () => {
  const harness = createUiHarness();
  harness.input("A after permanent delete");
  harness.permanentlyDelete("B");
  harness.timers.runAllIncludingCleared();
  assert.deepEqual(harness.renders.map(({ body }) => body), ["A after permanent delete"]);
});

test("changing the local save target does not cancel the current note request", () => {
  const harness = createUiHarness();
  harness.input("A after folder change");
  harness.changeLocalSaveTarget();
  harness.timers.runAllIncludingCleared();
  assert.equal(harness.ui.card, "A after folder change");
});

test("deleting or permanently deleting current A rejects its queued callback", () => {
  for (const operation of ["moveToTrash", "permanentlyDelete"]) {
    const harness = createUiHarness();
    harness.input(`A stale ${operation}`);
    harness[operation]("A");
    harness.timers.runAllIncludingCleared();
    assert.equal(harness.renders.length, 0);
    assert.deepEqual(harness.ui, { ai: "B0", card: "B0", editor: "B0", list: "B0", table: "B0" });
  }
});

test("switching from edited A to B rejects A's queued callback", () => {
  const harness = createUiHarness();
  harness.input("A stale after switch");
  harness.switchTo("B");
  harness.timers.runAllIncludingCleared();
  assert.equal(harness.renders.length, 0);
  assert.equal(harness.ui.card, "B0");
});

test("composition input stays pending after 180ms without rebuilding derived UI", () => {
  const harness = createUiHarness();
  harness.beginComposition();
  harness.input("変換途中");
  harness.timers.runAllIncludingCleared();
  assert.equal(harness.renders.length, 0);
  assert.equal(harness.scheduler.pendingNoteId(), "A");
});

test("composition end flushes the confirmed final body exactly once", () => {
  const harness = createUiHarness();
  harness.beginComposition();
  harness.input("変換途中");
  const revision = harness.input("変換確定");
  harness.endComposition();
  harness.timers.runAllIncludingCleared();
  assert.deepEqual(harness.renders, [{ noteId: "A", revision, type: "full", body: "変換確定" }]);
});

test("compositionend and final input order differences still produce one trailing flush", () => {
  const inputBeforeEnd = createUiHarness();
  inputBeforeEnd.beginComposition();
  inputBeforeEnd.input("途中");
  inputBeforeEnd.input("確定A");
  inputBeforeEnd.endComposition();
  inputBeforeEnd.timers.runAllIncludingCleared();

  const inputAfterEnd = createUiHarness();
  inputAfterEnd.beginComposition();
  inputAfterEnd.input("途中");
  inputAfterEnd.endComposition();
  inputAfterEnd.input("確定B");
  inputAfterEnd.timers.runAllIncludingCleared();

  assert.deepEqual(inputBeforeEnd.renders.map(({ body }) => body), ["確定A"]);
  assert.deepEqual(inputAfterEnd.renders.map(({ body }) => body), ["確定B"]);
});

test("IME input still updates memory, revision, dirty, mirror, save state, undo, and the 280ms reservation", () => {
  const harness = createUiHarness();
  harness.beginComposition();
  const revision = harness.input("保存契約を維持");
  harness.timers.runAllIncludingCleared();
  assert.equal(revision, 1);
  assert.equal(harness.notes.get("A").body, "保存契約を維持");
  ["memory", "dirty", "draftMirror", "saveState", "saveTimer", "undo"].forEach((key) => assert.equal(harness.counts[key], 1, key));
  assert.equal(harness.renders.length, 0);
});

test("save success does not redraw heavy UI for an already rendered noteId and revision", () => {
  const harness = createUiHarness();
  const revision = harness.input("once");
  harness.timers.runAllIncludingCleared();
  const before = structuredClone(harness.counts);
  harness.saveSuccess("A", revision);
  ["ai", "card", "list", "related", "stats", "table"].forEach((key) => assert.equal(harness.counts[key], before[key], key));
});

test("save success still updates save state, metadata, and discovery", () => {
  const harness = createUiHarness();
  const revision = harness.input("essential save UI");
  harness.timers.runAllIncludingCleared();
  harness.saveSuccess("A", revision);
  assert.equal(harness.counts.saveState, 2);
  assert.equal(harness.counts.meta, 1);
  assert.equal(harness.counts.discovery, 1);
});

test("an old save success cannot cancel a newer revision's pending request", () => {
  const harness = createUiHarness();
  const oldRevision = harness.input("revision 1");
  harness.timers.runAllIncludingCleared();
  harness.input("revision 2");
  harness.saveSuccess("A", oldRevision);
  assert.equal(harness.scheduler.pendingNoteId(), "A");
  harness.timers.runAllIncludingCleared();
  assert.deepEqual(harness.renders.map(({ body }) => body), ["revision 1", "revision 2"]);
});

test("a pending older revision cannot hide a newer atomic save render", () => {
  const harness = createUiHarness();
  harness.input("pending revision 1");
  harness.notes.get("A").revision = 2;
  assert.equal(harness.scheduler.needsDerivedUiAfterSave("A", 2), true);
});

test("a rendered newer revision already covers an older save success", () => {
  const harness = createUiHarness();
  harness.scheduler.markRendered("A", 2);
  assert.equal(harness.scheduler.needsDerivedUiAfterSave("A", 1), false);
});

test("render:false replaces an older full request and debounces auxiliary UI only", () => {
  const harness = createUiHarness();
  harness.input("normal input");
  harness.structuredEdit("structured final");
  assert.equal(harness.renders.length, 0);
  assert.equal(harness.counts.list, 0);
  assert.equal(harness.counts.related, 0);
  harness.timers.runAllIncludingCleared();
  assert.deepEqual(harness.renders.map(({ type, body }) => ({ type, body })), [
    { type: "auxiliary", body: "structured final" }
  ]);
  assert.equal(harness.counts.card, 1);
  assert.equal(harness.counts.table, 1);
  assert.equal(harness.counts.list, 1);
  assert.equal(harness.counts.related, 1);
  assert.equal(harness.counts.stats, 1);
  assert.equal(harness.ui.card, "structured final");
  assert.equal(harness.ui.table, "structured final");
});

test("three consecutive table-cell inputs flush auxiliary UI once at the final revision", () => {
  const harness = createUiHarness();
  harness.structuredEdit("A1");
  harness.structuredEdit("A12");
  const revision = harness.structuredEdit("A123");

  ["list", "related", "stats", "ai"].forEach((key) => assert.equal(harness.counts[key], 0, key));
  harness.timers.runAllIncludingCleared();

  assert.deepEqual(harness.renders, [
    { noteId: "A", revision, type: "auxiliary", body: "A123" }
  ]);
  ["list", "related", "stats", "ai"].forEach((key) => assert.equal(harness.counts[key], 1, key));
});

test("every table-cell input preserves revision, dirty, draft mirror, save state, undo, and save reservation", () => {
  const harness = createUiHarness();
  harness.structuredEdit("A1");
  harness.structuredEdit("A12");
  const revision = harness.structuredEdit("A123");

  assert.equal(revision, 3);
  assert.equal(harness.notes.get("A").body, "A123");
  ["memory", "dirty", "draftMirror", "saveState", "saveTimer", "undo"].forEach((key) => {
    assert.equal(harness.counts[key], 3, key);
  });
});

test("a full request after a table edit replaces the auxiliary callback", () => {
  const harness = createUiHarness();
  harness.structuredEdit("table revision");
  const revision = harness.input("body revision");
  harness.timers.runAllIncludingCleared();

  assert.deepEqual(harness.renders, [
    { noteId: "A", revision, type: "full", body: "body revision" }
  ]);
});

test("switching immediately after a table edit rejects the old note auxiliary callback", () => {
  const harness = createUiHarness();
  harness.structuredEdit("A stale table");
  harness.switchTo("B");
  harness.timers.runAllIncludingCleared();

  assert.equal(harness.renders.length, 0);
  assert.deepEqual(harness.ui, { ai: "B0", card: "B0", editor: "B0", list: "B0", table: "B0" });
});

test("deleting unrelated B preserves A's auxiliary request", () => {
  const harness = createUiHarness();
  const revision = harness.structuredEdit("A table after delete");
  harness.moveToTrash("B");
  harness.timers.runAllIncludingCleared();

  assert.deepEqual(harness.renders, [
    { noteId: "A", revision, type: "auxiliary", body: "A table after delete" }
  ]);
});

test("table-cell IME holds auxiliary UI until the confirmed value", () => {
  const harness = createUiHarness();
  harness.beginComposition();
  harness.structuredEdit("表変換途中");
  const revision = harness.structuredEdit("表変換確定");
  harness.timers.runAllIncludingCleared();
  assert.equal(harness.renders.length, 0);

  harness.endComposition();
  harness.timers.runAllIncludingCleared();
  assert.deepEqual(harness.renders, [
    { noteId: "A", revision, type: "auxiliary", body: "表変換確定" }
  ]);
});

test("table compositionend and final input order differences do not double-render", () => {
  const inputBeforeEnd = createUiHarness();
  inputBeforeEnd.beginComposition();
  inputBeforeEnd.structuredEdit("途中A");
  inputBeforeEnd.structuredEdit("確定A");
  inputBeforeEnd.endComposition();
  inputBeforeEnd.timers.runAllIncludingCleared();

  const inputAfterEnd = createUiHarness();
  inputAfterEnd.beginComposition();
  inputAfterEnd.structuredEdit("途中B");
  inputAfterEnd.endComposition();
  inputAfterEnd.structuredEdit("確定B");
  inputAfterEnd.timers.runAllIncludingCleared();

  assert.deepEqual(inputBeforeEnd.renders.map(({ body }) => body), ["確定A"]);
  assert.deepEqual(inputAfterEnd.renders.map(({ body }) => body), ["確定B"]);
});

test("an auxiliary timer does not redraw the synchronously updated card or table editor", () => {
  const harness = createUiHarness();
  harness.structuredEdit("synchronized table");
  const before = { card: harness.counts.card, table: harness.counts.table };
  harness.timers.runAllIncludingCleared();

  assert.equal(harness.counts.card, before.card);
  assert.equal(harness.counts.table, before.table);
});

test("primary-only coverage makes save success request the missing auxiliary UI", () => {
  const harness = createUiHarness();
  harness.scheduler.markRendered("A", 1, "primary");
  assert.equal(harness.scheduler.requiredDerivedUiAfterSave("A", 1), "auxiliary");
  assert.equal(harness.scheduler.needsDerivedUiAfterSave("A", 1), true);

  harness.scheduler.markRendered("A", 1, "auxiliary");
  assert.equal(harness.scheduler.requiredDerivedUiAfterSave("A", 1), null);
});

test("consecutive paste-like inputs still render only the final body", () => {
  const harness = createUiHarness();
  harness.input("first paste");
  harness.input("first paste\nsecond paste");
  harness.input("final pasted body");
  harness.timers.runAllIncludingCleared();
  assert.deepEqual(harness.renders.map(({ body }) => body), ["final pasted body"]);
});

test("app wiring uses typed requests, table IME holding, and dedicated save-success rendering", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const localTarget = app.slice(app.indexOf("async function setLocalSaveTarget"), app.indexOf("function createLocalSaveRequest"));
  const schedule = app.slice(app.indexOf("function scheduleSave"), app.indexOf("function captureUndoSnapshot"));
  const inputEvents = app.slice(app.indexOf('titleInput.addEventListener("beforeinput"'), app.indexOf('editor.addEventListener("select"'));
  const auxiliary = app.slice(app.indexOf("function renderTypingAuxiliaryUiAfterSynchronousPreview"), app.indexOf("function captureUndoSnapshot"));
  const currentSaveUi = app.slice(app.indexOf("function renderCurrentNoteSaveSuccessUi"), app.indexOf("function renderList"));

  assert.doesNotMatch(localTarget, /TypingDerivedUiScheduler/);
  assert.match(app, /function openNote\(id\)[\s\S]*?cancelNote\(previousId\)[\s\S]*?markRendered\(note\.id, note\.revision\)/);
  assert.match(app, /moveMemosToTrash[\s\S]*?targets\.forEach\(\(note\) => [^\n]*cancelNote\(note\.id\)\)/);
  assert.match(app, /permanentlyDeleteMemos[\s\S]*?targets\.forEach\(\(note\) => [^\n]*cancelNote\(note\.id\)\)/);
  assert.match(schedule, /schedule\(note\.id, note\.revision\)/);
  assert.match(schedule, /scheduleAuxiliary\(note\.id, note\.revision\)/);
  assert.doesNotMatch(auxiliary, /renderPreview|renderTableBlockEditors/);
  assert.match(inputEvents, /titleInput\.addEventListener\("compositionstart"[\s\S]*beginComposition/);
  assert.match(inputEvents, /titleInput\.addEventListener\("compositionend"[\s\S]*endComposition/);
  assert.match(inputEvents, /editor\.addEventListener\("compositionstart"[\s\S]*beginComposition/);
  assert.match(inputEvents, /editor\.addEventListener\("compositionend"[\s\S]*endComposition/);
  assert.match(app, /tableBlockEditors\.addEventListener\("compositionstart"[\s\S]*handleTableEditorCompositionStart/);
  assert.match(app, /tableBlockEditors\.addEventListener\("compositionend"[\s\S]*handleTableEditorCompositionEnd/);
  assert.match(app, /requiredDerivedUiAfterSave\(request\.noteId, request\.revision\)/);
  assert.doesNotMatch(currentSaveUi, /renderCollectionExplorer|renderTagPanel|renderMemoListPanel/);
});
