"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

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
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await page.locator("#editor").fill("根拠: ");
    await page.locator("#manageSourcesBtn").click();
    await page.locator('#sourceForm [name="title"]').fill("<script>資料A</script>");
    await page.locator('#sourceForm [name="author"]').fill("<b>著者</b>");
    await page.locator('#sourceForm [name="publisher"]').fill("<img src=x onerror=alert(1)>");
    await page.locator('#sourceForm [name="url"]').fill("javascript:alert(1)");
    await page.locator('#sourceForm button[type="submit"]').first().click();
    assert.match(await page.locator("#sourceStatus").innerText(), /引用を挿入/);
    assert.equal(await page.locator("#preview .citation-link, #preview .report-sources").count(), 0);
    assert.equal(await page.locator("#sourceList .source-list-item").count(), 1);
    await page.locator("#sourceList .source-list-item").first().getByText("引用を挿入").click();
    await page.locator("#preview .citation-link").first().waitFor();
    assert.equal(await page.locator("#preview .citation-link").first().innerText(), "[1]");
    assert.equal(await page.locator("#preview .report-sources li").count(), 1);
    assert.equal(await page.locator("#preview .report-sources script").count(), 0);
    assert.equal(await page.locator("#preview .report-sources img, #preview .report-sources b").count(), 0);
    assert.equal(await page.locator("#preview .report-sources a").count(), 0);
    await page.evaluate(() => undoLastEdit());
    await page.waitForFunction(() => !document.querySelector("#preview .citation-link"));
    await page.evaluate(() => redoLastEdit());
    await page.locator("#preview .citation-link").first().waitFor();
    await page.evaluate(() => { const position = editor.value.length; editor.setSelectionRange(position, position); });
    await page.locator("#manageSourcesBtn").click();
    await page.locator("#sourceList .source-list-item").first().getByText("引用を挿入").click();
    assert.equal(await page.locator("#preview .citation-link").count(), 2, await page.locator("#editor").inputValue());
    assert.deepEqual(await page.locator("#preview .citation-link").allInnerTexts(), ["[1]", "[1]"]);
    await page.locator("#manageSourcesBtn").click();
    await page.locator('#sourceForm [name="title"]').fill("資料B");
    await page.locator('#sourceForm button[type="submit"]').first().click();
    await page.evaluate(() => { const position = editor.value.length; editor.setSelectionRange(position, position); });
    await page.locator("#sourceList .source-list-item").nth(1).getByText("引用を挿入").click();
    assert.deepEqual(await page.locator("#preview .citation-link").allInnerTexts(), ["[1]", "[1]", "[2]"]);
    await page.locator("#manageSourcesBtn").click();
    await page.locator("#sourceList .source-list-item").first().getByRole("button", { name: "編集" }).click();
    await page.locator('#sourceForm [name="title"]').fill("編集後の資料A");
    await page.locator('#sourceForm [name="url"]').fill("https://example.org/資料");
    await page.locator('#sourceForm button[type="submit"]').first().click();
    await page.locator("#preview .report-sources").getByText("編集後の資料A").waitFor();
    assert.match(await page.locator("#preview .report-sources a").first().getAttribute("href"), /^https:/);
    await page.locator("#sourceList .source-list-item").first().getByText("削除").click();
    assert.match(await page.locator("#sourceStatus").innerText(), /本文・Figure／Comparison・Table・Chart・Timeline・Diagramのいずれかから参照/);
    assert.equal(await page.locator("#sourceList .source-list-item").count(), 2);
    await page.locator("#closeSourceDialogBtn").click();
    await page.evaluate(() => flushSave());
    const before = await page.evaluate(async () => {
      const note = (await getStoredNotes()).find((item) => item.id === currentId);
      return { id: note.id, revision: note.revision, updatedAt: note.updatedAt, body: note.body };
    });
    assert.equal(await page.locator("#preview .report-sources li").count(), 2);
    await page.locator("#reportPreviewBtn").click();
    assert.deepEqual(await page.locator("#preview .citation-link").allInnerTexts(), ["[1]", "[1]", "[2]"]);
    assert.equal(await page.locator("#preview .report-sources li").count(), 2);
    await page.locator("#reportPreviewBackBtn").click();
    assert.deepEqual(await page.evaluate(async () => {
      const note = (await getStoredNotes()).find((item) => item.id === currentId);
      return { id: note.id, revision: note.revision, updatedAt: note.updatedAt, body: note.body };
    }), before);
    const bundle = await page.evaluate(async () => {
      const note = currentNote();
      const markdown = serializeNoteForMarkdown(note, note.body);
      const files = await buildPortableBackupZipFiles();
      return { markdown, backupVersion: JSON.parse(files.find((file) => file.name === "manifest.json").content).version,
        backupNote: files.find((file) => file.name.startsWith("notes/")).content };
    });
    assert.match(bundle.markdown, /memo-nexus:sources-v1:/);
    assert.match(bundle.backupNote, /memo-nexus:sources-v1:/);
    assert.equal(bundle.backupVersion, 6);
    await page.reload();
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#editor").inputValue(), before.body);
    assert.deepEqual(await page.locator("#preview .citation-link").allInnerTexts(), ["[1]", "[1]", "[2]"]);
    await page.locator("#editor").fill(await page.evaluate(body => { const document = parseSourceDocument(body); return withSources(document.body + "\n[@missing] \x60[@source-a]\x60\n\x60\x60\x60\n[@source-b]\n\x60\x60\x60", document.sources); }, before.body));
    await page.locator("#preview").getByText("[@missing]", { exact: false }).waitFor();
    assert.equal(await page.locator("#preview .citation-link").count(), 3);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForFunction(() => document.body.dataset.layoutMode === "mobile");
    if (await page.locator("#contextPanel").getAttribute("aria-hidden") === "false")
      await page.locator("#closeContextPanelBtn").click();
    await page.locator("#mobileAppMenu summary").click();
    await page.locator("#manageSourcesMobileBtn").click();
    await page.locator("#sourceList .source-list-item").first().getByRole("button", { name: "編集" }).click();
    await page.locator('#sourceForm [name="url"]').fill(`https://example.org/${"long".repeat(500)}`);
    await page.locator('#sourceForm button[type="submit"]').first().click();
    assert.equal(await page.locator("#sourceDialog").evaluate((dialog) => dialog.getBoundingClientRect().width <= innerWidth), true);
    await page.locator("#closeSourceDialogBtn").click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.evaluate(() => flushSave());
    const markdownZip = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await makeZip(
      (await buildSingleNoteExportBundle(currentNote())).files
    )).arrayBuffer()))));
    const backupZip = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await makeZip(
      await buildPortableBackupZipFiles()
    )).arrayBuffer()))));
    const markdownPage = await browser.newPage();
    await markdownPage.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "domcontentloaded" });
    await markdownPage.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await markdownPage.locator("#importMarkdownZipInput").setInputFiles({ name: "sources.zip", mimeType: "application/zip", buffer: markdownZip });
    await markdownPage.waitForFunction(() => [...notes].some((note) => note.body.includes("memo-nexus:sources-v1:")));
    assert.equal(await markdownPage.locator("#preview .report-sources li").count(), 2);
    const backupPage = await browser.newPage();
    await backupPage.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "domcontentloaded" });
    await backupPage.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await backupPage.locator("#importMarkdownZipInput").setInputFiles({ name: "sources-backup.zip", mimeType: "application/zip", buffer: backupZip });
    await backupPage.locator("#backupPreviewDialog").waitFor({ state: "visible" });
    await backupPage.locator("#confirmBackupPreviewBtn").click();
    await backupPage.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();
    assert.equal(await backupPage.locator("#preview .report-sources li").count(), 2);
    await page.evaluate(() => { editor.value = "本文\n<!-- memo-nexus:sources-v1:zz -->\n[@missing]"; renderPreview(); });
    await page.locator("#preview").getByText("[@missing]", { exact: false }).waitFor();
    assert.match(await page.locator("#preview").innerText(), /memo-nexus:sources-v1:zz/);

    const workflow = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const workflowErrors = [];
    workflow.on("pageerror", (error) => workflowErrors.push(error.message));
    await workflow.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "domcontentloaded" });
    await workflow.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await workflow.locator("#editor").fill("前半 後半");
    await workflow.evaluate(() => editor.setSelectionRange(3, 3));
    await workflow.locator("#manageSourcesBtn").click();
    await workflow.locator('#sourceForm [name="title"]').fill("新規資料");
    await workflow.locator("#saveAndInsertSourceBtn").click();
    assert.equal(await workflow.locator("#sourceDialog").isVisible(), false);
    const sourceId = await workflow.evaluate(() => parseSourceDocument(editor.value).sources[0]?.id);
    assert.match(sourceId, /^source-/);
    assert.equal(await workflow.evaluate(() => parseSourceDocument(editor.value).body), `前半 [@${sourceId}]後半`);
    assert.deepEqual(await workflow.locator("#preview .citation-link").allInnerTexts(), ["[1]"]);
    assert.equal(await workflow.locator("#preview .report-sources li").count(), 1);
    await workflow.evaluate(() => undoLastEdit());
    await workflow.waitForFunction(() => parseSourceDocument(editor.value).sources.length === 0 && !editor.value.includes("[@source-"));
    await workflow.evaluate(() => redoLastEdit());
    await workflow.waitForFunction(() => parseSourceDocument(editor.value).sources.length === 1);
    await workflow.evaluate(() => flushSave());
    const savedCombined = await workflow.evaluate(async () => {
      const note = (await getStoredNotes()).find((item) => item.id === currentId);
      return { body: note.body, revision: note.revision, updatedAt: note.updatedAt };
    });
    assert.equal(parseInt(savedCombined.revision, 10) >= 1, true);
    assert.equal(Boolean(savedCombined.updatedAt), true);
    assert.match(savedCombined.body, /memo-nexus:sources-v1:/);
    await workflow.reload();
    await workflow.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.equal(await workflow.evaluate(() => parseSourceDocument(editor.value).body), `前半 [@${sourceId}]後半`);
    assert.deepEqual(await workflow.locator("#preview .citation-link").allInnerTexts(), ["[1]"]);

    const source = await workflow.evaluate(() => parseSourceDocument(editor.value).sources[0]);
    await workflow.locator("#editor").fill(`${await workflow.evaluate((item) => withSources("本文", [item]), source)}\n追記`);
    await workflow.evaluate(() => editor.setSelectionRange(editor.value.length, editor.value.length));
    await workflow.locator("#manageSourcesBtn").click();
    await workflow.locator("#sourceList .source-list-item").first().getByRole("button", { name: "引用を挿入" }).click();
    const afterMarker = await workflow.evaluate(() => ({ raw: editor.value, parsed: parseSourceDocument(editor.value) }));
    assert.equal(afterMarker.parsed.body, `本文\n追記[@${sourceId}]`);
    assert.equal(afterMarker.parsed.sources[0].id, sourceId);
    assert.match(afterMarker.raw, /^<!-- memo-nexus:sources-v1:[0-9a-f]+ -->\n/);
    assert.deepEqual(await workflow.locator("#preview .citation-link").allInnerTexts(), ["[1]"]);

    await workflow.locator("#editor").fill(await workflow.evaluate((item) => withSources("通常本文", [item]), source));
    await workflow.evaluate(() => { const position = editor.value.indexOf("通常本文") + 2; editor.setSelectionRange(position, position); });
    await workflow.locator("#manageSourcesBtn").click();
    await workflow.locator("#sourceList .source-list-item").first().getByRole("button", { name: "引用を挿入" }).click();
    assert.equal(await workflow.evaluate(() => parseSourceDocument(editor.value).body), `通常[@${sourceId}]本文`);

    await workflow.locator("#editor").fill(await workflow.evaluate((item) => withSources("前 置換対象 後", [item]), source));
    await workflow.evaluate(() => { const position = editor.value.indexOf(parseSourceDocument(editor.value).body); editor.setSelectionRange(position + 2, position + 6); });
    await workflow.locator("#manageSourcesBtn").click();
    await workflow.locator("#sourceList .source-list-item").first().getByRole("button", { name: "引用を挿入" }).click();
    assert.equal(await workflow.evaluate(() => parseSourceDocument(editor.value).body), `前 [@${sourceId}] 後`);

    await workflow.evaluate(() => { const position = editor.value.length; editor.setSelectionRange(position, position); });
    await workflow.locator("#manageSourcesBtn").click();
    await workflow.locator("#sourceList .source-list-item").first().getByRole("button", { name: "編集" }).click();
    await workflow.locator('#sourceForm [name="title"]').fill("編集済み資料");
    await workflow.locator("#saveAndInsertSourceBtn").click();
    assert.equal(await workflow.evaluate(() => parseSourceDocument(editor.value).sources[0].id), sourceId);
    assert.equal(await workflow.evaluate(() => parseSourceDocument(editor.value).sources[0].title), "編集済み資料");
    assert.deepEqual(await workflow.locator("#preview .citation-link").allInnerTexts(), ["[1]", "[1]"]);
    assert.equal(await workflow.locator("#preview .report-sources li").count(), 1);

    await workflow.setViewportSize({ width: 320, height: 700 });
    await workflow.waitForFunction(() => document.body.dataset.layoutMode === "mobile");
    if (await workflow.locator("#contextPanel").getAttribute("aria-hidden") === "false")
      await workflow.locator("#closeContextPanelBtn").click();
    await workflow.locator("#mobileAppMenu summary").click();
    await workflow.locator("#manageSourcesMobileBtn").click();
    await workflow.locator('#sourceForm [name="title"]').fill("モバイル資料");
    assert.equal(await workflow.locator("#saveAndInsertSourceBtn").isVisible(), true);
    await workflow.locator("#saveAndInsertSourceBtn").click();
    assert.equal(await workflow.locator("#sourceDialog").isVisible(), false);
    assert.equal(await workflow.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(await workflow.locator("#preview .citation-link").allInnerTexts(), ["[1]", "[1]", "[2]"]);
    assert.deepEqual(workflowErrors, []);
    assert.deepEqual(errors, []);
    process.stdout.write("Citation Source E2E: PASS\n");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
