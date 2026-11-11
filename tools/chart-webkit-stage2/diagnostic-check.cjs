'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const preload = path.join(__dirname,'preload.cjs');
const fixture = `const {webkit}=require('playwright');
(async()=>{const browser=await webkit.launch({headless:true});const page=await browser.newPage();
await page.goto('data:text/html;charset=utf-8,'+encodeURIComponent('<div class="chart-block-editor"><div class="chart-block-item-row" data-chart-item-index="1"><input data-chart-series-value data-chart-series-index="0" aria-label="2件目の売上の数値"><button data-chart-action="move-item-down">move</button></div><div class="chart-block-status"></div></div>'));
await page.locator('input').fill('Infinity');await page.locator('button').click();
if(process.env.CHART_STAGE2_MODE==='detailed'){try{await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='2件目の売上の数値' && false,null,{timeout:200});}catch(_){}}
await new Promise(r=>setTimeout(r,1400));await page.close();await browser.close();})().catch(e=>{console.error(e);process.exitCode=1});`;
for (const mode of ['light','detailed']) test(`${mode}: ordered node identity and evidence`,()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chart-stage2-smoke-'));const script=path.join(dir,'chart-block.e2e.js');fs.writeFileSync(script,fixture);
  const child=spawnSync(process.execPath,['--require',preload,script],{cwd:process.cwd(),encoding:'utf8',timeout:30000,env:{...process.env,CHART_STAGE2_MODE:mode,CHART_STAGE2_OUTPUT:dir,NODE_PATH:path.dirname(path.dirname(require.resolve('playwright')))}});
  assert.equal(child.status,0,child.stderr || String(child.error));
  const processDir=fs.readdirSync(dir).find(x=>x.startsWith('process-'));assert.ok(processDir);
  const records=fs.readFileSync(path.join(dir,processDir,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const events=records.flatMap(r=>r.payload?.events || []);const before=events.find(e=>e.kind==='beforeinput' && e.target?.aria==='2件目の売上の数値');const input=events.find(e=>e.kind==='input' && e.target?.value==='Infinity');
  assert.ok(before && input);assert.equal(before.target.id,input.target.id);assert.ok(before.seq<input.seq);assert.ok(before.t<=input.t);
  assert.ok(events.some(e=>e.kind==='click' && e.state?.fields?.some(f=>f.value==='Infinity')));
  if(mode==='light') assert.ok(records.some(r=>r.type==='boundary' && r.operation==='close'));
  else {assert.ok(records.some(r=>r.type==='wait-end' && r.outcome==='rejected'));assert.ok(records.some(r=>r.type==='timeout-snapshot'));}
  const exit=JSON.parse(fs.readFileSync(path.join(dir,processDir,'exit.json'),'utf8'));assert.equal(exit.writeErrors,0);assert.equal(exit.rejected,0);
});
