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
  commitLayoutWidthsForKind,
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
  assert.deepEqual(parseLayoutWidths('{"editorWidth":null,"contextPanelWidth":340}'), {
    editorWidth: null,
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
  const narrowWideRange = calculateContextPanelRange(1040, 648);
  assert.deepEqual(narrowWideRange, { minimum: CONTEXT_PANEL_MIN_WIDTH, maximum: 392 });
  assert.equal(clampWidth(1, narrowWideRange.minimum, narrowWideRange.maximum), 240);
  assert.equal(clampWidth(9999, narrowWideRange.minimum, narrowWideRange.maximum), 392);

  const spaciousRange = calculateContextPanelRange(1600, 648);
  assert.equal(spaciousRange.maximum, CONTEXT_PANEL_MAX_WIDTH);
  assert.equal(clampWidth(9999, spaciousRange.minimum, spaciousRange.maximum), 520);
});

test("右側境界の確定はeditorWidthの自動比率状態を維持する", () => {
  assert.deepEqual(commitLayoutWidthsForKind(
    { editorWidth: null, contextPanelWidth: 340 },
    { editorWidth: 668, contextPanelWidth: 480 },
    "context"
  ), { editorWidth: null, contextPanelWidth: 480 });
});

test("本文境界の確定は保存済みの右側希望幅へ影響しない", () => {
  assert.deepEqual(commitLayoutWidthsForKind(
    { editorWidth: 9000, contextPanelWidth: 500 },
    { editorWidth: 720, contextPanelWidth: 390 },
    "editor"
  ), { editorWidth: 720, contextPanelWidth: 500 });
});

test("個別初期化を確定し、自動比率の本文幅は利用可能幅から再計算する", () => {
  const editorReset = commitLayoutWidthsForKind(
    { editorWidth: null, contextPanelWidth: 460 },
    { editorWidth: 600, contextPanelWidth: 460 },
    "editor"
  );
  assert.deepEqual(editorReset, { editorWidth: null, contextPanelWidth: 460 });

  const narrowerDefault = defaultEditorWidth(1000, 32, 16);
  const widerDefault = defaultEditorWidth(1300, 32, 16);
  assert.ok(widerDefault > narrowerDefault);

  const contextReset = commitLayoutWidthsForKind(
    { editorWidth: null, contextPanelWidth: 340 },
    { editorWidth: widerDefault, contextPanelWidth: 340 },
    "context"
  );
  assert.deepEqual(contextReset, { editorWidth: null, contextPanelWidth: 340 });
});
