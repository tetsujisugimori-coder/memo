'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const safety=()=>require('./safety.cjs');
for(const failure of ['outer_timeout','sigkill','cleanup_failed','identity_unknown','ipc_error','preflush_timeout','preflush_failed','size_limit','log_failed','child_start_failed','child_early_exit','capture_failed','stat_failed','evidence_failed']){
  test(`${failure} remains failed after a later normal child exit`,()=>{
    const s=safety().createState('A');s.signalRequested();s.signalResult(true);s.fail(failure);s.childExit(143,null);
    assert.equal(s.result().procedure,'FAIL');assert.ok(s.result().failures.includes(failure));
  });
}
test('successful exit alone cannot claim evidence or durable storage',()=>{
  const s=safety().createState('A');s.signalRequested();s.signalResult(true);s.childExit(143,null);
  const r=s.result();assert.notEqual(r.evidence,'PASS');assert.equal(r.durableStorage,'UNKNOWN');assert.equal(r.uncapturedDescendants,'UNKNOWN');
});
test('normal abstract procedure is distinct from evidence and storage',()=>{
  const s=safety().createState('B');s.preflushRequested('f1');s.preflushResult({requestId:'f1',ok:true});s.signalRequested();s.signalResult(true);s.childExit(143,null);
  assert.equal(s.result().procedure,'PASS');assert.equal(s.result().evidence,'UNKNOWN');assert.equal(s.result().durableStorage,'UNKNOWN');
});
test('PID and start identity required for a signal',()=>{
  const {sameIdentity}=safety();assert.equal(sameIdentity({pid:1,start:'2'},{pid:1,start:'2'}),true);
  for(const x of [null,{pid:1},{pid:1,start:'3'},{pid:2,start:'2'}])assert.equal(sameIdentity({pid:1,start:'2'},x),false);
});
test('preflush response must be unique, matching, and successful',()=>{
  const s=safety().createState('B');s.preflushRequested('f1');s.preflushResult({requestId:'wrong',ok:true});assert.equal(s.result().procedure,'FAIL');
  const t=safety().createState('B');t.preflushRequested('f1');t.preflushResult({requestId:'f1',ok:true});t.preflushResult({requestId:'f1',ok:true});assert.equal(t.result().procedure,'FAIL');
  const u=safety().createState('B');u.preflushRequested('f1');u.preflushResult({requestId:'f1',ok:false});assert.equal(u.result().procedure,'FAIL');
});
test('callback or preflush success cannot prove Infinity stored',()=>{
  const {assessEvidence}=safety();const r=assessEvidence({parentInfinity:true,preflushOk:true,callback:true});
  assert.equal(r.infinityStored,'UNKNOWN');assert.equal(r.boundary,'UNKNOWN');assert.equal(r.unconfirmedTail,'UNKNOWN');assert.equal(r.durableStorage,'UNKNOWN');
});
