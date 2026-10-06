"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {serializeImageBlock} = require("./attachment-utils.js");
const {createChartBlock, serializeChartBlock} = require("./chart-block-utils.js");
const {withSources} = require("./source-utils.js");

function cases(imageIds) {
  const sources = [{id:"left",title:"共通左資料",url:"https://example.org/common-left"},{id:"right",title:"共通右資料",url:"https://example.org/common-right"}];
  const comparisons = [
    {name:"comparison-distinct",caption:"",individual:["改修前 C1","改修後 C1"]},
    {name:"comparison-right-only",caption:"",individual:["","右だけの説明 C2"]},
    {name:"comparison-with-parent",caption:"比較全体 C3",individual:["左個別 C3","右個別 C3"]},
    {name:"comparison-duplicate",caption:"共通説明 C4",individual:["共通説明 C4","共通説明 C4"]},
    {name:"comparison-with-sources",caption:"",individual:["左説明 <資料> & C5","右説明 C5"],labels:["旧状態","新状態"]}
  ].map(entry => {
    const images = entry.individual.map((caption,index)=>({id:imageIds[index],comparisonLabel:entry.labels?.[index] || "",figureMetadata:entry.name==="comparison-right-only" && index===0 ? undefined : {caption,
      dateLabel:`日付 ${index+1}`,sourceName:`個別資料 ${index+1}`,sourceUrl:`https://example.org/individual-${index+1}`,
      license:`権利 ${index+1}`,note:`補足 ${index+1}`,citationIds:[index===0?"left":"right"]}}));
    return {...entry,kind:"comparison",body:withSources(serializeImageBlock(images,entry.caption,"center","comparison",entry.name),sources),
      expectedSides:entry.name==="comparison-right-only"?[1]:[0,1],expectedCaption:"図1"+(entry.caption?" "+entry.caption:""),expectedIndividual:entry.individual.map(c=>c===entry.caption?"":c)};
  });
  const pies = [
    {name:"pie-first",title:"",selected:0},
    {name:"pie-second",title:"",selected:1},
    {name:"pie-titled",title:"年別構成 P3",selected:1},
    {name:"pie-single",title:"",selected:0,single:true}
  ].map(entry=>{
    const series=[{id:"first",name:"初期系列",color:"#4455cc",values:[11,29]},{id:"second",name:"後期系列",color:"#cc5544",values:[7,53]}].slice(0,entry.single?1:2);
    const selected=series[entry.selected];
    const chart={...createChartBlock(entry.name),chartType:"pie",title:entry.title,unit:"件",items:[{id:"a",label:"項目A"},{id:"b",label:"項目B"}],series,
      appearance:{pieSeriesId:selected.id,pieLabelMode:"value",showLegend:true,showDataTable:true},citationIds:["left"]};
    return {...entry,kind:"pie",seriesId:selected.id,seriesName:selected.name,values:selected.values,
      expectedCaption:"図1"+(entry.title?` ${entry.title}（${selected.name}）`:entry.single?"":` ${selected.name}`),body:withSources(serializeChartBlock(chart),sources)};
  });
  const single={name:"single-figure",kind:"single",expectedCaption:"図1 単一Figure資料説明",body:withSources(serializeImageBlock([{id:imageIds[0],figureMetadata:{caption:"単一Figure資料説明",citationIds:["left"]}}]),sources)};
  return [...comparisons,...pies,single];
}

