"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const playwright = require("playwright");

async function idle(page) {
  await page.waitForFunction(() => !noteSaveFoundation.isDirty(currentId) && saveTimer === null
    && window.MemoNexusTypingDerivedUiScheduler.pendingRequestType() === null);
}
async function menu(page, action) {
  await idle(page);
  await page.locator(".image-block").first().hover();
  const toggle = page.locator(".image-block-menu-toggle").first();
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await page.locator(action).first().click();
}
async function comparisonEditor(page) {
  await menu(page, ".image-block-edit-comparison");
  return page.locator(".image-comparison-editor");
}
async function saved(page) {
  await page.evaluate(() => flushSave());
  await idle(page);
  return page.evaluate(async () => {
    const note = (await getStoredNotes()).find((item) => item.id === currentId);
    return { body: editor.value, stored: note.body, revision: note.revision, updatedAt: note.updatedAt,
      undo: undoStack.length, redo: redoStack.length, dirty: note.dirty };
  });
}
async function block(page) {
  return page.evaluate(() => splitImageBlocks(editor.value).find((item) => item.type === "image"));
}
async function waitImages(page) {
  await page.waitForFunction(() => [...document.querySelectorAll(".image-block img")].length === 2
    && [...document.querySelectorAll(".image-block img")].every((image) => image.complete && image.naturalWidth));
}
async function layout(page, vertical) {
  // ResizeObserver updates layoutMode after CSS has already adopted the width.
  await page.waitForFunction(() => layoutMode === layoutModeForWidth(document.body.clientWidth));
  if (await page.evaluate(() => layoutMode === "mobile" && !document.body.classList.contains("report-preview-mode") && !mobileCardOpen)) {
    if (await page.locator("#contextPanel").getAttribute("aria-hidden") === "false")
      await page.locator("#closeContextPanelBtn").click();
    await page.locator("#cardPaneBtn").click();
    await page.waitForFunction(() => {
      const box = document.querySelector("#previewCard").getBoundingClientRect();
      return mobileCardOpen && box.left >= 0 && box.right <= innerWidth + 1;
    });
  }
  assert.equal(await page.locator("#previewCard").getAttribute("aria-hidden"), "false");
  assert.equal(await page.locator("#previewCard").evaluate((card) => card.inert), false);
  await waitImages(page);
  const data = await page.locator(".image-block").first().evaluate((figure) => {
    const items = [...figure.querySelectorAll(".image-block-item")].map((item) => {
      const bounds = item.getBoundingClientRect();
      const image = item.querySelector("img");
      const rendered = image.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, bottom: bounds.bottom,
        id: item.querySelector(".image-block-open").dataset.imageId,
        label: item.querySelector(".image-comparison-label")?.textContent || "",
        ratio: rendered.width / rendered.height, naturalRatio: image.naturalWidth / image.naturalHeight,
        overflow: item.scrollWidth > item.clientWidth + 1 };
    });
    const caption = figure.querySelector(".image-block-caption")?.getBoundingClientRect();
    const card = document.querySelector("#previewCard").getBoundingClientRect();
    return { items, captionY: caption?.y, previewInViewport: card.left >= 0 && card.right <= innerWidth + 1,
      overflow: figure.scrollWidth > figure.clientWidth + 1,
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
      previewOverflow: document.querySelector("#preview").scrollWidth > document.querySelector("#preview").clientWidth + 1 };
  });
  if (vertical) {
    assert.ok(data.items[1].y >= data.items[0].bottom, "320px keeps images in vertical order");
    assert.ok(Math.abs(data.items[0].x - data.items[1].x) < 1);
  } else {
    assert.ok(data.items[1].x > data.items[0].x, "PC displays two columns");
    assert.ok(Math.abs(data.items[0].y - data.items[1].y) < 1);
  }
  for (const item of data.items) {
    assert.ok(Math.abs(item.ratio - item.naturalRatio) < 0.02, "aspect ratio stays unchanged");
    assert.equal(item.overflow, false);
  }
  if (data.captionY) assert.ok(data.captionY >= Math.max(...data.items.map((item) => item.bottom)), "shared description stays below both images");
  assert.equal(data.overflow, false);
  assert.equal(data.previewInViewport, true, "the preview is actually inside the viewport");
  assert.equal(data.documentOverflow, false);
  assert.equal(data.previewOverflow, false);
  return data.items;
}
async function download(page, action) {
  const pending = page.waitForEvent("download");
  await action();
  const result = await pending;
  assert.equal(await result.failure(), null);
  return fs.readFileSync(await result.path());
}
async function screenshotBlock(page, file) {
  const figure = page.locator(".image-block");
  await figure.scrollIntoViewIfNeeded();
  assert.equal(await figure.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const preview = document.querySelector("#preview").getBoundingClientRect();
    return box.top >= preview.top - 1 && box.bottom <= preview.bottom + 1
      && box.left >= 0 && box.right <= innerWidth + 1;
  }), true, "review capture contains the whole visible comparison block");
  await figure.screenshot({ path: file });
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
  const contexts = [];
  const errors = [];
  try {
    browser = await playwright[process.env.MEMO_NEXUS_E2E_BROWSER || "chromium"].launch({ headless: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const open = async () => {
      const context = await browser.newContext({ viewport: { width: 1800, height: 1000 } });
      contexts.push(context);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("net::ERR_")) errors.push(message.text()); });
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
      return page;
    };
    const page = await open();
    await page.locator("#titleInput").fill("画像比較の調査レポート（検証用）");
    await page.locator("#editor").fill("# 画像比較\n\n調査資料の形状と配置を比較する。\n\n根拠: ");
    await page.locator("#manageSourcesBtn").click();
    await page.locator('#sourceForm [name="title"]').fill("検証用の共通出典");
    await page.locator('#sourceForm [name="url"]').fill("https://example.org/reference");
    await page.locator('#sourceForm button[type="submit"]').first().click();
    await page.locator("#sourceList").getByText("引用を挿入").click();
    await page.locator("#preview .citation-link").waitFor();
    const sourceBefore = await page.evaluate(() => parseSourceDocument(editor.value).sources);
    // Deliberately different ratios exercise containment instead of cropping.
    const payloads = await page.evaluate(() => [
      [640, 240, "#c8dbe6", "A / 640 x 240"], [240, 640, "#d3e2cc", "B / 240 x 640"]
    ].map(([width, height, color, title]) => {
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "#526575"; ctx.lineWidth = 5; ctx.strokeRect(20, 20, width - 40, height - 40);
      ctx.fillStyle = "#293d4e"; ctx.font = "20px sans-serif"; ctx.fillText(title, 35, 60);
      return canvas.toDataURL("image/png").split(",")[1];
    }));
    const imageA = { name: "図A.png", mimeType: "image/png", buffer: Buffer.from(payloads[0], "base64") };
    const imageB = { name: "図B.png", mimeType: "image/png", buffer: Buffer.from(payloads[1], "base64") };
    await page.locator("#insertImageBlockBtn").click();
    await page.locator("#imageBlockInput").setInputFiles(imageA);
    await page.locator(".image-block").waitFor();
    const legacy = await saved(page);
    assert.doesNotMatch(legacy.body, /image-mode|image-label/);
    let panel = await comparisonEditor(page);
    assert.equal(await panel.getByLabel("表示モード").locator('option[value="comparison"]').evaluate((option) => option.disabled), true);
    assert.match(await panel.innerText(), /2枚の画像が必要/);
    await panel.getByLabel("画像1の比較ラベル").fill("キャンセルするラベル");
    await panel.getByLabel("比較全体の説明", { exact: false }).fill("キャンセルする説明");
    await panel.getByText("キャンセル", { exact: true }).click();
    assert.deepEqual(await saved(page), legacy, "cancel changes no saved state or history");
    await menu(page, ".image-block-add");
    await page.locator("#imageBlockInput").setInputFiles(imageB);
    await waitImages(page);
    for (let index = 0; index < 2; index += 1) {
      await page.locator(".image-block").hover();
      await page.locator(".image-block-menu-toggle").click();
      await page.locator(".image-block-edit-figure").nth(index).click();
      const figure = page.locator(".figure-metadata-editor");
      await figure.getByLabel("キャプション", { exact: true }).fill(`図${index + 1}の資料キャプション`);
      await figure.getByLabel("年代・時期").fill(index ? "2026年" : "2020年");
      await figure.getByLabel("資料名", { exact: true }).fill(`個別資料${index + 1}`);
      await figure.getByLabel("出典URL").fill(`https://example.org/${"long-path/".repeat(45)}${index}`);
      await figure.getByLabel("資料種別").selectOption("primary");
      await figure.getByLabel("権利・ライセンス").fill("検証用図");
      await figure.getByLabel("補足", { exact: true }).fill("資料の補足\n<script>危険文字</script>");
      await figure.getByText("資料情報を保存").click();
      await page.locator(".figure-metadata-main").getByText(`図${index + 1}の資料キャプション`, { exact: true }).waitFor();
    }
    const before = await saved(page);
    const figuresBefore = (await block(page)).images.map((image) => image.figureMetadata);
    const labels = ["変更前 <script>alert(1)</script> & \" ' [A] 😀", "変更後 " + "長い比較ラベル".repeat(30)];
    const description = "**比較全体の説明**\n" + "縦横比を保持した比較。".repeat(30) + "\n<script>alert(2)</script>";
    panel = await comparisonEditor(page);
    await panel.getByLabel("表示モード").selectOption("comparison");
    await panel.getByLabel("画像1の比較ラベル").fill(labels[0]);
    await panel.getByLabel("画像2の比較ラベル").fill(labels[1]);
    await panel.getByLabel("比較全体の説明", { exact: false }).fill(description);
    await panel.getByText("比較設定を保存").click();
    await page.locator(".image-comparison").waitFor();
    const comparison = await saved(page);
    assert.equal(comparison.body, comparison.stored);
    assert.equal(comparison.undo, before.undo + 1);
    assert.ok(comparison.revision > before.revision);
    assert.deepEqual((await block(page)).images.map((image) => image.figureMetadata), figuresBefore);
    assert.deepEqual(await page.locator(".image-comparison-label").allTextContents(), labels);
    assert.equal(await page.locator(".image-block script").count(), 0);
    panel = await comparisonEditor(page);
    await panel.getByText("比較設定を保存").click();
    assert.equal(await page.locator(".image-comparison-editor").count(), 0, "unchanged save closes editing");
    assert.deepEqual(await saved(page), comparison, "unchanged save adds no revision or history");
    await page.locator("#undoBtn").click();
    assert.equal((await saved(page)).body, before.body);
    await page.locator("#redoBtn").click();
    assert.equal((await saved(page)).body, comparison.body);
    const beforeCancel = await saved(page);
    panel = await comparisonEditor(page);
    await panel.getByLabel("表示モード").selectOption("normal");
    await panel.getByLabel("画像1の比較ラベル").fill("未保存");
    await panel.getByText("キャンセル", { exact: true }).click();
    assert.deepEqual(await saved(page), beforeCancel, "cancel changes no saved state or history");
    assert.equal((await block(page)).images[0].comparisonLabel, labels[0]);
    const id = await page.evaluate(() => currentId);
    await page.reload();
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await page.locator(".image-comparison").waitFor();
    assert.equal((await saved(page)).body, comparison.body);
    const items = await layout(page, false);
    assert.deepEqual(items.map((item) => item.label), labels);
    const screenshotDir = path.join(root, "e2e-artifacts");
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.locator(".image-block").screenshot({ path: path.join(screenshotDir, "comparison-stress-pc.png") });
    const reportBefore = await saved(page);
    await page.locator("#reportPreviewBtn").click();
    assert.equal(await page.locator(".image-block-edit-comparison").isVisible(), false);
    await layout(page, false);
    await page.locator(".figure-metadata summary").first().click();
    assert.match(await page.locator(".figure-metadata details").first().innerText(), /検証用図/);
    assert.match(await page.locator(".figure-metadata a").first().getAttribute("href"), /^https:/);
    await page.locator(".image-block-open").first().click();
    await page.locator("#imagePreviewDialog").waitFor({ state: "visible" });
    await page.locator("#closeImagePreviewBtn").click();
    await page.setViewportSize({ width: 320, height: 844 });
    const mobileItems = await layout(page, true);
    assert.deepEqual(mobileItems.map((item) => item.id), items.map((item) => item.id));
    assert.deepEqual(mobileItems.map((item) => item.label), labels);
    await page.locator(".image-block").screenshot({ path: path.join(screenshotDir, "comparison-stress-320.png") });
    await page.locator("#reportPreviewBackBtn").click();
    await layout(page, true);
    assert.deepEqual(await saved(page), reportBefore, "report viewing never changes saved state or undo");
    await page.setViewportSize({ width: 1800, height: 1000 });
    // Review screenshots use short labels so both images can be assessed together.
    await page.setViewportSize({ width: 1800, height: 1400 });
    panel = await comparisonEditor(page);
    await panel.getByLabel("画像1の比較ラベル").fill("変更前（2020年）");
    await panel.getByLabel("画像2の比較ラベル").fill("変更後（2026年）");
    await panel.getByLabel("比較全体の説明", { exact: false }).fill("横長と縦長の資料を、元の縦横比を保って比較する。画像ごとの資料情報と比較全体の説明を併記できる。");
    await panel.getByText("比較設定を保存").click();
    await saved(page);
    await layout(page, false);
    await screenshotBlock(page, path.join(screenshotDir, "comparison-pc.png"));
    await page.locator("#reportPreviewBtn").click();
    await layout(page, false);
    await page.screenshot({ path: path.join(screenshotDir, "comparison-report-pc.png"), fullPage: true });
    await page.setViewportSize({ width: 320, height: 1200 });
    await layout(page, true);
    await screenshotBlock(page, path.join(screenshotDir, "comparison-report-320.png"));
    await page.locator("#reportPreviewBackBtn").click();
    await page.setViewportSize({ width: 320, height: 2000 });
    await layout(page, true);
    await screenshotBlock(page, path.join(screenshotDir, "comparison-preview-320.png"));
    await page.setViewportSize({ width: 1800, height: 1000 });
    await page.locator("#undoBtn").click();
    assert.equal((await saved(page)).body, comparison.body);
    // Empty labels and description create no placeholder text or extra caption.
    panel = await comparisonEditor(page);
    await panel.getByLabel("画像1の比較ラベル").fill("");
    await panel.getByLabel("画像2の比較ラベル").fill("");
    await panel.getByLabel("比較全体の説明", { exact: false }).fill("");
    await panel.getByText("比較設定を保存").click();
    await page.waitForFunction(() => !document.querySelector(".image-comparison-label, .image-block-caption"));
    await page.setViewportSize({ width: 320, height: 844 });
    await layout(page, true);
    await page.locator("#closeCardPaneBtn").click();
    if (await page.locator("#contextPanel").getAttribute("aria-hidden") === "false")
      await page.locator("#closeContextPanelBtn").click();
    await page.locator("#mobileAppMenu summary").click();
    await page.locator("#reportPreviewMobileBtn").click();
    await layout(page, true);
    assert.equal(await page.locator(".image-comparison-label, .image-block-caption").count(), 0);
    await page.locator("#reportPreviewBackBtn").click();
    assert.doesNotMatch((await saved(page)).body, /image-label|image-caption/);
    await page.setViewportSize({ width: 1800, height: 1000 });
    await page.locator("#undoBtn").click();
    await page.locator(".image-comparison-label").first().waitFor();
    // Normal mode retains the hidden comparison data.
    panel = await comparisonEditor(page);
    await panel.getByLabel("表示モード").selectOption("normal");
    await panel.getByText("比較設定を保存").click();
    await page.waitForFunction(() => !document.querySelector(".image-comparison"));
    assert.deepEqual((await block(page)).images.map((image) => image.comparisonLabel), labels);
    assert.equal((await block(page)).caption, description);
    panel = await comparisonEditor(page);
    await panel.getByLabel("表示モード").selectOption("comparison");
    await panel.getByText("比較設定を保存").click();
    await page.locator(".image-comparison").waitFor();
    await menu(page, ".image-block-swap");
    await page.waitForFunction((label) => document.querySelector(".image-comparison-label")?.textContent === label, labels[1]);
    assert.deepEqual((await block(page)).images.map((image) => image.comparisonLabel), [...labels].reverse());
    assert.deepEqual((await block(page)).images.map((image) => image.figureMetadata), [...figuresBefore].reverse());
    page.once("dialog", (dialog) => dialog.accept());
    await menu(page, ".image-block-remove");
    await page.waitForFunction(() => !document.querySelector(".image-comparison"));
    assert.match(await page.locator("#attachmentStatus").innerText(), /通常表示に戻しました/);
    assert.equal((await block(page)).images[0].comparisonLabel, labels[0]);
    assert.deepEqual((await block(page)).images[0].figureMetadata, figuresBefore[0]);
    assert.equal((await block(page)).caption, description);
    await menu(page, ".image-block-add");
    await page.locator("#imageBlockInput").setInputFiles(imageB);
    await waitImages(page);
    panel = await comparisonEditor(page);
    assert.equal(await panel.getByLabel("表示モード").locator('option[value="comparison"]').evaluate((option) => option.disabled), false);
    assert.equal(await panel.getByLabel("画像1の比較ラベル").inputValue(), labels[0]);
    assert.equal(await panel.getByLabel("画像2の比較ラベル").inputValue(), "");
    await panel.getByText("キャンセル", { exact: true }).click();
    await page.locator("#undoBtn").click(); // undo addition
    await saved(page);
    await page.locator("#undoBtn").click(); // undo removal restores comparison and both figures
    await page.locator(".image-comparison").waitFor();
    assert.deepEqual((await block(page)).images.map((image) => image.figureMetadata), [...figuresBefore].reverse());
    const expected = await block(page);
    assert.deepEqual(await page.evaluate(() => parseSourceDocument(editor.value).sources), sourceBefore);
    const markdownZip = await download(page, async () => {
      await page.locator("#noteExportBtn").click();
      await page.locator("#downloadExportBtn").click();
    });
    const backupZip = await download(page, () => page.locator("#backupBtn").click());
    const manifest = await page.evaluate((bytes) => JSON.parse(new TextDecoder().decode(parseStoredZipEntries(Uint8Array.from(bytes)).find((entry) => entry.name === "manifest.json").data)), [...backupZip]);
    assert.equal(manifest.version, 5);
    assert.equal(manifest.formatVersion, 5);
    for (const [name, buffer] of [["markdown", markdownZip], ["backup", backupZip]]) {
      const restored = await open();
      await restored.locator("#importMarkdownZipInput").setInputFiles({ name: `${name}.zip`, mimeType: "application/zip", buffer });
      if (name === "backup") {
        await restored.locator("#backupPreviewDialog").waitFor({ state: "visible" });
        await restored.locator("#confirmBackupPreviewBtn").click();
        await restored.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();
        await restored.locator("#cancelBackupPreviewBtn").click();
        await restored.evaluate((noteId) => openNote(noteId), id);
      }
      await restored.locator(".image-comparison").waitFor();
      const result = await block(restored);
      assert.equal(result.displayMode, "comparison");
      assert.equal(result.caption, expected.caption);
      assert.deepEqual(result.images.map(({ comparisonLabel, figureMetadata }) => ({ comparisonLabel, figureMetadata })), expected.images.map(({ comparisonLabel, figureMetadata }) => ({ comparisonLabel, figureMetadata })));
      const refs = await restored.evaluate(async () => ({ sources: parseSourceDocument(editor.value).sources,
        citations: extractCitations(editor.value), attachments: (await getAttachmentsForMemo(currentId)).map((image) => image.id) }));
      assert.deepEqual(refs.sources, sourceBefore);
      assert.equal(refs.citations.length, 1);
      assert.ok(result.images.every((image) => refs.attachments.includes(image.id)));
      await saved(restored);
      await restored.reload();
      await restored.locator("#appStartupGuard").waitFor({ state: "hidden" });
      await restored.locator(".image-comparison").waitFor();
    }
    // Malformed settings are tested through the real editor and saved body.
    const corrupt = (await saved(page)).body.replace("image-mode:comparison", "image-mode:future").replace(/image-label:[0-9a-f]+/, "image-label:not-hex");
    await page.locator("#editor").fill(corrupt);
    await page.waitForFunction(() => !document.querySelector(".image-comparison"));
    const corruptBlock = await block(page);
    assert.equal(corruptBlock.images.length, 2);
    assert.deepEqual(corruptBlock.images.map((image) => image.figureMetadata), expected.images.map((image) => image.figureMetadata));
    assert.equal((await saved(page)).stored, corrupt, "reading invalid settings does not rewrite the saved body");
    assert.equal(await page.locator("#preview .citation-link").count(), 1);
    assert.deepEqual(errors, []);
    process.stdout.write("Comparison E2E: PASS (PC / 320px / Report / Undo / reload / both ZIP restores)\n");
  } finally {
    for (const context of contexts) await context.close();
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
