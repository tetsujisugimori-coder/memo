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

function charts(page) {
  return page.evaluate(() => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
    .filter((segment) => segment.type === "chart").map((segment) => segment.chart));
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
    assertInlineCheckboxLayout(await checkboxLayout(editor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]')), "棒の上に数値を表示");
    await editor.locator('input[aria-label="グラフ1の棒の上に数値を表示"]').uncheck();
    await page.waitForFunction(() => {
      const current = window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value).find((segment) => segment.type === "chart")?.chart;
      return current?.title === "テスト得点" && current.unit === "点" && current.items.length === 2 && current.items[0].value === 70.5 && current.items[1].value === 0 && current.appearance.color === "#dc2626" && current.appearance.showValues === false;
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
    await page.waitForFunction(() => document.querySelectorAll("#preview .chart-block-pie-slice").length === 2);
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
    assert.deepEqual(beforeReload.appearance, { color: "#dc2626", showValues: true, showPoints: true, showLegend: true, pieLabelMode: "percentage" }, "棒グラフへ戻しても色・数値・点・凡例設定を保存する");
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
    duplicateCharts = await charts(page);
    assert.deepEqual(duplicateCharts[0], duplicateSetup.first, "2件目の確定・取消でも1件目を変更しない");
    assert.deepEqual(duplicateCharts[1], confirmedSecond, "確定保存後の取消は直近の確定状態へ戻す");
    const duplicateBody = await page.locator("#editor").inputValue();
    await page.locator("#editor").fill(`${duplicateSetup.frontMarker}\n${duplicateBody}`);
    await page.waitForFunction(() => document.querySelectorAll(".chart-block-editor").length === 3);
    let movedSecondEditor = page.locator(".chart-block-editor").nth(2);
    await movedSecondEditor.locator('input[aria-label="グラフ3のタイトル"]').fill("前方追加後の変更");
    await movedSecondEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction((title) => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[2]?.chart.title === title, confirmedSecond.title);
    duplicateCharts = await charts(page);
    assert.deepEqual(duplicateCharts.slice(1), [duplicateSetup.first, confirmedSecond], "前方グラフ追加後も2件目へ別ブロックの取消状態を適用しない");
    await page.locator("#editor").fill((await page.locator("#editor").inputValue()).replace(`${duplicateSetup.frontMarker}\n`, ""));
    await page.waitForFunction(() => document.querySelectorAll(".chart-block-editor").length === 2);
    movedSecondEditor = page.locator(".chart-block-editor").nth(1);
    await movedSecondEditor.locator('input[aria-label="グラフ2のタイトル"]').fill("前方削除後の変更");
    await movedSecondEditor.locator('button[data-chart-action="cancel"]').click();
    await page.waitForFunction((title) => window.MemoNexusChartBlockUtils.splitChartBlocks(document.getElementById("editor").value)
      .filter((segment) => segment.type === "chart")[1]?.chart.title === title, confirmedSecond.title);
    assert.deepEqual(await charts(page), [duplicateSetup.first, confirmedSecond], "前方グラフ削除後も対象外のグラフを復元しない");
    const previewChart = page.locator("#preview .chart-block").first();
    await page.screenshot({ path: screenshotPath });
    await page.setViewportSize({ width: 390, height: 760 });
    const metrics = await previewChart.evaluate((element) => ({ card: element.getBoundingClientRect().width, viewport: innerWidth, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
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
