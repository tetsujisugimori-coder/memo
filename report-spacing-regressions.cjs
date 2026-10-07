"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {serializeImageBlock} = require("./attachment-utils.js");
const {createTableBlock,serializeTableBlock} = require("./table-block-utils.js");
const {createChartBlock,serializeChartBlock} = require("./chart-block-utils.js");
const {createGeometryBlock,serializeGeometryBlock} = require("./geometry-block-utils.js");
const {serializeTimelineBlock} = require("./timeline-block-utils.js");
const {withSources} = require("./source-utils.js");
const snapshot = page => page.evaluate(async()=>({body:editor.value,note:currentNote(),stored:await getStoredNotes(),dirty:noteSaveFoundation.isDirty(currentId),undo:undoStack,redo:redoStack}));
async function verifyReportSpacingCases(page,{out,baseline=false}) {
  if(await page.locator("body.report-preview-mode").count()) await page.locator("#reportPreviewBackBtn").click();
  await page.setViewportSize({width:1280,height:900});
  const id=await page.evaluate(()=>currentAttachments[0].id);
  const url="https://example.org/"+"LongUnbrokenPath0123456789".repeat(20)+"end";
  const sources=[{id:"s1",title:"資料一",url},{id:"s2",title:"資料二"},{id:"s3"}];
  const paragraphs=Array.from({length:36},(_,i)=>"段落"+(i+1)+" 読みやすい本文の行間を確認します。"+"日本語とEnglish0123456789の長い文章。".repeat(8));
  const figure=serializeImageBlock([{id,figureMetadata:{citationIds:["s1","s2"]}}],"検証Figure","center","normal","spacing-figure");
  const comparison=serializeImageBlock([{id,comparisonLabel:"変更前",figureMetadata:{caption:"左説明",citationIds:["s1"]}},{id,comparisonLabel:"変更後",figureMetadata:{caption:"右説明",citationIds:["s2"]}}],"比較全体","center","comparison","spacing-comparison");
  const table=serializeTableBlock({...createTableBlock("spacing-table"),caption:"検証Table",rows:[["項目","値"],["第一", "123"]],citationIds:["s1"]});
  const chart=serializeChartBlock({...createChartBlock("spacing-chart"),title:"検証Chart",items:[{id:"one",label:"第一"},{id:"two",label:"第二"}],series:[{id:"s",name:"系列",color:"#4455cc",values:[123,456]}],citationIds:["s2"]});
  const diagram=serializeGeometryBlock({...createGeometryBlock("spacing-diagram"),version:2,caption:"検証Diagram",points:[{id:"a",x:10,y:10},{id:"b",x:90,y:90}],objects:[{id:"line",type:"segment",pointIds:["a","b"]}],diagram:{description:"図の補足",citationIds:["s1","s2"]}});
  const timeline=serializeTimelineBlock({version:1,id:"spacing-timeline",title:"検証Timeline",items:Array.from({length:24},(_,i)=>({id:"e"+i,dateLabel:i===1?"":"2026年"+(i+1),title:i===1?"":"出来事"+(i+1),body:i===1?"":"説明"+(i+1)+" [@s2]",figureId:i===0?"spacing-figure":"",citationIds:i===1?[]:["s1"]}))});
  const longFigure=serializeImageBlock([{id,figureMetadata:{citationIds:["s1","s2"]}}],"長説明開始 "+("全文を縮めずに読むための長い説明文です。".repeat(200))+" 長説明終了","center","normal","long-figure");
  const longTimeline=serializeTimelineBlock({version:1,id:"long-timeline",title:"長項目Timeline",items:[{id:"long",dateLabel:"2026年",title:"長項目開始",body:paragraphs.join("\n\n")+"\n\n長項目終了",figureId:"spacing-figure",citationIds:["s1","s2"]}]});
  const empty=serializeImageBlock([{id}],"","center","normal","empty-figure")+"\n\n"+serializeTableBlock({...createTableBlock("empty-table"),rows:[["項目","値"],["末尾","789"]]})+"\n\n"+serializeTimelineBlock({version:1,id:"empty-timeline",items:[{id:"empty",dateLabel:"",title:"",body:"",figureId:"",citationIds:[]}]});
  const cases=[
    {name:"prose",body:"# 第一章\n\n## 節\n\n### 小節\n\n"+paragraphs.join("\n\n")+"\n\n- 項目一\n- 項目二\n\n> 引用文\n\n末尾",tokens:["第一章","小節","段落36","項目二","引用文","末尾"]},
    {name:"groups",body:["## 図表の章",figure,comparison,table,chart,diagram,"## Timelineの章",timeline,"本文終了 [@s3]"].join("\n\n"),tokens:["検証Figure","比較全体","左説明","右説明","検証Table","検証Chart","検証Diagram","検証Timeline","出来事24","資料情報なし",url]},
    {name:"long-groups",body:["## 長説明の章",longFigure,"## 長項目の章",figure,longTimeline,"最後の本文"].join("\n\n"),tokens:["長説明開始","長説明終了","長項目開始","長項目終了","最後の本文",url]},
    {name:"optional",body:empty+"\n\n末尾",tokens:["図1","表1","789","末尾"]}
  ];
  fs.mkdirSync(out,{recursive:true}); const evidence=[];
  for(const entry of cases) {
    await page.locator("#editor").fill(withSources(entry.body,sources));await page.evaluate(()=>flushSave());
    await page.waitForFunction(()=>!noteSaveFoundation.isDirty(currentId)&&saveTimer===null&&window.MemoNexusTypingDerivedUiScheduler.pendingRequestType()===null);
    const saved=await snapshot(page);
    const normal=await page.locator("#preview").evaluate(e=>({text:e.textContent,html:e.innerHTML}));
    await page.locator("#reportPreviewBtn").click();await page.evaluate(()=>attachmentRenderPromise);
    const numbers=await page.locator("#preview [data-report-number]").evaluateAll(es=>es.map(e=>e.dataset.reportNumber));
    const citations=await page.locator("#preview .citation-link").allTextContents();
    for(const token of entry.tokens) assert.ok((await page.locator("#preview").textContent()).includes(token),entry.name+" screen missing "+token);
    if(entry.name==="groups") assert.deepEqual(numbers,["図1","図2","表1","図3","図4","図1"]);
    if(entry.name==="optional") assert.deepEqual(numbers,["図1","表1"]);
    const layouts=[];
    for(const width of [1280,320]) {
      await page.setViewportSize({width,height:900});
      for(const large of [false,true]) {
        await page.evaluate(large=>{setFontVariables(previewCard,{...effectiveFontSettings(globalFontSettings,currentNote()?.fontSettings),bodyFontSize:large?20:17});applyTheme(large?"dark":"light");},large);
        const metrics=await page.locator("#preview").evaluate(e=>{
          const styles=s=>[...e.querySelectorAll(s)].map(x=>({top:parseFloat(getComputedStyle(x).marginTop),bottom:parseFloat(getComputedStyle(x).marginBottom),size:parseFloat(getComputedStyle(x).fontSize),height:x.getBoundingClientRect().height}));
          return {fontSize:parseFloat(getComputedStyle(e).fontSize),overflow:e.scrollWidth>e.clientWidth+1,lineHeight:getComputedStyle(e).lineHeight,heads:styles(":scope > :is(h1,h2,h3,h4,h5,h6)"),groups:styles(":scope > [data-report-kind]"),captions:styles(".report-caption"),timelineFigures:styles(".timeline-content > .image-block"),emptyDates:styles(".timeline-date:empty"),nestedFigures:[...e.querySelectorAll(".timeline-content > .image-block")].map(x=>x.getBoundingClientRect().top-x.parentElement.getBoundingClientRect().top)};
        });
        assert.equal(metrics.fontSize,large?20:17,"requested font size must actually be applied");
        assert.equal(metrics.overflow,false,entry.name+" must not widen Preview");
        if(!baseline && entry.name==="prose") {
          assert.equal(metrics.heads[0].top,0,"no leading heading gap");
          assert.ok(metrics.heads.every((h,i)=>i===0||h.size<metrics.heads[i-1].size),"existing heading levels stay distinct");
        }
        if(!baseline && entry.name==="groups") {
          assert.ok(metrics.groups.every(g=>g.top>metrics.captions[0].top),"external group gaps exceed caption gaps");
          assert.ok(metrics.timelineFigures.every(g=>g.top<metrics.groups[0].top),"Timeline media has local gaps");
          assert.ok(metrics.emptyDates.every(g=>g.height===0),"missing date leaves no line");
        }
        layouts.push({width,large,metrics});
        if(!large || entry.name === "groups" || entry.name === "prose") {
          const suffix=large?"-20-dark":"";
          await page.evaluate(()=>{window.scrollTo(0,0);document.body.scrollTop=0;document.querySelector(".workspace").scrollTop=0;previewCard.scrollTop=0;});
          await page.screenshot({path:path.join(out,entry.name+"-"+width+suffix+".png")});
          if(entry.name==="groups") {await page.locator(".image-comparison").evaluate(e=>{const c=document.querySelector("#previewCard");c.scrollTop+=e.getBoundingClientRect().top-c.getBoundingClientRect().top-16;});await page.screenshot({path:path.join(out,"comparison-"+width+suffix+".png")});await page.locator(".timeline-block").evaluate(e=>e.scrollIntoView({block:"start"}));await page.screenshot({path:path.join(out,"timeline-"+width+suffix+".png")});}
        }
      }
    }
    await page.evaluate(()=>{applyEffectiveFontSettings();applyTheme("light");});
    await page.setViewportSize({width:1280,height:900});
    assert.equal(await page.evaluate(()=>prepareReportPrint()),true);
    assert.deepEqual(await snapshot(page),saved,"print preserves saved content and history");
    assert.deepEqual(await page.locator("#preview [data-report-number]").evaluateAll(es=>es.map(e=>e.dataset.reportNumber)),numbers);
    assert.deepEqual(await page.locator("#preview .citation-link").allTextContents(),citations);
    const printMetrics=await page.locator("#preview").evaluate(e=>({overflow:e.scrollWidth>e.clientWidth+1,images:[...e.querySelectorAll("img")].map(x=>({width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height})),fragmented:[...e.querySelectorAll('[style*="break-inside: auto"]')].map(x=>({className:x.className,zoom:x.style.zoom,font:parseFloat(getComputedStyle(x).fontSize)}))}));
    assert.equal(printMetrics.overflow,false);
    if(!baseline && entry.name==="long-groups") {
      assert.ok(printMetrics.fragmented.some(x=>x.className.includes("image-block")),"long caption is allowed to split");
      assert.ok(printMetrics.fragmented.some(x=>x.className.includes("timeline-item")),"long Timeline item is allowed to split");
      assert.ok(printMetrics.fragmented.every(x=>!x.zoom),"long text isn't shrunk as an atomic group");
      assert.ok(printMetrics.images.every(x=>x.width>100&&x.height>100),"long captions do not reduce normal media to tiny images");
    }
    await page.emulateMedia({media:"print"});
    await page.pdf({path:path.join(out,entry.name+".pdf"),preferCSSPageSize:true,displayHeaderFooter:false});
    await page.evaluate(()=>window.dispatchEvent(new Event("afterprint")));await page.emulateMedia({media:"screen"});
    assert.deepEqual(await snapshot(page),saved);
    await page.locator("#reportPreviewBackBtn").click();
    const restored=await page.locator("#preview").evaluate(e=>({text:e.textContent,html:e.innerHTML}));
    assert.deepEqual(restored,normal,"normal Preview markup restored");
    evidence.push({name:entry.name,tokens:entry.tokens,numbers,citations,layouts,printMetrics});
  }
  fs.writeFileSync(path.join(out,"cases.json"),JSON.stringify(evidence,null,2));
  console.log("Report spacing cases PASS: "+cases.length+" reports, desktop/mobile, font/theme, real PDFs"+(baseline?" (baseline)":""));
}
module.exports={verifyReportSpacingCases};
