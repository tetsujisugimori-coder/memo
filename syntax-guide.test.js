"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");

function readConstant(name) {
  const match = app.match(new RegExp(`const ${name} = ([\\s\\S]*?\\n[\\]\\}]);`));
  assert.ok(match, `${name}を読み取れる`);
  return Function(`return (${match[1]});`)();
}

function readFunctionSource(name) {
  const functionStart = app.indexOf(`function ${name}(`);
  assert.ok(functionStart >= 0, `${name}を読み取れる`);
  const start = app.slice(functionStart - 6, functionStart) === "async " ? functionStart - 6 : functionStart;
  const openingBrace = app.indexOf("{", start);
  let depth = 0;
  for (let index = openingBrace; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }
  throw new Error(`${name}の終端を読み取れません`);
}

function createCopyHarness({ dialogOpen = false, clipboardWriteText, execResult = true, execError } = {}) {
  const appendHistory = [];
  const createdElements = [];
  const execCommands = [];
  const warnings = [];
  const documentMock = { activeElement: null };

  class TestElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.isConnected = false;
      this.focusCalls = [];
      this.value = "";
    }

    setAttribute(name, value) {
      this[name] = value;
    }

    append(child) {
      child.parentElement = this;
      child.isConnected = true;
      this.children.push(child);
      appendHistory.push({ container: this, child });
    }

    focus(options) {
      this.focusCalls.push(options);
      documentMock.activeElement = this;
    }

    select() {
      this.selectCalled = true;
    }

    setSelectionRange(start, end) {
      this.selectionRange = [start, end];
    }

    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      }
      this.parentElement = null;
      this.isConnected = false;
      this.removeCalled = true;
    }
  }

  documentMock.createElement = (tagName) => {
    const element = new TestElement(tagName);
    createdElements.push(element);
    return element;
  };
  documentMock.execCommand = (command) => {
    execCommands.push(command);
    if (execError) throw execError;
    return execResult;
  };
  documentMock.body = new TestElement("body");
  documentMock.body.isConnected = true;

  const dialog = new TestElement("dialog");
  dialog.isConnected = true;
  dialog.open = dialogOpen;
  const originalFocus = new TestElement("button");
  originalFocus.isConnected = true;
  documentMock.activeElement = originalFocus;
  const navigatorMock = clipboardWriteText ? { clipboard: { writeText: clipboardWriteText } } : {};
  const consoleMock = { warn: (...args) => warnings.push(args) };
  const functions = Function(
    "document",
    "navigator",
    "syntaxGuideDialog",
    "console",
    `"use strict"; ${readFunctionSource("fallbackCopyText")} ${readFunctionSource("writeSyntaxGuideText")} return { fallbackCopyText, writeSyntaxGuideText };`
  )(documentMock, navigatorMock, dialog, consoleMock);

  return { appendHistory, createdElements, dialog, documentMock, execCommands, functions, originalFocus, warnings };
}

const items = readConstant("SYNTAX_GUIDE_ITEMS");
const aliases = readConstant("HIGHLIGHT_LANGUAGE_ALIASES");

test("エディタ直下の操作列にアクセシブルな記法ガイドボタンを持つ", () => {
  const editorCard = html.match(/<section class="editor-card">[\s\S]*?<\/section>/)?.[0] || "";
  const titleIndex = editorCard.indexOf('class="title-row"');
  const toolsIndex = editorCard.indexOf('class="editor-tools"');
  const editorIndex = editorCard.indexOf('id="editor"');
  assert.ok(titleIndex < toolsIndex && toolsIndex < editorIndex);
  assert.match(html, /id="syntaxGuideBtn"[^>]*type="button"[^>]*title="[^"]+"[^>]*aria-label="記法ガイドを開く"[^>]*aria-controls="syntaxGuideDialog"[^>]*aria-expanded="false"/);
});

