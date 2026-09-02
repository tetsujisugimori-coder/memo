"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const playwright = require("playwright");

let appUrl = process.env.MEMO_NEXUS_E2E_URL || "";
const browserName = process.env.MEMO_NEXUS_E2E_BROWSER || "chromium";
const screenshotPath = path.join(__dirname, "e2e-artifacts", "mobile-layout-390.png");

async function startStaticServer() {
  if (appUrl) return null;
  const root = __dirname;
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
        return;
      }
      const extension = path.extname(filePath);
      const contentType = extension === ".html" ? "text/html; charset=utf-8"
        : extension === ".css" ? "text/css; charset=utf-8"
          : extension === ".js" ? "application/javascript; charset=utf-8" : "application/octet-stream";
      response.writeHead(200, { "Content-Type": contentType });
      response.end(body);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  appUrl = `http://127.0.0.1:${server.address().port}/`;
  return server;
}

async function launchBrowser() {
  const browserType = playwright[browserName];
  if (!browserType) throw new Error(`Unsupported browser: ${browserName}`);
  try {
    return await browserType.launch({ headless: true });
  } catch (error) {
    if (browserName !== "chromium") throw error;
    const executablePath = path.join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium_headless_shell-1194", "chrome-win", "headless_shell.exe");
    if (!fs.existsSync(executablePath)) throw error;
    return browserType.launch({ headless: true, executablePath });
  }
}

async function waitForApp(page) {
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("#appStartupGuard").waitFor({ state: "hidden", timeout: 30000 });
  await page.locator("#editor").waitFor({ state: "visible" });
  const contextPanel = page.locator("#contextPanel");
  if (await contextPanel.getAttribute("aria-hidden") === "false") {
    await page.locator("#closeContextPanelBtn").click();
    await page.waitForFunction(() => {
      const panel = document.getElementById("contextPanel");
      const style = getComputedStyle(panel);
      return panel.getAttribute("aria-hidden") === "true" && (style.display === "none" || style.visibility === "hidden");
    });
    await page.waitForTimeout(250);
  }
}

async function readLayoutMetrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        display: getComputedStyle(element).display,
        visibility: getComputedStyle(element).visibility
      };
    };
    const overlapArea = (first, second) => {
      if (first.display === "none" || second.display === "none") return 0;
      const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
      const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      return width * height;
    };
    const header = rect(".app-header");
    const logo = rect("#memoNexusLogo");
    const editor = rect("#editor");
    const related = rect("#relatedToggleBtn");
    const robot = rect("#aiRobotBtn");
    const toolbar = document.querySelector(".app-header .toolbar");
    const toolbarControls = [...toolbar.querySelectorAll(":scope > button, :scope > details > summary")]
      .filter((element) => getComputedStyle(element).display !== "none")
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { id: element.id || element.textContent.trim(), left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      layoutMode: document.body.dataset.layoutMode,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      header,
      logo,
      toolbar: rect(".app-header .toolbar"),
      toolbarControls,
      title: rect(".title-row"),
      meta: rect(".note-meta-bar"),
      editor,
      related,
      robot,
      contextPanel: {
        ...rect("#contextPanel"),
        ariaHidden: document.getElementById("contextPanel").getAttribute("aria-hidden")
      },
      relatedEditorOverlap: overlapArea(editor, related),
      robotEditorOverlap: overlapArea(editor, robot),
      mobileWritingMode: document.body.classList.contains("mobile-writing-mode")
    };
  });
}

function assertInsideViewport(rect, viewport, message) {
  assert.ok(rect.left >= -0.5, `${message}: left=${rect.left}`);
  assert.ok(rect.right <= viewport.width + 0.5, `${message}: right=${rect.right}, viewport=${viewport.width}`);
}

