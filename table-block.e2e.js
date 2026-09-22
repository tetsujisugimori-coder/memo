"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const playwright = require("playwright");
const browserName = process.env.MEMO_NEXUS_E2E_BROWSER || "chromium";
const artifacts = path.join(__dirname, "e2e-artifacts", "table-file-import", browserName);
const one = '<table><tr><th>項目</th><th>値</th></tr><tr><td>りんご</td><td>10</td></tr></table>';
const two = '<table><tr><td>品目</td><td>数</td></tr><tr><td>みかん</td><td>20</td></tr></table>';
const html = '<p>文章A 😀</p>' + one + '<div>文章B<br>ABC 123</div>' + two + '<p>文章C</p>';
const plain = "元の文章A\n項目\t値\nりんご\t10\n元の文章B\n品目\t数\nみかん\t20\n元の文章C";
async function idle(page) {
 await page.waitForFunction(()=>!noteSaveFoundation.isDirty(currentId) && saveTimer===null && window.MemoNexusTypingDerivedUiScheduler.pendingRequestType()===null);
}
async function snapshot(page) {
 return page.evaluate(async()=>({body:editor.value,note:structuredClone(currentNote()),state:noteSaveFoundation.getState(currentId),saveTimer,
  undo:structuredClone(undoStack),redo:structuredClone(redoStack),stored:(await getStoredNotes()).find(n=>n.id===currentId)}));
}
async function load(page,body="先XX末") {
 await page.locator("#editor").fill(body); await idle(page);
 assert.equal(await page.locator("#editor").inputValue(),body);
 await page.locator("#editor").focus();
 await page.evaluate(()=>editor.setSelectionRange(1,3));
}
async function paste(page, source=html, text=plain) {
 return page.locator("#editor").evaluate((editor,{source,text})=>{
  const data=new DataTransfer(); if(source)data.setData("text/html",source); if(text)data.setData("text/plain",text);
  const event=new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true});
  editor.dispatchEvent(event); return event.defaultPrevented;
 },{source,text});
}
async function cancel(page,method="button") {
 if(method==="escape")await page.keyboard.press("Escape");
 else await page.locator(method==="close"?"#closeTablePasteBtn":"#cancelTablePasteBtn").click();
 await page.locator("#tablePasteDialog").waitFor({state:"hidden"});
 try { await page.waitForFunction(()=>document.activeElement===editor); } catch(error) { console.error("Cancel state",await page.evaluate(()=>({active:document.activeElement?.tagName,body:editor.value,pending:pendingTablePaste,currentId,open:tablePasteDialog.open,selection:[editor.selectionStart,editor.selectionEnd]})));throw error; }
}
async function models(page) {return page.evaluate(()=>MemoNexusTableBlockUtils.splitTableBlocks(editor.value).filter(x=>x.type==="table").map(x=>x.table));}
async function chooseTableFile(page, file) {
 const chooserPromise=page.waitForEvent("filechooser");
 await page.getByRole("button",{name:"CSVまたはTSVファイルを表として読み込む",exact:true}).click();
 await (await chooserPromise).setFiles(file);
}

