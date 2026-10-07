"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const playwright=require('playwright');
const {assets,buildSamples}=require('./report-fixed-samples.cjs');
const {splitTableBlocks}=require('./table-block-utils.js');
const {splitChartBlocks}=require('./chart-block-utils.js');
const engine=process.env.MEMO_NEXUS_E2E_BROWSER||'chromium';
const out=path.resolve(process.env.REPORT_FIXED_OUT||path.join(__dirname,'e2e-artifacts','report-fixed',engine));
const assetDir=path.join(__dirname,'docs','report-fixed-samples','assets');
const idle=page=>page.waitForFunction(()=>!noteSaveFoundation.isDirty(currentId)&&saveTimer===null&&window.MemoNexusTypingDerivedUiScheduler.pendingRequestType()===null);
async function snapshot(page){return page.evaluate(async()=>({body:editor.value,title:titleInput.value,attachments:currentAttachments.map(a=>({id:a.id,fileName:a.fileName})),stored:(await getStoredNotes()).find(n=>n.id===currentId).body}));}
async function ready(page){await page.evaluate(async()=>{await attachmentRenderPromise;await document.fonts.ready;await Promise.all([...preview.querySelectorAll('img')].map(i=>i.decode()));});}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  for(const name of fs.readdirSync(out))if(/^(R0[1-6](?:[-.]|$)|results\.json$|pdf-results\.json$|inspection\.log$)/.test(name)&&fs.statSync(path.join(out,name)).isFile())fs.unlinkSync(path.join(out,name));
  const summary={engine,node:process.version,platform:process.platform,sha:spawnSync('git',['rev-parse','HEAD'],{cwd:__dirname,encoding:'utf8'}).stdout.trim(),cases:[]};
  const persist=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(summary,null,2));
  const server=http.createServer((req,res)=>{const file=path.resolve(__dirname,decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html');if(!file.startsWith(__dirname+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'application/javascript');res.end(data);});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;let failed=false;
  try{
    browser=await playwright[engine].launch({headless:true});summary.browser=browser.version();
    for(const sampleId of ['R01','R02','R03','R04','R05','R06']){
      const result={id:sampleId,save:'未実施',preview:'未実施',pdf:'未実施',visual:'未実施',landscape:['R02','R03','R05'].includes(sampleId)?'未実施：現行製品はA4縦固定':'対象外：指定なし',margins:sampleId==='R05'?'未実施：現行製品は20mm固定':'対象外：指定なし'};summary.cases.push(result);persist();
      const profile=fs.mkdtempSync(path.join(os.tmpdir(),'memo-report-fixed-'));
      const profiles=[profile];
      const openContext=async()=>engine==='webkit'?await playwright.webkit.launchPersistentContext(profiles.at(-1),{headless:true,viewport:{width:1280,height:900}}):await browser.newContext({viewport:{width:1280,height:900}});
      let context=await openContext(),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      try{
        await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#appStartupGuard').waitFor({state:'hidden'});
        // Fixed repository assets; missing inputs fail rather than regenerating a baseline.
        for(const [key] of assets){const file=path.join(assetDir,key+'.png');assert.ok(fs.existsSync(file),'Missing fixed asset '+file);
          await page.locator('#insertImageBlockBtn').click();await page.locator('#imageBlockInput').setInputFiles(file);await page.waitForFunction(name=>currentAttachments.some(a=>a.fileName===name),key+'.png');await page.evaluate(()=>flushSave());await idle(page);
        }
        const ids=await page.evaluate(()=>Object.fromEntries(currentAttachments.map(a=>[a.fileName.replace('.png',''),a.id])));
        const sample=buildSamples(ids).find(s=>s.id===sampleId);result.fixture=sample;
        fs.writeFileSync(path.join(out,sampleId+'.md'),sample.body);
        // Existing editor input/save route, with actual input events. No IndexedDB injection.
        await page.locator('#titleInput').fill(sample.title);await page.locator('#editor').fill(sample.body);
        if(sampleId==='R05'){await page.locator('#editor').press('ControlOrMeta+End');await page.locator('#editor').press('Enter');await page.locator('#editor').pressSequentially('R05編集操作で追加した確認文 [@s5]');}
        await page.evaluate(()=>flushSave());await idle(page);let before=await snapshot(page);assert.equal(before.body,before.stored);
        fs.writeFileSync(path.join(out,sampleId+'-saved.md'),before.body);
        await page.reload();await page.locator('#appStartupGuard').waitFor({state:'hidden'});await idle(page);assert.deepEqual(await snapshot(page),before);result.save='PASS';
        const downloadPromise=page.waitForEvent('download');await page.locator('#backupBtn').click();const archive=await downloadPromise;assert.equal(await archive.failure(),null);await archive.saveAs(path.join(out,sampleId+'.zip'));
        result.archive=sampleId+'.zip';
        if(sampleId!=='R01'){
          const noteId=await page.evaluate(()=>currentId);await context.close();profiles.push(fs.mkdtempSync(path.join(os.tmpdir(),'memo-report-fixed-')));
          context=await openContext();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
          await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#appStartupGuard').waitFor({state:'hidden'});
          await page.locator('#importMarkdownZipInput').setInputFiles(path.join(out,sampleId+'.zip'));
          await page.locator('#backupPreviewDialog').waitFor({state:'visible'});await page.locator('#confirmBackupPreviewBtn').click();await page.locator('#backupPreviewStatus').getByText(/取り込みが完了しました/).waitFor();await page.locator('#cancelBackupPreviewBtn').click();await page.evaluate(id=>openNote(id),noteId);await idle(page);
          const loaded=await snapshot(page);assert.equal(loaded.attachments.length,before.attachments.length);for(const old of before.attachments)assert.ok(loaded.attachments.some(a=>a.id===old.id),'Portable backup preserves attachment IDs');
          assert.equal(loaded.body,before.body,'Official portable backup import preserves exact body');assert.equal(loaded.title,before.title);before=loaded;
          await page.reload();await page.locator('#appStartupGuard').waitFor({state:'hidden'});await idle(page);assert.deepEqual(await snapshot(page),before);result.import='PASS';
          fs.writeFileSync(path.join(out,sampleId+'-imported.md'),before.body);
        }else result.import='対象外：正式編集操作で直接検証';
        await page.locator('#reportPreviewBtn').click();await ready(page);
        const actual=await page.locator('#preview [data-report-number]').evaluateAll(es=>es.map(e=>e.dataset.reportNumber));assert.deepEqual(actual,sample.numbers);result.numbers=actual;
        assert.equal(await page.locator('#preview .report-sources li').count(),sample.sourceCount);
        assert.equal(await page.locator('#preview .citation-missing').count(),0);
        result.previewText=await page.locator('#preview').innerText();result.captions=await page.locator('#preview .report-caption').allTextContents();
        const compact=t=>t.replace(/\s/g,'');
        let cursor=0;for(const expected of sample.expectedTexts){const at=compact(result.previewText).indexOf(compact(expected),cursor);assert.ok(at>=cursor,'Missing/out-of-order prose: '+expected.slice(0,50));cursor=at+compact(expected).length;}
        result.tableCells=splitTableBlocks(before.body).filter(b=>b.type==='table').map(b=>b.table.rows);
        for(const [index,rows] of result.tableCells.entries()){const actual=await page.locator('#preview .table-block').nth(index).locator('th, td').allTextContents();assert.deepEqual(actual,rows.flat(),'All table cells including blanks');}
        result.chartInputs=splitChartBlocks(before.body).filter(b=>b.type==='chart').map(b=>b.chart);
        for(const [index,chart] of result.chartInputs.entries()){
          const accessible=await page.locator('#preview .chart-block').nth(index).locator('.sr-only').innerText();
          for(const [i,item] of chart.items.entries())for(const series of chart.series){assert.ok(accessible.includes(item.label)&&accessible.includes(series.name)&&accessible.includes(String(series.values[i])),'Chart input/accessible rendering mismatch');}
        }
        result.imageRatios=await page.locator('#preview img').evaluateAll(es=>es.map(e=>{const box=e.getBoundingClientRect();return {natural:e.naturalWidth/e.naturalHeight,rendered:box.width/box.height};}));
        for(const ratio of result.imageRatios)assert.ok(Math.abs(ratio.natural-ratio.rendered)<0.01,'Image aspect ratio preserved');
        const pieBoxes=await page.locator('#preview .chart-block-pie-label').evaluateAll(es=>es.map(e=>{const b=e.getBBox();return {text:e.textContent,x:b.x,y:b.y,width:b.width,height:b.height};}));
        for(let i=0;i<pieBoxes.length;i++)for(let j=i+1;j<pieBoxes.length;j++){const a=pieBoxes[i],b=pieBoxes[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'Report pie labels overlap: '+a.text+'/'+b.text);}
        result.pieBoxes=pieBoxes;
        for(const width of [1280,390]){await page.setViewportSize({width,height:900});await ready(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await page.locator('#preview').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await page.screenshot({path:path.join(out,`${sampleId}-preview-${width}.png`),fullPage:true});}
        result.preview='PASS';
        if(engine==='chromium'){
          await page.setViewportSize({width:1280,height:900});
          for(const suffix of ['first','repeat']){assert.equal(await page.evaluate(()=>prepareReportPrint()),true);await page.emulateMedia({media:'print'});assert.equal(await page.locator('#preview').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await page.pdf({path:path.join(out,`${sampleId}-${suffix}.pdf`),preferCSSPageSize:true,displayHeaderFooter:false,printBackground:false});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await page.emulateMedia({media:'screen'});assert.deepEqual(await snapshot(page),before);}
          result.pdf='生成PASS・検査待ち';
        }else result.pdf='対象外：Playwright PDF出力はChromiumのみ';
        assert.deepEqual(errors,[]);result.errors=errors;
      }catch(error){failed=true;result.failure=error.stack;result.errors=errors;await page.screenshot({path:path.join(out,sampleId+'-failure.png'),fullPage:true}).catch(()=>{});console.error(sampleId,error.message);}
      finally{persist();await context.close();for(const directory of profiles)fs.rmSync(directory,{recursive:true,force:true});}
    }
    if(engine==='chromium'){const inspection=spawnSync(process.env.PYTHON||'python',[path.join(__dirname,'docs/report-fixed-samples/inspect-fixed-pdf.py'),out],{encoding:'utf8'});fs.writeFileSync(path.join(out,'inspection.log'),inspection.stdout+inspection.stderr);if(inspection.status!==0){failed=true;console.error(inspection.stdout+inspection.stderr);}}
  }finally{persist();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
  if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
