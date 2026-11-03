'use strict';
// Fixed before fault execution. Reconstructed JS-fs fault conditions, not an OS EIO claim.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto');
const { single } = require('../../independent/fixtures.cjs');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
if (require.main === module) {
  const dir = process.argv[2]; if (!dir || fs.existsSync(dir)) throw new Error('supply a new fixture directory'); fs.mkdirSync(dir, { recursive: true });
  const data = single(); data.materialId = 'm';
  const inputs = { normal: Buffer.from(JSON.stringify(data)), invalid: Buffer.from('{invalid'), oversize: Buffer.alloc(2 * 1024 * 1024 + 1, 32) };
  fs.writeFileSync(path.join(dir, 'normal.json'), inputs.normal); fs.writeFileSync(path.join(dir, 'invalid.json'), inputs.invalid); fs.writeFileSync(path.join(dir, 'oversize.json.gz'), zlib.gzipSync(inputs.oversize));
  const rows = [];
  function add(id, mode, fixture = 'normal', options = {}) {
    const ioFailure = ['open', 'read', 'partial-read', 'close', 'read-close', 'partial-read-close', 'open-long', 'read-long-close'].includes(mode) || ['arity', 'missing'].includes(id);
    const status = ioFailure || fixture !== 'normal' ? 'INVALID_SCHEMA' : 'CONSISTENT';
    const messages = [];
    if (['open', 'open-long'].includes(mode)) messages.push('EIO injected open failure');
    if (['read', 'partial-read', 'read-close', 'partial-read-close', 'read-long-close'].includes(mode)) messages.push('EIO injected read failure');
    if (['close', 'read-close', 'partial-read-close', 'read-long-close'].includes(mode)) messages.push('EIO injected close failure');
    if (id === 'arity') messages.push('usage: node collect.cjs');
    if (id === 'missing') messages.push('ENOENT');
    rows.push({ id, mode, fixture, fixtureFile: fixture === 'oversize' ? 'oversize.json.gz' : `${fixture}.json`, fixtureEncoding: fixture === 'oversize' ? 'gzip' : 'raw',
      fixtureBytes: inputs[fixture].length, fixtureSha256: hash(inputs[fixture]), externalSha256: options.wrongHash ? '0'.repeat(64) : hash(inputs[fixture]),
      expected: { status, exitCode: status === 'CONSISTENT' ? 0 : 2, ioFailure, code: ioFailure ? 'CLI_INPUT' : status === 'CONSISTENT' ? null : 'JSON',
        errorPrefixes: messages, cliDiagnosticCount: messages.length, truncation: mode.includes('long'), rawHash: ioFailure || fixture === 'oversize' ? null : hash(inputs[fixture]),
        conditionR: status === 'CONSISTENT' ? 'PASS' : null, conditionU: status === 'CONSISTENT' ? 'FAIL' : null }, ...options });
  }
  add('normal', 'none'); add('short-read-success', 'short-success');
  add('open', 'open'); add('read', 'read'); add('partial-read', 'partial-read'); add('close', 'close');
  add('read-close', 'read-close'); add('partial-read-close', 'partial-read-close');
  add('close-wrong-hash', 'close', 'normal', { wrongHash: true }); add('close-invalid-json', 'close', 'invalid');
  add('arity', 'none'); add('missing', 'none'); add('oversize', 'none', 'oversize');
  add('long-open-error', 'open-long'); add('read-long-close', 'read-long-close'); add('invalid-json', 'none', 'invalid');
  fs.writeFileSync(path.join(dir, 'expectations.json'), JSON.stringify(rows, null, 2) + '\n'); console.log(JSON.stringify({ cases: rows.length, normalBytes: inputs.normal.length, normalSha256: hash(inputs.normal) }));
}
