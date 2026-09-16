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

async function waitForPieSlices(page, expectedCount) {
  try {
    await page.waitForFunction((count) => document.querySelectorAll("#preview .chart-block-pie-slice").length === count, expectedCount);
  } catch (error) {
    const state = await page.evaluate(() => {
      const chart = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
        .find((segment) => segment.type === "chart")?.chart;
      return {
        chartType: chart?.chartType,
        itemLabels: chart?.items?.map((item) => item.label),
        editorChartType: document.querySelector('.chart-block-editor select[data-chart-field="chartType"]')?.value,
        previewClass: document.querySelector("#preview .chart-block")?.className,
        previewSliceCount: document.querySelectorAll("#preview .chart-block-pie-slice").length
      };
    });
    error.message = `${error.message}\nPie preview state: ${JSON.stringify(state)}`;
    throw error;
  }
}

function chart(page) {
  return page.evaluate(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
    .find((segment) => segment.type === "chart")?.chart || null);
}

function charts(page) {
  return page.evaluate(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
    .filter((segment) => segment.type === "chart").map((segment) => segment.chart));
}

async function waitForChartEditorSyncAfterBodyInput(page, expectedCount) {
  // 1. Playwrightが書き込んだ本文自体にマーカーがあることを確認する。
  await page.waitForFunction((count) => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
    .filter((segment) => segment.type === "chart").length === count, expectedCount);
  // 2. full要求の登録、またはその要求が現行revisionの本文モデルからプレビューまで描画済みであることを待つ。
  await page.waitForFunction((count) => window.MemoNexusTypingDerivedUiScheduler?.pendingRequestType() === "full"
    || document.querySelectorAll("#preview .chart-block").length === count, expectedCount);
  await page.waitForFunction((count) => document.querySelectorAll("#preview .chart-block").length === count, expectedCount);
  // 3. 同じfull描画で構造化編集欄も追従したことを最後に確認する。
  await page.waitForFunction((count) => document.querySelectorAll(".chart-block-editor").length === count, expectedCount);
}

async function waitForChartCancelCompletion(page, chartIndex) {
  await page.waitForFunction((index) => document.querySelectorAll(".chart-block-editor")[index]
    ?.querySelector(".chart-block-status")?.textContent === "編集内容を取り消しました", chartIndex);
}

