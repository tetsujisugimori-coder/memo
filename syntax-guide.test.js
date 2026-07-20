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
