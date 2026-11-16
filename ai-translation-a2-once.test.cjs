'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {requestFixture,directOne}=require('./scripts/ai-translation-a2-once.cjs');
test('A2 default selected text uses exact prompt-v2 and empty options',()=>{
  const x=requestFixture();
  assert.equal(x.characters,197);
  assert.deepEqual(x.roles,['system','user']);
  assert.equal(x.request.messages.length,2);
  assert.deepEqual(x.request.options,{});
  assert.equal(x.request.model,'phi4-mini:latest');
  assert.match(x.request.messages.at(-1).content,/\[翻訳対象\]\nThe blue bird sits by the window\.$/);
  assert.match(x.requestSha256,/^[a-f0-9]{64}$/);
});
test('A2 rejects an unapproved model',()=>{
  assert.throws(()=>requestFixture('other:latest'),/model_not_fixed/);
});
test('A2 never probes or runs without explicit approvals and stable source',async()=>{
  let calls=0;
  const bad=async()=>{calls++;throw Error('must_not_call');};
  await assert.rejects(directOne({execute:false,appObserved:true,probeFn:bad}),/explicit_execute/);
  await assert.rejects(directOne({execute:true,appObserved:false,probeFn:bad}),/explicit_execute/);
  await assert.rejects(directOne({execute:true,appObserved:true,platform:'linux',probeFn:bad}),/windows_required/);
  await assert.rejects(directOne({execute:true,appObserved:true,platform:'win32',
    sourceFn:()=>({head:'UNKNOWN',sourceUnchanged:false,worktreeClean:false}),
    probeFn:bad}),/fixed_source_required/);
  assert.equal(calls,0);
});
