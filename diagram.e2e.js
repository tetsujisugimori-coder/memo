"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const playwright = require("playwright");
async function idle(page) {
  await page.waitForFunction(() => !noteSaveFoundation.isDirty(currentId) && saveTimer === null && window.MemoNexusTypingDerivedUiScheduler.pendingRequestType() === null);
}
async function saved(page) {
  await page.evaluate(() => flushSave());
  await idle(page);
  return page.evaluate(async () => ({ body: editor.value, stored: (await getStoredNotes()).find((note) => note.id === currentId).body,
    geometries: splitGeometryBlocks(editor.value).filter((entry) => entry.type === "geometry").map((entry) => entry.geometry),
    revision: currentNote().revision, updatedAt: currentNote().updatedAt, undo: undoStack.length, redo: redoStack.length,
    figures: splitImageBlocks(editor.value).filter((entry) => entry.type === "image"), sources: parseSourceDocument(editor.value).sources }));
}
async function persistenceState(page) {
  return page.evaluate(() => ({ body: editor.value, revision: currentNote().revision, updatedAt: currentNote().updatedAt,
    dirty: noteSaveFoundation.isDirty(currentId), saveScheduled: saveTimer !== null,
    undo: undoStack.length, redo: redoStack.length }));
}
async function alignSvgForPointer(svg) {
  return svg.evaluate(async (element) => {
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (!/(auto|scroll)/.test(style.overflowY) || ancestor.scrollHeight <= ancestor.clientHeight) continue;
      const elementRect = element.getBoundingClientRect();
      const ancestorRect = ancestor.getBoundingClientRect();
      ancestor.scrollTop += elementRect.top - ancestorRect.top - (ancestor.clientHeight - elementRect.height) / 2;
    }
    const viewportRect = element.getBoundingClientRect();
    if (viewportRect.bottom > window.innerHeight) window.scrollBy(0, viewportRect.bottom - window.innerHeight + 1);
    if (viewportRect.top < 0) window.scrollBy(0, viewportRect.top - 1);
    const snapshot = () => {
      const rect = element.getBoundingClientRect();
      const matrix = element.getScreenCTM();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f };
    };
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const before = snapshot();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const after = snapshot();
    return { before, after };
  });
}

function assertSvgAlignment(actual, expected, message) {
  for (const key of ["x", "y", "width", "height", "a", "b", "c", "d", "e", "f"]) assert.ok(Math.abs(actual[key] - expected[key]) < .01, `${message}: ${key}`);
}

async function logicalClientPosition(svg, point) {
  return svg.evaluate((element, logicalPoint) => {
    const matrix = element.getScreenCTM();
    const screen = new DOMPoint(logicalPoint.x, logicalPoint.y).matrixTransform(matrix);
    const x = Math.round(screen.x);
    const y = Math.round(screen.y);
    const top = document.elementFromPoint(x, y);
    const target = top?.closest("[data-geometry-kind]");
    const rect = element.getBoundingClientRect();
    return { x, y, matrix: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, top: { tag: top?.tagName, className: top?.getAttribute("class"), kind: target?.dataset?.geometryKind, id: target?.dataset?.geometryId } };
  }, point);
}

