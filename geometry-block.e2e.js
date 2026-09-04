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

async function alignSvgForPointer(svg) {
  return svg.evaluate(async (element) => {
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const snapshot = () => {
      const rect = element.getBoundingClientRect();
      const matrix = element.getScreenCTM();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f };
    };
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const before = snapshot();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const after = snapshot();
    return { before, after };
  });
}

function assertSvgAlignment(actual, expected, message) {
  for (const key of ["x", "y", "width", "height", "a", "b", "c", "d", "e", "f"]) assert.ok(Math.abs(actual[key] - expected[key]) < .01, `${message}: ${key}`);
}

async function logicalClientPosition(svg, point) {
  return svg.evaluate((element, logicalPoint) => {
    const matrix = element.getScreenCTM();
    const screen = new DOMPoint(logicalPoint.x, logicalPoint.y).matrixTransform(matrix);
    const x = Math.round(screen.x);
    const y = Math.round(screen.y);
    const top = document.elementFromPoint(x, y);
    const target = top?.closest("[data-geometry-kind]");
    const rect = element.getBoundingClientRect();
    return { x, y, matrix: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, top: { tag: top?.tagName, className: top?.getAttribute("class"), kind: target?.dataset?.geometryKind, id: target?.dataset?.geometryId } };
  }, point);
}

async function locatorCenter(locator, message) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box, message);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickLocatorCenter(page, locator, message) {
  const position = await locatorCenter(locator, message);
  await page.mouse.click(position.x, position.y);
}

async function runRightAngleEditorScenario(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await waitForApp(page, url);
    await page.locator("#editor").fill("直角注釈のUI編集");
    await page.locator("#editor").press("End");
    await page.locator("#insertGeometryBtn").click();
    const editor = page.locator(".geometry-block-editor");
    await editor.waitFor();
    const svg = editor.locator("svg");

    await editor.locator('[data-geometry-mode="point"]').click();
    const alignment = await alignSvgForPointer(svg);
    assertSvgAlignment(alignment.before, alignment.after, "直角注釈シナリオの点作成前にSVGを安定させる");
    for (const logicalPoint of [{ x: 20, y: 75 }, { x: 20, y: 20 }, { x: 75, y: 20 }]) {
      const client = await logicalClientPosition(svg, logicalPoint);
      assert.equal(client.top.tag?.toLowerCase(), "svg", "新しい頂点の位置は既存の選択対象と重ならない");
      await page.mouse.click(client.x, client.y);
    }
    const pointsGeometry = await geometry(page);
    assert.equal(pointsGeometry.points.length, 3, "直角注釈用に3点を作成する");
    const [firstRay, vertex, secondRay] = pointsGeometry.points;

    await editor.locator('[data-geometry-mode="segment"]').click();
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${vertex.id}"]`), "頂点と第1方向を結ぶ線分の頂点を選択できる");
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${firstRay.id}"]`), "頂点と第1方向を結ぶ線分の方向点を選択できる");
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${vertex.id}"]`), "頂点と第2方向を結ぶ線分の頂点を選択できる");
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${secondRay.id}"]`), "頂点と第2方向を結ぶ線分の方向点を選択できる");
    const segmentGeometry = await geometry(page);
    assert.equal(segmentGeometry.objects.filter((object) => object.type === "segment").length, 2, "直角の2方向を表す線分を作成する");

    const rightAngleButton = editor.locator('[data-geometry-mode="right-angle"]');
    await rightAngleButton.click();
    assert.equal(await rightAngleButton.getAttribute("aria-pressed"), "true", "直角モードを有効化する");
    assert.match(await editor.locator(".geometry-block-status").textContent(), /頂点を選択/);
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${vertex.id}"]`), "直角の頂点を選択できる");
    assert.match(await editor.locator(".geometry-block-status").textContent(), /1本目の方向/);
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${firstRay.id}"]`), "直角の1本目の方向を選択できる");
    assert.match(await editor.locator(".geometry-block-status").textContent(), /2本目の方向/);
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${secondRay.id}"]`), "直角の2本目の方向を選択できる");
    await page.waitForFunction(() => document.querySelectorAll('.geometry-block-editor [data-geometry-type="right-angle"]').length === 1);
    const annotated = await geometry(page);
    const annotation = annotated.annotations.find((item) => item.type === "right-angle");
    assert.equal(annotation.vertexId, vertex.id, "直角注釈は選択した頂点IDを保存する");
    assert.deepEqual(annotation.rayVertexIds, [firstRay.id, secondRay.id], "直角注釈は選択順の方向点IDを保存する");
    assert.equal(annotation.segmentIds?.length, 2, "安全に特定できる2本の線分IDも保存する");
    const mark = editor.locator(`[data-geometry-type="right-angle"][data-geometry-id="${annotation.id}"]`);
    const beforePath = await mark.locator("path").getAttribute("d");

    await editor.locator('[data-geometry-mode="select"]').click();
    await mark.click();
    assert.match(await mark.getAttribute("class"), /is-selected/, "直角記号自身を選択できる");
    const movedPoint = (await geometry(page)).points.find((point) => point.id === secondRay.id);
    const pointStart = await logicalClientPosition(svg, movedPoint);
    const pointEnd = await logicalClientPosition(svg, { x: movedPoint.x + 8, y: movedPoint.y + 7 });
    await page.mouse.move(pointStart.x, pointStart.y);
    await page.mouse.down();
    await page.mouse.move(pointEnd.x, pointEnd.y);
    await page.mouse.up();
    await page.waitForFunction(({ id, path }) => document.querySelector(`[data-geometry-type="right-angle"][data-geometry-id="${id}"] path`)?.getAttribute("d") !== path, { id: annotation.id, path: beforePath });
    assert.deepEqual((await geometry(page)).annotations.find((item) => item.id === annotation.id).rayVertexIds, annotation.rayVertexIds, "点移動後も直角注釈の参照IDを維持する");

    await page.evaluate(() => window.flushSave());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    const restored = await geometry(page);
    const restoredAnnotation = restored.annotations.find((item) => item.id === annotation.id);
    assert.equal(restoredAnnotation.vertexId, vertex.id, "保存・再読込後も直角の頂点IDを復元する");
    assert.deepEqual(restoredAnnotation.rayVertexIds, [firstRay.id, secondRay.id], "保存・再読込後も直角の方向点IDを復元する");
    assert.equal(await page.locator(`[data-geometry-type="right-angle"][data-geometry-id="${annotation.id}"]`).count(), 1, "保存・再読込後もSVGへ直角記号を再描画する");

    const restoredEditor = page.locator(".geometry-block-editor");
    await restoredEditor.locator(`[data-geometry-kind="point"][data-geometry-id="${firstRay.id}"]`).click();
    await restoredEditor.locator("button", { hasText: "選択を削除" }).click();
    await page.waitForFunction((annotationId) => {
      const block = window.MemoNexusGeometryBlockUtils.splitGeometryBlocks(document.getElementById("editor").value)
        .find((segment) => segment.type === "geometry")?.geometry;
      return !block?.annotations.some((item) => item.id === annotationId);
    }, annotation.id);
    assert.equal((await geometry(page)).annotations.some((item) => item.id === annotation.id), false, "関連点の削除後に参照切れの直角注釈を残さない");
    assert.equal(pageErrors.length, 0, "直角注釈シナリオで未処理例外を出さない");
  } finally {
    await context.close();
  }
}

