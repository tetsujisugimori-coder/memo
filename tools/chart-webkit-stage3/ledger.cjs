'use strict';
// Completion of a write callback is neither fsync nor proof of persistent storage.
const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
const bounded = (promise, ms) => new Promise(resolve=>{const timer=setTimeout(()=>resolve({ok:false,reason:'timeout'}),ms);Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);resolve({ok:false,reason:'error',error:String(error)});});});
function createLedger(file, {maxBytes=1024*1024, injectedWrite}={}) {
  const stream = injectedWrite ? null : fs.createWriteStream(file,{flags:'wx'});
  const state={accepted:0,completed:0,failed:0,rejected:0,pending:0,lastCompletionUtc:null};
  if(stream) stream.on('error',()=>{});
  const pending=new Set();
  function append(record) {
    let payload;try{payload=JSON.stringify(record)+'\n';}catch(_){state.rejected++;return Promise.resolve(false);}
    if(Buffer.byteLength(payload)>maxBytes || (stream && stream.writableLength+Buffer.byteLength(payload)>maxBytes)){state.rejected++;return Promise.resolve(false);}
    state.accepted++;state.pending++;
    const promise=new Promise(resolve=>{
      let settled=false;
      const done=error=>{if(settled)return;settled=true;state.pending--;if(error)state.failed++;else{state.completed++;state.lastCompletionUtc=new Date().toISOString();}resolve(!error);};
      try {if(injectedWrite)injectedWrite(payload,done);else stream.write(payload,done);}catch(e){done(e);}
    });
    pending.add(promise);promise.finally(()=>pending.delete(promise));return promise;
  }
  async function flush(ms=1000) {
    const start=performance.now(),snapshot=[...pending];
    const result=await bounded(Promise.all(snapshot).then(values=>({ok:values.every(Boolean)&&state.failed===0&&state.rejected===0,reason:state.failed?'write_failure':state.rejected?'write_rejected':undefined})),ms);
    return {...result,requested:snapshot.length,pending:state.pending,elapsedMs:performance.now()-start,writeCallbacksCompleted:state.completed,storageDurability:'NOT_CONFIRMED'};
  }
  async function close(ms=1000) {
    const flushed=await flush(ms);if(!stream)return {...flushed,streamClosed:'NOT_APPLICABLE'};
    if(!flushed.ok)return {...flushed,streamClosed:'UNKNOWN'};
    const ended=await bounded(new Promise(resolve=>stream.end(()=>resolve({ok:true}))),ms);
    return {...flushed,streamClosed:ended.ok?'yes':'UNKNOWN'};
  }
  return {append,flush,close,state};
}
function audit(events, {finalObserved=null, finalReceived=null}={}) {
  const counts=new Map();for(const n of events){if(Number.isSafeInteger(n)&&n>0)counts.set(n,(counts.get(n)||0)+1);}
  const max=Math.max(0,...counts.keys());const first=counts.size?Math.min(...counts.keys()):null;let gaps=0,duplicates=0,contiguousUntil=0;
  for(let i=1;i<=max;i++)if(!counts.has(i))gaps++;
  while(counts.has(contiguousUntil+1))contiguousUntil++;
  for(const n of counts.values())duplicates+=Math.max(0,n-1);
  const confirmedEnd=Number.isSafeInteger(finalObserved)?finalObserved:null;
  return {first,lastReceived:finalReceived ?? (max||null),maxRecorded:max||null,contiguousUntil,gaps,duplicates,finalObserved:confirmedEnd,contradiction:confirmedEnd!==null&&confirmedEnd<max,minimumMissingAtTail:confirmedEnd===null?'UNKNOWN':Math.max(0,confirmedEnd-max),unconfirmedTail:'UNKNOWN'};
}
function auditPayloads(records){
  const seen=new Map();let overlap=0,duplicates=0,collisions=0;
  for(const record of records)for(const event of record.events||[]){
    const key=`${record.documentId}:${event.seq}`,serialized=JSON.stringify(event),prior=seen.get(key);
    if(!prior)seen.set(key,{serialized,sources:new Set([record.source])});
    else if(prior.serialized!==serialized)collisions++;
    else if(prior.sources.has(record.source))duplicates++;
    else{overlap++;prior.sources.add(record.source);}
  }
  return {unique:seen.size,intentionalOverlap:overlap,duplicateInSource:duplicates,conflictingIdentity:collisions};
}
function classify({outerTimeout=false,signal=null,controlledSignal=null,exitCode=null,browserDisconnected=false,requestedClose=false,remaining='UNKNOWN',platform=process.platform}={}) {
  return {outcome:outerTimeout?'outer_timeout':controlledSignal==='SIGTERM'&&platform!=='win32'?'controlled_sigterm':signal==='SIGKILL'?'forced_termination':signal==='SIGTERM'?(platform==='win32'?'windows_terminated':'sigterm'):browserDisconnected?'browser_disconnect_cause_unknown':exitCode===0?'normal':exitCode===null?'UNKNOWN':'nonzero_exit',signal,controlledSignal,exitCode,platform,requestedClose,remainingDescendants:remaining};
}
module.exports={createLedger,audit,auditPayloads,classify,bounded};
