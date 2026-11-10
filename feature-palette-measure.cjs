"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const playwright = require("playwright");
const root = path.resolve(process.argv[2] || ".");
const phase = process.argv[3] || "after";
const engine = process.env.MEMO_NEXUS_E2E_BROWSER || "chromium";
const output = path.resolve(process.env.MEMO_PALETTE_OUTPUT || `e2e-artifacts/feature-palette/${engine}`);
fs.mkdirSync(output, {recursive:true});
(async () => {
  const server = http.createServer((req,res) => {
    const pathname = decodeURIComponent(new URL(req.url,"http://localhost").pathname);
    const file = path.resolve(root, pathname === "/" ? "index.html" : pathname.slice(1));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file,(error,body) => {
      if(error)return res.writeHead(404).end();
      res.setHeader("Content-Type",file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(body);
    });
  });
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const browser=await playwright[engine].launch({headless:true});
  const results=[];
  try {
    for(const width of [1280,768,320,375,390,430]) {
      const context=await browser.newContext({viewport:{width,height:800},isMobile:width<720,hasTouch:width<720,locale:"ja-JP",timezoneId:"Asia/Tokyo",reducedMotion:"reduce"});
      const page=await context.newPage();
      await context.route("https://cdn.jsdelivr.net/**",route=>route.fulfill({body:"",contentType:route.request().url().endsWith(".css")?"text/css":"application/javascript"}));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator("#appStartupGuard").waitFor({state:"hidden"});
      await page.evaluate(async()=>{
        setContextPanelOpen(false,{restoreFocus:false});
        titleInput.value="機能パレット検証";
        editor.value="本文入力領域の比較用メモです。\n同じ内容・画面寸法で比較します。";
        applyCurrentEditorDraft(currentNote());await saveCurrentNote();
        if(isMobileWritingMode())setMobileWritingMode(false);
        renderNoteMeta(currentNote());
        // Fixed labels remove run-time differences; original datetime/update logic is tested separately.
        document.getElementById("noteCreatedAt").textContent="作成 2026/11/10 09:00";
        document.getElementById("noteUpdatedAt").textContent="更新 2026/11/10 09:00";
      });
      await page.waitForFunction(() => {
        const panel = document.getElementById("contextPanel");
        const style = getComputedStyle(panel);
        return style.display === "none" || panel.getBoundingClientRect().left >= innerWidth;
      });
      await page.evaluate(()=>document.fonts.ready);
      for(const state of phase==="before"?["closed"]:["closed","open"]) {
        if(state==="open")await page.locator("#featurePaletteToggle").click();
        const row=await page.evaluate(()=>{
          const rect=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,area:r.width*r.height,display:getComputedStyle(e).display};};
          const editorRect = rect("#editor");
          const panel = document.getElementById("featurePalette");
          const palette = panel && !panel.hidden ? rect("#featurePalette") : null;
          const overlap = palette ? Math.max(0,Math.min(editorRect.x+editorRect.width,palette.x+palette.width)-Math.max(editorRect.x,palette.x))*Math.max(0,Math.min(editorRect.y+editorRect.height,palette.y+palette.height)-Math.max(editorRect.y,palette.y)) : 0;
          return{editor:editorRect,title:rect(".title-row"),dates:rect("#noteMeta"),tags:rect("#noteTagEditor"),tools:rect(".editor-tools"),paletteOverlapArea:overlap,overflow:document.documentElement.scrollWidth-innerWidth};
        });
        assert.equal(row.overflow,0);
        results.push({width,height:800,state,...row});
        await page.screenshot({path:path.join(output,`${phase}-${width}-${state}.png`)});
      }
      await context.close();
    }
    fs.writeFileSync(path.join(output,`${phase}.json`),JSON.stringify({engine,browserVersion:browser.version(),playwright:require("playwright/package.json").version,results},null,2));
    if(phase==="after" && fs.existsSync(path.join(output,"before.json"))) {
      const before=JSON.parse(fs.readFileSync(path.join(output,"before.json"))).results;
      for(const b of before) {
        const closed=results.find(r=>r.width===b.width&&r.state==="closed");
        const open=results.find(r=>r.width===b.width&&r.state==="open");
        assert.equal(closed.editor.width,b.editor.width,`${b.width}px width preserved`);
        assert.ok(closed.editor.height>b.editor.height,`${b.width}px editor height improves`);
        assert.deepEqual(open.editor,closed.editor,`${b.width}px overlay must not shrink editor`);
        assert.equal(closed.tools.height,0,"no invisible toolbar row");
      }
    }
    if (phase === "after" && fs.existsSync(path.join(output, "integrated-main.json"))) {
      const main = JSON.parse(fs.readFileSync(path.join(output, "integrated-main.json"))).results;
      for (const baseline of main) {
        const candidate = results.find(row => row.width === baseline.width && row.state === baseline.state);
        assert.ok(candidate, "matching main geometry case");
        assert.deepEqual(candidate.editor, baseline.editor, `${baseline.width}px ${baseline.state} main editor geometry preserved`);
        assert.equal(candidate.overflow, baseline.overflow);
      }
    }
    console.log(JSON.stringify({phase,engine,results}));
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
