"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{judgeTrace}=require("./judge.cjs");
const fixture=require("./records/ir-fix/inputs/merge-orders.json");
function receiptTrace(late=false) {
  const events=structuredClone(fixture.events), identity=structuredClone(fixture.identity);
  const m=events.filter(e=>e.source==="main");
  if(!late)for(const e of m)if(e.sourceSeq>=2)e.sourceSeq++;
  events.push({...identity,eventId:"w4",source:"worker",sourceSeq:4,type:"complete_sent",completeId:"w3"},
    {...identity,eventId:"m5",source:"main",sourceSeq:late?5:2,type:"complete_received",sendId:"w4"});
  const ids=late?["w1","w2","w3","w4","m1","m2","m3","m4","m5"]:["w1","w2","w3","w4","m1","m5","m2","m3","m4"];
  return {identity,events:ids.map(id=>events.find(e=>e.eventId===id))};
}
const at=(t,id)=>t.events.find(e=>e.eventId===id);
function merge(t,ids){return {...t,events:ids.map(id=>at(t,id))};}
function invalid(t,reason){const r=judgeTrace(t);assert.equal(r.validTrace,"FAIL");assert.equal(r.recordError,reason);assert.equal(r.conditionR,"UNKNOWN");assert.equal(r.conditionU,"UNKNOWN");assert.equal(r.conditionReasonU,"INVALID_TRACE");return r;}

