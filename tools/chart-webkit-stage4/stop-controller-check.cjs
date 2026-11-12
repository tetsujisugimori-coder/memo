'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStopController}=require('./stop-controller.cjs');
const {createState}=require('./safety.cjs');
test('multiple faults and reentrant cleanup preserve errors and perform one cleanup and finalization',()=>{
  const state=createState('A');let queued,cleanups=0,finals=0,stop;
  stop=createStopController({state,schedule:fn=>queued=fn,cleanup:()=>{cleanups++;stop.request('cleanup_reentry');throw Error('injected');}});
  stop.request('log_failed');stop.request('outer_timeout');stop.finalize(()=>finals++);queued();stop.request('late_callback');stop.finalize(()=>finals++);
  state.signalRequested();state.signalResult(true);state.childExit(143,null);
  assert.equal(cleanups,1);assert.equal(finals,1);assert.equal(state.result().procedure,'FAIL');
  for(const reason of ['log_failed','outer_timeout','cleanup_reentry','cleanup_failed','late_callback'])assert.ok(state.result().failures.includes(reason));
  assert.deepEqual(stop.snapshot(),{requested:true,started:true,completed:true,finalized:true,cleanupSuccess:'UNKNOWN'});
});
test('scheduled cleanup can finish before finalization without running twice',()=>{
  const state=createState('A');let queued,n=0;const stop=createStopController({state,schedule:fn=>queued=fn,cleanup:()=>n++});
  stop.request('stream_error');queued();stop.request('child_error');stop.finalize(()=>{});assert.equal(n,1);assert.equal(state.result().procedure,'FAIL');
});
test('schedule failure falls back without losing either fault',()=>{
  const state=createState('A');let n=0;const stop=createStopController({state,schedule:()=>{throw Error('injected');},cleanup:()=>n++});
  stop.request('ipc_error');assert.equal(n,1);assert.ok(state.result().failures.includes('cleanup_schedule_failed'));assert.ok(state.result().failures.includes('ipc_error'));
});
for(const reasons of [
  ['stream_read_failed','child_early_exit'],
  ['ipc_error','ipc_callback_duplicate'],
  ['size_limit','outer_timeout'],
  ['identity_changed','remaining_unknown'],
  ['child_early_exit','child_abnormal_exit'],
  ['evidence_failed','finalize_failed']
])test(`synthetic latch: ${reasons.join(' + ')}`,()=>{
  const state=createState('A');let queued,cleanups=0,finals=0;
  const stop=createStopController({state,schedule:fn=>queued=fn,cleanup:()=>cleanups++});
  for(const reason of reasons)stop.request(reason);
  stop.finalize(()=>finals++);queued();state.signalRequested();state.signalResult(true);state.childExit(143,null);
  assert.equal(cleanups,1);assert.equal(finals,1);assert.equal(state.result().procedure,'FAIL');
  for(const reason of reasons)assert.ok(state.result().failures.includes(reason));
});
