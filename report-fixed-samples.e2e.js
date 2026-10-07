"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const playwright=require('playwright');
const {assets,buildSamples}=require('./report-fixed-samples.cjs');
const {buildRegressionCases}=require('./report-regression-cases.cjs');
const {splitTableBlocks}=require('./table-block-utils.js');
const {splitChartBlocks}=require('./chart-block-utils.js');
const engine=process.env.MEMO_NEXUS_E2E_BROWSER||'chromium';
const out=path.resolve(process.env.REPORT_FIXED_OUT||path.join(__dirname,'e2e-artifacts','report-fixed',engine));
const assetDir=path.join(__dirname,'docs','report-fixed-samples','assets');
const observe=process.env.REPORT_OBSERVE==='1';
const selected=(process.env.REPORT_CASES||'R01,R02,R03,R04,R05,R06,L01,L02,L03,L04,I01').split(',');
const appDir=path.resolve(process.env.REPORT_APP_DIR||__dirname);
const idle=page=>page.waitForFunction(()=>!noteSaveFoundation.isDirty(currentId)&&saveTimer===null&&window.MemoNexusTypingDerivedUiScheduler.pendingRequestType()===null);
async function snapshot(page){return page.evaluate(async()=>{await attachmentRenderPromise;return {body:editor.value,title:titleInput.value,attachments:await Promise.all(currentAttachments.map(async a=>{const image=new Image(),url=URL.createObjectURL(a.blob);image.src=url;await image.decode();URL.revokeObjectURL(url);return {id:a.id,fileName:a.fileName,width:image.naturalWidth,height:image.naturalHeight,mimeType:a.mimeType,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await a.blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('')};})),stored:(await getStoredNotes()).find(n=>n.id===currentId).body};});}
async function ready(page){await page.evaluate(async()=>{await attachmentRenderPromise;await document.fonts.ready;await Promise.all([...preview.querySelectorAll('img')].map(i=>i.decode()));});}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  for(const name of fs.readdirSync(out))if(/^(?:R0[1-6]|L0[1-4]|I01)(?:[-.]|$)|^(?:results\.json|pdf-results\.json|inspection\.log)$/.test(name)&&fs.statSync(path.join(out,name)).isFile())fs.unlinkSync(path.join(out,name));
  const summary={engine,node:process.version,platform:process.platform,sha:spawnSync('git',['rev-parse','HEAD'],{cwd:__dirname,encoding:'utf8'}).stdout.trim(),cases:[]};
  const persist=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(summary,null,2));
  const server=http.createServer((req,res)=>{const file=path.resolve(appDir,decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html');if(!file.startsWith(appDir+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'application/javascript');res.end(data);});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;let failed=false;
  try{
    browser=await playwright[engine].launch({headless:true});summary.browser=browser.version();
    for(const sampleId of selected){
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
        result.originalIds={...ids};
        const normalized=await page.evaluate(async()=>Promise.all(currentAttachments.map(async a=>({key:a.fileName.replace('.png',''),data:await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(a.blob);})}))));
        fs.mkdirSync(path.join(out,sampleId+'-assets'),{recursive:true});for(const a of normalized)fs.writeFileSync(path.join(out,sampleId+'-assets',a.key+'.png'),Buffer.from(a.data,'base64'));
        const sample=[...buildSamples(ids),...buildRegressionCases(ids)].find(s=>s.id===sampleId);result.fixture=sample;
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
          const loaded=await snapshot(page);assert.equal(loaded.attachments.length,before.attachments.length);let expected=before.body;
          for(const old of before.attachments){const fresh=loaded.attachments.find(a=>a.fileName.startsWith(old.id+'.'));assert.ok(fresh,'Archive asset filename identifies original attachment');assert.equal(fresh.sha256,old.sha256,'Attachment bytes survive import independent of IDs');assert.equal(fresh.width,old.width);assert.equal(fresh.height,old.height);expected=expected.replaceAll(old.id,fresh.id);ids[old.fileName.replace('.png','')]=fresh.id;}
          assert.equal(loaded.body,expected,'Official portable backup import changes only attachment IDs');assert.equal(loaded.title,before.title);before=loaded;
          await page.reload();await page.locator('#appStartupGuard').waitFor({state:'hidden'});await idle(page);assert.deepEqual(await snapshot(page),before);result.import='PASS';
          fs.writeFileSync(path.join(out,sampleId+'-imported.md'),before.body);
        }else result.import='対象外：正式編集操作で直接検証';
        result.attachments=before.attachments;
        result.assetKeys=Object.fromEntries(Object.entries(ids).map(([k,v])=>[v,k]));
        const normalLineSvg=await page.locator('#preview .chart-block-line svg').evaluateAll(es=>es.map(e=>e.outerHTML));
        await page.locator('#reportPreviewBtn').click();await ready(page);
        const measureLines=async()=>page.locator('#preview .chart-block-line svg').evaluateAll(svgs=>svgs.map(svg=>{
          const v=svg.viewBox.baseVal,scale=svg.getBoundingClientRect().width/v.width;
          const labels=[...svg.querySelectorAll('.chart-block-value')].map(e=>{const b=e.getBBox();return {text:e.textContent,x:b.x,y:b.y,width:b.width,height:b.height,points:parseFloat(getComputedStyle(e).fontSize)*scale*72/96,item:e.parentElement.dataset.chartItemId,series:e.parentElement.dataset.chartSeriesId};});
          const overlaps=[];for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i],b=labels[j];if(a.x+a.width>b.x&&b.x+b.width>a.x&&a.y+a.height>b.y&&b.y+b.height>a.y)overlaps.push([i,j]);}
          return {labels,overlaps,outside:labels.filter(b=>b.x<0||b.y<0||b.x+b.width>v.width||b.y+b.height>v.height),geometry:[...svg.querySelectorAll('.chart-block-line-point,.chart-block-line-path,.chart-block-zero-line')].map(e=>({tag:e.tagName,points:e.getAttribute('points'),cx:e.getAttribute('cx'),cy:e.getAttribute('cy'),x1:e.getAttribute('x1'),x2:e.getAttribute('x2'),y1:e.getAttribute('y1'),y2:e.getAttribute('y2')}))};
        }));
        result.lineMeasurements={screen:await measureLines()};
        if(sample.lineRegression){
          const chart=splitChartBlocks(before.body).find(b=>b.type==='chart').chart;
          const actual=await page.locator('#preview .chart-block-line .sr-only li').allTextContents();
          assert.deepEqual(actual,chart.items.flatMap((item,i)=>chart.series.map(s=>`${item.label}、${s.name}: ${s.values[i]}`)),'Every item/series/value pairing in existing list');
          const count=await page.locator('#preview .chart-block-line .chart-block-value').count();result.omitted=chart.items.length*chart.series.length-count;
          if(!observe){assert.equal(result.omitted>0,sample.expectOmission);assert.equal(await page.locator('#preview .chart-block-series-notice').count(),sample.expectOmission?1:0);}
          const points=await page.locator('#preview .chart-block-line-item').evaluateAll(es=>es.map(e=>({item:e.dataset.chartItemId,series:e.dataset.chartSeriesId,description:e.querySelector('circle').dataset.chartDescription,x:Number(e.querySelector('circle').getAttribute('cx')),y:Number(e.querySelector('circle').getAttribute('cy'))})));
          assert.equal(points.length,chart.items.length*chart.series.length);
          const minimum=Math.min(0,...chart.series.flatMap(s=>s.values)),maximum=Math.max(0,...chart.series.flatMap(s=>s.values));
          for(const p of points){const i=chart.items.findIndex(item=>item.id===p.item),s=chart.series.find(s=>s.id===p.series),value=s.values[i];assert.ok(p.description.includes(chart.items[i].label)&&p.description.includes(s.name)&&p.description.includes(String(value)));assert.ok(Math.abs(p.y-(196-(value-minimum)/(maximum-minimum)*154))<1e-8,'Point ordinate unchanged');}
          const zeroY=await page.locator('#preview .chart-block-zero-line').getAttribute('y1');assert.ok(Math.abs(Number(zeroY)-(196-(0-minimum)/(maximum-minimum)*154))<1e-8,'Independent signed zero axis');
          if(sampleId==='L01'&&!observe)assert.deepEqual(result.lineMeasurements.screen[0].geometry,require('./docs/report-fixed-samples/line-geometry-before.json').geometry,'Line, all 50 points and zero axis exactly match reviewed HEAD');
          await page.locator('#reportPreviewBackBtn').click();await ready(page);assert.deepEqual(await page.locator('#preview .chart-block-line svg').evaluateAll(es=>es.map(e=>e.outerHTML)),normalLineSvg,'Ordinary Preview exactly unchanged after Report toggle');await page.locator('#reportPreviewBtn').click();await ready(page);
        }
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
          const accessible=await page.locator('#preview .chart-block').nth(index).locator('.sr-only').textContent();
          for(const [i,item] of chart.items.entries())for(const series of chart.series){assert.ok(accessible.includes(item.label)&&accessible.includes(series.name)&&accessible.includes(String(series.values[i])),'Chart input/accessible rendering mismatch: '+JSON.stringify({item:item.label,series:series.name,value:series.values[i],accessible}));}
        }
        result.imageRatios=await page.locator('#preview img').evaluateAll(es=>es.map(e=>{const box=e.getBoundingClientRect();return {natural:e.naturalWidth/e.naturalHeight,rendered:box.width/box.height};}));
        for(const ratio of result.imageRatios)assert.ok(Math.abs(ratio.natural-ratio.rendered)<0.01,'Image aspect ratio preserved');
        const pieBoxes=await page.locator('#preview .chart-block-pie-label').evaluateAll(es=>es.map(e=>{const b=e.getBBox();return {text:e.textContent,x:b.x,y:b.y,width:b.width,height:b.height};}));
        for(let i=0;i<pieBoxes.length;i++)for(let j=i+1;j<pieBoxes.length;j++){const a=pieBoxes[i],b=pieBoxes[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'Report pie labels overlap: '+a.text+'/'+b.text);}
        result.pieBoxes=pieBoxes;
        result.imageViews={};
        for(const width of [1280,390]){await page.setViewportSize({width,height:900});await ready(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await page.locator('#preview').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
          result.lineMeasurements['screen-'+width]=await measureLines();
          const images=await page.locator('#preview img').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect(),f=e.closest('figure.image-block'),item=e.closest('.image-block-item'),s=getComputedStyle(e);return {id:e.closest('[data-attachment-id]')?.dataset.attachmentId,width:e.naturalWidth,height:e.naturalHeight,box:{x:b.x,y:b.y,width:b.width,height:b.height},border:[s.borderLeftWidth,s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth].map(parseFloat),fit:s.objectFit,caption:f?.querySelector('figcaption')?.textContent,number:f?.dataset.reportNumber,comparison:item?.querySelector('.image-comparison-label')?.textContent,citations:[...item?.querySelectorAll('.citation-ref')||[]].map(c=>c.textContent)};}));
          for(const image of images){image.key=result.assetKeys[image.id];assert.ok(image.key,'Image must resolve to known attachment');assert.notEqual(image.fit,'cover');assert.ok(image.box.width>0&&image.box.height>0);assert.ok(image.box.x>=0&&image.box.x+image.box.width<=width+1);const a=before.attachments.find(a=>a.id===image.id);assert.equal(image.width,a.width);assert.equal(image.height,a.height);}
          if(sampleId==='I01'){
            const blocks=await page.locator('#preview figure.image-block').evaluateAll(es=>es.map(e=>({caption:e.querySelector('figcaption').textContent,number:e.dataset.reportNumber,sources:[...e.querySelectorAll('.citation-link')].map(c=>c.getAttribute('href'))})));
            for(const [i,block] of blocks.entries()){assert.equal(block.number,'図'+(i+1));assert.ok(block.caption.includes(i<6?'I01F'+(i+1):'I01C'+(i-5)));assert.deepEqual([...new Set(block.sources)],['#source-s1']);}
            assert.deepEqual(images.slice(6).map(i=>i.comparison),['図7(a) LEFT landscape','図7(b) RIGHT photo','図8(a) LEFT portrait','図8(b) RIGHT transparent']);result.imageBlocks=blocks;
          }
          const order={R01:[],R02:['landscape','portrait','square','landscape','photo','landscape','portrait'],R03:[],R04:['square','square','square'],R05:['landscape','portrait','landscape','portrait','landscape'],R06:['boundary'],I01:['landscape','portrait','square','boundary','photo','transparent','landscape','photo','portrait','transparent']};
          assert.deepEqual(images.map(i=>i.key),order[sampleId]||[],'Independent expected image order, including Comparison left/right and Timeline');result.imageViews[width]=images;
          await page.screenshot({path:path.join(out,`${sampleId}-preview-${width}.png`),fullPage:true});
          for(const [i,img] of (await page.locator('#preview img').all()).entries())await img.screenshot({path:path.join(out,`${sampleId}-image-${width}-${i}.png`)});
        }
        result.preview='PASS';
        if(engine==='chromium'){
          await page.setViewportSize({width:1280,height:900});
          for(const suffix of ['first','repeat']){assert.equal(await page.evaluate(()=>prepareReportPrint()),true);await page.emulateMedia({media:'print'});assert.equal(await page.locator('#preview').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
            result.lineMeasurements[suffix]=await measureLines();
            result.linePrintFonts=await page.locator('#preview .chart-block-line svg text').evaluateAll(es=>es.map(e=>{const box=e.getBBox(),view=e.ownerSVGElement.viewBox.baseVal;return {text:e.textContent,points:parseFloat(getComputedStyle(e).fontSize)*e.ownerSVGElement.getBoundingClientRect().width/view.width*72/96,inside:box.x>=0&&box.y>=0&&box.x+box.width<=view.width&&box.y+box.height<=view.height};}));
            if(!observe)for(const font of result.linePrintFonts){assert.ok(font.points>=9,'Line chart print text below 9pt: '+JSON.stringify(font));assert.ok(font.inside,'Line chart label clipped: '+JSON.stringify(font));}
            await page.pdf({path:path.join(out,`${sampleId}-${suffix}.pdf`),preferCSSPageSize:true,displayHeaderFooter:false,printBackground:false});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await page.emulateMedia({media:'screen'});assert.deepEqual(await snapshot(page),before);}
          result.pdf='生成PASS・検査待ち';
        }else result.pdf='対象外：Playwright PDF出力はChromiumのみ';
        assert.deepEqual(errors,[]);result.errors=errors;
        if(!observe)for(const measurements of Object.values(result.lineMeasurements))for(const chart of measurements){assert.deepEqual(chart.overlaps,[],'Actual SVG value labels overlap');assert.deepEqual(chart.outside,[],'Actual SVG value labels clipped');}
      }catch(error){failed=true;result.failure=error.stack;result.errors=errors;await page.screenshot({path:path.join(out,sampleId+'-failure.png'),fullPage:true}).catch(()=>{});console.error(sampleId,error.message);}
      finally{persist();await context.close();for(const directory of profiles)fs.rmSync(directory,{recursive:true,force:true});}
    }
    {const inspection=spawnSync(process.env.PYTHON||'python',[path.join(__dirname,'docs/report-fixed-samples/inspect-fixed-pdf.py'),out],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});fs.writeFileSync(path.join(out,'inspection.log'),inspection.stdout+inspection.stderr);if(inspection.status!==0){failed=true;console.error(inspection.stdout+inspection.stderr);}}
  }finally{persist();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
  if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
