'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {descendants,terminate,stat}=require('../chart-webkit-stage2/process-tree.cjs');
test('identified synthetic detached descendants are terminated and recorded',{skip:process.platform!=='linux',timeout:15000},async()=>{
  const root=fs.mkdtempSync(path.join(process.env.CHART_STAGE3_EVIDENCE||os.tmpdir(),'stage3-descendant-'));
  const parent=spawn(process.execPath,['-e',`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000);`],{detached:true,stdio:['ignore','pipe','ignore']});
  const childPid=Number(await new Promise((resolve,reject)=>{parent.stdout.once('data',x=>resolve(String(x).trim()));parent.once('error',reject);}));const before=descendants(parent.pid);const termination=await terminate(parent.pid);const after=stat(childPid);
  fs.writeFileSync(path.join(root,'outcome.json'),JSON.stringify({utc:new Date().toISOString(),parentPid:parent.pid,childPid,before,termination,after,uncapturedOrReparented:'UNKNOWN'},null,2)+'\n',{flag:'wx'});
  assert.ok(before.some(x=>x.pid===childPid));assert.ok(termination.captured.some(x=>x.pid===childPid));assert.deepEqual(termination.remaining,[]);assert.ok(!after||after.state==='Z');
});
