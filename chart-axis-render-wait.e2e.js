"use strict";
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const playwright=require('playwright');
const {createChartBlock,serializeChartBlock}=require('./chart-block-utils.js');
(async()=>{
const root=path.resolve(process.argv[2]||__dirname),helper=require(path.join(root,'chart-combo-dual-axis.e2e.js')),out=process.argv[3]||'stale-results.json',result=[];
const server=http.createServer((req,res)=>{const p=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));fs.readFile(p,(err,b)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':'application/javascript');res.end(b);});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await playwright[process.env.MEMO_NEXUS_E2E_BROWSER||'chromium'].launch();
try{for(let run=1;run<=3;run++){
 const page=await browser.newPage({viewport:{width:1100,height:820}});await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);await page.locator('#appStartupGuard').waitFor({state:'hidden'});
 const seed=createChartBlock('stale-zero');const model={...seed,chartType:'combo',unit:'万円',items:[0,1,2].map(i=>({id:'i'+i,label:'項目'+i})),series:[{id:'bar',name:'売上',color:'#4455cc',values:[350,0,0]},{id:'line',name:'成長率',color:'#cc5544',values:[12,0,0]}],appearance:{...seed.appearance,showLegend:true,comboAxisMode:'dual',comboLineSeriesId:'line',comboSecondaryUnit:'%',leftAxisTitle:'売上',rightAxisTitle:'成長率'}};
 await page.locator('#editor').fill(serializeChartBlock(model));await page.waitForFunction(()=>document.querySelector('#preview .chart-block-combo-dual .chart-block-bar title')?.textContent.includes('350万円'));
 await page.evaluate(()=>{MemoNexusTypingDerivedUiScheduler.beginComposition(currentId);});
 const panel=page.locator('.chart-block-editor');await panel.locator('[data-chart-item-index="1"] input[data-chart-series-index="0"]').fill('-20');await panel.locator('[data-chart-item-index="1"] input[data-chart-series-index="1"]').fill('-0.3');
 const edited=await page.evaluate(()=>MemoNexusChartBlockUtils.splitChartBlocks(editor.value).find(s=>s.type==='chart').chart);
 const state=await page.evaluate(()=>{const f=preview.querySelector('.chart-block-combo-dual'),svg=f.querySelector('svg'),axis=svg.querySelector('.chart-block-axis');return {zero:Number(svg.querySelector('.chart-block-zero-line').getAttribute('y1')),top:Number(axis.getAttribute('y1')),bottom:Number(axis.getAttribute('y2')),marks:[...f.querySelectorAll('.chart-block-bar title,.chart-block-line-item title')].map(e=>e.textContent),pending:MemoNexusTypingDerivedUiScheduler.pendingRequestType()};});
 state.expected=(state.top+state.bottom)/2;assert.notEqual(state.zero,state.expected,'delayed preview really contains old geometry');
 // Release the deliberately held update only when the verifier waits for SVG data.
 // This proves that an attachment-only wait can read the obsolete drawing.
 let waited=false;const proxy=new Proxy(page,{get(target,key){if(key==='waitForFunction')return async(...args)=>{waited=true;await page.evaluate(()=>MemoNexusTypingDerivedUiScheduler.endComposition(currentId));return page.waitForFunction(...args);};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 let outcome;try{await helper.verifyDualGeometry(proxy,edited);outcome='pass';}catch(e){outcome='fail';state.error=e.message;}
 await page.evaluate(()=>MemoNexusTypingDerivedUiScheduler.endComposition(currentId));await page.waitForFunction(()=>document.querySelector('#preview .chart-block-combo-dual .chart-block-bar[data-chart-item-id="i1"] title')?.textContent.endsWith('-20万円'));
 await helper.verifyDualGeometry(page,edited);result.push({run,state,waited,outcome,afterCurrentRendering:'pass'});await page.close();
}fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
assert.ok(result.every(r=>r.waited&&r.outcome==='pass'),'current SVG data must be awaited in all three delayed-render cases');
}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
