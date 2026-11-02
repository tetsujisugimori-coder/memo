'use strict';
// Draft 2020-12 expectations, authored without invoking either validator.
const fs = require('node:fs');
const { single } = require('./fixtures.cjs');
function output() {
  return { collectorSchemaVersion: 1, scope: 'OFFLINE_SYNTHETIC_ONLY', evidenceStatus: 'CONSISTENT', exitCode: 0,
    input: { materialId: 'independent-u1', actualSha256: 'a'.repeat(64), expectedSha256: 'a'.repeat(64), semanticSha256: null },
    relations: [], orderRelations: [], missingEvidence: [], contradictions: [], validationErrors: [], reasons: [], unknownReasons: [],
    transactions: [{ identity: single().identities[0], assessment: { validTrace: 'PASS', conditionR: 'PASS', conditionU: 'FAIL', conditionReasonR: 'COMPLETED_BEFORE_STOP', conditionReasonU: 'COMPLETED_BEFORE_STOP', workerObservation: 'PASS', connectionClosed: 'UNKNOWN', physicalRelease: 'UNKNOWN' } }],
    realExperiment: 'NOT_RUN', executionAuthorization: 'NOT_GRANTED', startCondition: 'BLOCKED', conditionU: 'NOT_RUN', productionWorker: 'HOLD',
    hypotheses: { H1: 'UNKNOWN', H2: 'UNKNOWN', H3: 'UNKNOWN', H4: 'PARTIAL' } };
}
function definitions() {
  const cases = [];
  const add = (schema, id, expected, change = () => {}) => { const value = schema === 'input' ? single() : output(); change(value); cases.push({ id: `E-${schema}-${id}`, schema, expected, value }); };
  add('input', 'normal', true);
  add('input', 'wrong-type', false, d => { d.schemaVersion = '1'; });
  add('input', 'unknown-field', false, d => { d.extra = true; });
  add('input', 'oneOf-worker-without-owner', false, d => { delete d.streams[0].workerId; });
  add('input', 'oneOf-main-with-worker-owner', false, d => { d.streams[1].workerId = 'alpha'; });
  add('input', 'oneOf-source-mismatch', false, d => { d.events[0].source = 'main'; });
  add('input', 'oneOf-valid-error-worker', true, d => { d.events[0].type = 'collection_error'; });
  add('input', 'oneOf-valid-error-main', true, d => { d.events[0].type = 'collection_error'; d.events[0].source = 'main'; });
  add('input', 'invalid-enum', false, d => { d.fixtureKind = 'REAL'; });
  add('input', 'integer-low', false, d => { d.events[0].sourceSeq = 0; });
  add('input', 'integer-high', false, d => { d.events[0].sourceSeq = 8193; });
  add('input', 'integer-fraction', false, d => { d.events[0].sourceSeq = 1.5; });
  add('input', 'empty-id', false, d => { d.events[0].eventId = ''; });
  add('input', 'id-max', true, d => { d.events[0].eventId = 'a'.repeat(128); });
  add('input', 'id-too-long', false, d => { d.events[0].eventId = 'a'.repeat(129); });
  add('input', 'id-final-newline', false, d => { d.events[0].eventId += '\n'; });
  add('input', 'numeric-clock', true, d => { d.events[0].sourceMs = -0.25; });
  add('output', 'normal', true);
  add('output', 'wrong-type', false, d => { d.exitCode = '0'; });
  add('output', 'unknown-field', false, d => { d.granted = true; });
  add('output', 'invalid-enum', false, d => { d.conditionU = 'PASS'; });
  add('output', 'invalid-assessment-enum', false, d => { d.transactions[0].assessment.conditionU = 'PASS'; });
  add('output', 'integer-enum-high', false, d => { d.exitCode = 3; });
  add('output', 'integer-fraction', false, d => { d.exitCode = 0.5; });
  add('output', 'string-too-long', false, d => { d.reasons = ['a'.repeat(8193)]; });
  add('output', 'string-max', true, d => { d.reasons = ['a'.repeat(8192)]; });
  add('output', 'unicode-length-valid', true, d => { d.validationErrors = [{ code: 'CLI_INPUT', subject: '', detail: '\u{1f642}'.repeat(5000) }]; });
  add('output', 'unicode-length-invalid', false, d => { d.validationErrors = [{ code: 'CLI_INPUT', subject: '', detail: '\u{1f642}'.repeat(8193) }]; });
  add('output', 'hash-final-newline', false, d => { d.input.actualSha256 += '\n'; });
  add('output', 'transaction-id-final-newline', false, d => { d.transactions[0].identity.transactionId += '\n'; });
  add('output', 'nullable-hash', true, d => { d.input.actualSha256 = null; d.input.expectedSha256 = null; });
  return cases;
}
if (require.main === module) {
  const cases = definitions(); fs.writeFileSync(process.argv[2], JSON.stringify(cases, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ count: cases.length }));
}
module.exports = { definitions };
