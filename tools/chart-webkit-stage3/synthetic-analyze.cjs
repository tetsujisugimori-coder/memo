'use strict';
const fs=require('node:fs'),path=require('node:path');const {audit,auditPayloads}=require('./ledger.cjs');const {auditFlushes,key}=require('./flush-audit.cjs');
const root=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('input directory required');
const plan=JSON.parse(fs.readFileSync(path.join(root,'plan.json'),'utf8'));
const report={plan,trialResults:[],documents:[],parseErrors:[],notes:['Synthetic baseline has a common fixture event listener.','B is stage3 light, not stage2 B.','Resource samples can miss short-lived descendants.','Snapshot/batch overlap is expected; unconfirmed tail remains UNKNOWN.']};
let reference=null;
for(const t of plan.plan){if(t.status!=='PASS')continue;const result=JSON.parse(fs.readFileSync(path.join(root,`result-${t.mode}-${t.index}.json`),'utf8'));
  const signature=JSON.stringify(result.observed);if(reference===null)reference=signature;
  report.trialResults.push({mode:t.mode,index:t.index,durationMs:result.durationMs,resources:result.sampledResources,flushMs:result.flushMs,ledger:result.ledger,observedMatchesFirst:signature===reference,observed:result.observed});
  if(t.mode==='none')continue;
  const file=path.join(root,`events-${t.mode}-${t.index}.jsonl`),docs=new Map(),lines=fs.readFileSync(file,'utf8').split('\n'),results=new Map(),snapshots=[],failures=[],allRecords=[];
  for(let i=0;i<lines.length;i++){if(!lines[i])continue;let r;try{r=JSON.parse(lines[i]);}catch(e){report.parseErrors.push({file:path.basename(file),line:i+1});continue;}
    allRecords.push(r);if(r.type==='flush-result')results.set(key(r),r);if(r.type==='boundary-skipped'||r.type==='recorder-error')failures.push(r.type);
    const p=r.payload;if(!p?.documentId||!Array.isArray(p.events))continue;
    if(!docs.has(p.documentId))docs.set(p.documentId,{documentId:p.documentId,records:[],lastObserved:0,dropped:0,errors:0,boundaries:0,inFlight:false});const d=docs.get(p.documentId);
    d.records.push({documentId:p.documentId,source:r.type==='batch'?`batch:${p.batchId}`:`snapshot:${key(r)}`,events:p.events});d.lastObserved=Math.max(d.lastObserved,p.lastObserved||0);d.dropped=Math.max(d.dropped,p.dropped||0);d.errors=Math.max(d.errors,p.errors||0);if(r.type==='boundary-snapshot'){d.boundaries++;d.inFlight ||= !!p.pending;snapshots.push({documentId:p.documentId,reason:r.reason,requestKey:key(r)});}
  }
  const expectedReason=t.index==='1'?'page.close':t.index==='2'?'context.close':'browser.close';const expected=snapshots.filter(s=>s.reason===expectedReason),reload=snapshots.filter(s=>s.reason==='page.reload');
  const confirmed=s=>results.get(s.requestKey)?.result==='callback_completed';
  const expectedBoundary=expected.some(confirmed),reloadBoundary=t.index!=='2'||reload.some(x=>confirmed(x)&&expected.some(y=>confirmed(y)&&x.documentId!==y.documentId));
  const reportTrial=report.trialResults.at(-1);Object.assign(reportTrial,{documents:docs.size,expectedReason,expectedBoundary,reloadBoundary,captureFailures:failures,flushAudit:auditFlushes(allRecords),missingFinishRecords:snapshots.filter(s=>!confirmed(s)).length,markerValid:false,focusCalls:0,mutationCallbacks:0});
  for(const d of docs.values()){
    const unique=new Map();for(const record of d.records)for(const e of record.events)if(!unique.has(e.seq))unique.set(e.seq,e);const ev=[...unique.values()].sort((a,b)=>a.seq-b.seq);
    const input=ev.find(e=>e.kind==='input'&&e.target?.value==='Infinity'&&e.target?.aria==='2件目の売上の数値');
    if(input){const before=ev.find(e=>e.kind==='beforeinput'&&e.seq<input.seq&&e.target?.id===input.target.id),click=ev.find(e=>e.kind==='click'&&e.seq>input.seq&&e.action==='move-item-down'&&e.state?.inputs?.some(x=>x.id===input.target.id&&x.value==='Infinity'));const focus=ev.find(e=>e.kind==='focusin'&&e.seq>(click?.seq||Infinity)&&e.target?.id===input.target.id);if(before&&click&&focus)reportTrial.markerValid=true;}
    reportTrial.focusCalls+=ev.filter(e=>e.kind==='focus-call').length;reportTrial.mutationCallbacks+=ev.filter(e=>e.kind==='mutation-callback'&&e.added?.length&&e.removed?.length).length;
    report.documents.push({mode:t.mode,index:t.index,documentId:d.documentId,accounting:audit([...unique.keys()],{finalObserved:d.lastObserved}),overlap:auditPayloads(d.records),dropped:d.dropped,recorderErrors:d.errors,boundarySnapshots:d.boundaries,inFlightAtAnyBoundary:d.inFlight});
  }
}
const bad=report.trialResults.some(x=>!x.observedMatchesFirst||x.ledger?.failed||x.ledger?.rejected||x.ledger?.pending||(x.mode!=='none'&&(!x.documents||!x.expectedBoundary||!x.reloadBoundary||x.captureFailures.length||x.missingFinishRecords||!x.markerValid||Object.entries(x.flushAudit).some(([k,v])=>!['requests','results'].includes(k)&&v>0)))||(x.mode==='detailed'&&(!x.focusCalls||!x.mutationCallbacks)))||report.documents.some(x=>x.accounting.gaps||x.accounting.contradiction||x.accounting.minimumMissingAtTail>0||x.overlap.duplicateInSource||x.overlap.conflictingIdentity||x.dropped||x.recorderErrors||!x.boundarySnapshots||x.inFlightAtAnyBoundary);
report.acceptance={status:plan.results.length===9&&!plan.stop&&!bad&&!report.parseErrors.length?'PARTIAL':'BLOCKED',reason:'Finite synthetic comparison only; tail and missed process samples remain UNKNOWN',observedProblem:!!bad};
console.log(JSON.stringify(report,null,2));if(report.acceptance.status==='BLOCKED')process.exitCode=1;