// Assert rendered cells independently of the application's table parser.
function tableEditor(page, index = 0) {
  return page.locator('#tableBlockEditors > article[data-table-id]').nth(index);
}
async function assertTableDom(page, index, rows, hasHeader = true) {
  await idle(page);
  const block = tableEditor(page, index);
  assert.deepEqual(await block.locator('tbody tr').evaluateAll(elements => elements.map(row =>
    Array.from(row.querySelectorAll('input[data-row-index][data-column-index]'), input => input.value))), rows);
  assert.equal(await block.locator('thead [data-table-axis="column"]').count(), rows[0].length);
  const rendered = page.locator('#preview table').nth(index);
  assert.deepEqual(await rendered.locator('tr').evaluateAll(elements => elements.map(row =>
    Array.from(row.cells, cell => cell.textContent))), rows);
  assert.equal(await rendered.locator('thead tr').count(), hasHeader ? 1 : 0);
}
async function waitForCellFocus(block, row, column) {
  const id = await block.getAttribute('data-table-id');
  await block.page().waitForFunction(({ id, row, column }) => {
    const input = document.activeElement;
    return input?.closest('article[data-table-id]')?.dataset.tableId === id
      && input.dataset.rowIndex === String(row) && input.dataset.columnIndex === String(column);
  }, { id, row, column });
}
async function tableAction(block, action) {
  const menu = block.locator('details');
  if (!await menu.evaluate(element => element.open)) await menu.locator('summary').click();
  await menu.locator('[data-table-action="' + action + '"]').click();
}
async function editCell(block, row, column, value) {
  const input = block.locator('[data-row-index="' + row + '"][data-column-index="' + column + '"]');
  await input.fill(value);
  assert.equal(await input.inputValue(), value);
}
async function reopen(page, title) {
  // A real reload reconstructs the editor and preview from saved storage.
  await idle(page);
  const saved = await snapshot(page);
  assert.equal(saved.stored.body, saved.body, 'IndexedDB contains the latest body before reopening');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#appStartupGuard').waitFor({ state: 'hidden' });
  await idle(page);
  assert.equal(await page.locator('#titleInput').inputValue(), title);
  assert.equal(await page.locator('#editor').inputValue(), saved.body);
}
async function verifyTableLifecycle(page) {
  const previousId = await page.evaluate(() => currentId);
  await page.locator('#newBtn').click();
  await page.waitForFunction(id => currentId !== id && document.activeElement === editor, previousId);
  const title = 'table-e2e-lifecycle-' + require('node:crypto').randomUUID();
  await page.locator('#titleInput').fill(title);
  await page.locator('#editor').fill('ライフサイクル本文');
  await idle(page);
  await page.getByRole('button', { name: '表ブロックを挿入', exact: true }).click();
  const block = tableEditor(page);
  await waitForCellFocus(block, 0, 0);
  assert.equal(await page.locator('#tableBlockEditors > article[data-table-id]').count(), 1);
  const tableId = await block.getAttribute('data-table-id');
  await assertTableDom(page, 0, [['', ''], ['', '']]);
  for (const [row, values] of [['項目A', '削除列B'], ['削除行C', '削除交点D']].entries()) {
    for (const [column, value] of values.entries()) await editCell(block, row, column, value);
  }
  await assertTableDom(page, 0, [['項目A', '削除列B'], ['削除行C', '削除交点D']]);
  await tableAction(block, 'add-row');
  await waitForCellFocus(block, 2, 0);
  await assertTableDom(page, 0, [['項目A', '削除列B'], ['削除行C', '削除交点D'], ['', '']]);
  await editCell(block, 2, 0, '追加行E');
  await editCell(block, 2, 1, '削除列F');
  await tableAction(block, 'add-column');
  await waitForCellFocus(block, 0, 2);
  await assertTableDom(page, 0, [['項目A', '削除列B', ''], ['削除行C', '削除交点D', ''], ['追加行E', '削除列F', '']]);
  for (const [row, value] of ['追加列G', '削除行H', '追加交点I'].entries()) await editCell(block, row, 2, value);
  await assertTableDom(page, 0, [['項目A', '削除列B', '追加列G'], ['削除行C', '削除交点D', '削除行H'], ['追加行E', '削除列F', '追加交点I']]);
  // Delete the middle axes so shifted surviving cells must retain their values.
  for (const axis of ['row', 'column']) {
    await block.locator('[data-table-axis="' + axis + '"][data-table-axis-index="1"]').click();
    await tableAction(block, 'delete-' + axis);
    await page.locator('#tableAxisDeleteDialog').waitFor({ state: 'visible' });
    await page.locator('#confirmTableAxisDeleteBtn').click();
    await page.locator('#tableAxisDeleteDialog').waitFor({ state: 'hidden' });
    await idle(page);
    await assertTableDom(page, 0, axis === 'row'
      ? [['項目A', '削除列B', '追加列G'], ['追加行E', '削除列F', '追加交点I']]
      : [['項目A', '追加列G'], ['追加行E', '追加交点I']]);
  }
  await reopen(page, title);
  assert.equal(await block.getAttribute('data-table-id'), tableId);
  await assertTableDom(page, 0, [['項目A', '追加列G'], ['追加行E', '追加交点I']]);
  await editCell(block, 0, 1, '再編集J');
  await editCell(block, 1, 0, '再編集K');
  await assertTableDom(page, 0, [['項目A', '再編集J'], ['再編集K', '追加交点I']]);
  await reopen(page, title);
  assert.equal(await block.getAttribute('data-table-id'), tableId);
  await assertTableDom(page, 0, [['項目A', '再編集J'], ['再編集K', '追加交点I']]);
  console.log('Table lifecycle: UI creation, cell edits, row/column addition/deletion, save/reopen and re-edit/re-save passed');
}
async function assertMixedDom(page, values = ['10', '20']) {
  await assertTableDom(page, 0, [['項目', '値'], ['りんご', values[0]]], false);
  await assertTableDom(page, 1, [['品目', '数'], ['みかん', values[1]]], true);
  assert.equal(await page.locator('#tableBlockEditors > article[data-table-id]').count(), 2);
  assert.equal(await page.locator('#preview table').count(), 2);
  const ids = await page.locator('#tableBlockEditors > article[data-table-id]').evaluateAll(elements => elements.map(el => el.dataset.tableId));
  assert.equal(new Set(ids).size, 2);
  assert.deepEqual(await page.locator('#preview [data-table-id]').evaluateAll(elements => elements.map(el => el.dataset.tableId)), ids);
  const order = await page.locator('#preview').evaluate(element =>
    Array.from(element.querySelectorAll('p, table'), node => node.tagName === 'TABLE'
      ? { table: Array.from(node.rows, row => Array.from(row.cells, cell => cell.textContent)) }
      : node.textContent.replace(/\s+/g, '')));
  assert.deepEqual(order, ['先文章A😀', { table: [['項目', '値'], ['りんご', values[0]]] },
    '文章BABC123', { table: [['品目', '数'], ['みかん', values[1]]] }, '文章C末']);
}

