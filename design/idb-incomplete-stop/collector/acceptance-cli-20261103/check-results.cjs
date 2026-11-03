'use strict';
// Recheck fresh regression stdout independently; saved self-test JSON is only a comparison baseline.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { spawnSync } = require('node:child_process'), crypto = require('node:crypto');
const Ajv = require('ajv/dist/2020').default;
const root = path.resolve(process.argv[2]), repo = path.resolve(process.argv[3]), fixed = 'e4a5d414689f23e1b33660bce3e006c46fb4e37f', prefix = 'design/idb-incomplete-stop/collector/';
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const reference = name => { const p = spawnSync('git', ['cat-file', 'blob', `${fixed}:${prefix}${name}`], { cwd: repo, maxBuffer: 16 * 1024 * 1024 }); assert.equal(p.status, 0); return p.stdout; };
const read = name => fs.readFileSync(path.join(root, name)), json = name => JSON.parse(read(name));
const validate = new Ajv({ strict: true, allErrors: true }).compile(JSON.parse(read('new/' + prefix + 'result.schema.json')));
const phases = [['regression96', 96], ['regression69', 69], ['regression18', 18]], regression = [];
for (const [name, expected] of phases) {
  const process = json(`regression/${name}.process.json`), tap = read(`regression/${name}/tests.tap`).toString();
  const count = k => Number(new RegExp(`# ${k} (\\d+)`).exec(tap)?.[1]);
  assert.equal(process.actualExitCode, 0); assert.equal(process.signal, null); assert.equal(process.processError, null);
  assert.equal(count('tests'), expected); assert.equal(count('pass'), expected); assert.equal(count('fail'), 0); assert.equal(count('skipped'), 0);
  regression.push({ name, tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped'), actualExitCode: process.actualExitCode, command: process.command, tapSha256: hash(Buffer.from(tap)) });
}
const comparisons = [];
function compare(group, id, oldBytes, newBytes, allowedDetail = false) {
  const newJSON = JSON.parse(newBytes); assert(validate(newJSON), JSON.stringify(validate.errors));
  const byteIdentical = oldBytes.equals(newBytes); let differences = [];
  if (!byteIdentical) {
    const a = JSON.parse(oldBytes), b = JSON.parse(newBytes);
    function diff(x, y, at) {
      if (JSON.stringify(x) === JSON.stringify(y)) return;
      if (x && y && typeof x === 'object' && typeof y === 'object') for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) diff(x[k], y[k], `${at}/${k}`);
      else differences.push({ field: at, before: x, after: y });
    }
    diff(a, b, ''); assert(allowedDetail, `${group}/${id}: unexpected difference`);
    assert.equal(differences.length, 1); assert.equal(differences[0].field, '/validationErrors/0/detail');
    const before = differences[0].before, after = differences[0].after;
    if (['A-denied', 'A-missing'].includes(id)) {
      const file = id === 'A-denied' ? 'A-denied.json' : 'intentionally-absent.json';
      assert(before.includes(file) && after.includes(file));
      assert.equal(before.replace(/open '[^']+'$/, "open '<isolated-input-path>'"), after.replace(/open '[^']+'$/, "open '<isolated-input-path>'"));
    } else {
      assert.equal(id, 'long-cli-error'); assert(before.includes('nonexistent-') && after.includes('nonexistent-'));
      assert.equal(before.replace(/open '.*nonexistent-z+\.\.\.\[truncated\]$/, "open '<output-directory-path>...[truncated]"), after.replace(/open '.*nonexistent-z+\.\.\.\[truncated\]$/, "open '<output-directory-path>...[truncated]"));
    }
  }
  comparisons.push({ group, id, byteIdentical, oldSha256: hash(oldBytes), newSha256: hash(newBytes), differences, interpretation: byteIdentical ? 'IDENTICAL' : 'ENVIRONMENT_PATH_ONLY' });
}
for (const c of JSON.parse(reference('records/self-check/comparison.json'))) compare('40', c.fixture, reference('records/self-check/' + c.output), read('regression/regression96/' + c.output));
for (const c of JSON.parse(read('new/' + prefix + 'independent/fixtures/expectations.json'))) compare('37', c.id, reference('independent/records/after/' + c.id + '.stdout.json'), read('regression/regression69/' + c.id + '.stdout.json'), ['A-denied', 'A-missing'].includes(c.id));
for (const c of JSON.parse(read('new/' + prefix + 'diagnostic-fix/fixtures/expectations.json'))) {
  const bytes = read('regression/regression18/' + c.id + '.stdout.json'), r = JSON.parse(bytes), process = json('regression/regression18/' + c.id + '.inspection.json');
  assert.equal(process.status, c.expected.exitCode); assert.equal(r.exitCode, process.status); assert.equal(r.evidenceStatus, c.expected.status);
  assert(r.validationErrors.length <= 256); for (const e of r.validationErrors) for (const k of ['code', 'subject', 'detail']) assert([...e[k]].length <= 8192);
  if (c.primary) { assert(r.reasons.includes('DIAGNOSTICS_TRUNCATED')); assert(r.validationErrors.some(e => e.code === 'DIAGNOSTICS_TRUNCATED')); }
  if (c.id === 'late-input-descriptor') { assert(r.reasons.includes('INPUT_DESCRIPTOR')); assert(r.reasons.includes('SCHEMA')); }
  compare('18', c.id, reference('diagnostic-fix/records/after/' + c.id + '.stdout.json'), bytes, c.id === 'long-cli-error');
}
const prepared = json('prepared.json');
for (const item of prepared.files) assert.equal(hash(read(item.root + '/' + item.path)), item.sha256);
const old = read('old/' + prefix + 'collect.cjs'), newer = read('new/' + prefix + 'collect.cjs'), split = b => b.toString().split('function runCli(args) {')[0];
assert.equal(split(old), split(newer));
assert(newer.toString().includes('} else result = collectEvidence(bytes,'));
assert(newer.toString().includes('if (diagnostics.invalid)'));
const env = json('dynamic-final/environment.json'), source = fs.readFileSync(path.join(__dirname, 'accept.cjs'));
assert.equal(hash(source), env.acceptanceCodeSha256);
const groups = Object.fromEntries(['40', '37', '18'].map(g => [g, { count: comparisons.filter(c => c.group === g).length, byteIdentical: comparisons.filter(c => c.group === g && c.byteIdentical).length, pathOnly: comparisons.filter(c => c.group === g && !c.byteIdentical).length }]));
const result = { fixedTarget: fixed, freshRegression: regression, comparisons: groups, allFixedSourcesUnchanged: true, preRunCliBytesIdentical: true,
  rootCause: 'new CLI failure branch constructs an unadopted error result; collectEvidence is only called in the no-error else branch', R2P3: 'UNRESOLVED_UNCHANGED' };
fs.writeFileSync(path.join(root, 'regression-check.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(root, 'output-comparisons.json'), JSON.stringify(comparisons, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ regression: regression.map(r => ({ name: r.name, pass: r.pass, fail: r.fail, skip: r.skipped, exit: r.actualExitCode })), comparisons: groups }));
