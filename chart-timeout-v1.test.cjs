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
const row={id:1,phase:'before',predicate:'2件目の売上の数値',snapshot};
const end={id:1,phase:'after',snapshot:{...snapshot,time:2}};
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
