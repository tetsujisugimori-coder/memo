'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const pw=require('playwright');
const {createServer,openApp,saved,snapshot}=require('./note-conflict-test-support.cjs');
const {waitForOutcome}=require('./note-conflict-observer.cjs');
const {openFeaturePalette}=require('./feature-palette.e2e-support.js');
const out=process.env.MEMO_INTEGRATION_OUTPUT||'/tmp/memo-integration-435-evidence/integration';
(async()=>{await fs.mkdir(out,{recursive:true});const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;const results=[];
try{for(const engine of (process.env.MEMO_INTEGRATION_ENGINES||'chromium,webkit').split(',')){let browser;try{browser=await pw[engine].launch();for(const width of (process.env.MEMO_INTEGRATION_WIDTHS||'375,390,765,1280').split(',').map(Number)){for(const reducedMotion of ['no-preference','reduce']){const key=`${engine}-${width}-${reducedMotion}`,row={key,status:'FAIL'},context=await browser.newContext({viewport:{width,height:900},reducedMotion});await context.tracing.start({screenshots:true,snapshots:true,sources:true});try{
await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.fulfill({status:200,contentType:r.request().resourceType()==='stylesheet'?'text/css':'application/javascript',body:''}));
const a=await context.newPage(),b=await context.newPage();for(const p of [a,b])p.setDefaultTimeout(10000);
await openApp(a,origin);const id=await a.evaluate(()=>currentId);await a.locator('#editor').fill('integration base');await saved(a,id,'integration base');await openApp(b,origin);assert.equal(await b.evaluate(()=>currentId),id);
for(const p of [a,b])await openFeaturePalette(p);
await Promise.all([a.locator('#editor').fill('draft A'),b.locator('#editor').fill('draft B')]);
const outcome=await waitForOutcome([a,b],id);assert.equal(outcome.kind,'conflict-stopped');const blocked=outcome.states[0].stored.body==='draft A'?b:a;
await blocked.locator('[data-memo-conflict-resume]').waitFor({state:'visible'});const before=await blocked.locator('#editor').inputValue(),storeBefore=await snapshot(blocked);
if(!await blocked.locator('#featurePalette').isVisible())await openFeaturePalette(blocked);
await blocked.locator('#insertTableBtn').click();assert.equal(await blocked.locator('#editor').inputValue(),before,'locked draft cannot change through palette');
assert.deepEqual((await snapshot(blocked)).stores,storeBefore.stores,'blocked command must not write');
await blocked.keyboard.press('Escape');await blocked.locator('[data-memo-conflict-resume]').click();assert.equal(await blocked.locator('#editor').getAttribute('readonly'),null);
await openFeaturePalette(blocked);await blocked.locator('#insertTableBtn').click();assert.notEqual(await blocked.locator('#editor').inputValue(),before,'table works after explicit recovery');
await blocked.keyboard.press('Escape');const body=await blocked.locator('#editor').inputValue();await saved(blocked,id,body);
assert.ok(await blocked.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await blocked.screenshot({path:path.join(out,`${key}.png`),fullPage:true});row.status='PASS';row.snapshot=await snapshot(blocked);
}catch(e){row.error=e.stack;}finally{await context.tracing.stop({path:path.join(out,`${key}.zip`)});await context.close();results.push(row);await fs.writeFile(path.join(out,'results.json'),JSON.stringify({results},null,2));}}}
}catch(e){results.push({engine,status:'NOT_TESTED',error:e.stack});}finally{await browser?.close();}}}finally{server.close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify({results},null,2));}console.log(results.map(r=>({key:r.key,engine:r.engine,status:r.status,error:r.error})));if(results.some(r=>r.status!=='PASS'))process.exitCode=1;})();
