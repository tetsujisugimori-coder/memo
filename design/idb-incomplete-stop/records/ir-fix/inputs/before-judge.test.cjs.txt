"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), { judgeTrace } = require("./judge.cjs");
const identity = { runId:"r1", dbName:"synthetic-only", workerId:"w1", connectionId:"c1", transactionId:"t1", iteration:1 };
function trace(types, profile="public-observation-v1") {
  const seq = {}; const events = types.map(([type,source,extra={}],i) => ({ ...identity, type, source, eventId:`e${i+1}`, sourceSeq:seq[source]=(seq[source]||0)+1, ...extra }));
  const send=events.find(e=>e.type==="send"),stop=events.find(e=>e.type==="stop_requested");
  for(const e of events)if(e.type==="receive")e.sendId=send?.eventId;
  for(const e of events)if(e.type==="oracle_unfinished_end"){e.stopId=stop?.eventId;e.sendId=send?.eventId;}
  return {identity,events,profile};
}
const accepted=["request_accepted","worker",{requestId:"q2",mode:"readonly",result:"accepted"}];
const chain=[accepted,["send","worker"],["receive","main"],["stop_requested","main"],["terminate_called","main"],["terminate_returned","main",{result:"returned"}]];
const upgrade=[["upgrade_open","main",{requestId:"u1"}],["upgrade_success","main",{requestId:"u1"}]];
test("missing complete and request readyState never establish unfinished",()=>{
 const t=trace([["request_success","worker",{readyState:"done"}],...chain.slice(1),...upgrade]);const r=judgeTrace(t);
 assert.equal(r.workerObservation,"UNKNOWN");assert.equal(r.stopCondition,"UNKNOWN");assert.equal(r.upgrade,"PASS");
});
test("positive Worker API observation does not survive send/stop race by assumption",()=>{
 const r=judgeTrace(trace([...chain,...upgrade]));assert.equal(r.workerObservation,"PASS");assert.equal(r.stopCondition,"UNKNOWN");
});
test("complete after send but observed before main stop invalidates condition",()=>{
 const r=judgeTrace(trace([...chain.slice(0,3),["transaction_complete","worker"],...chain.slice(3),...upgrade]));assert.equal(r.stopCondition,"FAIL");assert.equal(r.upgrade,"PASS");
});
for(const key of ["runId","transactionId","workerId","connectionId","dbName","iteration"])test(`foreign ${key} is never adopted`,()=>{
 const t=trace(chain);t.events[1][key]=key==="iteration"?2:"stale";assert.equal(judgeTrace(t).validTrace,"FAIL");
});
for(const type of ["transaction_abort","transaction_error"])test(`${type} is abnormal rather than normal unfinished`,()=>{
 const r=judgeTrace(trace([...chain,[type,"worker"],...upgrade]));assert.equal(r.stopCondition,"FAIL");assert.equal(r.upgrade,"PASS");
});
test("terminate/close/upgrade/cleanup returns never prove closure or physical release",()=>{
 const r=judgeTrace(trace([...chain,["close_returned","worker"],...upgrade,["evidence_saved","main"],["cleanup_start","main"],["cleanup_end","main",{result:"success"}]]));
 assert.equal(r.connectionClosed,"UNKNOWN");assert.equal(r.physicalRelease,"UNKNOWN");assert.equal(r.cleanup,"PASS");assert.equal(r.stopCondition,"UNKNOWN");
});
const held=[...chain.slice(0,1),["gate_held","worker",{nonce:"n1",epoch:1}],...chain.slice(1,3),["gate_claim","main",{nonce:"n1",epoch:1,result:"claimed"}],...chain.slice(3),["gate_postcheck","main",{nonce:"n1",epoch:1,state:"CLAIMED"}]];
test("shared callback hold is not a backend unfinished certificate",()=>{
 const r=judgeTrace(trace([...held,...upgrade]));assert.equal(r.callbackHold,"PASS");assert.equal(r.stopCondition,"UNKNOWN");
});
test("expired gate and stale epoch cannot establish callback hold",()=>{
 assert.equal(judgeTrace(trace([...held,["gate_expired","worker"]])).callbackHold,"FAIL");
 const t=trace(held);t.events.find(e=>e.type==="gate_postcheck").epoch=2;assert.notEqual(judgeTrace(t).callbackHold,"PASS");
});
test("late complete and arbitrary cross-domain clock values remain UNKNOWN",()=>{
 const t=trace([...chain,["transaction_complete","worker"],...upgrade]);for(const e of t.events)e.sourceMs=e.source==="worker"?-100000:999999;
 assert.equal(judgeTrace(t).stopCondition,"UNKNOWN");
});
const oracle=[accepted,["oracle_unfinished_begin","oracle",{proofId:"p1",result:"normal_unfinished"}],...chain.slice(1),["oracle_unfinished_end","oracle",{proofId:"p1",result:"normal_unfinished"}]];
test("synthetic proven condition and upgrade timeout are independent results",()=>{
 const r=judgeTrace(trace([...oracle,["upgrade_open","main",{requestId:"u1"}],["upgrade_timeout","main",{requestId:"u1"}]],"synthetic-oracle-v1"));
 assert.equal(r.stopCondition,"PASS");assert.equal(r.upgrade,"FAIL");assert.equal(r.syntheticOnly,true);assert.equal(r.realExperiment,"NOT_RUN");
});
test("oracle cannot be injected into public profile or refer to another stop",()=>{
 assert.equal(judgeTrace(trace(oracle)).validTrace,"FAIL");const t=trace(oracle,"synthetic-oracle-v1");t.events.at(-1).stopId="old";assert.notEqual(judgeTrace(t).stopCondition,"PASS");
});
test("late success never erases upgrade timeout",()=>{
 const t=trace([...chain,upgrade[0],["upgrade_timeout","main",{requestId:"u1"}],upgrade[1]]);assert.equal(judgeTrace(t).upgrade,"FAIL");
});
test("unmatched send, duplicate event and reordered source fail closed",()=>{
 for(const mode of ["send","duplicate","sequence"]){const t=trace(chain);if(mode==="send")t.events[2].sendId="old";if(mode==="duplicate")t.events[2].eventId=t.events[1].eventId;if(mode==="sequence")t.events[1].sourceSeq=1;assert.equal(judgeTrace(t).validTrace,"FAIL");}
});
test("delete before evidence and repeated cleanup are forbidden; timeout stays unknown",()=>{
 assert.equal(judgeTrace(trace([...chain,["cleanup_start","main"]])).validTrace,"FAIL");
 assert.equal(judgeTrace(trace([...chain,["evidence_saved","main"],["cleanup_start","main"],["cleanup_start","main"]])).validTrace,"FAIL");
 assert.equal(judgeTrace(trace([...chain,["evidence_saved","main"],["cleanup_start","main"],["cleanup_end","main",{result:"timeout"}]] )).cleanup,"UNKNOWN");
});
test("log overflow and additional upgrade are rejected",()=>{
 const t=trace(chain);t.events=Array(513).fill(t.events[0]);assert.equal(judgeTrace(t).validTrace,"FAIL");
 assert.equal(judgeTrace(trace([...chain,...upgrade,upgrade[0]])).validTrace,"FAIL");
});
test("cleanup completion cannot precede or exist without its start",()=>{
 for(const tail of [
  [["cleanup_end","main",{result:"success"}]],
  [["evidence_saved","main"],["cleanup_end","main",{result:"success"}],["cleanup_start","main"]]
 ])assert.equal(judgeTrace(trace([...chain,...tail])).validTrace,"FAIL");
});