test("専用dialogに見出し、閉じるボタン、スクロール本文、ライブ領域を持つ", () => {
  const dialog = html.match(/<dialog id="syntaxGuideDialog"[\s\S]*?<\/dialog>/)?.[0] || "";
  assert.match(dialog, /aria-labelledby="syntaxGuideTitle"/);
  assert.match(dialog, /id="syntaxGuideTitle">記法ガイド/);
  assert.match(dialog, /id="closeSyntaxGuideBtn"[^>]*type="button"[^>]*aria-label="記法ガイドを閉じる"/);
  assert.match(dialog, /id="syntaxGuideBody"/);
  assert.match(dialog, /id="syntaxGuideStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(css, /\.syntax-guide-body\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.syntax-guide-dialog::backdrop\s*\{[^}]*var\(--dialog-backdrop\)/s);
});

test("現在対応するMarkdown記法だけを掲載する", () => {
  const markdown = items.filter((item) => item.category === "markdown");
  assert.deepEqual(markdown.map((item) => item.syntax), [
    "# 見出し",
    "## 見出し",
    "### 見出し",
    "**重要**",
    "`const value = 1;`",
    "- 項目",
    "> 引用文",
    "[[メモ名]]"
  ]);
  assert.ok(markdown.every((item) => item.name && item.description && item.notes));
  const unsupported = ["斜体", "取り消し線", "番号付きリスト", "チェックボックス", "Markdownリンク", "水平線", "Markdown表"];
  unsupported.forEach((name) => assert.ok(!markdown.some((item) => item.name === name)));
});

test("コードブロックの完成例、説明、実装中の短縮名を掲載する", () => {
  const [code] = items.filter((item) => item.category === "code");
  assert.equal(code.syntax, [
    "```javascript",
    'const greeting = "Hello, Memo Nexus!";',
    "console.log(greeting);",
    "```"
  ].join("\n"));
  assert.match(code.description, /開始側.*バッククォート3個.*言語名.*終了側.*バッククォート3個/);
  assert.match(code.notes, /highlight\.js.*自動判定.*色を付けず.*実行されません/);
  assert.deepEqual(aliases, {
    js: "javascript", ts: "typescript", html: "xml", py: "python", sh: "bash",
    shell: "bash", ps: "powershell", md: "markdown", yml: "yaml"
  });
});

test("Mermaidの4種類はmermaid指定を含む完成例になっている", () => {
  const mermaid = items.filter((item) => item.category === "mermaid");
  assert.deepEqual(mermaid.map((item) => item.name), ["フローチャート", "シーケンス図", "状態遷移図", "クラス図"]);
  mermaid.forEach((item) => {
    assert.match(item.syntax, /^```mermaid\n/);
    assert.match(item.syntax, /\n```$/);
    assert.ok(item.description && item.notes);
  });
  assert.match(mermaid[0].syntax, /flowchart TD[\s\S]*\{条件を満たす\?\}[\s\S]*はい[\s\S]*いいえ/);
  assert.match(mermaid[1].syntax, /sequenceDiagram[\s\S]*participant[\s\S]*->>[\s\S]*-->>/);
  assert.match(mermaid[2].syntax, /stateDiagram-v2[\s\S]*\[\*\][\s\S]*編集中[\s\S]*保存中[\s\S]*保存済み/);
  assert.match(mermaid[3].syntax, /classDiagram[\s\S]*class Memo[\s\S]*class Attachment[\s\S]*-->/);
});

test("コピーはClipboard APIとフォールバック、成功復帰、失敗案内を持つ", () => {
  assert.match(app, /navigator\.clipboard[\s\S]*navigator\.clipboard\.writeText\(text\)/);
  assert.match(app, /document\.execCommand\("copy"\)/);
  assert.match(app, /button\.textContent = "コピーしました"/);
  assert.match(app, /setTimeout\([\s\S]*button\.textContent = originalLabel;[\s\S]*1800\)/);
  assert.match(app, /console\.error\("Syntax guide copy failed", error\)/);
  assert.match(app, /コピーできませんでした。記法を選択してコピーしてください。/);
  assert.match(app, /setAttribute\("aria-label", `\$\{item\.name\}の記法をコピー`\)/);
});

test("モーダル表示中のフォールバックはdialog内で選択し元のフォーカスを復元する", () => {
  const harness = createCopyHarness({ dialogOpen: true });
  harness.functions.fallbackCopyText("モーダル内コピー");

  const textarea = harness.createdElements[0];
  assert.equal(harness.appendHistory[0].container, harness.dialog);
  assert.equal(textarea.focusCalls.length, 1);
  assert.equal(textarea.selectCalled, true);
  assert.deepEqual(textarea.selectionRange, [0, "モーダル内コピー".length]);
  assert.deepEqual(harness.execCommands, ["copy"]);
  assert.equal(textarea.removeCalled, true);
  assert.equal(harness.dialog.children.length, 0);
  assert.equal(harness.documentMock.activeElement, harness.originalFocus);
  assert.equal(harness.originalFocus.focusCalls.length, 1);
});

test("ダイアログが閉じている場合のフォールバックはbodyを安全な追加先にする", () => {
  const harness = createCopyHarness({ dialogOpen: false });
  harness.functions.fallbackCopyText("bodyでコピー");

  assert.equal(harness.appendHistory[0].container, harness.documentMock.body);
  assert.equal(harness.documentMock.body.children.length, 0);
});

test("Clipboard API成功時はフォールバックを呼ばない", async () => {
  const clipboardCalls = [];
  const harness = createCopyHarness({ clipboardWriteText: async (text) => clipboardCalls.push(text) });
  await harness.functions.writeSyntaxGuideText("Clipboard API");

  assert.deepEqual(clipboardCalls, ["Clipboard API"]);
  assert.equal(harness.createdElements.length, 0);
  assert.equal(harness.execCommands.length, 0);
});

test("Clipboard API失敗時はモーダル内フォールバックへ進む", async () => {
  const harness = createCopyHarness({
    dialogOpen: true,
    clipboardWriteText: async () => { throw new Error("Clipboard API failed"); }
  });
  await harness.functions.writeSyntaxGuideText("fallback");

  assert.equal(harness.warnings.length, 1);
  assert.equal(harness.appendHistory[0].container, harness.dialog);
  assert.deepEqual(harness.execCommands, ["copy"]);
  assert.equal(harness.createdElements[0].removeCalled, true);
});

test("execCommandのfalseと例外は失敗扱いにし一時textareaを必ず削除する", () => {
  const falseHarness = createCopyHarness({ execResult: false });
  assert.throws(() => falseHarness.functions.fallbackCopyText("false"), /コピー操作が拒否されました/);
  assert.equal(falseHarness.createdElements[0].removeCalled, true);
  assert.equal(falseHarness.documentMock.body.children.length, 0);

  const thrownHarness = createCopyHarness({ execError: new Error("execCommand failed") });
  assert.throws(() => thrownHarness.functions.fallbackCopyText("throw"), /execCommand failed/);
  assert.equal(thrownHarness.createdElements[0].removeCalled, true);
  assert.equal(thrownHarness.documentMock.body.children.length, 0);
  assert.equal(thrownHarness.documentMock.activeElement, thrownHarness.originalFocus);
});

test("フォールバックコピーは本文・選択範囲・スクロール位置を変更しない", () => {
  const harness = createCopyHarness();
  const editor = harness.originalFocus;
  Object.assign(editor, {
    value: "変更しない本文",
    selectionStart: 3,
    selectionEnd: 8,
    scrollTop: 120
  });
  const before = { value: editor.value, selectionStart: editor.selectionStart, selectionEnd: editor.selectionEnd, scrollTop: editor.scrollTop };
  harness.functions.fallbackCopyText("copy only");

  assert.deepEqual(
    { value: editor.value, selectionStart: editor.selectionStart, selectionEnd: editor.selectionEnd, scrollTop: editor.scrollTop },
    before
  );
  assert.equal(harness.documentMock.activeElement, editor);
});

test("開閉はaria-expandedを同期し本文・保存・Undo処理から独立する", () => {
  assert.match(app, /syntaxGuideBtn\.setAttribute\("aria-expanded", "true"\);[\s\S]*syntaxGuideDialog\.showModal\(\)/);
  assert.match(app, /closeSyntaxGuideBtn[\s\S]*addEventListener\("click", closeSyntaxGuide\)/);
  assert.match(app, /syntaxGuideDialog\.addEventListener\("close", \(\) => \{[\s\S]*aria-expanded", "false"/);
  const guideFunctions = app.match(/function createSyntaxGuideCopyButton[\s\S]*?function closeSyntaxGuide\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(guideFunctions, /editor\.value|titleInput\.value|scheduleSave|captureUndoSnapshot|undoStack|scrollTop/);
});

test("ライト・ダーク共通変数と狭幅container queryで表示する", () => {
  const guideCss = css.match(/\.syntax-guide-dialog[\s\S]*?\.syntax-guide-copy-fallback\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(guideCss, /var\(--paper\)/);
  assert.match(guideCss, /var\(--ink\)/);
  assert.match(guideCss, /var\(--line\)/);
  assert.match(guideCss, /var\(--section-bg\)/);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)[\s\S]*\.syntax-guide-dialog\s*\{[^}]*width:\s*calc\(100vw - 16px\)/s);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)[\s\S]*\.syntax-guide-items,[\s\S]*\.syntax-guide-aliases\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
});
