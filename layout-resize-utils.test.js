"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CARD_MIN_WIDTH,
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
  EDITOR_MIN_WIDTH,
  calculateContextPanelRange,
  calculateEditorRange,
  clampWidth,
  defaultEditorWidth,
  normalizeLayoutWidths,
  parseLayoutWidths
} = require("./layout-resize-utils.js");

test("保存値は有効な正の有限数だけを復元する", () => {
  assert.deepEqual(parseLayoutWidths("not-json"), {});
  assert.deepEqual(parseLayoutWidths("null"), {});
  assert.deepEqual(normalizeLayoutWidths({ editorWidth: NaN, contextPanelWidth: Infinity }), {});
  assert.deepEqual(normalizeLayoutWidths({ editorWidth: 0, contextPanelWidth: -1 }), {});
  assert.deepEqual(normalizeLayoutWidths({ editorWidth: 100001, contextPanelWidth: "340" }), {});
  assert.deepEqual(parseLayoutWidths('{"editorWidth":640,"contextPanelWidth":340}'), {
    editorWidth: 640,
    contextPanelWidth: 340
  });
});

test("本文とカードは実際のワークスペース幅から最小幅を守る", () => {
  const range = calculateEditorRange(1000, 32, 16);
  assert.equal(range.minimum, EDITOR_MIN_WIDTH);
  assert.equal(range.maximum, 672);
  assert.equal(range.usableWidth - range.maximum, CARD_MIN_WIDTH);
  assert.equal(clampWidth(1, range.minimum, range.maximum), 320);
  assert.equal(clampWidth(9999, range.minimum, range.maximum), 672);
  assert.ok(defaultEditorWidth(1000, 32, 16) >= range.minimum);
  assert.ok(defaultEditorWidth(1000, 32, 16) <= range.maximum);
});

test("右側欄は実際の全体幅とワークスペース下限から240〜520pxへクランプする", () => {
  const narrowWideRange = calculateContextPanelRange(1040, 648, 10);
  assert.deepEqual(narrowWideRange, { minimum: CONTEXT_PANEL_MIN_WIDTH, maximum: 382 });
  assert.equal(clampWidth(1, narrowWideRange.minimum, narrowWideRange.maximum), 240);
  assert.equal(clampWidth(9999, narrowWideRange.minimum, narrowWideRange.maximum), 382);

  const spaciousRange = calculateContextPanelRange(1600, 648, 10);
  assert.equal(spaciousRange.maximum, CONTEXT_PANEL_MAX_WIDTH);
  assert.equal(clampWidth(9999, spaciousRange.minimum, spaciousRange.maximum), 520);
});
