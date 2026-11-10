"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const playwright = require("playwright");
const { commands } = require("./feature-palette.js");
const { clickPaletteControl: clickControl, openFeaturePalette } = require("./feature-palette.e2e-support.js");
const clickPaletteControl = (page, id) => clickControl(page, id, { keepOpen: true });
const engine = process.env.MEMO_NEXUS_E2E_BROWSER || "chromium";
const output = path.resolve(process.env.MEMO_PALETTE_OUTPUT || `e2e-artifacts/feature-palette/${engine}`);
fs.mkdirSync(output, { recursive: true });
async function serve() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(__dirname, pathname === "/" ? "index.html" : pathname.slice(1));
    if (!file.startsWith(__dirname + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, body) => {
      if (error) return res.writeHead(404).end();
      res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".png") ? "image/png" : "text/html");
      res.end(body);
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return server;
}
async function prepare(page, url) {
  await page.context().route("https://cdn.jsdelivr.net/**", route => route.fulfill({
    contentType: route.request().url().endsWith(".css") ? "text/css" : "application/javascript", body: ""
  }));
  await page.goto(url);
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
  await page.evaluate(() => setContextPanelOpen(false, { restoreFocus: false }));
}
async function snapshot(page) {
  return page.evaluate(() => ({ body: editor.value, start: editor.selectionStart, end: editor.selectionEnd,
    scroll: editor.scrollTop, updatedAt: currentNote().updatedAt, dirty: noteSaveFoundation.isDirty(currentId),
    rect: { width: editor.getBoundingClientRect().width, height: editor.getBoundingClientRect().height } }));
}
async function bounds(page) {
  await page.waitForFunction(() => {
    const r = document.getElementById("featurePalette").getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
  });
  const r = await page.locator("#featurePalette").boundingBox();
  const v = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(r && r.x >= 0 && r.y >= 0 && r.x + r.width <= v.width + 1 && r.y + r.height <= v.height + 1, JSON.stringify({r,v}));
}
async function setText(page, value, start = 0, end = start) {
  await page.locator("#editor").fill(value);
  await page.evaluate(async ({start,end}) => { await saveCurrentNote(); editor.setSelectionRange(start,end); }, {start,end});
}
(async () => {
  const server = await serve();
  const browser = await playwright[engine].launch({ headless: true });
  const failures = [], results = [], profiles = [];
  let desktopContext;
  try {
    const options = { viewport: {width:1280,height:800}, reducedMotion: "reduce" };
    if (engine === "webkit") {
      // Match report-source.e2e.js: WebKit ephemeral contexts cannot store IDB Blobs.
      // A fresh ordinary profile exercises the real attachment path without storage mocks.
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), "memo-palette-webkit-"));
      profiles.push(profile);
      desktopContext = await playwright.webkit.launchPersistentContext(profile, { ...options, headless: true });
    } else desktopContext = await browser.newContext(options);
    const context = desktopContext;
    const page = await context.newPage();
    page.on("pageerror", e => failures.push(e.message));
    const url = `http://127.0.0.1:${server.address().port}/`;
    await prepare(page, url);
    assert.equal(await page.locator("#featurePalette").isVisible(), false);
    await setText(page, "alpha beta gamma", 6, 10);
    const before = await snapshot(page);
    await page.locator("#featurePaletteToggle").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#featurePaletteToggle").getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator("[data-palette-close]").evaluate(e => e === document.activeElement), true);
    await page.keyboard.press("Tab");
    assert.equal(await page.locator("#focusNoteTagBtn").evaluate(e => e === document.activeElement), true);
    assert.deepEqual(await snapshot(page), before, "open and tab do not modify content, selection, dirty, timestamps, or editor layout");
    for (const command of commands) {
      const button = page.locator(`#${command.controlId}`);
      assert.equal(await button.count(), 1);
      assert.equal(await button.isVisible(), true);
      assert.ok(await button.getAttribute("aria-label"));
      assert.equal(await button.getAttribute("data-command-id"), command.id);
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#featurePaletteToggle").evaluate(e => e === document.activeElement), true);
    assert.deepEqual(await snapshot(page), before);
    await page.keyboard.press("Space");
    await page.locator("[data-palette-close]").click();
    assert.equal(await page.locator("#featurePaletteToggle").getAttribute("aria-expanded"), "false");
    await openFeaturePalette(page);
    const header = await page.locator("[data-palette-drag]").boundingBox();
    const original = await page.locator("#featurePalette").boundingBox();
    await page.mouse.move(header.x + 25, header.y + 20); await page.mouse.down();
    await page.mouse.move(20,20,{steps:4}); await page.mouse.up();
    const moved = await page.locator("#featurePalette").boundingBox();
    assert.notEqual(moved.x, original.x); await bounds(page);
    await page.locator("[data-palette-drag]").focus();
    for(let i=0;i<80;i++)await page.keyboard.press("ArrowRight");
    await bounds(page);
    await page.keyboard.press("Home");
    await page.locator("#titleInput").click();
    assert.equal(await page.locator("#featurePalette").isVisible(), false);
    assert.equal(await page.locator("#titleInput").evaluate(e=>document.activeElement===e), true);
    await clickPaletteControl(page, "toggleHighlightBtn");
    assert.equal(await page.locator("#editor").inputValue(), "alpha ==beta== gamma");
    assert.equal(await page.locator("#featurePalette").isVisible(), true, "ordinary formatting keeps palette open");
    await clickPaletteControl(page, "toggleHighlightBtn");
    assert.equal(await page.locator("#editor").inputValue(), "alpha beta gamma");
    await page.locator("#calloutTypeSelect").selectOption("WARNING");
    await page.waitForFunction(() => Date.now() - lastUndoSnapshotAt >= UNDO_INPUT_INTERVAL_MS);
    await clickPaletteControl(page, "insertCalloutBtn");
    assert.match(await page.locator("#editor").inputValue(), /\[!WARNING\]/);
    await page.locator("#undoBtn").click();
    assert.equal(await page.locator("#editor").inputValue(), "alpha beta gamma");
    await page.locator("#redoBtn").click();
    assert.match(await page.locator("#editor").inputValue(), /\[!WARNING\]/);
    await setText(page, "ABCDEF", 3);
    await clickPaletteControl(page, "insertTableBtn");
    assert.match(await page.locator("#editor").inputValue(), /^ABC[\s\S]+DEF$/);
    await setText(page, "ABCDEF", 3);
    await clickPaletteControl(page, "insertChartBtn");
    assert.match(await page.locator("#editor").inputValue(), /^ABC[\s\S]+DEF$/);
    await setText(page, "ABCDEF", 3);
    await clickPaletteControl(page, "insertGeometryBtn");
    assert.match(await page.locator("#editor").inputValue(), /^ABC[\s\S]+DEF$/);
    await setText(page, "alpha beta gamma", 6, 10);
    const chooser = page.waitForEvent("filechooser");
    await clickPaletteControl(page, "importTableFileBtn");
    const fileChooser = await chooser;
    await fileChooser.setFiles({ name:"palette.csv", mimeType:"text/csv", buffer:Buffer.from("a,b\n1,2") });
    await page.locator("#tablePasteDialog").waitFor({state:"visible"});
    assert.equal(await page.locator("#featurePalette").isVisible(), true);
    await page.keyboard.press("Escape");
    await page.locator("#tablePasteDialog").waitFor({state:"hidden"});
    assert.equal(await page.locator("#featurePalette").isVisible(), true, "dialog Escape does not close palette");
    assert.equal(await page.locator("#editor").inputValue(), "alpha beta gamma");
    await clickPaletteControl(page, "addExplanationBtn");
    await page.locator("#explanationDialog").waitFor({state:"visible"});
    assert.match(await page.locator("#explanationTarget").innerText(), /beta/);
    await page.locator("#cancelExplanationBtn").click();
    await clickPaletteControl(page, "syntaxGuideBtn");
    await page.locator("#syntaxGuideDialog").waitFor({state:"visible"});
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#featurePalette").isVisible(), true);
    await context.route("https://tetsujisugimori-coder.github.io/calculator-memo/**", route => route.fulfill({ contentType: "text/html", body: "Calculator route fixture" }));
    await setText(page, "1 + 2", 0, 5);
    const calculatorPopup = page.waitForEvent("popup");
    await clickPaletteControl(page, "calculatorLinkBtn");
    const calculator = await calculatorPopup;
    await calculator.waitForURL(url => url.searchParams.get("expr") === "1 + 2");
    assert.equal(new URL(calculator.url()).pathname, "/calculator-memo/");
    await calculator.close();
    await clickPaletteControl(page, "aiSummarizeNoteBtn");
    assert.equal(await page.locator("#aiTargetSelect").inputValue(), "current-note");
    assert.equal(await page.locator("#aiPurposeSelect").inputValue(), "summarize");
    await page.locator("#closeAiPanelBtn").click();
    await setText(page, "alpha beta gamma", 6, 10);
    await clickPaletteControl(page, "manageSourcesBtn");
    await page.locator("#sourceDialog").waitFor({state:"visible"});
    await page.locator('#sourceForm [name="title"]').fill("Palette source fixture");
    await page.locator('#sourceForm [name="url"]').fill("https://example.org/palette-fixture");
    await page.locator('#sourceForm button[type="submit"]').first().click();
    await page.locator("#sourceList").getByText("引用を挿入").click();
    await page.locator("#sourceDialog").waitFor({state:"hidden"});
    const sourceBefore = await page.evaluate(() => parseSourceDocument(editor.value).sources);
    assert.equal(sourceBefore.length, 1);
    // No pointerdown: a dialog changed body and cursor while the palette stayed open.
    const sourceImageChooser = page.waitForEvent("filechooser");
    await page.locator("#insertImageBlockBtn").focus();
    await page.keyboard.press("Enter");
    const sourcePicker = await sourceImageChooser;
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 20; canvas.height = 20;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#336699"; ctx.fillRect(0,0,20,20);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await sourcePicker.setFiles({name:"palette-source.png",mimeType:"image/png",buffer:Buffer.from(png,"base64")});
    try { await page.locator("#preview .image-block").waitFor(); }
    catch (error) {
      console.error("source-image diagnostic", await page.evaluate(() => ({ body: editor.value, target: pendingImageInsertTarget, attachments: currentAttachments.map(a=>a.fileName), status: attachmentStatus.textContent, active: document.activeElement?.id, selection:[editor.selectionStart,editor.selectionEnd] })));
      throw error;
    }
    assert.deepEqual(await page.evaluate(() => parseSourceDocument(editor.value).sources), sourceBefore, "keyboard image insertion preserves the source marker updated by the dialog");
    await setText(page, "alpha beta gamma", 6, 10);
    await clickPaletteControl(page, "insertTimelineBtn");
    await page.locator("#timelineDialog").waitFor({state:"visible"});
    await page.keyboard.press("Escape");
    const imageChooser = page.waitForEvent("filechooser");
    await clickPaletteControl(page,"insertImageBlockBtn"); await imageChooser;
    await page.locator("#imageBlockInput").evaluate(e=>e.dispatchEvent(new Event("cancel")));
    await clickPaletteControl(page, "aiSendSelectionBtn");
    assert.equal(await page.locator("#featurePalette").isVisible(), false);
    assert.equal(await page.locator("#aiTargetSelect").inputValue(), "selected-text");
    await page.locator("#closeAiPanelBtn").click();
    await clickPaletteControl(page,"focusNoteTagBtn");
    assert.equal(await page.locator("#noteTagInput").evaluate(e=>document.activeElement===e),true);
    await page.locator("#titleInput").fill("Palette saved title");
    await setText(page,"Palette saved body",2,5);
    await page.waitForFunction(()=>!noteSaveFoundation.isDirty(currentId));
    const savedId = await page.evaluate(() => currentId);
    await openFeaturePalette(page);
    await page.locator("#newBtn").click();
    await page.waitForFunction(id => currentId !== id && editor.value === "", savedId);
    assert.equal(await page.locator("#featurePalette").isVisible(),false);
    await page.evaluate(id=>openNote(id),savedId);
    assert.equal(await page.locator("#editor").inputValue(),"Palette saved body");
    await page.reload();await page.locator("#appStartupGuard").waitFor({state:"hidden"});
    assert.equal(await page.locator("#editor").inputValue(),"Palette saved body");
    assert.equal(await page.locator("#featurePalette").isVisible(),false);
    for (const theme of ["light","dark"]) {
      await page.evaluate(theme=>applyTheme(theme),theme);
      await openFeaturePalette(page);
      assert.match(await page.locator("#featurePaletteToggle").evaluate(e=>getComputedStyle(e).backgroundImage), /linear-gradient.*linear-gradient/);
      await page.screenshot({path:path.join(output,`desktop-${theme}.png`)});
      await page.keyboard.press("Escape");
    }
    const popupPromise=page.waitForEvent("popup");await page.locator("#popoutMemoBtn").click();
    const popup=await popupPromise;await popup.locator("#appStartupGuard").waitFor({state:"hidden"});
    await openFeaturePalette(popup);
    assert.equal(await popup.locator("#aiSummarizeNoteBtn").isVisible(),false);
    assert.equal(await popup.locator("#aiSendSelectionBtn").isVisible(),false);
    assert.equal(await popup.locator("#insertTableBtn").isVisible(),true);
    await popup.close();await context.close();desktopContext = null;
    for (const width of [320,375,390,430]) {
      const mobile=await browser.newContext({viewport:{width,height:800},isMobile:true,hasTouch:true,reducedMotion:"reduce"});
      const p=await mobile.newPage();p.on("pageerror",e=>failures.push(e.message));await prepare(p,url);
      const rect=await p.locator("#editor").boundingBox();
      await p.locator("#featurePaletteToggle").tap();await bounds(p);
      assert.deepEqual(await p.locator("#editor").boundingBox(),rect);
      // The lowest row must be tappable above the fixed related-note and AI triggers.
      await p.locator("#aiSummarizeNoteBtn").tap();
      assert.equal(await p.locator("#aiTargetSelect").inputValue(), "current-note");
      await p.locator("#closeAiPanelBtn").tap();
      await p.locator("#closeContextPanelBtn").tap();
      await p.locator("#featurePaletteToggle").tap();
      // A normal-mode command itself can enter writing mode without resizing the viewport.
      await p.locator("#insertCalloutBtn").tap();
      await p.locator("body.mobile-writing-mode").waitFor();
      const tray = await p.locator("#mobileWritingTools").boundingBox();
      const palette = await p.locator("#featurePalette").boundingBox();
      assert.ok(palette.y + palette.height <= tray.y, "palette moves above newly visible writing tray");
      await p.locator("[data-palette-close]").tap();
      await p.locator("#editor").tap();await p.locator("body.mobile-writing-mode").waitFor();
      await setText(p,"mobile select body",7,13);
      await p.locator("#mobileFeaturePaletteToggle").tap();
      await p.locator("#toggleHighlightBtn").tap();
      assert.equal(await p.locator("#editor").inputValue(),"mobile ==select== body");
      await bounds(p);
      await p.screenshot({path:path.join(output,`mobile-${width}.png`)});
      await p.setViewportSize({width,height:320});await bounds(p);
      await p.locator("[data-palette-close]").tap();await p.locator("#editor").tap();await p.keyboard.type("続きを入力");
      assert.match(await p.locator("#editor").inputValue(),/続きを入力/);
      await p.setViewportSize({width:667,height:375});await openFeaturePalette(p);await bounds(p);
      await p.locator("[data-palette-close]").tap();await p.locator("#mobileWritingDoneBtn").tap();
      assert.equal(await p.locator("#featurePalette").isVisible(),false);
      assert.equal(await p.locator(".note-meta-bar").isVisible(),true);
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
      results.push({width,normalEditor:rect,portrait:true,shortViewport:true,landscape:true,touch:true});
      await mobile.close();
    }
    assert.deepEqual(failures,[]);
    fs.writeFileSync(path.join(output,"result.json"),JSON.stringify({engine,results,pageErrors:failures,realSafari:"NOT_TESTED",realSoftwareKeyboard:"NOT_TESTED"},null,2));
    console.log(JSON.stringify({engine,status:"PASS",mobile:results}));
  } finally {
    await desktopContext?.close();
    await browser.close();
    for (const profile of profiles) fs.rmSync(profile, { recursive: true, force: true });
    await new Promise(r=>server.close(r));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
