'use strict';
// Reproduce only offline synthetic checks. Refuse to overwrite a saved run.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const output = process.argv[2] && path.resolve(process.argv[2]);
if (!output || fs.existsSync(output)) throw new Error('supply a new output directory; existing evidence is never overwritten');
fs.mkdirSync(output, { recursive: true });
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const cases = require('./fixtures/cases.json');
function execute(args, env = process.env) {
  const p = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env, timeout: 60000, windowsHide: true });
  assert.ifError(p.error); assert.equal(p.signal, null); return p;
}
const files = ['judge.test.cjs', 'conditions.test.cjs', 'merge-order.test.cjs', 'collector/collect.test.cjs'].map(f => `design/idb-incomplete-stop/${f}`);
const tests = execute(['--test', '--test-reporter=tap', ...files], { ...process.env, STATIC_JUDGE_BASELINE: '0' });
fs.writeFileSync(path.join(output, 'tests.tap'), tests.stdout);
fs.writeFileSync(path.join(output, 'tests.stderr.txt'), tests.stderr);
assert.equal(tests.status, 0);
const negative = execute(['--test', '--test-reporter=tap', 'design/idb-incomplete-stop/merge-order.test.cjs'], { ...process.env, STATIC_JUDGE_BASELINE: '1' });
fs.writeFileSync(path.join(output, 'negative-control.tap'), negative.stdout);
fs.writeFileSync(path.join(output, 'negative-control.stderr.txt'), negative.stderr);
assert.equal(negative.status, 1); assert.match(negative.stdout, /# fail 1/);
const comparison = [];
for (const c of cases) {
  const filename = path.join(__dirname, 'fixtures', c.file), input = fs.readFileSync(filename), before = hash(input);
  const child = execute([path.join(__dirname, 'collect.cjs'), filename, c.name, c.expectedSha256]);
  const result = JSON.parse(child.stdout);
  assert.equal(child.status, c.expected.exitCode); assert.equal(result.exitCode, child.status); assert.equal(result.evidenceStatus, c.expected.status);
  if (c.expected.code) assert(result.reasons.includes(c.expected.code));
  if (c.expected.conditionR !== null) for (const t of result.transactions) {
    assert.equal(t.assessment.validTrace, c.expected.validTrace); assert.equal(t.assessment.conditionR, c.expected.conditionR); assert.equal(t.assessment.conditionU, c.expected.conditionU);
  }
  assert.equal(child.stderr, ''); assert.equal(hash(fs.readFileSync(filename)), before);
  const name = `${c.name}-result.json`; fs.writeFileSync(path.join(output, name), child.stdout);
  comparison.push({ fixture: c.file, category: c.category, expected: c.expected, inputSha256: before, expectedInputSha256: c.expectedSha256,
    output: name, outputSha256: hash(Buffer.from(child.stdout)), semanticSha256: result.input.semanticSha256, actualExitCode: child.status, status: result.evidenceStatus });
}
const summary = { scope: 'OFFLINE_SYNTHETIC_ONLY', node: process.version, commands: { tests: [process.execPath, '--test', '--test-reporter=tap', ...files], negativeControl: 'STATIC_JUDGE_BASELINE=1 node --test --test-reporter=tap design/idb-incomplete-stop/merge-order.test.cjs' },
  tests: Number(/# tests (\d+)/.exec(tests.stdout)[1]), pass: Number(/# pass (\d+)/.exec(tests.stdout)[1]), fail: Number(/# fail (\d+)/.exec(tests.stdout)[1]), exitCode: tests.status,
  negativeControl: { expectedExitCode: 1, actualExitCode: negative.status }, fixtureCLI: { count: comparison.length, pass: comparison.length, fail: 0 },
  realExperiment: 'NOT_RUN', executionAuthorization: 'NOT_GRANTED', startCondition: 'BLOCKED', conditionU: 'NOT_RUN', productionWorker: 'HOLD', hypotheses: { H1: 'UNKNOWN', H2: 'UNKNOWN', H3: 'UNKNOWN', H4: 'PARTIAL' } };
fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(comparison, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
