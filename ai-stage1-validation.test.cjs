'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const {fixture,observe,classify,auditPair,run,PLAN} = require('./scripts/ai-stage1-validation.cjs');
const response = (events) => async () => new Response(events.map(e=>JSON.stringify(e)).join('\n')+'\n');
const req = {...fixture('A'), model:'fixture-model'};
const text = {message:{content:'synthetic'},done:true};
test('fixed 2/5/2/5 plan and history isolation',()=>{
 assert.equal(PLAN.length,14); for(const [g,n] of [['A',2],['B',5],['C',2],['D',5]]) assert.equal(PLAN.filter(x=>x===g).length,n);
 assert.equal(fixture('A',[{role:'assistant',content:'x'}]).historyMessageCount,0);
 assert.equal(fixture('B',[{role:'assistant',content:'x'}]).historyMessageCount,1);
 assert.equal(fixture('C').referenceMode,'none'); assert.throws(()=>fixture('Z'));
});
for (const lane of ['direct','adapter']) {
 for (const [name,events,expected] of [ ['normal',[text],'TEXT_OBSERVED'],['empty',[{done:true}],'EMPTY'],['thinking',[{message:{thinking:'secret-thought'},done:true}],'THINKING_ONLY'],['done missing',[{message:{content:'synthetic'}}],'MISSING_DONE']]) {
 test(`${lane}: ${name}`,async()=>{const out=await observe(req,lane,response(events));assert.equal(out.classification,expected);assert.equal(out.record.uiApplied,false);const log=JSON.stringify(out.record);assert.ok(!log.includes('secret-thought'));assert.ok(!log.includes('synthetic'));});
 }
 test(`${lane}: bounded timeout`, async()=>{const out=await observe(req,lane,async(_url,opts)=>new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))),5); assert.equal(out.classification,'TIMEOUT');});
}
test('explicit inference gate prevents all traffic',async()=>{let calls=0;await assert.rejects(run({model:'m',output:'.',fetchImpl:()=>{calls++;},execute:false}));assert.equal(calls,0);});
test('pair classification requires distinct requests and matched conditions',async()=>{
 const a=await observe(req,'direct',response([text])); const b=await observe(req,'adapter',response([text]));
 const pair={trialId:'trial-01-A',fixtureSha256:'a'.repeat(64),direct:a.record,adapter:b.record};
 assert.equal(auditPair(pair).evidence,'PAIR_OBSERVED'); assert.equal(auditPair(pair).app,'NOT_TESTED');
 for(const key of ['model','purpose','historyMessageCount','referenceMode']) assert.equal(auditPair({...pair,adapter:{...b.record,[key]:'wrong'}}).evidence,'INCOMPLETE');
 assert.equal(auditPair({...pair,adapter:{...b.record,requestId:a.record.requestId}}).evidence,'INCOMPLETE');
 assert.equal(auditPair({...pair,adapter:{...b.record,finalAnswerCharacters:undefined}}).evidence,'INCOMPLETE');
 assert.equal(auditPair({}).evidence,'INCOMPLETE');
});
test('classification retains interruption, disconnect, stale and missing independently',()=>{
 const d={requestId:'a',finalized:true,errorType:'UNKNOWN',bodyCharacters:1,finalAnswerCharacters:1,streamEndedNormally:true,doneReceived:true};
 for(const [errorType,want] of [['aborted','INTERRUPTED'],['timeout','TIMEOUT'],['connection','CONNECTION']]) assert.equal(classify({...d,errorType}),want);
 assert.equal(classify({...d,staleResponse:true}),'STALE');assert.equal(classify({...d,finalized:false}),'INCOMPLETE');
});
test('same transport failure has same lane category',async()=>{
 const broken=async()=>{throw new TypeError('fetch failed');};
 assert.equal((await observe(req,'direct',broken)).classification,'CONNECTION');
 assert.equal((await observe(req,'adapter',broken)).classification,'CONNECTION');
});
test('missing schema and contradictory HTTP/done evidence never pairs',async()=>{
 const a=await observe(req,'direct',response([text]));const b=await observe(req,'adapter',response([text]));
 const pair={trialId:'trial-01-A',fixtureSha256:'a'.repeat(64),direct:a.record,adapter:b.record};
 for(const mutate of [r=>{delete r.model;},r=>{delete r.purpose;},r=>{delete r.referenceMode;},r=>{delete r.translationLanguage;},r=>{r.httpStatus=500;},r=>{r.doneCount=0;},r=>{r.streamStarted=false;}]) {
  const p=structuredClone(pair);mutate(p.direct);mutate(p.adapter);assert.equal(auditPair(p).evidence,'INCOMPLETE');
 }
 assert.equal(auditPair({...pair,trialId:undefined}).evidence,'INCOMPLETE');
});
