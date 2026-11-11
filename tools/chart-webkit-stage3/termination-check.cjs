'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{fork}=require('node:child_process');
const {audit,classify}=require('./ledger.cjs');
for(const scenario of ['normal','controlled_sigterm','forced','outer_timeout','tail_loss'])test(`synthetic ${scenario}`,{timeout:15000,skip:scenario==='controlled_sigterm'&&process.platform==='win32'},async()=>{
  const root=fs.mkdtempSync(path.join(process.env.CHART_STAGE3_EVIDENCE||os.tmpdir(),`stage3-${scenario}-`)),file=path.join(root,'events.jsonl');const child=fork(path.join(__dirname,'termination-fixture.cjs'),[file],{stdio:['ignore','ignore','ignore','ipc']});
  const messages=[],actions=[];let outer=false;const result=await new Promise((resolve,reject)=>{
    const signalChild=signal=>{const accepted=child.kill(signal);actions.push({utc:new Date().toISOString(),signal,accepted});};
    const deadline=setTimeout(()=>{outer=true;signalChild(process.platform==='win32'?'SIGTERM':'SIGKILL');},scenario==='outer_timeout'?800:8000);
    child.on('message',m=>{messages.push(m);if(m.type==='ready')child.send('event');else if(m.type==='write-callback'&&m.seq<3)child.send('event');else if(m.type==='write-callback'&&m.seq===3){if(scenario==='normal')child.send('normal');else if(scenario==='controlled_sigterm')signalChild('SIGTERM');else if(scenario==='forced')signalChild(process.platform==='win32'?'SIGTERM':'SIGKILL');else if(scenario==='tail_loss')child.send('unwritten');else child.send('hold');}else if(m.type==='unwritten-observed')signalChild(process.platform==='win32'?'SIGTERM':'SIGKILL');});
    child.on('error',reject);child.on('exit',(code,signal)=>{clearTimeout(deadline);resolve({code,signal});});
  });
  const final=messages.find(m=>m.type==='final'),classification=classify({outerTimeout:outer,signal:result.signal,controlledSignal:final?.reason==='sigterm'?'SIGTERM':null,exitCode:result.code});
  fs.writeFileSync(path.join(root,'outcome.json'),JSON.stringify({scenario,utc:new Date().toISOString(),platform:process.platform,outerTimeout:outer,result,messages,actions,classification},null,2)+'\n',{flag:'wx'});
  const rows=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);const stats=audit(rows.map(x=>x.seq),{finalObserved:final?.lastObserved??null});
  assert.equal(rows.length,3);assert.equal(stats.gaps,0);assert.equal(stats.unconfirmedTail,'UNKNOWN');
  if(scenario==='normal'){assert.equal(classification.outcome,'normal');assert.equal(final.reason,'normal');}
  if(scenario==='controlled_sigterm'){assert.equal(final.reason,'sigterm');assert.equal(result.code,143);assert.equal(classification.outcome,'controlled_sigterm');}
  if(scenario==='forced'){assert.ok(['forced_termination','windows_terminated'].includes(classification.outcome));assert.equal(final,undefined);}
  if(scenario==='outer_timeout'){assert.equal(classification.outcome,'outer_timeout');assert.equal(final,undefined);}
  if(scenario==='tail_loss'){const oracle=messages.find(m=>m.type==='unwritten-observed');assert.equal(oracle.seq,4);assert.equal(audit(rows.map(x=>x.seq),{finalObserved:oracle.seq}).minimumMissingAtTail,1);assert.equal(final,undefined);}
});
