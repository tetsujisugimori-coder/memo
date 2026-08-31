const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const { EDITOR_CARET_REPEAT_DELAY, canPlayEditorCaretAnimation, editorCaretPrefersReducedMotion, normalizeEditorCaretAnimationSettings } = require("./editor-caret-animation-utils.js");

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

function createEditorCaretRuntime({ enabled = true, reducedMotion = false, respectReducedMotion = true, savedSettings = null } = {}) {
  const timers = new Map();
  const storage = new Map();
  let nextTimerId = 1;
  if (savedSettings) storage.set("memo-nexus-editor-caret-animation", JSON.stringify(savedSettings));
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
    documentElement: { dataset: { editorCaretRespectReducedMotion: "true" } },
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
  const controls = {
    delay: { value: "4000" },
    enabled: { checked: enabled },
    reducedMotion: { checked: respectReducedMotion }
  };
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  };
  const context = {
    AI_GENERATION_STATES: { STREAMING: "streaming" },
    EDITOR_CARET_ANIMATION_STORAGE_KEY: "memo-nexus-editor-caret-animation",
    EDITOR_CARET_REPEAT_DELAY,
    aiAssistantState: { generation: "idle", panelOpen: false },
    canPlayEditorCaretAnimation,
    console: { warn() {} },
    document,
    editor,
    editorCaretAnimation: animation,
    editorCaretAnimationActive: false,
    editorCaretAnimationDelay: controls.delay,
    editorCaretAnimationEnabled: controls.enabled,
    editorCaretAnimationRequestId: 0,
    editorCaretAnimationReducedMotion: controls.reducedMotion,
    editorCaretAnimationSettings: { enabled, idleDelay: 4000, respectReducedMotion },
    editorCaretAnimationTimer: null,
    editorCaretCompositionActive: false,
    editorCaretIdleTimer: null,
    editorCaretPrefersReducedMotion: () => editorCaretPrefersReducedMotion(window),
    isPopoutWindow: false,
    localStorage,
    normalizeEditorCaretAnimationSettings,
    requestAnimationFrame: (callback) => callback(),
    window
  };
  const start = app.indexOf("function restoreEditorCaretAnimationSettings()");
  const end = app.indexOf("function syncLayoutMode", start);
  assert.notEqual(start, -1, "カーソル演出の開始関数");
  assert.notEqual(end, -1, "カーソル演出の終了境界");
  vm.runInNewContext(app.slice(start, end), context);
  context.applyEditorCaretAnimationSettings({ enabled, idleDelay: 4000, respectReducedMotion });
  return { animation, context, controls, document, editor, storage, timers };
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
  assert.match(html, /<html lang="ja" data-editor-caret-respect-reduced-motion="true">/);
  assert.match(app, /EDITOR_CARET_ANIMATION_STORAGE_KEY/);
  const initStart = app.indexOf("async function init()");
  const restoreIndex = app.indexOf("restoreEditorCaretAnimationSettings();", initStart);
  const firstAwaitIndex = app.indexOf("await ", initStart);
  assert.ok(initStart >= 0 && restoreIndex > initStart && restoreIndex < firstAwaitIndex);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*html\[data-editor-caret-respect-reduced-motion="true"\] \.editor-caret-animation \{ animation: none !important; \}\s*\}/);
  assert.doesNotMatch(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.editor-caret-animation \{/);
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

test("OSと尊重設定の4組み合わせでタイマー予約を決定する", () => {
  const normalRespecting = createEditorCaretRuntime({ reducedMotion: false, respectReducedMotion: true });
  normalRespecting.context.resetEditorCaretIdle();
  assert.equal(normalRespecting.timers.size, 1);

  const normalIgnoring = createEditorCaretRuntime({ reducedMotion: false, respectReducedMotion: false });
  normalIgnoring.context.resetEditorCaretIdle();
  assert.equal(normalIgnoring.timers.size, 1);

  const respecting = createEditorCaretRuntime({ reducedMotion: true, respectReducedMotion: true });
  assert.doesNotThrow(() => respecting.context.resetEditorCaretIdle());
  assert.equal(respecting.timers.size, 0);

  const ignoring = createEditorCaretRuntime({ reducedMotion: true, respectReducedMotion: false });
  assert.doesNotThrow(() => ignoring.context.resetEditorCaretIdle());
  assert.equal(ignoring.timers.size, 1);
  assert.equal([...ignoring.timers.values()][0].delay, 4000);
});

test("OS側reduceでも尊重OFFならDOM状態とCSSが回転を許可する", () => {
  const runtime = createEditorCaretRuntime({ reducedMotion: true, respectReducedMotion: false });
  assert.equal(runtime.document.documentElement.dataset.editorCaretRespectReducedMotion, "false");
  runtime.context.resetEditorCaretIdle();
  const idleTimer = [...runtime.timers.values()].find(({ delay }) => delay === 4000);
  assert.ok(idleTimer);
  idleTimer.callback();
  assert.equal(runtime.animation.classList.contains("is-animating"), true);
  assert.equal(runtime.editor.classList.contains("is-caret-animating"), true);
  assert.match(css, /html\[data-editor-caret-respect-reduced-motion="true"\] \.editor-caret-animation/);
  assert.doesNotMatch(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.editor-caret-animation \{/);
});

test("設定の復元・保存・双方向切替でReduced Motion用DOM状態を同期する", () => {
  const runtime = createEditorCaretRuntime({
    respectReducedMotion: true,
    savedSettings: { enabled: true, idleDelay: 4000, respectReducedMotion: false }
  });
  runtime.context.restoreEditorCaretAnimationSettings();
  assert.equal(runtime.document.documentElement.dataset.editorCaretRespectReducedMotion, "false");
  assert.equal(runtime.controls.reducedMotion.checked, false);

  runtime.controls.reducedMotion.checked = true;
  runtime.context.saveEditorCaretAnimationSettings();
  assert.equal(runtime.document.documentElement.dataset.editorCaretRespectReducedMotion, "true");
  assert.equal(JSON.parse(runtime.storage.get("memo-nexus-editor-caret-animation")).respectReducedMotion, true);

  runtime.controls.reducedMotion.checked = false;
  runtime.context.saveEditorCaretAnimationSettings();
  assert.equal(runtime.document.documentElement.dataset.editorCaretRespectReducedMotion, "false");
  assert.equal(JSON.parse(runtime.storage.get("memo-nexus-editor-caret-animation")).respectReducedMotion, false);
});

test("カーソルアニメーションOFFではタイマーを予約しない", () => {
  const runtime = createEditorCaretRuntime({ enabled: false, reducedMotion: false, respectReducedMotion: false });
  assert.doesNotThrow(() => runtime.context.resetEditorCaretIdle());
  assert.equal(runtime.timers.size, 0);
});
