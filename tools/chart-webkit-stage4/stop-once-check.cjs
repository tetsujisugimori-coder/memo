'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPreflush}=require('./preflush.cjs'),{createState,progressGate}=require('./safety.cjs');
test('timeout, late response and callback errors request stop once and retain all failures',()=>{
  const state=createState('B');let stops=0,proceeds=0,callback;
  const p=createPreflush({state,send:(_,cb)=>{callback=cb;},stop:()=>stops++,proceed:()=>proceeds++});
  p.request('x');p.timeout();p.receive({requestId:'x',ok:true});callback(Error('late'));callback(null);
  state.signalRequested();state.signalResult(true);state.childExit(143,null);
  assert.equal(stops,1);assert.equal(proceeds,0);assert.equal(state.result().procedure,'FAIL');
  for(const reason of ['preflush_timeout','ipc_duplicate_or_late','ipc_error','ipc_callback_duplicate'])assert.ok(state.result().failures.includes(reason));
});
test('reentrant response during stop cannot request stop twice',()=>{
  const state=createState('B');let stops=0,proceeds=0,p;
  p=createPreflush({state,send:()=>{},stop:()=>{stops++;p.receive({requestId:'x',ok:true});},proceed:()=>proceeds++});
  p.request('x');p.timeout();assert.equal(stops,1);assert.equal(proceeds,0);assert.ok(state.result().failures.includes('ipc_duplicate_or_late'));
});
test('synchronous send throw followed by callback and response retains failures without another stop',()=>{
  const state=createState('B');let callback,stops=0,proceeds=0;
  const p=createPreflush({state,send:(_,cb)=>{callback=cb;throw Error('injected');},stop:()=>stops++,proceed:()=>proceeds++});
  p.request('x');callback(Error('late'));p.receive({requestId:'x',ok:true});
  assert.equal(stops,1);assert.equal(proceeds,0);assert.ok(state.result().failures.includes('ipc_error'));assert.ok(state.result().failures.includes('ipc_duplicate_or_late'));
});
test('procedure pass and unknown evidence do not permit progress',()=>{
  const state=createState('A');state.signalRequested();state.signalResult(true);state.childExit(143,null);
  assert.equal(state.result().procedure,'PASS');assert.equal(progressGate(state.result()),'BLOCKED');
});