async function clickLogical(page, svg, point) {
  const alignment=await alignSvgForPointer(svg);
  assertSvgAlignment(alignment.before,alignment.after,"SVGの座標が操作前に安定している");
  const client=await logicalClientPosition(svg,point);
  assert.ok(client.y >= 0 && client.y < page.viewportSize().height);
  await page.mouse.click(client.x,client.y);
}
async function info(page,index=0) {
  await idle(page);
  await page.locator(".geometry-diagram-info").nth(index).click();
  await page.locator("#diagramDialog").waitFor({state:"visible"});
}
async function saveInfo(page) {
  await page.locator('#diagramForm button[type="submit"]').click();
  await page.locator("#diagramDialog").waitFor({state:"hidden"});
  return saved(page);
}
async function download(page, action) {
  const pending=page.waitForEvent("download");await action();const result=await pending;
  assert.equal(await result.failure(),null);return fs.readFileSync(await result.path());
}
async function layout(page) {
  await page.waitForFunction(()=>{const r=document.querySelector("#previewCard").getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1;});
  const value=await page.locator(".geometry-preview").first().evaluate(el=>{
    const preview=document.querySelector("#preview"), svg=el.querySelector("svg"), r=svg.getBoundingClientRect();
    return {doc:document.documentElement.scrollWidth<=innerWidth+1,preview:preview.scrollWidth<=preview.clientWidth+1,
      figure:el.scrollWidth<=el.clientWidth+1,width:r.width,height:r.height,scaleX:svg.getScreenCTM().a,scaleY:svg.getScreenCTM().d,
      selected:el.querySelectorAll(".is-selected").length};
  });
  assert.ok(value.doc && value.preview && value.figure,JSON.stringify(value));
  assert.ok(value.width>150&&value.height>100);assert.equal(value.selected,0);
  assert.ok(Math.abs(value.scaleX-value.scaleY)<1e-6,"図形の縦横比を維持する");
}

