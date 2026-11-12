'use strict';
// One child, bounded lifetime and output; no WebKit or signals from shared code.
if(process.platform!=='linux'){console.error('NOT_TESTED: Linux required');process.exit(2);}
const {fork}=require('node:child_process'),path=require('node:path');
const {identity}=require('./identity.cjs'),{createState}=require('./safety.cjs');
const {createStopController}=require('./stop-controller.cjs'),{createCollection}=require('./collection.cjs');
const state=createState('A'),rows=[];let complete=false,ready=false,initial=null;
const child=fork(path.join(__dirname,'dummy-child.cjs'),[],{stdio:['ignore','ignore','ignore','ipc']});
const stop=createStopController({state,cleanup:()=>{if(child.connected)child.disconnect();}});
const collection=createCollection({state,stopping:stop,write:r=>rows.push(r),deadlineMs:1000,onFinish:()=>{
  const after=identity(child.pid);const status=ready&&initial?.status==='PRESENT'&&complete&&after.status==='ABSENT'&&!rows.at(-1).assessment.failures.length?'PASS':'UNKNOWN';
  console.log(JSON.stringify({status,identity:initial,after,childExitObserved:complete,collection:collection.snapshot(),aggregate:collection.aggregate(rows),uncapturedDescendants:'UNKNOWN'}));if(status!=='PASS')process.exitCode=1;
}});
// Dummy uses ignored streams, so there are no stream pipes to drain.
collection.observed('stdout_close');collection.observed('stderr_close');
const deadline=setTimeout(()=>{collection.fail('harness_timeout');collection.start();if(child.connected)child.disconnect();},2000);
child.on('error',()=>collection.fail('child_error'));
child.on('message',m=>{if(!m||m.type!=='ready'||m.pid!==child.pid||ready){collection.fail('ipc_invalid');return;}ready=true;initial=identity(child.pid);if(initial.status!=='PRESENT'){collection.fail('identity_unknown');return;}collection.expect('send_callback');try{child.send({type:'finish'},err=>{if(err)collection.fail('ipc_error');collection.observed('send_callback');});}catch(_){collection.fail('ipc_error');}});
child.on('exit',(code,signal)=>{complete=true;clearTimeout(deadline);if(code!==0||signal!==null)collection.fail('child_exit_failed');collection.observed('child_exit');});
child.on('close',()=>{collection.observed('child_close');collection.start();});
