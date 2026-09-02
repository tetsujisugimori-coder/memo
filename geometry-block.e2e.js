"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const playwright = require("playwright");

async function startStaticServer() {
  const root = __dirname;
  const server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, "") || "index.html";
    const filePath = path.resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(404).end();
      const type = path.extname(filePath) === ".js" ? "application/javascript" : path.extname(filePath) === ".css" ? "text/css" : "text/html";
      response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` }).end(body);
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

async function launchBrowser() {
  try {
    return await playwright.chromium.launch({ headless: true });
  } catch (error) {
    const executablePath = path.join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium_headless_shell-1194", "chrome-win", "headless_shell.exe");
    if (!fs.existsSync(executablePath)) throw error;
    return playwright.chromium.launch({ headless: true, executablePath });
  }
}

async function waitForApp(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
  await page.locator("#editor").waitFor({ state: "visible" });
}

async function geometry(page) {
  return page.evaluate(() => {
    const blocks = window.MemoNexusGeometryBlockUtils.splitGeometryBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "geometry");
    return blocks[0]?.geometry || null;
  });
}

(async () => {
  const { server, url } = await startStaticServer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await waitForApp(page, url);
    await page.locator("#editor").click();
    await page.locator("#insertGeometryBtn").click();
    const editor = page.locator(".geometry-block-editor");
    await editor.waitFor();
    const svg = editor.locator("svg");
    await editor.locator('[data-geometry-mode="point"]').click();
    for (const position of [{ x: 70, y: 70 }, { x: 180, y: 110 }, { x: 120, y: 185 }]) await svg.click({ position });
    assert.equal((await geometry(page)).points.length, 3, "点を追加できる");

    await editor.locator('[data-geometry-mode="segment"]').click();
    await editor.locator(".geometry-point-hit").nth(0).click();
    await editor.locator(".geometry-point-hit").nth(1).click();
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "segment").length, 1, "線分を追加できる");

    await editor.locator('[data-geometry-mode="polygon"]').click();
    await editor.locator(".geometry-point-hit").nth(0).click();
    await editor.locator(".geometry-point-hit").nth(1).click();
    await editor.locator(".geometry-point-hit").nth(2).click();
    await editor.locator(".geometry-point-hit").nth(0).click();
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "polygon").length, 1, "多角形を追加できる");

    await editor.locator('[data-geometry-mode="polygon"]').click();
    await editor.locator(".geometry-point-hit").nth(0).click();
    await editor.focus();
    await page.keyboard.press("Escape");
    assert.equal((await geometry(page)).objects.length, 2, "Escapeで作成途中の多角形を解除できる");

    await editor.locator('[data-geometry-mode="select"]').click();
    const beforeMove = await geometry(page);
    const pointHit = editor.locator(".geometry-point-hit").nth(0);
    await pointHit.dragTo(svg, { targetPosition: { x: 220, y: 180 } });
    const moved = await geometry(page);
    assert.notEqual(moved.points[0].x, beforeMove.points[0].x, "点をドラッグ移動できる");
    assert.equal(moved.objects.filter((object) => object.type === "segment" || object.type === "polygon").every((object) => object.pointIds.includes(moved.points[0].id)), true, "移動後も参照構造を維持する");
    await editor.locator(".geometry-point-hit").nth(0).click();
    await editor.locator('input[aria-label="選択した点の頂点名"]').fill("P");
    await editor.locator('input[aria-label="選択した点の頂点名"]').blur();
    await editor.locator(".geometry-segment-hit").click();
    await editor.locator('select[aria-label="選択した線分の線種"]').selectOption("dashed");
    await page.waitForTimeout(350);
    const beforeReload = await geometry(page);
    assert.equal(beforeReload.annotations.find((annotation) => annotation.pointId === beforeReload.points[0].id).label, "P");
    assert.equal(beforeReload.objects.find((object) => object.type === "segment").lineStyle, "dashed");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    const restored = await geometry(page);
    assert.equal(restored.points.length, 3, "再読み込み後も点を復元する");
    assert.equal(restored.objects.filter((object) => object.type === "polygon").length, 1, "再読み込み後も多角形を復元する");
    assert.equal(restored.objects.find((object) => object.type === "segment").lineStyle, "dashed", "線種を復元する");

    await page.setViewportSize({ width: 390, height: 760 });
    await page.locator(".geometry-canvas svg").waitFor({ state: "visible" });
    assert.ok(await page.locator(".geometry-point-hit").count(), "モバイル幅でもタップ用の点判定領域を維持する");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
