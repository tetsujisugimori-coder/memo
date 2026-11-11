'use strict';
// Hard stop: the process supervisor and private evidence route are not yet
// independently validated. Removing this guard requires a separate decision.
throw Error('BLOCKED: stage4 supervisor is not approved for execution');
// One invocation consumes exactly one A or B trial. Linux only.
const fs=require('node:fs'), path=require('node:path'), {fork}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {descendants,stat}=require('../chart-webkit-stage2/process-tree.cjs');
const {createState}=require('./safety.cjs');
const {createPreflush}=require('./preflush.cjs');
const group=process.argv[2],root=process.argv[3];
if(process.platform!=='linux'||!['A','B'].includes(group)||!root||fs.existsSync(root))throw Error('Linux, A/B and a new output directory required');
const priorBytes=Number(process.env.CHART_STAGE4_PRIOR_BYTES||0);
if(!Number.isSafeInteger(priorBytes)||priorBytes<0||priorBytes>=100*1024*1024)throw Error('invalid prior evidence size');
fs.mkdirSync(root,{recursive:false});
const events=path.join(root,'controller.jsonl'),childTrace=path.join(root,'child.jsonl');
let seq=0,known=new Map(),done=false,stage='starting',overflow=false,rootIdentity=null;
const safety=createState(group);
function log(type,extra={}){fs.appendFileSync(events,JSON.stringify({id:`${process.pid}:${++seq}`,pid:process.pid,origin:'controller',monoMs:performance.now(),utc:new Date().toISOString(),type,...extra})+'\n');}
function size(dir){let n=0;for(const d of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,d.name);if(d.isDirectory())n+=size(p);else n+=fs.statSync(p).size;}return n;}
function capture(){const current=stat(child.pid);if(!rootIdentity||!current||current.start!==rootIdentity.start)return;for(const p of descendants(child.pid))known.set(`${p.pid}:${p.start}`,p);}
function remaining(){return [...known.values()].map(old=>({old,now:stat(old.pid)})).filter(x=>x.now&&x.now.start===x.old.start&&x.now.state!=='Z');}
function cleanup(){safety.fail('forced_cleanup');for(const {old} of remaining().reverse()){const now=stat(old.pid);if(now&&now.start===old.start&&now.state!=='Z'){try{process.kill(old.pid,'SIGKILL');safety.fail('sigkill');log('cleanup-signal',{pid:old.pid,start:old.start,signal:'SIGKILL'});}catch(e){safety.fail('cleanup_failed');log('cleanup-error',{pid:old.pid,error:String(e)});}}}}
const child=fork(path.join(__dirname,'chart-block.e2e.js'),[],{cwd:process.cwd(),execArgv:['--require',path.resolve(__dirname,'../chart-webkit-stage3/preload.cjs')],stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CHART_STAGE3_MODE:'detailed',CHART_STAGE3_OUTPUT:root,CHART_STAGE4_GROUP:group,CHART_STAGE4_TRACE:childTrace}});
rootIdentity=stat(child.pid);if(rootIdentity)known.set(`${rootIdentity.pid}:${rootIdentity.start}`,rootIdentity);
log('child-start',{childPid:child.pid,group});
for(const stream of ['stdout','stderr']){const out=fs.createWriteStream(path.join(root,`${stream}.log`),{flags:'wx'});child[stream].pipe(out);}
function sigterm(){capture();safety.signalRequested();log('sigterm-request',{childPid:child.pid});let accepted=false;const now=stat(child.pid);if(rootIdentity&&now&&now.start===rootIdentity.start)try{accepted=child.kill('SIGTERM');}catch(e){log('sigterm-error',{error:String(e)});}else log('identity-unconfirmed');safety.signalResult(accepted);log('sigterm-result',{accepted});stage=accepted?'sigterm':'failed';}
const preflush=createPreflush({state:safety,send:(m,cb)=>{log('ipc-send',{message:m});child.send(m,cb);},stop:()=>{stage='failed';capture();cleanup();},proceed:()=>sigterm()});
let preflushTimer;
child.on('message',m=>{
  log('ipc-receive',{message:m});
  if(m.type==='ready'&&stage==='starting'){stage='input';log('ipc-send',{message:{type:'stage4-last',requestId:'input-1'}});child.send({type:'stage4-last',requestId:'input-1'});}
  else if(m.type==='last-input'&&stage==='input'){
    if(m.value!=='Infinity'){log('input-failed');stage='failed';cleanup();return;}
    if(group==='A')sigterm();else{stage='preflush';preflushTimer=setTimeout(()=>preflush.timeout(),5000);preflush.request('flush-1');}
  }else if(m.type==='stage4-preflush-result'&&group==='B'){
    clearTimeout(preflushTimer);preflush.receive(m);
  }
});
child.on('error',e=>log('child-error',{error:String(e)}));
child.on('exit',(code,signal)=>{safety.childExit(code,signal);log('child-exit',{code,signal});done=true;});
const monitor=setInterval(()=>{try{if(!done)capture();const bytes=priorBytes+size(root);if(bytes>=100*1024*1024&&!overflow){overflow=true;log('size-limit',{bytes,priorBytes});capture();cleanup();}}catch(e){log('monitor-error',{error:String(e)});capture();cleanup();}},100);
const guard=setTimeout(()=>{safety.fail('outer_timeout');log('outer-timeout',{stage});capture();cleanup();},18000);
const final=setTimeout(()=>{clearInterval(monitor);clearTimeout(guard);capture();const before=remaining();if(before.length)cleanup();const after=remaining();if(overflow)safety.fail('size_limit');if(after.length)safety.fail('descendants_remaining');log('controller-finish',{childExitObserved:done,stage,overflow,known:[...known.values()],remainingBefore:before,remainingAfter:after,uncapturedDescendants:'UNKNOWN',assessment:safety.result()});process.exitCode=safety.result().procedure==='PASS'?0:1;},19500);
child.on('close',()=>{if(done){setTimeout(()=>{clearTimeout(final);clearTimeout(guard);clearInterval(monitor);const before=remaining();if(before.length)cleanup();setTimeout(()=>{const after=remaining();if(overflow)safety.fail('size_limit');if(after.length)safety.fail('descendants_remaining');log('controller-finish',{childExitObserved:done,stage,overflow,known:[...known.values()],remainingBefore:before,remainingAfter:after,uncapturedDescendants:'UNKNOWN',assessment:safety.result()});process.exitCode=safety.result().procedure==='PASS'?0:1;},200);},300);}});
