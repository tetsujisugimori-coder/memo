const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RecoverySupervisor } = require('./supervisor.js');
function setup() {
  let time = 0; const workers = [], timers = new Set();
  const manager = new RecoverySupervisor({ now: () => time, monotonicNow: () => time, setTimer: fn => { timers.add(fn); return fn; }, clearTimer: fn => timers.delete(fn), createWorker: () => {
    const worker = { postMessage(data) { this.sent = data; }, terminate() { this.terminated = true; } }; workers.push(worker); return worker;
  } });
  const authorize = (id = 'synthetic-A', allowRead = true) => manager.authorize({ id, expiresAt: 10000, allowRead });
  const complete = (worker = workers.at(-1), changes = {}) => worker.onmessage?.({ data: { ...worker.sent, phase: 'complete', transaction: 'complete', closeRequested: true, result: [{ id: 'n1' }], ...changes } });
  return { manager, workers, timers, authorize, complete, advance: ms => { time += ms; for (const fn of [...timers]) fn(); } };
}
test('normal search and read reuse a single Worker; duplicate delivery rejected', async () => {
  const s = setup(); s.authorize(); const p = s.manager.execute({ operation: 'search' }); const old = s.workers[0].onmessage; s.complete(); assert.deepEqual(await p, [{ id: 'n1' }]);
  const q = s.manager.execute({ operation: 'read' }); old({ data: { ...s.workers[0].sent, phase: 'complete', transaction: 'complete', closeRequested: true, result: ['injected'] } }); assert.equal(s.manager.status().pending, true); s.complete(); await q; assert.equal(s.workers.length, 1);
});
test('each identity mismatch is rejected without releasing pending request', async () => {
  const s = setup(); s.authorize(); const p = s.manager.execute({ operation: 'search' });
  for (const key of ['workerId', 'generation', 'requestId', 'session']) { s.complete(undefined, { [key]: 'wrong' }); assert.equal(s.manager.status().pending, true); }
  s.complete(); await p;
});
test('timeout settles without releasing original Promise; remaining lifetime slot recovers', async () => {
  const s = setup(); s.authorize(); const p = s.manager.execute({ operation: 'search' }); const rejected = assert.rejects(p, /timeout/); const old = s.workers[0].onmessage; const data = { ...s.workers[0].sent, phase: 'complete', transaction: 'complete', closeRequested: true, result: ['old'] };
  s.advance(1000); await rejected; assert.equal(s.workers[0].terminated, true);
  const q = s.manager.execute({ operation: 'read' }); old({ data }); assert.equal(s.manager.status().pending, true); s.complete(); await q; assert.equal(s.manager.status().quarantined, 1);
});
test('second timeout exhausts lifetime slots, even across a new session', async () => {
  const s = setup(); s.authorize();
  for (let i = 0; i < 2; i++) { const p = assert.rejects(s.manager.execute({ operation: 'search' }), /timeout/); s.advance(1000); await p; }
  s.authorize('B'); await assert.rejects(s.manager.execute({ operation: 'search' }), /resource_release_unconfirmed/); assert.equal(s.workers.length, 2); assert.equal(s.manager.status().state, 'STOPPED_RESOURCE_UNCONFIRMED');
});
test('cancel and session replacement reject old delivery', async () => {
  const s = setup(); s.authorize(); const p = assert.rejects(s.manager.execute({ operation: 'read' }), /session_replaced/); const old = s.workers[0].onmessage; s.authorize('B'); await p;
  const q = s.manager.execute({ operation: 'search' }); old({ data: { ...s.workers[1].sent, phase: 'complete', transaction: 'complete', closeRequested: true, result: ['old'] } }); s.complete(); await q;
  s.manager.cancel(); await assert.rejects(s.manager.execute({ operation: 'search' }), /expired_or_cancelled/);
});
test('expiry checked on result even if timer throttled', async () => {
  let now = 0, worker; const m = new RecoverySupervisor({ createWorker: () => worker = { postMessage(d) { this.sent = d; }, terminate() {} }, now: () => now, setTimer: () => 1, clearTimer: () => {} });
  m.authorize({ id: 'A', expiresAt: 10, allowRead: true }); const p = assert.rejects(m.execute({ operation: 'read' }), /expired/); now = 11; worker.onmessage({ data: { ...worker.sent, phase: 'complete', transaction: 'complete', closeRequested: true, result: [] } }); await p;
});
test('read requires explicit permission; busy rejects parallel request', async () => {
  const s = setup(); s.authorize('A', false); await assert.rejects(s.manager.execute({ operation: 'read' }), /not_allowed/); const p = s.manager.execute({ operation: 'search' }); await assert.rejects(s.manager.execute({ operation: 'search' }), /busy/); s.complete(); await p;
});
test('construction failures consume the lifetime budget', async () => {
  let calls = 0; const m = new RecoverySupervisor({ createWorker: () => { calls++; throw new Error('failure'); } }); m.authorize({ id: 'A', expiresAt: Date.now() + 10000 });
  for (let i = 0; i < 2; i++) await assert.rejects(m.execute({ operation: 'search' }), /creation_failed/); await assert.rejects(m.execute({ operation: 'search' }), /release_unconfirmed/); assert.equal(calls, 2);
});
test('incomplete close/transaction messages never deliver', async () => {
  const s = setup(); s.authorize(); const p = s.manager.execute({ operation: 'search' }); s.complete(undefined, { transaction: 'unknown' }); s.complete(undefined, { closeRequested: false }); assert.equal(s.manager.status().pending, true); s.complete(); await p;
});
test('close permanently prevents new session and creation', async () => {
  const s = setup(); s.authorize(); const p = assert.rejects(s.manager.execute({ operation: 'search' }), /closed/); s.manager.close(); await p; assert.throws(() => s.authorize(), /closed/); await assert.rejects(s.manager.execute({ operation: 'search' }), /closed/);
});

test('wall clock rollback cannot extend relative deadline when timer is throttled', async () => {
  let wall = 10000, monotonic = 0, worker;
  const m = new RecoverySupervisor({ now: () => wall, monotonicNow: () => monotonic, setTimer: () => 1, clearTimer: () => {}, createWorker: () => worker = { postMessage(d) { this.sent = d; }, terminate() {} } });
  m.authorize({ id: 'A', expiresAt: 20000 });
  const rejected = assert.rejects(m.execute({ operation: 'search', timeoutMs: 1000 }), /expired_or_timeout/);
  wall = 9500; monotonic = 1001;
  worker.onmessage({ data: { ...worker.sent, phase: 'complete', transaction: 'complete', closeRequested: true, result: [] } });
  await rejected; assert.equal(m.status().quarantined, 1);
});

test('default timer wrappers retain global receiver required by browser timers', async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let callback, worker;
  globalThis.setTimeout = function (fn) { assert.equal(this, globalThis); callback = fn; return 1; };
  globalThis.clearTimeout = function () { assert.equal(this, globalThis); };
  try {
    const m = new RecoverySupervisor({ createWorker: () => worker = { postMessage(d) { this.sent = d; }, terminate() {} } });
    m.authorize({ id: 'A', expiresAt: Date.now() + 10000 }); const result = m.execute({ operation: 'search' });
    worker.onmessage({ data: { ...worker.sent, phase: 'complete', transaction: 'complete', closeRequested: true, result: [] } });
    assert.deepEqual(await result, []); assert.equal(typeof callback, 'function');
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});
