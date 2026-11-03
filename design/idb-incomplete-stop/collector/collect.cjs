'use strict';
// Offline data processing. No runner, browser, Worker, IDB or network imports.
const crypto = require('node:crypto');
const { judgeTrace } = require('../judge.cjs');
const inputSchema = require('./input.schema.json');
const resultSchema = require('./result.schema.json');
const MAX_BYTES = 2 * 1024 * 1024;
const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}(?![\s\S])/.test(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}(?![\s\S])/.test(value);
const identityKeys = ['runId', 'dbName', 'workerId', 'connectionId', 'transactionId', 'iteration'];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, function (_key, v) {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v;
});
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const identityOf = e => Object.fromEntries(identityKeys.map(k => [k, e[k]]));
const txKey = e => canonical(identityOf(e));
const streamKey = e => e.source === 'main' ? 'main' : `worker:${e.workerId}`;

// Display budgets do not stop validation or discard undisplayed reason codes.
const MAX_DIAGNOSTICS = 256, MAX_DIAGNOSTIC_TEXT = 8192;
function diagnosticCollector() {
  const records = [], codes = new Set();
  let total = 0, shortened = 0;
  function text(value) {
    const prefix = []; let length = 0;
    for (const character of value) {
      if (length++ === MAX_DIAGNOSTIC_TEXT) {
        shortened++;
        return prefix.slice(0, MAX_DIAGNOSTIC_TEXT - '...[truncated]'.length).join('') + '...[truncated]';
      }
      prefix.push(character);
    }
    return value;
  }
  return {
    codes,
    get invalid() { return total !== 0; },
    add(code, subject, detail) {
      total++; codes.add(code);
      if (records.length < MAX_DIAGNOSTICS) records.push({ code, subject: text(subject), detail: text(detail) });
    },
    finish() {
      const result = records.slice();
      if (total > records.length || shortened) {
        if (result.length === MAX_DIAGNOSTICS) result.pop();
        const reasonCodes = [...codes].filter(code => code !== 'DIAGNOSTICS_TRUNCATED').sort().join(',');
        result.push({ code: 'DIAGNOSTICS_TRUNCATED', subject: '', detail: `diagnostics omitted=${total - result.length}; fields shortened=${shortened}; reason codes=${reasonCodes}` });
        codes.add('DIAGNOSTICS_TRUNCATED');
      }
      return result;
    }
  };
}

// A bounded validator for the fixed schemas shipped beside this module.
// Not a general JSON Schema implementation; no input-supplied schema is executed.
function validate(value, schema, root = schema, path = '', depth = 0) {
  const diagnostics = diagnosticCollector();
  validateInto(value, schema, root, path, depth, diagnostics);
  return diagnostics.finish();
}
function validateInto(value, schema, root, path, depth, diagnostics) {
  const fail = (detail, subject = path) => { diagnostics?.add('SCHEMA', subject, detail); return false; };
  if (depth > 32) return fail('maximum nesting depth exceeded');
  if (schema.$ref) return validateInto(value, root.$defs[schema.$ref.slice(8)], root, path, depth + 1, diagnostics);
  if (schema.oneOf) {
    // Validity-only probes allocate no diagnostics. Only the selected failure is recorded.
    const matches = schema.oneOf.filter(s => validateInto(value, s, root, path, depth + 1, null));
    if (matches.length === 1) return true;
    // Show precise field errors when a known event discriminant exists.
    const variant = schema.oneOf.find(s => s.properties?.type?.enum?.includes(value?.type));
    return variant ? validateInto(value, variant, root, path, depth + 1, diagnostics) : fail('no unique supported variant');
  }
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  // Integer is a schema constraint on numbers, not a reason to impose safe-integer limits on all numbers.
  if (!types.some(t => t === type || (t === 'integer' && type === 'number' && Number.isInteger(value)))) return fail('invalid type');
  let valid = true;
  if (schema.enum && !schema.enum.includes(value)) valid = fail('unsupported value');
  if (typeof value === 'string') {
    const length = [...value].length; // JSON Schema counts Unicode code points, not UTF-16 code units.
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) valid = fail('invalid length');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) valid = fail('invalid identifier/hash');
  }
  if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) valid = fail('invalid numeric range');
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return fail('invalid item count');
    for (let i = 0; i < value.length; i++) {
      valid = validateInto(value[i], schema.items, root, `${path}/${i}`, depth + 1, diagnostics) && valid;
      if (!valid && !diagnostics) return false;
    }
  } else if (type === 'object') {
    for (const k of schema.required || []) if (!Object.hasOwn(value, k)) {
      valid = fail('required field missing', `${path}/${k}`);
      if (!diagnostics) return false;
    }
    for (const k of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, k)) valid = fail('unexpected field', `${path}/${k}`);
      else valid = validateInto(value[k], schema.properties[k], root, `${path}/${k}`, depth + 1, diagnostics) && valid;
      if (!valid && !diagnostics) return false;
    }
  }
  return valid;
}

