'use strict';
// New acceptance oracle: never imports Collector or reads prior PASS/TAP/summary files.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), zlib = require('node:zlib'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const Ajv = require('ajv/dist/2020').default;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const root = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
if (fs.existsSync(output)) throw new Error('refusing to overwrite acceptance evidence'); fs.mkdirSync(output, { recursive: true });
const prefix = 'design/idb-incomplete-stop/collector';
const common = path.join(root, 'new', prefix, 'diagnostic-fix/cli-error');
const shim = path.join(common, 'fault-preload.cjs'), expectationsFile = path.join(common, 'fixtures/expectations.json');
const cases = JSON.parse(fs.readFileSync(expectationsFile)), prepared = JSON.parse(fs.readFileSync(path.join(root, 'prepared.json')));
const save = (name, obj) => fs.writeFileSync(path.join(output, name), JSON.stringify(obj, null, 2) + '\n', { flag: 'wx' });
// These contracts are fixed from CLI admission rules, independently of saved expected/output objects.
const oracle = {
  normal: ['none', 'normal', 'CONSISTENT', 0, []],
  'short-read-success': ['short-success', 'normal', 'CONSISTENT', 0, []],
  open: ['open', 'normal', 'INVALID_SCHEMA', 2, ['EIO injected open failure']],
  read: ['read', 'normal', 'INVALID_SCHEMA', 2, ['EIO injected read failure']],
  'partial-read': ['partial-read', 'normal', 'INVALID_SCHEMA', 2, ['EIO injected read failure']],
  close: ['close', 'normal', 'INVALID_SCHEMA', 2, ['EIO injected close failure']],
  'read-close': ['read-close', 'normal', 'INVALID_SCHEMA', 2, ['EIO injected read failure', 'EIO injected close failure']],
  'partial-read-close': ['partial-read-close', 'normal', 'INVALID_SCHEMA', 2, ['EIO injected read failure', 'EIO injected close failure']],
  'close-wrong-hash': ['close', 'normal', 'INVALID_SCHEMA', 2, ['EIO injected close failure']],
  'close-invalid-json': ['close', 'invalid', 'INVALID_SCHEMA', 2, ['EIO injected close failure']],
  arity: ['none', 'normal', 'INVALID_SCHEMA', 2, ['usage: node collect.cjs']],
  missing: ['none', 'normal', 'INVALID_SCHEMA', 2, ['ENOENT']],
  oversize: ['none', 'oversize', 'INVALID_SCHEMA', 2, []],
  'long-open-error': ['open-long', 'normal', 'INVALID_SCHEMA', 2, ['EIO injected open failure']],
  'read-long-close': ['read-long-close', 'normal', 'INVALID_SCHEMA', 2, ['EIO injected read failure', 'EIO injected close failure']],
  'invalid-json': ['none', 'invalid', 'INVALID_SCHEMA', 2, []]
};
if (JSON.stringify(Object.keys(oracle).sort()) !== JSON.stringify(cases.map(c => c.id).sort())) throw new Error('case list differs from fixed 16-condition contract');
save('oracle.json', oracle);
for (const item of prepared.files) if (hash(fs.readFileSync(path.join(root, item.root, item.path))) !== item.sha256) throw new Error(`fixed source changed: ${item.path}`);
const oldSchema = fs.readFileSync(path.join(root, 'old', prefix, 'result.schema.json')), newSchema = fs.readFileSync(path.join(root, 'new', prefix, 'result.schema.json'));
if (!oldSchema.equals(newSchema)) throw new Error('schema differs between fixed heads');
const validate = new Ajv({ strict: true, allErrors: true }).compile(JSON.parse(newSchema));
save('environment.json', { old: prepared.old, new: prepared.new, node: process.version, executable: process.execPath, platform: process.platform, osRelease: os.release(), architecture: os.arch(),
  command: [process.execPath, __filename, root, output], acceptanceCodeSha256: hash(fs.readFileSync(__filename)),
  validator: { name: 'ajv', version: require('ajv/package.json').version, dialect: 'Draft 2020-12', entrySha256: hash(fs.readFileSync(require.resolve('ajv/dist/2020'))) },
  expectationsSha256: hash(fs.readFileSync(expectationsFile)), injectionSha256: hash(fs.readFileSync(shim)), resultSchemaSha256: hash(newSchema),
  scope: 'fresh real Node children with fixed JS fs fault injection; real crypto; not real OS close/EIO' });
