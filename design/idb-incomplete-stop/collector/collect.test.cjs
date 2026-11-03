'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectEvidence, validate, sha256, inputSchema, resultSchema } = require('./collect.cjs');
const cases = require('./fixtures/cases.json');
const cli = path.join(__dirname, 'collect.cjs');
const read = name => fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`));
const encode = data => Buffer.from(JSON.stringify(data));
const collect = data => { const bytes = encode(data); return collectEvidence(bytes, { materialId: data.materialId, expectedSha256: sha256(bytes) }); };
const guards = r => {
  assert.equal(r.conditionU, 'NOT_RUN'); assert.equal(r.realExperiment, 'NOT_RUN');
  assert.equal(r.executionAuthorization, 'NOT_GRANTED'); assert.equal(r.startCondition, 'BLOCKED'); assert.equal(r.productionWorker, 'HOLD');
  assert.deepEqual(r.hypotheses, { H1: 'UNKNOWN', H2: 'UNKNOWN', H3: 'UNKNOWN', H4: 'PARTIAL' });
  assert.deepEqual(validate(r, resultSchema), []);
  for (const t of r.transactions) { assert.notEqual(t.assessment.conditionU, 'PASS'); assert.equal(t.assessment.connectionClosed, 'UNKNOWN'); assert.equal(t.assessment.physicalRelease, 'UNKNOWN'); }
};

for (const c of cases) test(`contract fixture: ${c.name} (${c.category})`, () => {
  const filename = path.join(__dirname, 'fixtures', c.file), bytes = fs.readFileSync(filename), before = sha256(bytes);
  const r = collectEvidence(bytes, { materialId: c.name, expectedSha256: c.expectedSha256 });
  const child = spawnSync(process.execPath, [cli, filename, c.name, c.expectedSha256], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.stderr, '');
  assert.equal(child.status, c.expected.exitCode); assert.deepEqual(JSON.parse(child.stdout), r);
  assert.equal(r.evidenceStatus, c.expected.status); assert.equal(r.exitCode, c.expected.exitCode);
  if (c.expected.code) assert(r.reasons.includes(c.expected.code), `${c.name}: ${r.reasons}`);
  if (c.expected.conditionR !== null) {
    assert(r.transactions.length > 0);
    for (const t of r.transactions) {
      assert.equal(t.assessment.validTrace, c.expected.validTrace);
      assert.equal(t.assessment.conditionR, c.expected.conditionR); assert.equal(t.assessment.conditionU, c.expected.conditionU);
    }
  } else assert.equal(r.transactions.length, 0);
  assert.equal(sha256(fs.readFileSync(filename)), before); guards(r);
});

test('arbitrary array permutations preserve all semantics, relations and reasons', () => {
  let seed = 401;
  const next = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  const semantics = r => { r = structuredClone(r); delete r.input.actualSha256; delete r.input.expectedSha256; return r; };
  for (const name of ['single', 'multiple', 'worker-complete-only', 'received-after-stop', 'commit-abort-conflict', 'foreign-session', 'duplicate-injection', 'all-events-deleted']) {
    const data = JSON.parse(read(name)), baseline = semantics(collect(data));
    for (let n = 0; n < 40; n++) {
      for (const key of ['events', 'streams', 'identities']) for (let i = data[key].length - 1; i > 0; i--) { const j = next(i + 1); [data[key][i], data[key][j]] = [data[key][j], data[key][i]]; }
      assert.deepEqual(semantics(collect(data)), baseline, `${name}: permutation ${n}`);
    }
  }
});

test('clock values never create causal edges', () => {
  const data = JSON.parse(read('worker-complete-only'));
  const baseline = collect(data);
  for (const e of data.events) e.sourceMs = e.source === 'worker' ? -999999 : 999999;
  const changed = collect(data);
  for (const key of ['transactions', 'orderRelations', 'relations', 'missingEvidence', 'contradictions', 'reasons', 'unknownReasons']) assert.deepEqual(changed[key], baseline[key]);
});

test('deleting any single event never supplies a new unfinished proof', () => {
  const data = JSON.parse(read('single'));
  for (const removed of data.events) {
    const changed = structuredClone(data); changed.events = changed.events.filter(e => e.eventId !== removed.eventId);
    const r = collect(changed); guards(r); assert.equal(r.evidenceStatus, 'INCOMPLETE');
    assert.equal(r.transactions[0].assessment.validTrace, 'FAIL'); assert.equal(r.transactions[0].assessment.conditionR, 'UNKNOWN'); assert.equal(r.transactions[0].assessment.conditionU, 'UNKNOWN');
  }
});

test('all required event fields and foreign extra fields are enforced by the schema', () => {
  const data = JSON.parse(read('single'));
  for (let i = 0; i < data.events.length; i++) {
    for (const key of Object.keys(data.events[i])) {
      const changed = structuredClone(data); delete changed.events[i][key];
      assert.equal(collect(changed).evidenceStatus, 'INVALID_SCHEMA', `${i}:${key}`);
    }
  }
  for (const key of Object.keys(data)) { const changed = structuredClone(data); delete changed[key]; assert.equal(collect(changed).evidenceStatus, 'INVALID_SCHEMA', key); }
});

test('bounded input, invalid UTF-8, unsafe number, unsupported schema version and invalid descriptor', () => {
  for (const bytes of [Buffer.alloc(2 * 1024 * 1024 + 1, 32), Buffer.from([0xff]), Buffer.from('['.repeat(34) + '0' + ']'.repeat(34))]) {
    const r = collectEvidence(bytes, { materialId: 'bounded', expectedSha256: sha256(bytes) }); guards(r); assert.equal(r.exitCode, 2);
  }
  const r = collectEvidence(read('single'), { materialId: 'single', expectedSha256: 'missing' }); guards(r); assert.equal(r.exitCode, 2);
});

test('missing file and wrong CLI arity return JSON and matching exit code 2', () => {
  for (const args of [[], [path.join(__dirname, 'fixtures', 'not-present.json'), 'missing', '0'.repeat(64)]]) {
    const child = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.ifError(child.error); assert.equal(child.status, 2); const r = JSON.parse(child.stdout); assert.equal(r.exitCode, 2); guards(r);
  }
});

test('semantically permitted edits with a recomputed hash are not authenticated', () => {
  const data = JSON.parse(read('single')); data.planId = 'another-plan';
  assert.equal(collect(data).evidenceStatus, 'CONSISTENT'); // Explicit trust limit, not a tamper-proof claim.
});

test('partial known source edges survive gaps but do not make a valid trace', () => {
  const r = collect(JSON.parse(read('source-sequence-gap')));
  assert(r.orderRelations.some(e => e.before === 'w3' && e.after === 'w5' && e.basis === 'source-sequence'));
  assert.equal(r.transactions[0].assessment.validTrace, 'FAIL');
});

test('independent old negative control and new positive control use the same causal counterexample', () => {
  const fixture = require('../records/ir-fix/inputs/merge-orders.json');
  const old = require('../records/ir-fix/inputs/before-judge.cjs');
  const oldResults = [], currentResults = [];
  for (const order of fixture.orders) {
    const events = order.map(id => fixture.events.find(e => e.eventId === id));
    oldResults.push(old.judgeTrace({ identity: fixture.identity, events }).conditionU ?? old.judgeTrace({ identity: fixture.identity, events }).stopCondition);
    const data = { schemaVersion: 1, fixtureKind: 'SYNTHETIC', materialId: 'ir1', planId: 'IR1-control', runId: fixture.identity.runId, identities: [fixture.identity],
      streams: ['worker', 'main'].map(source => ({ source, ...(source === 'worker' ? { workerId: fixture.identity.workerId } : {}), firstSeq: 1, lastSeq: Math.max(...events.filter(e => e.source === source).map(e => e.sourceSeq)) })), events };
    const r = collect(data); assert.notEqual(r.evidenceStatus, 'INVALID_SCHEMA'); currentResults.push(r.transactions[0].assessment.conditionU);
  }
  assert.deepEqual(oldResults, ['FAIL', 'FAIL', 'UNKNOWN', 'UNKNOWN']);
  assert.deepEqual(currentResults, ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
});

test('input/result schemas cannot confuse arbitrary proof booleans with supported evidence', () => {
  const data = JSON.parse(read('single')); data.unfinished = true;
  assert(validate(data, inputSchema).length > 0);
  const r = collect(JSON.parse(read('single'))); r.transactions[0].assessment.conditionU = 'PASS'; assert(validate(r, resultSchema).length > 0);
});

test('multiple worker streams share a single main sequence without cross-worker sorting', () => {
  const data = JSON.parse(read('multiple'));
  for (const t of data.identities) if (t.transactionId === 't2') t.workerId = 'w2';
  for (const e of data.events.filter(e => e.transactionId === 't2')) { e.workerId = 'w2'; if (e.source === 'worker') e.sourceSeq -= 6; }
  data.streams[0].lastSeq = 6; data.streams.push({ source: 'worker', workerId: 'w2', firstSeq: 1, lastSeq: 6 });
  const r = collect(data); assert.equal(r.evidenceStatus, 'CONSISTENT'); assert(r.transactions.every(t => t.assessment.conditionR === 'PASS')); guards(r);
  assert(!r.orderRelations.some(edge => edge.before === 'w6' && edge.after === 'b-w1'));
});

for (const [name, mutate, status, code] of [
  ['coverage tail loss', d => d.streams[0].lastSeq++, 'INCOMPLETE', 'SOURCE_SEQUENCE_GAP'],
  ['coverage outside range', d => d.streams[0].lastSeq--, 'INCONSISTENT', 'SEQUENCE_OUTSIDE_COVERAGE'],
  ['missing worker coverage', d => d.streams.shift(), 'INCOMPLETE', 'SOURCE_COVERAGE_MISSING'],
  ['duplicate inventory', d => d.identities.push(structuredClone(d.identities[0])), 'INCONSISTENT', 'DUPLICATE_IDENTITY'],
  ['duplicate coverage', d => d.streams.push(structuredClone(d.streams[0])), 'INCONSISTENT', 'DUPLICATE_STREAM'],
  ['terminal before identification', d => { const a = d.events.find(e => e.type === 'transaction_identified'), b = d.events.find(e => e.type === 'commit_observed'); [a.sourceSeq, b.sourceSeq] = [b.sourceSeq, a.sourceSeq]; }, 'INCONSISTENT', 'SOURCE_ORDER_REVERSED'],
  ['terminal before request acceptance', d => { const a = d.events.find(e => e.type === 'request_accepted'), b = d.events.find(e => e.type === 'commit_observed'); [a.sourceSeq, b.sourceSeq] = [b.sourceSeq, a.sourceSeq]; }, 'INCONSISTENT', 'SOURCE_ORDER_REVERSED']
]) test(name, () => {
  const data = JSON.parse(read('single')); mutate(data); const r = collect(data); guards(r);
  assert.equal(r.evidenceStatus, status); assert(r.reasons.includes(code));
  assert(r.transactions.every(t => t.assessment.validTrace === 'FAIL' && t.assessment.conditionU === 'UNKNOWN' && t.assessment.conditionR === 'UNKNOWN'));
});

test('maximum declared sequence has bounded gap diagnostics matching result schema', () => {
  const data = JSON.parse(read('single')); data.streams[0].lastSeq = 8192;
  const r = collect(data); assert.equal(r.evidenceStatus, 'INCOMPLETE'); guards(r);
});

test('IDs and external hashes with trailing line terminators are rejected', () => {
  const data = JSON.parse(read('single')); data.events[0].eventId += '\n';
  assert.equal(collect(data).evidenceStatus, 'INVALID_SCHEMA');
  for (const options of [
    { materialId: 'single', expectedSha256: sha256(read('single')) + '\n' },
    { materialId: 'single\n', expectedSha256: sha256(read('single')) },
    { materialId: 'x'.repeat(129), expectedSha256: sha256(read('single')) }
  ]) assert.equal(collectEvidence(read('single'), options).exitCode, 2);
});