function parseData(bytes) {
  if (bytes.length > MAX_BYTES) throw new Error('input exceeds 2 MiB');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text); // Data only; never eval/import input.
  // JSON.parse accepts repeated keys. Scan the valid JSON grammar to reject overwrites.
  let i = 0;
  const space = () => { while (/\s/.test(text[i] || '') && i < text.length) i++; };
  function quoted() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
    throw new Error('unterminated string');
  }
  function scan(depth) {
    if (depth > 32) throw new Error('maximum JSON depth exceeded');
    space();
    if (text[i] === '"') { quoted(); return; }
    if (text[i] === '{') {
      i++; space(); const keys = new Set();
      if (text[i] === '}') { i++; return; }
      while (i < text.length) {
        space(); const key = quoted();
        if (keys.has(key)) throw new Error('duplicate JSON key');
        keys.add(key); space(); i++; scan(depth + 1); space();
        if (text[i++] === '}') return;
      }
    } else if (text[i] === '[') {
      i++; space();
      if (text[i] === ']') { i++; return; }
      while (i < text.length) { scan(depth + 1); space(); if (text[i++] === ']') return; }
    } else {
      const match = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
      if (!match) throw new Error('unsupported JSON token');
      i += match[0].length;
    }
  }
  scan(0);
  return value;
}

