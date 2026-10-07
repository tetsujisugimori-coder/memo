"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {chromium} = require("playwright");
const {serializeImageBlock} = require("./attachment-utils.js");
const {createTableBlock,serializeTableBlock} = require("./table-block-utils.js");
const {createChartBlock,serializeChartBlock} = require("./chart-block-utils.js");
const {createGeometryBlock,serializeGeometryBlock} = require("./geometry-block-utils.js");
const {serializeTimelineBlock} = require("./timeline-block-utils.js");
const {withSources} = require("./source-utils.js");
const out=path.join(__dirname,"e2e-artifacts","report-pdf-review");
async function state(page) {
  return page.evaluate(async()=>({body:editor.value,title:titleInput.value,note:currentNote(),stored:await getStoredNotes(),
    sources:parseSourceDocument(editor.value).sources,dirty:noteSaveFoundation.isDirty(currentId),timer:saveTimer,
    undo:undoStack,redo:redoStack}));
}
(async()=>{
  fs.rmSync(out,{recursive:true,force:true});
  fs.mkdirSync(out,{recursive:true});
  const server=http.createServer((req,res)=>{
    const file=path.resolve(__dirname,decodeURIComponent(new URL(req.url,"http://localhost").pathname).replace(/^\/+/,"")||"index.html");
    if(!file.startsWith(__dirname+path.sep))return res.writeHead(403).end();
    fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader("Content-Type",file.endsWith(".html")?"text/html; charset=utf-8":file.endsWith(".css")?"text/css":file.endsWith(".png")?"image/png":"application/javascript");res.end(data);});
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
    page.on("pageerror",error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator("#appStartupGuard").waitFor({state:"hidden"});
    await page.locator("#titleInput").fill('混在レポート:検証/資料');
    await page.locator("#insertImageBlockBtn").click();
    const image=fs.readFileSync(path.join(__dirname,"e2e-artifacts","chart-png-example-light-390.png"));
    await page.locator("#imageBlockInput").setInputFiles({name:"figure.png",mimeType:"image/png",buffer:image});
    await page.locator("#preview img").first().waitFor();await page.evaluate(()=>flushSave());
    const ids=await page.evaluate(()=>currentAttachments.map(a=>a.id));
    const tall=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=240;c.height=2200;const x=c.getContext("2d");x.fillStyle="white";x.fillRect(0,0,c.width,c.height);x.fillStyle="black";for(let y=0;y<c.height;y+=100)x.fillRect(0,y,c.width,10);return c.toDataURL("image/png").split(",")[1];});
    await page.locator("#insertImageBlockBtn").click();await page.locator("#imageBlockInput").setInputFiles({name:"tall.png",mimeType:"image/png",buffer:Buffer.from(tall,"base64")});
    await page.waitForFunction(()=>currentAttachments.length===2);const tallId=await page.evaluate(()=>currentAttachments.find(a=>a.fileName==="tall.png").id);
    const figure=serializeImageBlock([{id:ids[0],figureMetadata:{caption:"図版の内容",sourceUrl:"https://example.org/figure",note:"図版詳細の補足",citationIds:["s1"]}}],"図版開始 F1 " + "長い図版説明も折り返し、対象物と同じページに保ちます。".repeat(20),"center","normal","f1");
    const comparison=serializeImageBlock([{id:ids[0],comparisonLabel:"変更前",figureMetadata:{citationIds:["s2"]}},{id:ids[0],comparisonLabel:"変更後",figureMetadata:{citationIds:["s1"]}}],"比較終了 C1","center","comparison","cmp");
    const table=serializeTableBlock({...createTableBlock("print-table"),caption:"表開始 T1",rows:[["項目","日本語説明","数値","URL"],...Array.from({length:55},(_,i)=>[`行${i+1}`,"日本語を折り返す検証文章",String(1000+i),"https://example.org/table/"+i])],note:"表終了 T1",citationIds:["s2"]});
    const chart=serializeChartBlock({...createChartBlock("print-chart"),title:"横長グラフ G1",unit:"件",items:Array.from({length:8},(_,i)=>({id:`i${i}`,label:`項目${i+1}`})),series:[{id:"series-a",name:"系列甲",color:"#4455cc",values:Array.from({length:8},(_,i)=>210+i)},{id:"series-b",name:"系列乙",color:"#cc5544",values:Array.from({length:8},(_,i)=>310+i)}],citationIds:["s1"]});
    const geometry=serializeGeometryBlock({...createGeometryBlock("print-diagram"),version:2,caption:"Diagram D1",points:[{id:"p1",x:10,y:10},{id:"p2",x:90,y:90}],objects:[{id:"seg",type:"segment",pointIds:["p1","p2"]}],diagram:{description:"Diagram補足 [@s2]",createdForReport:true,citationIds:["s1"]}});
    const timeline=serializeTimelineBlock({version:1,id:"print-timeline",title:"Timeline L1",items:[{id:"event",dateLabel:"2026年",title:"Timeline項目",body:"本文と参照Figure [@s2]",figureId:"f1",citationIds:["s1"]}]});
    const longUrl="https://example.org/"+"long-path-".repeat(30)+"end";
    const body=withSources(["# 日本語本文", "本文開始 [@s1] 未登録 [@missing] [[語句]] [[* 未作成メモ]]", "- [ ] 未完了の項目\n- [x] 完了した項目",...Array.from({length:14},(_,i)=>`段落${i+1} 日本語の選択・検索を検証します。`+"長い本文でも欠落なく折り返します。".repeat(8)),"## 図版直前見出し H1",figure,"図版終了 F1",comparison,table,chart,geometry,timeline,"## 大図直前見出し HBIG1",serializeImageBlock([{id:tallId}],"大図終了 BIG1","center","normal","big"),"不正マーカー <!-- memo-nexus:table-block:ff -->", "本文終了 END"].join("\n\n"),[{id:"s1",title:"出典資料一",url:longUrl},{id:"s2",title:"出典資料二",url:"https://example.org/source-two"}]);
    await page.locator("#editor").fill(body);await page.evaluate(()=>flushSave());
    await page.waitForFunction(()=>!noteSaveFoundation.isDirty(currentId)&&saveTimer===null&&window.MemoNexusTypingDerivedUiScheduler.pendingRequestType()===null);
    await page.locator("#reportPreviewBtn").click();const before=await state(page);const title=await page.title();
    const reportNumbers=await page.locator("#preview [data-report-number]").evaluateAll(elements=>elements.map(e=>({number:e.dataset.reportNumber,caption:e.querySelector(":scope > .report-caption").textContent})));
    assert.deepEqual(reportNumbers.map(e=>e.number),["図1","図2","表1","図3","図4","図1","図5"]);
    const citations=await page.locator("#preview .citation-link").allTextContents();
    await page.evaluate(()=>{window.print=()=>{window.printCalls=(window.printCalls||0)+1;};});
    await page.locator("#reportPrintBtn").click();await page.waitForFunction(()=>window.printCalls===1);
    assert.deepEqual(await state(page),before);assert.match(await page.title(),/^混在レポート_検証_資料$/);
    assert.deepEqual(await page.locator("#preview .citation-link").allTextContents(),citations);
    assert.deepEqual(await page.locator("#preview [data-report-number]").evaluateAll(elements=>elements.map(e=>({number:e.dataset.reportNumber,caption:e.querySelector(":scope > .report-caption").textContent}))),reportNumbers,"PDF uses the exact screen numbering");
    await page.emulateMedia({media:"print"});
    for(const id of ["#reportPrintBtn","#reportPreviewBackBtn","#editor","#attachmentSection","#reportPrintStatus"])
      assert.equal(await page.locator(id).isVisible(),false,id);
    const readPrintMetrics=()=>page.evaluate(()=>({timeline:[...preview.querySelectorAll(".timeline-item")].map(e=>({height:e.getBoundingClientRect().height,zoom:e.style.zoom,css:getComputedStyle(e).marginBottom,content:e.querySelector(".timeline-content").getBoundingClientRect().height,paddingLeft:getComputedStyle(e).paddingLeft,mediaHeight:e.querySelector(".image-block-media").getBoundingClientRect().height,mediaWidth:e.querySelector(".image-block-media").getBoundingClientRect().width})),width:preview.getBoundingClientRect().width,background:getComputedStyle(document.body).backgroundColor,
      captionsBelow:[...preview.querySelectorAll(".image-block[data-report-number], .geometry-preview, .chart-block")].every(e=>e.querySelector(":scope > .report-caption").getBoundingClientRect().top>=e.querySelector(".image-block-media, svg").getBoundingClientRect().bottom-1),
      overflow:preview.scrollWidth>preview.clientWidth+1,big:[...preview.querySelectorAll('.image-block')].find(b=>b.textContent.includes('BIG1')).getBoundingClientRect().height,
      bigNatural:[...preview.querySelectorAll('.image-block')].find(b=>b.textContent.includes('BIG1')).querySelector('img').naturalHeight,
      bigCenter:(()=>{const r=[...preview.querySelectorAll('.image-block')].find(b=>b.textContent.includes('BIG1')).getBoundingClientRect();return (r.left+r.right)/2-preview.getBoundingClientRect().left;})(),
      fonts:[...preview.querySelectorAll('td')].map(e=>parseFloat(getComputedStyle(e).fontSize)),
      rows:[...preview.querySelectorAll('tr')].map(e=>getComputedStyle(e).breakInside)}));
    const metrics=await readPrintMetrics();
    assert.ok(Math.abs(metrics.width-170*96/25.4)<1);assert.equal(metrics.background,"rgb(255, 255, 255)");assert.equal(metrics.overflow,false);assert.equal(metrics.captionsBelow,true,"PDF captions must stay below their object");
    assert.ok(metrics.big<=257*96/25.4);assert.ok(metrics.fonts.every(n=>n>=12));assert.ok(metrics.rows.every(n=>n==="avoid-page"));
    assert.ok(Math.abs(metrics.bigCenter-metrics.width/2)<1,"center alignment of the whole Figure");
    await page.screenshot({path:path.join(out,"print-layout.png"),fullPage:true});
    fs.writeFileSync(path.join(out,"metrics.json"),JSON.stringify({browser:browser.version(),metrics,citations,longUrl,reportNumbers},null,2));
    await page.pdf({path:path.join(out,"mixed-report.pdf"),preferCSSPageSize:true,displayHeaderFooter:false,printBackground:false});
    // CDP PDF invokes afterprint too; this is the same cleanup used after cancel/save.
    await page.evaluate(()=>window.dispatchEvent(new Event("afterprint")));
    await page.emulateMedia({media:"screen"});assert.deepEqual(await state(page),before);assert.equal(await page.title(),title);
    assert.equal(await page.locator('#reportPrintBtn').isEnabled(),true);assert.equal(await page.locator('.figure-metadata details').first().evaluate(e=>e.open),false);
    await page.setViewportSize({width:320,height:844});
    const mobileBefore=await state(page);
    await page.locator("#reportPrintBtn").click();await page.waitForFunction(()=>window.printCalls===2);
    assert.ok(Math.abs(await page.locator("#preview").evaluate(e=>e.getBoundingClientRect().width)-170*96/25.4)<1,"A4 measurement must not depend on mobile viewport");
    const mobileOut=path.join(out,"mobile");fs.mkdirSync(mobileOut,{recursive:true});
    const mobileMetrics=await readPrintMetrics();
    for(let i=0;i<metrics.timeline.length;i++) {
      assert.equal(mobileMetrics.timeline[i].paddingLeft,metrics.timeline[i].paddingLeft,"print Timeline indentation is viewport-independent");
      for(const key of ["height","mediaHeight","mediaWidth"])assert.ok(Math.abs(mobileMetrics.timeline[i][key]-metrics.timeline[i][key])<1,"same A4 Timeline geometry: "+key);
    }
    fs.writeFileSync(path.join(mobileOut,"metrics.json"),JSON.stringify({browser:browser.version(),metrics:mobileMetrics,citations,longUrl,reportNumbers},null,2));
    await page.emulateMedia({media:"print"});
    await page.pdf({path:path.join(mobileOut,"mixed-report.pdf"),preferCSSPageSize:true,displayHeaderFooter:false,printBackground:false});
    await page.emulateMedia({media:"screen"});
    await page.evaluate(()=>window.dispatchEvent(new Event("afterprint")));assert.deepEqual(await state(page),mobileBefore);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,"normal mobile Report restored");
    await page.setViewportSize({width:1280,height:900});
    // A deliberately dirty editor snapshot and nonempty redo stack must also survive.
    await page.evaluate(()=>{applyTheme("dark");clearTimeout(saveTimer);saveTimer=null;editor.value+="\n未保存の本文";noteSaveFoundation.markChanged(currentId);redoStack.push({noteId:currentId,title:titleInput.value,body:editor.value,savedAt:123});renderPreview();});
    const dirty=await state(page);await page.locator("#reportPrintBtn").click();await page.waitForFunction(()=>window.printCalls===3);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),"rgb(255, 255, 255)");
    await page.evaluate(()=>window.dispatchEvent(new Event("afterprint")));assert.deepEqual(await state(page),dirty);
    await page.evaluate(()=>{preview.querySelector("img").src="data:image/png;base64,broken";});
    await page.locator("#reportPrintBtn").click();await page.waitForFunction(()=>document.querySelector("#reportPrintStatus").textContent.startsWith("印刷を開始できません"));
    assert.equal(await page.evaluate(()=>window.printCalls),3);assert.deepEqual(await state(page),dirty);
    await require("./report-caption-regressions.cjs").verifyReportCaptionCases(page,{out:path.join(out,"caption-regressions"),pdf:true});
    await require("./report-spacing-regressions.cjs").verifyReportSpacingCases(page,{out:path.join(out,"spacing"),baseline:process.env.REPORT_SPACING_BASELINE === "1"});
    await require("./report-pagination-regressions.cjs").verifyReportPaginationCases(page,{out:path.join(out,"pagination")});
    assert.deepEqual(errors,[]);
    for(const directory of [out,mobileOut]){
      const checked=spawnSync(process.env.PYTHON||"python",[path.join(__dirname,"docs/report-preview-v1/inspect-pdf.py"),directory],{encoding:"utf8"});
      if(checked.stdout)process.stdout.write(checked.stdout);if(checked.stderr)process.stderr.write(checked.stderr);assert.equal(checked.status,0,"real PDF inspection");
    }
    console.log("Report PDF Chromium E2E PASS");
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
