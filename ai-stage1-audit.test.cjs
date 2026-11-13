'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createStore} = require('./ai-diagnostics');
const {importDiagnostics,auditApplication,readDiagnostics,MAX_BYTES} = require('./scripts/ai-stage1-audit.cjs');
function record() {
  const s = createStore(); const h = s.begin({provider:'ollama',model:'fixture-model',purpose:'question',uiPurpose:'question',translationLanguage:'ja',uiTranslationLanguage:'ja',referenceMode:'none',historyMessageCount:0,messages:[{role:'user',content:'synthetic'}]});
  h.observe('http',{status:200}); h.observe('stream-start'); h.observe('chunk'); h.observe('body',{characters:1}); h.observe('done'); h.observe('stream-end'); h.ui(1); h.finish({characters:1});
  const r=s.snapshot()[0];s.clear();return r;
}
function observation(r) { return {trialId:'A_01',requestId:r.requestId,requestSha256:'a'.repeat(64),directRequestSha256:'a'.repeat(64),model:r.model,purpose:r.purpose,translationLanguage:r.translationLanguage,referenceMode:r.referenceMode,historyMessageCount:r.historyMessageCount,sentMessageCount:r.sentMessageCount,inputCharacters:r.inputCharacters,messageRoles:r.messageRoles,bodyCharacters:r.bodyCharacters,thinkingCharacters:r.thinkingCharacters,doneCount:r.doneCount,domCharacters:1,visible:true,expectedResult:'COMPLETED_WITH_TEXT'}; }
test('real producer schema roundtrips; consistent metadata is not authenticated evidence',()=>{
  const r=record();assert.deepEqual(importDiagnostics(JSON.stringify([r])),[r]);
  const a=auditApplication(JSON.stringify([r]),[observation(r)]);assert.equal(a.evidence,'CONSISTENT_METADATA');assert.equal(a.authenticity,'NOT_ESTABLISHED');assert.equal(a.semanticCorrectness,'NOT_TESTED');
});
test('raw text, nested extras, prototype keys and missing fields are rejected without echo',()=>{
  for(const mutate of [r=>{r.answer='PRIVATE_BODY';},r=>{r.error={message:'PRIVATE_ERROR'};},r=>{Object.defineProperty(r,'__proto__',{value:'PRIVATE',enumerable:true});},r=>{delete r.httpStatus;}]) {
    const r=record();mutate(r);const a=auditApplication(JSON.stringify([r]),[]);assert.equal(a.evidence,'INCOMPLETE');assert.ok(!JSON.stringify(a).includes('PRIVATE'));
  }
});
test('duplicate fields including escaped names and request identities are rejected',()=>{
  const r=record(),raw=JSON.stringify([r]);assert.throws(()=>importDiagnostics(raw.replace('"model":','"model":"discarded","model":')),/DUPLICATE_KEY/);
  assert.throws(()=>importDiagnostics(raw.replace('"model":','"mo\\u0064el":"discarded","model":')),/DUPLICATE_KEY/);
  assert.throws(()=>importDiagnostics(JSON.stringify([r,r])),/DUPLICATE_REQUEST/);
});
test('bytes, UTF8, JSON and record count are bounded',()=>{
  for(const raw of ['x'.repeat(MAX_BYTES+1),Buffer.from([0xff]),'{',JSON.stringify(Array(21).fill(record()))]) assert.throws(()=>importDiagnostics(raw));
  assert.throws(()=>importDiagnostics('あ'.repeat(22000)),/BYTE_LIMIT/);assert.deepEqual(importDiagnostics('[]'),[]);
});
test('counter, HTTP, roles, completion, thinking and UI contradictions fail closed',()=>{
  for(const mutate of [r=>r.bodyCharacters=-1,r=>r.sentMessageCount=2,r=>r.httpStatus=500,r=>r.doneReceived=false,r=>r.thinkingPresent=true,r=>r.uiApplied=false,r=>r.result='COMPLETED_EMPTY',r=>r.finalized=false,r=>r.finalAnswerCharacters='UNKNOWN',r=>r.receivedChunks=0,r=>r.streamStarted=false]) {
    const r=record();mutate(r);assert.throws(()=>importDiagnostics(JSON.stringify([r])));
  }
});
test('missing, duplicate, reordered, mismatched and hidden application observations',()=>{
  const r=record(),o=observation(r),raw=JSON.stringify([r]);
  for(const obs of [[],[o,o],[{...o,model:'other'}],[{...o,requestId:'other'}],[{...o,requestSha256:'b'.repeat(64)}],[{...o,domCharacters:2}],[{...o,visible:false}],[{...o,extra:'SECRET'}]]) assert.equal(auditApplication(raw,obs).evidence,'INCOMPLETE');
  const r2=record(),o2={...observation(r2),trialId:'B_01'};
  assert.equal(auditApplication(JSON.stringify([r2,r]),[o,o2]).evidence,'CONSISTENT_METADATA');
});
test('zero records, unfinished, stopped and stale samples never become application success',()=>{
  assert.equal(auditApplication('[]',[]).evidence,'INCOMPLETE');
  for(const [error,stale] of [['aborted',false],[undefined,true]]) {
    const s=createStore();const h=s.begin();h.finish({characters:0,errorCode:error,stale});const r=s.snapshot()[0];s.clear();
    assert.equal(auditApplication(JSON.stringify([r]),[observation(record())]).evidence,'INCOMPLETE');
  }
});
test('plausible but mismatched response counts cannot pass the independent observation',()=>{
  const r=record(),o=observation(r);
  for(const extra of [{bodyCharacters:99},{thinkingCharacters:7,thinkingPresent:true},{doneCount:2}]) {
    const changed={...r,...extra};assert.equal(importDiagnostics(JSON.stringify([changed])).length,1);
    assert.equal(auditApplication(JSON.stringify([changed]),[o]).evidence,'INCOMPLETE');
  }
});
test('bounded file import rejects oversized and non-file input',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memo-audit-'));try {
    const file=path.join(dir,'log.json');fs.writeFileSync(file,JSON.stringify([record()]));assert.equal(readDiagnostics(file).length,1);
    fs.writeFileSync(file,' '.repeat(MAX_BYTES+1));assert.throws(()=>readDiagnostics(file),/BYTE_LIMIT/);assert.throws(()=>readDiagnostics(dir));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
