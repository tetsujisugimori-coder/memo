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

async function locatorCenter(locator, message) {
  const box = await locator.boundingBox();
  assert.ok(box, message);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

(async () => {
  const { server, url } = await startStaticServer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await waitForApp(page, url);
    await page.addStyleTag({ content: ".geometry-block-editors { max-height: 430px !important; }" });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
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

    await editor.locator('[data-geometry-mode="triangle"]').click();
    for (const position of [{ x: 265, y: 55 }, { x: 315, y: 95 }, { x: 270, y: 145 }]) await svg.click({ position });
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "polygon").length, 2, "三角形をキャンバス上の3点指定で作成できる");
    await editor.locator('[data-geometry-mode="quadrilateral"]').click();
    for (const position of [{ x: 350, y: 55 }, { x: 400, y: 55 }, { x: 400, y: 115 }, { x: 350, y: 115 }]) await svg.click({ position });
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "polygon").length, 3, "四角形をキャンバス上の4点指定で作成できる");
    await editor.locator('[data-geometry-mode="circle"]').click();
    await svg.click({ position: { x: 455, y: 95 } });
    await svg.click({ position: { x: 485, y: 95 } });
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "circle").length, 1, "円を中心と円周上の点指定で作成できる");

    await editor.locator('[data-geometry-mode="select"]').click();
    const dragCircleBefore = (await geometry(page)).objects.find((object) => object.type === "circle");
    const centerPointBefore = (await geometry(page)).points.find((point) => point.id === dragCircleBefore.pointIds[0]);
    const radiusPointBefore = (await geometry(page)).points.find((point) => point.id === dragCircleBefore.pointIds[1]);
    const centerHit = editor.locator(`[data-geometry-kind="point"][data-geometry-id="${dragCircleBefore.pointIds[0]}"]`);
    const radiusHit = editor.locator(`[data-geometry-kind="point"][data-geometry-id="${dragCircleBefore.pointIds[1]}"]`);
    const centerPosition = await locatorCenter(centerHit, "円の中心点を操作できる");
    const radiusPosition = await locatorCenter(radiusHit, "円周上の点を操作できる");
    await page.mouse.move(centerPosition.x, centerPosition.y);
    await page.mouse.down();
    await page.mouse.move(radiusPosition.x, radiusPosition.y);
    const afterInvalidDrag = await geometry(page);
    assertCoordinates(afterInvalidDrag.points.find((point) => point.id === dragCircleBefore.pointIds[0]), centerPointBefore, "半径0になるドラッグでは最後の正常な中心座標を維持する");
    assert.match(await editor.locator(".geometry-block-status").textContent(), /中心と円周上の点は同じ位置にできません/, "無効なドラッグ理由を表示する");
    assert.equal(pageErrors.length, 0, "無効なドラッグで未処理例外を出さない");
    await page.mouse.move(radiusPosition.x + 25, radiusPosition.y + 15);
    await page.mouse.up();
    const afterRecoveredDrag = await geometry(page);
    const recoveredCenter = afterRecoveredDrag.points.find((point) => point.id === dragCircleBefore.pointIds[0]);
    const recoveredRadius = afterRecoveredDrag.points.find((point) => point.id === dragCircleBefore.pointIds[1]);
    assert.notDeepEqual(recoveredCenter, centerPointBefore, "正常な位置へ戻すと同じドラッグを継続できる");
    assert.equal(recoveredCenter.x === recoveredRadius.x && recoveredCenter.y === recoveredRadius.y, false, "正常な円として保存する");
    await editor.focus();
    await page.keyboard.press("Control+z");
    assertCoordinates((await geometry(page)).points.find((point) => point.id === dragCircleBefore.pointIds[0]), centerPointBefore, "Undoでドラッグ前の正常な円へ戻せる");
    await page.keyboard.press("Control+Shift+z");
    assertCoordinates((await geometry(page)).points.find((point) => point.id === dragCircleBefore.pointIds[0]), recoveredCenter, "Redoで正常なドラッグ結果を復元できる");

    await editor.locator('[data-geometry-mode="circle"]').click();
    await editor.locator(".geometry-point-hit").nth(0).click();
    await svg.click({ position: { x: 320, y: 70 } });
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "circle").length, 2, "線分を内包する円を作成できる");

    await editor.locator('[data-geometry-mode="select"]').click();
    await editor.locator(".geometry-segment-hit").click();
    assert.equal(await editor.locator(".geometry-segment.is-selected").count(), 1, "円内部の線分を選択できる");
    assert.equal(await editor.locator(".geometry-circle.is-selected").count(), 0, "円内部の線分選択で円を誤選択しない");
    const selectableCircleHit = editor.locator(".geometry-circle-hit").last();
    const selectableCircleBox = await selectableCircleHit.boundingBox();
    assert.ok(selectableCircleBox, "円周の当たり判定領域を取得できる");
    await selectableCircleHit.click({ position: { x: 4, y: selectableCircleBox.height / 2 } });
    assert.equal(await editor.locator(".geometry-circle.is-selected").count(), 1, "円周を選択できる");
    const circleBeforeMove = await geometry(page);
    const circleHit = editor.locator(".geometry-circle-hit").last();
    const circleBox = await circleHit.boundingBox();
    assert.ok(circleBox, "選択後も円周の当たり判定領域を取得できる");
    await page.mouse.move(circleBox.x + 4, circleBox.y + circleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(circleBox.x + 28, circleBox.y + circleBox.height / 2 + 12);
    await page.mouse.up();
    const circleAfterMove = await geometry(page);
    const movedCircle = circleAfterMove.objects.filter((object) => object.type === "circle").at(-1);
    const originalCircle = circleBeforeMove.objects.find((object) => object.id === movedCircle.id);
    assert.notEqual(circleAfterMove.points.find((point) => point.id === movedCircle.pointIds[0]).x, circleBeforeMove.points.find((point) => point.id === originalCircle.pointIds[0]).x, "円周からドラッグすると円全体を移動できる");
    await editor.locator(".geometry-point-hit").nth(0).click();
    assert.equal(await editor.locator(".geometry-point.is-selected").count(), 1, "円内の点を個別に選択できる");

    await editor.locator('[data-geometry-mode="circle"]').click();
    const beforeZeroRadius = await geometry(page);
    await svg.click({ position: { x: 500, y: 200 } });
    await svg.click({ position: { x: 500, y: 200 } });
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "circle").length, beforeZeroRadius.objects.filter((object) => object.type === "circle").length, "同じ位置を2回指定しても半径0の円を追加しない");
    await svg.click({ position: { x: 540, y: 200 } });
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "circle").length, beforeZeroRadius.objects.filter((object) => object.type === "circle").length + 1, "半径0エラー後に円周上の点を指定し直せる");

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
    await editor.locator('input[aria-label="選択した辺の長さ表示"]').fill("5 cm");
    await editor.locator('input[aria-label="選択した辺の長さ表示"]').blur();
    await editor.locator(".geometry-polygon").nth(1).click();
    await editor.locator('select[aria-label="選択した図形の辺"]').selectOption("1");
    await editor.locator('input[aria-label="選択した辺の長さ表示"]').fill("a");
    await editor.locator('input[aria-label="選択した辺の長さ表示"]').blur();
    await page.waitForTimeout(350);
    const beforeReload = await geometry(page);
    assert.equal(beforeReload.annotations.find((annotation) => annotation.pointId === beforeReload.points[0].id).label, "P");
    assert.equal(beforeReload.objects.find((object) => object.type === "segment").lineStyle, "dashed");
    assert.equal(beforeReload.annotations.some((annotation) => annotation.type === "length-label" && annotation.label === "5 cm"), true, "線分の長さ表示を保存する");
    assert.equal(beforeReload.annotations.some((annotation) => annotation.type === "length-label" && annotation.label === "a" && annotation.edgeIndex === 1), true, "多角形の辺の長さ表示を保存する");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    const restored = await geometry(page);
    assert.equal(restored.points.length, 15, "再読み込み後も図形を構成する点を復元する");
    assert.equal(restored.objects.filter((object) => object.type === "polygon").length, 3, "再読み込み後も三角形・四角形を含む多角形を復元する");
    assert.equal(restored.objects.filter((object) => object.type === "circle").length, 3, "再読み込み後も円を復元する");
    const restoredDraggedCircle = restored.objects.find((object) => object.id === dragCircleBefore.id);
    const restoredCenter = restored.points.find((point) => point.id === restoredDraggedCircle.pointIds[0]);
    const restoredRadius = restored.points.find((point) => point.id === restoredDraggedCircle.pointIds[1]);
    assertCoordinates(restoredCenter, recoveredCenter, "無効位置を避けて確定した円を再読み込み後も復元する");
    assert.equal(restoredCenter.x === restoredRadius.x && restoredCenter.y === restoredRadius.y, false, "再読み込み後も半径0の円にしない");
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
