const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  createTypingPerformanceMonitor,
  isTypingPerformanceEnabled,
  summarizeSamples
} = require("./typing-performance-monitor.js");

function timerHarness() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    setTimer(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearTimer(id) {
      callbacks.delete(id);
    },
    flush() {
      const queued = [...callbacks.values()];
      callbacks.clear();
      queued.forEach((callback) => callback());
    },
    size: () => callbacks.size
  };
}

function enabledMonitor(options = {}) {
  const timers = timerHarness();
  return {
    monitor: createTypingPerformanceMonitor({
      enabled: true,
      dateNow: () => 0,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      ...options
    }),
    timers
  };
}

function inputContext(overrides = {}) {
  return {
    noteKey: "private-note-a",
    revision: 1,
    inputKind: "body",
    inputType: "insertText",
    isComposing: false,
    ...overrides
  };
}

function completeInput(monitor, context = inputContext(), options = {}) {
  const token = monitor.consumeInput(context);
  monitor.completeInput(token, {
    durations: { applyCurrentEditorDraft: 2, scheduleDerivedUi: 1 },
    totalDuration: 5,
    renderType: "full",
    attributesFactory: () => ({ bodyLength: 120, titleLength: 8, memoCount: 12, isCurrentNote: true }),
    ...options
  });
  return token;
}

test("explicit debugTypingPerf=1 query is the only URL opt-in and browser API exposes sample operations", () => {
  assert.equal(typeof globalThis.MemoNexusTypingPerformance?.getSamples, "function");
  assert.equal(typeof globalThis.MemoNexusTypingPerformance?.getEvents, "function");
  assert.equal(globalThis.MemoNexusTypingPerformance.isEnabled(), false);
  assert.equal(isTypingPerformanceEnabled("?debugTypingPerf=1"), true);
  assert.equal(isTypingPerformanceEnabled("?view=compact&debugTypingPerf=1"), true);
  assert.equal(isTypingPerformanceEnabled("?debugTypingPerf=0"), false);
  assert.equal(isTypingPerformanceEnabled("?debugTypingPerf=true"), false);
  assert.equal(isTypingPerformanceEnabled(""), false);
});

test("disabled monitor does not read clocks, create timers, or evaluate attributes", () => {
  let clockReads = 0;
  let timerCreates = 0;
  let attributeReads = 0;
  const monitor = createTypingPerformanceMonitor({
    enabled: false,
    performance: { now() { clockReads += 1; return 10; } },
    setTimer() { timerCreates += 1; return 1; }
  });
  const token = monitor.beginInput(inputContext());
  monitor.addInputDuration(token, "captureUndoSnapshot", 1);
  monitor.consumeInput(inputContext());
  monitor.completeInput(token, { attributesFactory() { attributeReads += 1; return {}; } });
  monitor.recordDerivedSample({ attributesFactory() { attributeReads += 1; return {}; } });
  monitor.elapsed(monitor.start());
  assert.equal(clockReads, 0);
  assert.equal(timerCreates, 0);
  assert.equal(attributeReads, 0);
  assert.deepEqual(monitor.getSamples(), []);
  assert.deepEqual(monitor.getSummary(), {});
});

test("one body beforeinput and input pair records one sync sample", () => {
  const { monitor } = enabledMonitor();
  const context = inputContext();
  const token = monitor.beginInput(context);
  monitor.addInputDuration(token, "captureUndoSnapshot", 1.5);
  const consumed = monitor.consumeInput(context);
  assert.equal(consumed, token);
  monitor.completeInput(consumed, {
    durations: {
      applyCurrentEditorDraft: 2,
      scheduleDraftMirror: 0.5,
      scheduleSaveTimer: 0.25,
      scheduleDerivedUi: 0.75,
      updateUndoButton: 0.1
    },
    totalDuration: 4,
    renderType: "full",
    attributesFactory: () => ({ bodyLength: 20, titleLength: 3, memoCount: 4, isCurrentNote: true })
  });
  const samples = monitor.getSamples();
  assert.equal(samples.length, 1);
  assert.equal(samples[0].sampleType, "input");
  assert.equal(samples[0].inputKind, "body");
  assert.equal(samples[0].durations.captureUndoSnapshot, 1.5);
  assert.equal(samples[0].durations.applyCurrentEditorDraft, 2);
  assert.equal(samples[0].totalDuration, 4);
});

