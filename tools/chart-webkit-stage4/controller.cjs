'use strict';
// Hard stop: the process supervisor and private evidence route are not yet
// independently validated. Removing this guard requires a separate decision.
throw Error('BLOCKED: stage4 supervisor is not approved for execution');
// One invocation consumes exactly one A or B trial. Linux only.
const fs=require('node:fs'), path=require('node:path'), {fork}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {descendants,stat}=require('../chart-webkit-stage2/process-tree.cjs');
const {createState,progressGate}=require('./safety.cjs');
const {createPreflush}=require('./preflush.cjs');
const {createStopController}=require('./stop-controller.cjs');
const {createCollection}=require('./collection.cjs');
const group=process.argv[2],root=process.argv[3];
if(process.platform!=='linux'||!['A','B'].includes(group)||!root||fs.existsSync(root))throw Error('Linux, A/B and a new output directory required');
const priorBytes=Number(process.env.CHART_STAGE4_PRIOR_BYTES||0);
if(!Number.isSafeInteger(priorBytes)||priorBytes<0||priorBytes>=100*1024*1024)throw Error('invalid prior evidence size');
fs.mkdirSync(root,{recursive:false});
const events=path.join(root,'controller.jsonl'),childTrace=path.join(root,'child.jsonl');
let seq=0,known=new Map(),done=false,stage='starting',overflow=false,rootIdentity=null;
const safety=createState(group);
const stopping=createStopController({state:safety,cleanup});
let collection;
function fail(reason){if(collection)collection.fail(reason);else stopping.request(reason);}
function log(type,extra={}){try{fs.appendFileSync(events,JSON.stringify({id:`${process.pid}:${++seq}`,pid:process.pid,origin:'controller',monoMs:performance.now(),utc:new Date().toISOString(),type,...extra})+'\n');}catch(_){fail('log_failed');}}
function size(dir){let n=0;for(const d of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,d.name);if(d.isDirectory())n+=size(p);else n+=fs.statSync(p).size;}return n;}
function capture(){try{const current=stat(child.pid);if(!rootIdentity||!current||current.start!==rootIdentity.start){if(!done)fail('identity_unknown');return;}for(const p of descendants(child.pid))known.set(`${p.pid}:${p.start}`,p);}catch(_){fail('capture_failed');}}
function remaining(){try{return [...known.values()].map(old=>{const now=stat(old.pid);if(!now)fail('remaining_unknown');else if(now.start!==old.start)fail('identity_changed');return {old,now};}).filter(x=>x.now&&x.now.start===x.old.start&&x.now.state!=='Z');}catch(_){fail('remaining_failed');return [];}}
function cleanup(){safety.fail('forced_cleanup');try{for(const {old} of remaining().reverse()){const now=stat(old.pid);if(now&&now.pid===old.pid&&now.start===old.start&&now.state!=='Z'){try{process.kill(old.pid,'SIGKILL');safety.fail('sigkill');log('cleanup-signal',{pid:old.pid,start:old.start,signal:'SIGKILL'});}catch(e){safety.fail('cleanup_failed');log('cleanup-error',{pid:old.pid,error:String(e)});}}}}catch(_){safety.fail('cleanup_failed');}}
function launchChild(){const child=fork(path.join(__dirname,'chart-block.e2e.js'),[],{cwd:process.cwd(),execArgv:['--require',path.resolve(__dirname,'../chart-webkit-stage3/preload.cjs')],stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CHART_STAGE3_MODE:'detailed',CHART_STAGE3_OUTPUT:root,CHART_STAGE4_GROUP:group,CHART_STAGE4_TRACE:childTrace}});return child;}
let child;
collection=createCollection({state:safety,stopping,write:row=>fs.appendFileSync(events,JSON.stringify(row)+'\n'),details:()=>{const after=child?remaining():[];if(after.length)safety.fail('descendants_remaining');return {childExitObserved:done,stage,overflow,known:[...known.values()],remainingAfter:after,uncapturedDescendants:'UNKNOWN',cleanup:stopping.snapshot()};},onRecordFailure:()=>{console.error('result_write_failed');process.exitCode=1;},onFinish:()=>{if(collection.snapshot().recordFailed){console.error('result_write_failed');process.exitCode=1;}else process.exitCode=progressGate(safety.result())==='PASS'?0:1;}});
try{child=launchChild();}catch(e){fail('child_start_failed');log('child-start-error',{error:String(e)});collection.start();process.exitCode=1;return;}
try{rootIdentity=stat(child.pid);if(rootIdentity)known.set(`${rootIdentity.pid}:${rootIdentity.start}`,rootIdentity);else fail('identity_unknown');}catch(_){fail('stat_failed');}
log('child-start',{childPid:child.pid,group});
for(const stream of ['stdout','stderr']){try{const out=fs.createWriteStream(path.join(root,`${stream}.log`),{flags:'wx'});out.on('error',()=>fail('stream_write_failed'));out.on('close',()=>collection.observed(`${stream}_close`));child[stream].on('error',()=>fail('stream_read_failed'));child[stream].pipe(out);}catch(_){fail('stream_setup_failed');}}
function sigterm(){capture();if(safety.result().failures.length){fail('signal_precondition_failed');return;}safety.signalRequested();log('sigterm-request',{childPid:child.pid});let accepted=false;try{const now=stat(child.pid);if(!safety.result().failures.length&&rootIdentity&&now&&now.pid===rootIdentity.pid&&now.start===rootIdentity.start)accepted=child.kill('SIGTERM');else fail('identity_unknown');}catch(_){fail('signal_failed');}safety.signalResult(accepted);log('sigterm-result',{accepted});stage=accepted?'sigterm':'failed';}
let preflushTimer;
const preflush=createPreflush({state:safety,send:(m,cb)=>{log('ipc-send',{message:m});if(safety.result().failures.length)throw Error('log_failed');collection.expect('preflush_callback');child.send(m,err=>{if(err)fail('ipc_error');cb(err);collection.observed('preflush_callback');});},stop:()=>{clearTimeout(preflushTimer);stage='failed';capture();fail('preflush_stop');},proceed:()=>{clearTimeout(preflushTimer);sigterm();}});
child.on('message',m=>{
  log('ipc-receive',{message:m});
  if(!m||typeof m!=='object'){fail('ipc_invalid');return;}
  if(safety.result().failures.length)return;
  if(m.type==='ready'&&stage==='starting'){stage='input';log('ipc-send',{message:{type:'stage4-last',requestId:'input-1'}});if(safety.result().failures.length)return;try{collection.expect('input_callback');child.send({type:'stage4-last',requestId:'input-1'},err=>{if(err)fail('ipc_error');collection.observed('input_callback');});}catch(_){fail('ipc_error');}}
  else if(m.type==='last-input'&&stage==='input'){
    if(m.value!=='Infinity'){log('input-failed');stage='failed';fail('input_failed');return;}
    if(group==='A')sigterm();else{stage='preflush';preflushTimer=setTimeout(()=>preflush.timeout(),5000);preflush.request('flush-1');}
  }else if(m.type==='stage4-preflush-result'&&group==='B'){
    preflush.receive(m);
  }
});
child.on('error',e=>{fail('child_error');log('child-error',{error:String(e)});});
child.on('exit',(code,signal)=>{safety.childExit(code,signal);done=true;if(safety.result().failures.length)fail('child_exit_failed');log('child-exit',{code,signal});collection.observed('child_exit');});
const monitor=setInterval(()=>{try{if(!done)capture();const bytes=priorBytes+size(root);if(bytes>=100*1024*1024&&!overflow){overflow=true;fail('size_limit');log('size-limit',{bytes,priorBytes});capture();}}catch(e){fail('monitor_failed');log('monitor-error',{error:String(e)});capture();}},100);
const guard=setTimeout(()=>{fail('outer_timeout');log('outer-timeout',{stage});capture();},18000);
function finish(){
  if(collection.snapshot().waiting)return;
  clearInterval(monitor);clearTimeout(guard);clearTimeout(final);capture();
  const before=remaining();if(before.length)fail('descendants_remaining');
  collection.start();
}
const final=setTimeout(finish,19500);
child.on('close',()=>{collection.observed('child_close');finish();});
