'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const rel = 'design/idb-incomplete-stop/collector/';
const oldHead = '8873b351b17e2a0e2a7a6367718ef37baadb8c99';
const fixedHead = '635d3c94e373970042eb467d5b9f0f4b3582a1ae';
const artifact = path.join(root, 'r2-cli-review-output');
fs.mkdirSync(artifact, {recursive: true});
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function gitObject(revision, file) {
  return cp.execFileSync('git', ['show', revision + ':' + file], {cwd: root, maxBuffer: 4 * 1024 * 1024});
}
const current = path.join(root, rel, 'collect.cjs');
const currentBytes = fs.readFileSync(current);
assert.equal(sha(currentBytes), sha(gitObject(fixedHead, rel + 'collect.cjs')), 'submitted HEAD byte identity');
for (const file of [rel + 'input.schema.json', rel + 'result.schema.json', 'design/idb-incomplete-stop/judge.cjs']) {
  assert.equal(sha(gitObject(oldHead, file)), sha(gitObject(fixedHead, file)), 'unchanged supporting file ' + file);
  assert.equal(sha(fs.readFileSync(path.join(root, file))), sha(gitObject(fixedHead, file)), 'checkout supporting file ' + file);
}
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-cli-old-'));
const oldCollector = path.join(isolated, rel, 'collect.cjs');
fs.mkdirSync(path.dirname(oldCollector), {recursive: true});
fs.mkdirSync(path.join(isolated, 'design/idb-incomplete-stop'), {recursive: true});
fs.writeFileSync(oldCollector, gitObject(oldHead, rel + 'collect.cjs'));
for (const file of [rel + 'input.schema.json', rel + 'result.schema.json', 'design/idb-incomplete-stop/judge.cjs']) {
  const dest = path.join(isolated, file);
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  fs.writeFileSync(dest, gitObject(oldHead, file));
}
const normalFile = path.join(root, rel, 'diagnostic-fix/cli-error/fixtures/normal.json');
const normalBytes = fs.readFileSync(normalFile);
const baseline = JSON.parse(normalBytes);
assert.equal(normalBytes.length, 2962, 'fixed baseline fixture size');
assert.equal(sha(normalBytes), '0ac1843651c9b0ed2d2e142ccb1ae382a13b976a21adeba27126bbef73ac49aa', 'baseline fixture hash');
const cases = [];
const clone = () => structuredClone(baseline);
function add(id, obj, status, options = {}) {
  const bytes = Buffer.isBuffer(obj) ? obj : Buffer.from(JSON.stringify(obj) + '\n');
  cases.push({id, bytes, status, ...options});
}
add('normal', normalBytes, 'CONSISTENT', {causal: true});
const clockValues = [
  ['zero', 0], ['fraction', 1.5], ['negative-fraction', -0.5], ['tiny', Number.MIN_VALUE],
  ['millionth', 1e-6], ['safe-max', Number.MAX_SAFE_INTEGER], ['safe-min', -Number.MAX_SAFE_INTEGER],
  ['unsafe-positive', 2 ** 53], ['unsafe-negative', -(2 ** 53)],
  ['huge-positive', 1e20], ['huge-negative', -1e20],
  ['extreme-positive', 1e308], ['extreme-negative', -1e308],
  ['finite-max', Number.MAX_VALUE], ['finite-negative-max', -Number.MAX_VALUE]
];
for (const [id, value] of clockValues) {
  const d = clone();
  for (const event of d.events) event.sourceMs = value;
  add('clock-' + id, d, 'CONSISTENT', {causal: true, oldShouldReject: Number.isInteger(value) && !Number.isSafeInteger(value)});
}
{
  const d = clone();
  d.events.reverse();
  d.events.forEach((e, i) => {e.sourceMs = i % 2 ? Number.MAX_VALUE : -Number.MAX_VALUE;});
  add('mixed-clock-reversed-events', d, 'CONSISTENT', {causal: true, oldShouldReject: true});
}
for (const [id, value] of [
  ['string', '1e20'], ['boolean', true], ['null', null], ['array', []], ['object', {}]
]) {
  const d = clone(); d.events[0].sourceMs = value; add('invalid-clock-' + id, d, 'INVALID_SCHEMA', {reason: 'SCHEMA'});
}
for (const [id, numberLiteral] of [['positive-overflow', '1e309'], ['negative-overflow', '-1e309'], ['not-json-nan', 'NaN']]) {
  const d = clone(); d.events[0].sourceMs = '__NUMBER_LITERAL__';
  const text = JSON.stringify(d).replace('"__NUMBER_LITERAL__"', numberLiteral) + '\n';
  add('invalid-clock-' + id, Buffer.from(text), 'INVALID_SCHEMA', {reason: id === 'not-json-nan' ? 'JSON' : 'SCHEMA'});
}
for (const [field, id, value] of [
  ['sourceSeq', 'fraction', 1.5], ['sourceSeq', 'zero', 0],
  ['sourceSeq', 'above-max', 8193], ['sourceSeq', 'unsafe', 2 ** 53],
  ['iteration', 'fraction', 1.5], ['iteration', 'zero', 0],
  ['iteration', 'above-max', 8193], ['iteration', 'huge', 1e20]
]) {
  const d = clone();
  d.events[0][field] = value;
  if (field === 'iteration') d.identities[0].iteration = value;
  add('invalid-' + field + '-' + id, d, 'INVALID_SCHEMA', {reason: 'SCHEMA'});
}
{
  const d = clone();
  const event = d.events.find(e => e.type === 'complete_sent');
  assert(event, 'complete_sent must exist');
  event.sourceSeq = 8192;
  d.streams.find(s => s.source === 'worker').lastSeq = 8192;
  add('valid-schema-but-gap-8192', d, 'INCOMPLETE', {reason: 'SOURCE_SEQUENCE_GAP', unknownAxes: true});
}
add('mismatched-external-hash', normalBytes, 'INCONSISTENT', {reason: 'HASH_MISMATCH', expectedHash: '0'.repeat(64)});
{
  const text = normalBytes.toString('utf8').replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
  assert.notEqual(text, normalBytes.toString('utf8'), 'duplicate-key mutation');
  add('duplicate-json-key', Buffer.from(text), 'INVALID_SCHEMA', {reason: 'JSON'});
}
const observations = [];
function causalProjection(r) {
  return {evidenceStatus: r.evidenceStatus, exitCode: r.exitCode, transactions: r.transactions,
    relations: r.relations, orderRelations: r.orderRelations, missingEvidence: r.missingEvidence,
    contradictions: r.contradictions, reasons: r.reasons, unknownReasons: r.unknownReasons};
}
function execute(phase, collector, c, repeat = 0) {
  const input = path.join(artifact, 'input-' + c.id + '.json');
  fs.writeFileSync(input, c.bytes);
  const externalHash = c.expectedHash || sha(c.bytes);
  const command = [collector, input, baseline.materialId, externalHash];
  const p = cp.spawnSync(process.execPath, command, {encoding: 'utf8', timeout: 10000, maxBuffer: 3 * 1024 * 1024, windowsHide: true});
  const record = {phase, id: c.id, repeat, command: ['node', 'collect.cjs', 'INPUT', 'MATERIAL_ID', 'EXPECTED_SHA256'],
    inputSha256: sha(c.bytes), expectedHash: externalHash, stdout: p.stdout ?? '', stderr: p.stderr ?? '',
    processStatus: p.status, signal: p.signal, processError: p.error ? p.error.message : null};
  const file = phase + '-' + c.id + (repeat ? '-repeat' : '') + '.json';
  fs.writeFileSync(path.join(artifact, file), JSON.stringify(record, null, 2) + '\n', {flag:'wx'});
  assert.ifError(p.error);
  assert.equal(p.signal, null, phase + ' signal ' + c.id);
  assert.equal(p.stderr, '', phase + ' stderr ' + c.id);
  let r; assert.doesNotThrow(() => {r=JSON.parse(p.stdout);}, phase + ' must emit one JSON result ' + c.id);
  assert.equal(typeof r.evidenceStatus, 'string');
  assert.equal(r.exitCode, p.status, phase + ' JSON/process status equality ' + c.id);
  observations.push({phase, id:c.id, repeat, file, exitCode:p.status, evidenceStatus:r.evidenceStatus, actualSha256:r.input?.actualSha256, semanticSha256:r.input?.semanticSha256,
    conditionR:r.transactions?.[0]?.assessment?.conditionR ?? null, conditionU:r.transactions?.[0]?.assessment?.conditionU ?? null});
  return {p,r};
}
const normal = execute('new', current, cases[0]).r;
assert.equal(normal.evidenceStatus,'CONSISTENT');
assert.equal(normal.exitCode,0);
assert.equal(normal.transactions.length,1);
assert.equal(normal.transactions[0].assessment.conditionR,'PASS');
assert.equal(normal.transactions[0].assessment.conditionU,'FAIL');
const causalReference = causalProjection(normal);
let reproducedOldDefect = 0;
for (const c of cases) {
  const newer = c.id === 'normal' ? {r:normal,p:{status:0}} : execute('new',current,c);
  const r = newer.r;
  assert.equal(r.evidenceStatus,c.status,'new status '+c.id);
  assert.equal(r.exitCode, c.status==='CONSISTENT'?0:c.status==='INVALID_SCHEMA'?2:1,'new code '+c.id);
  assert.equal(r.input.expectedSha256,c.expectedHash||sha(c.bytes));
  assert.equal(r.input.actualSha256,sha(c.bytes),'new actual bytes hash '+c.id);
  for (const [key,val] of Object.entries({conditionU:'NOT_RUN',realExperiment:'NOT_RUN',executionAuthorization:'NOT_GRANTED',startCondition:'BLOCKED',productionWorker:'HOLD'})) assert.equal(r[key],val,key+' '+c.id);
  assert.deepEqual(r.hypotheses,{H1:'UNKNOWN',H2:'UNKNOWN',H3:'UNKNOWN',H4:'PARTIAL'});
  if(c.reason) assert(r.reasons.includes(c.reason),'reason '+c.reason+' '+c.id);
  if(c.causal) {
    assert.deepEqual(causalProjection(r), causalReference,'clock must not alter causality '+c.id);
    assert.equal(typeof r.input.semanticSha256,'string');
    assert.equal(r.transactions[0].assessment.conditionR,'PASS');
    assert.equal(r.transactions[0].assessment.conditionU,'FAIL');
  }
  if(c.status==='INVALID_SCHEMA') {
    assert.deepEqual(r.transactions, [],'invalid must not adopt tx '+c.id);
    assert.deepEqual(r.relations, [],'invalid must not adopt links '+c.id);
    assert.equal(r.input.semanticSha256,null);
  }
  if(c.unknownAxes){
    assert.equal(r.transactions[0].assessment.conditionR,'UNKNOWN');
    assert.equal(r.transactions[0].assessment.conditionU,'UNKNOWN');
  }
  if(c.oldShouldReject){
    const old=execute('old',oldCollector,c);
    assert.equal(old.r.evidenceStatus,'INVALID_SCHEMA','old RED '+c.id);
    assert.equal(old.r.exitCode,2,'old RED code '+c.id);
    reproducedOldDefect++;
  }
}
for (const id of ['normal','clock-huge-positive']) {
  const c=cases.find(c=>c.id===id);
  const r1=execute('new',current,c,1);
  const first = observations.find(o=>o.phase==='new'&&o.id===id&&!o.repeat);
  assert.equal(r1.r.evidenceStatus,first.evidenceStatus);
  assert.equal(r1.r.input.actualSha256, first.actualSha256);
  assert.equal(r1.r.input.semanticSha256, first.semanticSha256);
}
assert(reproducedOldDefect >= 7,'must dynamically reproduce several old defects');
const missing = path.join(artifact,'no-such-input.json');
const p = cp.spawnSync(process.execPath,[current,missing,baseline.materialId,'0'.repeat(64)],{encoding:'utf8',timeout:10000});
assert.equal(p.status,2); assert.equal(p.stderr,'');
const bad=JSON.parse(p.stdout);
assert.equal(bad.evidenceStatus,'INVALID_SCHEMA');
assert.equal(bad.exitCode,p.status);
assert.equal(bad.input.actualSha256,null);
assert.equal(bad.input.semanticSha256,null);
assert.deepEqual(bad.transactions,[]);
fs.writeFileSync(path.join(artifact,'new-missing-file.json'), JSON.stringify({stdout:p.stdout,stderr:p.stderr,processStatus:p.status},null,2)+'\n');
const summary = {head:fixedHead,oldHead,node:process.version,platform:process.platform,
  normalFixtureSha256:sha(normalBytes),actualCollectorSha256:sha(currentBytes),
  cases:cases.length,processRuns:observations.length+1,oldDefectsReproduced:reproducedOldDefect,
  checks:'node CLI status/hash/R-U/contract checks PASS; external result schema verification pending',
  observations};
fs.writeFileSync(path.join(artifact,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({cases:cases.length,processRuns:observations.length+1,oldDefectsReproduced:reproducedOldDefect,verdict:'CLI_ASSERTIONS_PASS'}));
