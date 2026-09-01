"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

let appUrl = process.env.MEMO_NEXUS_E2E_URL || "";
const WIDE_WIDTHS = [1040, 1280, 1363, 1600];
const TOLERANCE = 1;

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

function assertNear(actual, expected, message, tolerance = TOLERANCE) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual}px（期待値 ${expected}px）`);
}

async function waitForMode(page, width, mode) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForFunction((expected) => document.body.dataset.layoutMode === expected, mode);
  await page.waitForTimeout(50);
}

async function waitForApp(page) {
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("#appStartupGuard").waitFor({ state: "hidden", timeout: 30000 });
  await page.locator("#editor").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector).getBoundingClientRect();
      return { left: value.left, right: value.right, width: value.width };
    };
    const workspace = rect(".workspace");
    const editor = rect(".editor-card");
    const card = rect("#previewCard");
    const contextPanel = rect("#contextPanel");
    const workspaceStyle = getComputedStyle(document.querySelector(".workspace"));
    const paddingLeft = Number.parseFloat(workspaceStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(workspaceStyle.paddingRight) || 0;
    const separatorWidth = card.left - editor.right;
    const expectedCardWidth = workspace.width - paddingLeft - paddingRight - editor.width - separatorWidth;
    return {
      viewportWidth: innerWidth,
      mode: document.body.dataset.layoutMode,
      workspaceWidth: workspace.width,
      editorWidth: editor.width,
      cardWidth: card.width,
      contextPanelWidth: contextPanel.width,
      paddingLeft,
      paddingRight,
      separatorWidth,
      expectedCardWidth,
      cardToWorkspaceRight: workspace.right - card.right,
      cardToContextPanel: contextPanel.left - card.right,
      workspaceToContextPanel: contextPanel.left - workspace.right,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
}

async function assertWideFill(page, label) {
  const metrics = await layoutMetrics(page);
  assert.equal(metrics.mode, "wide", `${label}はwide表示`);
  assertNear(metrics.workspaceToContextPanel, 0, `${label}でworkspaceと右パネルが接する`);
  assertNear(metrics.cardToWorkspaceRight, metrics.paddingRight, `${label}でカード右側は右paddingだけを残す`);
  assertNear(metrics.cardToContextPanel, metrics.paddingRight, `${label}でカードから右パネルまでは右paddingだけを残す`);
  assertNear(metrics.separatorWidth, 16, `${label}で本文とカードの間隔を維持`);
  assertNear(metrics.cardWidth, metrics.expectedCardWidth, `${label}でカードが残り幅を使い切る`);
  assert.equal(metrics.horizontalOverflow, 0, `${label}で横スクロールがない`);
  return metrics;
}

async function dragSeparatorBy(page, selector, deltaX) {
  const separator = page.locator(selector);
  const box = await separator.boundingBox();
  assert.ok(box, `${selector}の位置を取得できる`);
  const startX = box.x + box.width / 2;
  const startY = box.y + Math.min(box.height / 2, 300);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(50);
}

async function setEditorWidth(page, targetWidth) {
  const currentWidth = await page.locator(".editor-card").evaluate((element) => element.getBoundingClientRect().width);
  await dragSeparatorBy(page, "#editorCardSeparator", targetWidth - currentWidth);
}

async function setContextPanelWidth(page, targetWidth) {
  const currentWidth = await page.locator("#contextPanel").evaluate((element) => element.getBoundingClientRect().width);
  await dragSeparatorBy(page, "#contextPanelSeparator", currentWidth - targetWidth);
}

async function stubExternalAssets(context) {
  await context.route("https://cdn.jsdelivr.net/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith(".css")) {
      await route.fulfill({ contentType: "text/css", body: "" });
      return;
    }
    const body = url.includes("highlight")
      ? "window.hljs={highlightAuto:function(){return {value:''}},getLanguage:function(){return false},highlight:function(){return {value:''}}};"
      : url.includes("mermaid")
        ? "window.mermaid={initialize:function(){},render:async function(){return {svg:'<svg></svg>'}}};"
        : url.includes("katex")
          ? "window.katex={renderToString:function(value){return String(value)}};"
          : "window.math={evaluate:function(){return 0}};";
    await route.fulfill({ contentType: "application/javascript", body });
  });
}

(async () => {
  const server = await startStaticServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    const bundledExecutable = path.join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium_headless_shell-1194", "chrome-win", "headless_shell.exe");
    if (!fs.existsSync(bundledExecutable)) throw error;
    browser = await chromium.launch({ headless: true, executablePath: bundledExecutable });
  }
  const context = await browser.newContext({ viewport: { width: 1363, height: 900 } });
  await stubExternalAssets(context);
  const pageErrors = [];
  const consoleErrors = [];
  context.on("page", (openedPage) => {
    openedPage.on("pageerror", (error) => pageErrors.push(error.message));
    openedPage.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
  });
  const page = await context.newPage();
  const results = { wide: {}, contextWidths: {}, editorWidths: {} };
  try {
    await waitForApp(page);
    results.wide[1363] = await assertWideFill(page, "1363px既定幅");

    let previousDefaultEditorWidth = null;
    for (const width of WIDE_WIDTHS) {
      await page.locator("#editorCardSeparator").dblclick();
      await waitForMode(page, width, "wide");
      results.wide[width] = await assertWideFill(page, `${width}px既定幅`);
      if (previousDefaultEditorWidth !== null && width > 1040) {
        assert.ok(results.wide[width].editorWidth > previousDefaultEditorWidth, `${width}pxで本文既定幅を再計算`);
      }
      previousDefaultEditorWidth = results.wide[width].editorWidth;
    }

    await waitForMode(page, 1600, "wide");
    for (const width of [240, 340, 520]) {
      if (width === 340) await page.locator("#contextPanelSeparator").dblclick();
      else await setContextPanelWidth(page, width);
      results.contextWidths[width] = await assertWideFill(page, `右パネル${width}px`);
      assertNear(results.contextWidths[width].contextPanelWidth, width, `右パネルを${width}pxへ変更`);
    }
    await page.locator("#contextPanelSeparator").dblclick();

    const editorMinimum = Number(await page.locator("#editorCardSeparator").getAttribute("aria-valuemin"));
    const editorMaximum = Number(await page.locator("#editorCardSeparator").getAttribute("aria-valuemax"));
    await page.locator("#editorCardSeparator").dblclick();
    const editorDefault = await page.locator(".editor-card").evaluate((element) => element.getBoundingClientRect().width);
    const editorTargets = [
      ["minimum", editorMinimum],
      ["default", editorDefault],
      ["middle", (editorMinimum + editorMaximum) / 2],
      ["maximum", editorMaximum]
    ];
    for (const [name, width] of editorTargets) {
      if (name === "default") await page.locator("#editorCardSeparator").dblclick();
      else await setEditorWidth(page, width);
      results.editorWidths[name] = await assertWideFill(page, `本文${name}`);
      assertNear(results.editorWidths[name].editorWidth, width, `本文を${name}幅へ変更`);
    }

    await setEditorWidth(page, (editorMinimum + editorMaximum) / 2);
    await setContextPanelWidth(page, 520);
    const beforeReload = await assertWideFill(page, "再読み込み前");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden", timeout: 30000 });
    await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
    const afterReload = await assertWideFill(page, "再読み込み後");
    assertNear(afterReload.editorWidth, beforeReload.editorWidth, "本文幅を再読み込み後に復元");
    assertNear(afterReload.contextPanelWidth, beforeReload.contextPanelWidth, "右パネル幅を再読み込み後に復元");

    await page.locator("#editorCardSeparator").dblclick();
    await page.locator("#contextPanelSeparator").dblclick();
    const resetAt1600 = await assertWideFill(page, "本文・右パネル初期化後");
    await waitForMode(page, 1280, "wide");
    const resetAt1280 = await assertWideFill(page, "本文初期化後1280px");
    assert.ok(resetAt1600.editorWidth > resetAt1280.editorWidth, "editorWidth:nullは画面幅から既定比率を再計算");

    await page.locator("#closeContextPanelBtn").click();
    await page.waitForFunction(() => document.getElementById("contextPanelSeparator").tabIndex === -1);
    assert.equal(await page.locator("#contextPanelSeparator").evaluate((element) => getComputedStyle(element).display), "none");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    await page.locator("#collectionsBtn").click();
    await page.waitForFunction(() => document.getElementById("contextPanelSeparator").tabIndex === 0);
    await assertWideFill(page, "右パネル再表示後");

    await waitForMode(page, 1039, "compact");
    assert.equal(await page.locator("#editorCardSeparator").evaluate((element) => getComputedStyle(element).display), "none");
    assert.equal(await page.locator("#contextPanelSeparator").evaluate((element) => getComputedStyle(element).display), "none");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);

    await waitForMode(page, 719, "mobile");
    assert.equal(await page.locator("#editorCardSeparator").evaluate((element) => getComputedStyle(element).display), "none");
    assert.equal(await page.locator("#contextPanelSeparator").evaluate((element) => getComputedStyle(element).display), "none");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);

    await waitForMode(page, 1600, "wide");
    await assertWideFill(page, "mobileからwide復帰後");
    const popupPromise = page.waitForEvent("popup");
    await page.locator("#popoutMemoBtn").click();
    const popout = await popupPromise;
    await popout.waitForLoadState("domcontentloaded");
    await popout.locator("body.popout-window").waitFor({ timeout: 30000 });
    assert.equal(await popout.locator("#editorCardSeparator").evaluate((element) => getComputedStyle(element).display), "none");
    assert.equal(await popout.locator("#contextPanelSeparator").evaluate((element) => getComputedStyle(element).display), "none");
    assert.equal(await popout.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    await popout.close();

    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    console.log(JSON.stringify({ results, pageErrors, consoleErrors }, null, 2));
  } finally {
    await context.close();
    await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
