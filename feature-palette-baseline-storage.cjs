"use strict";

// Baseline-only control for the browser profile used by attachment E2E tests.
// No application storage code is replaced and no palette assertion is optional.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { webkit } = require("playwright");
const root = path.resolve(process.argv[2]);
const output = path.resolve(process.env.MEMO_PALETTE_OUTPUT || "e2e-artifacts/feature-palette/webkit");
fs.mkdirSync(output, { recursive: true });

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(root, pathname === "/" ? "index.html" : pathname.slice(1));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, body) => {
      if (error) return res.writeHead(404).end();
      res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
      res.end(body);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await webkit.launch({ headless: true });
  const result = { baseSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    browser: browser.version(), playwright: require("playwright/package.json").version, contexts: [] };
  try {
    for (const mode of ["ephemeral", "persistent"]) {
      const profile = mode === "persistent" ? fs.mkdtempSync(path.join(os.tmpdir(), "memo-palette-control-")) : null;
      let context;
      try {
        context = profile ? await webkit.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 800 } })
          : await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await context.route("https://cdn.jsdelivr.net/**", route => route.fulfill({ body: "", contentType: route.request().url().endsWith(".css") ? "text/css" : "application/javascript" }));
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
        await page.evaluate(() => {
          window.baselineIdbErrors = [];
          for (const type of ["error", "abort"]) db.addEventListener(type, event => {
            const error = event.target.error;
            if (error) window.baselineIdbErrors.push({ name: error.name, message: error.message, event: type });
          }, true);
        });
        await page.evaluate(() => setContextPanelOpen(false, { restoreFocus: false }));
        await page.locator("#editor").fill("alpha beta gamma");
        await page.evaluate(async () => { await saveCurrentNote(); editor.setSelectionRange(6, 10); });
        await page.locator("#manageSourcesBtn").click();
        await page.locator('#sourceForm [name="title"]').fill("Palette source fixture");
        await page.locator('#sourceForm [name="url"]').fill("https://example.org/palette-fixture");
        await page.locator('#sourceForm button[type="submit"]').first().click();
        await page.locator("#sourceList").getByText("引用を挿入").click();
        await page.locator("#sourceDialog").waitFor({ state: "hidden" });
        const sources = await page.evaluate(() => parseSourceDocument(editor.value).sources);
        assert.equal(sources.length, 1);
        const chooser = page.waitForEvent("filechooser");
        await page.locator("#insertImageBlockBtn").focus();
        await page.keyboard.press("Enter");
        const picker = await chooser;
        const png = await page.evaluate(() => {
          const canvas = document.createElement("canvas"); canvas.width = 20; canvas.height = 20;
          const ctx = canvas.getContext("2d"); ctx.fillStyle = "#336699"; ctx.fillRect(0, 0, 20, 20);
          return canvas.toDataURL("image/png").split(",")[1];
        });
        await picker.setFiles({ name: "palette-source.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
        await page.waitForFunction(() => !pendingAttachmentAdditions.has(currentId)
          && (attachmentStatus.classList.contains("error") || currentAttachments.length === 1));
        const observed = await page.evaluate(async () => ({
          count: (await getAttachmentsForMemo(currentId)).length, status: attachmentStatus.textContent,
          error: attachmentStatus.classList.contains("error"), idbErrors: window.baselineIdbErrors,
          sources: parseSourceDocument(editor.value).sources
        }));
        assert.deepEqual(observed.sources, sources, "baseline image path must preserve source metadata");
        delete observed.sources;
        result.contexts.push({ mode, ...observed });
        // The ephemeral result is diagnostic. Ordinary-profile storage is mandatory.
        if (mode === "persistent") {
          assert.equal(observed.error, false, JSON.stringify(observed));
          assert.equal(observed.count, 1, "baseline ordinary profile saves the real image Blob");
          await page.locator("#preview .image-block").waitFor();
          await page.waitForFunction(() => !noteSaveFoundation.isDirty(currentId));
          await page.reload();
          await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
          await page.locator("#preview .image-block").waitFor();
          assert.equal(await page.evaluate(async () => (await getAttachmentsForMemo(currentId)).length), 1);
          assert.deepEqual(await page.evaluate(() => parseSourceDocument(editor.value).sources), sources);
        }
      } finally {
        await context?.close();
        if (profile) fs.rmSync(profile, { recursive: true, force: true });
      }
    }
    console.log(JSON.stringify(result));
  } finally {
    fs.writeFileSync(path.join(output, "baseline-attachment-control.json"), JSON.stringify(result, null, 2));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
