'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn, spawnSync } = require('node:child_process');
const target = path.resolve(process.env.U1_COLLECTOR || path.join(__dirname, '../collect.cjs'));
const collector = require(target);
const targetDir = path.dirname(target);
const directory = process.env.U1_OUTPUT ? path.resolve(process.env.U1_OUTPUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'memo-u1-independent-'));
if (process.env.U1_OUTPUT) { assert(!fs.existsSync(directory), 'refusing to overwrite results'); fs.mkdirSync(directory, { recursive: true }); }
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const cases = require('./fixtures/expectations.json');
const schemaCases = require('./fixtures/schema-expectations.json');
const fixtures = path.join(__dirname, 'fixtures');
let Ajv, ajvVersion;
try { Ajv = require('ajv/dist/2020').default; ajvVersion = require('ajv/package.json').version; }
catch (e) { write('schema-validator-unavailable.json', { status: 'NOT_TESTED', reason: e.message }); }
const independent = Ajv && new Ajv({ allErrors: true, strict: true });
const schemas = { input: JSON.parse(fs.readFileSync(path.join(targetDir, 'input.schema.json'))), output: JSON.parse(fs.readFileSync(path.join(targetDir, 'result.schema.json'))) };
const compiled = independent && Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, independent.compile(schema)]));
write('environment.json', { revision: process.env.U1_REVISION || 'working-tree', node: process.version, platform: process.platform, collectorSha256: digest(fs.readFileSync(target)),
  fixtureExpectationsSha256: digest(fs.readFileSync(path.join(fixtures, 'expectations.json'))), schemaExpectationsSha256: digest(fs.readFileSync(path.join(fixtures, 'schema-expectations.json'))),
  independentValidator: independent ? { status: 'AVAILABLE', package: 'ajv', version: ajvVersion, dialect: 'Draft 2020-12', entryPoint: require.resolve('ajv/dist/2020') } : { status: 'NOT_TESTED' } });