function collectEvidence(bytes, options = {}) {
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const out = {
    collectorSchemaVersion: 1, scope: 'OFFLINE_SYNTHETIC_ONLY', evidenceStatus: 'INVALID_SCHEMA', exitCode: 2,
    input: { materialId: typeof options.materialId === 'string' ? options.materialId.slice(0, 128) : '', actualSha256: sha256(bytes),
      expectedSha256: validHash(options.expectedSha256) ? options.expectedSha256 : null, semanticSha256: null },
    relations: [], orderRelations: [], missingEvidence: [], contradictions: [], validationErrors: [], reasons: [], unknownReasons: [], transactions: [],
    realExperiment: 'NOT_RUN', executionAuthorization: 'NOT_GRANTED', startCondition: 'BLOCKED', conditionU: 'NOT_RUN', productionWorker: 'HOLD',
    hypotheses: { H1: 'UNKNOWN', H2: 'UNKNOWN', H3: 'UNKNOWN', H4: 'PARTIAL' }
  };
  const validation = diagnosticCollector();
  let recordInvalid = false;
  const conflict = (code, subject, detail) => { recordInvalid = true; out.contradictions.push({ code, subject, detail }); };
  const missing = (code, subject, detail, invalid = false, scope = 'PUBLIC_CHAIN') => {
    recordInvalid ||= invalid; out.missingEvidence.push({ code, subject, detail, scope });
  };
  function finish() {
    out.validationErrors = validation.finish();
    for (const k of ['relations', 'orderRelations', 'missingEvidence', 'contradictions', 'validationErrors']) {
      out[k].sort((a, b) => compare(canonical(a), canonical(b)));
    }
    out.evidenceStatus = out.validationErrors.length ? 'INVALID_SCHEMA' : out.contradictions.length ? 'INCONSISTENT'
      : out.missingEvidence.some(e => e.scope === 'PUBLIC_CHAIN') ? 'INCOMPLETE' : 'CONSISTENT';
    out.exitCode = out.evidenceStatus === 'INVALID_SCHEMA' ? 2 : out.evidenceStatus === 'CONSISTENT' ? 0 : 1;
    out.reasons = [...new Set([...validation.codes, ...out.contradictions.map(e => e.code), ...out.missingEvidence.filter(e => e.scope === 'PUBLIC_CHAIN').map(e => e.code)])].sort();
    out.unknownReasons = [...new Set([...out.missingEvidence.filter(e => e.scope === 'FUTURE_WITNESS').map(e => e.code),
      ...out.transactions.flatMap(t => ['R', 'U'].filter(axis => t.assessment[`condition${axis}`] === 'UNKNOWN').map(axis => `${t.identity.transactionId}:${axis}:${t.assessment[`conditionReason${axis}`]}`))])].sort();
    return out;
  }
  let data;
  try { data = parseData(bytes); } catch (e) { validation.add('JSON', '', e.message); return finish(); }
  validateInto(data, inputSchema, inputSchema, '', 0, validation);
  if (!out.input.expectedSha256 || !validId(options.materialId)) validation.add('INPUT_DESCRIPTOR', '/input', 'material ID and external lowercase SHA-256 are required');
  if (validation.invalid) return finish();
  const sorted = a => [...a].sort((x, y) => compare(canonical(x), canonical(y)));
  out.input.semanticSha256 = sha256(canonical({ ...data, identities: sorted(data.identities), streams: sorted(data.streams), events: sorted(data.events) }));
  if (out.input.actualSha256 !== out.input.expectedSha256) conflict('HASH_MISMATCH', data.materialId, 'input bytes differ from the external expected hash');
  if (data.materialId !== options.materialId) conflict('MATERIAL_MISMATCH', data.materialId, 'external material ID does not match');

  const identities = new Map(), streams = new Map(), byId = new Map(), ambiguous = new Set();
  for (const identity of sorted(data.identities)) {
    const key = txKey(identity);
    if (identity.runId !== data.runId) conflict('FOREIGN_SESSION', key, 'identity belongs to another run');
    if (identities.has(key)) conflict('DUPLICATE_IDENTITY', key, 'duplicate transaction identity');
    identities.set(key, identity);
  }
  for (const stream of sorted(data.streams)) {
    const key = streamKey(stream);
    if (streams.has(key)) conflict('DUPLICATE_STREAM', key, 'duplicate source coverage');
    streams.set(key, stream);
    if (stream.source === 'worker' && !data.identities.some(t => t.workerId === stream.workerId)) conflict('FOREIGN_STREAM', key, 'worker absent from transaction inventory');
  }
  for (const key of new Set(['main', ...data.identities.map(t => `worker:${t.workerId}`)])) {
    if (!streams.has(key)) missing('SOURCE_COVERAGE_MISSING', key, 'source coverage not declared', true);
  }
  for (const e of sorted(data.events)) {
    if (byId.has(e.eventId)) { conflict('DUPLICATE_EVENT_ID', e.eventId, 'event ID reused; no occurrence selected'); ambiguous.add(e.eventId); }
    else byId.set(e.eventId, e);
    if (e.runId !== data.runId) conflict('FOREIGN_SESSION', e.eventId, 'event from another run');
    if (!identities.has(txKey(e))) conflict('FOREIGN_IDENTITY', e.eventId, 'event absent from declared transaction inventory');
    if (!streams.has(streamKey(e))) missing('SOURCE_COVERAGE_MISSING', e.eventId, 'event source coverage absent', true);
  }
  for (const id of ambiguous) byId.delete(id);
  const events = [...byId.values()].sort((a, b) => compare(a.eventId, b.eventId));
  for (const [key, stream] of streams) {
    const local = events.filter(e => streamKey(e) === key).sort((a, b) => a.sourceSeq - b.sourceSeq || compare(a.eventId, b.eventId));
    const seqs = new Set();
    for (const e of local) {
      if (seqs.has(e.sourceSeq)) conflict('SEQUENCE_COLLISION', e.eventId, 'same source sequence reused');
      seqs.add(e.sourceSeq);
      if (e.sourceSeq > stream.lastSeq) conflict('SEQUENCE_OUTSIDE_COVERAGE', e.eventId, 'event outside declared range');
    }
    // Summarize gaps rather than expanding a possibly large range into output objects.
    const gaps = []; let begin = null;
    for (let seq = 1; seq <= stream.lastSeq + 1; seq++) {
      if (seq <= stream.lastSeq && !seqs.has(seq)) { if (begin === null) begin = seq; }
      else if (begin !== null) { gaps.push(`${begin}-${seq - 1}`); begin = null; }
    }
    if (gaps.length) missing('SOURCE_SEQUENCE_GAP', key, `${gaps.length} gap ranges: ${gaps.slice(0, 64).join(',')}${gaps.length > 64 ? ',... (range preview truncated)' : ''}`, true);
    for (let i = 1; i < local.length; i++) if (local[i - 1].sourceSeq < local[i].sourceSeq) out.orderRelations.push({ before: local[i - 1].eventId, after: local[i].eventId, basis: 'source-sequence' });
  }
  const linkUse = new Set();
  for (const e of events) {
    const field = e.type === 'complete_sent' ? 'completeId' : ['receive', 'complete_received'].includes(e.type) ? 'sendId' : null;
    if (!field) continue;
    const expectedType = e.type === 'complete_sent' ? 'transaction_complete' : e.type === 'receive' ? 'send' : 'complete_sent';
    const used = `${e.type}:${e[field]}`;
    if (linkUse.has(used)) conflict('DUPLICATE_REFERENCE', e.eventId, 'same completion/send consumed more than once');
    linkUse.add(used);
    const parent = byId.get(e[field]);
    if (!parent) { missing('REFERENCE_MISSING', e.eventId, `${field}:${e[field]}`, true); continue; }
    if (parent.type !== expectedType || txKey(parent) !== txKey(e)) { conflict('REFERENCE_MISMATCH', e.eventId, 'parent has wrong type or transaction identity'); continue; }
    if (e.type === 'complete_sent' && parent.sourceSeq >= e.sourceSeq) { conflict('SOURCE_ORDER_REVERSED', e.eventId, 'complete must precede its send in worker sequence'); continue; }
    out.relations.push({ from: parent.eventId, to: e.eventId, kind: field === 'completeId' ? 'complete-send' : 'send-receive' });
    out.orderRelations.push({ before: parent.eventId, after: e.eventId, basis: field === 'completeId' ? 'complete-reference' : 'explicit-message' });
  }
  const grouped = new Map();
  for (const [key, identity] of identities) {
    const local = events.filter(e => txKey(e) === key); grouped.set(key, local);
    const types = new Map();
    for (const e of local) {
      if (types.has(e.type)) conflict('DUPLICATE_EVENT_TYPE', e.eventId, 'profile allows one event of each type per transaction');
      else types.set(e.type, e);
      if (e.type === 'collection_error') conflict('COLLECTION_ERROR', e.eventId, 'collection reported an error');
    }
    for (const type of ['transaction_identified', 'request_accepted', 'send', 'receive', 'stop_requested', 'terminate_called', 'terminate_returned']) {
      if (!types.has(type)) missing('EVENT_MISSING', key, type);
    }
    const identified = types.get('transaction_identified'), accepted = types.get('request_accepted');
    for (const e of local.filter(e => e.source === 'worker' && e.type !== 'transaction_identified')) {
      if (identified && identified.sourceSeq >= e.sourceSeq) conflict('SOURCE_ORDER_REVERSED', e.eventId, 'worker event precedes transaction identification');
      if (accepted && ['transaction_complete', 'transaction_abort', 'commit_observed', 'abort_observed'].includes(e.type) && accepted.sourceSeq >= e.sourceSeq) conflict('SOURCE_ORDER_REVERSED', e.eventId, 'terminal evidence precedes request acceptance');
    }
    for (const [a, b] of [['transaction_identified', 'request_accepted'], ['request_accepted', 'send'], ['transaction_identified', 'transaction_complete'], ['receive', 'stop_requested'], ['stop_requested', 'terminate_called'], ['terminate_called', 'terminate_returned']]) {
      const first = types.get(a), second = types.get(b);
      if (first && second && first.sourceSeq >= second.sourceSeq) conflict('SOURCE_ORDER_REVERSED', key, `${a} must precede ${b}`);
    }
    if (types.has('transaction_complete') && !types.has('complete_sent')) missing('COMPLETE_SEND_MISSING', key, 'Worker completion alone has no main causal edge');
    if (types.has('complete_sent') && !types.has('complete_received')) missing('COMPLETE_RECEIVE_MISSING', key, 'sending does not prove receipt');
    const commit = types.has('commit_observed'), abort = types.has('abort_observed');
    if ((commit || types.has('transaction_complete')) && (abort || types.has('transaction_abort'))) conflict('TERMINAL_CONFLICT', key, 'commit/complete conflicts with abort of the same transaction');
    if (!commit && !abort) missing('INTERNAL_TERMINAL_UNKNOWN', key, 'no logical-IDB commit/abort result; listener delivery is a different boundary', false, 'FUTURE_WITNESS');
    missing('ACTUAL_STOP_BOUNDARY_MISSING', key, 'terminate return is not actual stop', false, 'FUTURE_WITNESS');
    missing('NORMAL_UNTERMINATED_WITNESS_MISSING', key, 'independent normal interval and internal ID/build binding unavailable', false, 'FUTURE_WITNESS');
  }
  // One invalid source/identity/link taints the material: never cherry-pick a PASS subset.
  for (const [key, identity] of identities) {
    const local = grouped.get(key);
    const normalized = ['worker', 'main'].flatMap(source => local.filter(e => e.source === source).sort((a, b) => a.sourceSeq - b.sourceSeq));
    const judged = judgeTrace({ identity, events: normalized, profile: 'public-observation-v1' });
    const assessment = Object.fromEntries(['validTrace', 'conditionR', 'conditionU', 'conditionReasonR', 'conditionReasonU', 'workerObservation', 'connectionClosed', 'physicalRelease'].map(k => [k, judged[k]]));
    if (recordInvalid) Object.assign(assessment, { validTrace: 'FAIL', conditionR: 'UNKNOWN', conditionU: 'UNKNOWN', conditionReasonR: 'INVALID_TRACE', conditionReasonU: 'INVALID_TRACE' });
    else if (local.some(e => e.type === 'abort_observed')) Object.assign(assessment, { conditionR: 'FAIL', conditionU: 'FAIL', conditionReasonR: 'ABNORMAL', conditionReasonU: 'ABNORMAL' });
    out.transactions.push({ identity, assessment });
  }
  return finish();
}

