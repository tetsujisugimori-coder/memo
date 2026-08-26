"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createTypingDerivedUiScheduler } = require("./typing-derived-ui-scheduler.js");

function createTimerHarness() {
  let sequence = 0;
  const callbacks = new Map();
  const cleared = new Set();
  return {
    setTimer(callback) {
      sequence += 1;
      callbacks.set(sequence, callback);
      return sequence;
    },
    clearTimer(id) {
      cleared.add(id);
    },
    runAllIncludingCleared() {
      [...callbacks.values()].forEach((callback) => callback());
    },
    clearedCount() {
      return cleared.size;
    }
  };
}

function createUiHarness() {
  const timers = createTimerHarness();
  const bodies = new Map([["A", "A0"], ["B", "B0"]]);
  const renders = [];
  let currentNoteId = "A";
  const ui = { editor: "A0", list: "A0", card: "A0" };
  const scheduler = createTypingDerivedUiScheduler({
    delay: 180,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    getCurrentNoteId: () => currentNoteId,
    onFlush(noteId) {
      const body = bodies.get(noteId);
      ui.list = body;
      ui.card = body;
      renders.push({ noteId, body });
    }
  });

  return {
    bodies,
    renders,
    scheduler,
    timers,
    ui,
    input(value) {
      ui.editor = value;
      bodies.set(currentNoteId, value);
      scheduler.schedule(currentNoteId);
    },
    switchTo(noteId) {
      scheduler.invalidate();
      currentNoteId = noteId;
      ui.editor = bodies.get(noteId);
      ui.list = bodies.get(noteId);
      ui.card = bodies.get(noteId);
    }
  };
}

test("continuous typing aggregates derived UI updates into the final request", () => {
  const harness = createUiHarness();
  harness.input("A1");
  harness.input("A12");
  harness.input("A123");

  assert.equal(harness.renders.length, 0);
  assert.equal(harness.timers.clearedCount(), 2);
  harness.timers.runAllIncludingCleared();

  assert.deepEqual(harness.renders, [{ noteId: "A", body: "A123" }]);
  assert.equal(harness.ui.list, "A123");
  assert.equal(harness.ui.card, "A123");
});

test("a stale note A callback cannot overwrite note B after an immediate switch", () => {
  const harness = createUiHarness();
  harness.input("A edited");
  harness.switchTo("B");

  harness.timers.runAllIncludingCleared();

  assert.deepEqual(harness.renders, []);
  assert.deepEqual(harness.ui, { editor: "B0", list: "B0", card: "B0" });
});

test("consecutive paste-like inputs render the final body in the list and card", () => {
  const harness = createUiHarness();
  harness.input("first paste");
  harness.input("first paste\nsecond paste");
  harness.input("final pasted body");

  harness.timers.runAllIncludingCleared();

  assert.equal(harness.renders.length, 1);
  assert.equal(harness.ui.list, "final pasted body");
  assert.equal(harness.ui.card, "final pasted body");
  assert.equal(harness.ui.editor, "final pasted body");
});

test("app input wiring keeps save scheduling immediate and moves heavy UI into the debounced flush", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const inputHandler = app.slice(
    app.indexOf('editor.addEventListener("input"'),
    app.indexOf('editor.addEventListener("select"')
  );
  const derivedUi = app.slice(
    app.indexOf("function renderTypingDerivedUi"),
    app.indexOf("function captureUndoSnapshot")
  );

  assert.match(inputHandler, /resetEditorCaretIdle\(\);[\s\S]*scheduleSave\(\);/);
  assert.doesNotMatch(inputHandler, /renderTableBlockEditors|renderPreview|renderRelated|renderTextStats|updateAiTargetPreview/);
  [
    "renderMemoListPanel",
    "renderPreview",
    "renderRelated",
    "renderTextStats",
    "renderTableBlockEditors",
    "updateAiTargetPreview"
  ].forEach((name) => assert.match(derivedUi, new RegExp(`${name}\\(\\)`)));
  assert.match(app, /function openNote\(id\)[\s\S]*?MemoNexusTypingDerivedUiScheduler\?\.invalidate\(\)/);
  assert.match(app, /async function setLocalSaveTarget\(handle\)[\s\S]*?localSaveTargetGeneration \+= 1;[\s\S]*?MemoNexusTypingDerivedUiScheduler\?\.invalidate\(\)/);
});