test("IR2: linked complete received before stop establishes R and disqualifies U across merges",()=>{
 const t=receiptTrace(), expected=judgeTrace(t);
 for(const ids of [
  ["w1","w2","m1","w3","w4","m5","m2","m3","m4"],
  ["w1","w2","m1","m5","m2","m3","m4","w3","w4"]
 ])assert.deepEqual(judgeTrace(merge(t,ids)),expected);
 assert.equal(expected.validTrace,"PASS");assert.equal(expected.recordError,null);
 assert.equal(expected.conditionR,"PASS");assert.equal(expected.conditionU,"FAIL");
 assert.equal(expected.conditionReasonU,"COMPLETED_BEFORE_STOP");assert.equal(expected.stopCondition,expected.conditionU);
 assert.equal(expected.executionAuthorization,"NOT_GRANTED");assert.equal(expected.startCondition,"BLOCKED");assert.equal(expected.realExperiment,"NOT_RUN");
 assert.equal(expected.connectionClosed,"UNKNOWN");assert.equal(expected.physicalRelease,"UNKNOWN");
});
test("late receipt disqualifies receive-before-stop R but leaves U UNKNOWN across merges",()=>{
 const t=receiptTrace(true),r=judgeTrace(t);
 assert.deepEqual(judgeTrace(merge(t,["w1","w2","m1","m2","m3","m4","w3","w4","m5"])),r);
 assert.equal(r.validTrace,"PASS");assert.equal(r.conditionR,"FAIL");assert.equal(r.conditionReasonR,"RECEIVED_AFTER_STOP");assert.equal(r.conditionU,"UNKNOWN");
});
test("record failure is distinct from a valid U condition failure",()=>{
 const valid=judgeTrace(receiptTrace());const t=receiptTrace();at(t,"m5").sendId="absent";const bad=invalid(t,"unmatched_complete_send");
 assert.equal(valid.validTrace,"PASS");assert.equal(valid.conditionU,"FAIL");assert.notDeepEqual(valid.reasons,bad.reasons);
});
test("complete receipts from another run or transaction are rejected",()=>{
 for(const key of ["runId","transactionId"]){const t=receiptTrace();at(t,"m5")[key]="foreign";invalid(t,"foreign_identity");}
});
test("wrong or missing complete event/send references are rejected",()=>{
 for(const ref of [undefined,"w2","missing"]){const t=receiptTrace();at(t,"w4").completeId=ref;invalid(t,"unmatched_complete_event");}
 for(const ref of [undefined,"w2","w3","missing"]){const t=receiptTrace();at(t,"m5").sendId=ref;invalid(t,"unmatched_complete_send");}
});
test("missing, noninteger, duplicate or reversed sourceSeq is record-invalid",()=>{
 for(const id of ["w3","w4","m5"]){for(const value of [undefined,0,1.5,"2",NaN]){const t=receiptTrace();at(t,id).sourceSeq=value;invalid(t,"duplicate_or_bad_source_sequence");}}
 const t=receiptTrace();at(t,"m5").sourceSeq=at(t,"m2").sourceSeq;invalid(t,"duplicate_or_bad_source_sequence");
});
test("complete occurrence and receipt must have the specified owners",()=>{
 for(const [id,source] of [["w3","oracle"],["w4","oracle"],["m5","oracle"]]){
  const t=receiptTrace();t.profile="synthetic-oracle-v1";at(t,id).source=source;at(t,id).sourceSeq=1;invalid(t,"invalid_complete_source");
 }
});
test("a sent complete without its main receipt never establishes before-stop completion",()=>{
 const t=receiptTrace();t.events=t.events.filter(e=>e.eventId!=="m5");const r=judgeTrace(t);
 assert.equal(r.validTrace,"PASS");assert.equal(r.conditionR,"UNKNOWN");assert.equal(r.conditionU,"UNKNOWN");
});
test("abort/error prevents normal R or U even with a complete receipt",()=>{
 for(const type of ["transaction_abort","transaction_error"]){const t=receiptTrace();t.events.push({...t.identity,eventId:"w5",source:"worker",sourceSeq:5,type});const r=judgeTrace(t);
  assert.equal(r.validTrace,"PASS");assert.equal(r.conditionR,"FAIL");assert.equal(r.conditionU,"FAIL");assert.equal(r.conditionReasonU,"ABNORMAL");}
});
test("missing terminate return cannot establish R even if before-stop completion excludes U",()=>{
 const t=receiptTrace();t.events=t.events.filter(e=>e.eventId!=="m4");const r=judgeTrace(t);
 assert.equal(r.conditionR,"UNKNOWN");assert.equal(r.conditionReasonR,"INCOMPLETE_STOP_CHAIN");assert.equal(r.conditionU,"FAIL");
});
test("collection error invalidates records rather than proving condition failure",()=>{
 const t=receiptTrace();t.events.push({...t.identity,eventId:"m6",source:"main",sourceSeq:6,type:"collection_error"});invalid(t,"collection_error");
});
test("R establishment and upgrade timeout remain separate, without execution authorization",()=>{
 const t=receiptTrace();t.events.push(...["upgrade_open","upgrade_timeout"].map((type,i)=>({...t.identity,type,eventId:`u${i}`,source:"main",sourceSeq:6+i,requestId:"upgrade1"})));
 const r=judgeTrace(t);assert.equal(r.conditionR,"PASS");assert.equal(r.conditionU,"FAIL");assert.equal(r.upgrade,"FAIL");assert.equal(r.executionAuthorization,"NOT_GRANTED");
});
test("synthetic oracle edges are explicit references, independent of cross-source array order",()=>{
 const t={identity:fixture.identity,profile:"synthetic-oracle-v1",events:structuredClone(fixture.events.filter(e=>e.eventId!=="w3"))};
 const begin={...t.identity,eventId:"o1",source:"oracle",sourceSeq:1,type:"oracle_unfinished_begin",proofId:"p",result:"normal_unfinished",beforeSendId:"w2"};
 const end={...t.identity,eventId:"o2",source:"oracle",sourceSeq:2,type:"oracle_unfinished_end",proofId:"p",result:"normal_unfinished",sendId:"w2",stopId:"m2",afterReturnId:"m4"};
 const a={...t,events:[...t.events,begin,end]},b={...t,events:[begin,end,...t.events]};assert.deepEqual(judgeTrace(a),judgeTrace(b));
 assert.equal(judgeTrace(a).conditionU,"PASS");assert.equal(judgeTrace(a).realExperiment,"NOT_RUN");
 end.afterReturnId="wrong";assert.equal(judgeTrace(a).conditionU,"UNKNOWN");
});
