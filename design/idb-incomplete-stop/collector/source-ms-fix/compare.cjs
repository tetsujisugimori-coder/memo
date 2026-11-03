'use strict';
// Independent post-check: actual process records + Ajv + constrained field differences.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const Ajv = require('ajv/dist/2020').default, root = path.resolve(process.argv[2]), prefix = 'design/idb-incomplete-stop/collector/';
const read = n => fs.readFileSync(path.join(root, n)), json = n => JSON.parse(read(n)), hash = b => crypto.createHash('sha256').update(b).digest('hex');
const oldCode = read('old/' + prefix + 'collect.cjs').toString(), newCode = read('new/' + prefix + 'collect.cjs').toString();
assert.equal(oldCode.slice(oldCode.indexOf('function parseData(')), newCode.slice(newCode.indexOf('function parseData(')), 'parser, R/U, identity, order and CLI remain byte-identical');
assert.equal(oldCode.slice(0, oldCode.indexOf('function validateInto(')), newCode.slice(0, newCode.indexOf('function validateInto(')), 'diagnosticCollector unchanged');
for (const file of json('fixed-source-index.json').files) {
  assert.equal(hash(read('old/' + file.path)), file.sha256);
  if (file.path !== prefix + 'collect.cjs') assert.equal(hash(read('new/' + file.path)), file.sha256);
}
const ajv = new Ajv({ strict: true, allErrors: true }), resultValid = ajv.compile(json('new/' + prefix + 'result.schema.json'));
const red = json('red-before-edit.json'); assert.equal(hash(fs.readFileSync(path.join(__dirname, 'numeric.test.cjs'))), red.testCodeSha256); assert.equal(hash(fs.readFileSync(path.join(__dirname, 'fixtures.cjs'))), red.generatorSha256);
assert.equal(hash(read('fixtures/expectations.json')), red.expectationsSha256);
const cases = json('fixtures/expectations.json'), inputChecks = [];
for (const c of cases) {
  assert.equal(hash(read('fixtures/' + c.file)), c.sha256);
  const old = json('red/' + c.id + '.inspection.json'), newer = json('green/' + c.id + '.inspection.json');
  for (const phase of ['red', 'green']) { const r = json(phase + '/' + c.id + '.stdout.json'); assert(resultValid(r)); assert.equal(r.exitCode, json(phase + '/' + c.id + '.inspection.json').processStatus); }
  assert.equal(newer.ajvInputValid, c.expected.schemaValid); assert.equal(newer.embeddedInputValid, c.expected.schemaValid);
  inputChecks.push({ id: c.id, inputSha256: c.sha256, ajv: newer.ajvInputValid, beforeEmbedded: old.embeddedInputValid, afterEmbedded: newer.embeddedInputValid });
}
const plain = r => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'input'));
const differences = []; let resultCount = cases.length * 2;
function compare(group, id, filename) {
  const before = read('regression/old/' + group + '/' + filename), after = read('regression/new/' + group + '/' + filename), a = JSON.parse(before), b = JSON.parse(after);
  assert(resultValid(a)); assert(resultValid(b)); resultCount += 2;
  const changes = [];
  function diff(x, y, at) {
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (x && y && typeof x === 'object' && typeof y === 'object') for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) diff(x[k], y[k], at + '/' + k);
    else changes.push({ field: at, before: x, after: y });
  }
  diff(a, b, ''); let classification = 'BYTE_IDENTICAL';
  if (!before.equals(after)) {
    if (id === 'R2-out-of-scope-sentinel') {
      classification = 'INTENDED_R2_CORRECTION'; assert.equal(a.evidenceStatus, 'INVALID_SCHEMA'); assert.equal(a.exitCode, 2); assert.equal(b.evidenceStatus, 'CONSISTENT'); assert.equal(b.exitCode, 0);
      assert.deepEqual(plain(b), plain(json('green/normal.stdout.json')));
    } else {
      classification = 'ENVIRONMENT_PATH_ONLY';
      assert(['A-missing', 'A-denied', 'long-cli-error', 'missing'].includes(id), `${group}/${id}`);
      assert.equal(changes.length, 1); assert.equal(changes[0].field, '/validationErrors/0/detail');
      const normalize = v => id === 'long-cli-error' ? v.replace(/open '.*nonexistent-z+\.\.\.\[truncated\]$/, "open '<output-path>...[truncated]") : v.replace(/open '[^']+'$/, "open '<isolated-path>'");
      assert.equal(normalize(changes[0].before), normalize(changes[0].after));
    }
  }
  differences.push({ group, id, classification, beforeSha256: hash(before), afterSha256: hash(after), changes });
}
for (const c of json('regression/old/regression96/comparison.json')) compare('regression96', c.output, c.output);
for (const c of json('old/' + prefix + 'independent/fixtures/expectations.json')) compare('regression69', c.id, c.id + '.stdout.json');
for (const c of json('old/' + prefix + 'diagnostic-fix/fixtures/expectations.json')) compare('regression18', c.id, c.id + '.stdout.json');
for (const c of json('old/' + prefix + 'diagnostic-fix/cli-error/fixtures/expectations.json')) {
  compare('cli16', c.id, c.id + '.stdout.json');
  for (const phase of ['old', 'new']) {
    const r = json(`regression/${phase}/cli16/${c.id}.stdout.json`), p = json(`regression/${phase}/cli16/${c.id}.inspection.json`);
    assert.equal(p.status, c.expected.exitCode); assert.equal(r.exitCode, p.status); assert.equal(r.evidenceStatus, c.expected.status);
    if (c.expected.ioFailure) { assert.equal(r.input.actualSha256, null); assert.equal(r.input.semanticSha256, null); for (const key of ['transactions', 'relations', 'orderRelations', 'missingEvidence', 'contradictions', 'unknownReasons']) assert.deepEqual(r[key], []); }
  }
}
const sentinel = 'R2-out-of-scope-sentinel';
assert.deepEqual([...read('regression/new/regression18/tests.tap').toString().matchAll(/^not ok \d+ - (.*)$/gm)].map(m => m[1]), [sentinel]);
const numeric = ['red', 'green'].map(phase => { const p = json(phase + '/process.json'); return { phase, tests: p.tests, pass: p.pass, fail: p.fail, skip: p.skipped, actualExitCode: p.actualExitCode }; });
assert.equal(numeric[0].fail, 10); assert.equal(numeric[0].actualExitCode, 1); assert.equal(numeric[1].pass, 60); assert.equal(numeric[1].actualExitCode, 0);
const numericSchemas = [];
function audit(s, at) {
  if (s && typeof s === 'object') {
    if (s.type === 'integer') { assert(s.enum || (s.minimum === 1 && s.maximum === 8192), at); numericSchemas.push({ path: at, type: s.type, minimum: s.minimum, maximum: s.maximum, enum: s.enum }); }
    if (s.type === 'number') { assert(at.endsWith('/sourceMs')); numericSchemas.push({ path: at, type: s.type }); }
    for (const [k, v] of Object.entries(s)) audit(v, at + '/' + k);
  }
}
audit(json('old/' + prefix + 'input.schema.json'), 'input'); audit(json('old/' + prefix + 'result.schema.json'), 'result');
const output = { numeric, sourceMsInputAgreement: inputChecks, outputSchemaChecks: resultCount, comparisons: Object.fromEntries(['regression96', 'regression69', 'regression18', 'cli16'].map(g => [g,
  Object.fromEntries(['BYTE_IDENTICAL', 'ENVIRONMENT_PATH_ONLY', 'INTENDED_R2_CORRECTION'].map(k => [k, differences.filter(r => r.group === g && r.classification === k).length]))])),
  originalR1SentinelFailure: 'EXPECTED_HISTORICAL_BUG_SENTINEL_NOT_CHANGED', numericSchemaInventory: numericSchemas,
  parserJudgeLogicCliAndDiagnosticsUnchanged: true, candidateCollectorSha256: hash(Buffer.from(newCode)), fixedSourcesUnchanged: true, selfVerification: 'PASS', wholePR: 'PARTIAL', mergeRecommendation: 'NO' };
for (const [name, value] of [['verification.json', output], ['output-differences.json', differences]]) fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ numeric, outputSchemaChecks: resultCount, comparisons: output.comparisons, selfVerification: output.selfVerification }));
