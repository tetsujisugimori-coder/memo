'use strict';
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {bounded}=require('./ledger.cjs');

// Runs in the page. No timer, rAF, storage, test assertion or product function is replaced.
function pageRecorder({mode, processId, pageId}) {
  const documentId=`${processId}:${pageId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const ids=new WeakMap();let next=0,seq=0,dropped=0,errors=0,pending=false,batch=0;let queue=[];
  const describe=n=>{if(!(n instanceof Element))return null;if(!ids.has(n))ids.set(n,++next);const row=n.closest('.chart-block-item-row,.chart-block-series-row');return {id:ids.get(n),tag:n.tagName,aria:n.getAttribute('aria-label'),value:'value' in n?n.value:null,data:{...n.dataset},row:row?{...row.dataset}:null,connected:n.isConnected,focused:document.activeElement===n};};
  function state(){let chart=null;try{chart=window.MemoNexusChartBlockUtils?.splitChartBlocks(document.querySelector('#editor')?.value||'').find(x=>x.type==='chart')?.chart||null;}catch(_){}return {chart,status:document.querySelector('.chart-block-editor .chart-block-status')?.textContent||null,inputs:[...document.querySelectorAll('.chart-block-editor input[data-chart-series-value]')].map(describe)};}
  function record(kind,target,extra={}){try{if(queue.length===1500){queue.shift();dropped++;}queue.push({seq:++seq,t:performance.now(),kind,target:describe(target),active:describe(document.activeElement),...extra});}catch(_){errors++;}}
  function take(){const events=queue;queue=[];return {documentId,batchId:`${documentId}:${++batch}`,timeOrigin:performance.timeOrigin,observedAt:performance.now(),lastObserved:seq,dropped,errors,pending,events};}
  function flush(){if(pending||!queue.length||typeof window.__chartStage3Sink!=='function')return;pending=true;const batch=take();Promise.resolve(window.__chartStage3Sink(batch)).catch(()=>{errors++;dropped+=batch.events.length;}).finally(()=>{pending=false;});}
  Object.defineProperty(window,'__chartStage3',{value:{take,flush,state,snapshot:()=>({documentId,timeOrigin:performance.timeOrigin,observedAt:performance.now(),lastObserved:seq,dropped,errors,pending,events:queue.slice()}),stats:()=>({documentId,lastObserved:seq,dropped,errors,pending,queued:queue.length})}});
  for(const kind of ['beforeinput','input','focusin','focusout','pointerdown','click'])document.addEventListener(kind,e=>{
    if(!(e.target instanceof Element)||!e.target.closest('.chart-block-editor'))return;
    const action=e.target.closest('button')?.dataset.chartAction||'';
    record(kind,e.target,{inputType:e.inputType||null,data:e.data||null,action,...(kind==='click'&&action.includes('move-item')?{state:state()}:{})});
  },{capture:true,passive:true});
  if(mode==='detailed'){
    const nativeFocus=HTMLElement.prototype.focus;
    HTMLElement.prototype.focus=function(...args){try{record('focus-call',this,{stack:new Error().stack});}catch(_){}return Reflect.apply(nativeFocus,this,args);};
    new MutationObserver(records=>{for(const r of records){const relevant=n=>n instanceof Element&&(n.matches('.chart-block-editor')||n.closest('.chart-block-editor')||n.querySelector('.chart-block-editor'));if(relevant(r.target)||[...r.addedNodes,...r.removedNodes].some(relevant))record('mutation-callback',r.target,{added:[...r.addedNodes].slice(0,30).map(describe),removed:[...r.removedNodes].slice(0,30).map(describe),truncated:Math.max(0,r.addedNodes.length-30)+Math.max(0,r.removedNodes.length-30)});}}).observe(document,{subtree:true,childList:true});
  }
  addEventListener('pagehide',flush);setInterval(flush,1000);
}
function receiptTracker(){const received=new Map(),completed=new Map();const update=(map,id,events)=>map.set(id,Math.max(map.get(id)||0,...events.map(x=>x.seq),0));return {received,completed,receive:(id,events)=>update(received,id,events),complete:(id,events,ok)=>{if(ok)update(completed,id,events);}};}
function attachBrowser(browser,ledger,{mode='detailed',boundaryMs=500}={}){
  if(!['light','detailed'].includes(mode))throw Error('invalid recorder mode');
  const processId=`${process.pid}-${crypto.randomBytes(8).toString('hex')}`;let nextPage=0;
  const pages=new Set(),seenPages=new WeakSet(),seenContexts=new WeakSet(),inFlight=new WeakMap(),tracker=receiptTracker();let request=0;
  const emit=record=>ledger.append({processId,nodeMs:performance.now(),utc:new Date().toISOString(),...record});
  const emitBounded=record=>bounded(emit(record).then(ok=>({ok})),boundaryMs);
  async function checkpoint(page,reason){
    const deadline=performance.now()+boundaryMs*4;
    while(inFlight.has(page)){
      const remaining=deadline-performance.now();if(remaining<=0){void emit({type:'boundary-skipped',pageId:page.__stage3Id,reason,why:'prior_checkpoint_timeout',unconfirmedTail:'UNKNOWN'});return;}
      const previous=await bounded(inFlight.get(page).then(()=>({ok:true})),remaining);
      if(!previous.ok){void emit({type:'boundary-skipped',pageId:page.__stage3Id,reason,why:'prior_checkpoint_timeout',unconfirmedTail:'UNKNOWN'});return;}
    }
    const task=(async()=>{
      const requestId=++request;await emitBounded({type:'flush-request',requestId,pageId:page.__stage3Id,reason});
      const capture=await bounded(page.evaluate(()=>window.__chartStage3?.snapshot()||null).then(payload=>({ok:true,payload})),boundaryMs);
      if(capture.ok&&capture.payload){const p=capture.payload;tracker.receive(p.documentId,p.events);let timedOut=false;const write=emit({type:'boundary-snapshot',requestId,pageId:page.__stage3Id,reason,payload:p,maxReceived:tracker.received.get(p.documentId)});write.then(ok=>{tracker.complete(p.documentId,p.events,ok);if(timedOut)void emit({type:'late-write-callback',requestId,ok});});const written=await bounded(write.then(ok=>({ok})),boundaryMs);timedOut=written.reason==='timeout';await emitBounded({type:'flush-result',requestId,pageId:page.__stage3Id,reason,result:written.ok?'callback_completed':written.reason||'write_failed',lastObserved:p.lastObserved,maxReceived:tracker.received.get(p.documentId),maxCallbackCompleted:tracker.completed.get(p.documentId)||null,inFlightAtCapture:p.pending,unconfirmedTail:'UNKNOWN'});}
      else await emitBounded({type:'flush-result',requestId,pageId:page.__stage3Id,reason,result:capture.reason||'no_document',lateEvaluation:'UNKNOWN',unconfirmedTail:'UNKNOWN'});
    })().catch(e=>{void emit({type:'recorder-error',pageId:page.__stage3Id,reason,error:String(e),unconfirmedTail:'UNKNOWN'});});
    inFlight.set(page,task);try{return await task;}finally{if(inFlight.get(page)===task)inFlight.delete(page);}
  }
  async function pageHook(page){
    if(seenPages.has(page))return page;seenPages.add(page);pages.add(page);const id=++nextPage;Object.defineProperty(page,'__stage3Id',{value:id});
    await page.exposeBinding('__chartStage3Sink',async(_source,payload)=>{tracker.receive(payload.documentId,payload.events);const ok=await emit({type:'batch',pageId:id,payload,maxReceived:tracker.received.get(payload.documentId)});tracker.complete(payload.documentId,payload.events,ok);if(!ok)throw Error('recorder write rejected');});
    await page.addInitScript(pageRecorder,{mode,processId,pageId:id});void emit({type:'page-created',pageId:id});
    page.on('crash',()=>void emit({type:'page-crash',pageId:id,unconfirmedTail:'UNKNOWN'}));page.on('close',()=>{pages.delete(page);void emit({type:'page-closed',pageId:id});});
    for(const name of ['reload','close']){const original=page[name];page[name]=async function(...args){await checkpoint(page,`page.${name}`);return Reflect.apply(original,this,args);};}
    if(mode==='detailed'){
      const wait=page.waitForFunction;page.waitForFunction=async function(...args){if(!String(args[0]).includes('2件目の売上の数値'))return Reflect.apply(wait,this,args);void emit({type:'wait-start',pageId:id,condition:String(args[0])});try{const result=await Reflect.apply(wait,this,args);void checkpoint(page,'wait-resolved');void emit({type:'wait-end',pageId:id,result:'resolved'});return result;}catch(e){void checkpoint(page,'wait-rejected');void emit({type:'wait-end',pageId:id,result:'rejected',error:String(e)});throw e;}};
    }
    return page;
  }
  function contextHook(context){if(seenContexts.has(context))return context;seenContexts.add(context);const newPage=context.newPage;context.newPage=async function(...args){return pageHook(await Reflect.apply(newPage,this,args));};const close=context.close;context.close=async function(...args){await Promise.all([...pages].filter(p=>p.context()===context).map(p=>checkpoint(p,'context.close')));return Reflect.apply(close,this,args);};return context;}
  const newPage=browser.newPage;browser.newPage=async function(...args){const page=await Reflect.apply(newPage,this,args);contextHook(page.context());return pageHook(page);};
  const newContext=browser.newContext;browser.newContext=async function(...args){return contextHook(await Reflect.apply(newContext,this,args));};
  const close=browser.close;let closePhase='not_requested';browser.close=async function(...args){closePhase='checkpoint';void emit({type:'browser-close-requested'});await Promise.all([...pages].map(p=>checkpoint(p,'browser.close')));closePhase='native_call';void emit({type:'browser-close-native-call'});try{const result=await Reflect.apply(close,this,args);closePhase='native_returned';void emit({type:'browser-close-native-returned'});return result;}catch(e){closePhase='native_error';void emit({type:'browser-close-error',error:String(e)});throw e;}};
  browser.on('disconnected',()=>void emit({type:'browser-disconnected',closePhase,cause:'UNKNOWN',unconfirmedTail:'UNKNOWN'}));
  return {checkpoint,processId,tracker,flushAll:async reason=>Promise.all([...pages].map(p=>checkpoint(p,reason)))};
}
module.exports={attachBrowser,pageRecorder,receiptTracker};
