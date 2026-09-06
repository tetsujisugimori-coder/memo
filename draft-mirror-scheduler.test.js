"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createDraftMirrorScheduler } = require("./draft-mirror-scheduler.js");

function createTimerHarness() {
  let sequence = 0;
  const records = new Map();
  return {
    setTimer(callback, delay) {
      sequence += 1;
      records.set(sequence, { callback, delay, cleared: false, ran: false });
      return sequence;
    },
    clearTimer(id) {
      const record = records.get(id);
      if (record) record.cleared = true;
    },
    runAllIncludingCleared() {
      while (true) {
        const record = [...records.values()].find((item) => !item.ran);
        if (!record) return;
        record.ran = true;
        record.callback();
      }
    },
    delays: () => [...records.values()].map((record) => record.delay)
  };
}

function createHarness({ failWrites = false } = {}) {
  const timers = createTimerHarness();
  const notes = new Map([
    ["A", { id: "A", title: "A", body: "A0", revision: 0 }],
    ["B", { id: "B", title: "B", body: "B0", revision: 0 }]
  ]);
  const writes = [];
  const events = [];
  let remainingWriteFailures = failWrites === true ? Infinity : Math.max(0, Number(failWrites) || 0);
  const storage = {
    setItem(key, value) {
      if (remainingWriteFailures > 0) {
        if (Number.isFinite(remainingWriteFailures)) remainingWriteFailures -= 1;
        throw new Error("quota exceeded");
      }
      writes.push({ key, value, draft: JSON.parse(value) });
    }
  };
  let currentNoteId = "A";
  let editorDraft = { title: "A", body: "A0" };
  let saveReservations = 0;
  let dirtyUpdates = 0;

  function writeLatestDraft(noteId) {
    if (currentNoteId !== noteId) return false;
    const note = notes.get(noteId);
    if (!note) return false;
    try {
      storage.setItem("memo-nexus-current-draft", JSON.stringify({
        id: note.id,
        title: note.title,
        body: note.body,
        draftSavedAt: 1000 + note.revision
      }));
      events.push(`write:${note.id}:${note.revision}`);
      return true;
    } catch (_error) {
      return false;
    }
  }

  const scheduler = createDraftMirrorScheduler({
    delay: 200,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    getCurrentNoteId: () => currentNoteId,
    onFlush: writeLatestDraft
  });

  function applyEditorDraft() {
    const note = notes.get(currentNoteId);
    if (!note || (note.title === editorDraft.title && note.body === editorDraft.body)) return false;
    note.title = editorDraft.title;
    note.body = editorDraft.body;
    note.revision += 1;
    dirtyUpdates += 1;
    return true;
  }

  function input(title, body) {
    const note = notes.get(currentNoteId);
    editorDraft = { title, body };
    applyEditorDraft();
    saveReservations += 1;
    scheduler.schedule(note.id, note.revision);
    return note.revision;
  }

  return {
    events, notes, scheduler, timers, writes,
    editDom(title, body) { editorDraft = { title, body }; },
    input,
    currentNoteId: () => currentNoteId,
    state: () => ({ dirtyUpdates, saveReservations }),
    flushCurrent() {
      const note = notes.get(currentNoteId);
      return scheduler.flush(note.id, note.revision);
    },
    forceCurrent() {
      const note = notes.get(currentNoteId);
      return scheduler.forceFlush(note.id, note.revision);
    },
    lifecycleFlush() {
      applyEditorDraft();
      const note = notes.get(currentNoteId);
      return scheduler.forceFlush(note.id, note.revision);
    },
    switchTo(noteId) {
      const previous = notes.get(currentNoteId);
      const hadPending = scheduler.pendingNoteId() === previous.id;
      const draftChanged = applyEditorDraft();
      if (hadPending) scheduler.flush(previous.id, previous.revision);
      else if (draftChanged) scheduler.forceFlush(previous.id, previous.revision);
      events.push(`switch:${noteId}`);
      currentNoteId = noteId;
      const next = notes.get(noteId);
      editorDraft = { title: next.title, body: next.body };
    },
    setCurrent(noteId) {
      currentNoteId = noteId;
      const note = notes.get(noteId);
      editorDraft = { title: note.title, body: note.body };
    }
  };
}

