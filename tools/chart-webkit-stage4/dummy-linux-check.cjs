'use strict';
// One bounded dummy-only IPC trial; no WebKit, process signal or output files.
if(process.platform!=='linux'){console.error('NOT_TESTED: Linux required');process.exit(2);}
const {fork}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
function identity(pid){try{const s=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const f=s.slice(s.lastIndexOf(')')+2).split(' ');return {pid,start:f[19],state:f[0]};}catch(_){return null;}}
let complete=false,ready=false,initial=null;
const child=fork(path.join(__dirname,'dummy-child.cjs'),[],{stdio:['ignore','ignore','ignore','ipc']});
const deadline=setTimeout(()=>{if(!complete){console.log(JSON.stringify({status:'FAIL',reason:'harness_timeout',identity:initial,remaining:'UNKNOWN'}));process.exitCode=1;child.disconnect();}},2000);
child.on('error',()=>{process.exitCode=1;});
child.on('message',m=>{if(!m||m.type!=='ready'||m.pid!==child.pid||ready){process.exitCode=1;return;}ready=true;initial=identity(child.pid);if(!initial){process.exitCode=1;return;}child.send({type:'finish'},err=>{if(err)process.exitCode=1;});});
child.on('exit',(code,signal)=>{complete=true;clearTimeout(deadline);const after=identity(child.pid);const status=ready&&initial&&code===0&&signal===null&&!after&&process.exitCode!==1?'PASS':'UNKNOWN';console.log(JSON.stringify({status,identity:initial,exit:{code,signal},after,uncapturedDescendants:'UNKNOWN',sigkill:'NOT_TESTED',negativeControl:'NOT_TESTED'}));if(status!=='PASS')process.exitCode=1;});
