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
  const storage = {
    setItem(key, value) {
      if (failWrites) throw new Error("quota exceeded");
      writes.push({ key, value, draft: JSON.parse(value) });
    }
  };
  let currentNoteId = "A";
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

  function input(title, body) {
    const note = notes.get(currentNoteId);
    note.title = title;
    note.body = body;
    note.revision += 1;
    dirtyUpdates += 1;
    saveReservations += 1;
    scheduler.schedule(note.id, note.revision);
    return note.revision;
  }

  return {
    notes, scheduler, timers, writes,
    input,
    currentNoteId: () => currentNoteId,
    state: () => ({ dirtyUpdates, saveReservations }),
    flushCurrent() {
      const note = notes.get(currentNoteId);
      return scheduler.flush(note.id, note.revision);
    },
    switchTo(noteId) {
      const previous = notes.get(currentNoteId);
      scheduler.flush(previous.id, previous.revision);
      currentNoteId = noteId;
    },
    setCurrent(noteId) { currentNoteId = noteId; }
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

test("switching notes flushes A before B becomes current", () => {
  const harness = createHarness();
  harness.input("A edited", "A latest");
  harness.switchTo("B");
  harness.timers.runAllIncludingCleared();

  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].draft.id, "A");
  assert.equal(harness.writes[0].draft.body, "A latest");
});

test("visibility hidden and pagehide flush pending drafts synchronously", () => {
  for (const lifecycle of ["visibilitychange(hidden)", "pagehide"]) {
    const harness = createHarness();
    harness.input("A lifecycle", lifecycle);
    assert.equal(harness.flushCurrent(), true, lifecycle);
    assert.equal(harness.writes.length, 1, lifecycle);
    assert.equal(harness.writes[0].draft.body, lifecycle, lifecycle);
  }
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

test("flush cancels its old callback and repeated lifecycle flush does not double-write", () => {
  const harness = createHarness();
  harness.input("A once", "single write");
  assert.equal(harness.flushCurrent(), true);
  assert.equal(harness.flushCurrent(), false);
  harness.timers.runAllIncludingCleared();

  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].draft.body, "single write");
});

test("flushing A after B is pending neither writes A nor cancels B", () => {
  const harness = createHarness();
  harness.setCurrent("B");
  const revision = harness.input("B pending", "keep B timer");

  assert.equal(harness.scheduler.flush("A", 1), false);
  assert.equal(harness.scheduler.pendingNoteId(), "B");
  assert.equal(harness.scheduler.pendingRevision(), revision);
  harness.timers.runAllIncludingCleared();
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].draft.id, "B");
});

test("app wiring fixes noteId and flushes switch and lifecycle paths without direct input writes", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const html = fs.readFileSync("index.html", "utf8");
  const schedule = app.slice(app.indexOf("function scheduleSave"), app.indexOf("function renderTypingDerivedUi"));
  const openNote = app.slice(app.indexOf("function openNote"), app.indexOf("async function initPopout"));
  const mirror = app.slice(app.indexOf("function saveCurrentDraftMirror"), app.indexOf("async function restoreCurrentDraftMirror"));
  const lifecycle = app.slice(app.indexOf('window.addEventListener("pagehide"'), app.indexOf('document.addEventListener("selectionchange"'));

  assert.match(app, /const DRAFT_MIRROR_DEBOUNCE_MS = 200;/);
  assert.match(app, /createDraftMirrorScheduler\([\s\S]*?getCurrentNoteId: \(\) => currentId[\s\S]*?onFlush: saveCurrentDraftMirror/);
  assert.match(schedule, /scheduleDraftMirror\(note\)/);
  assert.doesNotMatch(schedule, /saveCurrentDraftMirror\(/);
  assert.match(openNote, /applyCurrentEditorDraft\(currentNote\(\)\);\s*flushDraftMirror\(previousId\);[\s\S]*?currentId = note\.id/);
  assert.match(mirror, /noteId !== currentId/);
  assert.match(mirror, /note\.id !== noteId/);
  assert.match(mirror, /localStorage\.setItem\(DRAFT_STORAGE_KEY, JSON\.stringify\(draft\)\)/);
  assert.match(lifecycle, /pagehide[\s\S]*?flushDraftMirror\(\)/);
  assert.match(lifecycle, /visibilitychange[\s\S]*?visibilityState === "hidden"[\s\S]*?flushDraftMirror\(\)/);
  assert.match(app, /function handleDatabaseVersionChange\(\)[\s\S]*?flushDraftMirror\(\)[\s\S]*?dbConnectionClosedForUpgrade = true/);
  assert.ok(html.indexOf('draft-mirror-scheduler.js?v=0.5.0-1') < html.indexOf('app.js?v=0.5.0-111'));
});