async function runCircleInteriorSelectionScenario(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await waitForApp(page, url);
    await page.locator("#editor").fill("円内部の線分選択");
    await page.locator("#editor").press("End");
    await page.locator("#insertGeometryBtn").click();
    const editor = page.locator(".geometry-block-editor");
    await editor.waitFor();
    const svg = editor.locator("svg");

    await editor.locator('[data-geometry-mode="point"]').click();
    const pointAlignment = await alignSvgForPointer(svg);
    assertSvgAlignment(pointAlignment.before, pointAlignment.after, "独立シナリオの点作成前にSVGを安定させる");
    const segmentStartClient = { x: Math.round(pointAlignment.after.x + 150), y: Math.round(pointAlignment.after.y + 130) };
    const segmentEndClient = { x: Math.round(pointAlignment.after.x + 350), y: Math.round(pointAlignment.after.y + 130) };
    await page.mouse.click(segmentStartClient.x, segmentStartClient.y);
    await page.mouse.click(segmentEndClient.x, segmentEndClient.y);
    const pointsGeometry = await geometry(page);
    assert.equal(pointsGeometry.points.length, 2, "独立シナリオへ2点だけ追加する");
    const segmentPointIds = pointsGeometry.points.map((point) => point.id);

    await editor.locator('[data-geometry-mode="segment"]').click();
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${segmentPointIds[0]}"]`), "独立シナリオの線分始点を選択できる");
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${segmentPointIds[1]}"]`), "独立シナリオの線分終点を選択できる");
    const segmentGeometry = await geometry(page);
    const selectableSegment = segmentGeometry.objects.find((object) => object.type === "segment");
    assert.equal(segmentGeometry.objects.filter((object) => object.type === "segment").length, 1, "独立シナリオへ線分を1本だけ追加する");
    assert.deepEqual(selectableSegment.pointIds, segmentPointIds, "独立シナリオの線分は作成した2点を参照する");

    await editor.locator('[data-geometry-mode="circle"]').click();
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${segmentPointIds[0]}"]`), "独立シナリオの円中心を選択できる");
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "circle").length, 0, "円の中心指定だけでは確定しない");
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${segmentPointIds[1]}"]`), "独立シナリオの円周点を選択できる");
    const createdGeometry = await geometry(page);
    const selectableCircle = createdGeometry.objects.find((object) => object.type === "circle");
    assert.equal(createdGeometry.points.length, 2, "線分と円は同じ2点を共有する");
    assert.equal(createdGeometry.objects.length, 2, "独立シナリオには線分1本と円1個だけを置く");
    assert.deepEqual(selectableCircle.pointIds, segmentPointIds, "円の中心点と円周点は意図した2点を参照する");

    await editor.locator('[data-geometry-mode="select"]').click();
    const selectionAlignment = await alignSvgForPointer(svg);
    assertSvgAlignment(selectionAlignment.before, selectionAlignment.after, "独立シナリオの選択前にSVGを安定させる");
    const selectionGeometry = await geometry(page);
    const currentSegment = selectionGeometry.objects.find((object) => object.id === selectableSegment.id);
    const currentCircle = selectionGeometry.objects.find((object) => object.id === selectableCircle.id);
    const [segmentStart, segmentEnd] = currentSegment.pointIds.map((pointId) => selectionGeometry.points.find((point) => point.id === pointId));
    const circleCenter = selectionGeometry.points.find((point) => point.id === currentCircle.pointIds[0]);
    const circleRadiusPoint = selectionGeometry.points.find((point) => point.id === currentCircle.pointIds[1]);
    const segmentMiddle = { x: (segmentStart.x + segmentEnd.x) / 2, y: (segmentStart.y + segmentEnd.y) / 2 };
    const logicalRadius = Math.hypot(circleRadiusPoint.x - circleCenter.x, circleRadiusPoint.y - circleCenter.y);
    const middleDistance = Math.hypot(segmentMiddle.x - circleCenter.x, segmentMiddle.y - circleCenter.y);
    assert.ok(middleDistance < logicalRadius, "線分中点が円の内部にある");

    const segmentStartProjection = await logicalClientPosition(svg, segmentStart);
    const segmentEndProjection = await logicalClientPosition(svg, segmentEnd);
    const segmentClient = await logicalClientPosition(svg, segmentMiddle);
    const circleCenterProjection = await logicalClientPosition(svg, circleCenter);
    const circleRadiusProjection = await logicalClientPosition(svg, circleRadiusPoint);
    const distanceToStart = Math.hypot(segmentClient.x - segmentStartProjection.x, segmentClient.y - segmentStartProjection.y);
    const distanceToEnd = Math.hypot(segmentClient.x - segmentEndProjection.x, segmentClient.y - segmentEndProjection.y);
    const circleRadiusPixels = Math.hypot(circleRadiusProjection.x - circleCenterProjection.x, circleRadiusProjection.y - circleCenterProjection.y);
    const middleDistancePixels = Math.hypot(segmentClient.x - circleCenterProjection.x, segmentClient.y - circleCenterProjection.y);
    assert.ok(Math.min(distanceToStart, distanceToEnd) > 12, "線分中点が両端の点当たり判定から十分離れている");
    assert.ok(circleRadiusPixels - middleDistancePixels > 12, "線分中点が円周の当たり判定から十分離れている");
    assert.equal(segmentClient.top.kind, "object", `線分中点の最前面要素: ${JSON.stringify({ segmentId: currentSegment.id, pointIds: currentSegment.pointIds, segmentStart, segmentEnd, segmentMiddle, projection: segmentClient })}`);
    assert.equal(segmentClient.top.id, currentSegment.id, `線分中点の対象ID: ${JSON.stringify({ segmentId: currentSegment.id, pointIds: currentSegment.pointIds, segmentStart, segmentEnd, segmentMiddle, projection: segmentClient })}`);
    assert.match(segmentClient.top.className || "", /geometry-segment-hit/, `線分中点の要素種別: ${JSON.stringify({ segmentId: currentSegment.id, pointIds: currentSegment.pointIds, segmentStart, segmentEnd, segmentMiddle, projection: segmentClient })}`);
    await page.mouse.click(segmentClient.x, segmentClient.y);
    const segmentSelection = await svg.evaluate((element, segmentId) => {
      const hit = element.querySelector(`.geometry-segment-hit[data-geometry-id="${segmentId}"]`);
      return {
        targetSelected: hit?.nextElementSibling?.classList.contains("is-selected") === true,
        selectedSegments: element.querySelectorAll(".geometry-segment.is-selected").length,
        selectedCircles: element.querySelectorAll(".geometry-circle.is-selected").length,
      };
    }, currentSegment.id);
    assert.equal(segmentSelection.targetSelected, true, "対象IDの線分を選択できる");
    assert.equal(segmentSelection.selectedSegments, 1, "対象以外の線分を選択しない");
    assert.equal(segmentSelection.selectedCircles, 0, "円内部の線分選択で円を誤選択しない");

    const perimeterAngle = -Math.PI / 6;
    const radiusVector = { x: circleRadiusPoint.x - circleCenter.x, y: circleRadiusPoint.y - circleCenter.y };
    const circlePerimeter = {
      x: circleCenter.x + radiusVector.x * Math.cos(perimeterAngle) - radiusVector.y * Math.sin(perimeterAngle),
      y: circleCenter.y + radiusVector.x * Math.sin(perimeterAngle) + radiusVector.y * Math.cos(perimeterAngle),
    };
    const circleClient = await logicalClientPosition(svg, circlePerimeter);
    assert.equal(circleClient.top.kind, "object", `円周の最前面要素: ${JSON.stringify({ circleId: currentCircle.id, circlePerimeter, projection: circleClient })}`);
    assert.equal(circleClient.top.id, currentCircle.id, `円周の対象ID: ${JSON.stringify({ circleId: currentCircle.id, circlePerimeter, projection: circleClient })}`);
    assert.match(circleClient.top.className || "", /geometry-circle-hit/, `円周の要素種別: ${JSON.stringify({ circleId: currentCircle.id, circlePerimeter, projection: circleClient })}`);
    await page.mouse.click(circleClient.x, circleClient.y);
    const circleSelection = await svg.evaluate((element, circleId) => {
      const hit = element.querySelector(`.geometry-circle-hit[data-geometry-id="${circleId}"]`);
      return {
        targetSelected: hit?.nextElementSibling?.classList.contains("is-selected") === true,
        selectedSegments: element.querySelectorAll(".geometry-segment.is-selected").length,
        selectedCircles: element.querySelectorAll(".geometry-circle.is-selected").length,
      };
    }, currentCircle.id);
    assert.equal(circleSelection.targetSelected, true, "対象IDの円周を選択できる");
    assert.equal(circleSelection.selectedSegments, 0, "円周選択時に線分を誤選択しない");
    assert.equal(circleSelection.selectedCircles, 1, "対象以外の円を選択しない");

    const beforeCircleMove = await geometry(page);
    const beforeCenter = beforeCircleMove.points.find((point) => point.id === currentCircle.pointIds[0]);
    const beforeRadiusPoint = beforeCircleMove.points.find((point) => point.id === currentCircle.pointIds[1]);
    await page.mouse.move(circleClient.x, circleClient.y);
    await page.mouse.down();
    await page.mouse.move(circleClient.x + 24, circleClient.y + 12);
    await page.mouse.up();
    const afterCircleMove = await geometry(page);
    const afterCenter = afterCircleMove.points.find((point) => point.id === currentCircle.pointIds[0]);
    const afterRadiusPoint = afterCircleMove.points.find((point) => point.id === currentCircle.pointIds[1]);
    assert.notDeepEqual(afterCenter, beforeCenter, "円周からドラッグすると円全体を移動できる");
    assertCoordinates({ x: afterRadiusPoint.x - beforeRadiusPoint.x, y: afterRadiusPoint.y - beforeRadiusPoint.y }, { x: afterCenter.x - beforeCenter.x, y: afterCenter.y - beforeCenter.y }, "円の中心点と円周点を同じ量だけ移動する");
    assert.deepEqual(afterCircleMove.objects.find((object) => object.id === currentSegment.id).pointIds, segmentPointIds, "共有点を移動しても線分の参照を維持する");

    const movedStart = afterCircleMove.points.find((point) => point.id === segmentPointIds[0]);
    const movedStartClient = await logicalClientPosition(svg, movedStart);
    assert.equal(movedStartClient.top.kind, "point", `円内の点の最前面要素: ${JSON.stringify({ pointId: movedStart.id, projection: movedStartClient })}`);
    assert.equal(movedStartClient.top.id, movedStart.id, `円内の点の対象ID: ${JSON.stringify({ pointId: movedStart.id, projection: movedStartClient })}`);
    assert.match(movedStartClient.top.className || "", /geometry-point-hit/, `円内の点の要素種別: ${JSON.stringify({ pointId: movedStart.id, projection: movedStartClient })}`);
    await page.mouse.click(movedStartClient.x, movedStartClient.y);
    const pointSelection = await svg.evaluate((element, pointId) => {
      const hit = element.querySelector(`.geometry-point-hit[data-geometry-id="${pointId}"]`);
      return { targetSelected: hit?.nextElementSibling?.classList.contains("is-selected") === true, selectedPoints: element.querySelectorAll(".geometry-point.is-selected").length };
    }, movedStart.id);
    assert.equal(pointSelection.targetSelected, true, "対象IDの円内の点を選択できる");
    assert.equal(pointSelection.selectedPoints, 1, "対象以外の点を選択しない");
    assert.equal(pageErrors.length, 0, "独立シナリオで未処理例外を出さない");
  } finally {
    await context.close();
  }
}

