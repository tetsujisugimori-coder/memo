'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('full-suite entry preloader records normal process and browser boundaries',{timeout:20000},()=>{
  const scriptRoot=fs.mkdtempSync(path.join(os.tmpdir(),'stage3-preload-script-')),root=fs.mkdtempSync(path.join(process.env.CHART_STAGE3_EVIDENCE||os.tmpdir(),'stage3-preload-output-')),script=path.join(scriptRoot,'chart-block.e2e.js');
  fs.writeFileSync(script,`const {webkit}=require('playwright');(async()=>{const b=await webkit.launch({headless:true}),p=await b.newPage();await p.goto('data:text/html,<div class="chart-block-editor"><input></div>');await p.locator('input').fill('Infinity');await b.close();})().catch(e=>{console.error(e);process.exitCode=1});`);
  const child=spawnSync(process.execPath,['--require',path.join(__dirname,'preload.cjs'),script],{cwd:process.cwd(),encoding:'utf8',timeout:15000,env:{...process.env,CHART_STAGE3_MODE:'detailed',CHART_STAGE3_OUTPUT:root,NODE_PATH:path.dirname(path.dirname(require.resolve('playwright')))}});
  fs.writeFileSync(path.join(root,'outcome.json'),JSON.stringify({utc:new Date().toISOString(),status:child.status,signal:child.signal,error:child.error?String(child.error):null,stderr:child.stderr},null,2)+'\n',{flag:'wx'});assert.equal(child.status,0,child.stderr||String(child.error));const name=fs.readdirSync(root).find(x=>x.startsWith('process-'));assert.ok(name);
  const exit=JSON.parse(fs.readFileSync(path.join(root,name,'exit.json'),'utf8'));assert.equal(exit.code,0);assert.equal(exit.finishResult?.reason,'normal');assert.equal(exit.ledger.failed,0);assert.equal(exit.ledger.rejected,0);
  const records=fs.readFileSync(path.join(root,name,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.ok(records.some(r=>r.type==='boundary-snapshot'&&r.reason==='browser.close'));assert.ok(records.some(r=>r.type==='browser-close-native-returned'));
});
test('beforeExit normal does not make a nonzero process successful',{timeout:15000},()=>{
  const scriptRoot=fs.mkdtempSync(path.join(os.tmpdir(),'stage3-exit-script-')),root=fs.mkdtempSync(path.join(process.env.CHART_STAGE3_EVIDENCE||os.tmpdir(),'stage3-exit-output-')),script=path.join(scriptRoot,'chart-block.e2e.js');fs.writeFileSync(script,'process.exitCode=7;');
  const child=spawnSync(process.execPath,['--require',path.join(__dirname,'preload.cjs'),script],{cwd:process.cwd(),encoding:'utf8',timeout:10000,env:{...process.env,CHART_STAGE3_MODE:'detailed',CHART_STAGE3_OUTPUT:root,NODE_PATH:path.dirname(path.dirname(require.resolve('playwright')))}});
  const name=fs.readdirSync(root).find(x=>x.startsWith('process-'));const exit=name?JSON.parse(fs.readFileSync(path.join(root,name,'exit.json'),'utf8')):null;fs.writeFileSync(path.join(root,'outcome.json'),JSON.stringify({utc:new Date().toISOString(),status:child.status,signal:child.signal,exit},null,2)+'\n',{flag:'wx'});
  assert.equal(child.status,7);assert.equal(exit?.code,7);assert.equal(exit?.finishResult?.reason,'normal');
});
