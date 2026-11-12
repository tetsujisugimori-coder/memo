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
test('deadline plan reserves recording time inside unchanged outer budget',()=>{
  const {createDeadline}=require('./deadline.cjs');let time=50;const b=createDeadline(()=>time);
  assert.deepEqual([b.stop,b.collect,b.observe,b.outer],[17050,19050,19550,20050]);time=19000;assert.equal(b.remaining(b.collect),50);time=21000;assert.equal(b.remaining(b.outer),0);
});
test('just before deadline completes; exact deadline keeps missing close UNKNOWN',()=>{
  const before=fixture();before.time(99);before.complete();assert.equal(before.rows[0].collection,'COMPLETE');
  const exact=fixture();exact.time(100);exact.complete();assert.equal(exact.rows[0].collection,'UNKNOWN');assert.ok(exact.state.result().failures.includes('collection_timeout'));
});
test('late callback preserves pending and amendment; observation end is explicitly UNKNOWN',()=>{
  const f=fixture();f.c.expect('ipc');f.time(101);f.c.start();const first=JSON.stringify(f.rows[0]);
  f.time(110);assert.equal(f.c.observed('ipc'),false);assert.ok(f.c.snapshot().pending.includes('ipc'));assert.equal(f.rows.at(-1).type,'controller-amendment');
  const count=f.rows.length;f.time(120);f.state.childExit(7,null);f.c.observed('ipc');assert.equal(f.rows.length,count);assert.equal(f.c.snapshot().afterObservation,'UNKNOWN');assert.equal(JSON.stringify(f.rows[0]),first);
});
test('initial write failure is distinct and permanently disables writes',()=>{
  let writes=0;const errors=[];const f=fixture({write:()=>{writes++;throw Error('synthetic');},onRecordFailure:r=>errors.push(r)});f.complete();f.state.fail('later');assert.equal(writes,1);assert.deepEqual(errors,['initial_write_failed']);assert.ok(f.state.result().failures.includes('result_write_failed'));
});
test('cleanup reentry cannot finalize until exception is latched',()=>{
  let f,count=0;f=fixture({cleanup:()=>{count++;f.complete();assert.equal(f.rows.length,0);throw Error('synthetic');}});f.c.fail('first');f.c.fail('second');f.complete();assert.equal(count,1);assert.equal(f.rows[0].type,'controller-finish');assert.ok(f.rows[0].assessment.failures.includes('cleanup_failed'));
});
test('preflush failure and subsequent callback append without losing either cause',()=>{
  const {createPreflush}=require('./preflush.cjs');const f=fixture();let cb,stops=0;
  const p=createPreflush({state:f.state,send:(_,callback)=>cb=callback,stop:()=>stops++,proceed:()=>assert.fail('must not proceed')});
  p.request('x');f.complete();p.receive({requestId:'x',ok:false});cb(Error('synthetic'));cb(null);
  for(const reason of ['preflush_failed','ipc_error','ipc_callback_duplicate'])assert.ok(f.c.aggregate(f.rows).failures.includes(reason));assert.equal(stops,1);
});
test('preflush request begun late cannot extend absolute stop deadline',()=>{
  const {createPreflush}=require('./preflush.cjs');const f=fixture();let time=90,cb;
  const p=createPreflush({state:f.state,now:()=>time,absoluteDeadline:100,send:(_,callback)=>cb=callback,stop:()=>{},proceed:()=>assert.fail('late proceed')});p.request('x');time=100;p.receive({requestId:'x',ok:true});cb(null);assert.ok(f.state.result().failures.includes('preflush_timeout'));
});
test('identity errors, reused PID and reparenting never imply absence',()=>{
  const {identity,descendants}=require('./identity.cjs'),{sameIdentity}=require('./safety.cjs');
  const stat=(pid,parent,start)=>`${pid} (dummy) S ${parent} ${Array(17).fill('0').join(' ')} ${start}`;
  const read=()=>{const e=Error('synthetic');e.code='EACCES';throw e;};assert.equal(identity(2,read).status,'READ_ERROR');
  assert.equal(identity(2,()=>stat(3,1,10)).status,'PARSE_ERROR');assert.equal(sameIdentity(identity(2,()=>stat(2,1,10)),identity(2,()=>stat(2,1,11))),false);
  const scan=descendants(2,{list:()=>['2','3','4'],read:p=>p==='/proc/4/stat'?read():stat(Number(p.split('/')[2]),1,10)});assert.equal(scan.processes.length,0);assert.equal(scan.unknown[0].status,'READ_ERROR');
});
test('controller wiring keeps gates and uses absolute identity/deadline contracts',()=>{
  const fs=require('node:fs'),path=require('node:path');const s=fs.readFileSync(path.join(__dirname,'controller.cjs'),'utf8');
  assert.doesNotMatch(s,/process-tree|\bstat\(/);assert.match(s,/deadline:budget.collect/);assert.match(s,/observationDeadline:budget.observe/);assert.match(s,/absoluteDeadline:budget.stop/);assert.match(s,/sameIdentity\(now,rootIdentity\)/);
  assert.ok(s.indexOf("throw Error('BLOCKED:")<s.indexOf('const budget='));
  const workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/chart-webkit-stage4.yml'),'utf8');assert.match(workflow,/never-trigger-by-sha/);assert.match(workflow,/if: \$\{\{ false \}\}/);assert.match(workflow,/timeout -k 1s 20s/);
});
test('observation end attempts final record even when earlier timers were delayed',()=>{
  const f=fixture();f.time(121);f.c.expire();assert.equal(f.rows.length,1);assert.equal(f.rows[0].collection,'UNKNOWN');assert.ok(f.rows[0].assessment.failures.includes('collection_timeout'));
});
