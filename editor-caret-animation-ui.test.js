const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("textareaの標準キャレットを保ち、演出時だけ疑似キャレットを重ねる", () => {
  assert.match(html, /<textarea id="editor"/);
  assert.match(html, /id="editorCaretAnimation" class="editor-caret-animation" aria-hidden="true" hidden/);
  assert.match(css, /#editor\.is-caret-animating \{ caret-color: transparent; \}/);
  assert.match(css, /editor-caret-idle-spin 600ms/);
  assert.match(app, /function getEditorCaretPosition\(\)/);
  assert.match(app, /editor\.value\.slice\(0, editor\.selectionStart\)/);
});

test("アイドル監視はIME、選択、操作、非表示で中止される", () => {
  assert.match(app, /editor\.addEventListener\("compositionstart"/);
  assert.match(app, /editor\.addEventListener\("compositionend"/);
  assert.match(app, /editor\.addEventListener\("keydown", resetEditorCaretIdle\)/);
  assert.match(app, /editor\.addEventListener\("scroll", resetEditorCaretIdle/);
  assert.match(app, /document\.addEventListener\("selectionchange"/);
  assert.match(app, /document\.visibilityState !== "visible"/);
  assert.match(app, /selectionStart\) && selectionStart === selectionEnd/);
  assert.match(app, /AI_GENERATION_STATES\.STREAMING/);
  assert.match(app, /scheduleEditorCaretAnimation\(editorCaretAnimationSettings\.idleDelay\)/);
  assert.match(app, /function finishEditorCaretAnimation\(\)/);
  assert.match(app, /scheduleEditorCaretAnimation\(EDITOR_CARET_REPEAT_DELAY\)/);
  assert.match(app, /editorCaretAnimationRequestId \+= 1/);
  assert.match(app, /if \(!editorCaretAnimationActive\) return;/);
});

test("設定UIとReduced Motionの保護を持つ", () => {
  assert.match(html, /id="editorCaretAnimationEnabled"/);
  assert.match(html, /id="editorCaretAnimationDelay"/);
  assert.match(html, /id="editorCaretAnimationReducedMotion"/);
  assert.match(app, /EDITOR_CARET_ANIMATION_STORAGE_KEY/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.editor-caret-animation \{ animation: none !important; \}/);
});
