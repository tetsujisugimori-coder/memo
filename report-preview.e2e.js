"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const image = fs.readFileSync(path.join(__dirname, "e2e-artifacts", "chart-png-example-light-390.png"));

async function verifyReportNumbering(page) {
  const {serializeImageBlock} = require("./attachment-utils.js");
  const {createTableBlock, serializeTableBlock} = require("./table-block-utils.js");
  const {createChartBlock, serializeChartBlock} = require("./chart-block-utils.js");
  const {createGeometryBlock, serializeGeometryBlock} = require("./geometry-block-utils.js");
  const {serializeTimelineBlock} = require("./timeline-block-utils.js");
  const {withSources} = require("./source-utils.js");
  const id = await page.evaluate(() => currentAttachments[0].id);
  const url = "https://example.org/" + "long-url-".repeat(50);
  const figure = serializeImageBlock([{id,figureMetadata:{caption:"資料説明",sourceUrl:url,citationIds:["s1"]}}],"資料説明","center","normal","numbered-figure");
  const ordinary = serializeImageBlock([{id}], "");
  const table = serializeTableBlock({...createTableBlock("numbered-table"),caption:"表の説明",citationIds:["s1"]});
  const chart = serializeChartBlock({...createChartBlock("numbered-chart"),title:"グラフ説明",appearance:{showDataTable:true},citationIds:["s1"]});
  const comparison = serializeImageBlock([{id,comparisonLabel:"変更前"},{id,comparisonLabel:"変更後"}],"比較説明","center","comparison","numbered-comparison");
  const diagram = serializeGeometryBlock({...createGeometryBlock("numbered-diagram"),version:2,caption:"Diagram説明",points:[{id:"p1",x:10,y:10},{id:"p2",x:90,y:90}],objects:[{id:"line",type:"segment",pointIds:["p1","p2"]}],diagram:{description:"補足説明",citationIds:["s1"]}});
  const timeline = serializeTimelineBlock({id:"numbered-timeline",title:"年表",items:[{id:"i1",figureId:"numbered-figure"},{id:"i2",figureId:"numbered-figure"}]});
  const sources = [{id:"s1",title:"共通資料",url}];
  const numbered = '#preview [data-report-number]';
  const labels = () => page.locator(numbered).evaluateAll(elements => elements.map(e => e.dataset.reportNumber));
  const snapshot = () => page.evaluate(async () => ({body:editor.value,note:currentNote(),stored:await getStoredNotes(),dirty:noteSaveFoundation.isDirty(currentId),timer:saveTimer,undo:undoStack,redo:redoStack}));
  async function show(parts, expected) {
    const expectedBody=withSources(parts.join("\n\n"),sources);
    await page.evaluate(()=>{
      window.reportE2eWrites=[];
      const descriptor=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
      Object.defineProperty(editor,'value',{configurable:true,get(){return descriptor.get.call(this);},set(value){window.reportE2eWrites.push({value,stack:new Error().stack,time:performance.now()});descriptor.set.call(this,value);}});
    });
    await page.locator("#editor").fill(expectedBody);
    await page.evaluate(() => flushSave());
    await page.waitForFunction(() => !noteSaveFoundation.isDirty(currentId) && saveTimer === null && window.MemoNexusTypingDerivedUiScheduler.pendingRequestType() === null);
    const before = await snapshot();
    await page.locator("#reportPreviewBtn").click();
    const actual=await labels();
    if(JSON.stringify(actual)!==JSON.stringify(expected)){
      const out=path.join(__dirname,'e2e-artifacts','report-numbering-review');fs.mkdirSync(out,{recursive:true});
      const state=await page.evaluate(async()=>({body:editor.value,note:currentNote(),stored:await getStoredNotes(),preview:preview.innerHTML,writes:window.reportE2eWrites,layout:document.body.dataset.layoutMode,attachments:currentAttachments.map(a=>({id:a.id,fileName:a.fileName})),dirty:noteSaveFoundation.isDirty(currentId),timer:saveTimer,pending:window.MemoNexusTypingDerivedUiScheduler.pendingRequestType()}));
      fs.writeFileSync(path.join(out,'numbering-failure.json'),JSON.stringify({expectedBody,expected,actual,before,state},null,2));
      await page.screenshot({path:path.join(out,'numbering-failure.png'),fullPage:true});
    }
    await page.evaluate(()=>{delete editor.value;});
    assert.deepEqual(actual,expected);
    assert.deepEqual(await snapshot(),before,"Preview must not mutate canonical data or history");
    return before;
  }
  async function back() { await page.locator("#reportPreviewBackBtn").click();assert.equal(await page.locator('.report-caption').count(),0); }
  await page.setViewportSize({width:1280,height:900});
  const parts = [figure,ordinary,table,chart,comparison,diagram];
  const before = await show(parts,["図1","表1","図2","図3","図4"]);
  const dom = await page.locator(numbered).evaluateAll(elements => elements.map(e => ({number:e.dataset.reportNumber,caption:e.querySelector(':scope > figcaption').textContent,top:e.getBoundingClientRect().top,captionTop:e.querySelector(':scope > figcaption').getBoundingClientRect().top})));
  assert.deepEqual(dom.map(e=>e.caption),["図1 資料説明","表1 表の説明","図2 グラフ説明","図3 比較説明","図4 Diagram説明"]);
  assert.ok(dom.filter(e=>e.number.startsWith("図")).every(e=>e.captionTop>e.top));
  assert.equal(await page.locator("#preview .image-block[data-report-number]").evaluateAll(elements=>elements.every(e=>e.querySelector(":scope > .report-caption").getBoundingClientRect().top >= e.querySelector(".image-block-media").getBoundingClientRect().bottom-1)),true,"Image captions stay below their media at desktop width");
  assert.equal(await page.locator('#preview .table-block').evaluate(e=>e.firstElementChild.classList.contains('report-caption')),true);
  assert.equal(await page.locator('#preview .chart-block').evaluate(e=>e.querySelector('.report-caption').getBoundingClientRect().top>=e.querySelector('svg').getBoundingClientRect().bottom),true);
  assert.equal(await page.locator('#preview .figure-metadata-main').first().innerText(),url,"caption is not repeated in metadata");
  assert.deepEqual(await page.locator('.image-comparison-label').allTextContents(),["図3(a) 変更前","図3(b) 変更後"]);
  assert.equal(await page.locator('#preview .report-sources li').count(),1);
  assert.equal(await page.locator("#preview .chart-data-table").count(),1,"Chart value table is part of its figure, not separately numbered");
  const citations = await page.locator('#preview .citation-link').allTextContents();
  const out = path.join(__dirname,'e2e-artifacts','report-numbering-review');fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,'report-pc.png'),fullPage:true});
  await page.setViewportSize({width:320,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1 && preview.scrollWidth<=preview.clientWidth+1),true);
  assert.equal(await page.locator('#preview :is(.report-caption,.figure-metadata,.content-citations,.report-sources)').evaluateAll(elements=>elements.every(e=>{const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth+1 && e.scrollWidth<=e.clientWidth+1;})),true);
  await page.screenshot({path:path.join(out,'report-320.png'),fullPage:true});
  await page.locator('#preview .table-block').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'table-320.png'),fullPage:true});
  await page.locator('#preview .image-comparison').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'comparison-320.png'),fullPage:true});
  await page.locator('#preview .geometry-preview').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'diagram-320.png'),fullPage:true});
  await page.evaluate(()=>applyTheme('dark'));
  assert.equal(await page.locator('#previewCard').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
  await page.setViewportSize({width:1280,height:900});
  assert.deepEqual(await snapshot(),before);assert.deepEqual(await page.locator('#preview .citation-link').allTextContents(),citations);
  await back();
  await show([comparison,table,figure,diagram,chart],["図1","表1","図2","図3","図4"]);await back();
  await show([table,figure,diagram,chart],["表1","図1","図2","図3"]);await back();
  await show([table,figure,table,diagram,chart,comparison],["表1","図1","表2","図2","図3","図4"]);await back();
  await show([timeline,...parts],["図1","図1","図1","表1","図2","図3","図4"]);await back();
  const emptyFigure=serializeImageBlock([{id}],"","center","normal","empty-figure");
  const emptyComparison=serializeImageBlock([{id},{id,comparisonLabel:"右のみ"}],"","center","comparison");
  const emptyTable=serializeTableBlock(createTableBlock('empty-table'));
  const emptyChart=serializeChartBlock({...createChartBlock('empty-chart'),title:""});
  const emptyDiagram=serializeGeometryBlock({...createGeometryBlock('empty-diagram'),caption:""});
  await show([emptyFigure,emptyTable,emptyChart,emptyComparison,emptyDiagram],["図1","表1","図2","図3","図4"]);
  assert.deepEqual(await page.locator('.report-caption').allTextContents(),["図1","表1","図2","図3","図4"]);
  assert.deepEqual(await page.locator('.image-comparison-label').allTextContents(),["図3(b) 右のみ"]);await back();
  const long=serializeImageBlock([{id,figureMetadata:{caption:"長い説明".repeat(150),sourceUrl:url}}],"","center","normal","long-figure");
  await show([long],["図1"]);await page.setViewportSize({width:320,height:844});
  assert.equal(await page.evaluate(()=>preview.scrollWidth<=preview.clientWidth+1),true);
  await page.evaluate(()=>previewCard.scrollTop=0);
  await page.screenshot({path:path.join(out,'long-caption-320.png'),fullPage:true});await back();
  await page.setViewportSize({width:1280,height:900});
  const duplicateTable=serializeTableBlock({...createTableBlock('duplicate-title'),caption:"同じ説明",note:"同じ説明"});
  const duplicateDiagram=serializeGeometryBlock({...createGeometryBlock('duplicate-diagram'),version:2,caption:"同じ説明 [@s1]",diagram:{description:"同じ説明 [@s1]"}});
  await show([duplicateTable,duplicateDiagram],["表1","図1"]);
  assert.equal(await page.locator('.table-block-note, .diagram-description').count(),0,"identical descriptions appear once");
  assert.equal(await page.locator('.report-caption .citation-link').count(),1,"moving the duplicate description keeps its common Source citation");
  assert.equal(await page.locator('.report-sources li').count(),1);await back();
  // Imported conflicting IDs stay unresolved and count as separate掲載 elements.
  await show([timeline,figure,figure],["図1","図2"]);
  assert.equal(await page.locator('.timeline-missing').count(),2);await back();
}