const all = {};
for (const label of ['old', 'new']) {
  const dir = path.join(output, label); fs.mkdirSync(dir); fs.mkdirSync(path.join(dir, 'inputs')); all[label] = [];
  for (const c of cases) {
    const [mode, fixture, status, exitCode, messages] = oracle[c.id], io = messages.length > 0, long = ['long-open-error', 'read-long-close'].includes(c.id);
    if (c.mode !== mode || c.fixture !== fixture || c.expected.status !== status || c.expected.exitCode !== exitCode || c.expected.ioFailure !== io || c.expected.cliDiagnosticCount !== messages.length || JSON.stringify(c.expected.errorPrefixes) !== JSON.stringify(messages)) throw new Error(`fixed expectation/oracle disagreement: ${c.id}`);
    const packed = fs.readFileSync(path.join(common, 'fixtures', c.fixtureFile)), bytes = c.fixtureEncoding === 'gzip' ? zlib.gunzipSync(packed) : packed;
    if (hash(bytes) !== c.fixtureSha256 || bytes.length !== c.fixtureBytes) throw new Error(`fixture changed: ${c.id}`);
    let filename = path.join(common, 'fixtures', c.fixtureFile);
    if (c.fixtureEncoding === 'gzip') { filename = path.join(dir, 'inputs', c.id + '.json'); fs.writeFileSync(filename, bytes); }
    if (c.id === 'missing') filename = path.join(common, 'fixtures/intentionally-absent.json');
    const traceFile = path.join(dir, c.id + '.trace.json'), target = path.join(root, label, prefix, 'collect.cjs');
    const args = c.id === 'arity' ? [] : [filename, 'm', c.externalSha256];
    const command = [process.execPath, '--require', shim, target, ...args];
    const child = spawnSync(command[0], command.slice(1), { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, CLI_FAULT_FILE: filename, CLI_FAULT_MODE: mode, CLI_FAULT_TRACE: traceFile } });
    fs.writeFileSync(path.join(dir, c.id + '.stdout.json'), child.stdout || ''); fs.writeFileSync(path.join(dir, c.id + '.stderr.txt'), child.stderr || '');
    let r = null, parseError = null; try { r = JSON.parse(child.stdout); } catch (e) { parseError = e.message; }
    const schemaValid = r !== null && validate(r), schemaErrors = validate.errors;
    const trace = fs.existsSync(traceFile) ? JSON.parse(fs.readFileSync(traceFile)) : null, errors = [];
    const check = (field, actual, expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push({ field, actual, expected }); };
    check('processError', child.error?.message || null, null); check('signal', child.signal, null); check('stderr', child.stderr, ''); check('singleJSON', parseError, null); check('schema', schemaValid, true);
    check('realExit', child.status, exitCode); check('status', r?.evidenceStatus, status); check('jsonExit', r?.exitCode, exitCode); check('jsonVsRealExit', r?.exitCode, child.status);
    check('traceExit', trace?.processExitCode, child.status);
    if (r) {
      const normal = status === 'CONSISTENT', code = io ? 'CLI_INPUT' : normal ? null : 'JSON', expectedReasons = [code, long ? 'DIAGNOSTICS_TRUNCATED' : null].filter(Boolean).sort();
      check('reasonCodes', r.reasons, expectedReasons);
      const cliErrors = r.validationErrors.filter(e => e.code === 'CLI_INPUT'); check('cliDiagnosticCount', cliErrors.length, messages.length);
      for (const message of messages) check(`diagnostic:${message}`, cliErrors.some(e => e.detail.startsWith(message)), true);
      check('truncationVisible', r.validationErrors.some(e => e.code === 'DIAGNOSTICS_TRUNCATED'), long);
      check('diagnosticCountBound', r.validationErrors.length <= 256, true);
      check('diagnosticTextBound', r.validationErrors.every(e => ['code', 'subject', 'detail'].every(k => [...e[k]].length <= 8192)), true);
      check('rawHash', r.input.actualSha256, io || fixture === 'oversize' ? null : hash(bytes));
      check('externalHash', r.input.expectedSha256, c.id === 'arity' ? null : c.externalSha256);
      if (normal) {
        check('transactionCount', r.transactions.length, 1); check('R', r.transactions[0]?.assessment.conditionR, 'PASS'); check('U', r.transactions[0]?.assessment.conditionU, 'FAIL');
        check('semanticHashPresent', /^[0-9a-f]{64}$/.test(r.input.semanticSha256), true);
        const links = r.relations.map(e => `${e.from}>${e.to}`).sort(); check('normalLinks', links, ['a-send>a-receive', 'a-complete>a-complete-send', 'a-complete-send>a-complete-receive'].sort());
      } else { check('semanticHash', r.input.semanticSha256, null); check('transactions', r.transactions, []); }
      if (io) for (const k of ['relations', 'orderRelations', 'missingEvidence', 'contradictions', 'unknownReasons']) check(`noAdopted:${k}`, r[k], []);
      for (const [k, v] of Object.entries({ conditionU: 'NOT_RUN', realExperiment: 'NOT_RUN', executionAuthorization: 'NOT_GRANTED', startCondition: 'BLOCKED', productionWorker: 'HOLD' })) check(k, r[k], v);
      check('hypotheses', r.hypotheses, { H1: 'UNKNOWN', H2: 'UNKNOWN', H3: 'UNKNOWN', H4: 'PARTIAL' });
    }
    const events = trace?.events || [], totalRead = events.filter(e => e.type === 'read.return').reduce((n, e) => n + e.bytes, 0);
    if (mode.startsWith('partial-read')) check('partialBytesExactly17', totalRead, 17);
    if (mode === 'close') { check('allBytesBeforeCloseFailure', totalRead, bytes.length); check('EOFBeforeCloseFailure', events.some(e => e.type === 'read.return' && e.bytes === 0), true); }
    for (const stage of ['open', 'read', 'close']) if (messages.some(message => message.startsWith(`EIO injected ${stage}`))) check(`injectionOccurred:${stage}`, events.some(e => e.type === `${stage}.throw` && e.injected === true), true);
    const record = { id: c.id, mode, fixtureSha256: hash(bytes), collectorSha256: hash(fs.readFileSync(target)), command, faultEnvironment: { CLI_FAULT_FILE: filename, CLI_FAULT_MODE: mode, CLI_FAULT_TRACE: traceFile },
      expected: { status, exitCode, io, messages }, actual: { processExit: child.status, jsonExit: r?.exitCode, status: r?.evidenceStatus, schemaValid, rawHash: r?.input.actualSha256, semanticHash: r?.input.semanticSha256,
        transactions: r?.transactions.length, R: r?.transactions[0]?.assessment.conditionR || null, cliErrors: r?.validationErrors.filter(e => e.code === 'CLI_INPUT').length, readBytes: totalRead },
      schemaErrors, stdoutSha256: hash(Buffer.from(child.stdout || '')), stderrSha256: hash(Buffer.from(child.stderr || '')), violations: errors, pass: errors.length === 0 };
    fs.writeFileSync(path.join(dir, c.id + '.judgement.json'), JSON.stringify(record, null, 2) + '\n'); all[label].push(record);
  }
}
const oldFailures = all.old.filter(r => !r.pass).map(r => r.id).sort(), expectedOldFailures = ['close', 'read-close', 'partial-read-close', 'close-wrong-hash', 'read-long-close'].sort();
const newFailures = all.new.filter(r => !r.pass).map(r => r.id);
const equal = cases.filter(c => !expectedOldFailures.includes(c.id)).every(c => fs.readFileSync(path.join(output, 'old', c.id + '.stdout.json')).equals(fs.readFileSync(path.join(output, 'new', c.id + '.stdout.json'))));
const unchangedFiles = prepared.files.every(item => hash(fs.readFileSync(path.join(root, item.root, item.path))) === item.sha256);
for (const label of ['old', 'new']) {
  const rows = all[label], tap = ['TAP version 13', ...rows.map((r, i) => `${r.pass ? 'ok' : 'not ok'} ${i + 1} - ${r.id}`), `1..${rows.length}`, `# tests ${rows.length}`, `# pass ${rows.filter(r => r.pass).length}`, `# fail ${rows.filter(r => !r.pass).length}`];
  fs.writeFileSync(path.join(output, label, 'contract-checks.tap'), tap.join('\n') + '\n');
}
const passed = JSON.stringify(oldFailures) === JSON.stringify(expectedOldFailures) && newFailures.length === 0 && equal && unchangedFiles;
const summary = { old: { executed: 16, pass: 16 - oldFailures.length, fail: oldFailures.length, failedCases: oldFailures }, new: { executed: 16, pass: 16 - newFailures.length, fail: newFailures.length, failedCases: newFailures },
  unchanged11OutputBytes: equal, fixedSourcesUnchanged: unchangedFiles, schemaOld: all.old.filter(r => r.actual.schemaValid).length, schemaNew: all.new.filter(r => r.actual.schemaValid).length,
  P2DynamicAcceptance: passed ? 'PASS' : 'FAIL', scope: 'fixed CLI JS fault model; not real OS close/EIO', actualRunnerExit: passed ? 0 : 1 };
save('summary.json', summary); console.log(JSON.stringify(summary)); process.exitCode = passed ? 0 : 1;
