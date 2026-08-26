const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  createTypingPerformanceMonitor,
  isTypingPerformanceEnabled,
  summarizeEvents
} = require("./typing-performance-monitor.js");

test("explicit debugTypingPerf=1 query is the only URL opt-in", () => {
  assert.equal(typeof globalThis.MemoNexusTypingPerformance?.getEvents, "function");
  assert.equal(globalThis.MemoNexusTypingPerformance.isEnabled(), false);
  assert.equal(isTypingPerformanceEnabled("?debugTypingPerf=1"), true);
  assert.equal(isTypingPerformanceEnabled("?view=compact&debugTypingPerf=1"), true);
  assert.equal(isTypingPerformanceEnabled("?debugTypingPerf=0"), false);
  assert.equal(isTypingPerformanceEnabled("?debugTypingPerf=true"), false);
  assert.equal(isTypingPerformanceEnabled(""), false);
});

test("disabled monitor does not read the clock or record events", () => {
  let clockReads = 0;
  const monitor = createTypingPerformanceMonitor({
    enabled: false,
    performance: { now() { clockReads += 1; return 10; } }
  });
  const startedAt = monitor.start();
  monitor.elapsed(startedAt);
  assert.equal(monitor.record("body.input.total", 3, { bodyLength: 4 }), false);
  assert.equal(clockReads, 0);
  assert.deepEqual(monitor.getEvents(), []);
  assert.deepEqual(monitor.getSummary(), {});
});

test("enabled monitor records duration and performance-safe attributes", () => {
  const times = [10, 14.5];
  const monitor = createTypingPerformanceMonitor({
    enabled: true,
    performance: { now: () => times.shift() }
  });
  const startedAt = monitor.start();
  monitor.record("body.sync.applyCurrentEditorDraft", monitor.elapsed(startedAt), {
    bodyLength: 120,
    titleLength: 8,
    memoCount: 12,
    inputKind: "body",
    inputType: "insertText",
    isComposing: false,
    isCurrentNote: true,
    renderType: "full"
  });
  assert.deepEqual(monitor.getEvents(), [{
    name: "body.sync.applyCurrentEditorDraft",
    duration: 4.5,
    attributes: {
      bodyLength: 120,
      titleLength: 8,
      memoCount: 12,
      isComposing: false,
      isCurrentNote: true,
      inputKind: "body",
      inputType: "insertText",
      renderType: "full"
    }
  }]);
});

test("ring buffer retains only the newest events", () => {
  const monitor = createTypingPerformanceMonitor({ enabled: true, limit: 3, dateNow: () => 0 });
  for (let index = 1; index <= 5; index += 1) {
    monitor.record("body.input.total", index, { bodyLength: index });
  }
  assert.deepEqual(monitor.getEvents().map((event) => event.duration), [3, 4, 5]);
});

test("summary includes count, average, p50, p95, and max", () => {
  const events = [1, 2, 3, 4, 100].map((duration) => ({ name: "full.derived.renderPreview", duration }));
  assert.deepEqual(summarizeEvents(events), {
    "full.derived.renderPreview": { count: 5, average: 22, p50: 3, p95: 100, max: 100 }
  });
});

test("empty summary and clear are safe", () => {
  const monitor = createTypingPerformanceMonitor({ enabled: true, dateNow: () => 0 });
  assert.deepEqual(monitor.getSummary(), {});
  monitor.record("title.input.total", 1, { inputKind: "title" });
  monitor.clear();
  monitor.clear();
  assert.deepEqual(monitor.getEvents(), []);
  assert.deepEqual(monitor.getSummary(), {});
});

test("Date.now fallback is safe when performance.now is unavailable", () => {
  const times = [100, 107];
  const monitor = createTypingPerformanceMonitor({
    enabled: true,
    performance: {},
    dateNow: () => times.shift()
  });
  const startedAt = monitor.start();
  assert.equal(monitor.elapsed(startedAt), 7);
});

test("recorded data drops memo text, title text, tags, ids, and arbitrary strings", () => {
  const monitor = createTypingPerformanceMonitor({ enabled: true, dateNow: () => 0 });
  monitor.record("table.input.total", 2, {
    body: "private body",
    title: "private title",
    tagName: "private tag",
    noteId: "private-id",
    arbitrary: "private value",
    inputKind: "private body",
    inputType: "private title",
    bodyLength: 12
  });
  const serialized = JSON.stringify(monitor.getEvents());
  assert.doesNotMatch(serialized, /private|noteId|tagName|arbitrary/);
  assert.deepEqual(monitor.getEvents()[0].attributes, {
    bodyLength: 12,
    inputKind: "other",
    inputType: "other"
  });
  assert.equal(monitor.record("private body", 3, { bodyLength: 12 }), false);
  assert.doesNotMatch(JSON.stringify(monitor.getEvents()), /private/);
});

test("browser loads the monitor before app.js with isolated cache identifiers", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const monitorIndex = html.indexOf('src="typing-performance-monitor.js?v=0.5.0-1"');
  const appIndex = html.indexOf('src="app.js?v=0.5.0-114"');
  assert.notEqual(monitorIndex, -1);
  assert.notEqual(appIndex, -1);
  assert.ok(monitorIndex < appIndex);
});
