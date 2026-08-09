const assert = require("node:assert/strict");
const test = require("node:test");
const { canPlayEditorCaretAnimation, normalizeEditorCaretAnimationSettings } = require("./editor-caret-animation-utils.js");

const eligibleState = {
  enabled: true,
  desktopPointer: true,
  focused: true,
  collapsed: true,
  composing: false,
  hidden: false,
  modalOpen: false,
  popout: false,
  aiBusy: false,
  respectReducedMotion: true,
  reducedMotion: false
};

test("カーソル演出設定は安全な既定値へ正規化する", () => {
  assert.deepEqual(normalizeEditorCaretAnimationSettings(null), { enabled: true, idleDelay: 4000, respectReducedMotion: true });
  assert.deepEqual(normalizeEditorCaretAnimationSettings({ enabled: false, idleDelay: 4000, respectReducedMotion: false }), { enabled: false, idleDelay: 4000, respectReducedMotion: false });
  assert.equal(normalizeEditorCaretAnimationSettings({ idleDelay: 2000 }).idleDelay, 4000);
});

test("カーソル演出はキャレットだけがあり、安全なアイドル状態の時だけ許可する", () => {
  assert.equal(canPlayEditorCaretAnimation(eligibleState), true);
  ["composing", "hidden", "modalOpen", "popout", "aiBusy", "reducedMotion"].forEach((key) => {
    assert.equal(canPlayEditorCaretAnimation({ ...eligibleState, [key]: true }), false, key);
  });
  assert.equal(canPlayEditorCaretAnimation({ ...eligibleState, collapsed: false }), false);
  assert.equal(canPlayEditorCaretAnimation({ ...eligibleState, desktopPointer: false }), false);
  assert.equal(canPlayEditorCaretAnimation({ ...eligibleState, respectReducedMotion: false, reducedMotion: true }), true);
});