async function nativeParsing(page) {
 const result=await page.evaluate(({html,one,two})=>{
  const u=MemoNexusTableBlockUtils;
  const parsed=u.detectPastedTable({html});
  const complex=u.detectPastedTable({html:'<h1>見出し</h1><ul><li>項目A</li><li><b>太字</b> <a href="javascript:alert(1)">リンク</a></li></ul><script>window.__unsafe=1</script><style>危険</style><template>危険</template><noscript>危険</noscript><!--comment--><img src="https://paste.invalid/a" onerror="window.__unsafe=2">'+one});
  const nested=u.detectPastedTable({html:'<p>前</p><table><tr><td>外'+two+'</td><td>終</td></tr></table><p>後</p>'});
  const merged=u.detectPastedTable({html:'<table><tr><th rowspan="2" colspan="2">結合</th><th>列</th></tr><tr><td>値</td></tr></table>'+two});
  const invalid=u.detectPastedTable({html:one+'<table><caption>壊れた表</caption></table><p>後</p>',text:'全文'});
  const single=u.detectPastedTable({html:' \n'+one+'<div> </div>'});
  const noTable=u.detectPastedTable({html:'<p>通常</p>',text:'通常'});
  const fallback=u.detectPastedTable({html:'<table>',text:'A\tB'},class{parseFromString(){throw Error("parse");}});
  return {parsed,complex,nested,merged,invalid,single,noTable,fallback};
 },{html,one,two});
 assert.deepEqual(result.parsed.segments.map(x=>x.type),["text","table","text","table","text"]);
 assert.match(result.parsed.plainText,/文章A[\s\S]*りんご[\s\S]*文章B[\s\S]*みかん[\s\S]*文章C/);
 assert.equal(result.complex.segments[0].text,"見出し\n\n項目A\n\n太字 リンク");
 assert.doesNotMatch(result.complex.plainText,/危険|comment|unsafe|paste.invalid|href|<b>/);
 assert.equal(result.nested.segments.filter(x=>x.type==="table").length,1);
 assert.match(result.nested.segments[1].table.rows[0][0],/外品目数みかん20/);
 assert.deepEqual(result.merged.segments.map(x=>x.table.hasMergedCells),[true,false]);
 assert.deepEqual(result.merged.segments[0].table.rows,[["結合","","列"],["","","値"]]);
 assert.equal(result.invalid.parseFailed,true); assert.equal(result.invalid.plainText,"全文");
 assert.equal(result.single.format,"html");assert.equal(result.noTable,null);assert.equal(result.fallback.format,"tab-separated");
 assert.equal(await page.evaluate(()=>window.__unsafe),undefined);
}
async function verify(page) {
 const previousId=await page.evaluate(()=>currentId);
 await page.locator("#newBtn").click();
 await page.waitForFunction(id=>currentId!==id&&document.activeElement===editor,previousId);await idle(page);
 const title = "table-e2e-mixed-" + require("node:crypto").randomUUID();
 await page.locator("#titleInput").fill(title); await idle(page);
 await nativeParsing(page);
 await load(page); const before=await snapshot(page);
 assert.equal(await paste(page),true);
 assert.equal(await page.locator("#tablePasteTitle").textContent(),"文章と表を分けて貼り付けますか？");
 assert.match(await page.locator("#tablePasteSummary").textContent(),/文章3区間・表2件/);
 assert.deepEqual(await page.locator(".table-paste-entry > p").allTextContents(),["表1：2行 × 2列（4セル）","表2：2行 × 2列（4セル）"]);
 const header1=page.getByRole("checkbox",{name:"表1：1行目を見出しにする",exact:true});
 const header2=page.getByRole("checkbox",{name:"表2：1行目を見出しにする",exact:true});
 assert.equal(await header1.isChecked(),true);assert.equal(await header2.isChecked(),false);
 assert.equal(await page.locator("#tablePasteHeaderOption").isVisible(),false);
 await header1.uncheck(); await header2.check();
 await header2.focus(); await page.keyboard.press("Enter");
 assert.equal(await page.locator("#tablePasteDialog").isVisible(),true,"Enter on a mixed checkbox must not confirm");
 for(const key of ["Tab","Shift+Tab"]){await page.keyboard.press(key);assert.equal(await page.evaluate(()=>tablePasteDialog.contains(document.activeElement)),true);}
 assert.deepEqual(await snapshot(page),before,"preview/header changes are read-only");
 await page.locator("#confirmTablePasteBtn").click(); await idle(page);
 await assertMixedDom(page);
 const saved=await snapshot(page),tables=await models(page);
 assert.equal(tables.length,2);assert.notEqual(tables[0].id,tables[1].id);
 assert.deepEqual(tables.map(x=>x.hasHeader),[false,true]);
 const serialized=await page.evaluate(()=>MemoNexusTableBlockUtils.splitTableBlocks(editor.value).map(x=>x.type==="text"?x.text.trim():x.table.rows[0][0]));
 assert.deepEqual(serialized,["先\n文章A 😀","項目","文章B\nABC 123","品目","文章C\n末"]);
 assert.equal(await page.evaluate(()=>document.activeElement===editor && editor.selectionStart===editor.value.indexOf("末")),true);
 await page.waitForFunction(()=>document.querySelectorAll("#preview .table-block").length===2);
 const preview=await page.locator("#preview").textContent();
 assert.match(preview,/文章A[\s\S]*りんご[\s\S]*文章B[\s\S]*みかん[\s\S]*文章C/);
 await page.locator("#undoBtn").click();await idle(page);assert.equal((await snapshot(page)).body,before.body);
 await page.locator("#redoBtn").click();await idle(page);assert.equal((await snapshot(page)).body,saved.body);
 await page.reload({waitUntil:"domcontentloaded"});await page.locator("#appStartupGuard").waitFor({state:"hidden"});await idle(page);
 assert.equal((await snapshot(page)).body,saved.body);assert.deepEqual(await models(page),tables);
 await assertMixedDom(page);
 for(let i=0;i<2;i++){
  const block=page.locator(".table-block-editor").nth(i);
  await block.locator('[data-row-index="1"][data-column-index="1"]').fill(String(100+i)); await idle(page);
  const current=await models(page);assert.equal(current[i].rows[1][1],String(100+i));
  assert.equal(current[1-i].rows[1][1],i===0?"20":"100");
  assert.equal(await block.locator(".table-block-caption-input").count(),1);
  assert.equal(await block.locator(".table-block-note-input").count(),1);
  for(const action of ["add-row","add-column","copy-table","copy-markdown"])assert.equal(await block.locator('[data-table-action="'+action+'"]').count(),1);
 }
 await assertMixedDom(page, ["100", "101"]);
 await reopen(page, title);
 await assertMixedDom(page, ["100", "101"]);
 for(const method of ["button","escape","close"]){
  await load(page);const unchanged=await snapshot(page);await paste(page);await cancel(page,method);
  assert.deepEqual(await snapshot(page),unchanged);assert.deepEqual(await page.evaluate(()=>[editor.selectionStart,editor.selectionEnd]),[1,3]);
 }
 await paste(page);await page.locator("#pasteTableAsTextBtn").click();await idle(page);
 assert.equal((await snapshot(page)).body,"先"+plain+"末");
 await page.locator("#undoBtn").click();await idle(page);assert.equal((await snapshot(page)).body,"先XX末");
 await load(page);await paste(page,html,"");await page.locator("#pasteTableAsTextBtn").click();await idle(page);
 assert.match((await snapshot(page)).body,/先文章A[\s\S]*りんご[\s\S]*文章B[\s\S]*みかん[\s\S]*文章C末/);
 for(const [source,text,format] of [[one,"","HTML表"],["","A | B\n--- | ---\n1 | 2","Markdown表"],["","A\tB\n1\t2","スプレッドシート形式"]]){
  await load(page);await paste(page,source,text);
  assert.equal(await page.locator("#tablePasteTitle").textContent(),"表として貼り付けますか？");
  assert.equal(await page.locator("#tablePasteHeaderOption").isVisible(),true);
  assert.match(await page.locator("#tablePasteFormat").textContent(),new RegExp(format));
  await page.locator("#confirmTablePasteBtn").click();await idle(page);
  await page.waitForFunction(()=>document.activeElement?.matches('.table-block-cell-input[data-row-index="0"][data-column-index="0"]'));
  assert.equal((await models(page)).length,1);
 }
 // Failure and conflict checks compare persisted state and histories before/after.
 const tooLarge=one.repeat(11);
 for(const source of [tooLarge,one+'<table><caption>解析不能</caption></table>', '<p>前</p><table>'+Array(101).fill('<tr><td>x</td></tr>').join('')+'</table>', '<p>前</p><table><tr>'+Array(31).fill('<td>x</td>').join('')+'</tr></table>', '<table>'+Array(100).fill('<tr>'+Array(30).fill('<td>x</td>').join('')+'</tr>').join('')+'</table>'+two]){
  await load(page);const unchanged=await snapshot(page);await paste(page,source);
  assert.equal(await page.locator("#confirmTablePasteBtn").isVisible(),false);
  assert.equal(await page.locator("#pasteTableAsTextBtn").isVisible(),true);
  assert.match(await page.locator("#tablePasteWarning").textContent(),/100行[\s\S]*30列[\s\S]*3000セル[\s\S]*10件/);
  await cancel(page);assert.deepEqual(await snapshot(page),unchanged);
 }
 await load(page);await paste(page);const failureBefore=await snapshot(page);
 await page.evaluate(()=>{window.originalUUID=crypto.randomUUID;let count=0;crypto.randomUUID=()=>{if(count++)throw Error("injected second table");return window.originalUUID.call(crypto);};});
 await page.locator("#confirmTablePasteBtn").click();
 assert.deepEqual(await snapshot(page),failureBefore);assert.match(await page.locator("#tablePasteWarning").textContent(),/作成できません/);
 await page.evaluate(()=>{crypto.randomUUID=window.originalUUID;});await cancel(page);
 for(const conflict of ["body","selection","note"]){
  await load(page);await paste(page);
  await page.evaluate(conflict=>{
   if(conflict==="body")editor.value+="変更";
   if(conflict==="selection")editor.setSelectionRange(0,0);
   if(conflict==="note")currentId=notes.find(n=>n.id!==currentId&&!n.deletedAt).id;
  },conflict);
  const unchanged=await snapshot(page);
  const dialog=page.waitForEvent("dialog").then(d=>d.accept());
  await page.locator("#confirmTablePasteBtn").click();await dialog;
  assert.deepEqual(await snapshot(page),unchanged);
  if(conflict==="note"){await page.reload({waitUntil:"domcontentloaded"});await page.locator("#appStartupGuard").waitFor({state:"hidden"});}
 }
 await load(page,"前\n\`\`\`\ncode\n\`\`\`\n後");await page.evaluate(()=>editor.setSelectionRange(8,8));
 assert.equal(await paste(page),false);assert.equal(await page.locator("#tablePasteDialog").isVisible(),false);
 await load(page);assert.equal(await paste(page,"<p>文章</p>","普通の文章"),false);
 // Marker safety uses the same range boundary path as a single table.
 await load(page);await paste(page,one,"");await page.locator("#confirmTablePasteBtn").click();await idle(page);
 const old=(await models(page))[0];
 await page.locator("#editor").focus();await page.evaluate(()=>editor.setSelectionRange(15,20));
 await paste(page);await page.locator("#confirmTablePasteBtn").click();await idle(page);
 assert.deepEqual((await models(page))[0],old);assert.equal((await models(page)).length,3);
 // Exercise merged/nested HTML through the confirmation UI, then malicious input through rendering.
 await load(page);
 await paste(page,'<p>前</p><table><tr><th rowspan="2">結合</th><th>値</th></tr><tr><td>7</td></tr></table>'+two,'');
 assert.match(await page.locator(".table-paste-entry .table-paste-warning").textContent(),/表1：結合セル/);
 await page.locator("#confirmTablePasteBtn").click();await idle(page);
 assert.deepEqual((await models(page))[0].rows,[["結合","値"],["","7"]]);
 await load(page);await paste(page,'<p>前</p><table><tr><td>外'+two+'</td><td>終</td></tr></table><p>後</p>','');
 await page.locator("#confirmTablePasteBtn").click();await idle(page);assert.equal((await models(page)).length,1);
 await load(page);
 await paste(page,'<p>安全<img src="https://paste.invalid/image" onerror="window.__unsafe=3"></p><script>window.__unsafe=4</script>'+one+two,'');
 await page.locator("#confirmTablePasteBtn").click();await idle(page);
 assert.equal(await page.evaluate(()=>window.__unsafe),undefined);
 assert.doesNotMatch((await snapshot(page)).body,/<img|<script|onerror|paste.invalid/);
 assert.equal(await page.locator('#preview img[src*="paste.invalid"]').count(),0);
 // Verify the clipboard routing boundary; the attachment pipeline has its own tests.
 // Windows WebKit's existing attachment storage failure is recorded separately against main.
 await load(page);
 const mixedClipboard = await page.locator("#editor").evaluate(async(editor,{html,plain})=>{
  const canvas=document.createElement("canvas");canvas.width=2;canvas.height=2;
  canvas.getContext("2d").fillRect(0,0,2,2);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
  const data=new DataTransfer();data.setData("text/html",html);data.setData("text/plain",plain);data.items.add(new File([blob],"paste.png",{type:"image/png"}));
  window.clipboardPasteOriginalHandler=handleAttachmentFiles;window.clipboardPasteCalls=[];
  handleAttachmentFiles=(files,options)=>{clipboardPasteCalls.push({files:files.map(file=>({type:file.type,size:file.size})),options});return Promise.resolve([]);};
  const event=new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true});
  editor.dispatchEvent(event);
  return {prevented:event.defaultPrevented,body:editor.value,pendingFiles:pendingTablePaste?.imageFiles.length||0};
 },{html,plain});
 assert.equal(mixedClipboard.prevented,true);assert.equal(mixedClipboard.pendingFiles,1);assert.equal(mixedClipboard.body,"先XX末");
 assert.equal(await page.locator("#tablePasteDialog").isVisible(),true);assert.equal(await page.locator("#pasteTableAsImageBtn").isVisible(),true);
 assert.equal(await page.evaluate(()=>clipboardPasteCalls.length),0);
 await page.locator("#pasteTableAsImageBtn").click();
 const imageChoice=await page.evaluate(()=>{const result=structuredClone(clipboardPasteCalls);handleAttachmentFiles=clipboardPasteOriginalHandler;delete window.clipboardPasteOriginalHandler;delete window.clipboardPasteCalls;return result;});
 assert.equal(imageChoice.length,1);assert.equal(imageChoice[0].files.length,1);assert.equal(imageChoice[0].files[0].type,"image/png");assert.ok(imageChoice[0].files[0].size>0);
 assert.deepEqual(imageChoice[0].options,{insertIntoEditor:true,inputType:"insertFromPaste",selectionStart:1,selectionEnd:3});
 assert.equal(await page.locator("#tablePasteDialog").isVisible(),false);assert.equal((await snapshot(page)).body,"先XX末");assert.deepEqual(await models(page),[]);
 await load(page);await paste(page,one,"");assert.equal(await page.locator("#pasteTableAsImageBtn").isVisible(),false);await cancel(page);
 console.log("Mixed paste: merged/nested/security and table/image/text routing passed");
 console.log("Mixed paste: parser, insertion, independent edits, persistence, Undo/Redo, cancellation, conflicts and compatibility passed");
}
async function verifyTableFileImport(page) {
 await load(page);const before=await snapshot(page);
 await chooseTableFile(page,{name:"売上.CSV",mimeType:"text/csv",buffer:Buffer.from("\ufeff項目,値,\r\n\"りん,ご\",\"引用符 \"\"x\"\"\",\r\n\"改行\nセル\",,")});
 await page.locator("#tablePasteDialog").waitFor({state:"visible"});
 assert.equal(await page.locator("#tablePasteTitle").textContent(),"CSVファイルを表として読み込みますか？");
 assert.equal(await page.locator("#tablePasteFileName").textContent(),"ファイル名：売上.CSV");
 assert.match(await page.locator("#tablePasteFormat").textContent(),/CSV（カンマ区切り）/);
 assert.match(await page.locator("#tablePasteSummary").textContent(),/3行 × 3列（9セル）/);
 assert.equal(await page.locator("#pasteTableAsImageBtn").isVisible(),false);
 assert.equal(await page.locator("#pasteTableAsTextBtn").isVisible(),false);
 assert.deepEqual(await snapshot(page),before,"file selection and confirmation are read-only");
 await page.locator("#tablePasteHeaderCheckbox").uncheck();
 await page.locator("#confirmTablePasteBtn").click();await idle(page);
 assert.deepEqual((await models(page))[0].rows,[["項目","値",""],["りん,ご","引用符 \"x\"",""],["改行\nセル","",""]]);
 assert.equal((await models(page))[0].hasHeader,false);
 await page.locator("#undoBtn").click();await idle(page);assert.equal((await snapshot(page)).body,before.body);assert.deepEqual(await models(page),[]);
 await page.locator("#redoBtn").click();await idle(page);assert.equal((await models(page)).length,1);
 const title=await page.locator("#titleInput").inputValue();await reopen(page,title);
 await editCell(tableEditor(page),1,1,"再編集");await idle(page);assert.equal((await models(page))[0].rows[1][1],"再編集");
 await load(page);await chooseTableFile(page,{name:"data.tsv",mimeType:"text/tab-separated-values",buffer:Buffer.from("A\tB\n1\t\"x\ty\"")});
 await page.locator("#tablePasteDialog").waitFor({state:"visible"});assert.match(await page.locator("#tablePasteFormat").textContent(),/TSV（タブ区切り）/);
 await cancel(page,"escape");assert.equal((await models(page)).length,0);
 await chooseTableFile(page,{name:"invalid.csv",mimeType:"text/csv",buffer:Buffer.from("\"未終了")});
 await page.waitForFunction(()=>tableFileImportStatus.textContent.includes("閉じられていません"));
 assert.equal(await page.locator("#tablePasteDialog").isVisible(),false);assert.deepEqual(await models(page),[]);
 await chooseTableFile(page,{name:"conflict.csv",mimeType:"text/csv",buffer:Buffer.from("A,B\n1,2")});
 await page.locator("#tablePasteDialog").waitFor({state:"visible"});await page.locator("#editor").fill("競合");
 page.once("dialog",dialog=>dialog.accept());await page.locator("#confirmTablePasteBtn").click();await page.locator("#tablePasteDialog").waitFor({state:"hidden"});
 assert.deepEqual(await models(page),[]);
 console.log("Table file import: CSV/TSV selection, preview, persistence, undo/redo, cancellation and conflicts passed");
}
async function layouts(page) {
 for(const theme of ["light","dark"]) for(const width of [320,375,390,430,1100]){
  await page.setViewportSize({width,height:900});
  await page.waitForFunction(mode=>document.body.dataset.layoutMode===mode,width<600?"mobile":"wide");
  if(width<600 && await page.locator("#contextPanel").getAttribute("aria-hidden")==="false") {
   await page.locator("#closeContextPanelBtn").click();
   await page.waitForFunction(()=>document.getElementById("contextPanel").getAttribute("aria-hidden")==="true");
  }
  await page.evaluate(theme=>{applyTheme(theme);},theme);
  await load(page);await paste(page);
  const metrics=await page.locator("#tablePasteDialog").evaluate(el=>({rect:el.getBoundingClientRect().toJSON(),width:innerWidth,html:document.documentElement.scrollWidth,body:document.body.scrollWidth,client:document.documentElement.clientWidth,scroll:el.scrollWidth,clientWidth:el.clientWidth}));
  assert.ok(metrics.rect.left>=0&&metrics.rect.right<=metrics.width);
  assert.ok(metrics.html<=metrics.client&&metrics.body<=metrics.client);assert.ok(metrics.scroll<=metrics.clientWidth);
  if(width===390||width===1100)await page.screenshot({path:path.join(artifacts,theme+"-"+width+"-dialog.png")});
  await cancel(page);
  if(width===390||width===1100) {
   await load(page);await page.evaluate(()=>prepareTableFileImport());
   await page.locator("#tableFileImportInput").setInputFiles({name:"layout.csv",mimeType:"text/csv",buffer:Buffer.from("項目,値\n確認,1")});
   await page.locator("#tablePasteDialog").waitFor({state:"visible"});
   await page.screenshot({path:path.join(artifacts,"file-"+theme+"-"+width+"-dialog.png")});
   await cancel(page);
  }
  await paste(page,one.repeat(10),"");
  assert.equal(await page.locator(".table-paste-entry").count(),10);
  const scroll=await page.locator(".table-paste-body").evaluate(el=>({scroll:el.scrollHeight,client:el.clientHeight}));
  assert.ok(scroll.scroll>scroll.client,"long list scrolls inside dialog");
  await cancel(page);
 }
 console.log("Mixed paste: five widths and both themes passed");
}
(async()=>{
 fs.mkdirSync(artifacts,{recursive:true});
 const root=__dirname;
 const server=http.createServer((req,res)=>{
  const relative=decodeURIComponent(new URL(req.url,"http://localhost").pathname).replace(/^\/+/,"")||"index.html";
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  fs.readFile(file,(error,data)=>{if(error)return res.writeHead(404).end();res.writeHead(200,{"Content-Type":file.endsWith(".html")?"text/html; charset=utf-8":file.endsWith(".css")?"text/css":"application/javascript"});res.end(data);});
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 let browser;
 try{
  browser=await playwright[browserName].launch({headless:true});
  const context=await browser.newContext({viewport:{width:1100,height:900},hasTouch:true});
  const page=await context.newPage();const errors=[],external=[];
  page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(["error","warning"].includes(m.type()))errors.push(m.text());});
  page.on("request",r=>{if(r.url().includes("paste.invalid"))external.push(r.url());});
  await page.goto("http://127.0.0.1:"+server.address().port,{waitUntil:"domcontentloaded"});
  await page.locator("#appStartupGuard").waitFor({state:"hidden"});await page.locator("#editor").waitFor();
  await verifyTableLifecycle(page);await verify(page);await verifyTableFileImport(page);await layouts(page);
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.body.dataset.layoutMode==="mobile");if(await page.locator("#contextPanel").getAttribute("aria-hidden")==="false")await page.locator("#closeContextPanelBtn").click();await load(page);await paste(page);
  await page.locator("#confirmTablePasteBtn").tap();await idle(page);assert.equal((await models(page)).length,2);
  await page.evaluate(()=>setMobileWritingMode(true));await page.locator('#mobileWritingTools summary[aria-label="追加メニューを開く"]').tap();
  const mobileChooser=page.waitForEvent("filechooser");await page.locator('[data-mobile-editor-tool="importTableFileBtn"]').tap();
  await (await mobileChooser).setFiles({name:"mobile.tsv",mimeType:"text/tab-separated-values",buffer:Buffer.from("項目\t値\nモバイル\t1")});
  await page.locator("#tablePasteDialog").waitFor({state:"visible"});assert.match(await page.locator("#tablePasteFormat").textContent(),/TSV/);await page.locator("#cancelTablePasteBtn").tap();await page.locator("#tablePasteDialog").waitFor({state:"hidden"});
  assert.deepEqual(external,[],"clipboard HTML must not request external resources");
  assert.deepEqual(errors,[],"no page or console errors/warnings");
  console.log("Table block E2E ("+browserName+") passed");
 } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
