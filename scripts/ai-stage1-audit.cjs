'use strict';
// Untrusted diagnostic JSON is validated before returning metadata; never retain raw input.
const fs = require('node:fs');
const MAX_BYTES = 65536;
const COUNTS = ['durationMs','historyMessageCount','sentMessageCount','inputCharacters','receivedChunks','bodyChunks','bodyCharacters','thinkingCharacters','doneCount'];
const BOOLS = ['messageRolesTruncated','streamStarted','thinkingPresent','doneReceived','streamEndedNormally','uiApplied','staleResponse','finalized'];
const ENUMS = {
  provider: ['ollama','gemini','UNKNOWN'], purpose: ['translate','question','summarize','organize','UNKNOWN'],
  uiPurpose: ['translate','question','summarize','organize','UNKNOWN'],
  translationLanguage: ['ja','en','UNKNOWN'], uiTranslationLanguage: ['ja','en','UNKNOWN'],
  referenceMode: ['none','current-note','selected-text','specified-note','all-notes','collection','UNKNOWN'],
  errorType: ['UNKNOWN','aborted','timeout','connection','model_missing','provider','invalid_response','empty_response','stream_parse','stream_content_type','authentication','permission','rate_limit','quota_exceeded','server_error','safety_blocked','api_key_required'],
  result: ['UNKNOWN','TIMEOUT','INTERRUPTED','ERROR','STREAM_ENDED_WITHOUT_DONE','COMPLETED_WITH_TEXT','COMPLETED_EMPTY']
};
const KEYS = [...COUNTS,...BOOLS,...Object.keys(ENUMS),'requestId','startedAt','model','messageRoles','httpStatus','finalAnswerCharacters','uiCharacters'].sort();
const OBS_KEYS = ['trialId','requestId','requestSha256','directRequestSha256','model','purpose','translationLanguage','referenceMode','historyMessageCount','sentMessageCount','inputCharacters','messageRoles','bodyCharacters','thinkingCharacters','doneCount','domCharacters','visible','expectedResult'].sort();
const integer = n => Number.isSafeInteger(n) && n >= 0 && n <= 1e9;
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const exact = (o, keys) => object(o) && JSON.stringify(Object.keys(o).sort()) === JSON.stringify(keys);
const fail = code => { throw Object.assign(Error(code), { code }); };
function uniqueKeys(text) {
  // JSON.parse has already validated syntax. Track keys in each object, including escaped spellings.
  const stack = [];
  for (const token of text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || []) {
    const top = stack.at(-1);
    if (token === '{') stack.push({keys:new Set(), key:true});
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && top) top.key = true;
    else if (token.startsWith('"') && top?.key) {
      const key = JSON.parse(token); if (top.keys.has(key)) fail('DUPLICATE_KEY');
      top.keys.add(key); top.key = false;
    }
  }
}
function validateRecord(r) {
  if (!exact(r, KEYS)) fail('RECORD_FIELDS');
  if (!/^[A-Za-z0-9-]{1,128}$/.test(r.requestId) || typeof r.requestId !== 'string' ||
      typeof r.startedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.startedAt) || !Number.isFinite(Date.parse(r.startedAt)) ||
      typeof r.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(r.model)) fail('IDENTITY');
  if (COUNTS.some(k => !integer(r[k])) || BOOLS.some(k => typeof r[k] !== 'boolean') ||
      Object.entries(ENUMS).some(([k,v]) => !v.includes(r[k]))) fail('RECORD_TYPES');
  if (!Array.isArray(r.messageRoles) || r.messageRoles.length !== Math.min(128,r.sentMessageCount) ||
      r.messageRoles.some(x => !['system','user','assistant','UNKNOWN'].includes(x)) ||
      r.messageRolesTruncated !== (r.sentMessageCount > 128)) fail('ROLES');
  for (const k of ['finalAnswerCharacters','uiCharacters']) if (r[k] !== 'UNKNOWN' && !integer(r[k])) fail('RECORD_TYPES');
  if (r.httpStatus !== 'UNKNOWN' && (!Number.isInteger(r.httpStatus) || r.httpStatus < 100 || r.httpStatus > 599)) fail('HTTP');
  if (r.doneReceived !== (r.doneCount > 0) || r.thinkingPresent !== (r.thinkingCharacters > 0) ||
      ((r.streamEndedNormally || r.doneReceived || r.bodyChunks > 0) && !r.streamStarted) ||
      (r.streamStarted && (r.httpStatus === 'UNKNOWN' || r.httpStatus < 200 || r.httpStatus > 299)) ||
      (r.bodyCharacters > 0 && (!r.bodyChunks || !r.receivedChunks)) ||
      (r.uiApplied ? !integer(r.uiCharacters) : r.uiCharacters !== 'UNKNOWN') ||
      (r.finalized && !integer(r.finalAnswerCharacters))) fail('CONTRADICTION');
  if (r.finalized) {
    const expected = r.errorType === 'timeout' ? 'TIMEOUT'
      : r.errorType === 'aborted' || r.staleResponse ? 'INTERRUPTED'
      : r.errorType !== 'UNKNOWN' ? 'ERROR'
      : !r.streamEndedNormally ? 'UNKNOWN'
      : !r.doneReceived ? 'STREAM_ENDED_WITHOUT_DONE'
      : r.finalAnswerCharacters > 0 && r.bodyCharacters > 0 ? 'COMPLETED_WITH_TEXT' : 'COMPLETED_EMPTY';
    // UNKNOWN error codes can legitimately produce ERROR; never accept those as success.
    if (r.result !== expected && !(r.errorType === 'UNKNOWN' && r.result === 'ERROR')) fail('RESULT_CONTRADICTION');
  } else if (r.result !== 'UNKNOWN' || r.finalAnswerCharacters !== 'UNKNOWN') fail('UNFINALIZED');
  return r;
}
function importDiagnostics(input) {
  if (typeof input !== 'string' && !Buffer.isBuffer(input)) fail('INPUT_TYPE');
  if (Buffer.byteLength(input) > MAX_BYTES) fail('BYTE_LIMIT');
  let text, rows;
  try { text = Buffer.isBuffer(input) ? new TextDecoder('utf-8',{fatal:true}).decode(input) : input; rows = JSON.parse(text); }
  catch (_) { fail('INVALID_JSON'); }
  uniqueKeys(text);
  if (!Array.isArray(rows) || rows.length > 20) fail('RECORD_LIMIT');
  const ids = new Set();
  for (const row of rows) { validateRecord(row); if (ids.has(row.requestId)) fail('DUPLICATE_REQUEST'); ids.add(row.requestId); }
  return rows;
}
function auditApplication(input, observations) {
  const result = {evidence:'INCOMPLETE',rootCause:'UNKNOWN',authenticity:'NOT_ESTABLISHED',semanticCorrectness:'NOT_TESTED',rows:[]};
  let records;
  try { records = importDiagnostics(input); } catch (e) { return {...result,reason:e.code}; }
  if (!Array.isArray(observations) || !observations.length || observations.length > 20 || records.length !== observations.length) return {...result,reason:'MISSING_PAIR'};
  const ids = new Set(), trials = new Set();
  for (const o of observations) {
    if (!exact(o,OBS_KEYS) || typeof o.trialId !== 'string' || !/^[A-Z][A-Z0-9_-]{0,39}$/.test(o.trialId) ||
        typeof o.requestId !== 'string' || !/^[a-f0-9]{64}$/.test(o.requestSha256) || o.directRequestSha256 !== o.requestSha256 ||
        !integer(o.domCharacters) || typeof o.visible !== 'boolean' || !Array.isArray(o.messageRoles) ||
        ['historyMessageCount','sentMessageCount','inputCharacters','bodyCharacters','thinkingCharacters','doneCount'].some(k => !integer(o[k])) ||
        ids.has(o.requestId) || trials.has(o.trialId)) return {...result,reason:'PAIR_IDENTITY'};
    ids.add(o.requestId); trials.add(o.trialId);
    const r = records.find(r => r.requestId === o.requestId);
    if (!r || !r.finalized || r.provider !== 'ollama' || r.model === 'UNKNOWN' ||
        r.purpose !== r.uiPurpose || r.translationLanguage !== r.uiTranslationLanguage ||
        ['model','purpose','translationLanguage','referenceMode','historyMessageCount','sentMessageCount','inputCharacters','bodyCharacters','thinkingCharacters','doneCount'].some(k => r[k] !== o[k]) ||
        JSON.stringify(r.messageRoles) !== JSON.stringify(o.messageRoles) || r.result !== o.expectedResult ||
        (r.result === 'COMPLETED_WITH_TEXT' && (!r.uiApplied || !o.visible || r.finalAnswerCharacters !== o.domCharacters || r.uiCharacters !== o.domCharacters)) ||
        (r.result === 'COMPLETED_EMPTY' && (!r.uiApplied || o.domCharacters !== 0 || r.uiCharacters !== 0)) ||
        (!['COMPLETED_WITH_TEXT','COMPLETED_EMPTY'].includes(r.result))) return {...result,reason:'OBSERVATION_MISMATCH'};
    result.rows.push({trialId:o.trialId,requestId:r.requestId,requestSha256:o.requestSha256,result:r.result,visible:o.visible,domCharacters:o.domCharacters});
  }
  return {...result,evidence:'CONSISTENT_METADATA',reason:'OBSERVED'};
}
function readDiagnostics(file) {
  // A bounded descriptor read prevents size-check/read races and never follows a symlink.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (!fs.fstatSync(fd).isFile()) fail('INPUT_FILE');
    const b = Buffer.alloc(MAX_BYTES + 1); let size = 0, n;
    while (size < b.length && (n = fs.readSync(fd,b,size,b.length-size,null)) > 0) size += n;
    if (size > MAX_BYTES) fail('BYTE_LIMIT');
    return importDiagnostics(b.subarray(0,size));
  } finally { fs.closeSync(fd); }
}
module.exports = {importDiagnostics,auditApplication,readDiagnostics,MAX_BYTES};
if (require.main === module) {
  try { if (process.argv.length !== 3) fail('INPUT_FILE'); const rows = readDiagnostics(process.argv[2]);
    console.log(JSON.stringify({schema:'VALID',records:rows.length,authenticity:'NOT_ESTABLISHED',application:'NOT_TESTED'}));
  } catch (_) { console.error('BLOCKED: diagnostic input rejected; raw input not retained.'); process.exitCode = 1; }
}