(async () => {
  const root = path.resolve(process.env.REPORT_APP_DIR||__dirname);
  const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "application/javascript" });
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await page.locator("#titleInput").fill("レポートの題名");
    await page.locator("#editor").fill("# 本文の見出し\n\n本文の段落。\n\n- 項目 A\n- 項目 B\n- [ ] 未完了\n\n`code`");
    await page.locator("#insertTableBtn").click();
    await page.locator("#preview .table-block").waitFor();
    await page.locator("#insertChartBtn").click();
    await page.locator("#preview .chart-block").waitFor();
    await page.locator("#insertImageBlockBtn").click();
    await page.locator("#imageBlockInput").setInputFiles({ name: "figure.png", mimeType: "image/png", buffer: image });
    await page.locator("#preview .image-block").waitFor();
    await page.locator(".image-block").hover();
    await page.locator(".image-block-menu-toggle").click();
    await page.locator(".image-block-edit-figure").first().click();
    const panel = page.locator(".figure-metadata-editor");
    await panel.getByLabel("キャプション").fill("資料キャプション");
    await panel.getByLabel("年代・時期").fill("永禄12年");
    await panel.getByLabel("資料名").fill("資料名A");
    await panel.getByLabel("出典URL").fill("https://example.org/source");
    await panel.getByLabel("資料種別").selectOption("primary");
    await panel.getByLabel("権利・ライセンス").fill("CC BY 4.0");
    await panel.getByLabel("補足").fill("補足情報");
    await panel.getByText("資料情報を保存").click();
    await page.locator(".figure-metadata-main").getByText("資料キャプション").waitFor();
    await page.locator(".image-block").hover();
    await page.locator(".image-block-menu-toggle").click();
    await page.locator(".image-block-add").click();
    await page.locator("#imageBlockInput").setInputFiles({ name: "second.png", mimeType: "image/png", buffer: image });
    await page.locator(".image-block-open").nth(1).waitFor();
    await page.locator("#addExplanationBtn").click();
    await page.locator("#explanationBodyInput").fill("Report Previewでは開閉状態を保存しない解説です。");
    await page.locator("#saveExplanationBtn").click();
    await page.locator(".explanation-card details summary").waitFor();
    await page.evaluate(() => flushSave());
    const noteId = await page.evaluate(() => currentId);
    const explanationState = async () => page.evaluate(async (id) => {
      const note = (await getStoredNotes()).find((item) => item.id === id);
      const explanation = note.explanations[0];
      return {
        revision: note.revision,
        updatedAt: note.updatedAt,
        body: note.body,
        explanation: { collapsed: explanation.collapsed, updatedAt: explanation.updatedAt }
      };
    }, noteId);
    const storedBeforeReport = await explanationState();
    const historyBeforeReport = await page.evaluate(() => ({ undo: undoStack.length, redo: redoStack.length }));
    const explanationDetails = page.locator(".explanation-card details");
    assert.equal(await explanationDetails.evaluate((details) => details.open), true);
    await page.locator("#reportPreviewBtn").click();
    await page.locator("body.report-preview-mode").waitFor();
    await page.evaluate(() => {
      const details = document.querySelector(".explanation-card details");
      window.reportPreviewExplanationToggleObserved = false;
      details.addEventListener("toggle", () => { if (!details.open) window.reportPreviewExplanationToggleObserved = true; });
    });
    await explanationDetails.locator("summary").click();
    await page.waitForFunction(() => {
      const details = document.querySelector(".explanation-card details");
      return details?.open === false && window.reportPreviewExplanationToggleObserved === true;
    });
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await saveExplanationCollapsedState.whenIdle();
    });
    assert.deepEqual(await explanationState(), storedBeforeReport);
    assert.deepEqual(await page.evaluate(() => ({ undo: undoStack.length, redo: redoStack.length })), historyBeforeReport);
    await page.locator("#reportPreviewBackBtn").click();
    assert.equal(await page.locator("body.report-preview-mode").count(), 0);
    const normalExplanationDetails = page.locator(".explanation-card details");
    assert.equal(await normalExplanationDetails.evaluate((details) => details.open), true);
    await page.evaluate(() => {
      const details = document.querySelector(".explanation-card details");
      window.reportPreviewExplanationToggleObserved = false;
      details.addEventListener("toggle", () => { if (!details.open) window.reportPreviewExplanationToggleObserved = true; });
    });
    await normalExplanationDetails.locator("summary").click();
    await page.waitForFunction(() => {
      const details = document.querySelector(".explanation-card details");
      return details?.open === false && window.reportPreviewExplanationToggleObserved === true;
    });
    await page.evaluate(() => saveExplanationCollapsedState.whenIdle());
    const storedAfterNormalToggle = await explanationState();
    assert.equal(storedAfterNormalToggle.explanation.collapsed, true);
    assert.equal(storedAfterNormalToggle.body, storedBeforeReport.body);
    assert.deepEqual(await page.evaluate(() => ({ undo: undoStack.length, redo: redoStack.length })), historyBeforeReport);
    const before = await page.locator("#editor").inputValue();
    await page.waitForFunction(async (id) => {
      const note = (await getStoredNotes()).find((item) => item.id === id);
      return note?.title === titleInput.value && note?.body === editor.value;
    }, noteId);
    const revisionBefore = await page.evaluate(async (id) => (await getStoredNotes()).find((item) => item.id === id).revision, noteId);
    const historyBefore = await page.evaluate(() => ({ undo: undoStack.length, redo: redoStack.length }));
    await page.locator("#reportPreviewBtn").click();
    await page.locator("body.report-preview-mode").waitFor();
    assert.equal(await page.locator("#reportPreviewTitle").innerText(), "レポートの題名");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "reportPreviewTitle");
    await page.locator("#preview h1").getByText("本文の見出し").waitFor();
    await page.locator("#preview").getByText("本文の段落。").waitFor();
    assert.equal(await page.locator("#preview .task-list-checkbox").isDisabled(), true);
    assert.equal(await page.locator("#preview .image-block-open").count(), 2);
    await page.locator("#preview .table-block").waitFor();
    await page.locator("#preview .chart-block").waitFor();
    await page.locator("#preview .figure-metadata").first().getByText("永禄12年").waitFor();
    await page.locator("#preview .figure-metadata-main").first().getByText("資料名A").waitFor();
    await page.locator("#preview .figure-metadata summary").first().click();
    await page.locator("#preview .figure-metadata").first().getByText("CC BY 4.0").waitFor();
    assert.equal(await page.locator("#preview .figure-metadata a").first().getAttribute("href"), "https://example.org/source");
    assert.equal(await page.locator(".image-block-menu-toggle").isVisible(), false);
    assert.equal(await page.locator(".chart-block-edit").isVisible(), false);
    assert.equal(await page.locator("#editor").isVisible(), false);
    assert.equal(await page.locator("#titleInput").isVisible(), false);
    assert.equal(await page.locator(".app-header").isVisible(), false);
    assert.equal(await page.locator("#contextPanel").isVisible(), false);
    assert.equal(await page.locator("#editorCardSeparator").isVisible(), false);
    assert.equal(await page.locator("#linkStatsPanel").isVisible(), false);
    assert.equal(await page.locator(".preview-head").isVisible(), false);
    assert.equal(await page.locator("#preview .image-block-open").first().isEnabled(), true);
    await page.locator("#preview .image-block-open").first().click();
    await page.locator("#imagePreviewDialog").waitFor({ state: "visible" });
    await page.locator("#closeImagePreviewBtn").click();
    assert.equal(await page.locator("#editor").inputValue(), before);
    assert.deepEqual(await page.evaluate(() => ({ undo: undoStack.length, redo: redoStack.length })), historyBefore);
    assert.equal(await page.evaluate(async (id) => (await getStoredNotes()).find((item) => item.id === id).revision, noteId), revisionBefore);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForFunction(() => document.body.dataset.layoutMode === "mobile");
    assert.equal(await page.locator("#reportPreviewBackBtn").isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.equal(await page.locator("#preview .image-block").evaluate((figure) => {
      const items = [...figure.querySelectorAll(".image-block-item")].map((item) => item.getBoundingClientRect());
      return items.length === 2 && items[1].top >= items[0].bottom - 1;
    }), true);
    await page.locator("#reportPreviewBackBtn").click();
    assert.equal(await page.locator("body.report-preview-mode").count(), 0);
    assert.equal(await page.locator("#editor").inputValue(), before);
    assert.equal(await page.locator("#preview .image-block-open").first().isEnabled(), true);
    if (await page.locator("#contextPanel").getAttribute("aria-hidden") === "false")
      await page.locator("#closeContextPanelBtn").click();
    await page.locator("#mobileAppMenu summary").click();
    await page.locator("#reportPreviewMobileBtn").click();
    await page.locator("#reportPreviewBackBtn").press("Escape");
    assert.equal(await page.locator("body.report-preview-mode").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "reportPreviewMobileBtn");
    await page.setViewportSize({ width: 820, height: 700 });
    await page.waitForFunction(() => document.body.dataset.layoutMode === "compact");
    await page.locator("#cardPaneBtn").click();
    assert.equal(await page.locator("#cardPaneBtn").getAttribute("aria-expanded"), "false");
    await page.locator("#reportPreviewBtn").click();
    assert.equal(await page.locator("#previewCard").isVisible(), true);
    await page.locator("#reportPreviewBackBtn").click();
    assert.equal(await page.locator("#cardPaneBtn").getAttribute("aria-expanded"), "false");
    await page.waitForFunction(async (id) => {
      const note = (await getStoredNotes()).find((item) => item.id === id);
      return note?.body === editor.value;
    }, noteId);
    await page.reload();
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#editor").inputValue(), before);
    assert.equal(await page.locator("#titleInput").inputValue(), "レポートの題名");
    assert.equal(await page.locator("#preview .figure-metadata").count(), 1);
    await verifyReportNumbering(page);
    await require("./report-caption-regressions.cjs").verifyReportCaptionCases(page,{out:path.join(__dirname,"e2e-artifacts/report-numbering-review/caption-regressions")});
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write("Report Preview E2E: PASS\n");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
