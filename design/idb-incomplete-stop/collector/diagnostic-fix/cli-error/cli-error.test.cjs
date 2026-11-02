'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), zlib = require('node:zlib'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const target = path.resolve(process.env.CLI_TEST_COLLECTOR || path.join(__dirname, '../../collect.cjs'));
const output = process.env.CLI_TEST_OUTPUT ? path.resolve(process.env.CLI_TEST_OUTPUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'memo-cli-fault-'));
if (process.env.CLI_TEST_OUTPUT) { assert(!fs.existsSync(output), 'never overwrite evidence'); fs.mkdirSync(output, { recursive: true }); }
fs.mkdirSync(path.join(output, 'inputs'));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const fixtureDir = path.join(__dirname, 'fixtures'), expectationsFile = path.join(fixtureDir, 'expectations.json'), shim = path.join(__dirname, 'fault-preload.cjs');
const cases = JSON.parse(fs.readFileSync(expectationsFile));
let validate, independentValidator;
try { const Ajv = require('ajv/dist/2020').default; validate = new Ajv({ strict: true, allErrors: true }).compile(require(path.join(path.dirname(target), 'result.schema.json'))); independentValidator = { name: 'ajv', version: require('ajv/package.json').version, dialect: 'Draft 2020-12' }; }
catch (e) { independentValidator = { status: 'NOT_TESTED', reason: e.message }; }
save('environment.json', { revision: process.env.CLI_TEST_REVISION || 'working-tree', node: process.version, platform: process.platform, target,
  collectorSha256: hash(fs.readFileSync(target)), expectationsSha256: hash(fs.readFileSync(expectationsFile)), faultShimSha256: hash(fs.readFileSync(shim)),
  resultSchemaSha256: hash(fs.readFileSync(path.join(path.dirname(target), 'result.schema.json'))), independentValidator,
  provenance: 'RECONSTRUCTED_JS_FS_INJECTION_REAL_NODE_AND_REAL_HASH_NOT_OS_EIO' });