async function assertMobileLayout(page, width, { mobileDevice }) {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForFunction(() => document.body.dataset.layoutMode === "mobile");
  const metrics = await readLayoutMetrics(page);

  assert.equal(metrics.documentOverflow, 0, `${width}pxでdocument横スクロールなし`);
  assert.equal(metrics.bodyOverflow, 0, `${width}pxでbody横スクロールなし`);
  assert.equal(metrics.mobileWritingMode, false, `${width}pxでフォーカス前は通常モバイル表示`);
  assertInsideViewport(metrics.logo, metrics.viewport, `${width}pxでアプリタイトルが画面内`);
  for (const control of metrics.toolbarControls) {
    assertInsideViewport(control, metrics.viewport, `${width}pxで主要操作 ${control.id} が画面内`);
  }
  for (let index = 1; index < metrics.toolbarControls.length; index += 1) {
    assert.ok(
      metrics.toolbarControls[index].left >= metrics.toolbarControls[index - 1].right - 0.5,
      `${width}pxで主要操作同士を重ねない: ${metrics.toolbarControls[index - 1].id}/${metrics.toolbarControls[index].id}`
    );
  }
  assert.ok(metrics.header.height <= 112, `${width}pxでヘッダーを2段以内へ抑える: ${metrics.header.height}px`);
  assert.ok(metrics.title.height <= 150, `${width}pxでタイトル・タグ・日時をコンパクトにする: ${metrics.title.height}px`);
  assert.ok(metrics.meta.height <= 46, `${width}pxで保存表示を1段へ抑える: ${metrics.meta.height}px`);
  assert.ok(metrics.editor.height >= 360, `${width}pxで本文に実用的な高さを確保: ${metrics.editor.height}px`);
  assert.equal(metrics.relatedEditorOverlap, 0, `${width}pxで関連メモを本文へ重ねない`);
  assert.equal(metrics.robotEditorOverlap, 0, `${width}pxでNEX-2を本文へ重ねない`);
  assert.equal(metrics.contextPanel.ariaHidden, "true", `${width}pxで閉じた右パネルを支援技術上も収納`);
  assert.equal(metrics.contextPanel.visibility, "hidden", `${width}pxで閉じた右パネルを画面外へ収納`);

  if (width === 390 && mobileDevice) {
    await page.waitForFunction(() => !document.querySelector("#memoNexusLogo")?.classList.contains("is-animating"), null, { timeout: 10000 });
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const menu = page.locator("#mobileAppMenu");
    assert.equal(await menu.evaluate((element) => element.open), false, "390pxで補助操作を初期収納");
    await menu.locator("summary").click();
    const panel = await menu.locator(".mobile-app-menu-panel").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
    assert.ok(panel.left >= 0 && panel.right <= panel.viewportWidth && panel.top >= 0 && panel.bottom <= panel.viewportHeight, "390pxで補助操作メニューがviewport内");
    await menu.locator("#settingsBtn").click();
    await page.locator("#settingsDialog").waitFor({ state: "visible" });
    assert.equal(await menu.evaluate((element) => element.open), false, "補助操作を選ぶとメニューを閉じる");
    await page.locator("#closeSettingsBtn").click();
  }
  return metrics;
}

(async () => {
  const server = await startStaticServer();
  const browser = await launchBrowser();
  const pageErrors = [];
  const consoleErrors = [];
  const results = {};
  try {
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const mobilePage = await mobileContext.newPage();
    mobilePage.on("pageerror", (error) => pageErrors.push(error.message));
    mobilePage.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await waitForApp(mobilePage);
    results.mobile390 = await assertMobileLayout(mobilePage, 390, { mobileDevice: true });
    results.mobile430 = await assertMobileLayout(mobilePage, 430, { mobileDevice: true });
    await mobileContext.close();

    const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const desktopPage = await desktopContext.newPage();
    desktopPage.on("pageerror", (error) => pageErrors.push(error.message));
    desktopPage.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await waitForApp(desktopPage);

    await desktopPage.setViewportSize({ width: 820, height: 1024 });
    await desktopPage.waitForFunction(() => document.body.dataset.layoutMode === "compact");
    results.tablet = await readLayoutMetrics(desktopPage);
    assert.equal(results.tablet.documentOverflow, 0, "タブレット相当で横スクロールなし");
    assert.ok(
      results.tablet.editor.height >= 400,
      `タブレット相当で本文高さを確保: ${JSON.stringify({ header: results.tablet.header.height, title: results.tablet.title.height, editorTop: results.tablet.editor.top, editorHeight: results.tablet.editor.height })}`
    );

    results.narrowDesktop = await assertMobileLayout(desktopPage, 390, { mobileDevice: false });

    await desktopPage.setViewportSize({ width: 1280, height: 900 });
    await desktopPage.waitForFunction(() => document.body.dataset.layoutMode === "wide");
    results.desktop = await readLayoutMetrics(desktopPage);
    const preview = await desktopPage.locator("#previewCard").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width, display: getComputedStyle(element).display };
    });
    assert.equal(results.desktop.documentOverflow, 0, "デスクトップで横スクロールなし");
    assert.ok(results.desktop.editor.right < preview.left, "デスクトップの本文とカードを別列に維持");
    for (const id of ["undoBtn", "backupBtn", "linkStatsBtn", "graphBtn", "settingsBtn", "deleteBtn"]) {
      assert.equal(await desktopPage.locator(`#${id}`).isVisible(), true, `デスクトップで${id}を従来どおり表示`);
    }
    assert.notEqual(await desktopPage.locator("#editorCardSeparator").evaluate((element) => getComputedStyle(element).display), "none", "デスクトップの列リサイズ境界を維持");
    assert.equal(results.desktop.header.height <= 66, true, `デスクトップヘッダーの高さを維持: ${results.desktop.header.height}px`);

    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    console.log(JSON.stringify({ browser: browserName, results, pageErrors, consoleErrors, screenshot: screenshotPath }, null, 2));
  } finally {
    await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
