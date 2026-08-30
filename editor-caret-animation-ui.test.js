const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const { EDITOR_CARET_REPEAT_DELAY, canPlayEditorCaretAnimation, editorCaretPrefersReducedMotion } = require("./editor-caret-animation-utils.js");

const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function classListFixture() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    contains: (name) => values.has(name),
    remove: (...names) => names.forEach((name) => values.delete(name))
  };
}

function createEditorCaretRuntime({ reducedMotion = false, respectReducedMotion = true } = {}) {
  const timers = new Map();
  let nextTimerId = 1;
  const editor = {
    classList: classListFixture(),
    clientWidth: 500,
    getBoundingClientRect: () => ({ left: 10, top: 10, right: 510, bottom: 300 }),
    scrollTop: 0,
    selectionEnd: 0,
    selectionStart: 0,
    value: ""
  };
  const animation = {
    classList: classListFixture(),
    hidden: true,
    style: { setProperty() {} }
  };
  const document = {
    activeElement: editor,
    body: { append() {}, clientWidth: 1200 },
    createElement(tagName) {
      return {
        append() {},
        getBoundingClientRect: () => tagName === "span" ? { left: 20, top: 20 } : {},
        remove() {},
        style: {},
        textContent: ""
      };
    },
    querySelector: () => null,
    visibilityState: "visible"
  };
  const window = {
    clearTimeout(id) { timers.delete(id); },
    getComputedStyle: () => ({
      border: "0px",
      fontFamily: "sans-serif",
      fontSize: "16px",
      fontStyle: "normal",
      fontWeight: "400",
      letterSpacing: "normal",
      lineHeight: "28px",
      padding: "0px",
      textIndent: "0px",
      textTransform: "none",
      wordBreak: "normal"
    }),
    matchMedia(query) {
      return { matches: query === "(prefers-reduced-motion: reduce)" ? reducedMotion : true };
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    }
  };
  const context = {
    AI_GENERATION_STATES: { STREAMING: "streaming" },
    EDITOR_CARET_REPEAT_DELAY,
    aiAssistantState: { generation: "idle", panelOpen: false },
    canPlayEditorCaretAnimation,
    document,
    editor,
    editorCaretAnimation: animation,
    editorCaretAnimationActive: false,
    editorCaretAnimationRequestId: 0,
    editorCaretAnimationSettings: { enabled: true, idleDelay: 4000, respectReducedMotion },
    editorCaretAnimationTimer: null,
    editorCaretCompositionActive: false,
    editorCaretIdleTimer: null,
    editorCaretPrefersReducedMotion: () => editorCaretPrefersReducedMotion(window),
    isPopoutWindow: false,
    requestAnimationFrame: (callback) => callback(),
    window
  };
  const start = app.indexOf("function hasDesktopEditorCaretPointer()");
  const end = app.indexOf("function syncLayoutMode", start);
  assert.notEqual(start, -1, "カーソル演出の開始関数");
  assert.notEqual(end, -1, "カーソル演出の終了境界");
  vm.runInNewContext(app.slice(start, end), context);
  return { animation, context, editor, timers };
}

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

test("app.jsはカーソル演出用Reduced Motion判定を明示取得して実行経路で使う", () => {
  assert.match(app, /const \{[^\n]*editorCaretPrefersReducedMotion[^\n]*\} = window\.MemoNexusEditorCaretAnimationUtils;/);
  const runtime = createEditorCaretRuntime();
  assert.doesNotThrow(() => runtime.context.resetEditorCaretIdle());
  assert.equal(runtime.timers.size, 1);
  assert.equal([...runtime.timers.values()][0].delay, 4000);
});

test("本文フォーカスから4秒後にカーソル演出クラスを付ける", () => {
  const runtime = createEditorCaretRuntime();
  runtime.context.resetEditorCaretIdle();
  const idleTimer = [...runtime.timers.values()].find(({ delay }) => delay === 4000);
  assert.ok(idleTimer);
  idleTimer.callback();
  assert.equal(runtime.animation.classList.contains("is-animating"), true);
  assert.equal(runtime.editor.classList.contains("is-caret-animating"), true);
});

test("Reduced Motionの尊重設定だけがOS側reduce時の予約を抑止する", () => {
  const respecting = createEditorCaretRuntime({ reducedMotion: true, respectReducedMotion: true });
  assert.doesNotThrow(() => respecting.context.resetEditorCaretIdle());
  assert.equal(respecting.timers.size, 0);

  const ignoring = createEditorCaretRuntime({ reducedMotion: true, respectReducedMotion: false });
  assert.doesNotThrow(() => ignoring.context.resetEditorCaretIdle());
  assert.equal(ignoring.timers.size, 1);
  assert.equal([...ignoring.timers.values()][0].delay, 4000);
});