test("title input and table input each consume only one sample slot", () => {
  const { monitor } = enabledMonitor();
  completeInput(monitor, inputContext({ inputKind: "title" }), { renderType: "full" });
  const tableContext = inputContext({ inputKind: "table", inputType: "insertCompositionText", isComposing: true });
  const tableToken = monitor.consumeInput(tableContext);
  monitor.addInputDuration(tableToken, "captureUndoSnapshot", 0.4);
  monitor.completeInput(tableToken, {
    durations: { applyCurrentEditorDraft: 1, scheduleDerivedUi: 0.2 },
    totalDuration: 3,
    renderType: "auxiliary",
    attributesFactory: () => ({ bodyLength: 50, titleLength: 4, memoCount: 2, isCurrentNote: true })
  });
  const samples = monitor.getSamples();
  assert.equal(samples.length, 2);
  assert.deepEqual(samples.map((sample) => sample.inputKind), ["title", "table"]);
  assert.equal(samples[1].isComposing, true);
  assert.equal(samples[1].renderType, "auxiliary");
});

test("one full derived flush records one sample with grouped durations", () => {
  const { monitor } = enabledMonitor();
  const context = inputContext();
  completeInput(monitor, context, { derived: { noteKey: context.noteKey, revision: 2 } });
  assert.equal(monitor.recordDerivedSample({
    noteKey: context.noteKey,
    revision: 2,
    renderType: "full",
    durations: {
      invalidateTermRelationIndex: 0.1,
      renderMemoListPanel: 2,
      renderPreview: 8,
      renderRelated: 3,
      renderTextStats: 1,
      renderTableBlockEditors: 4,
      updateAiTargetPreview: 0.5
    },
    totalDuration: 18.6,
    attributesFactory: () => ({ bodyLength: 100, memoCount: 10, isCurrentNote: true })
  }), true);
  const samples = monitor.getSamples();
  assert.equal(samples.length, 2);
  assert.equal(samples[1].sampleType, "derived");
  assert.equal(samples[1].renderType, "full");
  assert.equal(samples[1].durations.renderTableBlockEditors, 4);
});

test("auxiliary derived samples never expose a table editor duration", () => {
  const { monitor } = enabledMonitor();
  const context = inputContext({ inputKind: "table" });
  completeInput(monitor, context, {
    renderType: "auxiliary",
    derived: { noteKey: context.noteKey, revision: 2 }
  });
  monitor.recordDerivedSample({
    noteKey: context.noteKey,
    revision: 2,
    renderType: "auxiliary",
    durations: { renderPreview: 3, renderTableBlockEditors: 99 },
    totalDuration: 4,
    attributesFactory: () => ({ bodyLength: 5 })
  });
  assert.deepEqual(monitor.getSamples()[1].durations, { renderPreview: 3 });
});

test("ring buffer retains the newest samples rather than newest process events", () => {
  const { monitor } = enabledMonitor({ limit: 3 });
  for (let index = 1; index <= 5; index += 1) {
    completeInput(monitor, inputContext({ revision: index }), {
      totalDuration: index,
      attributesFactory: () => ({ bodyLength: index })
    });
  }
  assert.equal(monitor.getSamples().length, 3);
  assert.deepEqual(monitor.getSamples().map((sample) => sample.totalDuration), [3, 4, 5]);
});

