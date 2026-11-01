"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
// Explicit finite, synthetic fixture; never imports an experiment runner.
const { judgeTrace } = process.env.STATIC_JUDGE_BASELINE === "1"
  ? require("./records/ir-fix/inputs/before-judge.cjs") : require("./judge.cjs");
const fixture = require("./records/ir-fix/inputs/merge-orders.json");
test("IR1: four merges of the same partial order have identical UNKNOWN semantics", () => {
  const results = fixture.orders.map(order => judgeTrace({ identity:fixture.identity,
    events:order.map(id => fixture.events.find(e => e.eventId === id)) }));
  console.log(JSON.stringify({ orders:fixture.orders, results }));
  for (const r of results) {
    assert.equal(r.validTrace, "PASS");
    assert.equal(r.stopCondition, "UNKNOWN");
    assert.deepEqual(r, results[0]);
  }
});
