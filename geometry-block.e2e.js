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

async function expectedLogicalPosition(svg, position) {
  return svg.evaluate((element, relative) => {
    const rect = element.getBoundingClientRect();
    const point = new DOMPoint(rect.left + relative.x, rect.top + relative.y)
      .matrixTransform(element.getScreenCTM().inverse());
    return { x: point.x, y: point.y };
  }, position);
}

function assertCoordinates(actual, expected, message, tolerance = 0.25) {
  assert.ok(Math.abs(actual.x - expected.x) <= tolerance, `${message}: x (${actual.x} ≈ ${expected.x})`);
  assert.ok(Math.abs(actual.y - expected.y) <= tolerance, `${message}: y (${actual.y} ≈ ${expected.y})`);
}

(async () => {
  const { server, url } = await startStaticServer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await waitForApp(page, url);
    await page.locator("#editor").fill("前\n後");
    await page.locator("#editor").press("End");
    await page.locator("#insertGeometryBtn").click();
    const editor = page.locator(".geometry-block-editor");
    await editor.waitFor();
    const svg = editor.locator("svg");
    await editor.locator('[data-geometry-mode="point"]').click();
    const desktopPositions = [{ x: 70, y: 70 }, { x: 180, y: 110 }, { x: 120, y: 185 }];
    const desktopExpected = await Promise.all(desktopPositions.map((position) => expectedLogicalPosition(svg, position)));
    for (const position of desktopPositions) await svg.click({ position });
    const afterPoints = await geometry(page);
    assert.equal(afterPoints.points.length, 3, "点を追加できる");
    afterPoints.points.forEach((point, index) => assertCoordinates(point, desktopExpected[index], "デスクトップ幅でクリック位置を論理座標へ変換する"));

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
    assert.equal(await editor.locator(".geometry-draft").count(), 0, "多角形完成後に作成途中の破線を残さない");

    await editor.locator('[data-geometry-mode="polygon"]').click();
    await editor.locator(".geometry-point-hit").nth(0).click();
    await editor.locator(".geometry-point-hit").nth(1).click();
    assert.equal(await editor.locator(".geometry-draft").count(), 1, "多角形作成中は破線を表示する");
    await editor.locator('[data-geometry-mode="segment"]').click();
    assert.equal(await editor.locator(".geometry-draft").count(), 0, "モード切替後に作成途中の破線を残さない");
    assert.equal(await editor.locator(".geometry-point.is-draft").count(), 0, "モード切替後に作成途中の点強調を残さない");
    await editor.locator('[data-geometry-mode="polygon"]').click();
    await editor.locator(".geometry-point-hit").nth(0).click();
    await editor.focus();
    await page.keyboard.press("Escape");
    assert.equal((await geometry(page)).objects.length, 2, "Escapeで作成途中の多角形を解除できる");
    assert.equal(await editor.locator(".geometry-draft").count(), 0, "Escape後に作成途中の破線を残さない");

    await editor.locator('[data-geometry-mode="select"]').click();
    const beforeMove = await geometry(page);
    const pointHit = editor.locator(".geometry-point-hit").nth(0);
    const dragEnd = { x: 220, y: 180 };
    const expectedDragEnd = await expectedLogicalPosition(svg, dragEnd);
    await pointHit.dragTo(svg, { targetPosition: dragEnd });
    const moved = await geometry(page);
    assert.notEqual(moved.points[0].x, beforeMove.points[0].x, "点をドラッグ移動できる");
    assertCoordinates(moved.points[0], expectedDragEnd, "ドラッグ終了位置を保存する");
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
    const mobileEditor = page.locator(".geometry-block-editor");
    const mobileSvg = mobileEditor.locator("svg");
    await mobileSvg.waitFor({ state: "visible" });
    assert.ok(await mobileEditor.locator(".geometry-point-hit").count(), "モバイル幅でもタップ用の点判定領域を維持する");
    await mobileEditor.locator('[data-geometry-mode="point"]').click();
    const mobilePosition = { x: 140, y: 170 };
    const expectedMobilePoint = await expectedLogicalPosition(mobileSvg, mobilePosition);
    await mobileSvg.click({ position: mobilePosition });
    const mobileGeometry = await geometry(page);
    assertCoordinates(mobileGeometry.points.at(-1), expectedMobilePoint, "モバイル幅でクリック位置を論理座標へ変換する");

    let cancelled = false;
    page.once("dialog", async (dialog) => { cancelled = true; await dialog.dismiss(); });
    await mobileEditor.locator(".geometry-block-remove").click();
    assert.equal(cancelled, true, "図形ブロック削除で確認を表示する");
    assert.ok(await geometry(page), "削除確認をキャンセルした場合は図形を維持する");
    page.once("dialog", (dialog) => dialog.accept());
    await mobileEditor.locator(".geometry-block-remove").click();
    await page.locator(".geometry-block-editor").waitFor({ state: "detached" });
    assert.equal(await geometry(page), null, "承認後は対象図形マーカーを本文から削除する");
    const bodyAfterDelete = await page.locator("#editor").inputValue();
    assert.equal(bodyAfterDelete.includes("memo-nexus:geometry-block"), false, "図形マーカーだけを削除する");
    assert.equal(bodyAfterDelete.includes("前") && bodyAfterDelete.includes("後"), true, "図形以外の本文は維持する");
    await page.waitForTimeout(350);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.equal(await geometry(page), null, "削除後の再読み込みで図形を復元しない");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