test("summary aggregates every grouped duration with count, average, p50, p95, and max", () => {
  const samples = [1, 2, 3, 4, 100].map((duration) => ({
    sampleType: "derived",
    inputKind: "body",
    renderType: "full",
    durations: { renderPreview: duration },
    totalDuration: duration + 1
  }));
  const summary = summarizeSamples(samples);
  assert.deepEqual(summary["full.derived.renderPreview"], {
    count: 5,
    average: 22,
    p50: 3,
    p95: 100,
    max: 100
  });
  assert.deepEqual(summary["full.derived.total"], {
    count: 5,
    average: 23,
    p50: 4,
    p95: 101,
    max: 101
  });
});

test("sync summary keeps existing process names including render type", () => {
  const { monitor } = enabledMonitor();
  completeInput(monitor);
  const summary = monitor.getSummary();
  assert.equal(summary["body.sync.applyCurrentEditorDraft"].count, 1);
  assert.equal(summary["body.sync.scheduleDerivedUi.full"].count, 1);
  assert.equal(summary["body.input.total"].count, 1);
});

test("empty summary and repeated clear are safe", () => {
  const { monitor } = enabledMonitor();
  assert.deepEqual(monitor.getSummary(), {});
  monitor.clear();
  monitor.clear();
  assert.deepEqual(monitor.getSamples(), []);
  assert.deepEqual(monitor.getSummary(), {});
});

test("performance.now fallback is safe when unavailable or throwing", () => {
  const values = [100, 107];
  const monitor = createTypingPerformanceMonitor({
    enabled: true,
    performance: { now() { throw new Error("unavailable"); } },
    dateNow: () => values.shift(),
    setTimer: () => 1,
    clearTimer: () => {}
  });
  const startedAt = monitor.start();
  assert.equal(monitor.elapsed(startedAt), 7);
});

test("attributes are generated once per sample and do not affect supplied totalDuration", () => {
  const { monitor } = enabledMonitor();
  let attributeCalls = 0;
  completeInput(monitor, inputContext(), {
    totalDuration: 6.25,
    attributesFactory() {
      attributeCalls += 1;
      return { bodyLength: 10 };
    }
  });
  assert.equal(attributeCalls, 1);
  assert.equal(monitor.getSamples()[0].totalDuration, 6.25);
});

test("pending beforeinput expires if no input event follows", () => {
  const { monitor, timers } = enabledMonitor();
  const token = monitor.beginInput(inputContext());
  monitor.addInputDuration(token, "captureUndoSnapshot", 1);
  assert.equal(timers.size(), 1);
  timers.flush();
  assert.equal(monitor.completeInput(token, { attributesFactory: () => ({}) }), false);
  assert.deepEqual(monitor.getSamples(), []);
});

test("a newer beforeinput discards an older pending collector", () => {
  const { monitor } = enabledMonitor();
  const oldToken = monitor.beginInput(inputContext({ revision: 1 }));
  const nextToken = monitor.beginInput(inputContext({ revision: 2 }));
  assert.notEqual(oldToken, nextToken);
  assert.equal(monitor.completeInput(oldToken, {}), false);
  assert.equal(monitor.consumeInput(inputContext({ revision: 2 })), nextToken);
});

test("pending input is not reused across note, revision, kind, or IME state", () => {
  const mismatches = [
    { noteKey: "private-note-b" },
    { revision: 2 },
    { inputKind: "title" },
    { isComposing: true }
  ];
  mismatches.forEach((change) => {
    const { monitor } = enabledMonitor();
    const original = monitor.beginInput(inputContext());
    const consumed = monitor.consumeInput(inputContext(change));
    assert.notEqual(consumed, original);
    assert.equal(monitor.completeInput(original, {}), false);
  });
});

test("pending input is not reused across input types", () => {
  const { monitor } = enabledMonitor();
  const original = monitor.beginInput(inputContext({ inputType: "insertText" }));
  const consumed = monitor.consumeInput(inputContext({ inputType: "deleteContentBackward" }));
  assert.notEqual(consumed, original);
});

