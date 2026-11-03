'use strict';
// Contract-first expectations. Does not load Collector or derive expectations from results.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const source = path.join(__dirname, '../diagnostic-fix/cli-error/fixtures/normal.json');
const normal = fs.readFileSync(source), base = JSON.parse(normal), hash = b => crypto.createHash('sha256').update(b).digest('hex');
const rows = [];
function add(id, data, schemaValid, status = schemaValid ? 'CONSISTENT' : 'INVALID_SCHEMA', options = {}) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data) + '\n');
  rows.push({ id, bytes, expected: { schemaValid, status, exitCode: status === 'CONSISTENT' ? 0 : status === 'INVALID_SCHEMA' ? 2 : 1,
    code: schemaValid ? status === 'INCOMPLETE' ? 'SOURCE_SEQUENCE_GAP' : null : 'SCHEMA', ...options } });
}
function fresh() { return structuredClone(base); }
add('normal', normal, true);
const values = [0, 1.5, -0.5, 1e-6, 9007199254740992, -9007199254740992, 1e20, -1e20, 1e308, -1e308, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE];
for (let i = 0; i < values.length; i++) { const d = fresh(); for (const e of d.events) e.sourceMs = values[i]; add(`sourceMs-finite-${i}`, d, true, 'CONSISTENT', { sameCausality: true, numberText: String(values[i]) }); }
const mixed = fresh(); mixed.events.forEach((e, i) => { e.sourceMs = i % 2 ? 1e308 : -1e308; }); mixed.events.reverse();
add('sourceMs-mixed-clocks-reversed-array', mixed, true, 'CONSISTENT', { sameCausality: true });
for (const [name, value] of [['string', '1e20'], ['true', true], ['false', false], ['null', null], ['array', []], ['object', {}]]) {
  const d = fresh(); d.events[0].sourceMs = value; add('sourceMs-invalid-' + name, d, false);
}
for (const [name, token, code] of [['positive-overflow', '1e309', 'SCHEMA'], ['negative-overflow', '-1e309', 'SCHEMA'], ['nan-token', 'NaN', 'JSON'], ['infinity-token', 'Infinity', 'JSON']]) {
  const d = fresh(); d.events[0].sourceMs = 'NUMERIC_TOKEN';
  add('sourceMs-' + name, Buffer.from(JSON.stringify(d).replace('"NUMERIC_TOKEN"', token) + '\n'), false, 'INVALID_SCHEMA', { code, parseable: code !== 'JSON' });
}
for (const value of [1, 8192]) {
  const d = fresh(); d.identities[0].iteration = value; for (const e of d.events) e.iteration = value;
  add('iteration-valid-' + value, d, true);
}
add('sourceSeq-valid-1', fresh(), true);
const seqMax = fresh(); seqMax.events.find(e => e.type === 'complete_sent').sourceSeq = 8192; seqMax.streams[0].lastSeq = 8192;
add('sourceSeq-valid-8192-with-coverage-gap', seqMax, true, 'INCOMPLETE');
for (const field of ['sourceSeq', 'iteration']) for (const [name, value] of [['zero', 0], ['above-max', 8193], ['fraction', 1.5], ['negative-fraction', -0.5], ['unsafe-integer', 9007199254740992], ['huge', 1e20], ['extreme', 1e308], ['string', '1'], ['null', null]]) {
  const d = fresh(); d.events[0][field] = value; if (field === 'iteration') d.identities[0].iteration = value;
  add(field + '-invalid-' + name, d, false);
}
if (require.main === module) {
  const output = path.resolve(process.argv[2]); if (fs.existsSync(output)) throw new Error('never overwrite fixtures'); fs.mkdirSync(output, { recursive: true });
  const result = rows.map(({ bytes, ...c }) => { fs.writeFileSync(path.join(output, c.id + '.json'), bytes); return { ...c, file: c.id + '.json', bytes: bytes.length, sha256: hash(bytes), materialId: base.materialId }; });
  fs.writeFileSync(path.join(output, 'expectations.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ cases: result.length, normalInputSha256: hash(normal) }));
}