async function checkboxLayout(input) {
  return input.evaluate((checkbox) => {
    const label = checkbox.closest("label");
    const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const textRange = document.createRange();
    textRange.selectNode(textNode);
    const toRect = (rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    return {
      className: label.className,
      display: getComputedStyle(label).display,
      checkbox: toRect(checkbox.getBoundingClientRect()),
      text: toRect(textRange.getBoundingClientRect())
    };
  });
}

function assertInlineCheckboxLayout(layout, name) {
  assert.match(layout.className, /\bchart-block-appearance-checkbox\b/, `${name}に専用クラスを付ける`);
  assert.equal(layout.display, "flex", `${name}を横並びflexで表示する`);
  assert.ok(layout.checkbox.right <= layout.text.left, `${name}のチェックボックスを文言の左に置く`);
  assert.ok(Math.abs((layout.checkbox.top + layout.checkbox.bottom) / 2 - (layout.text.top + layout.text.bottom) / 2) <= 2, `${name}のチェックボックスと文言を縦中央で揃える`);
}

function boxesOverlap(first, second) {
  return first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;
}

function boxesHaveGap(first, second, minimumGap = 2) {
  return first.x + first.width + minimumGap <= second.x || second.x + second.width + minimumGap <= first.x || first.y + first.height + minimumGap <= second.y || second.y + second.height + minimumGap <= first.y;
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
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.route("https://cdn.jsdelivr.net/**", (route) => {
      const pathname = new URL(route.request().url()).pathname.toLowerCase();
      return pathname.endsWith(".css")
        ? route.fulfill({ contentType: "text/css", body: "" })
        : route.fulfill({ contentType: "text/javascript", body: "window.katex={renderToString:String};window.mermaid={initialize(){},render:async()=>({svg:'<svg></svg>'})};window.hljs={highlightAuto:()=>({value:''}),getLanguage:()=>false};" });
    });
    await waitForApp(page);
    await page.locator("#editor").fill("グラフの前\nグラフの後");
    await page.locator("#insertChartBtn").click();
    const editor = page.locator(".chart-block-editor");
    await editor.waitFor({ state: "visible" });
    assert.equal(await editor.locator('button[data-chart-action="move-item-up"]').isDisabled(), true, "1項目だけでは上へを無効化する");
    assert.equal(await editor.locator('button[data-chart-action="move-item-down"]').isDisabled(), true, "1項目だけでは下へを無効化する");
    assert.equal(await editor.locator('button[data-chart-action="move-item-up"]').getAttribute("aria-label"), "1件目の項目を上へ移動", "空の項目名は項目番号で移動操作を識別する");
    assert.equal(await editor.locator('button[data-chart-action="move-series-up"]').isDisabled(), true, "1系列だけでは系列の上へを無効化する");
    assert.equal(await editor.locator('button[data-chart-action="move-series-down"]').isDisabled(), true, "1系列だけでは系列の下へを無効化する");
    await editor.locator('input[aria-label="グラフ1のタイトル"]').fill("テスト得点");
    await editor.locator('input[aria-label="グラフ1の単位"]').fill("点");
    await editor.locator('input[aria-label="1件目の項目名"]').fill("国語");
    await editor.locator('input[aria-label="1件目の数値"]').fill("70.5");
    await editor.locator('button[data-chart-action="add-item"]').click();
    await editor.locator('input[aria-label="2件目の項目名"]').fill("数学");
    await editor.locator('input[aria-label="2件目の数値"]').fill("0");
    await editor.locator('input[aria-label="グラフ1の棒の色"]').evaluate((input) => { input.value = "#dc2626"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    assertInlineCheckboxLayout(await checkboxLayout(editor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]')), "棒の上に数値を表示");
    await editor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]').uncheck();
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.title === "テスト得点" && current.unit === "点" && current.items.length === 2 && current.series[0].values[0] === 70.5 && current.series[0].values[1] === 0 && current.appearance.color === "#dc2626" && current.appearance.showValues === false;
    });
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 2);
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-value").length === 0);
    assert.equal(await page.locator("#preview .chart-block-bar").count(), 2, "保存前プレビューは2本の棒を描画する");
    assert.equal(await page.locator("#preview .chart-block-value").count(), 0, "数値表示オフを即時反映する");
    assert.equal(await page.locator("#preview .chart-block-bar rect").first().getAttribute("fill"), "#dc2626", "選択色を全棒へ反映する");
    assert.equal(await page.locator("#preview .chart-block-edit").count(), 1, "カードに再編集操作を表示する");
    await page.locator("#preview .chart-block-edit").click();
    assert.equal(await editor.evaluate((element) => document.activeElement === element), true, "カードの編集操作が対応する編集欄へ移動する");
    const firstValue = editor.locator('input[aria-label="1件目の数値"]');
    await firstValue.fill("");
    assert.equal(await firstValue.getAttribute("aria-invalid"), "true", "空の数値欄を不正として公開する");
    assert.equal((await chart(page)).series[0].values[0], 70.5, "不正な空入力は直前の有効な保存値を置き換えない");
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
      .find((segment) => segment.type === "chart")?.chart.series[0].values[0] === 72.25);
    assert.equal(await firstValue.getAttribute("aria-invalid"), null, "有効な数値へ修正すると不正状態を解除する");
    await editor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    await editor.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart.chartType === "line");
    const lineEditor = page.locator(".chart-block-editor");
    assert.equal(await lineEditor.locator('input[aria-label="1件目の項目名"]').inputValue(), "国語", "棒グラフから折れ線グラフへの切替でも項目名を保持する");
    assert.equal(await lineEditor.locator('input[aria-label="1件目の数値"]').inputValue(), "72.25", "棒グラフから折れ線グラフへの切替でも数値を保持する");
    assert.equal(await lineEditor.locator('input[aria-label="グラフ1のデータ点を表示"]').isChecked(), true, "折れ線グラフはデータ点を既定で表示する");
    assertInlineCheckboxLayout(await checkboxLayout(lineEditor.locator('input[aria-label="グラフ1のデータ点の数値を表示"]')), "データ点の数値を表示");
    assertInlineCheckboxLayout(await checkboxLayout(lineEditor.locator('input[aria-label="グラフ1のデータ点を表示"]')), "データ点を表示");
    assertInlineCheckboxLayout(await checkboxLayout(lineEditor.locator('input[aria-label="グラフ1の凡例を表示"]')), "折れ線グラフの凡例を表示");
    await lineEditor.locator('input[aria-label="グラフ1のデータ点の数値を表示"]').check();
    await lineEditor.locator('input[aria-label="グラフ1の凡例を表示"]').check();
    await lineEditor.locator('input[aria-label="2件目の数値"]').fill("27.75");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line-item").length === 2 && document.querySelectorAll("#preview .chart-block-line-point").length === 2);
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line .chart-block-value").length === 2);
    assert.equal(await page.locator("#preview .chart-block-line-path").count(), 1, "複数項目の折れ線グラフは点を直線で接続する");
    assert.deepEqual(await page.locator("#preview .chart-block-line-item").evaluateAll((items) => items.map((item) => item.dataset.chartItemId)), (await chart(page)).items.map((item) => item.id), "入力順を点と接続順へ維持する");
    const lineCoordinates = await page.locator("#preview .chart-block-line-point").evaluateAll((points) => points.map((point) => ({ x: Number(point.getAttribute("cx")), y: Number(point.getAttribute("cy")) })));
    assert.ok(lineCoordinates.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), "小数値でも有限な折れ線座標を描画する");
    assert.ok(lineCoordinates[0].x < lineCoordinates[1].x, "入力順に横軸を左から右へ並べる");
    const lineChart = await chart(page);
    const lineSvgState = await page.locator("#preview .chart-block-line svg").evaluate((svg, firstItemId) => {
      const firstItem = [...svg.querySelectorAll(".chart-block-line-item")].find((item) => item.dataset.chartItemId === firstItemId);
      const toBox = (element) => {
        const box = element.getBBox();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      const polyline = svg.querySelector(".chart-block-line-path");
      return {
        pathCount: svg.querySelectorAll(".chart-block-line-path").length,
        pointCount: svg.querySelectorAll(".chart-block-line-point").length,
        valueCount: svg.querySelectorAll(".chart-block-value").length,
        labelCount: svg.querySelectorAll(".chart-block-label").length,
        pointCoordinates: [...svg.querySelectorAll(".chart-block-line-point")].map((point) => [Number(point.getAttribute("cx")), Number(point.getAttribute("cy"))]),
        polylineCoordinates: (polyline?.getAttribute("points") || "").trim().split(/\s+/).filter(Boolean).flatMap((point) => point.split(",").map(Number)),
        firstValue: toBox(firstItem.querySelector(".chart-block-value")),
        unit: toBox(svg.querySelector(".chart-block-unit")),
        maximum: toBox(svg.querySelector(".chart-block-axis-maximum"))
      };
    }, lineChart.items[0].id);
    assert.deepEqual([lineSvgState.pathCount, lineSvgState.pointCount, lineSvgState.valueCount, lineSvgState.labelCount], [1, 2, 2, 2], "先頭が最大値でも線・点・数値・項目名を表示する");
    assert.ok([...lineSvgState.pointCoordinates.flat(), ...lineSvgState.polylineCoordinates].every(Number.isFinite), "折れ線と点の生成座標をすべて有限にする");
    assert.equal(boxesOverlap(lineSvgState.firstValue, lineSvgState.unit), false, "先頭の数値と単位を重ねない");
    assert.equal(boxesOverlap(lineSvgState.firstValue, lineSvgState.maximum), false, "先頭の数値とY軸最大値を重ねない");
    assert.equal(boxesOverlap(lineSvgState.unit, lineSvgState.maximum), false, "単位とY軸最大値を重ねない");
    await lineEditor.locator('input[aria-label="1件目の数値"]').fill("2.5");
    await lineEditor.locator('input[aria-label="2件目の数値"]').fill("2.5");
    await page.waitForFunction(() => {
      const points = [...document.querySelectorAll("#preview .chart-block-line-point")];
      return points.length === 2 && points[0].getAttribute("cy") === points[1].getAttribute("cy");
    });
    await lineEditor.locator('input[aria-label="1件目の数値"]').fill("72.25");
    await lineEditor.locator('input[aria-label="2件目の数値"]').fill("27.75");
    await lineEditor.locator('input[aria-label="グラフ1のデータ点を表示"]').uncheck();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line-point").length === 0);
    await lineEditor.locator('input[aria-label="グラフ1のデータ点を表示"]').check();
    await lineEditor.locator('input[aria-label="1件目の項目名"]').fill("");
    await lineEditor.locator('input[aria-label="2件目の項目名"]').fill("");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-line .chart-block-empty")?.textContent === "項目名と0以上の数値を入力してください");
    await lineEditor.locator('input[aria-label="1件目の項目名"]').fill("国語");
    await lineEditor.locator('input[aria-label="2件目の項目名"]').fill("数学");
    await lineEditor.locator('button[data-chart-action="delete-item"]').last().click();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line-point").length === 1 && document.querySelectorAll("#preview .chart-block-line-path").length === 0);
    await page.locator('.chart-block-editor button[data-chart-action="add-item"]').click();
    await page.locator('input[aria-label="2件目の項目名"]').fill("数学");
    await page.locator('input[aria-label="2件目の数値"]').fill("27.75");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line-point").length === 2);
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("pie");
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart.chartType === "pie");
    const pieEditor = page.locator(".chart-block-editor");
    assert.equal(await pieEditor.locator('input[aria-label="1件目の項目名"]').inputValue(), "国語", "折れ線グラフから円グラフへの切替でも項目名を保持する");
    assert.equal(await pieEditor.locator('input[aria-label="1件目の数値"]').inputValue(), "72.25", "折れ線グラフから円グラフへの切替でも数値を保持する");
    await waitForPieSlices(page, 2);
    assert.equal(await page.locator("#preview .chart-block-pie-label").count(), 2, "割合ラベルを既定で描画する");
    assert.match(await page.locator("#preview .chart-block-pie-label").first().textContent(), /72\.3%/, "割合は小数第1位で統一して丸める");
    const pieFills = await page.locator("#preview .chart-block-pie-slice").evaluateAll((slices) => slices.map((slice) => slice.getAttribute("fill")));
    assert.notEqual(pieFills[0], pieFills[1], "各扇形を識別可能な色で描画する");
    assertInlineCheckboxLayout(await checkboxLayout(pieEditor.locator('input[aria-label="グラフ1の凡例を表示"]')), "円グラフの凡例を表示");
    await pieEditor.locator('input[aria-label="グラフ1の凡例を表示"]').check();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-legend li").length === 2);
    await pieEditor.locator('select[aria-label="グラフ1の円グラフのラベル"]').selectOption("value");
    await page.waitForFunction(() => [...document.querySelectorAll("#preview .chart-block-pie-label")].some((label) => label.textContent === "72.25点"));
    await pieEditor.locator('select[aria-label="グラフ1の円グラフのラベル"]').selectOption("none");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-pie-label").length === 0);
    await pieEditor.locator('select[aria-label="グラフ1の円グラフのラベル"]').selectOption("percentage");
    await pieEditor.locator('input[aria-label="1件目の数値"]').fill("0");
    await pieEditor.locator('input[aria-label="2件目の数値"]').fill("0");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-pie .chart-block-empty")?.textContent === "円グラフを表示できる有効な数値がありません");
    await pieEditor.locator('input[aria-label="1件目の数値"]').fill("72.25");
    await pieEditor.locator('input[aria-label="2件目の数値"]').fill("27.75");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-pie-slice").length === 2);
    await pieEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    await pieEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 2);
    assert.equal(await page.locator('input[aria-label="2件目の数値"]').inputValue(), "27.75", "円グラフから棒グラフへの切替でも数値を保持する");
    await page.locator('.chart-block-editor button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    const beforeCancel = await chart(page);
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("pie");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-pie-slice").length === 2);
    await page.locator('.chart-block-editor button[data-chart-action="cancel"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart.chartType === "bar");
    assert.deepEqual(await chart(page), beforeCancel, "編集を取り消すと開始時の棒グラフ、ID、共通データ、表示設定へ戻す");
    await page.locator('.chart-block-editor button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    const beforeReload = await chart(page);
    assert.deepEqual({ ...beforeReload.appearance, pieSeriesId: undefined }, { color: "#dc2626", barMode: "grouped", barOrientation: "vertical", showStackTotals: false, showValues: true, showPoints: true, showLegend: true, pieLabelMode: "percentage", pieSeriesId: undefined }, "棒グラフへ戻しても色・数値・点・凡例設定を保存する");
    assert.equal(beforeReload.appearance.pieSeriesId, beforeReload.series[0].id, "既定の円グラフ表示系列IDを保存する");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.deepEqual(await chart(page), beforeReload, "再読み込み後もグラフ保存データを復元する");
    assert.equal(await page.locator("#preview .chart-block-bar").count(), 2, "再読み込み後もカードの棒グラフを復元する");
    assert.equal(await page.locator('select[aria-label="グラフ1の種類"]').inputValue(), "bar", "再編集時に棒グラフ種別を復元する");
    assert.equal(await page.locator('input[aria-label="グラフ1の棒の上に数値を表示"]').isChecked(), true, "再編集時に数値表示設定を復元する");
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.locator('.chart-block-editor button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    const lineBeforeReload = await chart(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.deepEqual(await chart(page), lineBeforeReload, "折れ線グラフも再読み込み後に保存データを復元する");
    assert.equal(await page.locator("#preview .chart-block-line").count(), 1, "再読み込み後もカードの折れ線グラフを復元する");
    assert.equal(await page.locator('select[aria-label="グラフ1の種類"]').inputValue(), "line", "再編集時に折れ線グラフ種別を復元する");
    await page.locator('input[aria-label="グラフ1のタイトル"]').fill("更新後の得点");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block").length === 1 && document.querySelector("#preview .chart-block figcaption")?.textContent === "更新後の得点");
    await page.locator("#settingsBtn").click();
    await page.locator("#themeSelect").selectOption("dark");
    await page.waitForFunction(() => document.body.classList.contains("dark"));
    const darkLineStyles = await page.locator("#preview .chart-block-line-path").evaluate((line) => ({ stroke: getComputedStyle(line).stroke, visibility: getComputedStyle(line).visibility }));
    assert.notEqual(darkLineStyles.stroke, "none", "ダークテーマでも折れ線の色を維持する");
    assert.equal(darkLineStyles.visibility, "visible", "ダークテーマでも折れ線を表示する");
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 2);
    const darkBarStyles = await page.locator("#preview .chart-block-bar rect").first().evaluate((bar) => ({ fill: getComputedStyle(bar).fill, visibility: getComputedStyle(bar).visibility }));
    assert.notEqual(darkBarStyles.fill, "none", "ダークテーマでも棒の色を維持する");
    assert.equal(darkBarStyles.visibility, "visible", "ダークテーマでも棒を表示する");
    await page.locator("#themeSelect").selectOption("light");
    await page.waitForFunction(() => !document.body.classList.contains("dark"));
    await page.locator("#closeSettingsBtn").click();
    const duplicateSetup = await page.evaluate(() => {
      const { normalizeChartBlock, serializeChartBlock } = window.MemoNexusChartBlockUtils;
      const first = normalizeChartBlock({
        id: "duplicated-chart", chartType: "bar", title: "一つ目", unit: "件",
        items: [{ id: "first-item", label: "前半", value: 3 }],
        appearance: { color: "#2563eb", showValues: true, showPoints: true, showLegend: false, pieLabelMode: "percentage" }
      });
      const second = normalizeChartBlock({
        id: "duplicated-chart", chartType: "bar", title: "二つ目", unit: "個",
        items: [{ id: "second-item", label: "後半", value: 8 }],
        appearance: { color: "#16a34a", showValues: false, showPoints: false, showLegend: false, pieLabelMode: "percentage" }
      });
      const front = normalizeChartBlock({
        id: "front-chart", chartType: "pie", title: "前方追加", unit: "件",
        items: [{ id: "front-item", label: "先頭", value: 1 }],
        appearance: { color: "#7c3aed", showValues: true, showPoints: true, showLegend: true, pieLabelMode: "value" }
      });
      return { body: `${serializeChartBlock(first)}\n${serializeChartBlock(second)}`, first, second, frontMarker: serializeChartBlock(front) };
    });
    await page.locator("#editor").fill(duplicateSetup.body);
    await page.waitForFunction(() => document.querySelectorAll(".chart-block-editor").length === 2);
    let secondEditor = page.locator(".chart-block-editor").nth(1);
    await secondEditor.locator('input[aria-label="グラフ2のタイトル"]').fill("二つ目を変更");
    await secondEditor.locator('input[aria-label="グラフ2の単位"]').fill("点");
    await secondEditor.locator('input[aria-label="1件目の項目名"]').fill("後半を変更");
    await secondEditor.locator('input[aria-label="1件目の数値"]').fill("18.5");
    await secondEditor.locator('select[aria-label="グラフ2の種類"]').selectOption("pie");
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.chartType === "pie");
    secondEditor = page.locator(".chart-block-editor").nth(1);
    await secondEditor.locator('input[aria-label="グラフ2の凡例を表示"]').check();
    await secondEditor.locator('select[aria-label="グラフ2の円グラフのラベル"]').selectOption("value");
    await secondEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.title === "二つ目");
    let duplicateCharts = await charts(page);
    assert.deepEqual(duplicateCharts, [duplicateSetup.first, duplicateSetup.second], "同一chartIdでも2件目の取消は2件目自身の開始時状態だけを復元する");
    secondEditor = page.locator(".chart-block-editor").nth(1);
    await secondEditor.locator('select[aria-label="グラフ2の種類"]').selectOption("line");
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.chartType === "line");
    secondEditor = page.locator(".chart-block-editor").nth(1);
    await secondEditor.locator('input[aria-label="グラフ2のデータ点の数値を表示"]').check();
    await secondEditor.locator('input[aria-label="グラフ2の凡例を表示"]').check();
    await secondEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".chart-block-editor")[1]?.querySelector(".chart-block-status")?.textContent === "入力内容を保存しました");
    const confirmedSecond = (await charts(page))[1];
    secondEditor = page.locator(".chart-block-editor").nth(1);
    await secondEditor.locator('select[aria-label="グラフ2の種類"]').selectOption("pie");
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.chartType === "pie");
    await page.locator(".chart-block-editor").nth(1).locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.chartType === "line");
    await waitForChartCancelCompletion(page, 1);
    duplicateCharts = await charts(page);
    assert.deepEqual(duplicateCharts[0], duplicateSetup.first, "2件目の確定・取消でも1件目を変更しない");
    assert.deepEqual(duplicateCharts[1], confirmedSecond, "確定保存後の取消は直近の確定状態へ戻す");
    const duplicateBody = await page.locator("#editor").inputValue();
    await page.locator("#editor").fill(`${duplicateSetup.frontMarker}\n${duplicateBody}`);
    await waitForChartEditorSyncAfterBodyInput(page, 3);
    let movedSecondEditor = page.locator(".chart-block-editor").nth(2);
    await movedSecondEditor.locator('input[aria-label="グラフ3のタイトル"]').fill("前方追加後の変更");
    await movedSecondEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction((title) => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[2]?.chart.title === title, confirmedSecond.title);
    await waitForChartCancelCompletion(page, 2);
    duplicateCharts = await charts(page);
    assert.deepEqual(duplicateCharts.slice(1), [duplicateSetup.first, confirmedSecond], "前方グラフ追加後も2件目へ別ブロックの取消状態を適用しない");
    await page.locator("#editor").fill((await page.locator("#editor").inputValue()).replace(`${duplicateSetup.frontMarker}\n`, ""));
    await waitForChartEditorSyncAfterBodyInput(page, 2);
    movedSecondEditor = page.locator(".chart-block-editor").nth(1);
    await movedSecondEditor.locator('input[aria-label="グラフ2のタイトル"]').fill("前方削除後の変更");
    await movedSecondEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction((title) => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.title === title, confirmedSecond.title);
    assert.deepEqual(await charts(page), [duplicateSetup.first, confirmedSecond], "前方グラフ削除後も対象外のグラフを復元しない");
    const legacyMultiMarker = await page.evaluate(() => window.MemoNexusChartBlockUtils.serializeChartBlock({
      id: "legacy-multi", chartType: "bar", title: "月別比較", unit: "万円",
      items: [
        { id: "jan", label: "1月", value: 100 },
        { id: "feb", label: "2月", value: 140 },
        { id: "mar", label: "3月", value: 120 }
      ],
      appearance: { color: "#2563eb", showValues: true, showLegend: false }
    }));
    await page.locator("#editor").fill(legacyMultiMarker);
    await waitForChartEditorSyncAfterBodyInput(page, 1);
    let multiEditor = page.locator(".chart-block-editor");
    assert.equal(await multiEditor.locator('input[data-chart-series-field="name"]').count(), 1, "旧形式は編集時に1系列へ正規化する");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] input[data-chart-series-value][data-chart-series-index="0"]').getAttribute("aria-label"), "1件目の数値", "1系列では従来の数値ラベルを維持する");
    await multiEditor.locator('button[data-chart-action="add-series"]').click();
    multiEditor = page.locator(".chart-block-editor");
    await page.waitForFunction(() => {
      const editor = document.querySelector(".chart-block-editor");
      const labels = [...editor?.querySelectorAll('input[data-chart-series-value][data-chart-series-index="0"]') || []].map((input) => input.getAttribute("aria-label"));
      return labels.join(",") === "1件目の系列 1の数値,2件目の系列 1の数値,3件目の系列 1の数値";
    });
    const firstSeriesName = multiEditor.locator('input[data-chart-series-field="name"]').first();
    await firstSeriesName.fill("売上");
    await page.waitForFunction(() => {
      const editor = document.querySelector(".chart-block-editor");
      const nameInput = editor?.querySelector('.chart-block-series-row[data-chart-series-index="0"] input[data-chart-series-field="name"]');
      const header = editor?.querySelector('[data-chart-series-header-index="0"]')?.textContent;
      const labels = [...editor?.querySelectorAll('input[data-chart-series-value][data-chart-series-index="0"]') || []].map((input) => input.getAttribute("aria-label"));
      const legend = [...document.querySelectorAll("#preview .chart-block-legend li")].map((item) => item.textContent).join(",");
      return header === "売上"
        && labels.join(",") === "1件目の売上の数値,2件目の売上の数値,3件目の売上の数値"
        && legend === "売上,系列 2"
        && editor?.querySelector('.chart-block-series-row[data-chart-series-index="0"] button[data-chart-action="move-series-up"]')?.getAttribute("aria-label") === "売上を上へ移動"
        && editor?.querySelector('.chart-block-series-row[data-chart-series-index="0"] button[data-chart-action="move-series-down"]')?.getAttribute("aria-label") === "売上を下へ移動"
        && document.activeElement === nameInput
        && nameInput.selectionStart === nameInput.value.length
        && nameInput.selectionEnd === nameInput.value.length;
    });
    await multiEditor.locator('input[data-chart-series-field="name"]').nth(1).fill("利益");
    await multiEditor.locator('input[data-chart-series-field="color"]').nth(1).evaluate((input) => { input.value = "#16a34a"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await multiEditor.locator('input[data-chart-series-field="name"]').nth(1).fill("営業利益");
    assert.equal(await multiEditor.locator('.chart-block-series-row[data-chart-series-index="1"] button[data-chart-action="move-series-up"]').getAttribute("aria-label"), "営業利益を上へ移動", "系列名変更直後に上へ操作の読み上げ名を同期する");
    assert.equal(await multiEditor.locator('.chart-block-series-row[data-chart-series-index="1"] button[data-chart-action="move-series-down"]').getAttribute("aria-label"), "営業利益を下へ移動", "系列名変更直後に下へ操作の読み上げ名を同期する");
    await page.waitForFunction(() => {
      const editor = document.querySelector(".chart-block-editor");
      const header = editor?.querySelector('[data-chart-series-header-index="1"]')?.textContent;
      const ariaLabel = editor?.querySelector('.chart-block-item-row[data-chart-item-index="0"] input[data-chart-series-value][data-chart-series-index="1"]')?.getAttribute("aria-label");
      const legend = [...document.querySelectorAll("#preview .chart-block-legend li")].map((item) => item.textContent).join(",");
      return header === "営業利益" && ariaLabel === "1件目の営業利益の数値" && legend === "売上,営業利益";
    });
    for (const [itemIndex, value] of [30, 45, 38].entries()) {
      await multiEditor.locator(`.chart-block-item-row[data-chart-item-index="${itemIndex}"] input[data-chart-series-value][data-chart-series-index="1"]`).fill(String(value));
    }
    await multiEditor.locator('button[data-chart-action="add-series"]').click();
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('input[data-chart-series-field="name"]').nth(2).fill(" ");
    assert.equal(await multiEditor.locator('.chart-block-series-row[data-chart-series-index="2"] button[data-chart-action="move-series-up"]').getAttribute("aria-label"), "3件目の系列を上へ移動", "空白だけの系列名は番号へフォールバックする");
    assert.equal(await multiEditor.locator('.chart-block-series-row[data-chart-series-index="2"] button[data-chart-action="move-series-down"]').getAttribute("aria-label"), "3件目の系列を下へ移動", "空白だけの系列名は番号へフォールバックする");
    await multiEditor.locator('input[data-chart-series-field="name"]').nth(2).fill("原価");
    for (const [itemIndex, value] of [60, 80, 70].entries()) {
      await multiEditor.locator(`.chart-block-item-row[data-chart-item-index="${itemIndex}"] input[data-chart-series-value][data-chart-series-index="2"]`).fill(String(value));
    }
    assert.equal(await multiEditor.locator('button[data-chart-action="add-series"]').isDisabled(), true, "4系列目は追加できない");
    assert.equal(await multiEditor.locator(".chart-block-series-limit").textContent(), "系列は最大3つまでです。", "上限理由を表示する");
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.series.length === 3 && current.series.map((series) => series.name).join(",") === "売上,営業利益,原価"
        && JSON.stringify(current.series.map((series) => series.values)) === JSON.stringify([[100, 140, 120], [30, 45, 38], [60, 80, 70]]);
    });
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 9);
    assert.equal(await multiEditor.locator('.chart-block-series-row[data-chart-series-index="0"] button[data-chart-action="move-series-up"]').isDisabled(), true, "先頭系列の上へを無効化する");
    assert.equal(await multiEditor.locator('.chart-block-series-row[data-chart-series-index="2"] button[data-chart-action="move-series-down"]').isDisabled(), true, "末尾系列の下へを無効化する");
    const [salesSeriesId, profitSeriesId, costSeriesId] = (await chart(page)).series.map((series) => series.id);
    await multiEditor.locator('.chart-block-series-row[data-chart-series-index="1"] button[data-chart-action="move-series-up"]').click();
    await page.waitForFunction((profitId) => {
      const editor = document.querySelector(".chart-block-editor");
      return document.activeElement?.closest(".chart-block-series-row")?.dataset.chartSeriesId === profitId
        && document.activeElement?.getAttribute("data-chart-action") === "move-series-down"
        && editor?.querySelector(".chart-block-status")?.textContent === "営業利益を1番目へ移動しました";
    }, profitSeriesId);
    assert.deepEqual((await chart(page)).series.map((series) => [series.id, series.name, series.color, series.values]), [
      [profitSeriesId, "営業利益", "#16a34a", [30, 45, 38]],
      [salesSeriesId, "売上", "#2563eb", [100, 140, 120]],
      [costSeriesId, "原価", "#059669", [60, 80, 70]]
    ], "系列ID、名前、色、全値を一体で移動する");
    assert.deepEqual(await multiEditor.locator('[data-chart-series-header-index]').allTextContents(), ["営業利益", "売上", "原価"], "入力表の系列列を移動する");
    await page.waitForFunction(() => [...document.querySelectorAll("#preview .chart-block-legend li")].map((item) => item.textContent).join(",") === "営業利益,売上,原価");
    assert.deepEqual(await page.locator("#preview .chart-block-legend li").allTextContents(), ["営業利益", "売上", "原価"], "集合棒の凡例順を移動する");
    assert.deepEqual(await page.locator("#preview .chart-block-bar").evaluateAll((bars) => bars.slice(0, 3).map((bar) => bar.dataset.chartSeriesId)), [profitSeriesId, salesSeriesId, costSeriesId], "集合棒の左右順を移動する");
    const reorderBarMode = multiEditor.locator('select[aria-label="グラフ1の棒の表示方法"]');
    await reorderBarMode.selectOption("stacked");
    await page.waitForFunction((seriesIds) => JSON.stringify([...document.querySelectorAll("#preview .chart-block-stacked-bar")].slice(0, 3).map((entry) => entry.dataset.chartSeriesId)) === JSON.stringify(seriesIds), [profitSeriesId, salesSeriesId, costSeriesId]);
    assert.deepEqual(await page.locator("#preview .chart-block-stacked-bar").evaluateAll((bars) => bars.slice(0, 3).map((bar) => bar.dataset.chartSeriesId)), [profitSeriesId, salesSeriesId, costSeriesId], "積み上げ棒の順を移動する");
    await reorderBarMode.selectOption("percent-stacked");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked");
    assert.deepEqual(await page.locator("#preview .chart-block-percent-stacked-bar").evaluateAll((bars) => bars.slice(0, 3).map((bar) => bar.dataset.chartSeriesId)), [profitSeriesId, salesSeriesId, costSeriesId], "100%積み上げ棒の順を移動する");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line-series").length === 3);
    assert.deepEqual(await page.locator("#preview .chart-block-line-series").evaluateAll((lines) => lines.map((line) => line.dataset.chartSeriesId)), [profitSeriesId, salesSeriesId, costSeriesId], "折れ線の描画順を移動する");
    assert.deepEqual(await page.locator("#preview .chart-block-legend li").allTextContents(), ["営業利益", "売上", "原価"], "折れ線の凡例順を移動する");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("pie");
    const pieSeriesSelect = multiEditor.locator('select[aria-label="グラフ1の表示する系列"]');
    await page.waitForFunction((salesId) => document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === salesId, salesSeriesId);
    assert.deepEqual(await pieSeriesSelect.locator("option").evaluateAll((options) => options.map((option) => option.value)), [profitSeriesId, salesSeriesId, costSeriesId], "円グラフの表示系列選択肢は現在の系列順と安定IDを使う");
    assert.equal(await pieSeriesSelect.inputValue(), salesSeriesId, "並べ替え後も既定選択の系列IDを維持する");
    assert.deepEqual(await page.locator("#preview .chart-block-pie .sr-only li").allTextContents(), ["1月、売上: 100万円", "2月、売上: 140万円", "3月、売上: 120万円"], "円グラフの読み上げは選択系列の値を使う");
    await pieSeriesSelect.selectOption(profitSeriesId);
    await page.waitForFunction((profitId) => document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === profitId, profitSeriesId);
    await pieSeriesSelect.selectOption(salesSeriesId);
    await page.waitForFunction((salesId) => {
      const pie = document.querySelector("#preview .chart-block-pie");
      return pie?.dataset.chartSeriesId === salesId
        && pie.querySelector("svg")?.getAttribute("aria-label")?.includes("表示系列: 売上")
        && [...pie.querySelectorAll(".chart-block-legend li")].map((item) => item.textContent).join(",") === "1月: 100万円,2月: 140万円,3月: 120万円";
    }, salesSeriesId);
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${salesSeriesId}"] input[data-chart-series-field="name"]`).fill("売上実績");
    await page.waitForFunction((salesId) => document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === salesId
      && document.querySelector("#preview .chart-block-pie figcaption")?.textContent?.includes("売上実績")
      && document.querySelector("#preview .chart-block-pie svg")?.getAttribute("aria-label")?.includes("表示系列: 売上実績"), salesSeriesId);
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${salesSeriesId}"] input[data-chart-series-field="name"]`).fill("売上");
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${salesSeriesId}"] button[data-chart-action="move-series-down"]`).click();
    await page.waitForFunction((salesId) => document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === salesId, salesSeriesId);
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${salesSeriesId}"] button[data-chart-action="move-series-up"]`).click();
    await page.waitForFunction((salesId) => document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === salesId, salesSeriesId);
    assert.equal((await chart(page)).series.length, 3, "円グラフでも非表示系列を保持する");
    await multiEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${costSeriesId}"] button[data-chart-action="delete-series"]`).click();
    await page.waitForFunction((salesId) => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.series.length === 2 && current.appearance.pieSeriesId === salesId && document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === salesId;
    }, salesSeriesId);
    await multiEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction((salesId) => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.series.length === 3 && current.appearance.pieSeriesId === salesId;
    }, salesSeriesId);
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${salesSeriesId}"] button[data-chart-action="delete-series"]`).click();
    await page.waitForFunction((profitId) => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.appearance.pieSeriesId === profitId && document.querySelector("#preview .chart-block-pie")?.dataset.chartSeriesId === profitId;
    }, profitSeriesId);
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${costSeriesId}"] button[data-chart-action="delete-series"]`).click();
    await page.waitForFunction((profitId) => {
      const select = document.querySelector('.chart-block-editor select[data-chart-field="pieSeriesId"]');
      return select?.disabled === true && select.value === profitId;
    }, profitSeriesId);
    await multiEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction((salesId) => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.appearance?.pieSeriesId === salesId, salesSeriesId);
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator(`.chart-block-series-row[data-chart-series-id="${profitSeriesId}"] button[data-chart-action="move-series-down"]`).click();
    await page.waitForFunction((profitId) => document.activeElement?.closest(".chart-block-series-row")?.dataset.chartSeriesId === profitId
      && document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "営業利益を2番目へ移動しました", profitSeriesId);
    assert.deepEqual((await chart(page)).series.map((series) => series.id), [salesSeriesId, profitSeriesId, costSeriesId], "連続操作で元の系列順へ戻せる");
    await page.waitForFunction(() => [...document.querySelectorAll("#preview .chart-block-legend li")].map((item) => item.textContent).join(",") === "売上,営業利益,原価");
    multiEditor = page.locator(".chart-block-editor");
    const invalidSeriesReorderValue = multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] input[data-chart-series-value][data-chart-series-index="1"]');
    await invalidSeriesReorderValue.fill("Infinity");
    await multiEditor.locator('.chart-block-series-row[data-chart-series-index="1"] button[data-chart-action="move-series-up"]').click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "1件目の営業利益の数値"
      && document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "数値は0以上の有限な数値を入力してください");
    assert.equal(await invalidSeriesReorderValue.inputValue(), "Infinity", "不正な編集中の数値を系列移動で破棄しない");
    assert.deepEqual((await chart(page)).series.map((series) => series.id), [salesSeriesId, profitSeriesId, costSeriesId], "不正値では系列を移動しない");
    await invalidSeriesReorderValue.fill("30");
    await multiEditor.locator('select[aria-label="グラフ1の棒の表示方法"]').selectOption("grouped");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "grouped");
    assert.equal(await page.locator("#preview .chart-block-bar").count(), 9, "3項目・3系列を集合棒として描画する");
    assert.deepEqual(await page.locator("#preview .chart-block-legend li").allTextContents(), ["売上", "営業利益", "原価"], "凡例を系列名と色で表示する");
    assert.deepEqual(await page.locator("#preview .chart-block-bar-chart .sr-only li").allTextContents(), [
      "1月、売上: 100万円", "1月、営業利益: 30万円", "1月、原価: 60万円",
      "2月、売上: 140万円", "2月、営業利益: 45万円", "2月、原価: 80万円",
      "3月、売上: 120万円", "3月、営業利益: 38万円", "3月、原価: 70万円"
    ], "棒グラフは表示中の全系列を読み上げ対象にする");
    assert.equal(await page.locator("#preview .chart-block-bar-chart svg").getAttribute("viewBox"), "0 0 466 260", "集合棒グラフは全系列に必要な幅を確保する");
    const barMetrics = await page.locator("#preview .chart-block-bar rect").evaluateAll((bars) => bars.map((bar) => ({ x: Number(bar.getAttribute("x")), height: Number(bar.getAttribute("height")), fill: bar.getAttribute("fill") })));
    assert.ok(barMetrics.every((bar) => Number.isFinite(bar.x) && Number.isFinite(bar.height) && bar.height >= 0), "SVG属性に不正値を混入しない");
    assert.ok(barMetrics.some((bar) => bar.height === 142), "全系列の最大値140を高さ計算の基準へ使う");
    assert.notEqual(barMetrics[0].x, barMetrics[1].x, "同じ項目の系列を横に並べる");
    const firstItemNameInput = multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] input[data-chart-item-field="label"]');
    await firstItemNameInput.fill("4月");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] button[data-chart-action="move-item-up"]').getAttribute("aria-label"), "4月を上へ移動", "項目名変更直後に上へボタンの読み上げ名を同期する");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] button[data-chart-action="move-item-down"]').getAttribute("aria-label"), "4月を下へ移動", "項目名変更直後に下へボタンの読み上げ名を同期する");
    assert.equal(await firstItemNameInput.evaluate((input) => document.activeElement === input && input.selectionStart === input.value.length && input.selectionEnd === input.value.length), true, "項目名入力中に編集欄を再描画せずフォーカスとキャレットを維持する");
    await firstItemNameInput.fill(" ");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] button[data-chart-action="move-item-up"]').getAttribute("aria-label"), "1件目の項目を上へ移動", "空白だけの項目名は上へボタンで項目番号へフォールバックする");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] button[data-chart-action="move-item-down"]').getAttribute("aria-label"), "1件目の項目を下へ移動", "空白だけの項目名は下へボタンで項目番号へフォールバックする");
    await firstItemNameInput.fill("4月");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] button[data-chart-action="move-item-down"]').click();
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.items.map((item) => item.label).join(",") === "2月,4月,3月"
        && JSON.stringify(current.series.map((series) => series.values)) === JSON.stringify([[140, 100, 120], [45, 30, 38], [80, 60, 70]])
        && document.activeElement?.getAttribute("data-chart-action") === "move-item-down"
        && document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "「4月」を2件目へ移動しました";
    });
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] input[data-chart-item-field="label"]').fill("1月");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] button[data-chart-action="move-item-up"]').click();
    const restoredItemOrder = await chart(page);
    assert.deepEqual(restoredItemOrder.items.map((item) => item.label), ["1月", "2月", "3月"], "回帰確認後に項目順を戻す");
    assert.deepEqual(restoredItemOrder.series.map((series) => series.values), [[100, 140, 120], [30, 45, 38], [60, 80, 70]], "回帰確認後に全系列値の対応を戻す");
    multiEditor = page.locator(".chart-block-editor");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="0"] button[data-chart-action="move-item-up"]').isDisabled(), true, "先頭項目の上へを無効化する");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="2"] button[data-chart-action="move-item-down"]').isDisabled(), true, "末尾項目の下へを無効化する");
    assert.equal(await multiEditor.locator('.chart-block-item-row[data-chart-item-index="2"] button[data-chart-action="move-item-up"]').getAttribute("aria-label"), "3月を上へ移動", "項目名を含む上へボタンのアクセシブルな名前を付ける");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="2"] button[data-chart-action="move-item-up"]').click();
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.items.map((item) => item.label).join(",") === "1月,3月,2月"
        && JSON.stringify(current.series.map((series) => series.values)) === JSON.stringify([[100, 120, 140], [30, 38, 45], [60, 70, 80]])
        && document.activeElement?.getAttribute("data-chart-action") === "move-item-up"
        && document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "「3月」を2件目へ移動しました";
    });
    await page.waitForFunction(() => [...document.querySelectorAll("#preview .chart-block-label")].map((label) => label.textContent).join(",") === "1月,3月,2月");
    assert.deepEqual(await page.locator("#preview .chart-block-label").allTextContents(), ["1月", "3月", "2月"], "集合棒の横軸を項目と全系列値の新しい対応へ更新する");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] button[data-chart-action="move-item-down"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.items.map((item) => item.label).join(",") === "1月,2月,3月");
    multiEditor = page.locator(".chart-block-editor");
    const invalidReorderValue = multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] input[data-chart-series-value][data-chart-series-index="0"]');
    await invalidReorderValue.fill("Infinity");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] button[data-chart-action="move-item-down"]').click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "2件目の売上の数値" && document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "数値は0以上の有限な数値を入力してください");
    assert.equal(await invalidReorderValue.inputValue(), "Infinity", "不正な編集中の文字列を並べ替えで破棄しない");
    assert.deepEqual((await chart(page)).items.map((item) => item.label), ["1月", "2月", "3月"], "不正値では項目を移動しない");
    await invalidReorderValue.fill("140");
    const barMode = multiEditor.locator('select[aria-label="グラフ1の棒の表示方法"]');
    assert.equal(await barMode.inputValue(), "grouped", "旧形式の棒グラフは集合表示として開く");
    await barMode.selectOption("stacked");
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.appearance?.barMode === "stacked" && document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "stacked";
    });
    const stackedMetrics = await page.locator("#preview .chart-block-stacked-bar rect").evaluateAll((bars) => bars.map((bar) => ({
      itemId: bar.closest(".chart-block-bar")?.dataset.chartItemId,
      seriesId: bar.closest(".chart-block-bar")?.dataset.chartSeriesId,
      x: Number(bar.getAttribute("x")), y: Number(bar.getAttribute("y")), height: Number(bar.getAttribute("height")), fill: bar.getAttribute("fill")
    })));
    assert.equal(stackedMetrics.length, 9, "3項目・3系列を積み上げ棒として描画する");
    for (const itemId of ["jan", "feb", "mar"]) {
      const segments = stackedMetrics.filter((segment) => segment.itemId === itemId);
      assert.equal(new Set(segments.map((segment) => segment.x)).size, 1, `${itemId}の積み上げ系列は同じx位置を使う`);
      assert.equal(segments[0].y + segments[0].height, 196, `${itemId}の第1系列は基線から積み上げる`);
      assert.equal(segments[1].y + segments[1].height, segments[0].y, `${itemId}の第2系列は連続して積み上げる`);
      assert.equal(segments[2].y + segments[2].height, segments[1].y, `${itemId}の第3系列は連続して積み上げる`);
    }
    assert.deepEqual(stackedMetrics.slice(0, 3).map((segment) => [segment.seriesId, segment.fill]), (await chart(page)).series.map((series) => [series.id, series.color]), "系列色と積み上げ順を維持する");
    assert.deepEqual(await page.locator("#preview .chart-block-bar-chart .sr-only li").allTextContents(), [
      "1月、売上: 100万円", "1月、営業利益: 30万円", "1月、原価: 60万円",
      "2月、売上: 140万円", "2月、営業利益: 45万円", "2月、原価: 80万円",
      "3月、売上: 120万円", "3月、営業利益: 38万円", "3月、原価: 70万円"
    ], "積み上げ棒も全系列を読み上げ対象にする");
    const stackTotals = multiEditor.locator('input[aria-label="グラフ1の合計値を表示"]');
    assert.equal(await stackTotals.isChecked(), false, "新規の合計値表示はオフで始める");
    await stackTotals.check();
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.appearance?.showStackTotals === true && document.querySelectorAll("#preview .chart-block-stacked-total-value").length === 3;
    });
    assert.deepEqual(await page.locator("#preview .chart-block-stacked-total-value").allTextContents(), ["190", "265", "228"], "各積み上げ棒の上へ系列合計を表示する");
    assert.deepEqual(await page.locator("#preview .chart-block-bar-chart .sr-only li").allTextContents(), [
      "1月、売上: 100万円", "1月、営業利益: 30万円", "1月、原価: 60万円", "1月、合計: 190万円",
      "2月、売上: 140万円", "2月、営業利益: 45万円", "2月、原価: 80万円", "2月、合計: 265万円",
      "3月、売上: 120万円", "3月、営業利益: 38万円", "3月、原価: 70万円", "3月、合計: 228万円"
    ], "合計表示時は項目名と合計をスクリーンリーダーへ追加する");
    const totalLabelBoxes = await page.locator("#preview .chart-block-stacked-total-value").evaluateAll((labels) => labels.map((label) => {
      const total = label.getBoundingClientRect();
      const segments = [...label.closest(".chart-block-bar-group")?.querySelectorAll(".chart-block-stacked-value") || []].map((segment) => segment.getBoundingClientRect());
      const svg = label.ownerSVGElement?.getBoundingClientRect();
      return {
        total: { x: total.x, y: total.y, width: total.width, height: total.height },
        segments: segments.map((segment) => ({ x: segment.x, y: segment.y, width: segment.width, height: segment.height })),
        svg: svg && { left: svg.left, right: svg.right, top: svg.top, bottom: svg.bottom }
      };
    }));
    assert.ok(totalLabelBoxes.every(({ total, svg }) => total.x >= svg.left && total.x + total.width <= svg.right && total.y >= svg.top && total.y + total.height <= svg.bottom), "合計ラベルをSVG内へ置く");
    assert.ok(totalLabelBoxes.every(({ total }, index) => totalLabelBoxes.slice(index + 1).every((other) => !boxesOverlap(total, other.total))), "すべての隣接合計ラベルを重ねない");
    assert.ok(totalLabelBoxes.every(({ total, segments }) => segments.every((segment) => !boxesOverlap(total, segment))), "合計ラベルを関連するすべての系列内ラベルと重ねない");
    assert.deepEqual(await page.locator("#preview .chart-block-stacked-total-title").allTextContents(), ["1月、合計: 190万円", "2月、合計: 265万円", "3月、合計: 228万円"], "短い合計も詳細titleを持つ");
    const originalStackedBody = await page.locator("#editor").inputValue();
    const originalStackedValues = (await chart(page)).series.map((series) => series.values.slice());
    const longTotalValues = [
      [9.87654321098765e122, 1.23456789012345e123, 2.34567890123456e123],
      [8.76543210987654e122, 1.34567890123456e123, 2.45678901234567e123],
      [7.65432109876543e122, 1.45678901234567e123, 2.56789012345678e123]
    ];
    for (let seriesIndex = 0; seriesIndex < longTotalValues.length; seriesIndex += 1) {
      for (let itemIndex = 0; itemIndex < longTotalValues[seriesIndex].length; itemIndex += 1) {
        await multiEditor.locator(`.chart-block-item-row[data-chart-item-index="${itemIndex}"] input[data-chart-series-value][data-chart-series-index="${seriesIndex}"]`).fill(String(longTotalValues[seriesIndex][itemIndex]));
      }
    }
    await page.waitForFunction((expected) => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return JSON.stringify(current?.series.map((series) => series.values)) === JSON.stringify(expected);
    }, longTotalValues);
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      const totals = window.MemoNexusChartBlockUtils.chartStackedTotals(current?.items, current?.series);
      const labels = [...document.querySelectorAll("#preview .chart-block-stacked-total-value")];
      return labels.length === totals.length && labels.every((label, index) => label.textContent === window.MemoNexusChartBlockUtils.formatChartStackTotal(totals[index]));
    });
    const longTotalLayout = await page.locator("#preview .chart-block-stacked-total-value").evaluateAll((labels) => labels.map((label) => {
      const group = label.closest(".chart-block-bar-group");
      const total = label.getBoundingClientRect();
      const svg = label.ownerSVGElement?.getBoundingClientRect();
      const segmentLabels = [...group.querySelectorAll(".chart-block-stacked-value")].map((segment) => segment.getBoundingClientRect());
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      const itemIndex = current.items.findIndex((item) => item.id === group.dataset.chartItemId);
      const totalEntry = window.MemoNexusChartBlockUtils.chartStackedTotals(current.items, current.series)[itemIndex];
      return {
        item: current.items[itemIndex].label,
        display: label.textContent,
        detail: window.MemoNexusChartBlockUtils.formatChartStackTotalDetail(totalEntry),
        title: group.querySelector(".chart-block-stacked-total-title")?.textContent,
        total: { x: total.x, y: total.y, width: total.width, height: total.height },
        segmentLabels: segmentLabels.map((segment) => ({ x: segment.x, y: segment.y, width: segment.width, height: segment.height })),
        svg: svg && { left: svg.left, right: svg.right, top: svg.top, bottom: svg.bottom }
      };
    }));
    assert.ok(longTotalLayout.every((entry) => entry.display.length <= 11 && entry.display !== entry.detail && /e[+-]\d+$/.test(entry.display)), `長い有限合計を短い科学表記へ表示する: ${JSON.stringify(longTotalLayout)}`);
    assert.ok(longTotalLayout.every((entry) => entry.title === `${entry.item}、合計: ${entry.detail}万円`), "短縮前の有限合計をtitleへ残す");
    assert.ok(longTotalLayout.every(({ total, svg }) => total.x >= svg.left && total.x + total.width <= svg.right && total.y >= svg.top && total.y + total.height <= svg.bottom), "長い合計ラベルもSVG左右内に収める");
    assert.ok(longTotalLayout.every(({ total }, index) => longTotalLayout.slice(index + 1).every((other) => !boxesOverlap(total, other.total))), "長い隣接合計ラベル同士を重ねない");
    assert.ok(longTotalLayout.every(({ total, segmentLabels }) => segmentLabels.every((segment) => !boxesOverlap(total, segment))), "長い合計ラベルを関連するすべての系列内ラベルと重ねない");
    const longTotalAccessibleItems = await page.locator("#preview .chart-block-bar-chart .sr-only li").allTextContents();
    assert.ok(longTotalLayout.every((entry) => longTotalAccessibleItems.includes(`${entry.item}、合計: ${entry.detail}万円`)), "読み上げには短縮前の安全な合計を残す");
    for (let seriesIndex = 0; seriesIndex < originalStackedValues.length; seriesIndex += 1) {
      for (let itemIndex = 0; itemIndex < originalStackedValues[seriesIndex].length; itemIndex += 1) {
        await multiEditor.locator(`.chart-block-item-row[data-chart-item-index="${itemIndex}"] input[data-chart-series-value][data-chart-series-index="${seriesIndex}"]`).fill(String(originalStackedValues[seriesIndex][itemIndex]));
      }
    }
    await page.waitForFunction((expected) => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return JSON.stringify(current?.series.map((series) => series.values)) === JSON.stringify(expected);
    }, originalStackedValues);
    await page.setViewportSize({ width: 320, height: 820 });
    await page.waitForFunction(() => innerWidth === 320 && document.body.dataset.layoutMode === "mobile");
    const narrowContextPanel = page.locator("#contextPanel");
    if (await narrowContextPanel.getAttribute("aria-hidden") !== "true") {
      await page.locator("#closeContextPanelBtn").click();
      await page.waitForFunction(() => document.getElementById("contextPanel")?.getAttribute("aria-hidden") === "true");
    }
    await multiEditor.locator('.chart-block-series-row button[data-chart-action="delete-series"]').last().click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.series.length === 2);
    await multiEditor.locator('.chart-block-series-row button[data-chart-action="delete-series"]').last().click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.series.length === 1);
    await multiEditor.locator('button[data-chart-action="add-item"]').click();
    await multiEditor.locator('button[data-chart-action="add-item"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.items.length === 5);
    const narrowValues = [Number.MAX_VALUE, 1.7e308, 1.6e308, 1.5e308, 1.4e308];
    for (let itemIndex = 0; itemIndex < narrowValues.length; itemIndex += 1) {
      await multiEditor.locator(`.chart-block-item-row[data-chart-item-index="${itemIndex}"] input[data-chart-item-field="label"]`).fill(`最狭${itemIndex + 1}`);
      await multiEditor.locator(`.chart-block-item-row[data-chart-item-index="${itemIndex}"] input[data-chart-series-value][data-chart-series-index="0"]`).fill(String(narrowValues[itemIndex]));
    }
    await page.waitForFunction((expected) => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      const labels = [...document.querySelectorAll("#preview .chart-block-stacked-total-value")];
      const totals = window.MemoNexusChartBlockUtils.chartStackedTotals(current?.items, current?.series);
      return current?.appearance?.barMode === "stacked" && current?.appearance?.showStackTotals === true && current?.series.length === 1 && current?.items.length === 5
        && JSON.stringify(current.series[0].values) === JSON.stringify(expected)
        && labels.length === 5 && labels.every((label, index) => label.textContent === window.MemoNexusChartBlockUtils.formatChartStackTotal(totals[index]));
    }, narrowValues);
    const narrowTotalLayout = await page.locator("#preview .chart-block-stacked-total-value").evaluateAll((labels) => labels.map((label) => {
      const group = label.closest(".chart-block-bar-group");
      const total = label.getBoundingClientRect();
      const svg = label.ownerSVGElement?.getBoundingClientRect();
      const segmentLabels = [...group.querySelectorAll(".chart-block-stacked-value")].map((segment) => segment.getBoundingClientRect());
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      const itemIndex = current.items.findIndex((item) => item.id === group.dataset.chartItemId);
      const detail = window.MemoNexusChartBlockUtils.formatChartStackTotalDetail(window.MemoNexusChartBlockUtils.chartStackedTotals(current.items, current.series)[itemIndex]);
      return {
        item: current.items[itemIndex].label,
        display: label.textContent,
        detail,
        title: group.querySelector(".chart-block-stacked-total-title")?.textContent,
        total: { x: total.x, y: total.y, width: total.width, height: total.height },
        segmentLabels: segmentLabels.map((segment) => ({ x: segment.x, y: segment.y, width: segment.width, height: segment.height })),
        svg: svg && { left: svg.left, right: svg.right, top: svg.top, bottom: svg.bottom },
        viewBox: label.ownerSVGElement?.getAttribute("viewBox")
      };
    }));
    assert.equal(narrowTotalLayout[0].viewBox, "0 0 446 260", "1系列・5項目では約75pxの項目幅を使う");
    assert.ok(narrowTotalLayout.every((entry) => entry.display.length <= 10 && /e[+-]\d+$/.test(entry.display)), "最狭幅でも長い有限合計を短い科学表記へ表示する");
    assert.ok(narrowTotalLayout.every((entry) => entry.title === `${entry.item}、合計: ${entry.detail}万円` && !entry.title.includes("00000000000000004")), "最狭幅でもtitleへ人間向け詳細値を残す");
    const maximumFiniteLayout = narrowTotalLayout[0];
    assert.ok(maximumFiniteLayout.display !== "上限超過" && !/Infinity|NaN/.test(maximumFiniteLayout.display) && /e[+-]\d+$/.test(maximumFiniteLayout.display), "最大有限値も最狭幅で科学表記として表示する");
    assert.ok(maximumFiniteLayout.detail !== "上限超過" && !/Infinity|NaN/.test(maximumFiniteLayout.detail) && !/上限超過|Infinity|NaN/.test(maximumFiniteLayout.title), "最大有限値のtitleへ有限な詳細値を残す");
    assert.ok(narrowTotalLayout.every(({ total, svg }) => total.x >= svg.left && total.x + total.width <= svg.right && total.y >= svg.top && total.y + total.height <= svg.bottom), "最狭幅でも合計ラベルをSVG上下左右内へ置く");
    assert.ok(narrowTotalLayout.every(({ total }, index) => narrowTotalLayout.slice(index + 1).every((other) => boxesHaveGap(total, other.total))), "最狭幅でも全合計ラベルの間に安全余白を持たせる");
    assert.ok(narrowTotalLayout.every(({ total, segmentLabels }) => segmentLabels.every((segment) => boxesHaveGap(total, segment))), "最狭幅でも合計ラベルを関連する全系列内ラベルから離す");
    const narrowAccessibleItems = await page.locator("#preview .chart-block-bar-chart .sr-only li").allTextContents();
    assert.ok(narrowTotalLayout.every((entry) => narrowAccessibleItems.includes(`${entry.item}、合計: ${entry.detail}万円`) && !entry.detail.includes("00000000000000004")), "最狭幅でも読み上げへ人間向け詳細値を残す");
    assert.ok(narrowAccessibleItems.includes(`${maximumFiniteLayout.item}、合計: ${maximumFiniteLayout.detail}万円`), "最大有限値も読み上げで上限超過にしない");
    await page.setViewportSize({ width: 1100, height: 820 });
    await page.locator("#editor").fill(originalStackedBody);
    await waitForChartEditorSyncAfterBodyInput(page, 1);
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.series.length === 3 && current?.items.length === 3 && current?.appearance?.showStackTotals === true
        && document.querySelectorAll("#preview .chart-block-stacked-total-value").length === 3;
    });
    const valuesToggle = multiEditor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]');
    await valuesToggle.uncheck();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-stacked-value").length === 0 && document.querySelectorAll("#preview .chart-block-stacked-total-value").length === 3);
    await valuesToggle.check();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-stacked-value").length > 0);
    await barMode.selectOption("percent-stacked");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked" && document.querySelectorAll("#preview .chart-block-stacked-total-value").length === 0);
    assert.equal(await multiEditor.locator('input[aria-label="グラフ1の合計値を表示"]').count(), 0, "100%積み上げでは合計値の操作欄を表示しない");
    const orientation = multiEditor.locator('select[aria-label="グラフ1の棒の向き"]');
    await orientation.selectOption("horizontal");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarOrientation === "horizontal");
    const longHorizontalLabel = "空白を含まない非常に長い日本語項目名を横棒で確認するためのテストです";
    await multiEditor.locator('input[aria-label="1件目の項目名"]').fill(longHorizontalLabel);
    await page.waitForFunction((label) => [...document.querySelectorAll("#preview .chart-block-horizontal-label title")].some((title) => title.textContent === label), longHorizontalLabel);
    const longLabelLayout = await page.locator("#preview .chart-block-horizontal-label").first().evaluate((label) => {
      const text = label.getBoundingClientRect();
      const bars = [...label.closest(".chart-block-bar-group").querySelectorAll("rect")].map((bar) => bar.getBoundingClientRect());
      const svg = label.ownerSVGElement.getBoundingClientRect();
      return { text, leftBar: Math.min(...bars.map((bar) => bar.left)), svg, title: label.querySelector("title")?.textContent, lines: label.querySelectorAll("tspan").length };
    });
    assert.equal(longLabelLayout.title, longHorizontalLabel, "省略した横棒項目名もSVG titleに全文を残す");
    assert.ok(longLabelLayout.lines <= 2 && longLabelLayout.text.right <= longLabelLayout.leftBar && longLabelLayout.text.left >= longLabelLayout.svg.left, "長い横棒項目名を最大2行で棒と重ねずSVG内へ置く");
    await multiEditor.locator('input[aria-label="1件目の項目名"]').fill("1月");
    await page.waitForFunction((expectedLabel) => {
      const chart = document.querySelector('#preview .chart-block-horizontal-bar-chart[data-chart-bar-mode="percent-stacked"]');
      const firstGroup = chart?.querySelector(".chart-block-bar-group");
      const label = firstGroup?.querySelector(".chart-block-horizontal-label");
      return label?.querySelector("tspan")?.textContent === expectedLabel
        && label?.querySelector("title")?.textContent === expectedLabel;
    }, "1月");
    const horizontalPercent = await page.locator("#preview .chart-block-percent-stacked-bar rect").evaluateAll((bars) => bars.map((bar) => ({ x: Number(bar.getAttribute("x")), y: Number(bar.getAttribute("y")), width: Number(bar.getAttribute("width")), height: Number(bar.getAttribute("height")) })));
    assert.equal(horizontalPercent.length, 9, "横向き100%積み上げでも3項目・3系列を描画する");
    assert.ok(horizontalPercent.every((segment) => Object.values(segment).every(Number.isFinite) && segment.width > 0 && segment.height > 0), "横棒のSVG属性へNaNやInfinityを出さない");
    assert.deepEqual(await page.locator("#preview .chart-block-percent-axis-value").allTextContents(), ["0%", "25%", "50%", "75%", "100%"], "横向き100%積み上げも割合目盛りを表示する");
    await barMode.selectOption("stacked");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-horizontal-bar-chart .chart-block-stacked-total-value").length === 3);
    const horizontalTotals = await page.locator("#preview .chart-block-horizontal-bar-chart .chart-block-stacked-total-value").evaluateAll((labels) => labels.map((label) => {
      const labelBox = label.getBoundingClientRect();
      const bars = [...label.closest(".chart-block-bar-group").querySelectorAll("rect")].map((bar) => bar.getBoundingClientRect());
      return { label: labelBox, right: Math.max(...bars.map((bar) => bar.right)), svg: label.ownerSVGElement.getBoundingClientRect() };
    }));
    assert.ok(horizontalTotals.every(({ label, right, svg }) => label.left >= right && label.right <= svg.right), "横向き通常積み上げの合計ラベルを棒の右端かつSVG内へ置く");
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-line"));
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("pie");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-pie"));
    await page.locator('select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarOrientation === "horizontal");
    assert.equal((await chart(page)).appearance.barOrientation, "horizontal", "棒→折れ線→円→棒でも横向き設定を保持する");
    await orientation.selectOption("vertical");
    await barMode.selectOption("percent-stacked");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarOrientation === "vertical" && document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked");
    await barMode.selectOption("grouped");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "grouped" && document.querySelectorAll("#preview .chart-block-stacked-total-value").length === 0);
    assert.equal(await multiEditor.locator('input[aria-label="グラフ1の合計値を表示"]').count(), 0, "集合棒では合計値の操作欄を表示しない");
    await barMode.selectOption("stacked");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "stacked" && document.querySelectorAll("#preview .chart-block-stacked-total-value").length === 3);
    assert.equal(await multiEditor.locator('input[aria-label="グラフ1の合計値を表示"]').isChecked(), true, "通常積み上げへ戻すと保存中の合計値設定を復元する");
    const valuesBeforePercentStacked = (await chart(page)).series.map((series) => series.values.slice());
    await barMode.selectOption("percent-stacked");
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.appearance?.barMode === "percent-stacked" && document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked";
    });
    assert.deepEqual((await chart(page)).series.map((series) => series.values), valuesBeforePercentStacked, "100%積み上げへの切替で元の実数値を変更しない");
    const percentStackedMetrics = await page.locator("#preview .chart-block-percent-stacked-bar rect").evaluateAll((bars) => bars.map((bar) => ({
      itemId: bar.closest(".chart-block-bar")?.dataset.chartItemId,
      seriesId: bar.closest(".chart-block-bar")?.dataset.chartSeriesId,
      x: Number(bar.getAttribute("x")), y: Number(bar.getAttribute("y")), height: Number(bar.getAttribute("height")), fill: bar.getAttribute("fill")
    })));
    assert.equal(percentStackedMetrics.length, 9, "3項目・3系列を100%積み上げとして描画する");
    for (const itemId of ["jan", "feb", "mar"]) {
      const segments = percentStackedMetrics.filter((segment) => segment.itemId === itemId);
      assert.equal(new Set(segments.map((segment) => segment.x)).size, 1, `${itemId}の100%積み上げ系列は同じx位置を使う`);
      assert.equal(segments[0].y + segments[0].height, 196, `${itemId}の第1系列は基線から積み上げる`);
      assert.equal(segments.at(-1).y, 54, `${itemId}の棒は100%で同じ高さにする`);
      assert.ok(segments.every((segment) => Number.isFinite(segment.y) && Number.isFinite(segment.height) && segment.height > 0), `${itemId}のSVG属性へNaNやInfinityを出さない`);
    }
    assert.deepEqual(percentStackedMetrics.slice(0, 3).map((segment) => [segment.seriesId, segment.fill]), (await chart(page)).series.map((series) => [series.id, series.color]), "100%積み上げでも系列順と色を維持する");
    assert.deepEqual(await page.locator("#preview .chart-block-percent-stacked-value").allTextContents(), ["53%", "16%", "32%", "53%", "17%", "30%", "53%", "17%", "31%"], "値表示を未丸めの割合から一貫して丸める");
    const percentLabelBoxes = await page.locator("#preview .chart-block-percent-stacked-value").evaluateAll((labels) => labels.map((label) => {
      const text = label.getBoundingClientRect();
      const rect = label.closest(".chart-block-bar")?.querySelector("rect")?.getBoundingClientRect();
      return { text: { x: text.x, y: text.y, width: text.width, height: text.height }, rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }));
    assert.ok(percentLabelBoxes.every(({ text, rect }) => rect && text.x >= rect.x && text.y >= rect.y && text.x + text.width <= rect.x + rect.width && text.y + text.height <= rect.y + rect.height), "区間ラベルを対応する棒の内側へ安全に配置する");
    assert.ok(percentLabelBoxes.every(({ text }, index) => percentLabelBoxes.slice(index + 1).every((other) => !boxesOverlap(text, other.text))), "表示した割合ラベルを重ねない");
    assert.deepEqual(await page.locator("#preview .chart-block-percent-axis-value").allTextContents(), ["0%", "25%", "50%", "75%", "100%"], "100%積み上げのY軸を割合表示にする");
    assert.deepEqual(await page.locator("#preview .chart-block-bar-chart .sr-only li").allTextContents(), [
      "1月、売上: 100万円、53%、項目合計: 190万円", "1月、営業利益: 30万円、16%、項目合計: 190万円", "1月、原価: 60万円、32%、項目合計: 190万円",
      "2月、売上: 140万円、53%、項目合計: 265万円", "2月、営業利益: 45万円、17%、項目合計: 265万円", "2月、原価: 80万円、30%、項目合計: 265万円",
      "3月、売上: 120万円、53%、項目合計: 228万円", "3月、営業利益: 38万円、17%、項目合計: 228万円", "3月、原価: 70万円、31%、項目合計: 228万円"
    ], "100%積み上げは元の値、割合、項目合計を読み上げ対象にする");
    await barMode.selectOption("grouped");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "grouped");
    assert.deepEqual((await chart(page)).series.map((series) => series.values), valuesBeforePercentStacked, "集合へ戻しても元の実数値を復元する");
    await barMode.selectOption("percent-stacked");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked");
    await multiEditor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]').uncheck();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-stacked-value").length === 0);
    await multiEditor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]').check();
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-stacked-value").length > 0);
    await orientation.selectOption("horizontal");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarOrientation === "horizontal");
    for (const viewportWidth of [320, 375, 390, 430]) {
      await page.setViewportSize({ width: viewportWidth, height: 760 });
      await page.waitForFunction((width) => innerWidth === width && document.body.dataset.layoutMode === "mobile", viewportWidth);
      const contextPanel = page.locator("#contextPanel");
      if (await contextPanel.getAttribute("aria-hidden") !== "true") {
        await page.locator("#closeContextPanelBtn").click();
        await page.waitForFunction(() => document.getElementById("contextPanel")?.getAttribute("aria-hidden") === "true");
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      const cardPaneButton = page.locator("#cardPaneBtn");
      if (await cardPaneButton.getAttribute("aria-expanded") !== "true") {
        const cardPaneClickPoint = await page.evaluate(() => {
          const button = document.getElementById("cardPaneBtn");
          if (!button) return null;
          const rect = button.getBoundingClientRect();
          for (let y = 2; y < rect.height - 1; y += 2) {
            for (let x = 2; x < rect.width - 1; x += 2) {
              const hit = document.elementFromPoint(Math.round(rect.left + x), Math.round(rect.top + y));
              if (hit === button || button.contains(hit)) return { x: Math.round(x), y: Math.round(y) };
            }
          }
          return null;
        });
        assert.ok(cardPaneClickPoint, `${viewportWidth}pxで100%積み上げカード表示ボタンの実ヒット領域を持つ`);
        await cardPaneButton.click({ position: cardPaneClickPoint });
      }
      await page.waitForFunction(() => document.getElementById("previewCard")?.getAttribute("aria-hidden") === "false");
      await page.waitForFunction(() => {
        const card = document.getElementById("previewCard")?.getBoundingClientRect();
        return card && card.left >= 0 && card.right <= window.innerWidth;
      });
      const percentMobileMetrics = await page.locator("#preview .chart-block-percent-stacked-bar-chart, #preview .chart-block-bar-chart[data-chart-bar-mode='percent-stacked']").evaluate((element) => {
        const select = document.querySelector('.chart-block-editor select[aria-label="グラフ1の棒の表示方法"]')?.getBoundingClientRect();
        const table = document.querySelector(".chart-block-item-table");
        const chartScroll = element.querySelector(".chart-block-scroll");
        const card = element.getBoundingClientRect();
        return {
          card: { left: card.left, right: card.right, width: card.width },
          select: select && { left: select.left, right: select.right },
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
          tableScrollable: table?.scrollWidth > table?.clientWidth,
          chartScrollable: chartScroll?.scrollWidth > chartScroll?.clientWidth
        };
      });
      assert.ok(percentMobileMetrics.card.left >= -0.5 && percentMobileMetrics.card.right <= viewportWidth + 0.5, `${viewportWidth}pxで100%積み上げカードを画面内へ収める`);
      assert.ok(percentMobileMetrics.select && percentMobileMetrics.select.left >= -0.5 && percentMobileMetrics.select.right <= viewportWidth + 0.5, `${viewportWidth}pxで棒の表示方法を操作可能にする`);
      assert.equal(percentMobileMetrics.documentOverflow, 0, `${viewportWidth}pxでdocumentの横スクロールを作らない`);
      assert.equal(percentMobileMetrics.bodyOverflow, 0, `${viewportWidth}pxでbodyの横スクロールを作らない`);
      assert.equal(percentMobileMetrics.tableScrollable, true, `${viewportWidth}pxで入力表だけを横スクロール可能にする`);
      assert.equal(percentMobileMetrics.chartScrollable, true, `${viewportWidth}pxで横棒の横スクロールをグラフ領域だけへ閉じ込める`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
    await multiEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.waitForFunction(() => document.querySelector(".chart-block-series-notice")?.hidden === true && document.querySelectorAll("#preview .chart-block-line-series").length === 3 && document.querySelectorAll("#preview .chart-block-line-item").length === 9);
    assert.equal(await page.locator("#preview .chart-block-line svg").getAttribute("viewBox"), "0 0 420 260", "折れ線は非表示系列を横幅へ加算しない");
    assert.equal(await page.locator("#preview .chart-block-line-path").count(), 3, "3系列を独立した折れ線で描画する");
    assert.equal(await page.locator("#preview .chart-block-line-point").count(), 9, "3系列・3項目の9点を描画する");
    assert.deepEqual(await page.locator("#preview .chart-block-line .chart-block-legend li").allTextContents(), ["売上", "営業利益", "原価"], "折れ線の凡例へ全系列の名前と色を表示する");
    assert.deepEqual(await page.locator("#preview .chart-block-line .sr-only li").allTextContents(), [
      "1月、売上: 100万円", "1月、営業利益: 30万円", "1月、原価: 60万円",
      "2月、売上: 140万円", "2月、営業利益: 45万円", "2月、原価: 80万円",
      "3月、売上: 120万円", "3月、営業利益: 38万円", "3月、原価: 70万円"
    ], "折れ線は表示中の全系列を読み上げ対象にする");
    const lineMetrics = await page.locator("#preview .chart-block-line-point").evaluateAll((points) => points.map((point) => ({ cy: Number(point.getAttribute("cy")), stroke: point.getAttribute("stroke") })));
    assert.ok(lineMetrics.every((point) => Number.isFinite(point.cy) && point.cy >= 0), "複数系列の折れ線SVGへ不正な座標を渡さない");
    assert.ok(lineMetrics.some((point) => point.cy === 42), "全系列の最大値140を折れ線の共通スケールへ使う");
    for (const viewportWidth of [320, 375, 390, 430]) {
      await page.setViewportSize({ width: viewportWidth, height: 760 });
      await page.waitForFunction((width) => innerWidth === width && document.body.dataset.layoutMode === "mobile", viewportWidth);
      const contextPanel = page.locator("#contextPanel");
      if (await contextPanel.getAttribute("aria-hidden") !== "true") {
        await page.locator("#closeContextPanelBtn").click();
        await page.waitForFunction(() => document.getElementById("contextPanel")?.getAttribute("aria-hidden") === "true");
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => window.scrollY === 0);
      const cardPaneButton = page.locator("#cardPaneBtn");
      if (await cardPaneButton.getAttribute("aria-expanded") !== "true") {
        const cardPaneClickPoint = await page.evaluate(() => {
          const button = document.getElementById("cardPaneBtn");
          if (!button) return null;
          const rect = button.getBoundingClientRect();
          for (let y = 2; y < rect.height - 1; y += 2) {
            for (let x = 2; x < rect.width - 1; x += 2) {
              const hit = document.elementFromPoint(Math.round(rect.left + x), Math.round(rect.top + y));
              if (hit === button || button.contains(hit)) return { x: Math.round(x), y: Math.round(y) };
            }
          }
          return null;
        });
        assert.ok(cardPaneClickPoint, `${viewportWidth}pxでカード表示ボタンの実ヒット領域を持つ`);
        await cardPaneButton.click({ position: cardPaneClickPoint });
      }
      await page.waitForFunction(() => document.getElementById("previewCard")?.getAttribute("aria-hidden") === "false");
      await page.waitForFunction(() => {
        const card = document.getElementById("previewCard")?.getBoundingClientRect();
        return card && card.left >= 0 && card.right <= window.innerWidth;
      });
      const mobileLineMetrics = await page.locator("#preview .chart-block-line").evaluate((element) => {
        const rect = (selector) => {
          const box = element.querySelector(selector)?.getBoundingClientRect();
          return box && { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
        };
        return {
          card: element.getBoundingClientRect().width,
          viewport: innerWidth,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scroll: rect(".chart-block-scroll"),
          legend: rect(".chart-block-legend"),
          edit: rect(".chart-block-edit"),
          tableScrollable: document.querySelector(".chart-block-item-table")?.scrollWidth > document.querySelector(".chart-block-item-table")?.clientWidth
        };
      });
      assert.ok(mobileLineMetrics.card <= mobileLineMetrics.viewport, `${viewportWidth}pxで3系列折れ線カードを画面内へ収める`);
      assert.equal(mobileLineMetrics.pageOverflow, 0, `${viewportWidth}pxでページ全体の横スクロールを作らない`);
      assert.ok(mobileLineMetrics.legend.top >= mobileLineMetrics.scroll.bottom - 0.5, `${viewportWidth}pxで凡例をグラフ領域の後ろへ折り返す`);
      assert.ok(mobileLineMetrics.edit.left >= -0.5 && mobileLineMetrics.edit.right <= mobileLineMetrics.viewport + 0.5, `${viewportWidth}pxで編集ボタンを操作可能にする: ${JSON.stringify(mobileLineMetrics)}`);
      assert.equal(mobileLineMetrics.tableScrollable, true, `${viewportWidth}pxで入力表だけを横スクロール可能にする`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
    await page.locator('.chart-block-editor select[aria-label="グラフ1の種類"]').selectOption("pie");
    await page.waitForFunction(() => document.querySelector(".chart-block-series-notice")?.hidden === false && document.querySelectorAll("#preview .chart-block-pie-slice").length === 3);
    assert.deepEqual(await page.locator("#preview .chart-block-pie .sr-only li").allTextContents(), ["1月、売上: 100万円", "2月、売上: 140万円", "3月、売上: 120万円"], "円グラフは第1系列だけを読み上げ対象にする");
    await page.locator('.chart-block-editor select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 9);
    assert.equal((await chart(page)).appearance.barMode, "percent-stacked", "棒から折れ線、円を経由しても100%積み上げ設定を保持する");
    assert.equal(await page.locator("#preview .chart-block-bar-chart .sr-only li").count(), 9, "棒グラフへ戻すと全系列を再び読み上げ対象にする");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('button[data-chart-action="add-item"]').click();
    multiEditor = page.locator(".chart-block-editor");
    const newRow = multiEditor.locator('.chart-block-item-row[data-chart-item-index="3"]');
    await newRow.locator('input[data-chart-item-field="label"]').fill("4月");
    assert.deepEqual(await newRow.locator('input[data-chart-series-value]').evaluateAll((inputs) => inputs.map((input) => input.value)), ["0", "0", "0"], "項目追加時に全系列の値を0で初期化する");
    await page.waitForFunction(() => document.querySelectorAll('#preview .chart-block-percent-stacked-bar[data-chart-item-id]').length === 12 && document.querySelectorAll('#preview .chart-block-percent-stacked-bar[data-chart-item-id] rect').length === 9);
    assert.equal(await page.locator('#preview .chart-block-percent-stacked-bar[data-chart-item-id] text').count(), 9, "合計0の項目では棒区間と割合ラベルを表示しない");
    await newRow.locator('button[data-chart-action="delete-item"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.series?.[2]?.values.join(",") === "60,80,70");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('.chart-block-series-row[data-chart-series-index="1"] button[data-chart-action="delete-series"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.series.map((series) => series.name).join(",") === "売上,原価");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 6);
    assert.equal(await page.locator("#preview .chart-block-bar").count(), 6, "系列削除後も他系列の値をずらさない");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.waitForFunction(() => document.querySelector(".chart-block-series-notice")?.hidden === true && document.querySelectorAll("#preview .chart-block-line-item").length === 6);
    assert.equal((await chart(page)).series.length, 2, "折れ線へ切替えても第2系列を保持する");
    await page.locator('.chart-block-editor select[aria-label="グラフ1の種類"]').selectOption("pie");
    await page.waitForFunction(() => document.querySelector(".chart-block-series-notice")?.hidden === false && document.querySelectorAll("#preview .chart-block-pie-slice").length === 3);
    await page.locator('.chart-block-editor select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 6);
    await page.locator('.chart-block-editor button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    const multiBeforeReload = await chart(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.deepEqual(await chart(page), multiBeforeReload, "複数系列を保存・再読み込み後も復元する");
    assert.equal(await page.locator("#preview .chart-block-bar").count(), 6, "再読み込み後も集合棒を復元する");
    multiEditor = page.locator(".chart-block-editor");
    assert.equal(await multiEditor.locator('select[aria-label="グラフ1の棒の表示方法"]').inputValue(), "percent-stacked", "再読み込み後も100%積み上げ表示を復元する");
    await multiEditor.locator('select[aria-label="グラフ1の棒の表示方法"]').selectOption("grouped");
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "grouped");
    await multiEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction(() => document.querySelector("#preview .chart-block-bar-chart")?.dataset.chartBarMode === "percent-stacked");
    await waitForChartCancelCompletion(page, 0);
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] button[data-chart-action="move-item-down"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.items.map((item) => item.label).join(",") === "1月,3月,2月");
    await multiEditor.locator('button[data-chart-action="cancel"]').click();
    await waitForChartCancelCompletion(page, 0);
    assert.deepEqual((await chart(page)).items.map((item) => item.label), ["1月", "2月", "3月"], "並べ替え後の取消で編集開始時の順序へ戻す");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('.chart-block-item-row[data-chart-item-index="1"] button[data-chart-action="move-item-down"]').click();
    await page.waitForFunction(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .find((segment) => segment.type === "chart")?.chart?.items.map((item) => item.label).join(",") === "1月,3月,2月");
    await multiEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("line");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-line-item").length === 6 && [...document.querySelectorAll("#preview .chart-block-label")].map((label) => label.textContent).join(",") === "1月,3月,2月");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("pie");
    await waitForPieSlices(page, 3);
    assert.deepEqual(await page.locator("#preview .chart-block-pie .sr-only li").allTextContents(), ["1月、売上: 100万円", "3月、売上: 120万円", "2月、売上: 140万円"], "円グラフも並べ替えた第1系列との対応を維持する");
    await multiEditor.locator('select[aria-label="グラフ1の種類"]').selectOption("bar");
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-bar").length === 6 && [...document.querySelectorAll("#preview .chart-block-label")].map((label) => label.textContent).join(",") === "1月,3月,2月");
    await multiEditor.locator('button[data-chart-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor .chart-block-status")?.textContent === "入力内容を保存しました");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.deepEqual((await chart(page)).items.map((item) => item.label), ["1月", "3月", "2月"], "確定した並べ替えを再読み込み後も復元する");
    multiEditor = page.locator(".chart-block-editor");
    await multiEditor.locator('.chart-block-series-row[data-chart-series-index="1"] button[data-chart-action="delete-series"]').click();
    await page.waitForFunction(() => {
      const editor = document.querySelector(".chart-block-editor");
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      const labels = [...editor?.querySelectorAll('input[data-chart-series-value][data-chart-series-index="0"]') || []].map((input) => input.getAttribute("aria-label"));
      return current?.series.length === 1 && labels.join(",") === "1件目の数値,2件目の数値,3件目の数値";
    });
    const previewChart = page.locator("#preview .chart-block").first();
    await page.screenshot({ path: screenshotPath });
    await page.setViewportSize({ width: 390, height: 760 });
    const metrics = await previewChart.evaluate((element) => ({ card: element.getBoundingClientRect().width, viewport: innerWidth, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    assert.ok(metrics.card <= metrics.viewport, "390px幅でもグラフカードが画面からはみ出さない");
    assert.equal(metrics.pageOverflow, 0, "390px幅でもページ全体の横スクロールを作らない");
    assert.deepEqual(pageErrors, [], `ページエラーなし: ${pageErrors.join("\n")}`);
    assert.deepEqual(consoleErrors, [], `console errorなし: ${consoleErrors.join("\n")}`);
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
