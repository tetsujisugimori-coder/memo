'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const cp=require('node:child_process');
const {generate,analyzeOriginal,SOURCE_HASH,hash}=require('./scripts/chart-timeout-v1.cjs');
// Read the checked-out Git blob (not CRLF-converted worktree); generate() still requires the fixed SHA-256.
const source=cp.execFileSync('git',['show','HEAD:chart-block.e2e.js'],{encoding:'utf8'});
for(const scenario of ['legacy','narrow'])test('fixed extraction '+scenario,()=>{const s=generate(source,scenario);new vm.Script(s);assert.match(s,/Timeout|timeout: 30000/);assert.ok(s.includes('invalidReorderValue.fill("Infinity")'));assert.equal(s.includes('const narrowTotalLayout'),false);assert.equal(s.includes('const narrowValues'),scenario==='narrow');assert.ok(s.includes('await closeStaticServer(server)'));});
test('source drift rejected',()=>assert.throws(()=>generate(source+'\n','legacy'),/SOURCE_MISMATCH/));
test('scenario rejected',()=>assert.throws(()=>generate(source,'unknown'),/SCENARIO/));
test('pinned hash',()=>assert.equal(hash(source),SOURCE_HASH));
test('missing observation stays UNKNOWN',()=>assert.equal(analyzeOriginal('','webkit',1).result,'UNKNOWN'));
test('original failure remains FAIL',()=>{const r=analyzeOriginal('Chart failure state: {"charts":[]}\nchart-block.e2e.js:1620:16','webkit',2);assert.equal(r.result,'FAIL');assert.equal(r.cause,'UNKNOWN');assert.equal(r.dom,'NOT_OBTAINED');});
test('malformed original state rejected',()=>assert.throws(()=>analyzeOriginal('Chart failure state: {oops}\n','webkit',1)));
test('no inferred successful result',()=>assert.equal(analyzeOriginal('all good','chromium',2).result,'UNKNOWN'));
test('observations do not remove source assertions',()=>{const s=generate(source,'legacy');for(const fragment of ['不正な編集中の文字列を並べ替えで破棄しない','不正値では項目を移動しない','数値は有限な数値を入力してください'])assert.ok(s.includes(fragment));});
const {auditWaits}=require('./scripts/chart-timeout-v1.cjs');
const snapshot={time:1,current:{items:[],series:[],appearance:{}},focus:null,status:null,inputs:[],labels:[],events:[],conditions:{legacyFocus:true,legacyStatus:true}};
const row={targetId:"chart-v1:legacy:infinity-rejection",id:1,phase:'before',predicate:'2件目の売上の数値',snapshot};
const end={targetId:"chart-v1:legacy:infinity-rejection",id:1,phase:'after',snapshot:{...snapshot,time:2}};
const encoded=(...r)=>r.map(x=>JSON.stringify(x)).join('\n');
test('narrow does not inherit legacy reach',()=>assert.equal(auditWaits(encoded(row,end),'narrow').targetReached,false));
test('complete target accepts',()=>assert.equal(auditWaits(encoded(row,end),'legacy').evidence,'COMPLETE'));
test('missing terminal rejects',()=>assert.equal(auditWaits(encoded(row),'legacy').evidence,'INCOMPLETE'));
test('missing snapshot rejects',()=>assert.equal(auditWaits(encoded(row,{...end,snapshot:null}),'legacy').evidence,'INCOMPLETE'));
test('duplicate target rejects',()=>assert.equal(auditWaits(encoded(row,row,end),'legacy').evidence,'INCOMPLETE'));
test('capture failure rejects',()=>assert.equal(auditWaits(encoded(row,{id:1,phase:'capture-error'}),'legacy').evidence,'INCOMPLETE'));
test('reversed order rejects',()=>assert.equal(auditWaits(encoded(end,row),'legacy').evidence,'INCOMPLETE'));
test('malformed json rejects',()=>assert.throws(()=>auditWaits('{','legacy')));

test('post predicate changed but measured is not missing',()=>assert.equal(auditWaits(encoded(row,{...end,snapshot:{...snapshot,conditions:{legacyFocus:false,legacyStatus:true}}}),'legacy').evidence,'COMPLETE'));
test('generated diagnostic cannot fallback to Windows Chromium1194',()=>assert.equal(generate(source,'legacy').includes('chromium_headless_shell-1194'),false));

test('missing correlation id rejects',()=>assert.equal(auditWaits(encoded({...row,id:undefined},{...end,id:undefined}),'legacy').evidence,'INCOMPLETE'));
test('failure requires original error',()=>assert.equal(auditWaits(encoded(row,{...end,phase:'failure'}),'legacy').evidence,'INCOMPLETE'));
test('empty current rejects',()=>assert.equal(auditWaits(encoded(row,{...end,snapshot:{...snapshot,current:{}}}),'legacy').evidence,'INCOMPLETE'));
test('explicit measured false is accepted',()=>assert.equal(auditWaits(encoded(row,{...end,phase:'failure',error:'Timeout 30000ms',snapshot:{...snapshot,conditions:{legacyFocus:false,legacyStatus:false}}}),'legacy').evidence,'COMPLETE'));

