"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { deleteDatabaseObserved, DELETE_DEADLINE_MS } = require("./cleanup.js");
function fixture() {
  let fireTimer, cleared = false, clock = 0;
  const request = {}, log = [];
  const result = deleteDatabaseObserved({ factory: { deleteDatabase: () => request }, dbName: "fictional-only", record: (event, details) => log.push({ event, ...details }),
    timers: { setTimeout(fn, ms) { assert.equal(ms, DELETE_DEADLINE_MS); fireTimer = fn; return 1; }, clearTimeout() { cleared = true; } }, now: () => clock });
  return { request, log, result, expire() { clock = DELETE_DEADLINE_MS; fireTimer(); }, cleared: () => cleared };
}
test("delete success is observed before returning PASS", async () => {
  const f = fixture(); f.request.onsuccess(); assert.equal((await f.result).status, "PASS"); assert.equal(f.cleared(), true);
  assert.deepEqual(f.log.map(e => e.event), ["delete_start", "delete_success", "delete_finished"]);
});
test("delete error is FAIL rather than successful cleanup", async () => {
  const f = fixture(); f.request.error = { name: "UnknownError" }; f.request.onerror(); assert.equal((await f.result).status, "FAIL");
});
test("blocked is observed and does not itself complete deletion", async () => {
  const f = fixture(); let completed = false; f.result.then(() => { completed = true; }); f.request.onblocked(); await Promise.resolve(); assert.equal(completed, false);
  f.request.onsuccess(); const r = await f.result; assert.equal(r.status, "PASS"); assert.equal(r.blockedObserved, true);
});
test("blocked deletion returns UNKNOWN at its independent deadline", async () => {
  const f = fixture(); f.request.onblocked(); f.expire(); const r = await f.result; assert.equal(r.status, "UNKNOWN"); assert.equal(r.terminal, "timeout"); assert.equal(r.blockedObserved, true);
});
test("silent deletion returns UNKNOWN in finite time", async () => {
  const f = fixture(); f.expire(); assert.equal((await f.result).terminal, "timeout");
});
test("late success cannot promote the timed-out result to PASS", async () => {
  const f = fixture(); f.expire(); const r = await f.result; f.request.onsuccess(); assert.equal(r.status, "UNKNOWN"); assert.equal(f.log.at(-1).late, true);
});
test("synchronous delete exception is FAIL and clears deadline", async () => {
  let cleared = false;
  const r = await deleteDatabaseObserved({ factory: { deleteDatabase() { throw new TypeError("injected"); } }, dbName: "fictional-only", record() {}, timers: { setTimeout() { return 1; }, clearTimeout() { cleared = true; } }, now: () => 0 });
  assert.equal(r.status, "FAIL"); assert.equal(r.terminal, "throw"); assert.equal(cleared, true);
});
