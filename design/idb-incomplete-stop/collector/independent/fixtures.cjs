'use strict';
// Contract-authored independently of collector code, previous fixtures and outputs.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const encode = v => Buffer.from(JSON.stringify(v, null, 2) + '\n');
function single() {
  const identity = { runId: 'negative-session', dbName: 'negative-synthetic-db', workerId: 'alpha', connectionId: 'alpha-connection', transactionId: 'transaction', iteration: 1 };
  const event = (type, source, sourceSeq, eventId, extra = {}) => ({ ...identity, type, source, sourceSeq, eventId, ...extra });
  return { schemaVersion: 1, fixtureKind: 'SYNTHETIC', materialId: 'independent-u1', planId: 'independent-negative-controls', runId: identity.runId,
    identities: [identity], streams: [{ source: 'worker', workerId: 'alpha', firstSeq: 1, lastSeq: 5 }, { source: 'main', firstSeq: 1, lastSeq: 5 }],
    events: [event('transaction_identified', 'worker', 1, 'a-identified'), event('request_accepted', 'worker', 2, 'a-accepted', { requestId: 'request', mode: 'readonly', result: 'accepted' }),
      event('send', 'worker', 3, 'a-send'), event('transaction_complete', 'worker', 4, 'a-complete'), event('complete_sent', 'worker', 5, 'a-complete-send', { completeId: 'a-complete' }),
      event('receive', 'main', 1, 'a-receive', { sendId: 'a-send' }), event('complete_received', 'main', 2, 'a-complete-receive', { sendId: 'a-complete-send' }),
      event('stop_requested', 'main', 3, 'a-stop'), event('terminate_called', 'main', 4, 'a-call'), event('terminate_returned', 'main', 5, 'a-return', { result: 'returned' })] };
}
const find = (d, type) => d.events.find(e => e.type === type);
function remove(d, ...types) {
  d.events = d.events.filter(e => !types.includes(e.type));
  for (const s of d.streams) {
    const events = d.events.filter(e => e.source === s.source && (s.source === 'main' || e.workerId === s.workerId));
    events.forEach((e, i) => { e.sourceSeq = i + 1; }); s.lastSeq = events.length;
  }
}
function gap(d) { for (const e of d.events) if (e.source === 'worker' && e.sourceSeq > 1) e.sourceSeq++; d.streams[0].lastSeq++; }
function twoWorkers(different = false) {
  const d = single(), other = { ...d.identities[0], ...(different ? { workerId: 'beta', connectionId: 'beta-connection' } : { transactionId: 'second-transaction', iteration: 2 }) };
  d.identities.push(other);
  for (const e of [...d.events]) {
    const copy = { ...e, ...other, eventId: e.eventId.replace(/^a-/, 'b-'), sourceSeq: e.sourceSeq + (e.source === 'main' || !different ? 5 : 0) };
    for (const key of ['completeId', 'sendId']) if (copy[key]) copy[key] = copy[key].replace(/^a-/, 'b-');
    d.events.push(copy);
  }
  d.streams[1].lastSeq = 10;
  if (different) d.streams.push({ source: 'worker', workerId: 'beta', firstSeq: 1, lastSeq: 5 }); else d.streams[0].lastSeq = 10;
  return d;
}
function duplicateSequence() {
  const d = twoWorkers();
  for (const e of d.events) if (e.source === 'worker' && e.eventId.startsWith('b-')) e.sourceSeq--;
  d.streams[0].lastSeq--; return d; // Dense 1..9 with only the inter-transaction boundary duplicated.
}
function definitions() {
  const list = [];
  const add = (id, group, data, status, r, u, codes = [], extra = {}) => list.push({ id, group, bytes: encode(data), expected: { status, exit: status === 'CONSISTENT' ? 0 : status === 'INVALID_SCHEMA' ? 2 : 1,
    r, u, codes, ...extra } });
  const fresh = (id, group, change, status = 'CONSISTENT', r = 'PASS', u = 'FAIL', codes = []) => { const d = single(); change(d); add(id, group, d, status, r, u, codes); };
  // A: CLI error expectations fixed before any collector invocation.
  for (const mode of ['arity', 'missing', 'denied', 'oversize', 'utf8', 'json', 'hash', 'material']) {
    const item = { id: `A-${mode}`, group: 'A', bytes: encode(single()), mode,
      expected: { status: mode === 'hash' ? 'INCONSISTENT' : 'INVALID_SCHEMA', exit: mode === 'hash' ? 1 : 2, r: mode === 'hash' ? 'UNKNOWN' : null, u: mode === 'hash' ? 'UNKNOWN' : null,
        codes: [mode === 'hash' ? 'HASH_MISMATCH' : ['arity', 'missing', 'denied'].includes(mode) ? 'CLI_INPUT' : mode === 'material' ? 'INPUT_DESCRIPTOR' : 'JSON'],
        rawHash: ['arity', 'missing', 'denied', 'oversize'].includes(mode) ? 'null' : 'full' } };
    if (mode === 'oversize') item.bytes = Buffer.alloc(2 * 1024 * 1024 + 1, 32);
    if (mode === 'utf8') item.bytes = Buffer.from([0x7b, 0xff, 0x7d]);
    if (mode === 'json') item.bytes = Buffer.from('{"broken":');
    list.push(item);
  }
  fresh('B-gap-only', 'B', gap, 'INCOMPLETE', 'UNKNOWN', 'UNKNOWN', ['SOURCE_SEQUENCE_GAP']);
  add('B-duplicate-only', 'B', duplicateSequence(), 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['SEQUENCE_COLLISION']);
  fresh('B-outside-only', 'B', d => d.streams[0].lastSeq--, 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['SEQUENCE_OUTSIDE_COVERAGE']);
  fresh('B-reference-missing', 'B', d => { find(d, 'complete_sent').completeId = 'unrecorded-event'; }, 'INCOMPLETE', 'UNKNOWN', 'UNKNOWN', ['REFERENCE_MISSING']);
  const both = duplicateSequence(); both.streams[0].lastSeq++; add('B-gap-and-duplicate', 'B', both, 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['SOURCE_SEQUENCE_GAP', 'SEQUENCE_COLLISION']);
  fresh('B-gap-and-wrong-type', 'B', d => { gap(d); find(d, 'complete_sent').completeId = 'a-send'; }, 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['SOURCE_SEQUENCE_GAP', 'REFERENCE_MISMATCH']);
  fresh('B-gap-and-foreign-transaction', 'B', d => { gap(d); find(d, 'complete_received').transactionId = 'foreign'; }, 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['SOURCE_SEQUENCE_GAP', 'FOREIGN_IDENTITY']);
  fresh('B-loss-and-terminal-conflict', 'B', d => {
    d.events.push({ ...d.identities[0], type: 'abort_observed', source: 'worker', sourceSeq: 6, eventId: 'a-abort', layer: 'LOGICAL_IDB' },
      { ...d.identities[0], type: 'collection_error', source: 'main', sourceSeq: 6, eventId: 'recorder-loss' });
    d.streams[0].lastSeq = 7; d.streams[1].lastSeq = 6;
  }, 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['SOURCE_SEQUENCE_GAP', 'COLLECTION_ERROR', 'TERMINAL_CONFLICT']);
  fresh('C-worker-complete-only', 'C', d => remove(d, 'complete_sent', 'complete_received'), 'INCOMPLETE', 'UNKNOWN', 'UNKNOWN', ['COMPLETE_SEND_MISSING']);
  fresh('C-sent-only', 'C', d => remove(d, 'complete_received'), 'INCOMPLETE', 'UNKNOWN', 'UNKNOWN', ['COMPLETE_RECEIVE_MISSING']);
  add('C-received-before-stop', 'C', single(), 'CONSISTENT', 'PASS', 'FAIL');
  fresh('C-received-after-stop', 'C', d => { find(d, 'complete_received').sourceSeq = 5; find(d, 'stop_requested').sourceSeq = 2; find(d, 'terminate_called').sourceSeq = 3; find(d, 'terminate_returned').sourceSeq = 4; }, 'CONSISTENT', 'FAIL', 'UNKNOWN');
  const wrongTx = twoWorkers(); find(wrongTx, 'complete_sent').completeId = 'b-complete'; add('C-complete-other-transaction', 'C', wrongTx, 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['REFERENCE_MISMATCH']);
  const wrongWorker = twoWorkers(true); find(wrongWorker, 'complete_received').sendId = 'b-complete-send'; add('C-send-other-worker', 'C', wrongWorker, 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['REFERENCE_MISMATCH']);
  fresh('C-incomparable-sources', 'C', d => { remove(d, 'complete_sent', 'complete_received'); d.events.reverse(); }, 'INCOMPLETE', 'UNKNOWN', 'UNKNOWN', ['COMPLETE_SEND_MISSING']);
  fresh('C-local-order-reversed', 'C', d => { find(d, 'transaction_complete').sourceSeq = 5; find(d, 'complete_sent').sourceSeq = 4; }, 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['SOURCE_ORDER_REVERSED']);
  fresh('C-array-reversed', 'C', d => d.events.reverse());
  fresh('C-clocks-exchanged', 'C', d => { for (const e of d.events) e.sourceMs = e.source === 'main' ? -500000 : 500000; });
  // Explicit prerequisites and schema/source restrictions protect the review's candidate finding.
  fresh('C-stop-prerequisite-missing', 'C', d => remove(d, 'stop_requested'), 'INCOMPLETE', 'UNKNOWN', 'UNKNOWN', ['EVENT_MISSING']);
  fresh('C-worker-event-in-main-source', 'C', d => { find(d, 'request_accepted').source = 'main'; }, 'INVALID_SCHEMA', null, null, ['SCHEMA']);
  fresh('C-main-event-in-worker-source', 'C', d => { find(d, 'stop_requested').source = 'worker'; }, 'INVALID_SCHEMA', null, null, ['SCHEMA']);
  add('D-same-worker-two-transactions', 'D', twoWorkers(), 'CONSISTENT', 'PASS', 'FAIL');
  add('D-two-workers-shared-main', 'D', twoWorkers(true), 'CONSISTENT', 'PASS', 'FAIL');
  const reused = twoWorkers(); reused.events.find(e => e.eventId === 'b-complete').eventId = 'a-complete'; add('D-event-id-reused', 'D', reused, 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['DUPLICATE_EVENT_ID']);
  fresh('D-complete-double-reference', 'D', d => { d.events.push({ ...find(d, 'complete_sent'), eventId: 'second-complete-send', sourceSeq: 6 }); d.streams[0].lastSeq = 6; }, 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['DUPLICATE_REFERENCE']);
  fresh('D-send-double-receipt', 'D', d => { d.events.push({ ...find(d, 'complete_received'), eventId: 'second-complete-receive', sourceSeq: 6 }); d.streams[1].lastSeq = 6; }, 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['DUPLICATE_REFERENCE']);
  for (const key of ['workerId', 'connectionId', 'iteration']) {
    const d = twoWorkers(true); find(d, 'complete_received')[key] = key === 'iteration' ? 2 : `foreign-${key}`;
    add(`D-foreign-${key}`, 'D', d, 'INCONSISTENT', 'UNKNOWN', 'UNKNOWN', ['FOREIGN_IDENTITY']);
  }
  return list;
}
function writeFixtures(dir) {
  if (fs.existsSync(dir)) throw new Error('refusing to overwrite fixtures');
  fs.mkdirSync(dir, { recursive: true });
  const cases = definitions().map(item => {
    const name = `${item.id}.${item.mode === 'oversize' ? 'json.gz' : 'json'}`;
    fs.writeFileSync(path.join(dir, name), item.mode === 'oversize' ? zlib.gzipSync(item.bytes) : item.bytes);
    return { id: item.id, group: item.group, mode: item.mode || 'file', file: name, encoding: item.mode === 'oversize' ? 'gzip' : 'raw', materialId: 'independent-u1',
      expectedSha256: item.mode === 'hash' ? '0'.repeat(64) : digest(item.bytes), actualFixtureSha256: digest(item.bytes), expected: item.expected };
  });
  fs.writeFileSync(path.join(dir, 'expectations.json'), JSON.stringify(cases, null, 2) + '\n'); return cases;
}
if (require.main === module) console.log(JSON.stringify({ count: writeFixtures(process.argv[2]).length }));
module.exports = { single, twoWorkers, writeFixtures };
