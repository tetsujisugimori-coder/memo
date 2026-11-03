'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), zlib = require('node:zlib'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const target = path.resolve(process.env.DIAG_COLLECTOR || path.join(__dirname, '../collect.cjs'));
const output = process.env.DIAG_OUTPUT ? path.resolve(process.env.DIAG_OUTPUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'memo-diagnostics-'));
if (process.env.DIAG_OUTPUT) { assert(!fs.existsSync(output), 'never overwrite evidence'); fs.mkdirSync(output, { recursive: true }); }
fs.mkdirSync(path.join(output, 'inputs'));
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const expectationsFile = path.join(__dirname, 'fixtures/expectations.json');
const cases = JSON.parse(fs.readFileSync(expectationsFile));
let compile, validator;
try { const Ajv = require('ajv/dist/2020').default; compile = new Ajv({ strict: true, allErrors: true }).compile(require(path.join(path.dirname(target), 'result.schema.json'))); validator = { name: 'ajv', version: require('ajv/package.json').version, dialect: 'Draft 2020-12' }; }
catch (e) { validator = { status: 'NOT_TESTED', reason: e.message }; }
save('environment.json', { target, revision: process.env.DIAG_REVISION || 'working-tree', node: process.version, collectorSha256: digest(fs.readFileSync(target)),
  expectationsSha256: digest(fs.readFileSync(expectationsFile)), resultSchemaSha256: digest(fs.readFileSync(path.join(path.dirname(target), 'result.schema.json'))), independentValidator: validator,
  provenance: 'RECONSTRUCTED_NOT_ORIGINAL', originalArchive: 'memo405-independent-review-20261103.zip unavailable via Library; no original-hash claim' });
function guards(r) {
  assert.equal(r.conditionU, 'NOT_RUN'); assert.equal(r.realExperiment, 'NOT_RUN'); assert.equal(r.executionAuthorization, 'NOT_GRANTED'); assert.equal(r.startCondition, 'BLOCKED'); assert.equal(r.productionWorker, 'HOLD');
  assert.deepEqual(r.hypotheses, { H1: 'UNKNOWN', H2: 'UNKNOWN', H3: 'UNKNOWN', H4: 'PARTIAL' });
}
for (const c of cases) test(c.id, () => {
  const bytes = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', c.file))); assert.equal(bytes.length, c.inputBytes); assert.equal(digest(bytes), c.sha256); assert(bytes.length <= 2 * 1024 * 1024);
  const file = path.join(output, 'inputs', `${c.id}.json`); fs.writeFileSync(file, bytes, { flag: 'wx' });
  const filename = c.mode === 'long-path' ? path.join(output, 'nonexistent-' + 'z'.repeat(9000)) : file;
  const child = spawnSync(process.execPath, [target, filename, c.materialId, c.sha256], { encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  fs.writeFileSync(path.join(output, `${c.id}.stdout.json`), child.stdout || '', { flag: 'wx' }); fs.writeFileSync(path.join(output, `${c.id}.stderr.txt`), child.stderr || '', { flag: 'wx' });
  let result = null, parseError = null;
  try { result = JSON.parse(child.stdout); } catch (e) { parseError = e.message; }
  const schemaValid = result && compile ? compile(result) : null;
  save(`${c.id}.inspection.json`, { expected: c.expected, inputBytes: bytes.length, inputSha256: digest(bytes), status: child.status, signal: child.signal, processError: child.error?.message || null,
    stdoutBytes: Buffer.byteLength(child.stdout || ''), stdoutSha256: digest(Buffer.from(child.stdout || '')), stderrSha256: digest(Buffer.from(child.stderr || '')), parseError,
    independentSchemaValid: schemaValid, schemaErrors: compile?.errors || null, actualStatus: result?.evidenceStatus || null, actualExitCode: result?.exitCode ?? null,
    diagnosticCount: result?.validationErrors?.length ?? null, marker: result?.validationErrors?.find(e => e.code === 'DIAGNOSTICS_TRUNCATED') || null });
  assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.status, c.expected.exitCode, 'real process exit');
  assert.equal(child.stderr, ''); assert.equal(parseError, null, 'one valid JSON result');
  assert.equal(result.evidenceStatus, c.expected.status); assert.equal(result.exitCode, child.status);
  if (compile) assert.equal(schemaValid, true, JSON.stringify(compile.errors));
  for (const code of c.expected.codes) assert(result.reasons.includes(code), `reason code ${code} must survive display bounds`);
  assert.equal(result.validationErrors.length, c.expected.diagnostics);
  const marker = result.validationErrors.find(e => e.code === 'DIAGNOSTICS_TRUNCATED');
  assert.equal(Boolean(marker), c.expected.shortened, 'omission/shortening must be explicit');
  if (marker) {
    assert(result.reasons.includes('DIAGNOSTICS_TRUNCATED'));
    if (c.expected.omitted !== undefined) assert.match(marker.detail, new RegExp(`omitted=${c.expected.omitted}(?:;|$)`));
    if (c.expected.fieldsShortened !== undefined) assert.match(marker.detail, new RegExp(`fields shortened=${c.expected.fieldsShortened}(?:;|$)`));
  }
  for (const d of result.validationErrors) for (const key of ['code', 'subject', 'detail']) assert([...d[key]].length <= 8192);
  if (c.expected.rawHash === null) assert.equal(result.input.actualSha256, null); else assert.equal(result.input.actualSha256, c.sha256);
  if (c.expected.status === 'INVALID_SCHEMA') assert.equal(result.transactions.length, 0);
  if (c.id === 'normal') { assert.equal(result.transactions[0].assessment.conditionR, 'PASS'); assert.equal(result.transactions[0].assessment.conditionU, 'FAIL'); }
  if (c.id === 'missing-plus-conflict') for (const t of result.transactions) { assert.equal(t.assessment.validTrace, 'FAIL'); assert.equal(t.assessment.conditionR, 'UNKNOWN'); assert.equal(t.assessment.conditionU, 'UNKNOWN'); }
  guards(result); assert.equal(digest(fs.readFileSync(file)), c.sha256);
});
