"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const playwright = require("playwright");
const engine = process.env.MEMO_NEXUS_E2E_BROWSER || "chromium";
const canonical = '#preview .image-block:not([data-image-block-index^="timeline-"])';
async function idle(page) {
  await page.waitForFunction(() => !noteSaveFoundation.isDirty(currentId) && saveTimer === null && window.MemoNexusTypingDerivedUiScheduler.pendingRequestType() === null);
}
async function state(page) {
  await idle(page);
  return page.evaluate(async () => ({ body:editor.value,stored:(await getStoredNotes()).find(n=>n.id===currentId).body,
    revision:currentNote().revision,updatedAt:currentNote().updatedAt,undo:undoStack.length,redo:redoStack.length,
    dirty:noteSaveFoundation.isDirty(currentId),scheduled:saveTimer!==null,
    images:splitImageBlocks(editor.value).filter(b=>b.type==="image"),
    tables:splitTableBlocks(editor.value).filter(b=>b.type==="table").map(b=>b.table),
    charts:splitChartBlocks(editor.value).filter(b=>b.type==="chart").map(b=>b.chart),sources:parseSourceDocument(editor.value).sources }));
}
async function saved(page) {await page.evaluate(()=>flushSave());return state(page);}
async function fillBody(page,body) {await page.locator('#editor').fill(body);return saved(page);}
async function figureMenu(page,index=0) {
  await idle(page);const image=page.locator(canonical).nth(index);
  await image.hover();if(await image.locator('.image-block-menu-toggle').getAttribute('aria-expanded')!=='true')await image.locator('.image-block-menu-toggle').click();return image;
}
async function selectFigure(page,index=0,imageIndex=0) {
  const image=await figureMenu(page,index);
  await image.locator('.image-block-edit-figure').nth(imageIndex).click();return image.locator('.figure-metadata-editor');
}
async function selectBlock(page,kind,index=0) {
  await idle(page);const block=page.locator('.'+kind+'-block-editor').nth(index);
  if(kind==='table' && await block.locator('details').getAttribute('open')===null) await block.locator('summary').click();
  await block.getByRole('button',{name:'共通Sourceを選択',exact:true}).click();
  await page.locator('#contentSourceDialog').waitFor({state:'visible'});return page.locator('#contentSourceDialog');
}
async function selectIds(panel,ids) {
  for(const id of ids) await panel.locator('.content-source-selector input[value="'+id+'"]').check();
}
async function savePanel(page,panel,kind) {
  await panel.getByRole('button',{name:kind==='figure'?'資料情報を保存':'Source選択を保存',exact:true}).click();
  await panel.waitFor({state:'hidden'});return saved(page);
}
async function download(page,action) {const pending=page.waitForEvent('download');await action();const d=await pending;assert.equal(await d.failure(),null);return fs.readFileSync(await d.path());}
async function layout(page) {
  await page.waitForFunction(()=>layoutMode===layoutModeForWidth(document.body.clientWidth));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  assert.equal(await page.locator('#preview').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
}
(async()=>{
  const root=__dirname;
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html');
    if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
    fs.readFile(file,(e,data)=>{if(e)return res.writeHead(404).end();res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'application/javascript'});res.end(data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  const contexts=[],profiles=[];
  try{
    if(engine!=='webkit')browser=await playwright[engine].launch({headless:true});const origin='http://127.0.0.1:'+server.address().port;
    const errors=[];
    const open=async()=>{
      let p;
      if(engine==='webkit'){
        // WebKit ephemeral contexts fail IndexedDB Blob writes even on baseline main.
        // Every import gets a fresh ordinary profile; the application storage is untouched.
        const profile=fs.mkdtempSync(path.join(os.tmpdir(),'memo-source-webkit-'));profiles.push(profile);
        const context=await playwright.webkit.launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900}});contexts.push(context);p=await context.newPage();
      }else p=await browser.newPage({viewport:{width:1280,height:900}});
      p.on('pageerror',e=>errors.push(e.message));p.on('console',msg=>{if(msg.type()==='error' && /attachment|添付/i.test(msg.text())) console.error('Browser console:',msg.text());});await p.goto(origin,{waitUntil:'domcontentloaded'});await p.locator('#appStartupGuard').waitFor({state:'hidden'});return p;};
    const page=await open();
    await page.locator('#titleInput').fill('Report Preview v1 検証用混在レポート');
    await page.locator('#editor').fill('以下は実在資料を示さない検証データです。');await saved(page);
    // Empty choices give a concrete path to the existing Source management dialog.
    await page.locator('#insertTableBtn').click();await saved(page);
    let panel=await selectBlock(page,'table');
    assert.match(await panel.innerText(),/選択できるSourceがありません/);
    await panel.getByRole('button',{name:'編集を取消して出典を管理'}).click();
    await page.locator('#sourceDialog').waitFor({state:'visible'});
    for(const name of ['検証データA（実在資料ではありません）'+ '長い資料名'.repeat(12),'検証データB（実在資料ではありません）','未参照の検証データ']){
      await page.locator('#sourceForm [name="title"]').fill(name);
      await page.locator('#sourceForm [name="url"]').fill('https://example.org/report-test/'+ 'long'.repeat(45));
      await page.locator('#sourceForm button[type="submit"]').first().click();await saved(page);
    }
    await page.locator('#closeSourceDialogBtn').click();
    await page.locator('#insertImageBlockBtn').click();
    const png=fs.readFileSync(path.join(root,'e2e-artifacts/chart-png-example-light-390.png'));
    await page.locator('#imageBlockInput').setInputFiles({name:'検証画像A.png',mimeType:'image/png',buffer:png});
    await page.locator(canonical+' img').first().waitFor().catch(async error=>{console.error(await page.evaluate(()=>({body:editor.value,status:document.querySelector('#attachmentStatus')?.textContent,attachments:currentAttachments.map(a=>({id:a.id,kind:a.kind})),pending:pendingImageInsertTarget})));console.error(errors);throw error;});await saved(page);
    const firstMenu=await figureMenu(page,0);await firstMenu.getByRole('button',{name:'画像を追加',exact:true}).click();
    await page.locator('#imageBlockInput').setInputFiles({name:'検証画像B.png',mimeType:'image/png',buffer:png});
    await page.locator(canonical+'.image-count-2 img').nth(1).waitFor();await saved(page);
    const fixture=await page.evaluate(()=>{
      const sources=parseSourceDocument(editor.value).sources;
      const images=splitImageBlocks(editor.value).find(b=>b.type==='image').images;
      const figure=serializeImageBlock([{...images[0],figureMetadata:{caption:'Figure検証画像',sourceName:'従来資料名（共通Sourceとは独立）',sourceUrl:'https://example.org/legacy',license:'検証用',note:'既存補足'}}],'Figure全体の説明','center','normal','figure-single');
      const comparison=serializeImageBlock(images.map((image,index)=>({...image,comparisonLabel:index?'右の検証画像':'左の検証画像'})),'Comparisonの検証','center','comparison','figure-comparison');
      const table=window.MemoNexusTableBlockUtils.serializeTableBlock({...createTableBlock('table-source-test'),caption:'Table検証',rows:[['項目','値'],['A','12'],['B','24']]});
      const chart=serializeChartBlock({...createChartBlock('chart-source-test'),title:'Chart検証',items:[{id:'a',label:'A'},{id:'b',label:'B'}],series:[{id:'series',name:'検証系列',color:'#4f46e5',values:[12,24]}]});
      const timeline=serializeTimelineBlock({id:'timeline-source-test',title:'Timeline検証',items:[{id:'event',title:'Figureを参照',body:'本文 [@'+sources[0].id+']',figureId:'figure-single',citationIds:[sources[1].id]}]});
      let drawing=createGeometryBlock('diagram-source-test');
      for(const point of [{x:15,y:80},{x:50,y:15},{x:85,y:80}])drawing=window.MemoNexusGeometryEditorUtils.addPoint(drawing,point);
      drawing=window.MemoNexusGeometryEditorUtils.addPolygon(drawing,drawing.points.map(p=>p.id));
      const geometry=window.MemoNexusGeometryBlockUtils.serializeGeometryBlock({...drawing,version:2,caption:'Diagram検証',diagram:{description:'検証用の模式図',citationIds:[sources[0].id,sources[1].id]}});
      return {sources,content:'検証データです。実在資料ではありません。本文 [@'+sources[0].id+']\n'+figure+'\n'+comparison+'\n'+table+'\n'+chart+'\n'+timeline+'\n'+geometry};
    });
    const ids=fixture.sources.map(s=>s.id);
    const body=await page.evaluate(f=>withSources(f.content,f.sources),fixture);
    await fillBody(page,body);
    // Each Figure/Comparison image and each block has save, empty, cancel and one-step history.
    for(const [kind,index,imageIndex] of [['figure',0,0],['figure',1,0],['figure',1,1],['table',0,0],['chart',0,0]]){
      const before=await state(page);
      panel=kind==='figure'?await selectFigure(page,index,imageIndex):await selectBlock(page,kind,index);
      await selectIds(panel,[ids[1],ids[0]]);
      await panel.getByRole('button',{name:'キャンセル',exact:true}).click();
      assert.deepEqual(await state(page),before,kind+' cancel has no persistence/history side effects');
      panel=kind==='figure'?await selectFigure(page,index,imageIndex):await selectBlock(page,kind,index);
      await selectIds(panel,[ids[1],ids[0]]);
      const selected=await savePanel(page,panel,kind);
      const references=kind==='figure'?selected.images[index].images[imageIndex].figureMetadata.citationIds:selected[kind+'s'][index].citationIds;
      assert.deepEqual(references,[ids[1],ids[0]],kind+' selection order');assert.equal(selected.undo,before.undo+1);
      await page.locator('#undoBtn').click();assert.equal((await saved(page)).body,before.body);
      await page.locator('#redoBtn').click();assert.equal((await saved(page)).body,selected.body);
      panel=kind==='figure'?await selectFigure(page,index,imageIndex):await selectBlock(page,kind,index);
      for(const id of ids.slice(0,2)) await panel.locator('.content-source-selector input[value="'+id+'"]').uncheck();
      const cleared=await savePanel(page,panel,kind);
      assert.equal(kind==='figure'?cleared.images[index].images[imageIndex].figureMetadata?.citationIds:cleared[kind+'s'][index].citationIds,undefined);
      await page.locator('#undoBtn').click();assert.equal((await saved(page)).body,selected.body);
    }
    panel=await selectFigure(page,1,1);
    await panel.locator('.content-source-selector input[value="'+ids[1]+'"]').uncheck();
    await savePanel(page,panel,'figure');
    assert.equal(await page.locator(canonical).nth(1).locator(".figure-metadata").count(),0,"Sourceだけの画像に空の従来資料欄を作らない");
    let mixed=await saved(page);
    assert.equal(await page.locator('.report-sources li').count(),2);
    const links=await page.locator('#preview .citation-link').evaluateAll(els=>els.map(el=>({id:el.getAttribute('href'),text:el.textContent})));
    for(const link of links)assert.equal(link.text,link.id==='#source-'+ids[0]?'[1]':'[2]');
    assert.deepEqual(await page.locator('.timeline-item .content-citations .citation-link').allTextContents(),['[2]','[1]']);
    assert.match(await page.locator(canonical).first().innerText(),/従来資料名/);
    // Every new reference independently prevents deletion using the live body.
    const mixedBody=mixed.body;
    for(const [kind,index] of [['image',0],['image',1],['table',0],['chart',0]]){
      const isolated=await page.evaluate(([kind,index])=>{
        const sources=parseSourceDocument(editor.value).sources;
        const block=kind==='image'?splitImageBlocks(editor.value).filter(b=>b.type==='image')[index]:kind==='table'?splitTableBlocks(editor.value).find(b=>b.type==='table'):splitChartBlocks(editor.value).find(b=>b.type==='chart');
        return withSources(block.raw,sources);
      },[kind,index]);
      await fillBody(page,isolated);const before=await state(page);
      await page.locator('#manageSourcesBtn').click();await page.locator('.source-list-item').first().getByRole('button',{name:'削除',exact:true}).click();
      await page.locator('#sourceStatus').getByText(/参照されています/).waitFor();await page.locator('#closeSourceDialogBtn').click();assert.deepEqual(await state(page),before);
      await fillBody(page,mixedBody);
    }
    await page.locator('#manageSourcesBtn').click();await page.locator('.source-list-item').first().getByRole('button',{name:'編集',exact:true}).click();
    await page.locator('#sourceForm [name="title"]').fill('更新済みの検証Source A（架空のテスト用）'+'長い資料名'.repeat(12));
    await page.locator('#sourceForm button[type="submit"]').first().click();await page.locator('#closeSourceDialogBtn').click();await saved(page);
    assert.match(await page.locator('.report-sources').innerText(),/更新済み/);
    for(const [kind,index,imageIndex] of [['figure',0,0],['figure',1,1],['table',0,0],['chart',0,0]]){
      panel=kind==='figure'?await selectFigure(page,index,imageIndex):await selectBlock(page,kind,index);
      assert.match(await panel.innerText(),/更新済み/);await panel.getByRole('button',{name:'キャンセル',exact:true}).click();
    }
    // Swap, normal/comparison mode, deletion and fresh addition retain the surviving image's references.
    let menu=await figureMenu(page,1);await menu.getByRole('button',{name:'左右を入れ替える'}).click();let swapped=await saved(page);
    assert.deepEqual(swapped.images[1].images,mixed.images[1].images.slice().reverse());
    menu=await figureMenu(page,1);await menu.getByRole('button',{name:'比較表示を設定'}).click();
    let mode=menu.locator('.image-comparison-editor');await mode.getByLabel('表示モード').selectOption('normal');await mode.getByRole('button',{name:'比較設定を保存'}).click();
    assert.deepEqual((await saved(page)).images[1].images,swapped.images[1].images);
    menu=await figureMenu(page,1);page.once('dialog',d=>d.accept());await menu.locator('.image-block-remove').first().click();let removed=await saved(page);
    assert.equal(removed.images[1].images.length,1);assert.deepEqual(removed.images[1].images[0],swapped.images[1].images[1]);
    menu=await figureMenu(page,1);await menu.getByRole('button',{name:'画像を追加',exact:true}).click();
    await page.locator('#imageBlockInput').setInputFiles({name:'追加検証画像.png',mimeType:'image/png',buffer:png});
    await page.locator(canonical).nth(1).locator('.image-block-item').nth(1).waitFor();let added=await saved(page);
    assert.equal(added.images[1].images[1].figureMetadata,undefined);assert.deepEqual(added.images[1].images[0],removed.images[1].images[0]);
    // Identical copies, including Source metadata before blocks and display-only anchor removal.
    menu=await figureMenu(page,1);await menu.getByRole('button',{name:'比較表示を設定'}).click();
    mode=menu.locator('.image-comparison-editor');await mode.getByLabel('表示モード').selectOption('comparison');await mode.getByRole('button',{name:'比較設定を保存'}).click();
    mixed=await saved(page);const checkpoint=mixed.body;
    for(const kind of ['figure','table','chart']){
      const copied=await page.evaluate(kind=>{
        const sources=parseSourceDocument(editor.value).sources;
        const raw=kind==='figure'?splitImageBlocks(editor.value).find(b=>b.type==='image').raw:kind==='table'?splitTableBlocks(editor.value).find(b=>b.type==='table').raw:splitChartBlocks(editor.value).find(b=>b.type==='chart').raw;
        return withSources('',sources)+'\n'+buildExplanationAnchorComment('source-copy')+'\n'+raw+'\n'+raw+'\n'+raw;
      },kind);await fillBody(page,copied);
      panel=kind==='figure'?await selectFigure(page,1,0):await selectBlock(page,kind,1);
      await panel.locator('.content-source-selector input[value="'+ids[1]+'"]').uncheck();const edited=await savePanel(page,panel,kind);
      const values=kind==='figure'?edited.images.map(b=>b.images[0].figureMetadata.citationIds):edited[kind+'s'].map(b=>b.citationIds);
      assert.deepEqual(values,[[ids[1],ids[0]],[ids[0]],[ids[1],ids[0]]]);
      await page.reload();await page.locator('#appStartupGuard').waitFor({state:'hidden'});assert.equal((await saved(page)).body,edited.body);
      await fillBody(page,checkpoint);
    }
    // Actual cell/row and chart type/series edits retain the selected references.
    let tableEdit=page.locator('.table-block-editor').first();
    await tableEdit.locator('.table-block-cell-input[data-row-index="1"][data-column-index="1"]').fill('15');await saved(page);
    if(await tableEdit.locator('details').getAttribute('open')===null)await tableEdit.locator('summary').click();
    await tableEdit.getByRole('button',{name:'行を追加',exact:true}).click();await saved(page);
    assert.deepEqual((await state(page)).tables[0].citationIds,[ids[1],ids[0]]);
    let chartEdit=page.locator('.chart-block-editor').first();
    await chartEdit.locator('[data-chart-field="chartType"]').selectOption('line');await saved(page);
    await chartEdit.locator('[data-chart-action="add-series"]').click();await saved(page);
    await chartEdit.locator('[data-chart-action="move-series-down"]').first().click();await saved(page);
    await chartEdit.locator('[data-chart-action="confirm"]').click();await saved(page);
    assert.deepEqual((await state(page)).charts[0].citationIds,[ids[1],ids[0]]);
    await fillBody(page,checkpoint);
    // Table→Chart takes a creation-time snapshot, with independent Source editing after save.
    let tableEditor=page.locator('.table-block-editor').first();await tableEditor.locator('summary').click();await tableEditor.getByRole('button',{name:'グラフを作成',exact:true}).click();
    let pending=page.locator('[data-chart-pending-table]');await pending.waitFor();
    panel=await selectBlock(page,'chart',1);assert.equal(await panel.locator('.content-source-selector input[value="'+ids[0]+'"]').isChecked(),true);
    await panel.getByRole('button',{name:'キャンセル',exact:true}).click();await pending.getByRole('button',{name:'入力を確定',exact:true}).click();await saved(page);
    assert.deepEqual((await state(page)).charts[0].citationIds,[ids[1],ids[0]]);
    panel=await selectBlock(page,'table');await panel.locator('.content-source-selector input[value="'+ids[1]+'"]').uncheck();await savePanel(page,panel,'table');
    assert.deepEqual((await state(page)).charts[0].citationIds,[ids[1],ids[0]],'saved chart never follows later table edits');
    await fillBody(page,checkpoint);
    // Stale open dialogs preserve the new body and Source IDs.
    for(const kind of ['table','chart']){
      panel=await selectBlock(page,kind);await panel.locator('.content-source-selector input[value="'+ids[0]+'"]').uncheck();
      await page.evaluate(()=>commitSourceBody(editor.value+'\n外部更新'));
      const external=await saved(page);await panel.getByRole('button',{name:'Source選択を保存'}).click();
      await panel.getByText(/メモが更新されました/).waitFor();await panel.getByRole('button',{name:'キャンセル',exact:true}).click();assert.deepEqual(await state(page),external);
    }
    await fillBody(page,checkpoint);
    // Missing IDs stay selected and visible; no-op saves preserve the marker.
    const missing=await page.evaluate(()=>{const b=splitTableBlocks(editor.value).find(b=>b.type==='table');return replaceTableBlock(editor.value,b,{...b.table,citationIds:['missing-source',...b.table.citationIds]});});
    await fillBody(page,missing);assert.match(await page.locator('#preview .table-block .content-citations').innerText(),/未登録Source: missing-source/);
    panel=await selectBlock(page,'table');assert.equal(await panel.locator('input[value="missing-source"]').isChecked(),true);await savePanel(page,panel,'table');
    await fillBody(page,checkpoint);mixed=await saved(page);
    // Viewing normal/Report Preview at PC and 320px never mutates save/history state.
    const review=path.join(root,'e2e-artifacts/report-source-review',engine);fs.mkdirSync(review,{recursive:true});
    await layout(page);await page.locator('#previewCard').screenshot({path:path.join(review,'sources-preview-pc.png')});
    await page.locator('#reportPreviewBtn').click();await page.locator('body.report-preview-mode').waitFor();await layout(page);
    for(const selector of ['.image-block-menu-toggle','.chart-block-edit','.timeline-edit','.table-block-editors','.geometry-block-editors'])assert.equal(await page.locator(selector).first().isVisible(),false,selector);
    await page.setViewportSize({width:1280,height:1800});await layout(page);await page.setViewportSize({width:1280,height:await page.locator('#preview').evaluate(el=>el.scrollHeight+200)});await layout(page);await page.screenshot({path:path.join(review,'sources-report-pc.png')});
    await page.setViewportSize({width:320,height:844});await layout(page);await page.setViewportSize({width:320,height:await page.locator('#preview').evaluate(el=>el.scrollHeight+200)});await layout(page);await page.screenshot({path:path.join(review,'sources-report-320.png')});
    assert.deepEqual(await state(page),mixed,'report reading changes no body/revision/time/save/history');
    await page.setViewportSize({width:320,height:844});await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.body.classList.contains('report-preview-mode'));
    if(await page.locator('#contextPanel').getAttribute('aria-hidden')==='false')await page.locator('#closeContextPanelBtn').click();
    await page.locator('#cardPaneBtn').click();await page.waitForFunction(()=>mobileCardOpen);await layout(page);await page.locator('#previewCard').screenshot({path:path.join(review,'sources-preview-320.png')});
    panel=await selectFigure(page,0);assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await panel.getByRole('button',{name:'キャンセル',exact:true}).click();assert.deepEqual(await state(page),mixed);
    await page.locator('#closeCardPaneBtn').click();await page.waitForFunction(()=>!mobileCardOpen);
    panel=await selectBlock(page,'table');assert.equal(await panel.evaluate(el=>el.getBoundingClientRect().width<=innerWidth&&el.scrollWidth<=el.clientWidth+1),true);
    await panel.getByRole('button',{name:'キャンセル',exact:true}).click();
    await page.setViewportSize({width:1280,height:900});await layout(page);
    await page.reload();await page.locator('#appStartupGuard').waitFor({state:'hidden'});assert.equal((await saved(page)).body,mixed.body);
    const noteId=await page.evaluate(()=>currentId);
    const markdown=await download(page,async()=>{await page.locator('#noteExportBtn').click();await page.locator('#downloadExportBtn').click();});
    const backup=await download(page,()=>page.locator('#backupBtn').click());
    for(const [name,buffer] of [['markdown',markdown],['backup',backup]]){
      const restored=await open();await restored.locator('#importMarkdownZipInput').setInputFiles({name:name+'.zip',mimeType:'application/zip',buffer});
      if(name==='backup'){await restored.locator('#backupPreviewDialog').waitFor({state:'visible'});await restored.locator('#confirmBackupPreviewBtn').click();await restored.locator('#backupPreviewStatus').getByText(/取り込みが完了しました/).waitFor();await restored.locator('#cancelBackupPreviewBtn').click();await restored.evaluate(id=>openNote(id),noteId);}
      await restored.locator('#preview .table-block').waitFor();const result=await saved(restored);
      assert.deepEqual(result.sources,mixed.sources);assert.deepEqual(result.tables,mixed.tables);assert.deepEqual(result.charts,mixed.charts);
      assert.deepEqual(result.images.slice(0,mixed.images.length).map(b=>b.images.map(i=>i.figureMetadata)),mixed.images.map(b=>b.images.map(i=>i.figureMetadata)));
      // Existing Markdown ZIP export appends an unused attachment as an ordinary image.
      assert.equal(result.images.length,mixed.images.length+(name==='markdown'?1:0));
      for(const extra of result.images.slice(mixed.images.length))assert.equal(extra.images[0].figureMetadata,undefined);
      if(name==='markdown')assert.notEqual(result.images[0].images[0].id,mixed.images[0].images[0].id);
      assert.deepEqual(await restored.locator('.timeline-item .content-citations .citation-link').allTextContents(),['[2]','[1]']);
      assert.equal(await restored.locator('.report-sources li').count(),2);
      await restored.reload();await restored.locator('#appStartupGuard').waitFor({state:'hidden'});assert.equal((await saved(restored)).body,result.body);await restored.close();
    }
    // Direct body removal releases references and cannot reconnect to the remaining metadata.
    await fillBody(page,await page.evaluate(()=>withSources('全ブロックを削除した検証',parseSourceDocument(editor.value).sources)));
    await page.locator('#manageSourcesBtn').click();await page.locator('.source-list-item').first().getByRole('button',{name:'削除',exact:true}).click();await saved(page);
    assert.equal(await page.locator('.source-list-item').count(),2);assert.deepEqual(errors,[]);
    console.log('Report Source E2E passed ('+engine+'): selectors, cancel, history, live sources, duplicates, conversion, mixed rendering, PC/320, real ZIP restore');
    await page.close();
  }finally{
    for(const context of contexts)await context.close();
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
    for(const profile of profiles){
      const resolved=path.resolve(profile);
      if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('memo-source-webkit-'))throw new Error('Unexpected temporary profile path');
      fs.rmSync(resolved,{recursive:true,force:true});
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
