"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { PLAN, LIMITS, conditionEstablished, outcome } = require("./diagnostic-plan.js");
const { inContext } = require("./context-harness.cjs");
test("diagnostic plan is six fixed conditions, one repetition, unchanged deadlines", () => {
  assert.equal(PLAN.length, 6); assert.equal(new Set(PLAN.map(item => item.id)).size, 6);
  assert.ok(PLAN.every(item => item.repetition === 1)); assert.equal(LIMITS.openMs, 8000); assert.equal(LIMITS.cleanupMs, 2000);
});
for (const condition of ["A", "B", "C"]) test("condition " + condition + " requires its own boundary facts", () => {
  const good = { requestSuccess: true, rowCount: 2, transactionTerminal: condition === "B" ? "UNKNOWN" : "complete", closeCalled: condition === "A" };
  assert.equal(conditionEstablished(condition, good), true);
  assert.equal(conditionEstablished(condition, { ...good, requestSuccess: false }), false);
  assert.equal(conditionEstablished(condition, { ...good, rowCount: 0 }), false);
  assert.equal(conditionEstablished(condition, { ...good, transactionTerminal: "abort" }), false);
  assert.equal(conditionEstablished(condition, { ...good, closeCalled: !good.closeCalled }), false);
});
test("upgrade success cannot promote an unmet condition or unknown cleanup", () => {
  assert.equal(outcome(false, "PASS", "PASS"), "CONDITION_NOT_MET");
  assert.equal(outcome(true, "TIMEOUT", "PASS"), "UNKNOWN");
  assert.equal(outcome(true, "PASS", "UNKNOWN"), "HOLD");
  assert.equal(outcome(true, "PASS", "PASS"), "PASS");
});
test("contexts are generated and closed independently despite preceding cleanup UNKNOWN", async () => {
  let count = 0; const closed = [], events = [];
  const browser = { async newContext() { const id = ++count; return { async newPage() { return { async goto() {} }; }, async close() { closed.push(id); } }; } };
  const a = await inContext(browser, "A", "fixture", async () => ({ cleanup: "UNKNOWN" }), events, { contextMs: 100, closeMs: 100 });
  const b = await inContext(browser, "B", "fixture", async () => ({ ownResult: "PASS" }), events, { contextMs: 100, closeMs: 100 });
  assert.equal(a.value.cleanup, "UNKNOWN"); assert.equal(b.value.ownResult, "PASS"); assert.notEqual(a.contextId, b.contextId);
  assert.deepEqual(closed, [1, 2]); assert.equal(events.findIndex(e => e.contextId === "B"), events.findIndex(e => e.contextId === "A" && e.event === "context_close_end") + 1);
});
test("a stalled action is bounded and the next context still runs", async () => {
  const events = []; let closed = 0;
  const browser = { async newContext() { return { async newPage() { return { async goto() {}, async evaluate() { return null; } }; }, async close() { closed++; } }; } };
  const a = await inContext(browser, "A", "fixture", () => new Promise(() => {}), events, { contextMs: 10, closeMs: 10 });
  assert.equal(a.error, "context trial timeout"); assert.equal(closed, 1);
  const b = await inContext(browser, "B", "fixture", async () => "second", events, { contextMs: 10, closeMs: 10 });
  assert.equal(b.value, "second");
});

test("unknown context close is retained without borrowing the next result", async () => {
  let created = 0;
  const browser = { async newContext() { const id = ++created; return { async newPage() { return { async goto() {} }; }, close() { return id === 1 ? new Promise(() => {}) : Promise.resolve(); } }; } };
  const events = [];
  const a = await inContext(browser, "A", "fixture", async () => "first", events, { contextMs: 100, closeMs: 10 });
  const b = await inContext(browser, "B", "fixture", async () => "second", events, { contextMs: 100, closeMs: 10 });
  assert.equal(a.contextClose, "UNKNOWN"); assert.equal(b.contextClose, "RETURNED"); assert.equal(b.value, "second");
  assert.equal(events.find(e => e.contextId === "A" && e.event === "context_close_end").actualResourceRelease, "UNKNOWN");
});