test("derived samples require the exact private note and revision context", () => {
  const cases = [
    { noteKey: "private-note-b", revision: 2 },
    { noteKey: "private-note-a", revision: 3 }
  ];
  cases.forEach((attempt) => {
    const { monitor } = enabledMonitor();
    const context = inputContext();
    completeInput(monitor, context, { derived: { noteKey: context.noteKey, revision: 2 } });
    let attributeCalls = 0;
    assert.equal(monitor.recordDerivedSample({
      ...attempt,
      renderType: "full",
      durations: { renderPreview: 1 },
      attributesFactory() { attributeCalls += 1; return {}; }
    }), false);
    assert.equal(attributeCalls, 0);
    assert.equal(monitor.getSamples().length, 1);
  });
});

test("discardNote clears matching pending input and derived context", () => {
  const { monitor } = enabledMonitor();
  const context = inputContext();
  const token = monitor.beginInput(context);
  assert.equal(monitor.discardNote(context.noteKey), true);
  assert.equal(monitor.completeInput(token, {}), false);

  completeInput(monitor, context, { derived: { noteKey: context.noteKey, revision: 2 } });
  assert.equal(monitor.discardNote(context.noteKey), true);
  assert.equal(monitor.recordDerivedSample({
    noteKey: context.noteKey,
    revision: 2,
    renderType: "full"
  }), false);
});

test("clear removes samples, pending input, and derived transient state", () => {
  const { monitor } = enabledMonitor();
  const pendingToken = monitor.beginInput(inputContext());
  monitor.clear();
  assert.equal(monitor.completeInput(pendingToken, {}), false);

  const context = inputContext();
  completeInput(monitor, context, { derived: { noteKey: context.noteKey, revision: 2 } });
  monitor.clear();
  assert.equal(monitor.recordDerivedSample({
    noteKey: context.noteKey,
    revision: 2,
    renderType: "full"
  }), false);
  assert.deepEqual(monitor.getSamples(), []);
});

test("recorded data excludes memo text, title text, tags, ids, and arbitrary strings", () => {
  const { monitor } = enabledMonitor();
  const context = inputContext({
    noteKey: "private-id",
    inputKind: "private body",
    inputType: "private title"
  });
  completeInput(monitor, context, {
    durations: {
      applyCurrentEditorDraft: 1,
      "private-duration": 999
    },
    attributesFactory: () => ({
      body: "private body",
      title: "private title",
      tagName: "private tag",
      noteId: "private-id",
      arbitrary: "private value",
      bodyLength: 12
    })
  });
  const serialized = JSON.stringify(monitor.getSamples());
  assert.doesNotMatch(serialized, /private|noteId|tagName|arbitrary/);
  assert.deepEqual(monitor.getSamples()[0].attributes, { bodyLength: 12 });
  assert.equal(monitor.getSamples()[0].inputKind, "other");
  assert.equal(monitor.getSamples()[0].inputType, "other");
});

test("getSamples and getEvents return defensive copies", () => {
  const { monitor } = enabledMonitor();
  completeInput(monitor);
  const samples = monitor.getSamples();
  samples[0].durations.applyCurrentEditorDraft = 999;
  samples[0].attributes.bodyLength = 999;
  samples.push({ sampleType: "private" });
  assert.equal(monitor.getSamples().length, 1);
  assert.equal(monitor.getSamples()[0].durations.applyCurrentEditorDraft, 2);
  assert.equal(monitor.getSamples()[0].attributes.bodyLength, 120);
  assert.deepEqual(monitor.getEvents(), monitor.getSamples());
});

test("browser loads the monitor before app.js with isolated cache identifiers", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const monitorIndex = html.indexOf('src="typing-performance-monitor.js?v=0.5.0-2"');
  const appIndex = html.indexOf('src="app.js?v=0.5.0-115"');
  assert.notEqual(monitorIndex, -1);
  assert.notEqual(appIndex, -1);
  assert.ok(monitorIndex < appIndex);
});
