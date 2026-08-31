"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

let appUrl = process.env.MEMO_NEXUS_E2E_URL || "";
const MOBILE_WIDTHS = [320, 375, 390, 430];
const SCREENSHOT_PATH = path.join(process.env.TEMP || process.cwd(), "memo-nexus-mobile-writing-390.png");

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

async function waitForApp(page) {
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("#appStartupGuard").waitFor({ state: "hidden", timeout: 30000 });
  await page.locator("#editor").waitFor({ state: "visible" });
}

async function closeMobileContextPanel(page) {
  const panel = page.locator("#contextPanel");
  if (await panel.getAttribute("aria-hidden") === "false") {
    await page.locator("#closeContextPanelBtn").click();
    await page.waitForFunction(() => document.getElementById("contextPanel").getAttribute("aria-hidden") === "true");
  }
}

async function mobileMetrics(page, width, height = 760) {
  await page.setViewportSize({ width, height });
  await page.waitForFunction(() => document.body.dataset.layoutMode === "mobile");
  const normalEditorHeight = await page.locator("#editor").evaluate((element) => element.getBoundingClientRect().height);
  const normalEditorToolsHidden = await page.locator(".editor-tools").evaluate((element) => getComputedStyle(element).display === "none");
  assert.equal(normalEditorToolsHidden, true, `${width}pxでフォーカス前から既存ツール欄を非表示`);
  const normalContextHidden = await page.locator("#contextPanel").getAttribute("aria-hidden");
  await page.locator("#editor").click();
  await page.locator("body.mobile-writing-mode").waitFor();
  await page.waitForFunction(() => getComputedStyle(document.getElementById("contextPanel")).visibility === "hidden");
  const metrics = await page.evaluate(() => {
    const toolbar = document.getElementById("mobileWritingTools");
    const controls = [...toolbar.children].map((child) => child.matches("details") ? child.querySelector("summary") : child);
    const controlRects = controls.map((control) => control.getBoundingClientRect());
    const editorRect = document.getElementById("editor").getBoundingClientRect();
    return {
      bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      toolbarRows: new Set(controlRects.map((rect) => Math.round(rect.top))).size,
      labels: controls.map((control) => control.textContent.trim()),
      minControlHeight: Math.min(...controlRects.map((rect) => rect.height)),
      editorTop: editorRect.top,
      editorHeight: editorRect.height,
      headerAbsent: document.getElementById("mobileWritingHeader") === null
        && document.getElementById("mobileWritingTitle") === null
        && document.getElementById("mobileWritingSaveStatus") === null,
      desktopHeaderHidden: getComputedStyle(document.querySelector(".app-header")).display === "none",
      metaHidden: getComputedStyle(document.querySelector(".note-meta-bar")).display === "none",
      relatedHidden: getComputedStyle(document.getElementById("relatedToggleBtn")).display === "none",
      robotHidden: getComputedStyle(document.getElementById("aiRobotBtn")).display === "none",
      contextHidden: document.getElementById("contextPanel").getAttribute("aria-hidden") === "true"
        && getComputedStyle(document.getElementById("contextPanel")).visibility === "hidden"
    };
  });
  assert.equal(metrics.bodyOverflow, 0, `${width}pxで画面全体に横スクロールがない`);
  assert.equal(metrics.toolbarRows, 1, `${width}pxでツールバーが1段`);
  assert.deepEqual(metrics.labels, ["追加", "画像", "AI", "記法ガイド", "完了"]);
  assert.ok(metrics.minControlHeight >= 40, `${width}pxでタップ領域を確保`);
  assert.ok(metrics.editorHeight > normalEditorHeight, `${width}pxで本文領域が拡大`);
  assert.ok(metrics.editorHeight >= 700, `${width}pxで旧48pxヘッダー分を本文へ割り当て`);
  assert.ok(metrics.editorTop <= 1, `${width}pxで本文が画面上端まで広がる`);
  assert.ok(metrics.headerAbsent && metrics.desktopHeaderHidden && metrics.metaHidden && metrics.relatedHidden && metrics.robotHidden && metrics.contextHidden);
  if (width === 390) await page.screenshot({ path: SCREENSHOT_PATH });

  await page.locator("summary", { hasText: "追加" }).click();
  const panel = await page.locator(".mobile-writing-menu[open] .mobile-writing-menu-panel").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  assert.ok(panel.left >= 0 && panel.right <= panel.viewportWidth && panel.top >= 0 && panel.bottom <= panel.viewportHeight, `${width}pxで追加メニューが画面内`);
  await page.locator("#mobileWritingDoneBtn").click();
  await page.waitForFunction(() => !document.body.classList.contains("mobile-writing-mode"));
  assert.equal(await page.locator(".app-header").evaluate((element) => getComputedStyle(element).display === "none"), false, `${width}pxで完了後に通常表示が復元`);
  assert.equal(await page.locator("#contextPanel").getAttribute("aria-hidden"), normalContextHidden, `${width}pxで補助パネルの開閉状態を復元`);
  return { width, normalEditorHeight, ...metrics };
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
  const page = await browser.newPage();
  await page.route("https://cdn.jsdelivr.net/**", async (route) => {
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
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const results = [];
  try {
    await page.setViewportSize({ width: MOBILE_WIDTHS[0], height: 760 });
    await waitForApp(page);
    await closeMobileContextPanel(page);
    for (const width of MOBILE_WIDTHS) results.push(await mobileMetrics(page, width));

    await page.setViewportSize({ width: 390, height: 420 });
    await page.waitForFunction(() => document.body.dataset.layoutMode === "mobile");
    await page.locator("#editor").click();
    const compactHeight = await page.locator("#editor").evaluate((element) => element.getBoundingClientRect().height);
    assert.ok(compactHeight >= 250, "キーボード表示を模した低いvisual viewportでも本文領域を確保");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);

    const longBody = Array.from({ length: 80 }, (_, index) => `line-${index} abcdefghijklmnopqrstuvwxyz`).join("\n");
    await page.locator("#editor").fill(longBody);
    const editorContext = await page.locator("#editor").evaluate((element) => {
      element.scrollTop = 240;
      element.setSelectionRange(120, 140);
      return { start: element.selectionStart, end: element.selectionEnd, scrollTop: element.scrollTop };
    });
    await page.locator("[data-mobile-editor-tool='syntaxGuideBtn']").click();
    assert.ok(await page.locator("#syntaxGuideDialog").evaluate((element) => element.open));
    const restoredContext = await page.locator("#editor").evaluate((element) => ({
      start: element.selectionStart,
      end: element.selectionEnd,
      scrollTop: element.scrollTop
    }));
    assert.deepEqual(restoredContext, editorContext, "記法ガイド操作前に選択範囲とスクロール位置を復元");
    await page.locator("#closeSyntaxGuideBtn").click();
    assert.ok(await page.locator("body").evaluate((element) => element.classList.contains("mobile-writing-mode")), "記法ガイドを閉じても執筆モードを維持");

    await page.locator("#editor").click();
    await page.locator("#editor").evaluate((element) => element.setSelectionRange(2, 4));
    await page.locator("summary", { hasText: "追加" }).click();
    await page.getByRole("menuitem", { name: "注意書きを挿入" }).click();
    assert.match(await page.locator("#editor").inputValue(), /\[!NOTE\]/);
    assert.ok(await page.locator("body").evaluate((element) => element.classList.contains("mobile-writing-mode")), "ツール操作後も執筆モードを維持");

    await page.locator("summary", { hasText: "AI" }).click();
    await page.getByRole("menuitem", { name: "選択範囲をAIに送る" }).click();
    assert.ok(await page.locator("body").evaluate((element) => element.classList.contains("mobile-writing-mode")), "AI操作後も執筆モードを維持");
    await page.locator("#closeAiPanelBtn").click();
    assert.equal(await page.locator("#editor").evaluate((element) => document.activeElement === element), true, "AIを閉じると本文へ戻る");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.locator("[data-mobile-editor-tool='insertImageBlockBtn']").click();
    await fileChooserPromise;
    assert.ok(await page.locator("body").evaluate((element) => element.classList.contains("mobile-writing-mode")), "画像追加操作でも執筆モードを維持");

    const beforeDone = await page.locator("#editor").evaluate((element) => ({
      value: element.value,
      start: element.selectionStart,
      end: element.selectionEnd,
      scrollTop: element.scrollTop
    }));
    await page.locator("#mobileWritingDoneBtn").click();
    await page.waitForFunction(() => !document.body.classList.contains("mobile-writing-mode"));
    const afterDone = await page.locator("#editor").evaluate((element) => ({
      value: element.value,
      start: element.selectionStart,
      end: element.selectionEnd,
      scrollTop: element.scrollTop
    }));
    assert.deepEqual(afterDone, beforeDone, "完了は本文・選択範囲・スクロール位置を変更しない");

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
    await page.locator("#editor").click();
    assert.equal(await page.locator("body").evaluate((element) => element.classList.contains("mobile-writing-mode")), false, "デスクトップでは執筆モードへ入らない");
    assert.equal(await page.locator("#mobileWritingHeader").count(), 0);
    assert.notEqual(await page.locator(".editor-tools").evaluate((element) => getComputedStyle(element).display), "none");
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    console.log(JSON.stringify({ mobile: results, compactViewportEditorHeight: compactHeight, desktop: "unchanged", pageErrors, consoleErrors, screenshot: SCREENSHOT_PATH }, null, 2));
  } finally {
    await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
