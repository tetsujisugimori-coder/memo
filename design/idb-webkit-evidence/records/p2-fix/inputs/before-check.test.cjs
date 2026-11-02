'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { checkDocuments } = require('./check.cjs');
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema.json'), 'utf8'));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function fixture() {
  const upstream = 'a'.repeat(40), dependency = 'b'.repeat(40);
  const provided = new Map(Object.entries({
    lock: JSON.stringify({ packages: { 'node_modules/playwright': { version: '1.62.1' }, 'node_modules/playwright-core': { version: '1.62.1' } } }),
    browsers: JSON.stringify({ browsers: [{ name: 'webkit', browserVersion: '26.5', revision: '2336', revisionOverrides: { 'ubuntu20.04-x64': '2092' } }] }),
    config: `BASE_REVISION="${upstream}"\n`,
    log: 'Downloading WebKit 26.5 (playwright webkit v2336) from https://cdn.playwright.dev/dbazure/download/playwright/builds/webkit/2336/webkit-ubuntu-24.04.zip\n',
    reference: 'A hypothetical hook description; this text does not prove the claim.\n'
  }).map(([id, text]) => [id, Buffer.from(text)]));
  const refs = [{ sourceId: 'reference', startLine: 1, endLine: 1 }];
  const boundary = () => ({ status: 'DOCUMENTED', description: 'Hypothetical documented candidate, not an observation.', refs: structuredClone(refs) });
  const plan = {
    schemaVersion: 1, plan: { id: 'synthetic-document-only', condition: 'U' },
    target: { id: 'target', playwrightVersion: '1.62.1', browserVersion: '26.5', browserRevision: '2336', platform: 'ubuntu24.04-x64', upstreamRevision: upstream },
    sources: [...provided].map(([id, bytes], i) => ({ id, role: ['LOCK', 'BROWSERS', 'UPSTREAM_CONFIG', 'SAVED_LOG', 'REFERENCE'][i], revision: id === 'reference' ? upstream : dependency, sha256: hash(bytes), url: `https://example.invalid/${id}` })),
    versionMapping: { status: 'VERIFIED_METADATA', refs, facts: ['Synthetic metadata matches.'], inferences: [], unknowns: [] },
    transactionId: 'app-tx',
    candidates: [{ id: 'hypothetical', targetId: 'target', sourceRevision: upstream, transactionId: 'app-tx', engineTransactionId: 'hypothetical-engine-id',
      access: 'CUSTOM_BUILD', status: 'CANDIDATE', identityMapping: boundary(),
      boundaries: Object.fromEntries(['normalUnterminated', 'actualWorkerStop', 'commit', 'abort', 'abnormal'].map(k => [k, boundary()])),
      statesDistinguished: ['NORMAL_UNTERMINATED', 'COMMIT', 'ABORT', 'ABNORMAL'], statesAtBoundary: ['NORMAL_UNTERMINATED'],
      requiredChanges: ['Hypothetical native recorder.'], limitations: ['Assertions are not verified.'] }], unknowns: []
  };
  return { plan, provided };
}
function blocked(output) {
  assert.equal(output.startCondition, 'BLOCKED'); assert.equal(output.executionAuthorization, 'NOT_GRANTED');
  assert.equal(output.realExperiment, 'NOT_RUN'); assert.equal(output.conditionU, 'NOT_RUN');
  assert.equal(output.productionWorker, 'HOLD'); assert.equal(Object.hasOwn(output, 'conditionR'), false);
  assert.deepEqual(output.hypotheses, { H1: 'UNKNOWN', H2: 'UNKNOWN', H3: 'UNKNOWN', H4: 'PARTIAL' });
}
function check(f) { const output = checkDocuments(f.plan, schema, f.provided); blocked(output); return output; }
test('consistent synthetic documents return 0 without validating their self-reported meaning; R also stays blocked', () => {
  const f = fixture(); const before = JSON.stringify(f.plan);
  assert.equal(check(f).documentStatus, 'CONSISTENT'); assert.equal(check(f).exitCode, 0);
  assert.equal(JSON.stringify(f.plan), before);
  f.plan.plan.condition = 'R'; assert.equal(check(f).documentStatus, 'CONSISTENT');
});
test('schema rejects missing keys, wrong type, version and unchecked proof at both levels', () => {
  for (const mutate of [p => delete p.plan.id, p => p.schemaVersion = 2, p => p.unknowns = 'UNKNOWN', p => p.proof = 'PASS', p => p.candidates[0].proof = true]) {
    const f = fixture(); mutate(f.plan); const out = check(f); assert.equal(out.documentStatus, 'INVALID_SCHEMA'); assert.equal(out.exitCode, 2);
  }
});
test('a relaxed external schema cannot bypass the supported contract', () => {
  const f = fixture(), relaxed = structuredClone(schema); relaxed.additionalProperties = true;
  const out = checkDocuments(f.plan, relaxed, f.provided); blocked(out); assert.equal(out.exitCode, 2);
});
test('empty required documents are incomplete, not malformed or consistent', () => {
  const f = fixture(); f.plan.candidates = []; f.plan.versionMapping.refs = [];
  const out = check(f); assert.equal(out.documentStatus, 'INCOMPLETE'); assert.ok(out.reasons.some(r => r.code === 'NO_CANDIDATE'));
});
test('broken IDs, reversed and out-of-range references are inconsistent', () => {
  for (const ref of [{ sourceId: 'absent', startLine: 1, endLine: 1 }, { sourceId: 'reference', startLine: 2, endLine: 1 }, { sourceId: 'reference', startLine: 1, endLine: 2 }]) {
    const f = fixture(); f.plan.candidates[0].identityMapping.refs = [ref]; assert.equal(check(f).documentStatus, 'INCONSISTENT');
  }
});
test('target, upstream and another application transaction cannot be mixed into a candidate', () => {
  for (const key of ['targetId', 'sourceRevision', 'transactionId']) {
    const f = fixture(); f.plan.candidates[0][key] = key === 'sourceRevision' ? 'c'.repeat(40) : 'other';
    assert.equal(check(f).documentStatus, 'INCONSISTENT');
  }
});
test('a source at another revision is rejected even if its bytes match', () => {
  const f = fixture(); f.plan.sources.find(s => s.id === 'reference').revision = 'c'.repeat(40);
  assert.ok(check(f).reasons.some(r => r.code === 'SOURCE_REVISION_MISMATCH'));
});
test('fixed adapters detect different Playwright, browser revision, upstream or platform records', () => {
  for (const [field, value] of [['playwrightVersion', '1.61.0'], ['browserRevision', '2337'], ['upstreamRevision', 'c'.repeat(40)], ['platform', 'ubuntu24.04-arm64']]) {
    const f = fixture(); f.plan.target[field] = value;
    assert.ok(check(f).reasons.some(r => r.code === 'METADATA_MISMATCH'));
  }
  const f = fixture(); f.plan.target.platform = 'ubuntu20.04-x64';
  assert.ok(check(f).reasons.some(r => r.code === 'METADATA_MISMATCH')); // override 2092, not default 2336
});
test('download URL revision cannot contradict the log message', () => {
  const f = fixture(); const b = Buffer.from(f.provided.get('log').toString().replace('/2336/', '/9999/')); f.provided.set('log', b); f.plan.sources.find(s => s.id === 'log').sha256 = hash(b);
  assert.ok(check(f).reasons.some(r => r.code === 'METADATA_MISMATCH'));
});
test('hash tampering, duplicate source and candidate IDs are inconsistent', () => {
  for (const mutate of [f => f.provided.set('reference', Buffer.from('tampered')), f => f.plan.sources.push(f.plan.sources[0]), f => f.plan.candidates.push(f.plan.candidates[0])]) {
    const f = fixture(); mutate(f); assert.equal(check(f).documentStatus, 'INCONSISTENT');
  }
});
test('contradictory exclusive stop states retain conflicts alongside UNKNOWN', () => {
  const f = fixture(); f.plan.candidates[0].statesAtBoundary = ['NORMAL_UNTERMINATED', 'COMMITTED', 'UNKNOWN'];
  const out = check(f); assert.equal(out.documentStatus, 'INCONSISTENT');
  assert.ok(out.reasons.some(r => r.code === 'EXCLUSIVE_BOUNDARY_STATE')); assert.ok(out.reasons.some(r => r.code === 'STOP_STATE_UNKNOWN'));
});
test('separately well-formed candidates cannot bind different engine transactions or contradict each other', () => {
  const f = fixture(), other = structuredClone(f.plan.candidates[0]);
  other.id = 'other-hook'; other.engineTransactionId = 'another-engine-tx'; other.statesAtBoundary = ['COMMITTED']; f.plan.candidates.push(other);
  const out = check(f); assert.equal(out.documentStatus, 'INCONSISTENT');
  for (const code of ['ENGINE_BINDING_CONFLICT', 'CROSS_CANDIDATE_STATE_CONFLICT']) assert.ok(out.reasons.some(r => r.code === code));
});
test('UNKNOWN, unavailable boundary and missing abnormal distinction retain all insufficiency reasons', () => {
  const f = fixture(); f.plan.target.upstreamRevision = null; f.plan.versionMapping.status = 'UNKNOWN';
  f.plan.candidates[0].engineTransactionId = 'UNKNOWN'; f.plan.candidates[0].boundaries.actualWorkerStop.status = 'UNAVAILABLE';
  f.plan.candidates[0].statesDistinguished = ['COMMIT', 'ABORT']; f.plan.unknowns = ['unavailable primary source'];
  const out = check(f); assert.equal(out.documentStatus, 'INCOMPLETE');
  for (const code of ['UPSTREAM_UNKNOWN', 'ENGINE_ID_UNKNOWN', 'BOUNDARY_UNAVAILABLE', 'STATE_NOT_DISTINGUISHED', 'DECLARED_UNKNOWN']) assert.ok(out.reasons.some(r => r.code === code), code);
});
test('unavailable primary source ends with insufficiency and does not infer a replacement', () => {
  const f = fixture(); f.provided.delete('reference'); const out = check(f); assert.equal(out.exitCode, 1);
  assert.ok(out.reasons.some(r => r.code === 'SOURCE_UNAVAILABLE')); assert.equal(out.normalized.target.upstreamRevision, f.plan.target.upstreamRevision);
});
test('CLI JSON, actual process exit codes, malformed input, missing file and byte preservation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idb-doc-check-'));
  try {
    const f = fixture(), planFile = path.join(dir, 'plan.json'), schemaFile = path.join(__dirname, 'schema.json');
    const args = ['--schema', schemaFile, '--plan', planFile];
    for (const [id, bytes] of f.provided) { const file = path.join(dir, id + '.txt'); fs.writeFileSync(file, bytes); args.push('--source', id, file); }
    fs.writeFileSync(planFile, JSON.stringify(f.plan));
    const allFiles = [schemaFile, planFile, ...[...f.provided.keys()].map(id => path.join(dir, id + '.txt'))];
    const before = allFiles.map(file => hash(fs.readFileSync(file)));
    const invoke = a => { const r = spawnSync(process.execPath, [path.join(__dirname, 'check.cjs'), ...a], { encoding: 'utf8', timeout: 5000 }); assert.ifError(r.error); const out = JSON.parse(r.stdout); blocked(out); assert.equal(r.status, out.exitCode); return out; };
    assert.equal(invoke(args).exitCode, 0); assert.deepEqual(allFiles.map(file => hash(fs.readFileSync(file))), before);
    f.plan.unknowns.push('missing independent witness'); fs.writeFileSync(planFile, JSON.stringify(f.plan)); assert.equal(invoke(args).exitCode, 1);
    const absent = [...args]; absent[absent.length - 1] = path.join(dir, 'does-not-exist');
    assert.ok(invoke(absent).reasons.some(r => r.code === 'SOURCE_READ_FAILED'));
    fs.writeFileSync(planFile, '{'); assert.equal(invoke(args).exitCode, 2); assert.equal(invoke([]).exitCode, 2);
    assert.equal(invoke([...args, '--source', 'reference', 'duplicate']).exitCode, 2);
  } finally {
    const resolved = fs.realpathSync(dir), tempRoot = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith('idb-doc-check-'));
    fs.rmSync(resolved, { recursive: true });
  }
});