test("continuous input writes one latest draft instead of one write per input", () => {
  const harness = createHarness();
  harness.input("A1", "body 1");
  harness.input("A2", "body 12");
  harness.input("A final", "body 123");

  assert.equal(harness.writes.length, 0);
  assert.deepEqual(harness.timers.delays(), [200, 200, 200]);
  harness.timers.runAllIncludingCleared();

  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.writes[0].draft, {
    id: "A", title: "A final", body: "body 123", draftSavedAt: 1003
  });
  assert.deepEqual(harness.state(), { dirtyUpdates: 3, saveReservations: 3 });
});

test("normal flush without a pending A request writes nothing", () => {
  const harness = createHarness();

  assert.equal(harness.flushCurrent(), false);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.scheduler.pendingNoteId(), null);
});

test("switching from unedited A to B writes no draft mirror", () => {
  const harness = createHarness();
  harness.switchTo("B");

  assert.equal(harness.writes.length, 0);
  assert.deepEqual(harness.events, ["switch:B"]);
});

test("switching notes flushes pending A once before B becomes current", () => {
  const harness = createHarness();
  harness.input("A edited", "A latest");
  harness.switchTo("B");
  harness.timers.runAllIncludingCleared();

  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].draft.id, "A");
  assert.equal(harness.writes[0].draft.body, "A latest");
  assert.deepEqual(harness.events, ["write:A:1", "switch:B"]);
});

test("switching flushes an unscheduled DOM change with the latest content", () => {
  const harness = createHarness();
  harness.editDom("A DOM", "unscheduled latest body");
  harness.switchTo("B");

  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].draft.body, "unscheduled latest body");
  assert.deepEqual(harness.events, ["write:A:1", "switch:B"]);
});

test("visibility hidden force-flushes the latest DOM without a pending request", () => {
  const harness = createHarness();
  harness.editDom("A lifecycle", "visibilitychange(hidden)");

  assert.equal(harness.lifecycleFlush(), true);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].draft.body, "visibilitychange(hidden)");
});

test("visibility hidden followed by pagehide does not double-write the same revision", () => {
  const harness = createHarness();
  harness.editDom("A lifecycle", "hidden then pagehide");

  assert.equal(harness.lifecycleFlush(), true);
  assert.equal(harness.lifecycleFlush(), false);
  assert.equal(harness.writes.length, 1);
});

test("stale A callback cannot write B or clear B's request", () => {
  const harness = createHarness();
  harness.input("A stale", "A stale body");
  harness.setCurrent("B");
  harness.input("B latest", "B latest body");
  assert.equal(harness.scheduler.pendingNoteId(), "B");

  harness.timers.runAllIncludingCleared();

  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].draft.id, "B");
  assert.equal(harness.writes[0].draft.body, "B latest body");
});

test("additional input during a normal save keeps the final draft revision", () => {
  const harness = createHarness();
  harness.input("A saving", "request revision 1");
  harness.input("A saving", "input during save revision 2");
  harness.timers.runAllIncludingCleared();

  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].draft.body, "input during save revision 2");
  assert.deepEqual(harness.state(), { dirtyUpdates: 2, saveReservations: 2 });
});

test("IME-like intermediate inputs preserve immediate state and mirror the confirmed value", () => {
  const harness = createHarness();
  harness.input("日本語", "へんかん");
  harness.input("日本語", "変換途中");
  harness.input("日本語確定", "変換確定");

  assert.deepEqual(harness.state(), { dirtyUpdates: 3, saveReservations: 3 });
  harness.timers.runAllIncludingCleared();
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].draft.title, "日本語確定");
  assert.equal(harness.writes[0].draft.body, "変換確定");
});

test("localStorage failure does not throw or alter input and normal-save state", () => {
  const harness = createHarness({ failWrites: true });
  harness.input("A failure", "still editable");

  assert.doesNotThrow(() => harness.timers.runAllIncludingCleared());
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.notes.get("A").body, "still editable");
  assert.deepEqual(harness.state(), { dirtyUpdates: 1, saveReservations: 1 });
});

