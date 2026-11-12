'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {trace}=require('../chart-webkit-stage3/stage4-trace.cjs');
const {createLedger}=require('../chart-webkit-stage3/ledger.cjs');
test('trace records ordered process-local events and successful and failed write callbacks',async()=>{
  const dir=fs.mkdtempSync(path.join(process.cwd(),'stage4-check-')),file=path.join(dir,'trace.jsonl');
  const previous=process.env.CHART_STAGE4_TRACE;process.env.CHART_STAGE4_TRACE=file;
  try{
    trace('first');
    const ledger=createLedger('unused',{injectedWrite:(payload,done)=>done(JSON.parse(payload).type==='bad'?Error('injected'):null)});
    assert.equal(await ledger.append({type:'good',requestId:1}),true);
    assert.equal(await ledger.append({type:'bad',requestId:2}),false);
    trace('last');
    const lines=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines.map(x=>x.type),['first','ledger-write-callback','ledger-write-callback','last']);
    assert.deepEqual(lines.slice(1,3).map(x=>x.ok),[true,false]);
    assert.ok(lines.every(x=>x.pid===process.pid&&x.origin==='child'&&x.utc&&Number.isFinite(x.monoMs)));
    assert.equal(new Set(lines.map(x=>x.id)).size,lines.length);
    assert.ok(lines.every((x,i)=>i===0||x.monoMs>=lines[i-1].monoMs));
  }finally{if(previous===undefined)delete process.env.CHART_STAGE4_TRACE;else process.env.CHART_STAGE4_TRACE=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
