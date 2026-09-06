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

async function geometryById(page, geometryId) {
  return page.evaluate((id) => window.MemoNexusGeometryBlockUtils.splitGeometryBlocks(document.getElementById("editor").value)
    .find((segment) => segment.type === "geometry" && segment.geometry.id === id)?.geometry || null, geometryId);
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

async function rightAngleMarkClientPosition(svg, annotationId) {
  return svg.evaluate((element, id) => {
    const mark = element.querySelector(`.geometry-right-angle-mark[data-geometry-id="${id}"]`);
    if (!mark) throw new Error(`直角注釈 ${id} の表示線が見つかりません`);
    const vertexId = mark.closest("g.geometry-right-angle")?.dataset.vertexId;
    const vertex = element.querySelector(`.geometry-point-hit[data-geometry-id="${vertexId}"]`);
    if (!vertex) throw new Error(`直角注釈 ${id} の頂点が見つかりません`);
    const matrix = element.getScreenCTM();
    const vertexScreen = new DOMPoint(Number(vertex.getAttribute("cx")), Number(vertex.getAttribute("cy"))).matrixTransform(matrix);
    const vertexPixel = { x: Math.round(vertexScreen.x), y: Math.round(vertexScreen.y) };
    const length = mark.getTotalLength();
    const attempts = [];
    for (const fraction of [.15, .35, .65, .85]) {
      const point = mark.getPointAtLength(length * fraction);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      const x = Math.round(screen.x);
      const y = Math.round(screen.y);
      const stack = document.elementsFromPoint(x, y);
      const hit = stack.find((node) => element.contains(node) && node.matches?.(`.geometry-right-angle-hit[data-geometry-id="${id}"]`));
      const top = document.elementFromPoint(x, y);
      const topTarget = top?.closest("[data-geometry-kind]");
      const distanceFromVertexCenter = Math.hypot(x - vertexScreen.x, y - vertexScreen.y);
      if (hit && (x !== vertexPixel.x || y !== vertexPixel.y)) {
        return {
          x,
          y,
          fraction,
          distanceFromVertexCenter,
          top: { tag: top?.tagName, className: top?.getAttribute("class"), kind: topTarget?.dataset?.geometryKind, id: topTarget?.dataset?.geometryId },
          resolved: { id: hit.dataset.geometryId }
        };
      }
      attempts.push({ fraction, x, y, distanceFromVertexCenter, tag: top?.tagName, className: top?.getAttribute("class"), hitId: hit?.dataset.geometryId });
    }
    throw new Error(`直角注釈 ${id} の表示線上に、頂点中心と異なる実クリック座標を取得できません: ${JSON.stringify(attempts)}`);
  }, annotationId);
}

async function formerRightAngleHitClientPosition(svg, annotationId) {
  return svg.evaluate((element, id) => {
    const mark = element.querySelector(`.geometry-right-angle-mark[data-geometry-id="${id}"]`);
    const vertexId = mark?.closest("g.geometry-right-angle")?.dataset.vertexId;
    const vertex = element.querySelector(`.geometry-point-hit[data-geometry-id="${vertexId}"]`);
    if (!mark || !vertex) throw new Error(`直角注釈 ${id} の旧ヒット位置を計算できません`);
    const point = mark.getPointAtLength(mark.getTotalLength() / 2);
    const vertexX = Number(vertex.getAttribute("cx"));
    const vertexY = Number(vertex.getAttribute("cy"));
    const logicalPoint = { x: vertexX + (point.x - vertexX) * 2, y: vertexY + (point.y - vertexY) * 2 };
    const screen = new DOMPoint(logicalPoint.x, logicalPoint.y).matrixTransform(element.getScreenCTM());
    const x = Math.round(screen.x);
    const y = Math.round(screen.y);
    const stack = document.elementsFromPoint(x, y);
    return {
      x,
      y,
      annotationId: stack.find((node) => element.contains(node) && node.matches?.(`.geometry-right-angle-hit[data-geometry-id="${id}"]`))?.dataset.geometryId
    };
  }, annotationId);
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
    for (const logicalPoint of [{ x: 20, y: 75 }, { x: 20, y: 20 }, { x: 75, y: 20 }, { x: 75, y: 75 }]) {
      const client = await logicalClientPosition(svg, logicalPoint);
      assert.equal(client.top.tag?.toLowerCase(), "svg", "新しい頂点の位置は既存の選択対象と重ならない");
      await page.mouse.click(client.x, client.y);
    }
    const pointsGeometry = await geometry(page);
    assert.equal(pointsGeometry.points.length, 4, "直角注釈用に有効・無効方向を含む4点を作成する");
    const [firstRay, vertex, secondRay, invalidRay] = pointsGeometry.points;

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
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${invalidRay.id}"]`), "直角から外れた2本目の方向を選択できる");
    assert.equal((await geometry(page)).annotations.filter((item) => item.type === "right-angle").length, 0, "範囲外の角度では直角注釈を追加しない");
    assert.match(await editor.locator(".geometry-block-status").textContent(), /80度から100度/, "許容角度のエラーを表示する");
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${secondRay.id}"]`), "直角の2本目の方向を選択できる");
    await page.waitForFunction(() => document.querySelectorAll(".geometry-block-editor g.geometry-right-angle").length === 1);
    const annotated = await geometry(page);
    const annotation = annotated.annotations.find((item) => item.type === "right-angle");
    assert.equal(annotation.vertexId, vertex.id, "直角注釈は選択した頂点IDを保存する");
    assert.deepEqual(annotation.rayVertexIds, [firstRay.id, secondRay.id], "直角注釈は選択順の方向点IDを保存する");
    assert.equal(annotation.segmentIds?.length, 2, "安全に特定できる2本の線分IDも保存する");
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${vertex.id}"]`), "重複確認用に直角の頂点を再選択できる");
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${secondRay.id}"]`), "重複確認用に方向点を逆順で選択できる");
    await clickLocatorCenter(page, editor.locator(`[data-geometry-kind="point"][data-geometry-id="${firstRay.id}"]`), "重複確認用に2本目の方向を選択できる");
    assert.equal((await geometry(page)).annotations.filter((item) => item.type === "right-angle").length, 1, "方向点の順序を変えても直角注釈を重複追加しない");
    assert.match(await editor.locator(".geometry-block-status").textContent(), /既に追加/, "重複エラーを表示する");
    await editor.locator("button", { hasText: "作成をキャンセル" }).click();
    await editor.locator('[data-geometry-mode="select"]').click();
    assert.equal(await editor.locator('[data-geometry-mode="select"]').getAttribute("aria-pressed"), "true", "エラー後もキャンセルとモード切替を行える");
    const mark = editor.locator(`g.geometry-right-angle[data-geometry-id="${annotation.id}"]`);
    const hit = mark.locator(".geometry-right-angle-hit");
    assert.equal(await hit.getAttribute("data-geometry-id"), annotation.id, "直角記号のヒット領域は対象注釈IDを持つ");
    assert.equal(await mark.locator(".geometry-right-angle-mark").getAttribute("pointer-events"), "none", "直角記号の表示線はポインターを奪わない");
    const beforePath = await mark.locator(".geometry-right-angle-mark").getAttribute("d");
    assert.equal(await hit.getAttribute("d"), beforePath, "表示線とヒット領域は同じ直角記号を表す");

    const rightAngleAlignment = await alignSvgForPointer(svg);
    assertSvgAlignment(rightAngleAlignment.before, rightAngleAlignment.after, "直角記号選択前にSVGを安定させる");
    const markClient = await rightAngleMarkClientPosition(svg, annotation.id);
    assert.equal(markClient.resolved.id, annotation.id, "表示線上の実クリック座標は対象直角注釈へ解決する");
    const vertexBefore = (await geometry(page)).points.find((point) => point.id === vertex.id);
    await page.mouse.click(markClient.x, markClient.y);
    assert.match(await mark.getAttribute("class"), /is-selected/, "直角記号自身を選択できる");
    assertCoordinates((await geometry(page)).points.find((point) => point.id === vertex.id), vertexBefore, "直角記号のクリックだけでは頂点を移動しない");
    const vertexClient = await logicalClientPosition(svg, vertexBefore);
    assert.equal(vertexClient.top.kind, "point", "頂点中心は従来どおり頂点の操作対象を優先する");
    await page.mouse.click(vertexClient.x, vertexClient.y);
    await page.waitForFunction((pointId) => document.querySelector(`.geometry-point-hit[data-geometry-id="${pointId}"]`)?.nextElementSibling?.classList.contains("is-selected") === true, vertex.id);
    const formerHitClient = await formerRightAngleHitClientPosition(svg, annotation.id);
    assert.equal(formerHitClient.annotationId, undefined, "旧hitSize: 12相当の外側位置に直角注釈のヒット領域を残さない");
    await page.mouse.click(formerHitClient.x, formerHitClient.y);
    await page.waitForFunction((annotationId) => !document.querySelector(`g.geometry-right-angle[data-geometry-id="${annotationId}"]`)?.classList.contains("is-selected"), annotation.id);
    const pointEnd = await logicalClientPosition(svg, { x: vertexBefore.x + 8, y: vertexBefore.y + 7 });
    await page.mouse.move(vertexClient.x, vertexClient.y);
    await page.mouse.down();
    await page.mouse.move(pointEnd.x, pointEnd.y);
    await page.mouse.up();
    await page.waitForFunction(({ id, path }) => document.querySelector(`g.geometry-right-angle[data-geometry-id="${id}"] .geometry-right-angle-mark`)?.getAttribute("d") !== path, { id: annotation.id, path: beforePath });
    assert.notDeepEqual((await geometry(page)).points.find((point) => point.id === vertex.id), vertexBefore, "頂点中心からのドラッグで対象頂点を移動できる");
    assert.deepEqual((await geometry(page)).annotations.find((item) => item.id === annotation.id).rayVertexIds, annotation.rayVertexIds, "点移動後も直角注釈の参照IDを維持する");

    await page.evaluate(() => window.flushSave());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    const restored = await geometry(page);
    const restoredAnnotation = restored.annotations.find((item) => item.id === annotation.id);
    assert.equal(restoredAnnotation.vertexId, vertex.id, "保存・再読込後も直角の頂点IDを復元する");
    assert.deepEqual(restoredAnnotation.rayVertexIds, [firstRay.id, secondRay.id], "保存・再読込後も直角の方向点IDを復元する");
    assert.equal(await page.locator(`.geometry-block-editor g.geometry-right-angle[data-geometry-id="${annotation.id}"]`).count(), 1, "保存・再読込後もSVGへ直角記号を再描画する");

    const restoredEditor = page.locator(".geometry-block-editor");
    const restoredSvg = restoredEditor.locator("svg");
    const restoredAlignment = await alignSvgForPointer(restoredSvg);
    assertSvgAlignment(restoredAlignment.before, restoredAlignment.after, "再読込後の直角記号選択前にSVGを安定させる");
    const restoredMarkClient = await rightAngleMarkClientPosition(restoredSvg, annotation.id);
    assert.equal(restoredMarkClient.resolved.id, annotation.id, "再読込後も表示線上の実クリック座標を直角注釈へ解決する");
    await page.mouse.click(restoredMarkClient.x, restoredMarkClient.y);
    await page.waitForFunction((annotationId) => document.querySelector(`g.geometry-right-angle[data-geometry-id="${annotationId}"]`)?.classList.contains("is-selected") === true, annotation.id);
    await restoredEditor.locator("button", { hasText: "選択を削除" }).click();
    await page.waitForFunction((annotationId) => !document.querySelector(`g.geometry-right-angle[data-geometry-id="${annotationId}"]`), annotation.id);
    await restoredEditor.locator("button", { hasText: "戻す" }).click();
    await page.waitForFunction((annotationId) => Boolean(document.querySelector(`g.geometry-right-angle[data-geometry-id="${annotationId}"]`)), annotation.id);
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

async function runRightAngleOverlapScenario(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await waitForApp(page, url);
    const setup = await page.evaluate(() => {
      const blocks = window.MemoNexusGeometryBlockUtils;
      const model = window.MemoNexusGeometryEditorUtils;
      const build = (id, viewBoxSize, size) => {
        let value = blocks.createGeometryBlock(id);
        value = { ...value, viewBox: { x: 0, y: 0, width: viewBoxSize, height: viewBoxSize } };
        const offset = viewBoxSize / 5;
        [[offset, offset * 3], [offset, offset], [offset * 3, offset]].forEach(([x, y]) => { value = model.addPoint(value, { x, y }); });
        const [firstRay, vertex, secondRay] = value.points;
        value = model.addSegment(value, vertex.id, firstRay.id);
        value = model.addSegment(value, vertex.id, secondRay.id);
        const [firstSegment, secondSegment] = value.objects;
        value = model.addRightAngle(value, {
          vertexId: vertex.id,
          rayVertexIds: [firstRay.id, secondRay.id],
          segmentIds: [firstSegment.id, secondSegment.id],
          size
        });
        return { geometry: value, vertexId: vertex.id, annotationId: value.annotations.find((annotation) => annotation.type === "right-angle").id };
      };
      const small = build("right-angle-overlap-small", 500, 2);
      const standard = build("right-angle-overlap-standard", 100, 6);
      const input = document.getElementById("editor");
      input.value = `${blocks.serializeGeometryBlock(small.geometry)}\n${blocks.serializeGeometryBlock(standard.geometry)}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return { small: { id: small.geometry.id, vertexId: small.vertexId, annotationId: small.annotationId }, standard: { id: standard.geometry.id, annotationId: standard.annotationId } };
    });
    await page.waitForFunction(({ small, standard }) => document.querySelectorAll(".geometry-block-editor").length === 2
      && document.querySelector(`.geometry-block-editor[data-geometry-id="${small.id}"] g.geometry-right-angle[data-geometry-id="${small.annotationId}"]`)
      && document.querySelector(`.geometry-block-editor[data-geometry-id="${standard.id}"] g.geometry-right-angle[data-geometry-id="${standard.annotationId}"]`), setup);

    const smallEditor = page.locator(`.geometry-block-editor[data-geometry-id="${setup.small.id}"]`);
    const smallSvg = smallEditor.locator("svg");
    const smallMark = smallEditor.locator(`g.geometry-right-angle[data-geometry-id="${setup.small.annotationId}"]`);
    const standardEditor = page.locator(`.geometry-block-editor[data-geometry-id="${setup.standard.id}"]`);
    const standardSvg = standardEditor.locator("svg");
    const standardMark = standardEditor.locator(`g.geometry-right-angle[data-geometry-id="${setup.standard.annotationId}"]`);
    assert.equal(await page.locator(".geometry-block-editor").count(), 2, "複数SVGでも直角注釈用の編集領域を独立して描画する");

    const smallBefore = await geometryById(page, setup.small.id);
    assert.equal(smallBefore.viewBox.width, 500, "縮小競合ケースのviewBoxを保存する");
    assert.equal(smallBefore.annotations.find((annotation) => annotation.id === setup.small.annotationId)?.size, 2, "縮小競合ケースの明示sizeを保存する");
    const smallAlignment = await alignSvgForPointer(smallSvg);
    assertSvgAlignment(smallAlignment.before, smallAlignment.after, "縮小直角記号の実クリック前にSVGを安定させる");
    const smallClient = await rightAngleMarkClientPosition(smallSvg, setup.small.annotationId);
    assert.ok(smallClient.distanceFromVertexCenter <= 6, "縮小直角記号の実クリック座標はCTM変換後も頂点中心から6px以内にある");
    assert.equal(smallClient.top.kind, "point", "縮小直角記号と頂点ヒット円が競合する座標をelementFromPointで確認する");
    assert.equal(smallClient.resolved.id, setup.small.annotationId, "競合座標の同一SVG内ヒット領域は対象直角注釈IDを持つ");
    await page.mouse.click(smallClient.x, smallClient.y);
    await page.waitForFunction(({ geometryId, annotationId }) => document.querySelector(`.geometry-block-editor[data-geometry-id="${geometryId}"] g.geometry-right-angle[data-geometry-id="${annotationId}"]`)?.classList.contains("is-selected") === true, { geometryId: setup.small.id, annotationId: setup.small.annotationId });
    assert.equal(await standardMark.evaluate((element) => element.classList.contains("is-selected")), false, "別SVGの直角注釈を選択しない");
    assertCoordinates((await geometryById(page, setup.small.id)).points.find((point) => point.id === setup.small.vertexId), smallBefore.points.find((point) => point.id === setup.small.vertexId), "縮小直角記号のクリックだけでは頂点を移動しない");

    await smallEditor.locator("button", { hasText: "選択を削除" }).click();
    await page.waitForFunction(({ geometryId, annotationId }) => !document.querySelector(`.geometry-block-editor[data-geometry-id="${geometryId}"] g.geometry-right-angle[data-geometry-id="${annotationId}"]`), { geometryId: setup.small.id, annotationId: setup.small.annotationId });
    await smallEditor.locator("button", { hasText: "戻す" }).click();
    await page.waitForFunction(({ geometryId, annotationId }) => Boolean(document.querySelector(`.geometry-block-editor[data-geometry-id="${geometryId}"] g.geometry-right-angle[data-geometry-id="${annotationId}"]`)), { geometryId: setup.small.id, annotationId: setup.small.annotationId });

    const standardAlignment = await alignSvgForPointer(standardSvg);
    assertSvgAlignment(standardAlignment.before, standardAlignment.after, "通常サイズ直角記号の実クリック前にSVGを安定させる");
    const standardClient = await rightAngleMarkClientPosition(standardSvg, setup.standard.annotationId);
    assert.equal(standardClient.resolved.id, setup.standard.annotationId, "通常サイズの直角記号も現在のSVG内ヒット領域へ解決する");
    await page.mouse.click(standardClient.x, standardClient.y);
    await page.waitForFunction(({ geometryId, annotationId }) => document.querySelector(`.geometry-block-editor[data-geometry-id="${geometryId}"] g.geometry-right-angle[data-geometry-id="${annotationId}"]`)?.classList.contains("is-selected") === true, { geometryId: setup.standard.id, annotationId: setup.standard.annotationId });

    await page.evaluate(() => window.flushSave());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    const restoredSmall = await geometryById(page, setup.small.id);
    assert.equal(restoredSmall.viewBox.width, 500, "縮小競合ケースのviewBoxを再読み込み後も維持する");
    assert.equal(restoredSmall.annotations.find((annotation) => annotation.id === setup.small.annotationId)?.size, 2, "縮小競合ケースの明示sizeを再読み込み後も維持する");
    const restoredSmallEditor = page.locator(`.geometry-block-editor[data-geometry-id="${setup.small.id}"]`);
    const restoredSmallSvg = restoredSmallEditor.locator("svg");
    const restoredSmallAlignment = await alignSvgForPointer(restoredSmallSvg);
    assertSvgAlignment(restoredSmallAlignment.before, restoredSmallAlignment.after, "再読み込み後の縮小直角記号の頂点操作前にSVGを安定させる");
    const restoredVertex = restoredSmall.points.find((point) => point.id === setup.small.vertexId);
    const restoredVertexClient = await logicalClientPosition(restoredSmallSvg, restoredVertex);
    assert.equal(restoredVertexClient.top.kind, "point", "縮小直角記号の頂点中心は従来どおり頂点の操作対象を優先する");
    await page.mouse.click(restoredVertexClient.x, restoredVertexClient.y);
    await page.waitForFunction(({ geometryId, pointId }) => {
      const editor = document.querySelector(`.geometry-block-editor[data-geometry-id="${geometryId}"]`);
      return editor?.querySelector(`.geometry-point-hit[data-geometry-id="${pointId}"]`)?.nextElementSibling?.classList.contains("is-selected") === true
        && editor.querySelectorAll(".geometry-point.is-selected").length === 1;
    }, { geometryId: setup.small.id, pointId: setup.small.vertexId });
    const movedVertexClient = await logicalClientPosition(restoredSmallSvg, { x: restoredVertex.x + 10, y: restoredVertex.y + 10 });
    await page.mouse.move(restoredVertexClient.x, restoredVertexClient.y);
    await page.mouse.down();
    await page.mouse.move(movedVertexClient.x, movedVertexClient.y);
    await page.mouse.up();
    await page.waitForFunction(({ geometryId, pointId, before }) => {
      const geometry = window.MemoNexusGeometryBlockUtils.splitGeometryBlocks(document.getElementById("editor").value)
        .find((segment) => segment.type === "geometry" && segment.geometry.id === geometryId)?.geometry;
      const point = geometry?.points.find((entry) => entry.id === pointId);
      return point && (point.x !== before.x || point.y !== before.y);
    }, { geometryId: setup.small.id, pointId: setup.small.vertexId, before: restoredVertex });
    assert.equal(pageErrors.length, 0, "縮小直角記号の競合シナリオで未処理例外を出さない");
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
    await runRightAngleOverlapScenario(browser, url);
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
        && editors[0].querySelectorAll("g.geometry-right-angle").length === 1
        && window.__geometryEditorsBeforeSemanticInput.every((editor) => !editor.isConnected);
    });
    const semanticEditor = page.locator(".geometry-block-editor");
    await semanticEditor.evaluate((element) => { window.__semanticGeometryEditor = element; });
    assert.equal(await semanticEditor.locator("g.geometry-right-angle").getAttribute("data-vertex-id"), semanticBeforeReload.points[1].id, "直角記号が頂点IDを保持する");
    assert.equal(await semanticEditor.locator('[data-geometry-type="angle"]').getAttribute("data-vertex-id"), semanticBeforeReload.points[1].id, "角度表示が中心頂点IDを保持する");
    assert.equal(await semanticEditor.locator('[data-geometry-type="length-label"]').getAttribute("data-segment-id"), semanticBeforeReload.objects[0].id, "辺長表示が線分IDを保持する");
    assert.equal(await semanticEditor.locator('[data-geometry-type="equal-length"]').count(), 2, "等辺記号が対象2線分へ描画される");
    assert.equal(await semanticEditor.locator('[data-geometry-type="parallel"]').count(), 2, "平行記号が対象2線分へ描画される");
    assert.equal(await semanticEditor.locator(`[data-geometry-id="${semanticBeforeReload.objects[3].id}"]`).getAttribute("data-segment-role"), "diagonal", "対角線の意味ロールをSVGへ反映する");
    await page.waitForFunction(() => document.querySelectorAll("#preview g.geometry-right-angle").length === 1);
    assert.equal(await page.locator('#preview [data-geometry-type="angle"]').getAttribute("data-vertex-id"), semanticBeforeReload.points[1].id, "カード表示も同じ意味付きSVGレンダラーで角度を描画する");
    const targetPointId = semanticBeforeReload.points[0].id;
    const targetPoint = semanticEditor.locator(`.geometry-point-hit[data-geometry-kind="point"][data-geometry-id="${targetPointId}"]`);
    await targetPoint.waitFor();
    await clickLocatorCenter(page, targetPoint, "セマンティック図形編集の対象点IDを指定して選択する");
    const semanticLabelInput = semanticEditor.locator('input[aria-label="選択した点の頂点名"]');
    await semanticLabelInput.fill("A1");
    await semanticLabelInput.press("Tab");
    await page.waitForFunction((pointId) => {
      const editor = document.querySelector('.geometry-block-editor[data-geometry-id="semantic-e2e"]');
      const geometry = window.MemoNexusGeometryBlockUtils.splitGeometryBlocks(document.getElementById("editor").value)
        .find((segment) => segment.type === "geometry")?.geometry;
      const point = editor?.querySelector(`.geometry-point-hit[data-geometry-kind="point"][data-geometry-id="${pointId}"]`);
      const selectedPoints = editor?.querySelectorAll(".geometry-point.is-selected") || [];
      return editor === window.__semanticGeometryEditor
        && selectedPoints.length === 1
        && point?.nextElementSibling?.classList.contains("is-selected") === true
        && geometry?.annotations.find((annotation) => annotation.pointId === pointId)?.label === "A1";
    }, targetPointId);
    semanticBeforeReload = await geometry(page);
    assert.equal(semanticBeforeReload.annotations.find((annotation) => annotation.pointId === targetPointId)?.label, "A1", "構造化図形編集は本文の意味付きデータを更新する");
    await page.evaluate(() => window.flushSave());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    const semanticRestored = await geometry(page);
    assert.deepEqual(semanticRestored, semanticBeforeReload, "意味付き図形を保存・再読み込み後も同じデータとして復元する");
    assert.equal(await page.locator(".geometry-block-editor g.geometry-right-angle").getAttribute("data-vertex-id"), semanticBeforeReload.points[1].id, "再読み込み後も直角の意味属性を復元する");

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