test("flush cancels its old callback so executing the stale callback does not write again", () => {
  const harness = createHarness();
  harness.input("A once", "single write");
  assert.equal(harness.flushCurrent(), true);
  harness.timers.runAllIncludingCleared();

  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].draft.body, "single write");
});

test("normal or forced A flush while B is pending neither writes A nor cancels B", () => {
  const harness = createHarness();
  harness.setCurrent("B");
  const revision = harness.input("B pending", "keep B timer");

  assert.equal(harness.scheduler.flush("A", 1), false);
  assert.equal(harness.scheduler.forceFlush("A", 1), false);
  assert.equal(harness.scheduler.pendingNoteId(), "B");
  assert.equal(harness.scheduler.pendingRevision(), revision);
  harness.timers.runAllIncludingCleared();
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].draft.id, "B");
});

test("failed force flush can retry the same revision later", () => {
  const harness = createHarness({ failWrites: 1 });
  harness.input("A retry", "retry same revision");

  assert.equal(harness.forceCurrent(), false);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.forceCurrent(), true);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].draft.body, "retry same revision");
});

test("app wiring fixes noteId and flushes switch and lifecycle paths without direct input writes", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const html = fs.readFileSync("index.html", "utf8");
  const schedule = app.slice(app.indexOf("function scheduleSave"), app.indexOf("function renderTypingDerivedUi"));
  const openNote = app.slice(app.indexOf("function openNote"), app.indexOf("async function initPopout"));
  const mirror = app.slice(app.indexOf("function saveCurrentDraftMirror"), app.indexOf("async function restoreCurrentDraftMirror"));
  const lifecycle = app.slice(app.indexOf('window.addEventListener("pagehide"'), app.indexOf('document.addEventListener("selectionchange"'));
  const pagehide = lifecycle.slice(0, lifecycle.indexOf('document.addEventListener("visibilitychange"'));
  const visibility = lifecycle.slice(lifecycle.indexOf('document.addEventListener("visibilitychange"'));

  assert.match(app, /const DRAFT_MIRROR_DEBOUNCE_MS = 200;/);
  assert.match(app, /createDraftMirrorScheduler\([\s\S]*?getCurrentNoteId: \(\) => currentId[\s\S]*?onFlush: saveCurrentDraftMirror/);
  assert.match(schedule, /scheduleDraftMirror\(note\)/);
  assert.doesNotMatch(schedule, /saveCurrentDraftMirror\(/);
  assert.match(openNote, /hasPendingDraftMirror[\s\S]*?draftChanged = applyCurrentEditorDraft\(currentNote\(\)\)/);
  assert.match(openNote, /if \(hasPendingDraftMirror\) flushDraftMirror\(previousId\);\s*else if \(draftChanged\) forceFlushDraftMirror\(previousId\)/);
  assert.match(mirror, /noteId !== currentId/);
  assert.match(mirror, /note\.id !== noteId/);
  assert.match(mirror, /localStorage\.setItem\(DRAFT_STORAGE_KEY, JSON\.stringify\(draft\)\)/);
  assert.match(lifecycle, /pagehide[\s\S]*?applyCurrentEditorDraft\(currentNote\(\)\)[\s\S]*?forceFlushDraftMirror\(\)/);
  assert.match(lifecycle, /visibilitychange[\s\S]*?visibilityState === "hidden"[\s\S]*?applyCurrentEditorDraft\(currentNote\(\)\)[\s\S]*?forceFlushDraftMirror\(\)/);
  assert.ok(pagehide.indexOf("forceFlushDraftMirror()") < pagehide.indexOf("if (saveTimer)"));
  assert.ok(visibility.indexOf("forceFlushDraftMirror()") < visibility.indexOf("if (saveTimer)"));
  assert.match(app, /function handleDatabaseVersionChange\(\)[\s\S]*?applyCurrentEditorDraft\(currentNote\(\)\)[\s\S]*?forceFlushDraftMirror\(\)[\s\S]*?dbConnectionClosedForUpgrade = true/);
  assert.ok(html.indexOf('draft-mirror-scheduler.js?v=0.5.0-2') < html.indexOf('app.js?v=0.5.0-142'));
});
