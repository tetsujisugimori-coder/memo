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
    timelines: splitTimelineBlocks(editor.value).filter((entry) => entry.type === "timeline").map((entry) => entry.timeline),
    figures: splitImageBlocks(editor.value).filter((entry) => entry.type === "image"), sources: parseSourceDocument(editor.value).sources }));
}
async function itemEditor(page, index) {
  const item = page.locator(".timeline-item-editor").nth(index);
  if (!await item.evaluate((details) => details.open)) await item.locator("summary").click();
  return item;
}
async function layout(page) {
  await page.waitForFunction(() => { const box = document.querySelector("#previewCard").getBoundingClientRect(); return box.left >= -1 && box.right <= innerWidth + 1; });
  await page.waitForFunction(() => [...document.querySelectorAll(".timeline-block img")].every((image) => image.complete && image.naturalWidth));
  const result = await page.locator(".timeline-block").first().evaluate((timeline) => {
    const card = document.querySelector("#previewCard").getBoundingClientRect();
    const preview = document.querySelector("#preview");
    const items = [...timeline.querySelectorAll(".timeline-item")].map((item) => {
      const content = item.querySelector(".timeline-content").getBoundingClientRect();
      const date = item.querySelector(".timeline-date").getBoundingClientRect();
      return { contentWidth: content.width, contentY: content.y, dateBottom: date.bottom,
        overflow: item.scrollWidth > item.clientWidth + 1 };
    });
    return { items, inViewport: card.left >= -1 && card.right <= innerWidth + 1,
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      previewOverflow: preview.scrollWidth > preview.clientWidth + 1,
      timelineOverflow: timeline.scrollWidth > timeline.clientWidth + 1,
      imageOverflow: [...timeline.querySelectorAll("img")].some((image) => image.getBoundingClientRect().right > timeline.getBoundingClientRect().right + 1) };
  });
  assert.equal(result.inViewport, true);
  for (const field of ["documentOverflow", "previewOverflow", "timelineOverflow", "imageOverflow"]) assert.equal(result[field], false, field);
  assert.ok(result.items.every((item) => !item.overflow && item.contentWidth > 170));
  if (page.viewportSize().width <= 600) assert.ok(result.items.every((item) => item.contentY >= item.dateBottom - 1));
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
    const page = await open();
    await page.locator("#titleInput").fill("Timeline v1 検証");
    await page.locator("#editor").fill("前文");
    await idle(page);
    await page.locator("#manageSourcesBtn").click();
    await page.locator('#sourceForm [name="title"]').fill("歴史資料");
    await page.locator('#sourceForm [name="url"]').fill("https://example.org/" + "long".repeat(60));
    await page.locator('#sourceForm button[type="submit"]').first().click();
    await page.locator("#closeSourceDialogBtn").click();
    await idle(page);
    await page.locator("#insertImageBlockBtn").click();
    await page.locator("#imageBlockInput").setInputFiles({ name: "timeline.png", mimeType: "image/png", buffer: fs.readFileSync(path.join(root, "e2e-artifacts/chart-png-example-light-390.png")) });
    await page.locator("#preview .image-block").waitFor();
    await idle(page);
    await page.locator("#preview .image-block").hover();
    await page.locator(".image-block-menu-toggle").click();
    await page.locator(".image-block-edit-figure").click();
    await page.locator(".figure-metadata-editor").getByLabel("キャプション").fill("共通Figureのキャプション");
    await page.locator(".figure-metadata-editor").getByLabel("資料名").fill("資料館");
    await page.locator(".figure-metadata-editor").getByText("資料情報を保存").click();
    await idle(page);
    const old = await saved(page);
    assert.equal(old.figures[0].figureId, undefined);
    await page.locator("#insertTimelineBtn").click();
    await page.locator("#timelineTitleInput").fill("戦後の出来事 <script>");
    await page.locator("#timelineDescriptionInput").fill("時系列の説明\n二行目");
    for (const [index, date, title, body] of [[0, "1945–1952", "出来事A", "本文A **強調**\n- [ ] 出来事のタスク"], [1, "1951年9月", "出来事B", "本文B"], [2, "初期開発期", "出来事C", "本文C"]]) {
      await page.locator("#addTimelineItemBtn").click();
      const item = await itemEditor(page, index);
      await item.getByLabel("日付・期間").fill(date);
      await item.getByLabel("出来事のタイトル").fill(title);
      await item.getByLabel("本文", { exact: true }).fill(body);
      if (index < 2) {
        const figure = item.getByLabel("Figureを選択");
        const value = await figure.locator("option").nth(1).getAttribute("value");
        await figure.selectOption(value);
        await item.locator('input[type="checkbox"]').check();
      }
    }
    await (await itemEditor(page, 1)).getByRole("button", { name: "上へ", exact: true }).click();
    await page.locator("#timelineForm").getByRole("button", { name: "Timelineを保存", exact: true }).click();
    await page.locator(".timeline-block").waitFor();
    const expected = await saved(page);
    assert.equal(expected.body, expected.stored);
    assert.deepEqual(expected.timelines[0].items.map((item) => item.title), ["出来事B", "出来事A", "出来事C"]);
    assert.equal(expected.timelines[0].items[0].figureId, expected.figures[0].figureId);
    assert.equal(expected.timelines[0].items[0].figureId, expected.timelines[0].items[1].figureId);
    assert.equal(expected.figures[0].images[0].figureMetadata.caption, "共通Figureのキャプション");
    await page.locator("#undoBtn").click();
    assert.equal((await saved(page)).body, old.body);
    await page.locator("#redoBtn").click();
    assert.equal((await saved(page)).body, expected.body);
    assert.equal(await page.locator(".timeline-block .image-block-menu-shell").count(), 0);
    assert.deepEqual(await page.locator(".timeline-citations .citation-link").allInnerTexts(), ["[1]", "[1]"]);
    assert.equal(await page.locator(".report-sources li").count(), 1);
    assert.equal(await page.locator("#preview script").count(), 0);
    await page.reload();
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.equal((await saved(page)).body, expected.body);
    // Source removal must see Timeline citations even though its payload is encoded.
    await page.locator("#manageSourcesBtn").click();
    await page.locator(".source-list-item").first().getByRole("button", { name: "削除", exact: true }).click();
    await page.locator("#sourceStatus").getByText(/参照されています/).waitFor();
    await page.locator("#closeSourceDialogBtn").click();
    // Also render before the canonical Figure, exercising normal Image Block editor indexing.
    await page.evaluate(() => { const block = splitTimelineBlocks(editor.value).find((entry) => entry.type === "timeline"); commitSourceBody(withSources(block.raw + "\n" + parseSourceDocument(replaceTimelineBlock(editor.value, block, null)).body, parseSourceDocument(editor.value).sources)); });
    await idle(page);
    // Change canonical metadata; both Timeline uses must reflect it without copied metadata.
    await page.locator(".image-block-menu-toggle").click();
    await page.locator(".image-block-edit-figure").click();
    await page.locator(".figure-metadata-editor").getByLabel("キャプション").fill("更新した共通Figure");
    await page.locator(".figure-metadata-editor").getByText("資料情報を保存").click();
    await page.waitForFunction(() => [...document.querySelectorAll(".timeline-block .figure-metadata-main")].every((item) => item.textContent.includes("更新した共通Figure")));
    // Two distinct Timeline blocks and repeated Figure references produce no duplicate DOM IDs.
    await idle(page);
    await page.locator("#insertTimelineBtn").click();
    await page.locator("#timelineTitleInput").fill("第2Timeline");
    await page.locator("#addTimelineItemBtn").click();
    await (await itemEditor(page, 0)).getByLabel("日付・期間").fill("2026 Q3");
    await page.locator("#timelineForm").getByRole("button", { name: "Timelineを保存", exact: true }).click();
    await idle(page);
    await page.evaluate(() => commitSourceBody(withSources(parseSourceDocument(editor.value).body + "\n- [ ] 本文のタスク", parseSourceDocument(editor.value).sources)));
    await idle(page);
    assert.equal(await page.locator(".timeline-body input[type=checkbox]").isDisabled(), true);
    await page.locator("#preview .task-list-checkbox").check();
    await idle(page);
    assert.match(await page.locator("#editor").inputValue(), /- \[x\] 本文のタスク/);
    assert.equal((await saved(page)).timelines[0].items[1].body.includes("- [ ] 出来事のタスク"), true);
    const current = await saved(page);
    assert.equal(current.timelines.length, 2);
    const duplicateIds = await page.locator("#preview [id]").evaluateAll((elements) => elements.map((el) => el.id).filter((id, i, all) => all.indexOf(id) !== i));
    assert.deepEqual(duplicateIds, []);
    await page.locator("#reportPreviewBtn").click();
    await page.locator("body.report-preview-mode").waitFor();
    assert.equal(await page.locator(".timeline-edit").first().isVisible(), false);
    await layout(page);
    const screenshots = path.join(root, "e2e-artifacts");
    await page.setViewportSize({ width: 1280, height: 2000 });
    await layout(page);
    await page.screenshot({ path: path.join(screenshots, "timeline-report-pc.png") });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.waitForFunction(() => layoutMode === "mobile");
    await layout(page);
    await page.setViewportSize({ width: 320, height: 2600 });
    await layout(page);
    await page.screenshot({ path: path.join(screenshots, "timeline-report-320.png") });
    await page.setViewportSize({ width: 320, height: 800 });
    assert.equal((await saved(page)).body, current.body, "Report Preview changes no saved data");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.body.classList.contains("report-preview-mode"));
    if (await page.locator("#contextPanel").getAttribute("aria-hidden") === "false") await page.locator("#closeContextPanelBtn").click();
    await page.locator("#cardPaneBtn").click();
    await page.waitForFunction(() => mobileCardOpen);
    await layout(page);
    await page.locator(".timeline-edit").first().click();
    assert.equal(await page.locator("#timelineDialog").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1 && dialog.getBoundingClientRect().width <= innerWidth), true);
    assert.deepEqual(await page.locator(".timeline-item-editor summary").allInnerTexts(), ["1. 出来事B", "2. 出来事A", "3. 出来事C"]);
    await page.locator("#cancelTimelineBtn").click();
    await page.screenshot({ path: path.join(screenshots, "timeline-preview-320.png") });
    const exportState = await saved(page);
    const noteId = await page.evaluate(() => currentId);
    for (const name of ["markdown", "backup"]) {
      const bytes = await page.evaluate(async (name) => {
        const files = name === "backup" ? await buildPortableBackupZipFiles() : (await buildSingleNoteExportBundle(currentNote())).files;
        return Array.from(new Uint8Array(await (await makeZip(files)).arrayBuffer()));
      }, name);
      const restored = await open();
      await restored.locator("#importMarkdownZipInput").setInputFiles({ name: name + ".zip", mimeType: "application/zip", buffer: Buffer.from(bytes) });
      if (name === "backup") {
        await restored.locator("#backupPreviewDialog").waitFor({ state: "visible" });
        await restored.locator("#confirmBackupPreviewBtn").click();
        await restored.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();
        await restored.locator("#cancelBackupPreviewBtn").click();
        await restored.evaluate((id) => openNote(id), noteId);
      }
      await restored.locator(".timeline-block").first().waitFor();
      const result = await saved(restored);
      assert.deepEqual(result.timelines, exportState.timelines);
      assert.deepEqual(result.sources, exportState.sources);
      assert.equal(result.figures[0].figureId, exportState.figures[0].figureId);
      assert.deepEqual(result.figures[0].images[0].figureMetadata, exportState.figures[0].images[0].figureMetadata);
      await layout(restored);
      await restored.reload();
      await restored.locator("#appStartupGuard").waitFor({ state: "hidden" });
      assert.deepEqual((await saved(restored)).timelines, exportState.timelines);
      await restored.close();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => layoutMode === "wide");
    await page.locator(".timeline-edit").first().click();
    await (await itemEditor(page, 2)).getByRole("button", { name: "項目を削除", exact: true }).click();
    await page.locator("#timelineForm").getByRole("button", { name: "Timelineを保存", exact: true }).click();
    assert.equal((await saved(page)).timelines[0].items.length, 2);
    await page.locator(".timeline-edit").nth(1).click();
    await page.locator("#deleteTimelineBtn").click();
    assert.equal((await saved(page)).timelines.length, 1);
    // Dangling references remain explicit and do not mutate saved payloads.
    await page.evaluate(() => { const figure = splitImageBlocks(editor.value).find((entry) => entry.type === "image"); commitSourceBody(replaceImageBlock(editor.value, figure, [], "")); });
    await page.locator(".timeline-missing").first().waitFor();
    assert.equal(await page.locator(".timeline-missing").count(), 2);
    assert.deepEqual(errors, []);
    console.log("Timeline E2E passed (" + engine + "): edit, order, shared references, reload, ZIPs, PC/320px and DOM IDs");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
