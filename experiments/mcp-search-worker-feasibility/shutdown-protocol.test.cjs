"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createShutdownProtocol } = require("./shutdown-protocol.cjs");
test("stop invalidates and accepts one matching acknowledgement but never releases physical budget", () => {
  const s = createShutdownProtocol({ id: "new", generation: 2 });
  assert.equal(s.receive({ type: "shutdown_ack", id: "new", generation: 2, idbClosed: true }), false);
  assert.equal(s.stop(), true); assert.equal(s.stop(), false);
  for (const m of [null, { type: "shutdown_ack", id: "old", generation: 1, idbClosed: true }, { type: "shutdown_ack", id: "new", generation: 1, idbClosed: true }, { type: "shutdown_ack", id: "new", generation: 2, idbClosed: false }]) assert.equal(s.receive(m), false);
  const ack = { type: "shutdown_ack", id: "new", generation: 2, idbClosed: true };
  assert.equal(s.receive(ack), true); assert.equal(s.receive(ack), false); s.deadline();
  assert.deepEqual(s.state(), { phase: "shutdown_acknowledged", invalidated: true, reusable: false, physicalRelease: "UNKNOWN" });
});
test("missing acknowledgement becomes unknown and late acknowledgement is refused", () => {
  const s = createShutdownProtocol({ id: "old", generation: 1 }); s.stop(); s.deadline();
  assert.equal(s.receive({ type: "shutdown_ack", id: "old", generation: 1, idbClosed: true }), false);
  assert.deepEqual(s.state(), { phase: "unknown", invalidated: true, reusable: false, physicalRelease: "UNKNOWN" });
});
