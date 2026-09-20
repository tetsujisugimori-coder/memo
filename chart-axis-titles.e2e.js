"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { verifyDualGeometry } = require("./chart-combo-dual-axis.e2e.js");

async function verifyAxisTitles(page, { chart, waitForChartCancelCompletion }) {
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
  const noteTitle = "軸タイトル保存E2E";
  await page.locator("#titleInput").fill(noteTitle);
  await page.locator("#editor").fill("左右の軸タイトル");
  await page.locator("#insertChartBtn").click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "グラフ1のタイトル");
  const panel = page.locator(".chart-block-editor");
  const field = (name) => panel.locator('[data-chart-field="' + name + '"]');
  const action = (name) => panel.locator('[data-chart-action="' + name + '"]');
  const value = (item, series) => panel.locator('[data-chart-item-index="' + item + '"] input[data-chart-series-index="' + series + '"]');
  const save = async () => {
    await action("confirm").click();
    await page.waitForFunction(() => document.querySelector('.chart-block-editor > .chart-block-status')?.textContent === "入力内容を保存しました");
    return page.locator("#editor").inputValue();
  };
  const titles = () => page.locator('#preview .chart-block-unit').evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  const waitTitles = async (expected) => {
    await page.waitForFunction((expected) => JSON.stringify([...document.querySelectorAll('#preview .chart-block-unit')].map((el) => el.getAttribute("aria-label"))) === JSON.stringify(expected), expected);
    assert.deepEqual(await titles(), expected);
  };
  await action("add-series").click();
  await field("chartType").selectOption("combo");
  await field("title").fill("売上と成長率");
  await field("unit").fill("万円");
  assert.equal(await field("leftAxisTitle").inputValue(), "");
  assert.equal(await field("rightAxisTitle").count(), 0);
  await waitTitles(["万円"]);
  await field("comboAxisMode").selectOption("dual");
  await field("comboSecondaryUnit").fill("%");
  await waitTitles(["左軸・棒: 万円", "右軸・折れ線: %"]);
  for (const [name, label, placeholder] of [
    ["leftAxisTitle", "左軸のタイトル", "例: 売上"], ["unit", "左軸の単位", "例: 万円"],
    ["rightAxisTitle", "右軸のタイトル", "例: 成長率"], ["comboSecondaryUnit", "右軸の単位", "例: %"]
  ]) {
    assert.equal(await field(name).getAttribute("aria-label"), "グラフ1の" + label);
    assert.equal(await field(name).getAttribute("placeholder"), placeholder);
    assert.equal(await field(name).evaluate((el) => el.labels.length), 1);
  }
  await field("leftAxisTitle").fill("  売上  "); await field("rightAxisTitle").fill(" 成長率 ");
  await waitTitles(["左軸・棒: 売上（万円）", "右軸・折れ線: 成長率（%）"]);
  await panel.locator('[data-chart-series-index="0"] [data-chart-series-field="name"]').fill("売上");
  await panel.locator('[data-chart-series-index="1"] [data-chart-series-field="name"]').fill("成長率");
  await value(0, 0).fill("350"); await value(0, 1).fill("12");
  for (let i = 1; i < 3; i++) {
    await action("add-item").click();
    await page.waitForFunction((index) => document.activeElement?.matches('input[data-chart-item-field="label"]')
      && document.activeElement.closest("[data-chart-item-index]")?.dataset.chartItemIndex === String(index), i);
  }
  const itemLabels = Array.from({ length: 3 }, (_, i) => "長い項目名と地域名称".repeat(3) + i);
  for (let i = 0; i < itemLabels.length; i++) {
    const label = panel.locator('[data-chart-item-index="' + i + '"] [data-chart-item-field="label"]');
    await label.fill(itemLabels[i]);
    assert.equal(await label.inputValue(), itemLabels[i]);
  }
  assert.deepEqual((await chart(page)).items.map((item) => item.label), itemLabels);
  await field("showLegend").check();
  const saved = await save(), original = await chart(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" }); await panel.waitFor({ state: "visible" });
  assert.equal(await page.locator("#editor").inputValue(), saved);
  assert.deepEqual(await chart(page), original);
  await page.locator("#newBtn").click();
  await page.waitForFunction(() => document.activeElement === document.getElementById("editor"));
  await page.locator("#collectionsBtn").click(); await page.locator("#contextMemoListTab").click();
  await page.locator(".memo-item").filter({ hasText: noteTitle }).click();
  await panel.waitFor({ state: "visible" });
  assert.equal(await page.locator("#editor").inputValue(), saved);
  await page.locator("#closeContextPanelBtn").click();
  await page.locator('#preview .chart-block-edit').click();
  assert.equal(await field("leftAxisTitle").inputValue(), "売上");
  assert.equal(await field("rightAxisTitle").inputValue(), "成長率");
  assert.equal(await field("unit").inputValue(), "万円");
  assert.equal(await field("comboSecondaryUnit").inputValue(), "%");
  await field("comboAxisMode").selectOption("single");
  assert.equal(await field("rightAxisTitle").count(), 0); assert.equal(await field("comboSecondaryUnit").count(), 0);
  assert.equal((await chart(page)).appearance.rightAxisTitle, "成長率");
  await waitTitles(["売上（万円）"]);
  await field("comboAxisMode").selectOption("dual");
  for (const type of ["bar", "line", "pie"]) {
    await field("chartType").selectOption(type);
    assert.equal(await field("leftAxisTitle").count(), 0); assert.equal(await field("rightAxisTitle").count(), 0);
    await page.waitForFunction(() => !document.querySelector('#preview .chart-block-combo'));
    assert.equal((await titles()).some((text) => /売上|成長率/.test(text)), false);
    assert.equal((await chart(page)).appearance.rightAxisTitle, "成長率");
    await field("chartType").selectOption("combo");
    assert.equal(await field("rightAxisTitle").inputValue(), "成長率");
    assert.equal(await field("comboSecondaryUnit").inputValue(), "%");
  }
  await field("rightAxisTitle").fill("取消するタイトル"); await value(0, 0).fill("-");
  await action("cancel").click(); await waitForChartCancelCompletion(page, 0);
  assert.equal(await page.locator("#editor").inputValue(), saved);
  assert.equal(await field("rightAxisTitle").inputValue(), "成長率");

  for (const [leftTitle, leftUnit, rightTitle, rightUnit, expected] of [
    ["売上", "", "成長率", "", ["左軸・棒: 売上", "右軸・折れ線: 成長率"]],
    ["", "万円", "", "%", ["左軸・棒: 万円", "右軸・折れ線: %"]],
    ["", "", "", "", ["左軸・棒: 単位なし", "右軸・折れ線: 単位なし"]],
    ["売上", "万円", "成長率", "%", ["左軸・棒: 売上（万円）", "右軸・折れ線: 成長率（%）"]]
  ]) {
    await field("leftAxisTitle").fill(leftTitle); await field("unit").fill(leftUnit);
    await field("rightAxisTitle").fill(rightTitle); await field("comboSecondaryUnit").fill(rightUnit);
    await waitTitles(expected);
    for (const number of [0, -12.5, 0.3, Number.MAX_VALUE]) {
      await value(0, 0).fill(String(number)); await value(0, 1).fill(String(number));
      const expectedTips = ["売上（棒・左軸）: " + number + leftUnit, "成長率（折れ線・右軸）: " + number + rightUnit];
      await page.waitForFunction((expected) => expected.every((tip) => [...document.querySelectorAll('#preview g > title')].some((el) => el.textContent.endsWith(tip))), expectedTips);
      const tips = await page.locator('#preview g > title').allTextContents();
      for (const tip of expectedTips) assert.ok(tips.some((text) => text.endsWith(tip)));
      assert.doesNotMatch(tips.join(" "), /undefined|null/);
    }
  }
  await value(0, 0).fill("350"); await value(0, 1).fill("12");
  await value(1, 0).fill("-20"); await value(1, 1).fill("-0.3");
  await value(2, 0).fill("0"); await value(2, 1).fill("0");
  let count = 0;
  for (const long of [false, true]) {
    await field("leftAxisTitle").fill(long ? "長い左軸タイトル<売上>&".repeat(5) : "売上");
    await field("rightAxisTitle").fill(long ? "長い右軸タイトル<script>成長率</script>".repeat(5) : "成長率");
    const model = await chart(page);
    const expected = ["左軸・棒: " + model.appearance.leftAxisTitle + "（万円）", "右軸・折れ線: " + model.appearance.rightAxisTitle + "（%）"];
    await waitTitles(expected);
    assert.equal(await page.locator('#preview .chart-block script').count(), 0);
    for (const theme of ["light", "dark"]) {
      await page.locator("#settingsBtn").click(); await page.locator("#themeSelect").selectOption(theme); await page.locator("#closeSettingsBtn").click();
      for (const width of [390, 1100]) {
        await page.setViewportSize({ width, height: 820 });
        await page.waitForFunction((w) => innerWidth === w && document.body.dataset.layoutMode === (w === 390 ? "mobile" : "wide"), width);
        if (width === 390) {
          const bounds = await panel.locator('.chart-block-fields input').evaluateAll((els) => els.map((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, viewport: innerWidth }; }));
          assert.ok(bounds.every((b) => b.left >= 0 && b.right <= b.viewport), "390pxで設定入力欄が画面内に収まる");
          await field("rightAxisTitle").fill(model.appearance.rightAxisTitle);
          assert.equal(await field("rightAxisTitle").inputValue(), model.appearance.rightAxisTitle);
          if (await page.locator("#contextPanel").getAttribute("aria-hidden") === "false") await page.locator("#closeContextPanelBtn").click();
          await page.locator("#cardPaneBtn").click();
          await page.waitForFunction(() => { const card = document.getElementById("previewCard"); return card.getAttribute("aria-hidden") === "false" && Math.abs(card.getBoundingClientRect().right - innerWidth) < 1; });
        }
        await verifyDualGeometry(page, model); count++;
        assert.deepEqual(await titles(), expected);
        if (long && theme === "light") await page.screenshot({ path: path.join(os.tmpdir(), "memo-axis-titles-" + width + "-" + (process.env.MEMO_NEXUS_E2E_BROWSER || "chromium") + ".png") });
        if (width === 390) { await page.locator("#closeCardPaneBtn").click(); await page.waitForFunction(() => document.getElementById("previewCard").getAttribute("aria-hidden") === "true"); }
      }
    }
  }
  const finalBody = await save(), final = await chart(page);
  await page.reload({ waitUntil: "domcontentloaded" }); await page.locator("#appStartupGuard").waitFor({ state: "hidden" }); await panel.waitFor({ state: "visible" });
  assert.equal(await page.locator("#editor").inputValue(), finalBody); assert.deepEqual(await chart(page), final);
  console.log("Axis-title checks passed: " + count + " geometry combinations, old defaults, UI/tooltip units, save/reopen/reload, type/axis switches, cancel and empty/long titles");
}

module.exports = { verifyAxisTitles };