(async () => {
  const root = __dirname;
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
    const engine = process.env.MEMO_NEXUS_E2E_BROWSER || "chromium";
    browser = await playwright[engine].launch({ headless: true });
    const url = "http://127.0.0.1:" + server.address().port;
    const errors = [];
    const open = async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
      return page;
    };
    const page=await open();
    await page.locator("#titleInput").fill("Diagram v1 検証用レポート");
    await page.locator("#editor").fill("検証用の模式図。以下の資料は架空のテストデータです。");
    await idle(page);
    // Use the existing Source UI; the labels explicitly distinguish test data.
    for(const name of ["検証データA（実在資料ではありません）","検証データB（実在資料ではありません）"]){
      await page.locator("#manageSourcesBtn").click();
      await page.locator('#sourceForm [name="title"]').fill(name);
      await page.locator('#sourceForm [name="url"]').fill("https://example.org/diagram-test/"+"long".repeat(35));
      await page.locator('#sourceForm button[type="submit"]').first().click();
      await page.locator("#closeSourceDialogBtn").click();await idle(page);
    }
    let sourceLabels;
    for (const [field, value] of [["author", "検証著者（タイトル空）"],
      ["url", "https://example.org/source-label-test"], ["publisher", "検証出版社（表示はIDへfallback）"]]) {
      await page.locator("#manageSourcesBtn").click();
      await page.locator('#sourceForm [name="' + field + '"]').fill(value);
      await page.locator('#sourceForm button[type="submit"]').first().click();
      sourceLabels = await page.locator(".source-list-item > span").allInnerTexts();
      await page.locator("#closeSourceDialogBtn").click();
      await idle(page);
    }
    await page.locator("#manageSourcesBtn").click();
    await page.locator('#sourceForm [name="title"]').fill("  　 ");
    await page.locator('#sourceForm [name="author"]').fill("検証著者（タイトルは空白のみ）");
    await page.locator('#sourceForm button[type="submit"]').first().click();
    sourceLabels = await page.locator(".source-list-item > span").allInnerTexts();
    assert.equal(sourceLabels[5], "検証著者（タイトルは空白のみ）");
    await page.locator("#closeSourceDialogBtn").click();
    await idle(page);
    await page.locator("#editor").press("End");
    await page.locator("#insertGeometryBtn").click();
    const drawing=page.locator(".geometry-block-editor");
    const svg=drawing.locator("svg");
    await drawing.locator('[data-geometry-mode="point"]').click();
    for(const point of [{x:20,y:75},{x:50,y:20},{x:80,y:75}])await clickLogical(page,svg,point);
    let state=await saved(page);
    assert.equal(state.geometries[0].points.length,3);
    assert.equal(state.geometries[0].diagram,undefined);
    await drawing.locator('[data-geometry-mode="polygon"]').click();
    for(const point of state.geometries[0].points)await clickLogical(page,svg,point);
    await drawing.getByRole("button",{name:"選択した点で多角形を完了"}).click();
    let legacy=await saved(page);
    // Preserve valid legacy marker formatting, not just canonical JSON, on a no-op.
    const formattedLegacy = await page.evaluate(() => {
      const block = splitGeometryBlocks(editor.value).find(entry => entry.type === "geometry");
      const raw = "  " + block.raw.replace(/:([0-9a-f]+) -->$/, (_, hex) => ":" + hex.toUpperCase() + " -->");
      return editor.value.slice(0, block.start) + raw + editor.value.slice(block.end);
    });
    await page.locator("#editor").fill(formattedLegacy);
    legacy=await saved(page);
    assert.equal(legacy.geometries[0].objects.length,1);
    const noOpBefore = await persistenceState(page);
    await info(page);
    assert.deepEqual(await page.locator("#diagramSourceOptions label").allInnerTexts(), sourceLabels);
    assert.equal(sourceLabels[2], "検証著者（タイトル空）");
    assert.equal(sourceLabels[3], "https://example.org/source-label-test");
    assert.equal(sourceLabels[4], legacy.sources[4].id);
    assert.equal(sourceLabels[5], "検証著者（タイトルは空白のみ）");
    assert.equal(legacy.sources[5].title, "  　 ", "表示fallbackでも保存した空白titleを保持する");
    assert.equal(legacy.sources[5].author, "検証著者（タイトルは空白のみ）");
    await page.locator('#diagramForm button[type="submit"]').click();
    await page.locator("#diagramDialog").waitFor({state:"hidden"});
    assert.deepEqual(await persistenceState(page), noOpBefore, "empty save creates no draft, revision, timestamp, save reservation or history");
    assert.deepEqual(await saved(page), legacy, "no-op also keeps the original raw marker");
    await info(page);
    assert.equal(await page.locator("#diagramCreatedInput").isChecked(),false);
    await page.locator("#diagramCaptionInput").fill("キャンセルする説明");
    await page.locator("#diagramCreatedInput").check();
    await page.locator("#cancelDiagramBtn").click();
    assert.deepEqual(await saved(page),legacy,"cancel preserves saved data, revision and history");
    await info(page);
    await page.locator("#diagramCaptionInput").fill("旧Geometryのcaptionだけ変更");
    const captionOnly = await saveInfo(page);
    assert.deepEqual(captionOnly.geometries[0], { ...legacy.geometries[0], caption: "旧Geometryのcaptionだけ変更" });
    assert.equal(captionOnly.geometries[0].version, 1);
    assert.equal(captionOnly.geometries[0].diagram, undefined);
    await page.locator("#undoBtn").click();assert.equal((await saved(page)).body, legacy.body);
    await page.locator("#redoBtn").click();assert.equal((await saved(page)).body, captionOnly.body);
    legacy = captionOnly;
    const caption="三角形ABCの辺を比較する模式図";
    const description="三角形の形と頂点の位置関係を示す。長さは実測値ではなく、比較のために模式化した。\n"+"長文の補足説明".repeat(15)+" <script> & 😀";
    await info(page);
    await page.locator("#diagramCaptionInput").fill(caption);
    await page.locator("#diagramDescriptionInput").fill(description);
    await page.locator("#diagramCreatedInput").check();
    for(const choice of (await page.locator('#diagramSourceOptions input').all()).slice(0,2))await choice.check();
    const described=await saveInfo(page);
    assert.equal(described.geometries[0].version,2);
    assert.deepEqual(described.geometries[0].points,legacy.geometries[0].points);
    assert.deepEqual(described.geometries[0].objects,legacy.geometries[0].objects);
    assert.equal(described.geometries[0].diagram.citationIds.length,2);
    assert.equal(described.body,described.stored);
    await page.locator("#undoBtn").click();assert.equal((await saved(page)).body,legacy.body);
    await page.locator("#redoBtn").click();assert.equal((await saved(page)).body,described.body);
    await page.reload();await page.locator("#appStartupGuard").waitFor({state:"hidden"});
    assert.equal((await saved(page)).body,described.body);
    // Clearing all Diagram-specific fields explicitly restores a legacy v1 Geometry.
    await info(page);
    await page.locator("#diagramDescriptionInput").fill("");
    await page.locator("#diagramCreatedInput").uncheck();
    for (const choice of await page.locator("#diagramSourceOptions input").all()) await choice.uncheck();
    const cleared = await saveInfo(page);
    assert.deepEqual(cleared.geometries[0], { ...legacy.geometries[0], caption });
    assert.equal(cleared.geometries[0].version, 1);
    assert.equal(cleared.geometries[0].diagram, undefined);
    await page.locator("#undoBtn").click();assert.equal((await saved(page)).body, described.body);
    await page.locator("#redoBtn").click();assert.equal((await saved(page)).body, cleared.body);
    await page.reload();await page.locator("#appStartupGuard").waitFor({state:"hidden"});
    assert.equal((await saved(page)).body, cleared.body);
    await info(page);
    await page.locator("#diagramDescriptionInput").fill(description);
    await page.locator("#diagramCreatedInput").check();
    for(const choice of (await page.locator('#diagramSourceOptions input').all()).slice(0,2))await choice.check();
    assert.equal((await saveInfo(page)).body, described.body);
    // Redrawing through the original model must preserve metadata, including internal history.
    await drawing.locator('[data-geometry-mode="point"]').click();await clickLogical(page,svg,{x:90,y:20});
    const redrawn=await saved(page);assert.equal(redrawn.geometries[0].points.length,4);
    assert.deepEqual(redrawn.geometries[0].diagram,described.geometries[0].diagram);
    await drawing.getByRole("button",{name:"図形操作を元に戻す",exact:true}).click();
    assert.equal((await saved(page)).body,described.body);
    await drawing.getByRole("button",{name:"図形操作をやり直す",exact:true}).click();
    assert.equal((await saved(page)).body,redrawn.body);
    // A fully identical copy, Source before the diagram and stripped explanation anchors.
    const copies=await page.evaluate(state=>{
      const raw=splitGeometryBlocks(state.body).find(e=>e.type==="geometry").raw;
      return withSources("",state.sources)+"\n"+buildExplanationAnchorComment("diagram-anchor")+"\n"+raw+"\n"+raw+"\n"+raw;
    },described);
    await page.locator("#editor").fill(copies);const duplicated=await saved(page);
    for(const [index,title] of [[1,"2番目だけ変更"],[0,"1番目だけ変更"],[2,"3番目だけ変更"]]){
      await info(page,index);await page.locator("#diagramCaptionInput").fill(title);state=await saveInfo(page);
      assert.equal(state.geometries[index].caption,title);
    }
    assert.deepEqual(state.geometries.map(g=>g.caption),["1番目だけ変更","2番目だけ変更","3番目だけ変更"]);
    await page.locator("#undoBtn").click();assert.equal((await saved(page)).geometries[2].caption,caption);
    await page.locator("#redoBtn").click();assert.equal((await saved(page)).body,state.body);
    await page.reload();await page.locator("#appStartupGuard").waitFor({state:"hidden"});
    await info(page,1);await page.locator("#diagramCaptionInput").fill("reload後の2番目");const afterReload=await saveInfo(page);
    assert.deepEqual(afterReload.geometries[0],state.geometries[0]);assert.deepEqual(afterReload.geometries[2],state.geometries[2]);
    page.once("dialog",d=>d.accept());await page.locator(".geometry-block-remove").nth(1).click();
    state=await saved(page);assert.deepEqual(state.geometries,[afterReload.geometries[0],afterReload.geometries[2]]);
    await page.locator("#editor").fill(described.body);await saved(page);
    // A Diagram-only reference must independently protect a Source from deletion.
    await page.locator("#manageSourcesBtn").click();
    await page.locator(".source-list-item").first().getByRole("button",{name:"削除",exact:true}).click();
    await page.locator("#sourceStatus").getByText(/参照されています/).waitFor();
    await page.locator(".source-list-item").first().getByRole("button",{name:"編集",exact:true}).click();
    await page.locator('#sourceForm [name="title"]').fill("更新した検証データA（実在資料ではありません）");
    await page.locator('#sourceForm button[type="submit"]').first().click();
    await page.locator("#closeSourceDialogBtn").click();await idle(page);
    assert.match(await page.locator(".report-sources").innerText(),/更新した検証データA/);
    assert.deepEqual((await saved(page)).geometries[0],described.geometries[0]);
    // Body, Timeline, description and explicit selections all use the same common Source IDs.
    await page.evaluate(()=>{
      const sources=parseSourceDocument(editor.value).sources, ids=sources.map(s=>s.id);
      const block=splitGeometryBlocks(editor.value).find(e=>e.type==="geometry");
      const geometry={...block.geometry,diagram:{...block.geometry.diagram,description:block.geometry.diagram.description+"\n参考 [@"+ids[1]+"] "+String.fromCharCode(96)+"[@hidden]"+String.fromCharCode(96)}};
      const raw=window.MemoNexusGeometryBlockUtils.serializeGeometryBlock(geometry);
      const timeline=serializeTimelineBlock({id:"timeline-test",title:"検証の順序",items:[{id:"item",dateLabel:"作図後",title:"図の説明を確認",body:"参考 [@"+ids[0]+"]",citationIds:[ids[1]]}]});
      commitSourceBody(withSources("検証用の模式図。資料は実在しないテストデータ。参考 [@"+ids[0]+"]\n"+raw+"\n"+timeline,sources));
    });
    await idle(page);state=await saved(page);
    assert.deepEqual(await page.locator(".diagram-citations .citation-link").allInnerTexts(),["[1]","[2]"]);
    assert.deepEqual(await page.locator(".diagram-description .citation-link").allInnerTexts(),["[2]"]);
    assert.deepEqual(await page.locator(".timeline-citations .citation-link").allInnerTexts(),["[2]"]);
    assert.equal(await page.locator(".report-sources li").count(),2);
    assert.equal(await page.locator("#preview script").count(),0);
    assert.match(await page.locator(".geometry-preview svg").getAttribute("aria-label"),/模式図/);
    await layout(page);
    await page.locator("#reportPreviewBtn").click();await page.locator("body.report-preview-mode").waitFor();
    assert.equal(await page.locator(".geometry-block-editors").isVisible(),false);
    assert.equal(await page.locator(".timeline-edit").isVisible(),false);
    const review=path.join(root,"e2e-artifacts/diagram-review");fs.mkdirSync(review,{recursive:true});
    await page.setViewportSize({width:1280,height:1600});await layout(page);
    await page.screenshot({path:path.join(review,"diagram-report-pc.png")});
    await page.setViewportSize({width:320,height:844});await page.waitForFunction(()=>layoutMode==="mobile");await layout(page);
    await page.setViewportSize({width:320,height:2400});await layout(page);
    await page.screenshot({path:path.join(review,"diagram-report-320.png")});
    assert.deepEqual(await saved(page),state,"reading changes no stored body, timestamps or history");
    await page.setViewportSize({width:320,height:844});await page.keyboard.press("Escape");
    await page.waitForFunction(()=>!document.body.classList.contains("report-preview-mode"));
    if(await page.locator("#contextPanel").getAttribute("aria-hidden")==="false")await page.locator("#closeContextPanelBtn").click();
    await page.locator("#cardPaneBtn").click();await page.waitForFunction(()=>mobileCardOpen);await layout(page);
    await page.screenshot({path:path.join(review,"diagram-preview-320.png")});
    await page.locator("#closeCardPaneBtn").click();await page.waitForFunction(()=>!mobileCardOpen);
    await info(page);assert.equal(await page.locator("#diagramDialog").evaluate(d=>d.scrollWidth<=d.clientWidth+1&&d.getBoundingClientRect().width<=innerWidth),true);
    await page.locator("#diagramDescriptionInput").fill("モバイルで補足を編集 "+description);
    state=await saveInfo(page);assert.match(state.geometries[0].diagram.description,/モバイル/);
    await page.setViewportSize({width:1280,height:900});await page.waitForFunction(()=>layoutMode==="wide");
    // No attachments: the existing note exporter downloads local Markdown.
    const localMarkdown=await download(page,async()=>{await page.locator("#noteExportBtn").click();await page.locator("#downloadExportBtn").click();});
    assert.deepEqual(await page.evaluate(text=>splitGeometryBlocks(parseLocalNote(text).body).filter(e=>e.type==="geometry").map(e=>e.geometry),localMarkdown.toString("utf8")),state.geometries);
    // An attachment selects the existing Markdown ZIP path; do not change export architecture.
    await page.locator("#insertImageBlockBtn").click();
    await page.locator("#imageBlockInput").setInputFiles({name:"zip-test.png",mimeType:"image/png",buffer:fs.readFileSync(path.join(root,"e2e-artifacts/chart-png-example-light-390.png"))});
    await page.locator(".image-block img").waitFor();state=await saved(page);
    const noteId=await page.evaluate(()=>currentId);
    const markdown=await download(page,async()=>{await page.locator("#noteExportBtn").click();await page.locator("#downloadExportBtn").click();});
    const backup=await download(page,()=>page.locator("#backupBtn").click());
    for(const [name,buffer] of [["markdown",markdown],["backup",backup]]){
      const restored=await open();
      await restored.locator("#importMarkdownZipInput").setInputFiles({name:name+".zip",mimeType:"application/zip",buffer});
      if(name==="backup"){
        await restored.locator("#backupPreviewDialog").waitFor({state:"visible"});await restored.locator("#confirmBackupPreviewBtn").click();
        await restored.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();await restored.locator("#cancelBackupPreviewBtn").click();
        await restored.evaluate(id=>openNote(id),noteId);
      }
      await restored.locator(".geometry-preview").waitFor();let result=await saved(restored);
      assert.deepEqual(result.geometries,state.geometries);assert.deepEqual(result.sources,state.sources);
      assert.equal(await restored.locator(".report-sources li").count(),2);await layout(restored);
      await restored.reload();await restored.locator("#appStartupGuard").waitFor({state:"hidden"});
      assert.deepEqual((await saved(restored)).geometries,state.geometries);await restored.close();
    }
    // Missing IDs stay visible and selected; reopening and saving must not reconnect or erase them.
    await page.evaluate(()=>{
      const block=splitGeometryBlocks(editor.value).find(e=>e.type==="geometry");
      commitSourceBody(replaceGeometryBlock(editor.value,block,{...block.geometry,diagram:{...block.geometry.diagram,citationIds:["unregistered-test",...block.geometry.diagram.citationIds]}}));
    });await idle(page);
    assert.ok((await page.locator(".diagram-citations").innerText()).includes("[@unregistered-test]"));
    await info(page);assert.equal(await page.locator('#diagramSourceOptions input[value="unregistered-test"]').isChecked(),true);
    assert.equal(await page.locator('#diagramSourceOptions input[value="unregistered-test"]').locator("..").innerText(), "未登録Source: unregistered-test");
    await saveInfo(page);assert.equal((await saved(page)).geometries[0].diagram.citationIds.includes("unregistered-test"),true);
    await info(page);
    await page.evaluate(()=>commitSourceBody(editor.value+"\n外部の更新"));
    const external=await saved(page);
    await page.locator('#diagramForm button[type="submit"]').click();
    await page.locator("#diagramStatus").getByText(/メモが更新されました/).waitFor();
    await page.locator("#cancelDiagramBtn").click();
    assert.deepEqual(await saved(page),external,"stale dialogs cannot overwrite external changes");
    assert.deepEqual(errors,[]);
    console.log("Diagram E2E passed: drawing, cancel, save, shared citations, independent copies, undo/redo, reload, actual ZIP downloads/restores, PC/320px");
  } finally {
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
