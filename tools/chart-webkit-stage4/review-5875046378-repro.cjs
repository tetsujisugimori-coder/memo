'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createState}=require('./safety.cjs'),{createCollection}=require('./collection.cjs'),{createStopController}=require('./stop-controller.cjs');
function fixture(options={}){
  let time=0;const state=createState('B'),rows=[];
  const stopping=createStopController({state,cleanup:options.cleanup||(()=>{}),schedule:f=>f()});
  const c=createCollection({state,stopping,write:options.write||((r)=>rows.push(r)),now:()=>time,deadline:100,observationDeadline:120,...options});
  return {state,rows,c,stopping,time:t=>time=t,complete(){for(const n of ['child_exit','child_close','stdout_close','stderr_close'])c.observed(n);c.start();}};
}
test('late internal failures append once and aggregate permanently',()=>{
  const f=fixture();f.complete();const original=JSON.stringify(f.rows[0]);
  f.state.childExit(1,null);f.state.signalResult(false);f.state.preflushRequested('x');f.state.preflushRequested('x');f.state.preflushResult({requestId:'x',ok:false});
  const failures=f.state.result().failures;assert.ok(failures.includes('child_abnormal_exit'));
  assert.equal(f.rows.length,1+failures.length);const count=f.rows.length;
  f.state.signalResult(false);assert.equal(f.rows.length,count);
  f.state.signalRequested();f.state.signalResult(true);f.state.childExit(143,null);
  assert.equal(f.c.aggregate(f.rows).procedure,'FAIL');assert.equal(JSON.stringify(f.rows[0]),original);
});
test('amendment failure disables destination without recursive retries',()=>{
  let writes=0;const failures=[];const f=fixture({write:()=>{if(++writes>1)throw Error('synthetic');},onRecordFailure:type=>failures.push(type)});f.complete();
  f.state.fail('first');f.state.fail('second');assert.equal(writes,2);assert.deepEqual(failures,['amendment_write_failed']);assert.equal(f.c.snapshot().recordFailed,true);
});
test('absolute deadline rejects late observations even before timer runs',()=>{
  const f=fixture();f.c.expect('ipc_callback');f.time(101);f.c.observed('ipc_callback');f.complete();
  assert.ok(f.state.result().failures.includes('collection_timeout'));assert.equal(f.rows[0].collection,'UNKNOWN');
});
