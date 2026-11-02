'use strict';
// Native open-error control with exactly the same argv. No fs/hash mocks.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
if (!process.argv[2] || !process.argv[3]) throw new Error('supply a new result directory and fixed old collector');
const output = path.resolve(process.argv[2]); if (fs.existsSync(output)) throw new Error('never overwrite results'); fs.mkdirSync(output, { recursive: true });
const hash = b => crypto.createHash('sha256').update(b).digest('hex'), fixture = fs.readFileSync(path.join(__dirname, 'fixtures/normal.json'));
const filename = path.join(__dirname, 'fixtures', 'nonexistent-' + 'z'.repeat(9000)), args = [filename, 'm', hash(fixture)];
const metadata = [], results = [];
for (const [label, target] of [['before', path.resolve(process.argv[3])], ['after', path.resolve(__dirname, '../../collect.cjs')]]) {
  const p = spawnSync(process.execPath, [target, ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  fs.writeFileSync(path.join(output, `${label}.stdout.json`), p.stdout); fs.writeFileSync(path.join(output, `${label}.stderr.txt`), p.stderr);
  assert.ifError(p.error); assert.equal(p.status, 2); assert.equal(p.stderr, ''); const r = JSON.parse(p.stdout);
  assert.equal(r.evidenceStatus, 'INVALID_SCHEMA'); assert.equal(r.exitCode, p.status); assert(r.reasons.includes('CLI_INPUT')); assert(r.reasons.includes('DIAGNOSTICS_TRUNCATED'));
  assert.equal(r.input.actualSha256, null); assert.equal(r.input.semanticSha256, null); assert.deepEqual(r.transactions, []);
  results.push(p.stdout); metadata.push({ label, collectorSha256: hash(fs.readFileSync(target)), exitCode: p.status, stdoutSha256: hash(Buffer.from(p.stdout)) });
}
assert.equal(results[0], results[1]);
fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify({ scope: 'native open refusal from same overlong nonexistent filename; not an OS close-error experiment', fixtureSha256: hash(fixture), sameArgv: true, byteIdentical: true, results: metadata }, null, 2) + '\n');
console.log(JSON.stringify({ sameArgv: true, byteIdentical: true, beforeExit: 2, afterExit: 2 }));
