'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {auditFlushes}=require('./flush-audit.cjs');
test('missing, failed, duplicated, late and unrelated flush outcomes are detected',()=>{
  const p={processId:'p',pageId:1};const o=auditFlushes([{...p,type:'flush-request',requestId:1},{...p,type:'flush-result',requestId:1,result:'timeout'},{...p,type:'flush-request',requestId:2},{...p,type:'flush-result',requestId:3,result:'callback_completed'},{...p,type:'late-write-callback',requestId:1}]);
  if(process.env.CHART_STAGE3_EVIDENCE)fs.writeFileSync(path.join(process.env.CHART_STAGE3_EVIDENCE,'flush-audit-injection.json'),JSON.stringify({utc:new Date().toISOString(),result:o},null,2)+'\n',{flag:'wx'});
  assert.deepEqual(o,{requests:2,results:2,missing:1,unmatched:1,duplicates:0,failed:1,late:1});
});
test('empty recorder output cannot pass the synthetic gate',()=>{
  const root=fs.mkdtempSync(path.join(process.env.CHART_STAGE3_EVIDENCE||os.tmpdir(),'stage3-analysis-')),plan=[];
  for(const mode of ['none','light','detailed'])for(let i=1;i<=3;i++){const index=String(i);plan.push({mode,index,status:'PASS'});fs.writeFileSync(path.join(root,`result-${mode}-${index}.json`),JSON.stringify({durationMs:1,observed:{value:'Infinity'},ledger:null}));if(mode!=='none')fs.writeFileSync(path.join(root,`events-${mode}-${index}.jsonl`),'');}
  fs.writeFileSync(path.join(root,'plan.json'),JSON.stringify({plan,results:plan}));const r=spawnSync(process.execPath,[path.join(__dirname,'synthetic-analyze.cjs'),root],{encoding:'utf8'});assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).acceptance.status,'BLOCKED');
});