(async () => {
  const { server, url } = await startStaticServer();
  const browser = await launchBrowser();
  try {
    await runRightAngleEditorScenario(browser, url);
    await runCircleInteriorSelectionScenario(browser, url);
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await waitForApp(page, url);
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
    const segmentPointIds = afterPoints.points.slice(0, 2).map((point) => point.id);
    await clickLocatorCenter(page, editor.locator(`.geometry-point-hit[data-geometry-id="${segmentPointIds[0]}"]`), "線分の始点を選択できる");
    await clickLocatorCenter(page, editor.locator(`.geometry-point-hit[data-geometry-id="${segmentPointIds[1]}"]`), "線分の終点を選択できる");
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "segment").length, 1, "線分を追加できる");
    assert.deepEqual((await geometry(page)).objects.find((object) => object.type === "segment").pointIds, segmentPointIds, "線分は選択した2点を参照する");

    await editor.locator('[data-geometry-mode="polygon"]').click();
    const polygonPointIds = afterPoints.points.map((point) => point.id);
    await clickLocatorCenter(page, editor.locator(`.geometry-point-hit[data-geometry-id="${polygonPointIds[0]}"]`), "多角形の始点を選択できる");
    await clickLocatorCenter(page, editor.locator(`.geometry-point-hit[data-geometry-id="${polygonPointIds[1]}"]`), "多角形の2点目を選択できる");
    await clickLocatorCenter(page, editor.locator(`.geometry-point-hit[data-geometry-id="${polygonPointIds[2]}"]`), "多角形の3点目を選択できる");
    await clickLocatorCenter(page, editor.locator(`.geometry-point-hit[data-geometry-id="${polygonPointIds[0]}"]`), "多角形を始点で完成できる");
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "polygon").length, 1, "多角形を追加できる");
    assert.deepEqual((await geometry(page)).objects.find((object) => object.type === "polygon").pointIds, polygonPointIds, "多角形は選択した点を指定順に参照する");
    assert.equal(await editor.locator(".geometry-draft").count(), 0, "多角形完成後に作成途中の破線を残さない");

    await editor.locator('[data-geometry-mode="polygon"]').click();
    await clickLocatorCenter(page, editor.locator(`.geometry-point-hit[data-geometry-id="${polygonPointIds[0]}"]`), "作成途中の多角形の始点を選択できる");
    await clickLocatorCenter(page, editor.locator(`.geometry-point-hit[data-geometry-id="${polygonPointIds[1]}"]`), "作成途中の多角形へ点を追加できる");
    assert.equal(await editor.locator(".geometry-draft").count(), 1, "多角形作成中は破線を表示する");
    await editor.locator('[data-geometry-mode="segment"]').click();
    assert.equal(await editor.locator(".geometry-draft").count(), 0, "モード切替後に作成途中の破線を残さない");
    assert.equal(await editor.locator(".geometry-point.is-draft").count(), 0, "モード切替後に作成途中の点強調を残さない");
    await editor.locator('[data-geometry-mode="polygon"]').click();
    await clickLocatorCenter(page, editor.locator(`.geometry-point-hit[data-geometry-id="${polygonPointIds[0]}"]`), "作成途中の多角形の点を選択できる");
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
    const circleAlignment = await alignSvgForPointer(svg);
    assertSvgAlignment(circleAlignment.before, circleAlignment.after, "円作成前のSVG表示領域を安定させる");
    const circleCenterClient = { x: Math.round(circleAlignment.after.x + 455), y: Math.round(circleAlignment.after.y + 95) };
    const circleRadiusClient = { x: Math.round(circleAlignment.after.x + 485), y: Math.round(circleAlignment.after.y + 95) };
    const beforeCircle = await geometry(page);
    await page.mouse.click(circleCenterClient.x, circleCenterClient.y);
    assert.equal((await geometry(page)).points.length, beforeCircle.points.length, "円の1点目は確定点へ追加しない");
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "circle").length, 0, "円の1点目だけでは円を追加しない");
    assert.equal(await editor.locator('button[aria-label="図形の作成途中の操作をキャンセル"]').isEnabled(), true, "円の1点目後は作成途中操作を取り消せる");
    await page.mouse.click(circleRadiusClient.x, circleRadiusClient.y);
    await page.waitForFunction(() => window.MemoNexusGeometryBlockUtils.splitGeometryBlocks(document.getElementById("editor").value).some((segment) => segment.type === "geometry" && segment.geometry.objects.some((object) => object.type === "circle")));
    const createdCircleGeometry = await geometry(page);
    const createdCircle = createdCircleGeometry.objects.find((object) => object.type === "circle");
    assert.equal(createdCircleGeometry.points.length, beforeCircle.points.length + 2, "円の2点目後に確定点を2件追加する");
    assert.deepEqual(createdCircle.pointIds, createdCircleGeometry.points.slice(-2).map((point) => point.id), "新規座標で作成した円は今回追加した2点を参照する");
    assert.equal(createdCircleGeometry.points.at(-2).x === createdCircleGeometry.points.at(-1).x && createdCircleGeometry.points.at(-2).y === createdCircleGeometry.points.at(-1).y, false, "円の中心点と円周点は異なる座標にする");
    assert.equal(await editor.locator('button[aria-label="図形の作成途中の操作をキャンセル"]').isEnabled(), false, "円の完成後は作成途中状態を解除する");

    await editor.locator('[data-geometry-mode="select"]').click();
    const dragAlignment = await alignSvgForPointer(svg);
    assertSvgAlignment(dragAlignment.before, dragAlignment.after, "ドラッグ前のSVG表示領域を安定させる");
    assertSvgAlignment(dragAlignment.after, circleAlignment.after, "円作成時とドラッグ時でSVGのCTMと表示位置を一致させる");
    const dragCircleBefore = (await geometry(page)).objects.find((object) => object.type === "circle");
    const centerPointBefore = (await geometry(page)).points.find((point) => point.id === dragCircleBefore.pointIds[0]);
    const radiusPointBefore = (await geometry(page)).points.find((point) => point.id === dragCircleBefore.pointIds[1]);
    const centerHit = editor.locator(`[data-geometry-kind="point"][data-geometry-id="${dragCircleBefore.pointIds[0]}"]`);
    const radiusHit = editor.locator(`[data-geometry-kind="point"][data-geometry-id="${dragCircleBefore.pointIds[1]}"]`);
    await centerHit.waitFor({ state: "visible" });
    await radiusHit.waitFor({ state: "visible" });
    await page.mouse.move(circleCenterClient.x, circleCenterClient.y);
    await page.mouse.down();
    await page.mouse.move(circleRadiusClient.x, circleRadiusClient.y);
    const afterInvalidDrag = await geometry(page);
    assertCoordinates(afterInvalidDrag.points.find((point) => point.id === dragCircleBefore.pointIds[0]), centerPointBefore, "半径0になるドラッグでは最後の正常な中心座標を維持する");
    assert.match(await editor.locator(".geometry-block-status").textContent(), /中心と円周上の点は同じ位置にできません/, "無効なドラッグ理由を表示する");
    assert.equal(pageErrors.length, 0, "無効なドラッグで未処理例外を出さない");
    await page.mouse.move(circleRadiusClient.x + 25, circleRadiusClient.y + 15);
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
    const beforeZeroRadius = await geometry(page);
    await svg.click({ position: { x: 500, y: 200 } });
    await svg.click({ position: { x: 500, y: 200 } });
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "circle").length, beforeZeroRadius.objects.filter((object) => object.type === "circle").length, "同じ位置を2回指定しても半径0の円を追加しない");
    await svg.click({ position: { x: 540, y: 200 } });
    assert.equal((await geometry(page)).objects.filter((object) => object.type === "circle").length, beforeZeroRadius.objects.filter((object) => object.type === "circle").length + 1, "半径0エラー後に円周上の点を指定し直せる");

    await editor.locator('[data-geometry-mode="select"]').click();
    const pointMoveAlignment = await alignSvgForPointer(svg);
    assertSvgAlignment(pointMoveAlignment.before, pointMoveAlignment.after, "点移動前のSVG表示領域を安定させる");
    const beforeMove = await geometry(page);
    const movedPointReferenceIds = beforeMove.objects
      .filter((object) => (object.type === "segment" || object.type === "polygon") && object.pointIds.includes(beforeMove.points[0].id))
      .map((object) => object.id);
    const pointBeforeMove = beforeMove.points[0];
    const expectedDragEnd = { x: pointBeforeMove.x + 8, y: pointBeforeMove.y + 8 };
    assert.equal(beforeMove.points.some((point) => point.id !== pointBeforeMove.id && point.x === expectedDragEnd.x && point.y === expectedDragEnd.y), false, "点の移動先は他の既存点と重ならない");
    const pointDragStart = await logicalClientPosition(svg, pointBeforeMove);
    const pointDragEnd = await logicalClientPosition(svg, expectedDragEnd);
    assert.equal(pointDragStart.top.kind, "point", `点ドラッグ始点の最前面要素: ${JSON.stringify({ pointId: pointBeforeMove.id, projection: pointDragStart })}`);
    assert.equal(pointDragStart.top.id, pointBeforeMove.id, `点ドラッグ始点の対象ID: ${JSON.stringify({ pointId: pointBeforeMove.id, projection: pointDragStart })}`);
    await page.mouse.move(pointDragStart.x, pointDragStart.y);
    await page.mouse.down();
    await page.mouse.move(pointDragEnd.x, pointDragEnd.y);
    await page.mouse.up();
    const moved = await geometry(page);
    assert.notEqual(moved.points[0].x, beforeMove.points[0].x, "点をドラッグ移動できる");
    assertCoordinates(moved.points[0], expectedDragEnd, "ドラッグ終了位置を保存する", 0.5);
    assert.deepEqual(moved.objects.filter((object) => (object.type === "segment" || object.type === "polygon") && object.pointIds.includes(moved.points[0].id)).map((object) => object.id), movedPointReferenceIds, "移動後も既存の参照構造を維持する");
    const movedPointSelection = await svg.evaluate((element, pointId) => {
      const hit = element.querySelector(`.geometry-point-hit[data-geometry-id="${pointId}"]`);
      return { targetSelected: hit?.nextElementSibling?.classList.contains("is-selected") === true, selectedPoints: element.querySelectorAll(".geometry-point.is-selected").length };
    }, moved.points[0].id);
    assert.equal(movedPointSelection.targetSelected, true, "ドラッグ後も対象IDの点を選択したままにする");
    assert.equal(movedPointSelection.selectedPoints, 1, "ドラッグ後に対象以外の点を選択しない");
    await editor.locator('input[aria-label="選択した点の頂点名"]').fill("P");
    await editor.locator('input[aria-label="選択した点の頂点名"]').blur();
    await editor.locator(".geometry-segment-hit").click();
    await editor.locator('select[aria-label="選択した線分の線種"]').selectOption("dashed");
    await editor.locator('input[aria-label="選択した辺の長さ表示"]').fill("5 cm");
    await editor.locator('input[aria-label="選択した辺の長さ表示"]').blur();
    const polygonSelectionAlignment = await alignSvgForPointer(svg);
    assertSvgAlignment(polygonSelectionAlignment.before, polygonSelectionAlignment.after, "多角形選択前のSVG表示領域を安定させる");
    const geometryForPolygonSelection = await geometry(page);
    const selectablePolygon = geometryForPolygonSelection.objects.filter((object) => object.type === "polygon")[1];
    const polygonVertices = selectablePolygon.pointIds.map((pointId) => geometryForPolygonSelection.points.find((point) => point.id === pointId));
    const polygonInterior = {
      x: polygonVertices[0].x * 0.6 + polygonVertices[1].x * 0.2 + polygonVertices[2].x * 0.2,
      y: polygonVertices[0].y * 0.6 + polygonVertices[1].y * 0.2 + polygonVertices[2].y * 0.2,
    };
    const polygonClient = await logicalClientPosition(svg, polygonInterior);
    assert.equal(polygonClient.top.kind, "object", `多角形内部の最前面要素: ${JSON.stringify({ polygonId: selectablePolygon.id, polygonInterior, projection: polygonClient })}`);
    assert.equal(polygonClient.top.id, selectablePolygon.id, `多角形内部の対象ID: ${JSON.stringify({ polygonId: selectablePolygon.id, polygonInterior, projection: polygonClient })}`);
    assert.match(polygonClient.top.className || "", /geometry-polygon/, `多角形内部の要素種別: ${JSON.stringify({ polygonId: selectablePolygon.id, polygonInterior, projection: polygonClient })}`);
    await page.mouse.click(polygonClient.x, polygonClient.y);
    await editor.locator('select[aria-label="選択した図形の辺"]').selectOption("1");
    await editor.locator('input[aria-label="選択した辺の長さ表示"]').fill("a");
    await editor.locator('input[aria-label="選択した辺の長さ表示"]').blur();
    await page.evaluate(() => window.flushSave());
    const beforeReload = await geometry(page);
    assert.equal(beforeReload.annotations.find((annotation) => annotation.pointId === beforeReload.points[0].id).label, "P");
    assert.equal(beforeReload.objects.find((object) => object.type === "segment").lineStyle, "dashed");
    assert.equal(beforeReload.annotations.some((annotation) => annotation.type === "length-label" && annotation.label === "5 cm"), true, "線分の長さ表示を保存する");
    assert.equal(beforeReload.annotations.some((annotation) => annotation.type === "length-label" && annotation.label === "a" && annotation.edgeIndex === 1), true, "多角形の辺の長さ表示を保存する");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    const restored = await geometry(page);
    assert.equal(restored.points.length, 14, "再読み込み後も図形を構成する点を復元する");
    assert.equal(restored.objects.filter((object) => object.type === "polygon").length, 3, "再読み込み後も三角形・四角形を含む多角形を復元する");
    assert.equal(restored.objects.filter((object) => object.type === "circle").length, 2, "再読み込み後も円を復元する");
    const restoredDraggedCircle = restored.objects.find((object) => object.id === dragCircleBefore.id);
    const restoredCenter = restored.points.find((point) => point.id === restoredDraggedCircle.pointIds[0]);
    const restoredRadius = restored.points.find((point) => point.id === restoredDraggedCircle.pointIds[1]);
    assertCoordinates(restoredCenter, recoveredCenter, "無効位置を避けて確定した円を再読み込み後も復元する");
    assert.equal(restoredCenter.x === restoredRadius.x && restoredCenter.y === restoredRadius.y, false, "再読み込み後も半径0の円にしない");
    assert.equal(restored.objects.find((object) => object.type === "segment").lineStyle, "dashed", "線種を復元する");

    // 作図用UIの有無に依存させず、意味付き幾何スキーマそのものを
    // 保存して再読込する。SVGのdata属性も正規化済みモデルを検証する。
    let semanticBeforeReload = await page.evaluate(() => {
      const blocks = window.MemoNexusGeometryBlockUtils;
      const model = window.MemoNexusGeometryEditorUtils;
      let value = blocks.createGeometryBlock("semantic-e2e");
      [[20, 80], [20, 20], [80, 20], [80, 80]].forEach(([x, y]) => { value = model.addPoint(value, { x, y }); });
      value = model.updateVertexLabel(value, value.points[0].id, "A");
      value = model.updateVertexLabel(value, value.points[1].id, "B");
      value = model.updateVertexLabel(value, value.points[2].id, "C");
      value = model.updateVertexLabel(value, value.points[3].id, "D");
      value = model.addSegment(value, value.points[0].id, value.points[1].id);
      value = model.addSegment(value, value.points[1].id, value.points[2].id);
      value = model.addSegment(value, value.points[2].id, value.points[3].id);
      value = model.addSegment(value, value.points[0].id, value.points[2].id, "dashed");
      const [ab, bc, cd, ac] = value.objects;
      value = model.addRightAngle(value, { vertexId: value.points[1].id, rayVertexIds: [value.points[0].id, value.points[2].id], segmentIds: [ab.id, bc.id] });
      value = model.addAngle(value, { vertexId: value.points[1].id, rayVertexIds: [value.points[0].id, value.points[2].id], segmentIds: [ab.id, bc.id], value: 90, unit: "°" });
      value = model.addLengthAnnotation(value, { segmentId: ab.id, value: 5, unit: "cm" });
      value = model.addEqualLengthMark(value, { segmentIds: [ab.id, bc.id], markCount: 1 });
      value = model.addParallelMark(value, { segmentIds: [ab.id, cd.id], markCount: 2 });
      value.objects.find((object) => object.id === ac.id).role = "diagonal";
      const input = document.getElementById("editor");
      window.__geometryEditorsBeforeSemanticInput = Array.from(document.querySelectorAll(".geometry-block-editor"));
      input.value = `前\n${blocks.serializeGeometryBlock(value)}\n後`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return value;
    });
    await page.waitForFunction(() => {
      const editors = Array.from(document.querySelectorAll(".geometry-block-editor"));
      return editors.length === 1
        && editors[0].dataset.geometryId === "semantic-e2e"
        && editors[0].querySelectorAll('[data-geometry-type="right-angle"]').length === 1
        && window.__geometryEditorsBeforeSemanticInput.every((editor) => !editor.isConnected);
    });
    const semanticEditor = page.locator(".geometry-block-editor");
    await semanticEditor.evaluate((element) => { window.__semanticGeometryEditor = element; });
    assert.equal(await semanticEditor.locator('[data-geometry-type="right-angle"]').getAttribute("data-vertex-id"), semanticBeforeReload.points[1].id, "直角記号が頂点IDを保持する");
    assert.equal(await semanticEditor.locator('[data-geometry-type="angle"]').getAttribute("data-vertex-id"), semanticBeforeReload.points[1].id, "角度表示が中心頂点IDを保持する");
    assert.equal(await semanticEditor.locator('[data-geometry-type="length-label"]').getAttribute("data-segment-id"), semanticBeforeReload.objects[0].id, "辺長表示が線分IDを保持する");
    assert.equal(await semanticEditor.locator('[data-geometry-type="equal-length"]').count(), 2, "等辺記号が対象2線分へ描画される");
    assert.equal(await semanticEditor.locator('[data-geometry-type="parallel"]').count(), 2, "平行記号が対象2線分へ描画される");
    assert.equal(await semanticEditor.locator(`[data-geometry-id="${semanticBeforeReload.objects[3].id}"]`).getAttribute("data-segment-role"), "diagonal", "対角線の意味ロールをSVGへ反映する");
    await page.waitForFunction(() => document.querySelectorAll('#preview [data-geometry-type="right-angle"]').length === 1);
    assert.equal(await page.locator('#preview [data-geometry-type="angle"]').getAttribute("data-vertex-id"), semanticBeforeReload.points[1].id, "カード表示も同じ意味付きSVGレンダラーで角度を描画する");
    await semanticEditor.locator(".geometry-point-hit").first().click();
    const semanticLabelInput = semanticEditor.locator('input[aria-label="選択した点の頂点名"]');
    await semanticLabelInput.fill("A1");
    await semanticLabelInput.press("Tab");
    await page.waitForFunction((pointId) => {
      const editor = document.querySelector('.geometry-block-editor[data-geometry-id="semantic-e2e"]');
      const geometry = window.MemoNexusGeometryBlockUtils.splitGeometryBlocks(document.getElementById("editor").value)
        .find((segment) => segment.type === "geometry")?.geometry;
      const point = editor?.querySelector(`.geometry-point-hit[data-geometry-id="${pointId}"]`);
      return editor === window.__semanticGeometryEditor
        && point?.nextElementSibling?.classList.contains("is-selected") === true
        && geometry?.annotations.find((annotation) => annotation.pointId === pointId)?.label === "A1";
    }, semanticBeforeReload.points[0].id);
    semanticBeforeReload = await geometry(page);
    assert.equal(semanticBeforeReload.annotations.find((annotation) => annotation.pointId === semanticBeforeReload.points[0].id)?.label, "A1", "構造化図形編集は本文の意味付きデータを更新する");
    await page.evaluate(() => window.flushSave());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    const semanticRestored = await geometry(page);
    assert.deepEqual(semanticRestored, semanticBeforeReload, "意味付き図形を保存・再読み込み後も同じデータとして復元する");
    assert.equal(await page.locator('.geometry-block-editor [data-geometry-type="right-angle"]').getAttribute("data-vertex-id"), semanticBeforeReload.points[1].id, "再読み込み後も直角の意味属性を復元する");

    await page.setViewportSize({ width: 390, height: 760 });
    const contextPanel = page.locator("#contextPanel");
    if (await contextPanel.getAttribute("aria-hidden") === "false") {
      await page.locator("#closeContextPanelBtn").click();
      await page.waitForFunction(() => {
        const panel = document.getElementById("contextPanel");
        const style = getComputedStyle(panel);
        return panel.getAttribute("aria-hidden") === "true" && (style.display === "none" || style.visibility === "hidden");
      });
    }
    const mobileEditor = page.locator(".geometry-block-editor");
    const mobileSvg = mobileEditor.locator("svg");
    await mobileSvg.waitFor({ state: "visible" });
    assert.ok(await mobileEditor.locator(".geometry-point-hit").count(), "モバイル幅でもタップ用の点判定領域を維持する");
    await mobileEditor.locator('[data-geometry-mode="point"]').click();
    const mobileAlignment = await alignSvgForPointer(mobileSvg);
    assertSvgAlignment(mobileAlignment.before, mobileAlignment.after, "モバイル幅の点追加前にSVG表示領域を安定させる");
    const beforeMobilePoint = await geometry(page);
    const expectedMobilePoint = { x: beforeMobilePoint.viewBox.x + 10, y: beforeMobilePoint.viewBox.y + beforeMobilePoint.viewBox.height - 10 };
    const mobilePointClient = await logicalClientPosition(mobileSvg, expectedMobilePoint);
    assert.equal(mobilePointClient.top.kind, undefined, `モバイル幅の新規点位置を既存図形と重ねない: ${JSON.stringify({ expectedMobilePoint, projection: mobilePointClient })}`);
    assert.equal(mobilePointClient.top.tag?.toLowerCase(), "svg", `モバイル幅の新規点位置をSVG内に置く: ${JSON.stringify({ expectedMobilePoint, projection: mobilePointClient })}`);
    await page.mouse.click(mobilePointClient.x, mobilePointClient.y);
    const mobileGeometry = await geometry(page);
    assert.equal(mobileGeometry.points.length, beforeMobilePoint.points.length + 1, "モバイル幅で新しい点を1件追加する");
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
    await page.evaluate(() => window.flushSave());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.equal(await geometry(page), null, "削除後の再読み込みで図形を復元しない");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