function runCli(args) {
  const fs = require('node:fs');
  let bytes = Buffer.alloc(0);
  const diagnostics = diagnosticCollector();
  try {
    if (args.length !== 3) throw new Error('usage: node collect.cjs INPUT.json MATERIAL_ID EXPECTED_SHA256');
    const fd = fs.openSync(args[0], 'r');
    try { const buffer = Buffer.alloc(MAX_BYTES + 1); let length = 0, n;
      while (length < buffer.length && (n = fs.readSync(fd, buffer, length, buffer.length - length, null))) length += n;
      bytes = buffer.subarray(0, length);
    } catch (e) { diagnostics.add('CLI_INPUT', '', e.message); }
    finally {
      try { fs.closeSync(fd); } catch (e) { diagnostics.add('CLI_INPUT', '', e.message); }
    }
  } catch (e) { diagnostics.add('CLI_INPUT', '', e.message); }
  let result;
  if (diagnostics.invalid) {
    // Failed CLI acquisition cannot supply adopted bytes, hashes, links or R/U assessments.
    const validationErrors = diagnostics.finish();
    result = {
      collectorSchemaVersion: 1, scope: 'OFFLINE_SYNTHETIC_ONLY', evidenceStatus: 'INVALID_SCHEMA', exitCode: 2,
      input: { materialId: typeof args[1] === 'string' ? args[1].slice(0, 128) : '', actualSha256: null,
        expectedSha256: validHash(args[2]) ? args[2] : null, semanticSha256: null },
      relations: [], orderRelations: [], missingEvidence: [], contradictions: [], validationErrors,
      reasons: [...diagnostics.codes].sort(), unknownReasons: [], transactions: [],
      realExperiment: 'NOT_RUN', executionAuthorization: 'NOT_GRANTED', startCondition: 'BLOCKED', conditionU: 'NOT_RUN', productionWorker: 'HOLD',
      hypotheses: { H1: 'UNKNOWN', H2: 'UNKNOWN', H3: 'UNKNOWN', H4: 'PARTIAL' }
    };
  } else result = collectEvidence(bytes, { materialId: args[1], expectedSha256: args[2] });
  if (bytes.length > MAX_BYTES) result.input.actualSha256 = null; // A prefix is not the hash of the whole file.
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.exitCode;
}
if (require.main === module) runCli(process.argv.slice(2));
module.exports = { collectEvidence, validate, sha256, canonical, inputSchema, resultSchema };