for (const c of cases) test(c.id, () => {
  const packed = fs.readFileSync(path.join(fixtureDir, c.fixtureFile)), bytes = c.fixtureEncoding === 'gzip' ? zlib.gunzipSync(packed) : packed;
  assert.equal(hash(bytes), c.fixtureSha256); assert.equal(bytes.length, c.fixtureBytes);
  let file = path.join(fixtureDir, c.fixtureFile);
  if (c.fixtureEncoding === 'gzip') { file = path.join(output, 'inputs', `${c.id}.json`); fs.writeFileSync(file, bytes); }
  if (c.id === 'missing') { file = path.join(fixtureDir, 'intentionally-absent.json'); assert(!fs.existsSync(file)); }
  const args = c.id === 'arity' ? [] : [file, 'm', c.externalSha256], tracePath = path.join(output, `${c.id}.trace.json`);
  const child = spawnSync(process.execPath, ['--require', shim, target, ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, CLI_FAULT_FILE: file, CLI_FAULT_MODE: c.mode, CLI_FAULT_TRACE: tracePath } });
  fs.writeFileSync(path.join(output, `${c.id}.stdout.json`), child.stdout || '', { flag: 'wx' }); fs.writeFileSync(path.join(output, `${c.id}.stderr.txt`), child.stderr || '', { flag: 'wx' });
  let r = null, parseError = null; try { r = JSON.parse(child.stdout); } catch (e) { parseError = e.message; }
  const schemaValid = r && validate ? validate(r) : null, trace = fs.existsSync(tracePath) ? JSON.parse(fs.readFileSync(tracePath)) : null;
  save(`${c.id}.inspection.json`, { expected: c.expected, faultMode: c.mode, fixtureSha256: hash(bytes), fixtureBytes: bytes.length, externalSha256: c.externalSha256,
    status: child.status, signal: child.signal, processError: child.error?.message || null, parseError, independentSchemaValid: schemaValid, schemaErrors: validate?.errors || null,
    stdoutSha256: hash(Buffer.from(child.stdout || '')), stderrSha256: hash(Buffer.from(child.stderr || '')), actualStatus: r?.evidenceStatus || null, actualExitCode: r?.exitCode ?? null,
    actualSha256: r?.input?.actualSha256 ?? null, semanticSha256: r?.input?.semanticSha256 ?? null, transactionCount: r?.transactions?.length ?? null,
    observedR: r?.transactions?.[0]?.assessment?.conditionR || null, observedU: r?.transactions?.[0]?.assessment?.conditionU || null,
    readBytes: trace?.events.filter(e => e.type === 'read.return').reduce((n, e) => n + e.bytes, 0) ?? null, traceExitCode: trace?.processExitCode ?? null });
  assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.stderr, ''); assert.equal(parseError, null);
  assert.equal(child.status, c.expected.exitCode, 'actual process exit'); assert.equal(r.exitCode, child.status); assert.equal(r.evidenceStatus, c.expected.status);
  assert.equal(trace.processExitCode, child.status); if (validate) assert.equal(schemaValid, true, JSON.stringify(validate.errors));
  if (c.expected.code) assert(r.reasons.includes(c.expected.code)); else assert.deepEqual(r.reasons, []);
  assert.equal(r.input.actualSha256, c.expected.rawHash); assert.equal(r.input.expectedSha256, c.id === 'arity' ? null : c.externalSha256);
  const cliErrors = r.validationErrors.filter(e => e.code === 'CLI_INPUT'); assert.equal(cliErrors.length, c.expected.cliDiagnosticCount);
  for (const prefix of c.expected.errorPrefixes) assert(cliErrors.some(e => e.detail.startsWith(prefix)), `missing error ${prefix}`);
  const marker = r.validationErrors.find(e => e.code === 'DIAGNOSTICS_TRUNCATED'); assert.equal(Boolean(marker), c.expected.truncation);
  assert(r.validationErrors.length <= 256); for (const e of r.validationErrors) for (const k of ['code', 'subject', 'detail']) assert([...e[k]].length <= 8192);
  if (c.expected.status === 'CONSISTENT') { assert.equal(r.transactions.length, 1); assert.equal(r.transactions[0].assessment.conditionR, 'PASS'); assert.equal(r.transactions[0].assessment.conditionU, 'FAIL'); assert(r.input.semanticSha256); assert(r.relations.length > 0); }
  else { assert.equal(r.input.semanticSha256, null); assert.deepEqual(r.transactions, []); }
  if (c.expected.ioFailure) for (const key of ['relations', 'orderRelations', 'missingEvidence', 'contradictions', 'unknownReasons', 'transactions']) assert.deepEqual(r[key], [], `unusable input must not retain ${key}`);
  assert.equal(r.realExperiment, 'NOT_RUN'); assert.equal(r.conditionU, 'NOT_RUN'); assert.equal(r.executionAuthorization, 'NOT_GRANTED'); assert.equal(r.startCondition, 'BLOCKED'); assert.equal(r.productionWorker, 'HOLD');
  assert.deepEqual(r.hypotheses, { H1: 'UNKNOWN', H2: 'UNKNOWN', H3: 'UNKNOWN', H4: 'PARTIAL' });
  if (c.mode.startsWith('partial-read')) assert.equal(trace.events.filter(e => e.type === 'read.return').reduce((n, e) => n + e.bytes, 0), 17);
  if (c.mode === 'close' && c.fixture === 'normal') assert.equal(trace.events.filter(e => e.type === 'read.return').reduce((n, e) => n + e.bytes, 0), bytes.length);
  assert.equal(hash(c.fixtureEncoding === 'gzip' ? zlib.gunzipSync(fs.readFileSync(path.join(fixtureDir, c.fixtureFile))) : fs.readFileSync(path.join(fixtureDir, c.fixtureFile))), c.fixtureSha256);
});
