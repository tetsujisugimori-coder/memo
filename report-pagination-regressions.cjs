"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {serializeImageBlock}=require("./attachment-utils.js");
const {serializeTimelineBlock}=require("./timeline-block-utils.js");
const {withSources}=require("./source-utils.js");
const snapshot=page=>page.evaluate(async()=>({body:editor.value,title:titleInput.value,note:currentNote(),stored:await getStoredNotes(),dirty:noteSaveFoundation.isDirty(currentId),timer:saveTimer,undo:undoStack,redo:redoStack}));
const layout=page=>page.locator("#preview").evaluate(e=>({styles:[...e.querySelectorAll("[style]")].map(x=>[x.className,x.getAttribute("style")]),images:[...e.querySelectorAll("img")].map(x=>{const b=x.getBoundingClientRect();return [b.left,b.top,b.width,b.height];})}));
async function verifyReportPaginationCases(page,{out}) {
  if(await page.locator("body.report-preview-mode").count())await page.locator("#reportPreviewBackBtn").click();
  await page.setViewportSize({width:1280,height:900});
  const normalId=await page.evaluate(()=>currentAttachments[0].id);
  const png=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=600;c.height=1800;const x=c.getContext("2d");x.fillStyle="white";x.fillRect(0,0,600,1800);for(let y=0;y<1800;y+=100){x.fillStyle=y%200?"#7799cc":"#223355";x.fillRect(0,y,600,50);}return c.toDataURL().split(",")[1];});
  const count=await page.evaluate(()=>currentAttachments.length);
  await page.locator("#insertImageBlockBtn").click();await page.locator("#imageBlockInput").setInputFiles({name:"pagination-big.png",mimeType:"image/png",buffer:Buffer.from(png,"base64")});
  await page.waitForFunction(n=>currentAttachments.length===n+1,count);
  const bigId=await page.evaluate(()=>currentAttachments.find(a=>a.fileName==="pagination-big.png").id);
  fs.mkdirSync(out,{recursive:true});const cases=[];
  for(const alignment of ["left","center","right"]) {
    await page.setViewportSize({width:1280,height:900});
    const figId="pagination-"+alignment;
    const caption="FIGURE-BEGIN-"+alignment+" "+"長文説明の全文と文字サイズを保持します。".repeat(180)+" FIGURE-END-"+alignment;
    const figure=serializeImageBlock([{id:bigId,figureMetadata:{caption:"MEDIA-"+alignment,sourceUrl:"https://example.org/figure-"+alignment,citationIds:["s1"]}}],caption,alignment,"normal",figId);
    const paragraphs=Array.from({length:30},(_,i)=>"PARA-"+alignment+"-"+i+" "+"長い本文を複数ページへ流します。".repeat(8));
    const timeline=serializeTimelineBlock({version:1,id:"long-"+alignment,title:"LONG-TIMELINE-"+alignment,items:[{id:"long",dateLabel:"LONG-DATE-"+alignment,title:"LONG-ITEM-"+alignment,body:"BODY-BEGIN-"+alignment+"\n\n"+paragraphs.join("\n\n")+"\n\nBODY-END-"+alignment,figureId:figId,citationIds:["s2"]}]});
    const ordinaryFigure=serializeImageBlock([{id:normalId,figureMetadata:{sourceUrl:"https://example.org/ordinary-figure",citationIds:["s1"]}}],"ORDINARY-FIGURE-CAPTION","center","normal","ordinary-figure");
    const ordinaryTimeline=serializeTimelineBlock({version:1,id:"ordinary",title:"ORDINARY-CHAPTER",items:[{id:"ordinary-item",dateLabel:"ORDINARY-DATE",title:"ORDINARY-TITLE",body:"ORDINARY-BODY [@s2]",figureId:"ordinary-figure",citationIds:["s2"]}]});
    const body=withSources([figure,timeline,ordinaryFigure,ordinaryTimeline,"REPORT-END"].join("\n\n"),[{id:"s1",title:"FIGURE-SOURCE",url:"https://example.org/source-figure"},{id:"s2",title:"ITEM-SOURCE",url:"https://example.org/source-item"}]);
    await page.locator("#editor").fill(body);await page.evaluate(()=>flushSave());
    await page.waitForFunction(()=>!noteSaveFoundation.isDirty(currentId)&&saveTimer===null&&window.MemoNexusTypingDerivedUiScheduler.pendingRequestType()===null);
    await page.locator("#reportPreviewBtn").click();await page.evaluate(()=>attachmentRenderPromise);
    for(const width of [1280,320]) {
      await page.setViewportSize({width,height:900});
      // Exercise restoration of dirty content and nonempty Undo/Redo too.
      await page.evaluate(()=>{clearTimeout(saveTimer);saveTimer=null;markLocalMemoDirty();redoStack.push({noteId:currentId,title:titleInput.value,body:editor.value,savedAt:123});});
      const before=await snapshot(page),screen=await layout(page);
      assert.equal(before.dirty,true,"dirty-state restoration is actually exercised");
      const numbers=await page.locator("#preview [data-report-number]").evaluateAll(es=>es.map(e=>e.dataset.reportNumber));
      const citations=await page.locator("#preview .citation-link").allTextContents();
      assert.equal(await page.evaluate(()=>prepareReportPrint()),true);
      assert.deepEqual(await snapshot(page),before,"print preparation preserves data/dirty/history");
      const metrics=await page.evaluate(()=>[...preview.querySelectorAll('.image-block')].filter(f=>f.textContent.includes('FIGURE-BEGIN-')).map(f=>{
        const m=f.querySelector('.image-block-media'),img=f.querySelector('img');const box=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width,height:b.height,center:(b.left+b.right)/2};};
        const media=box(m),image=box(img);const scale=Number(m.style.zoom),alignment=f.classList.contains('image-align-left')?0:f.classList.contains('image-align-right')?1:.5;
        const outer=box(f),css=getComputedStyle(f),left=parseFloat(css.paddingLeft)+parseFloat(css.borderLeftWidth),right=parseFloat(css.paddingRight)+parseFloat(css.borderRightWidth);
        const expectedLeft=outer.left+left+(outer.width-left-right-media.width)*alignment;
        return {media,image,scale,expectedLeft,groupZoom:f.style.zoom,timeline:!!f.closest('.timeline-item'),font:parseFloat(getComputedStyle(f.querySelector('.report-caption')).fontSize)};
      }));
      assert.equal(metrics.length,2,"top-level and Timeline Figure tested");
      for(const m of metrics){assert.ok(m.scale>0&&m.scale<1,"must enter media-only shrinking path");assert.equal(m.groupZoom,"");assert.equal(m.font,12);assert.ok(Math.abs(m.media.left-m.expectedLeft)<1,"media alignment retained");assert.ok(Math.abs(m.image.center-m.media.center)<1);assert.ok(Math.abs(m.image.width/m.image.height-1/3)<.001);}
      const name=alignment+"-"+width;
      await page.emulateMedia({media:"print"});await page.pdf({path:path.join(out,name+".pdf"),preferCSSPageSize:true,displayHeaderFooter:false});
      await page.evaluate(()=>window.dispatchEvent(new Event("afterprint")));await page.emulateMedia({media:"screen"});
      assert.deepEqual(await snapshot(page),before,"PDF/afterprint preserves data/dirty/history");assert.deepEqual(await layout(page),screen,"temporary styles and image placement fully restored");
      assert.deepEqual(await page.locator("#preview [data-report-number]").evaluateAll(es=>es.map(e=>e.dataset.reportNumber)),numbers);
      assert.deepEqual(await page.locator("#preview .citation-link").allTextContents(),citations);
      cases.push({name,alignment,width,caption,paragraphs,numbers,citations,metrics});
    }
    await page.locator("#reportPreviewBackBtn").click();
  }
  fs.writeFileSync(path.join(out,"cases.json"),JSON.stringify(cases,null,2));
  console.log("Report pagination regressions PASS: 6 PDFs; actual media-only zoom, alignment, long/ordinary Timeline and full restoration");
}
module.exports={verifyReportPaginationCases};
