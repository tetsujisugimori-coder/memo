"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const playwright = require("playwright");
const { parseCsvTable, parseTsvTable } = require("./table-block-utils.js");
const browserName = process.env.MEMO_NEXUS_E2E_BROWSER || "chromium";
const artifacts = path.join(__dirname, "e2e-artifacts", "table-file-export", browserName);

async function waitForApp(page) {
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
  await page.locator("#editor").waitFor();
  await page.waitForFunction(() => !noteSaveFoundation.isDirty(currentId) && saveTimer === null);
}

(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
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
    browser = await playwright[browserName].launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.locator("#titleInput").fill("売上:集計.csv");
    await page.getByRole("button", { name: "表ブロックを挿入", exact: true }).click();
    const block = page.locator("#tableBlockEditors > article[data-table-id]");
    await block.locator('[data-row-index="0"][data-column-index="0"]').evaluate((input) => { input.value = "項目"; });
    await block.locator('[data-row-index="0"][data-column-index="1"]').evaluate((input) => { input.value = "値"; });
    await block.locator('[data-row-index="1"][data-column-index="0"]').evaluate((input) => { input.value = 'りん,ご\t"'; });
    await block.locator('[data-row-index="1"][data-column-index="1"]').evaluate((input) => { input.value = "00123"; });
    await page.evaluate(() => {
      window.tableFileExportNativeBlob = Blob;
      window.tableFileExportBlobTypes = [];
      window.Blob = class TableFileExportBlob extends window.tableFileExportNativeBlob {
        constructor(parts, options) {
          super(parts, options);
          window.tableFileExportBlobTypes.push(this.type);
        }
      };
    });
    const before = await page.evaluate(async () => ({ body: editor.value, dirty: noteSaveFoundation.isDirty(currentId), undo: structuredClone(undoStack), redo: structuredClone(redoStack), stored: (await getStoredNotes()).find((note) => note.id === currentId) }));
    const expected = [["項目", "値"], ['りん,ご\t"', "00123"]];
    for (const [action, extension, parse, mime] of [["save-csv", ".csv", parseCsvTable, "text/csv;charset=utf-8"], ["save-tsv", ".tsv", parseTsvTable, "text/tab-separated-values;charset=utf-8"]]) {
      await block.locator("details").evaluate((menu) => { menu.open = true; });
      const event = page.waitForEvent("download");
      await block.locator(`[data-table-action="${action}"]`).evaluate((button) => button.click());
      const download = await event;
      assert.equal(download.suggestedFilename(), `売上_集計-table-1${extension}`);
      const bytes = fs.readFileSync(await download.path());
      assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      assert.equal(download.suggestedFilename().endsWith(extension), true);
      assert.deepEqual(parse(new TextDecoder("utf-8").decode(bytes)).rows, expected);
      assert.equal(await download.failure(), null);
    }
    assert.deepEqual(await page.evaluate(() => window.tableFileExportBlobTypes), ["text/csv;charset=utf-8", "text/tab-separated-values;charset=utf-8"]);
    await page.evaluate(() => { window.Blob = window.tableFileExportNativeBlob; });
    const after = await page.evaluate(async () => ({ body: editor.value, dirty: noteSaveFoundation.isDirty(currentId), undo: structuredClone(undoStack), redo: structuredClone(redoStack), stored: (await getStoredNotes()).find((note) => note.id === currentId) }));
    assert.deepEqual(after, before, "CSV/TSV export must not change persistence or history");
    for (const theme of ["light", "dark"]) for (const width of [390, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction((mode) => document.body.dataset.layoutMode === mode, width < 600 ? "mobile" : "wide");
      await page.evaluate((value) => applyTheme(value), theme);
      await block.locator("details").evaluate((menu) => { menu.open = true; });
      const metrics = await page.evaluate(() => ({ html: document.documentElement.scrollWidth, body: document.body.scrollWidth, client: document.documentElement.clientWidth }));
      assert.ok(metrics.html <= metrics.client && metrics.body <= metrics.client);
      await page.screenshot({ path: path.join(artifacts, `table-file-export-${theme}-${width}-actions.png`) });
    }
    assert.deepEqual(errors, []);
    console.log(`Table file export E2E (${browserName}) passed`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
