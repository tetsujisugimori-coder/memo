'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {descendants,terminate,stat}=require('./process-tree.cjs');
test('timeout terminates a detached descendant captured by identity', {skip:process.platform!=='linux',timeout:15000}, async()=>{
  const parent=spawn(process.execPath,['-e',`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000);`],{detached:true,stdio:['ignore','pipe','ignore']});
  const childPid=Number(await new Promise((resolve,reject)=>{parent.stdout.once('data',x=>resolve(String(x).trim()));parent.once('error',reject);}));
  assert.ok(descendants(parent.pid).some(x=>x.pid===childPid));
  const result=await terminate(parent.pid);
  assert.ok(result.captured.some(x=>x.pid===childPid));assert.deepEqual(result.remaining,[]);
  const child=stat(childPid);assert.ok(!child || child.state==='Z');
});