const actual = new Map();
function safe(r) {
  assert.equal(r.realExperiment, 'NOT_RUN'); assert.equal(r.conditionU, 'NOT_RUN'); assert.equal(r.executionAuthorization, 'NOT_GRANTED'); assert.equal(r.startCondition, 'BLOCKED'); assert.equal(r.productionWorker, 'HOLD');
  assert.deepEqual(r.hypotheses, { H1: 'UNKNOWN', H2: 'UNKNOWN', H3: 'UNKNOWN', H4: 'PARTIAL' });
  for (const t of r.transactions) { assert.notEqual(t.assessment.conditionU, 'PASS'); assert.equal(t.assessment.physicalRelease, 'UNKNOWN'); assert.equal(t.assessment.connectionClosed, 'UNKNOWN'); }
}
async function exclusiveReadDenial(filename) {
  if (process.platform !== 'win32') return null;
  const script = '$f=[System.IO.File]::Open($env:U1_LOCK_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::None); [Console]::Out.WriteLine("LOCKED"); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null; $f.Dispose()';
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, U1_LOCK_FILE: filename } });
  let stderr = '', stdout = '';
  p.stderr.on('data', b => { stderr += b; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { p.kill(); reject(new Error(`exclusive open timeout: ${stderr}`)); }, 10000);
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('exit', code => { if (!stdout.includes('LOCKED')) { clearTimeout(timer); reject(new Error(`lock helper exit ${code}: ${stderr}`)); } });
    p.stdout.on('data', b => { stdout += b; if (stdout.includes('LOCKED')) { clearTimeout(timer); resolve(); } });
  });
  return async () => {
    await new Promise(resolve => { const timer = setTimeout(() => { p.kill(); resolve(); }, 3000); p.once('exit', () => { clearTimeout(timer); resolve(); }); p.stdin.end('\n'); });
    write('read-denial-method.json', { method: 'Windows FileShare.None, real OS read-open refusal; no ACL changes or mocked fs', stdout, stderr });
  };
}
for (const c of cases) test(c.id, async t => {
  const packed = fs.readFileSync(path.join(fixtures, c.file)); const bytes = c.encoding === 'gzip' ? zlib.gunzipSync(packed) : packed;
  assert.equal(digest(bytes), c.actualFixtureSha256);
  let filename = path.join(fixtures, c.file);
  if (c.encoding === 'gzip') { filename = path.join(directory, `${c.id}-expanded.json`); fs.writeFileSync(filename, bytes, { flag: 'wx' }); }
  if (c.mode === 'missing') filename = path.join(fixtures, 'intentionally-absent.json');
  let release;
  if (c.mode === 'denied') { release = await exclusiveReadDenial(filename); if (!release) { write(`${c.id}-not-tested.json`, { status: 'NOT_TESTED', reason: 'actual read denial requires Windows exclusive sharing on this fixture' }); t.skip('Windows read-denial method unavailable'); return; } }
  let child;
  try {
    const args = c.mode === 'arity' ? [] : [filename, c.mode === 'material' ? 'invalid material' : c.materialId, c.expectedSha256];
    child = spawnSync(process.execPath, [target, ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    fs.writeFileSync(path.join(directory, `${c.id}.stdout.json`), child.stdout || '', { flag: 'wx' });
    fs.writeFileSync(path.join(directory, `${c.id}.stderr.txt`), child.stderr || '', { flag: 'wx' });
    write(`${c.id}.process.json`, { status: child.status, signal: child.signal, error: child.error?.message || null, inputSha256: digest(bytes), expected: c.expected });
  } finally { if (release) await release(); }
  assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.stderr, '');
  const r = JSON.parse(child.stdout); actual.set(c.id, r);
  assert.equal(r.evidenceStatus, c.expected.status); assert.equal(r.exitCode, c.expected.exit); assert.equal(child.status, c.expected.exit); assert.equal(r.exitCode, child.status);
  for (const code of c.expected.codes) assert(r.reasons.includes(code), `${c.id}: missing reason ${code}`);
  const allCodes = [...new Set([...r.validationErrors, ...r.contradictions, ...r.missingEvidence.filter(e => e.scope === 'PUBLIC_CHAIN')].map(e => e.code))].sort();
  assert.deepEqual(r.reasons, allCodes, 'all reasons from every category must survive');
  if (c.expected.rawHash === 'null') assert.equal(r.input.actualSha256, null);
  else assert.equal(r.input.actualSha256, c.actualFixtureSha256);
  if (c.mode === 'denied') assert.match(r.validationErrors[0].detail, /EACCES|EPERM|EBUSY|denied|locked/i);
  if (c.expected.r === null) assert.equal(r.transactions.length, 0);
  else {
    assert.equal(r.transactions.length, JSON.parse(bytes).identities.length);
    for (const tx of r.transactions) { assert.equal(tx.assessment.conditionR, c.expected.r); assert.equal(tx.assessment.conditionU, c.expected.u); }
  }
  if (['INCONSISTENT'].includes(r.evidenceStatus) || c.expected.codes.some(code => ['SOURCE_SEQUENCE_GAP', 'REFERENCE_MISSING'].includes(code))) {
    for (const tx of r.transactions) assert.equal(tx.assessment.validTrace, 'FAIL');
  }
  if (compiled) assert(compiled.output(r), JSON.stringify(compiled.output.errors));
  safe(r);
  assert.equal(digest(c.encoding === 'gzip' ? zlib.gunzipSync(fs.readFileSync(path.join(fixtures, c.file))) : fs.readFileSync(path.join(fixtures, c.file))), c.actualFixtureSha256);
});
test('C-permutation-and-clock-semantic-equivalence', () => {
  const baseline = structuredClone(actual.get('C-received-before-stop'));
  const reverse = structuredClone(actual.get('C-array-reversed'));
  for (const r of [baseline, reverse]) { delete r.input.actualSha256; delete r.input.expectedSha256; }
  assert.deepEqual(reverse, baseline);
  const clocks = structuredClone(actual.get('C-clocks-exchanged')); delete clocks.input;
  const b = structuredClone(baseline); delete b.input; assert.deepEqual(clocks, b);
});
for (const c of schemaCases) test(c.id, { skip: !independent && 'Draft 2020-12 validator unavailable; NOT_TESTED' }, () => {
  const ajvValid = compiled[c.schema](c.value), builtinErrors = collector.validate(c.value, schemas[c.schema]), builtinValid = builtinErrors.length === 0;
  write(`${c.id}.json`, { expected: c.expected, independentValid: ajvValid, builtinValid, independentErrors: compiled[c.schema].errors, builtinErrors, schemaSha256: digest(fs.readFileSync(path.join(targetDir, c.schema === 'input' ? 'input.schema.json' : 'result.schema.json'))) });
  assert.equal(ajvValid, c.expected, 'independent Draft 2020-12 expectation');
  assert.equal(builtinValid, c.expected, 'built-in validator must agree with independently fixed expectation');
});