// Non-browser integration: execute the actual generated call expressions against
// a mock page; predicates are forwarded, never evaluated as product evidence.
const {TARGETS,identifyTargets}=require('./scripts/chart-timeout-v1.cjs');
const {attach}=require('./scripts/chart-timeout-v1-observer.cjs');
const path=require('node:path'),os=require('node:os');
function actualCalls(runner,scenario){
 const lines=runner.split('\n'),out=[];
 for(let i=0;i<lines.length;i++)if(/^    await page\.(?:waitForFunction|__chartDiagnosticWait)\(/.test(lines[i])){
  let text=lines[i];while(true){try{new vm.Script('(async()=>{'+text+'})()');break;}catch{if(++i>=lines.length)throw Error('unterminated wait');text+='\n'+lines[i];}}
  if(text.includes(scenario==='legacy'?'2件目の売上の数値':'labels.every((label, index)'))out.push(text);
 }
 assert.equal(out.length,2,'actual preceding and target calls');return out;
}
async function observed(scenario,mode){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memo-chart-v1-contract-'));
 const previous=process.env.CHART_DIAGNOSTIC_OUTPUT;process.env.CHART_DIAGNOSTIC_OUTPUT=dir;
 let time=0;const forwarded=[];
 const page={addInitScript:async()=>{},waitForFunction:async(...args)=>{forwarded.push(args);if(mode==='timeout'&&forwarded.length===2)throw Error('Timeout 30000ms');return 'result';},evaluate:async()=>({...snapshot,time:++time,conditions:{legacyFocus:false,legacyStatus:false,stacked:false,showTotals:false,oneSeries:false,fiveItems:false,valuesMatch:false,fiveLabels:false,labelsMatch:false}})};
 try{
  await attach(page);const originalWait=page.waitForFunction;
  const calls=actualCalls(generate(source,scenario),scenario);
  for(const call of calls.slice(0,mode==='preceding'?1:2)){
   const execute=()=>vm.runInNewContext('(async()=>{'+call+'})()', {page,narrowValues:[Number.MAX_VALUE,1.7e308,1.6e308,1.5e308,1.4e308]});
   if(mode==='timeout'&&forwarded.length===1)await assert.rejects(execute,/Timeout 30000ms/);else await execute();
  }
  assert.equal(page.waitForFunction,originalWait,'ordinary waits not wrapped');
  const rows=fs.existsSync(path.join(dir,'waits.jsonl'))?fs.readFileSync(path.join(dir,'waits.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[];
  if(mode!=='preceding'){
   const expected=[];await vm.runInNewContext('(async()=>{'+TARGETS[scenario].call+'})()', {page:{waitForFunction:async(...args)=>expected.push(args)},narrowValues:[Number.MAX_VALUE,1.7e308,1.6e308,1.5e308,1.4e308]});
   assert.equal(String(forwarded[1][0]),String(expected[0][0]));assert.equal(JSON.stringify(forwarded[1].slice(1)),JSON.stringify(expected[0].slice(1)),'arguments and options unchanged');
  }
  return rows;
 }finally{if(previous===undefined)delete process.env.CHART_DIAGNOSTIC_OUTPUT;else process.env.CHART_DIAGNOSTIC_OUTPUT=previous;fs.rmSync(dir,{recursive:true});}
}
for(const scenario of ['legacy','narrow']){
 test(scenario+' preceding wait alone is not target',async()=>assert.equal(auditWaits(encoded(...await observed(scenario,'preceding')),scenario).targetReached,false));
 for(const mode of ['complete','timeout'])test(scenario+' preceding plus target '+mode,async()=>{const r=auditWaits(encoded(...await observed(scenario,mode)),scenario);assert.equal(r.evidence,'COMPLETE');assert.equal(r.targetTerminal,mode==='complete'?'after':'failure');});
 test(scenario+' connected negative records',async()=>{
  const rows=await observed(scenario,'complete');
  const check=(changed,reason)=>{const r=auditWaits(encoded(...changed),scenario);assert.equal(r.evidence,'INCOMPLETE');assert.ok(r.reasons.includes(reason),JSON.stringify(r));};
  check([...rows,...rows],'DUPLICATE_TARGET');
  check(rows.slice(0,1),'TERMINAL_MISSING_OR_INVALID');
  check([rows[0],{...rows[1],id:rows[1].id+1}],'CORRELATION_MISMATCH');
  check([rows[0],{...rows[1],targetId:'foreign'}],'TARGET_ID_MISMATCH');
  check([rows[0],{...rows[1],snapshot:null}],'SNAPSHOT_INCOMPLETE');
 });
 test(scenario+' target absence and ambiguity rejected before generation',()=>{
  assert.throws(()=>identifyTargets(source.replace(TARGETS[scenario].call,'')),/TARGET_MISSING_OR_AMBIGUOUS/);
  assert.throws(()=>identifyTargets(source+'\n'+TARGETS[scenario].call),/TARGET_MISSING_OR_AMBIGUOUS/);
 });
}
