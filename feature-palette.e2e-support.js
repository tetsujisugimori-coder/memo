"use strict";

// Follow the real user entry point rather than force-clicking a hidden control.
async function openFeaturePalette(page) {
  const panel = page.locator("#featurePalette");
  if (await panel.isVisible()) return;
  const mobile = page.locator("#mobileFeaturePaletteToggle");
  await (await mobile.isVisible() ? mobile : page.locator("#featurePaletteToggle")).click();
  await panel.waitFor({ state: "visible" });
}
async function closeFeaturePalette(page) {
  if (await page.locator("dialog[open]").count()) return;
  if (await page.locator("#featurePalette").isVisible()) await page.locator("[data-palette-close]").click();
}
async function clickPaletteControl(page, id, { keepOpen = false } = {}) {
  await openFeaturePalette(page);
  await page.locator(`#${id}`).click();
  if (!keepOpen && !["insertImageBlockBtn", "importTableFileBtn", "insertTableBtn"].includes(id)) await closeFeaturePalette(page);
}
module.exports = { openFeaturePalette, closeFeaturePalette, clickPaletteControl };
