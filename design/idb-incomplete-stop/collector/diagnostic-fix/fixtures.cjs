'use strict';
// Reconstructed counterexamples. No original ZIP bytes were available.
// Expectations are defined before invoking the old or new Collector.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto');
const { single } = require('../independent/fixtures.cjs');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function base() { const d = single(); d.materialId = 'm'; return d; }
function extra(n) { const d = base(); for (let i = 0; i < n; i++) d[`k${i}`] = 0; return d; }
function definitions() {
  const rows = [];
  const add = (id, data, expected, options = {}) => rows.push({ id, bytes: Buffer.from(JSON.stringify(data)), expected: { status: 'INVALID_SCHEMA', exitCode: 2, codes: ['SCHEMA'], ...expected }, ...options });
  add('A-many-130000', extra(130000), { shortened: true, diagnostics: 256, omitted: 129745 }, { primary: true });
  const b = base(); b['x'.repeat(8192)] = 0;
  add('B-key-8192', b, { shortened: true, diagnostics: 2, omitted: 0, fieldsShortened: 1 }, { primary: true });
  add('C-errors-8193', extra(8193), { shortened: true, diagnostics: 256, omitted: 7938 }, { primary: true });
  for (const n of [255, 256, 257]) add(`count-${n}`, extra(n), { shortened: n > 256, diagnostics: Math.min(n, 256), omitted: n > 256 ? n - 255 : 0 });
  for (const n of [8190, 8191]) { const d = base(); d['x'.repeat(n)] = 0; add(`ascii-key-${n}`, d, { shortened: false, diagnostics: 1 }); }
  for (const n of [8191, 8192]) { const d = base(); d['\u{1f642}'.repeat(n)] = 0; add(`unicode-key-${n}`, d, { shortened: n === 8192, diagnostics: n === 8192 ? 2 : 1, ...(n === 8192 ? { fieldsShortened: 1 } : {}) }); }
  const combining = base(); combining['e\u0301'.repeat(4096)] = 0; add('combining-key-8192', combining, { shortened: true, diagnostics: 2, fieldsShortened: 1 });
  add('late-input-descriptor', extra(256), { shortened: true, diagnostics: 256, omitted: 2, codes: ['SCHEMA', 'INPUT_DESCRIPTOR'] }, { materialId: 'invalid material' });
  const mixed = extra(257); mixed.events[0].sourceSeq = 'invalid';
  add('mixed-structural-errors', mixed, { shortened: true, diagnostics: 256, omitted: 3 });
  const tail = base(); for (let i = 0; i < 500; i++) tail.events[0][`extra${i}`] = 0;
  tail.events[tail.events.length - 1].result = 'invalid';
  add('late-event-error', tail, { shortened: true, diagnostics: 256, omitted: 246 });
  add('long-cli-error', base(), { shortened: true, diagnostics: 2, fieldsShortened: 1, codes: ['CLI_INPUT'], rawHash: null }, { mode: 'long-path' });
  add('normal', base(), { status: 'CONSISTENT', exitCode: 0, codes: [], shortened: false, diagnostics: 0 });
  const priority = base(); priority.streams[0].lastSeq++; priority.events.find(e => e.type === 'complete_received').sendId = 'a-send';
  add('missing-plus-conflict', priority, { status: 'INCONSISTENT', exitCode: 1, codes: ['SOURCE_SEQUENCE_GAP', 'REFERENCE_MISMATCH'], shortened: false, diagnostics: 0 });
  const p3 = base(); p3.events[0].sourceMs = 2 ** 53;
  add('R2-out-of-scope-sentinel', p3, { shortened: false, diagnostics: 1 }, { disposition: 'Known R2/P3 remains unchanged; not a normative number-schema oracle' });
  return rows;
}
if (require.main === module) {
  const dir = process.argv[2]; if (fs.existsSync(dir)) throw new Error('refusing to overwrite fixtures'); fs.mkdirSync(dir, { recursive: true });
  const rows = definitions().map(({ bytes, ...r }) => { const file = `${r.id}.json.gz`; fs.writeFileSync(path.join(dir, file), zlib.gzipSync(bytes)); return { ...r, file, materialId: r.materialId || 'm', inputBytes: bytes.length, sha256: hash(bytes), provenance: 'RECONSTRUCTED_NOT_ORIGINAL' }; });
  fs.writeFileSync(path.join(dir, 'expectations.json'), JSON.stringify(rows, null, 2) + '\n'); console.log(JSON.stringify({ cases: rows.length, primary: rows.filter(r => r.primary).map(r => ({ id: r.id, bytes: r.inputBytes, sha256: r.sha256 })) }));
}
