"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const playwright = require("playwright");

const image = fs.readFileSync(path.join(__dirname, "e2e-artifacts", "chart-png-example-light-390.png"));
const expected = {
  caption: "武田信玄像 <図>", dateLabel: "永禄12年", sourceName: "山梨県立博物館",
  sourceUrl: `https://example.org/archive?item=${"a".repeat(500)}`, sourceType: "primary",
  license: "CC BY 4.0", note: "一行目\n二行目 & <補足>"
};

async function openApp(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
  return { context, page, errors };
}

async function openFigureEditor(page) {
  await page.locator(".image-block").hover();
  await page.locator(".image-block-menu-toggle").click();
  await page.locator(".image-block-edit-figure").first().click();
  return page.locator(".figure-metadata-editor");
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
    browser = await playwright[process.env.MEMO_NEXUS_E2E_BROWSER || "chromium"].launch({ headless: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const first = await openApp(browser, origin);
    const { page } = first;
    await page.locator("#insertImageBlockBtn").click();
    await page.locator("#imageBlockInput").setInputFiles({ name: "figure.png", mimeType: "image/png", buffer: image });
    await page.locator(".image-block").waitFor({ timeout: 8000 }).catch(async (error) => {
      console.error(await page.evaluate(() => ({ currentId, body: editor.value, attachmentStatus: document.querySelector("#attachmentStatus")?.textContent, pendingImageInsertTarget, errors: window.onerror })));
      throw error;
    });
    assert.equal(await page.locator(".figure-metadata").count(), 0, "legacy image presentation stays unchanged");
    let panel = await openFigureEditor(page);
    for (const [label, value] of [["キャプション", expected.caption], ["年代・時期", expected.dateLabel], ["資料名", expected.sourceName],
      ["出典URL", expected.sourceUrl], ["権利・ライセンス", expected.license], ["補足", expected.note]])
      await panel.getByLabel(label).fill(value);
    await panel.getByLabel("資料種別").selectOption(expected.sourceType);
    await panel.getByText("資料情報を保存").click();
    await page.locator(".figure-metadata-main").getByText(expected.caption).waitFor();
    await page.waitForFunction(async () => {
      const note = (await getStoredNotes()).find((item) => item.id === currentId);
      return note && splitImageBlocks(note.body).some((block) => block.type === "image" && block.images[0].figureMetadata?.caption === "武田信玄像 <図>");
    });
    const noteId = await page.evaluate(() => currentId);
    await page.reload();
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await page.locator(".figure-metadata-main").getByText(expected.caption).waitFor();
    assert.deepEqual(await page.evaluate(() => splitImageBlocks(editor.value).find((block) => block.type === "image").images[0].figureMetadata), expected);
    await page.locator(".figure-metadata summary").click();
    assert.match(await page.locator(".figure-metadata details").innerText(), /CC BY 4\.0/);
    assert.equal(await page.locator(".figure-metadata a").getAttribute("href"), expected.sourceUrl);

    panel = await openFigureEditor(page);
    await panel.getByLabel("出典URL").fill("javascript:alert(1)");
    await panel.getByText("資料情報を保存").click();
    await page.locator(".figure-metadata details").getByText("javascript:alert(1)").waitFor({ state: "attached" });
    assert.equal(await page.locator(".figure-metadata a").count(), 0, "unsafe URL is text only");
    assert.equal(await page.locator(".figure-metadata script").count(), 0, "metadata is escaped");
    panel = await openFigureEditor(page);
    assert.equal(await panel.getByLabel("出典URL").inputValue(), "javascript:alert(1)");
    await panel.getByLabel("出典URL").fill(expected.sourceUrl);
    await panel.getByText("キャンセル").click();
    assert.equal(await page.locator(".figure-metadata a").count(), 0, "cancel keeps stored value");
    panel = await openFigureEditor(page);
    await panel.getByLabel("出典URL").fill(expected.sourceUrl);
    await panel.getByText("資料情報を保存").click();
    await page.waitForFunction(async () => {
      const note = (await getStoredNotes()).find((item) => item.id === currentId);
      return splitImageBlocks(note?.body).some((block) => block.type === "image" && block.images[0].figureMetadata?.sourceUrl?.startsWith("https:"));
    });

    const files = await page.evaluate(async () => {
      await flushSave();
      return (await buildPortableBackupZipFiles()).map((file) => ({ name: file.name, content: file.content instanceof Blob ? null : file.content }));
    });
    assert.ok(files.some((file) => file.name.startsWith("assets/")));
    const backup = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await makeZip(await buildPortableBackupZipFiles())).arrayBuffer()))));
    const parsed = await page.evaluate((bytes) => parseStoredZipEntries(Uint8Array.from(bytes)).map((entry) => entry.name), [...backup]);
    assert.ok(parsed.some((name) => name.startsWith("notes/")));
    assert.ok(parsed.some((name) => name.startsWith("assets/")));

    const second = await openApp(browser, origin);
    await second.page.locator("#importMarkdownZipInput").setInputFiles({ name: "figure-backup.zip", mimeType: "application/zip", buffer: backup });
    await second.page.locator("#backupPreviewDialog").waitFor({ state: "visible" });
    await second.page.locator("#confirmBackupPreviewBtn").click();
    await second.page.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();
    const restored = await second.page.evaluate(async (id) => {
      const note = (await getStoredNotes()).find((item) => item.id === id);
      return { metadata: splitImageBlocks(note.body).find((block) => block.type === "image").images[0].figureMetadata,
        attachments: (await getAttachmentsForMemo(id)).length };
    }, noteId);
    assert.deepEqual(restored.metadata, expected);
    assert.equal(restored.attachments, 1);

    const oldBackup = Buffer.from(await page.evaluate(async (id) => {
      const files = await buildPortableBackupZipFiles();
      const markdown = files.find((file) => file.name.startsWith("notes/") && String(file.content).includes(`memoNexusId: "${id}"`));
      if (!markdown) throw new Error("note markdown missing");
      markdown.content = String(markdown.content).replace(/^<!-- memo-nexus:figure-metadata:[0-9a-f]+ -->\r?\n/gm, "");
      const manifest = files.find((file) => file.name === "manifest.json");
      const parsed = JSON.parse(manifest.content);
      parsed.version = 1;
      manifest.content = JSON.stringify(parsed);
      return Array.from(new Uint8Array(await (await makeZip(files)).arrayBuffer()));
    }, noteId));
    const third = await openApp(browser, origin);
    await third.page.locator("#importMarkdownZipInput").setInputFiles({ name: "old-backup.zip", mimeType: "application/zip", buffer: oldBackup });
    await third.page.locator("#backupPreviewDialog").waitFor({ state: "visible" });
    await third.page.locator("#confirmBackupPreviewBtn").click();
    await third.page.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();
    assert.equal(await third.page.evaluate(async (id) => {
      const note = (await getStoredNotes()).find((item) => item.id === id);
      return splitImageBlocks(note.body).find((block) => block.type === "image").images[0].figureMetadata;
    }, noteId), undefined);
    assert.equal(await third.page.evaluate(async (id) => (await getAttachmentsForMemo(id)).length, noteId), 1);

    await page.locator(".image-block").hover();
    await page.locator(".image-block-menu-toggle").click();
    await page.locator(".image-block-add").click();
    await page.locator("#imageBlockInput").setInputFiles({ name: "second.png", mimeType: "image/png", buffer: image });
    await page.locator(".image-block-open").nth(1).waitFor();
    await page.locator(".image-block").hover();
    await page.locator(".image-block-menu-toggle").click();
    await page.locator(".image-block-edit-figure").nth(1).click();
    panel = page.locator(".figure-metadata-editor");
    await panel.getByLabel("キャプション").fill("2枚目だけの資料");
    await panel.getByText("資料情報を保存").click();
    await page.waitForFunction(() => {
      const block = splitImageBlocks(editor.value).find((item) => item.type === "image");
      return block.images[0].figureMetadata?.caption === "武田信玄像 <図>"
        && block.images[1].figureMetadata?.caption === "2枚目だけの資料";
    });
    await page.locator(".image-block").hover();
    await page.locator(".image-block-menu-toggle").click();
    await page.locator(".image-block-swap").click();
    assert.deepEqual(await page.evaluate(() => splitImageBlocks(editor.value).find((item) => item.type === "image").images.map((item) => item.figureMetadata.caption)),
      ["2枚目だけの資料", "武田信玄像 <図>"]);
    await page.locator(".figure-metadata-main").first().getByText("2枚目だけの資料").waitFor();
    await page.locator(".image-block").hover();
    await page.locator(".image-block-menu-toggle").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(".image-block-remove").first().click();
    assert.equal(await page.evaluate(() => splitImageBlocks(editor.value).find((item) => item.type === "image").images[0].figureMetadata.caption), expected.caption);
    assert.deepEqual([...first.errors, ...second.errors, ...third.errors], []);
    await first.context.close();
    await second.context.close();
    await third.context.close();
    process.stdout.write("Figure metadata E2E: PASS\n");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
