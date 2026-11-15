'use strict';
const fs=require('node:fs'); const path=require('node:path');
function snapshot() {
 const utils=window.MemoNexusChartBlockUtils;
 const current=utils?.splitChartBlocks(document.getElementById('editor')?.value||'').find(s=>s.type==='chart')?.chart||null;
 const totals=current ? utils.chartStackedTotals(current.items,current.series) : [];
 const labels=[...document.querySelectorAll('#preview .chart-block-stacked-total-value')].map(e=>e.textContent);
 const status=document.querySelector('.chart-block-editor .chart-block-status')?.textContent;
 const focus=document.activeElement?.getAttribute('aria-label');
 return {time:performance.now(),current,inputs:[...document.querySelectorAll('.chart-block-editor input')].map(e=>({value:e.value,label:e.getAttribute('aria-label'),item:e.closest('[data-chart-item-index]')?.dataset.chartItemIndex})),focus,status,labels,events:window.__chartDiagnosticEvents||[],conditions:{legacyFocus:focus==='2件目の売上の数値',legacyStatus:status==='数値は有限な数値を入力してください',stacked:current?.appearance?.barMode==='stacked',showTotals:current?.appearance?.showStackTotals===true,oneSeries:current?.series.length===1,fiveItems:current?.items.length===5,valuesMatch:JSON.stringify(current?.series[0]?.values)===JSON.stringify([Number.MAX_VALUE,1.7e308,1.6e308,1.5e308,1.4e308]),fiveLabels:labels.length===5,labelsMatch:labels.length===5&&labels.every((v,i)=>v===utils.formatChartStackTotal(totals[i]))}};
}
async function attach(page) {
 await page.addInitScript(()=>{window.__chartDiagnosticEvents=[];for(const type of ['input','change','click','focusin','focusout'])document.addEventListener(type,e=>{if(!e.target.closest?.('.chart-block-editor'))return;const rows=window.__chartDiagnosticEvents;rows.push({time:performance.now(),type,value:e.target.value,label:e.target.getAttribute('aria-label'),action:e.target.dataset.chartAction});if(rows.length>1000)rows.shift();},true);});
 const original=page.waitForFunction.bind(page); let seq=0;
 const write=(r)=>fs.appendFileSync(path.join(process.env.CHART_DIAGNOSTIC_OUTPUT,'waits.jsonl'),JSON.stringify(r)+'\n');
 page.waitForFunction=async function(fn,arg,options){
   const predicate=String(fn); const targeted=predicate.includes('2件目の売上の数値')||predicate.includes('labels.every((label, index)');
   if(!targeted)return original(fn,arg,options);
   const id=++seq;write({id,phase:'before',predicate,snapshot:await page.evaluate(snapshot)});
   try {const result=await original(fn,arg,options);write({id,phase:'after',snapshot:await page.evaluate(snapshot)});return result;}
   catch(error){try {write({id,phase:'failure',error:String(error),snapshot:await page.evaluate(snapshot)});}catch(capture){write({id,phase:'capture-error',error:String(capture)});}throw error;}
 };
}
module.exports={attach,snapshot};
