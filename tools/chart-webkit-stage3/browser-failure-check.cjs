'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {webkit}=require('playwright'),{createLedger}=require('./ledger.cjs'),{attachBrowser}=require('./recorder.cjs');
const {descendants,stat}=require('../chart-webkit-stage2/process-tree.cjs');
test('owned synthetic browser process kill is distinct from a requested close',{timeout:20000,skip:process.platform!=='linux'},async()=>{
  const root=fs.mkdtempSync(path.join(process.env.CHART_STAGE3_EVIDENCE||os.tmpdir(),'stage3-browser-crash-')),file=path.join(root,'events.jsonl'),ledger=createLedger(file);
  const server=await webkit.launchServer({headless:true}),owned=server.process(),browser=await webkit.connect(server.wsEndpoint());attachBrowser(browser,ledger,{mode:'detailed',boundaryMs:300});const page=await browser.newPage();
  await page.goto('data:text/html,<div class="chart-block-editor"><input></div>');await page.locator('input').fill('Infinity');
  const disconnected=new Promise(resolve=>browser.once('disconnected',resolve));const exit=new Promise(resolve=>owned.once('exit',(code,signal)=>resolve({code,signal})));
  assert.ok(owned.pid>0);const captured=descendants(owned.pid);for(const p of captured.filter(x=>x.pid!==owned.pid).reverse()){const current=stat(p.pid);if(current&&current.start===p.start)try{process.kill(p.pid,'SIGKILL');}catch(_){}}
  assert.equal(owned.kill('SIGKILL'),true);await disconnected;const observed=await exit;fs.writeFileSync(path.join(root,'outcome.json'),JSON.stringify({utc:new Date().toISOString(),ownedPid:owned.pid,captured,observed,controllerClassification:observed.signal==='SIGKILL'?'owned_browser_sigkill_confirmed':'UNKNOWN',recorderDisconnectCause:'UNKNOWN',untrackedDescendants:'UNKNOWN'},null,2)+'\n',{flag:'wx'});assert.equal(observed.signal,'SIGKILL');await ledger.close(1000);
  const records=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse),event=records.find(x=>x.type==='browser-disconnected');assert.ok(event);assert.equal(event.closePhase,'not_requested');assert.equal(event.cause,'UNKNOWN');assert.equal(event.unconfirmedTail,'UNKNOWN');
  try{await server.close();}catch(_){}
});
