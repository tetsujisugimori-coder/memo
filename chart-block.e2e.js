"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const playwright = require("playwright");

let appUrl = process.env.MEMO_NEXUS_E2E_URL || "";
const browserName = process.env.MEMO_NEXUS_E2E_BROWSER || "chromium";
const screenshotPath = path.join(os.tmpdir(), "memo-nexus-chart-block-390.png");

async function startStaticServer() {
  if (appUrl) return null;
  const root = __dirname;
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
      const extension = path.extname(filePath);
      response.writeHead(200, { "Content-Type": extension === ".html" ? "text/html; charset=utf-8" : extension === ".css" ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8" });
      response.end(body);
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  appUrl = `http://127.0.0.1:${server.address().port}/`;
  return server;
}

async function launchBrowser() {
  const browserType = playwright[browserName];
  if (!browserType) throw new Error(`Unsupported browser: ${browserName}`);
  try {
    return await browserType.launch({ headless: true });
  } catch (error) {
    const executablePath = path.join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium_headless_shell-1194", "chrome-win", "headless_shell.exe");
    if (browserName !== "chromium" || !fs.existsSync(executablePath)) throw error;
    return browserType.launch({ headless: true, executablePath });
  }
}

async function closeStaticServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function waitForApp(page) {
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("#appStartupGuard").waitFor({ state: "hidden", timeout: 30000 });
  await page.locator("#editor").waitFor({ state: "visible" });
}

function chart(page) {
  return page.evaluate(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
    .find((segment) => segment.type === "chart")?.chart || null);
}

(async () => {
  let server = null;
  let browser = null;
  let runError = null;
  try {
    server = await startStaticServer();
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.fulfill({ contentType: "text/javascript", body: "window.katex={renderToString:String};window.mermaid={initialize(){},render:async()=>({svg:'<svg></svg>'})};window.hljs={highlightAuto:()=>({value:''}),getLanguage:()=>false};" }));
    await waitForApp(page);
    await page.locator("#editor").fill("グラフの前\nグラフの後");
    await page.locator("#insertChartBtn").click();
    const editor = page.locator(".chart-block-editor");
    await editor.waitFor({ state: "visible" });
    await editor.locator('input[aria-label="グラフ1のタイトル"]').fill("テスト得点");
    await editor.locator('input[aria-label="グラフ1の単位"]').fill("点");
    await editor.locator('input[aria-label="1件目の項目名"]').fill("国語");
    await editor.locator('input[aria-label="1件目の数値"]').fill("70.5");
    await editor.locator('button[data-chart-action="add-item"]').click();
    await editor.locator('input[aria-label="2件目の項目名"]').fill("数学");
    await editor.locator('input[aria-label="2件目の数値"]').fill("0");
    await editor.locator('input[aria-label="グラフ1の棒の色"]').evaluate((input) => { input.value = "#dc2626"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await editor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]').uncheck();
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.title === "テスト得点" && current.unit === "点" && current.items.length === 2 && current.items[0].value === 70.5 && current.items[1].value === 0 && current.appearance.color === "#dc2626" && current.appearance.showValues === false;
    });
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 2);
    assert.equal(await page.locator("#preview .chart-block-bar").count(), 2, "保存前プレビューは2本の棒を描画する");
    assert.equal(await page.locator("#preview .chart-block-value").count(), 0, "数値表示オフを即時反映する");
    assert.equal(await page.locator("#preview .chart-block-bar rect").first().getAttribute("fill"), "#dc2626", "選択色を全棒へ反映する");
    assert.equal(await page.locator("#preview .chart-block-edit").count(), 1, "カードに再編集操作を表示する");
    await page.locator("#preview .chart-block-edit").click();
    assert.equal(await editor.evaluate((element) => document.activeElement === element), true, "カードの編集操作が対応する編集欄へ移動する");
    const firstValue = editor.locator('input[aria-label="1件目の数値"]');
    await firstValue.fill("");
    assert.equal(await firstValue.getAttribute("aria-invalid"), "true", "空の数値欄を不正として公開する");
    assert.equal((await chart(page)).items[0].value, 70.5, "不正な空入力は直前の有効な保存値を置き換えない");
    await editor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "1件目の数値");
    assert.match(await editor.locator(".chart-block-status").textContent(), /数値は0以上の有限な数値/, "不正値では保存成功を表示しない");
    await firstValue.fill("-1");
    assert.equal(await firstValue.getAttribute("aria-invalid"), "true", "負数を不正として公開する");
    await firstValue.fill("NaN");
    assert.equal(await firstValue.getAttribute("aria-invalid"), "true", "NaNを不正として公開する");
    await firstValue.fill("Infinity");
    assert.equal(await firstValue.getAttribute("aria-invalid"), "true", "有限でない数値を不正として公開する");
    await firstValue.fill("72.25");
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart.items[0].value === 72.25);
    assert.equal(await firstValue.getAttribute("aria-invalid"), null, "有効な数値へ修正すると不正状態を解除する");
    await editor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    const beforeReload = await chart(page);
    assert.equal(beforeReload.items[0].value, 72.25, "有効値の確定は保存モデルを更新する");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.deepEqual(await chart(page), beforeReload, "再読み込み後もグラフ保存データを復元する");
    assert.equal(await page.locator("#preview .chart-block-bar").count(), 2, "再読み込み後もカードの棒を復元する");
    await page.locator('input[aria-label="グラフ1のタイトル"]').fill("更新後の得点");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block").length === 1 && document.querySelector("#preview .chart-block figcaption")?.textContent === "更新後の得点");
    await page.locator("#preview .chart-block").screenshot({ path: screenshotPath });
    await page.setViewportSize({ width: 390, height: 760 });
    const metrics = await page.locator("#preview .chart-block").evaluate((element) => ({ card: element.getBoundingClientRect().width, viewport: innerWidth, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    assert.ok(metrics.card <= metrics.viewport, "390px幅でもグラフカードが画面からはみ出さない");
    assert.equal(metrics.pageOverflow, 0, "390px幅でもページ全体の横スクロールを作らない");
    assert.deepEqual(pageErrors, [], `ページエラーなし: ${pageErrors.join("\n")}`);
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    let cleanupError = null;
    try {
      if (browser) await browser.close();
    } catch (error) {
      if (runError) console.error("Browser cleanup failed", error);
      else cleanupError = error;
    }
    try {
      await closeStaticServer(server);
    } catch (error) {
      if (runError) console.error("Static server cleanup failed", error);
      else if (!cleanupError) cleanupError = error;
    }
    if (cleanupError) throw cleanupError;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
