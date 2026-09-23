"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const playwright = require("playwright");
const { parseCsvTable, parseTsvTable } = require("./table-block-utils.js");

const browserName = process.env.MEMO_NEXUS_E2E_BROWSER || "chromium";
const sourceTsv = "項目\t売上\t利益\n1月\t100\t20\n2月\t120\t25";

async function idle(page) {
  await page.waitForFunction(() => !noteSaveFoundation.isDirty(currentId) && saveTimer === null);
}

async function snapshot(page) {
  return page.evaluate(async () => ({
    body: editor.value, dirty: noteSaveFoundation.isDirty(currentId), undo: structuredClone(undoStack), redo: structuredClone(redoStack),
    drafts: structuredClone([...chartEditorOriginalCharts]), stored: (await getStoredNotes()).find((note) => note.id === currentId)
  }));
}

async function setup(page) {
  await page.locator("#newBtn").click();
  await page.waitForFunction(() => editor.value === "");
  await page.locator("#insertChartBtn").click();
  const editorBlock = page.locator(".chart-block-editor");
  await editorBlock.locator('[data-chart-action="paste-table"]').click();
  await page.getByRole("dialog").locator("textarea").fill(sourceTsv);
  await page.getByRole("button", { name: "貼り付け内容を反映", exact: true }).click();
  await editorBlock.locator('[data-chart-action="confirm"]').click();
  await page.waitForFunction(() => document.querySelector(".chart-block-editor > .chart-block-status")?.textContent === "入力内容を保存しました");
  await idle(page);
  await editorBlock.locator('[data-chart-action="paste-table"]').click();
  await page.getByRole("dialog").locator("textarea").fill(sourceTsv);
  await page.getByRole("button", { name: "貼り付け内容を反映", exact: true }).click();
  return editorBlock;
}

async function saveAndRead(page, trigger, format, expected) {
  const event = page.waitForEvent("download");
  await trigger.click();
  const download = await event;
  assert.match(download.suggestedFilename(), new RegExp(`-chart-1\\.${format}$`));
  assert.equal(await download.failure(), null);
  const bytes = fs.readFileSync(await download.path());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = new TextDecoder("utf-8").decode(bytes);
  const parsed = format === "csv" ? parseCsvTable(text) : parseTsvTable(text);
  assert.deepEqual(parsed.rows, expected);
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
    browser = await playwright[browserName].launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await idle(page);
    await page.locator("#titleInput").fill("売上:集計.csv");
    const editorBlock = await setup(page);
    await editorBlock.locator('[data-chart-series-value][data-chart-series-index="0"]').first().fill("1.2345678901234567");
    await editorBlock.locator('[data-chart-item-field="label"]').first().fill("編集途中, 1月");
    const draftExpected = [["項目", "売上", "利益"], ["編集途中, 1月", "1.2345678901234567", "20"], ["2月", "120", "25"]];
    const draftBefore = await snapshot(page);
    for (const format of ["csv", "tsv"]) {
      await saveAndRead(page, editorBlock.locator(`[data-chart-action="save-file"][data-chart-file-format="${format}"]`), format, draftExpected);
      await page.waitForFunction((value) => document.querySelector(".chart-block-editor > .chart-block-status")?.textContent.startsWith(value), format.toUpperCase());
    }
    assert.deepEqual(await snapshot(page), draftBefore, "draft export must not save or change history");
    await editorBlock.locator('[data-chart-action="cancel"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor > .chart-block-status")?.textContent === "編集内容を取り消しました");
    await idle(page);
    const savedExpected = [["項目", "売上", "利益"], ["1月", "100", "20"], ["2月", "120", "25"]];
    const savedBefore = await snapshot(page);
    for (const format of ["csv", "tsv"]) {
      const trigger = page.locator(`#preview [data-chart-file-format="${format}"]`);
      await saveAndRead(page, trigger, format, savedExpected);
      await page.waitForFunction((value) => document.querySelector("#preview .chart-tsv-copy-controls [role=status]")?.textContent.startsWith(value), format.toUpperCase());
    }
    assert.deepEqual(await snapshot(page), savedBefore, "saved export must not change persistence or history");
    for (const width of [320, 375, 390, 430, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction((mode) => document.body.dataset.layoutMode === mode, width < 600 ? "mobile" : "wide");
      const controls = page.locator("#preview .chart-tsv-copy-controls");
      assert.equal(await controls.locator('[data-chart-file-format="csv"]').count(), 1);
      assert.equal(await controls.locator('[data-chart-file-format="tsv"]').count(), 1);
      const metrics = await page.evaluate(() => ({ html: document.documentElement.scrollWidth, body: document.body.scrollWidth, client: document.documentElement.clientWidth }));
      assert.ok(metrics.html <= metrics.client && metrics.body <= metrics.client);
    }
    assert.deepEqual(errors, []);
    console.log(`Chart file export E2E (${browserName}) passed`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
