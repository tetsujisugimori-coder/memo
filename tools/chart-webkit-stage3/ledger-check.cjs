'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLedger,audit,auditPayloads,classify,bounded}=require('./ledger.cjs');
const {receiptTracker}=require('./recorder.cjs');
function evidence(name,value){if(process.env.CHART_STAGE3_EVIDENCE)fs.writeFileSync(path.join(process.env.CHART_STAGE3_EVIDENCE,name+'.json'),JSON.stringify({utc:new Date().toISOString(),...value},null,2)+'\n',{flag:'wx'});}
test('normal close records callback completion without claiming durability',async()=>{
  const dir=fs.mkdtempSync(path.join(process.env.CHART_STAGE3_EVIDENCE||os.tmpdir(),'stage3-ledger-'));const file=path.join(dir,'events.jsonl');const l=createLedger(file);
  assert.equal(await l.append({documentId:'synthetic',seq:1}),true);const end=await l.close(500);assert.equal(end.ok,true);assert.equal(end.streamClosed,'yes');assert.equal(end.storageDurability,'NOT_CONFIRMED');assert.equal(l.state.completed,1);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).seq,1);
});
test('injected gaps, duplicates and unconfirmed tail are not success',()=>{
  evidence('ledger-gap-injection',{input:[1,3,3],finalObserved:5,result:audit([1,3,3],{finalObserved:5})});
  assert.deepEqual(audit([1,3,3],{finalObserved:5}),{first:1,lastReceived:3,maxRecorded:3,contiguousUntil:1,gaps:1,duplicates:1,finalObserved:5,contradiction:false,minimumMissingAtTail:2,unconfirmedTail:'UNKNOWN'});
  assert.equal(audit([3,4]).first,3);assert.equal(audit([3,4],{finalObserved:2}).contradiction,true);
  assert.equal(audit([1,2]).unconfirmedTail,'UNKNOWN');
});
test('write failure and bounded flush timeout remain distinct',async()=>{
  const bad=createLedger('unused',{injectedWrite:(_p,done)=>done(new Error('injected'))});assert.equal(await bad.append({seq:1}),false);assert.equal(bad.state.failed,1);assert.equal((await bad.flush(50)).reason,'write_failure');
  const stuck=createLedger('unused',{injectedWrite:()=>{}});stuck.append({seq:1});const result=await stuck.flush(40);evidence('ledger-write-injection',{failed:{...bad.state},timeout:{...stuck.state,result}});assert.equal(result.reason,'timeout');assert.equal(result.pending,1);assert.equal(stuck.state.completed,0);
});
test('termination classification does not conflate timeout, signal, browser, and unknown',()=>{
  assert.equal(classify({exitCode:0}).outcome,'normal');assert.equal(classify({signal:'SIGTERM',platform:'linux'}).outcome,'sigterm');assert.equal(classify({signal:'SIGTERM',platform:'win32'}).outcome,'windows_terminated');assert.equal(classify({signal:'SIGKILL'}).outcome,'forced_termination');assert.equal(classify({outerTimeout:true,signal:'SIGTERM'}).outcome,'outer_timeout');assert.equal(classify({browserDisconnected:true,requestedClose:true,exitCode:0}).outcome,'browser_disconnect_cause_unknown');assert.equal(classify({}).remainingDescendants,'UNKNOWN');
});
test('intentional snapshot overlap is separate from duplication and conflicting identities',()=>{
  const e={seq:1,kind:'input'};const out=auditPayloads([{documentId:'d',source:'batch:1',events:[e]},{documentId:'d',source:'batch:1',events:[e]},{documentId:'d',source:'snapshot:10',events:[e]},{documentId:'d',source:'snapshot:11',events:[e,{seq:1,kind:'click'}]}]);
  evidence('ledger-overlap-injection',{result:out});
  assert.deepEqual(out,{unique:1,intentionalOverlap:2,duplicateInSource:1,conflictingIdentity:1});
});
test('receipt does not imply write callback completion',()=>{
  const t=receiptTracker(),events=[{seq:2},{seq:4}];t.receive('doc',events);t.complete('doc',events,false);
  assert.equal(t.received.get('doc'),4);assert.equal(t.completed.has('doc'),false);t.complete('doc',events,true);assert.equal(t.completed.get('doc'),4);
});
test('bounded rejection preserves error instead of claiming success',async()=>{
  const x=await bounded(Promise.reject(new Error('synthetic rejection')),50);assert.equal(x.ok,false);assert.equal(x.reason,'error');assert.match(x.error,/synthetic rejection/);
});
