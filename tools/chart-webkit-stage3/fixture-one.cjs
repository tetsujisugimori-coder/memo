'use strict';
// Synthetic data only. This is not a product Chart test.
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const {webkit}=require('playwright');const {createLedger}=require('./ledger.cjs');const {attachBrowser}=require('./recorder.cjs');
const {startResourceSampling}=require('./resource.cjs');
const [mode,index,output]=process.argv.slice(2);if(!['none','light','detailed'].includes(mode)||!['1','2','3'].includes(index)||!output)throw Error('invalid synthetic trial');
const html=`<!doctype html><meta charset="utf-8"><div class="chart-block-editor"><div class="chart-block-item-row" data-chart-item-index="1"><input aria-label="2件目の売上の数値" data-chart-series-value="true" data-chart-series-index="0" value="140"><button data-chart-action="move-item-down">move</button></div><div class="chart-block-status"></div></div><script>
window.fixtureEvents=[];const ids=new WeakMap();let n=0;function id(x){if(!ids.has(x))ids.set(x,++n);return ids.get(x)}
for(const k of ['beforeinput','input','focusin','focusout','click'])document.addEventListener(k,e=>{if(e.target.closest?.('.chart-block-editor'))fixtureEvents.push({kind:k,id:id(e.target),value:e.target.value||'',active:document.activeElement?.getAttribute('aria-label')||document.activeElement?.dataset.chartAction||null});},true);
window.firstInput=document.querySelector('input');document.querySelector('.chart-block-editor').addEventListener('click',e=>{if(!e.target.closest('button'))return;if(document.querySelector('input').value==='Infinity'){document.querySelector('.chart-block-status').textContent='invalid';document.querySelector('input').focus();return;}const row=document.querySelector('.chart-block-item-row');row.replaceWith(row.cloneNode(true));requestAnimationFrame(()=>document.querySelector('button').focus());});
requestAnimationFrame(()=>document.querySelector('button').focus());</script>`;
async function main(){
  const start=performance.now(),cpu=process.cpuUsage(),rss0=process.memoryUsage().rss,resources=startResourceSampling();
  const ledger=mode==='none'?null:createLedger(path.join(output,`events-${mode}-${index}.jsonl`));
  const browser=await webkit.launch({headless:true});if(ledger)attachBrowser(browser,ledger,{mode,boundaryMs:500});
  const context=await browser.newContext({viewport:{width:1100,height:820}}),page=await context.newPage();
  page.setDefaultTimeout(10000);await page.goto('data:text/html;charset=utf-8,'+encodeURIComponent(html));
  await page.waitForFunction(()=>document.activeElement?.dataset.chartAction==='move-item-down');
  await page.locator('button').click();await page.waitForFunction(()=>document.activeElement?.dataset.chartAction==='move-item-down'&&document.querySelector('input')!==window.firstInput);
  const input=page.locator('input');await input.fill('Infinity');await page.locator('button').click();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='2件目の売上の数値'&&document.querySelector('.chart-block-status')?.textContent==='invalid');
  const observed=await page.evaluate(()=>({value:document.querySelector('input').value,focus:document.activeElement?.getAttribute('aria-label'),inputRebuiltBeforeFill:document.querySelector('input')!==window.firstInput,events:window.fixtureEvents}));resources.sample();
  if(index==='1')await page.close();else if(index==='2'){await page.reload();await context.close();}else await browser.close();
  if(index!=='3')await browser.close();
  const flushStart=performance.now();const ledgerClose=ledger?await ledger.close(1000):null;
  const cp=process.cpuUsage(cpu),sampledResources=resources.stop();const result={mode,index,utc:new Date().toISOString(),node:process.version,platform:process.platform,browser:browser.version(),durationMs:performance.now()-start,nodeCpuMicros:cp,nodeRssBefore:rss0,nodeRssAfter:process.memoryUsage().rss,sampledResources,flushMs:performance.now()-flushStart,ledger:ledger?{...ledger.state,close:ledgerClose}:null,observed};
  fs.writeFileSync(path.join(output,`result-${mode}-${index}.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  if(observed.value!=='Infinity'||observed.focus!=='2件目の売上の数値'||!observed.inputRebuiltBeforeFill||(ledger&&(ledger.state.failed||ledger.state.rejected||!ledgerClose.ok)))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