async function state(page) {
  return page.evaluate(async()=>({body:editor.value,note:currentNote(),stored:await getStoredNotes(),dirty:noteSaveFoundation.isDirty(currentId),timer:saveTimer,undo:undoStack,redo:redoStack}));
}
async function drawing(page) {
  return page.locator("#preview").evaluate(root=>({
    images:[...root.querySelectorAll(".image-block-open")].map(e=>e.dataset.imageId),
    captions:[...root.querySelectorAll(".figure-metadata-main")].map(e=>e.textContent),
    labels:[...root.querySelectorAll(".image-comparison-label")].map(e=>e.textContent),
    svg:root.querySelector(".chart-block svg")?.innerHTML || "",
    chartSeries:root.querySelector(".chart-block")?.dataset.chartSeriesId || "",
    legend:root.querySelector(".chart-block-legend")?.textContent || "",
    table:root.querySelector(".chart-data-table")?.textContent || "",
    citations:[...root.querySelectorAll(".citation-link")].map(e=>e.textContent)
  }));
}
async function verifyReportCaptionCases(page,{out,pdf=false,only=process.env.MEMO_NEXUS_REPORT_REVIEW_CASES}={}) {
  await page.setViewportSize({width:1280,height:900});
  if(await page.locator("body.report-preview-mode").count()) await page.locator("#reportPreviewBackBtn").click();
  const leftId=await page.evaluate(()=>currentAttachments[0].id);
  // Distinct IDs and pixels make a left/right association error observable.
  const rightPng=await page.evaluate(()=>{const canvas=document.createElement("canvas");canvas.width=240;canvas.height=160;const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,240,160);ctx.fillStyle="#236c73";ctx.fillRect(25,25,190,110);ctx.fillStyle="#fff";ctx.font="28px sans-serif";ctx.fillText("RIGHT",70,90);return canvas.toDataURL("image/png").split(",")[1];});
  await page.locator("#insertImageBlockBtn").click();
  await page.locator("#imageBlockInput").setInputFiles({name:"caption-review-right.png",mimeType:"image/png",buffer:Buffer.from(rightPng,"base64")});
  await page.waitForFunction(()=>currentAttachments.some(a=>a.fileName==="caption-review-right.png"));
  const rightId=await page.evaluate(()=>currentAttachments.find(a=>a.fileName==="caption-review-right.png").id);
  assert.notEqual(leftId,rightId);
  const imageIds=[leftId,rightId];
  fs.mkdirSync(out,{recursive:true});const evidence=[];
  for(const entry of cases(imageIds).filter(entry=>!only || entry.kind===only)) {
    await page.locator("#editor").fill(entry.body);await page.evaluate(()=>flushSave());
    await page.waitForFunction(()=>!noteSaveFoundation.isDirty(currentId)&&saveTimer===null&&window.MemoNexusTypingDerivedUiScheduler.pendingRequestType()===null);
    const before=await state(page),normal=await drawing(page);
    await page.locator("#reportPreviewBtn").click();
    assert.deepEqual(await state(page),before,entry.name+" report switch changes no saved/editor state");
    assert.equal(await page.locator("#preview [data-report-number]").count(),1,entry.name+" has one figure number");
    const caption=page.locator("#preview .report-caption");
    assert.equal(await caption.textContent(),entry.expectedCaption,entry.name+" retains required caption information");
    assert.equal(await caption.isVisible(),true);
    await page.evaluate(()=>attachmentRenderPromise);
    const report=await drawing(page);
    for(const field of ["images","svg","chartSeries","legend","table","citations"]) assert.deepEqual(report[field],normal[field],entry.name+" keeps "+field);
    if(entry.kind==="comparison") {
      assert.equal(await page.locator("#preview .image-block-open").count(),2);
      assert.deepEqual(report.images,imageIds,"left and right keep their distinct attachment identity");
      const groups=page.locator("#preview .report-image-source");assert.equal(await groups.count(),entry.expectedSides.length);
      for(const index of entry.expectedSides) {
        const group=groups.nth(entry.expectedSides.indexOf(index));const side=`図1(${String.fromCharCode(97+index)})`;
        assert.equal(await group.locator(":scope > .report-number").innerText(),side);
        assert.equal(await group.locator(":scope > .report-number").isVisible(),true);
        const main=await group.locator(".figure-metadata-main").innerText();
        if(entry.expectedIndividual[index]) assert.ok(main.includes(entry.expectedIndividual[index]),entry.name+" "+side+" preserves its individual explanation");
        else if(entry.individual[index]) assert.ok(!main.includes(entry.individual[index]),entry.name+" omits only the duplicate parent explanation");
        assert.ok(main.includes(`個別資料 ${index+1}`));assert.ok(main.includes(`日付 ${index+1}`));
        assert.equal(await group.locator(".citation-link").getAttribute("href"),index===0?"#source-left":"#source-right");
        assert.equal(await group.locator(".figure-metadata a").getAttribute("href"),`https://example.org/individual-${index+1}`);
        assert.ok((await group.innerText()).includes(`権利 ${index+1}`)===false,"details remain closed on screen");
      }
      if(entry.caption) assert.equal((await caption.textContent()).split(entry.caption).length-1,1);
    } else if(entry.kind==="pie") {
      assert.equal(report.chartSeries,entry.seriesId);
      assert.equal(await page.locator("#preview .chart-block-legend").innerText(),`項目A: ${entry.values[0]}件\n項目B: ${entry.values[1]}件`);
      if(!entry.single) assert.ok((await caption.textContent()).includes(entry.seriesName),"selected series is visible to readers");
    }
    await page.setViewportSize({width:320,height:844});
    assert.equal(await page.evaluate(()=>preview.scrollWidth<=preview.clientWidth+1),true,entry.name+" narrow caption/source wraps");
    await page.screenshot({path:path.join(out,entry.name+"-320.png"),fullPage:true});
    await page.setViewportSize({width:1280,height:900});
    if(pdf) {
      assert.equal(await page.evaluate(()=>prepareReportPrint()),true,entry.name+" prepares the shared DOM");
      assert.deepEqual(await state(page),before,entry.name+" print preparation is display only");
      assert.equal(await caption.textContent(),entry.expectedCaption);
      await page.emulateMedia({media:"print"});
      assert.equal(await caption.isVisible(),true,entry.name+" caption is visible in print");
      await page.pdf({path:path.join(out,entry.name+".pdf"),preferCSSPageSize:true,displayHeaderFooter:false});
      await page.evaluate(()=>window.dispatchEvent(new Event("afterprint")));await page.emulateMedia({media:"screen"});
      assert.deepEqual(await state(page),before,entry.name+" PDF output restores saved/editor state");
    }
    await page.locator("#reportPreviewBackBtn").click();
    assert.deepEqual(await state(page),before,entry.name+" return to editor is display only");
    assert.deepEqual(await drawing(page),normal,entry.name+" normal display is restored exactly");
    // Both fixes must work for unsaved content with nonempty history, too.
    if(["comparison-right-only","pie-second"].includes(entry.name)) {
      await page.evaluate(()=>{editor.value+="\n未保存確認";noteSaveFoundation.markChanged(currentId);redoStack.push({noteId:currentId,title:titleInput.value,body:editor.value,savedAt:123});renderPreview();});
      const dirty=await state(page);assert.equal(dirty.dirty,true);
      await page.locator("#reportPreviewBtn").click();assert.deepEqual(await state(page),dirty);
      assert.equal(await caption.textContent(),entry.expectedCaption);
      if(pdf) {assert.equal(await page.evaluate(()=>prepareReportPrint()),true);assert.deepEqual(await state(page),dirty);await page.evaluate(()=>restoreReportPrint());assert.deepEqual(await state(page),dirty);}
      await page.locator("#reportPreviewBackBtn").click();assert.deepEqual(await state(page),dirty);
    }
    evidence.push({name:entry.name,kind:entry.kind,caption:entry.expectedCaption,individual:entry.expectedIndividual || [],sides:entry.expectedSides || [],parent:entry.caption || "",values:entry.values || [],series:entry.seriesName || ""});
  }
  fs.writeFileSync(path.join(out,"cases.json"),JSON.stringify(evidence,null,2));
  console.log(`Report caption regressions PASS: ${evidence.length} cases${pdf?" with real PDFs":""}`);
}
module.exports={verifyReportCaptionCases};
