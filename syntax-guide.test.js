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

function createCopyHarness({ dialogOpen = false, detailDialogOpen = false, clipboardWriteText, execResult = true, execError } = {}) {
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
  const detailDialog = new TestElement("dialog");
  detailDialog.isConnected = true;
  detailDialog.open = detailDialogOpen;
  const originalFocus = new TestElement("button");
  originalFocus.isConnected = true;
  documentMock.activeElement = originalFocus;
  const navigatorMock = clipboardWriteText ? { clipboard: { writeText: clipboardWriteText } } : {};
  const consoleMock = { warn: (...args) => warnings.push(args) };
  const functions = Function(
    "document",
    "navigator",
    "syntaxGuideDialog",
    "mermaidTemplateDialog",
    "console",
    `"use strict"; ${readFunctionSource("fallbackCopyText")} ${readFunctionSource("writeSyntaxGuideText")} return { fallbackCopyText, writeSyntaxGuideText };`
  )(documentMock, navigatorMock, dialog, detailDialog, consoleMock);

  return { appendHistory, createdElements, detailDialog, dialog, documentMock, execCommands, functions, originalFocus, warnings };
}

const items = readConstant("SYNTAX_GUIDE_ITEMS");
const aliases = readConstant("HIGHLIGHT_LANGUAGE_ALIASES");
const mermaidTypes = readConstant("MERMAID_TEMPLATE_TYPES");
const mermaidItemsSource = app.match(/const MERMAID_TEMPLATE_ITEMS = ([\s\S]*?\n\]);/)?.[1];
assert.ok(mermaidItemsSource, "MERMAID_TEMPLATE_ITEMSを読み取れる");
const mermaidItems = Function(`${readFunctionSource("createMermaidTemplate")} return (${mermaidItemsSource});`)();

test("エディタ直下の操作列にアクセシブルな記法ガイドボタンを持つ", () => {
  const editorCard = html.match(/<section class="editor-card">[\s\S]*?<\/section>/)?.[0] || "";
  const titleIndex = editorCard.indexOf('class="title-row"');
  const toolsIndex = editorCard.indexOf('class="editor-tools"');
  const editorIndex = editorCard.indexOf('id="editor"');
  assert.ok(titleIndex < toolsIndex && toolsIndex < editorIndex);
  const editorTools = editorCard.match(/<div class="editor-tools"[\s\S]*?<\/div>/)?.[0] || "";
  assert.match(editorTools, /id="focusNoteTagBtn"[^>]*type="button"[^>]*title="タグを追加"[^>]*aria-label="タグを追加"[^>]*class="editor-tool-btn"[^>]*># タグ<\/button>/);
  assert.match(html, /id="syntaxGuideBtn"[^>]*type="button"[^>]*title="[^"]+"[^>]*aria-label="記法ガイドを開く"[^>]*aria-controls="syntaxGuideDialog"[^>]*aria-expanded="false"/);
});

test("タグボタンは本文へ挿入せず既存のタグ入力欄へフォーカスする", () => {
  const source = readFunctionSource("focusNoteTagInput");
  assert.match(app, /focusNoteTagBtn\?\.addEventListener\("click", focusNoteTagInput\)/);
  assert.match(source, /noteTagInput\.scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(source, /noteTagInput\.focus\(\)/);
  assert.doesNotMatch(source, /noteTagInput\.value\s*=/);
  assert.doesNotMatch(source, /editor\.|insertText|execCommand/);
});

test("記法ガイドに表ブロックの挿入・編集・制約をデータとして掲載する", () => {
  const [table] = items.filter((item) => item.category === "table");
  assert.ok(table);
  assert.equal(table.name, "表ブロック");
  assert.match(table.description, /［表］.*カーソル位置.*説明.*セル.*出典や補足/);
  assert.match(table.description, /左端の行番号.*上端の列記号.*選択中の行・列の直後/);
  assert.match(table.description, /未選択時は末尾.*追加後は選択が解除.*新しい行・列の先頭セルへカーソル/);
  assert.match(table.description, /削除時は確認画面/);
  assert.match(table.description, /Excel.*Googleスプレッドシート.*タブ区切り.*Markdown表.*HTML表/);
  assert.match(table.description, /表またはテキスト.*1行目を見出し/);
  assert.match(table.description, /操作メニュー.*Excel.*Googleスプレッドシート.*表全体コピー.*Markdown表として.*HTML対応アプリ/);
  assert.match(table.notes, /説明文と補足文.*含みません.*行や列を選択.*表全体/);
  assert.match(table.notes, /100行・30列・3000セル/);
  assert.match(table.notes, /CSV.*自動判定しません/);
  assert.match(table.notes, /結合セル.*完全には再現されません/);
  assert.match(table.notes, /Tab.*Shift\+Tab.*最後のセル.*行を追加/);
  assert.match(table.notes, /行と列は同時には選択されません.*最後の1行・1列は削除できません/);
  assert.match(table.notes, /見出し行のオン／オフ.*表全体の削除/);
  assert.match(table.notes, /プレーンテキスト.*数式・計算・セル結合・色指定・並べ替え・絞り込みには未対応/);
  assert.match(table.notes, /狭い画面.*表だけを横スクロール/);
  assert.equal(table.copyable, false);
  assert.match(app, /category: "table", title: "表ブロック"/);
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

test("Mermaid詳細dialogにタイトル、閉じるボタン、内部スクロール、ライブ領域を持つ", () => {
  const dialog = html.match(/<dialog id="mermaidTemplateDialog"[\s\S]*?<\/dialog>/)?.[0] || "";
  assert.match(dialog, /aria-labelledby="mermaidTemplateTitle"/);
  assert.match(dialog, /id="mermaidTemplateTitle">Mermaidテンプレート/);
  assert.match(dialog, /id="closeMermaidTemplateBtn"[^>]*aria-label="Mermaidテンプレート詳細を閉じる"/);
  assert.match(dialog, /id="mermaidTemplateBody"/);
  assert.match(dialog, /id="mermaidTemplateStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(css, /\.mermaid-template-body\s*\{[^}]*overflow-y:\s*auto;/s);
});

test("対応するMarkdown記法とMemo Nexus独自機能を掲載する", () => {
  const markdown = items.filter((item) => item.category === "markdown");
  assert.deepEqual(markdown.map((item) => item.syntax), [
    "# 見出し",
    "## 見出し",
    "### 見出し",
    "**重要**",
    "*強調* または _強調_",
    "~~削除予定~~",
    "1. 1つ目\n2. 2つ目",
    "- [ ] 未完了\n- [x] 完了",
    "---",
    "[OpenAI](https://openai.com)",
    "> [!NOTE]\n> 補足情報です。",
    ["<!-- memo-nexus:image-block -->", "![画像説明](attachment://a1b2c3)", "<!-- memo-nexus:image-caption -->", "画像の説明文", "<!-- /memo-nexus:image-block -->"].join("\n"),
    ["<!-- memo-nexus:image-block -->", "![画像](attachment://a1b2c3)", "<!-- memo-nexus:image-caption -->", "タイトル", "- 箇条書き", "画像コメント", "<!-- /memo-nexus:image-block -->"].join("\n"),
    "本文を選択して［解説］を挿入、またはカーソル位置へ雛形を挿入",
    "画像ボタンでカーソル位置へ画像を挿入",
    "本文中の画像ブロックを削除しても添付画像は残る",
    "`const value = 1;`",
    "- 項目",
    "> 引用文",
    "[[メモ名]]"
  ]);
  assert.ok(markdown.every((item) => item.name && item.description && item.notes));
  ["画像ブロック", "画像キャプション", "解説ブロック", "画像", "本文から画像を削除して添付保持", "斜体", "打ち消し線", "番号付きリスト", "チェックリスト", "通常リンク", "水平線", "注意書き"].forEach((name) => {
    assert.ok(markdown.some((item) => item.name === name));
  });
  assert.match(markdown.find((item) => item.name === "通常リンク").notes, /javascript/);
  assert.equal(markdown.find((item) => item.name === "解説ブロック").copyable, false);
  assert.equal(markdown.find((item) => item.name === "画像ブロック").copyable, false);
});

test("記法ガイドはタグを本文のMarkdown見出しと分けて説明する", () => {
  const [tag] = items.filter((item) => item.category === "tag");
  assert.ok(tag);
  assert.equal(tag.name, "登録済みタグの作成・付与・絞り込み");
  assert.match(tag.syntax, /［タグ］タブの［タグを作成］で「資料」を登録[\s\S]*登録済みタグ「資料」が作られる/);
  assert.match(tag.syntax, /タイトル下のタグ選択欄で「資料」を選択[\s\S]*登録済みタグ「資料」が付く/);
  assert.match(tag.syntax, /#資料[\s\S]*本文。タグにはならない/);
  assert.match(tag.syntax, /# 見出し[\s\S]*Markdown見出し。タグではない/);
  assert.match(tag.description, /分類・絞り込み.*登録済みラベル/);
  assert.match(tag.description, /右側［タグ］タブ.*［タグを作成］/);
  assert.match(tag.description, /タイトル下のタグ選択欄.*［# タグ］ボタン/);
  assert.match(tag.notes, /本文に「#資料」と書いてもタグにはなりません/);
  assert.match(tag.notes, /「# 見出し」.*Markdown見出し/);
  assert.match(tag.notes, /本文検索とタグ絞り込みは別の機能/);
  assert.match(app, /category: "tag", title: "タグ"[\s\S]*登録済みラベル/);
});

test("数式カテゴリにKaTeXの表示例と表示専用である注意を掲載する", () => {
  const math = items.filter((item) => item.category === "math");
  const names = math.map((item) => item.name);
  [
    "インライン数式", "ブロック数式", "分数", "平方根", "累乗", "添字", "円周率",
    "掛け算記号", "割り算記号", "プラスマイナス", "等しくない", "およそ等しい",
    "以下", "以上", "総和", "積分", "極限", "括弧", "行列", "複数行の式"
  ].forEach((name) => assert.ok(names.includes(name), `${name}を掲載する`));
  assert.equal(math.find((item) => item.name === "インライン数式").syntax, "円の面積は $A = \\pi r^2$ です。");
  const inlineExamples = ["分数", "平方根", "累乗", "添字", "円周率", "掛け算記号", "割り算記号", "プラスマイナス", "等しくない", "およそ等しい", "以下", "以上", "括弧"];
  inlineExamples.forEach((name) => {
    const syntax = math.find((item) => item.name === name).syntax;
    assert.ok(syntax.startsWith("$") && syntax.endsWith("$") && !syntax.startsWith("$$"), `${name}をインライン数式の完成形にする`);
  });
  const blockExamples = ["ブロック数式", "総和", "積分", "極限", "行列", "複数行の式"];
  blockExamples.forEach((name) => {
    const syntax = math.find((item) => item.name === name).syntax;
    assert.ok(syntax.startsWith("$$\n") && syntax.endsWith("\n$$"), `${name}をブロック数式の完成形にする`);
  });
  assert.equal(math.find((item) => item.name === "分数").syntax, "$\\frac{a}{b}$");
  assert.equal(math.find((item) => item.name === "平方根").syntax, "$\\sqrt{x}$");
  assert.equal(math.find((item) => item.name === "累乗").syntax, "$x^2$");
  assert.match(math.find((item) => item.name === "行列").syntax, /^\$\$\n\\begin\{pmatrix\}[\s\S]*\\end\{pmatrix\}\n\$\$$/);
  assert.match(math.find((item) => item.name === "平方根").notes, /表示専用.*sqrt\(\).*対応していません/);
  assert.match(math.find((item) => item.name === "累乗").notes, /表示専用.*\^.*対応していません/);
  assert.match(app, /category: "math", title: "数式"[\s\S]*KaTeX記法.*計算は行いません/);
});

test("計算ブロックカテゴリにCalculator Memo準拠の対応範囲と制限を掲載する", () => {
  const calculation = items.filter((item) => item.category === "calculation");
  const names = calculation.map((item) => item.name);
  ["基本構文", "加算", "減算", "乗算", "除算", "括弧", "小数", "パーセント", "Calculator Memoで計算", "非対応項目"]
    .forEach((name) => assert.ok(names.includes(name), `${name}を掲載する`));
  const percent = calculation.find((item) => item.name === "パーセント");
  assert.match(percent.syntax, /200 \* 10%/);
  assert.match(percent.description, /10÷100.*結果は20/);
  assert.match(percent.notes, /200 \+ 10% は200\.1/);
  const unsupported = calculation.find((item) => item.name === "非対応項目");
  assert.match(unsupported.syntax, /2\^10[\s\S]*sqrt\(2\)/);
  assert.match(unsupported.description, /累乗.*平方根.*数学関数.*変数.*複数式.*複数行計算.*ブロック間参照/);
  assert.match(unsupported.notes, /KaTeX.*計算ブロック.*コードブロック内.*実行されません/);
  const calculatorLink = calculation.find((item) => item.name === "Calculator Memoで計算");
  assert.match(calculatorLink.description, /本文中の計算式を選択.*［計算］.*新しいタブ/);
  assert.match(calculatorLink.notes, /選択していない場合.*空のCalculator Memo/);
  assert.match(app, /category: "calculation", title: "計算ブロック"[\s\S]*Calculator Memo.*1つの独立した式/);
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

test("Mermaidの9種類に各5個の完成テンプレートを持つ", () => {
  assert.deepEqual(mermaidTypes, [
    { type: "flowchart", name: "フローチャート" },
    { type: "sequenceDiagram", name: "シーケンス図" },
    { type: "stateDiagram-v2", name: "状態遷移図" },
    { type: "classDiagram", name: "クラス図" },
    { type: "erDiagram", name: "ER図" },
    { type: "gantt", name: "ガントチャート" },
    { type: "gitGraph", name: "Gitグラフ" },
    { type: "timeline", name: "タイムライン" },
    { type: "mindmap", name: "マインドマップ" }
  ]);
  assert.equal(mermaidItems.length, 45);
  mermaidTypes.forEach(({ type }) => assert.equal(mermaidItems.filter((item) => item.type === type).length, 5));
  mermaidItems.forEach((item) => {
    assert.equal(item.category, "mermaid");
    assert.match(item.syntax, /^```mermaid\n/);
    assert.match(item.syntax, /\n```$/);
    assert.ok(item.type && item.name && item.description && item.notes);
  });
});

test("追加した5種類を含め、各テンプレートは分類名と一致するMermaid宣言を持つ", () => {
  mermaidItems.forEach((item) => {
    const source = item.syntax.split("\n").slice(1, -1).join("\n");
    const expectedDeclaration = item.type === "flowchart" ? /^flowchart\s+(TD|LR)/ : new RegExp(`^${item.type}(?:\\s|$)`);
    assert.match(source, expectedDeclaration, `${item.type}: ${item.name}`);
  });
  assert.match(mermaidItems.find((item) => item.type === "erDiagram").syntax, /erDiagram[\s\S]*\|\|--o\{/);
  assert.match(mermaidItems.find((item) => item.type === "gantt").syntax, /gantt[\s\S]*dateFormat YYYY-MM-DD/);
  assert.match(mermaidItems.find((item) => item.type === "gitGraph").syntax, /gitGraph[\s\S]*commit id:/);
  assert.match(mermaidItems.find((item) => item.type === "timeline").syntax, /timeline[\s\S]*title/);
  assert.match(mermaidItems.find((item) => item.type === "mindmap").syntax, /mindmap[\s\S]*root\(\(/);
});

test("Mermaid一覧は9種類の詳細ボタンを作り、選択種類だけを詳細表示する", () => {
  const listSource = readFunctionSource("createMermaidTypeList");
  const detailsSource = readFunctionSource("renderMermaidTemplateDetails");
  assert.match(listSource, /MERMAID_TEMPLATE_TYPES\.forEach/);
  assert.match(listSource, /button\.textContent = "詳細"/);
  assert.match(listSource, /`\$\{templateType\.name\}のテンプレート詳細を開く`/);
  assert.match(listSource, /aria-controls", "mermaidTemplateDialog"/);
  assert.match(detailsSource, /item\.type === templateType\.type/);
  assert.match(detailsSource, /createSyntaxGuideItem\(item, mermaidTemplateStatus\)/);
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

test("Mermaid詳細表示中のフォールバックは最前面の詳細dialogを追加先にする", () => {
  const harness = createCopyHarness({ dialogOpen: true, detailDialogOpen: true });
  harness.functions.fallbackCopyText("詳細からコピー");
  assert.equal(harness.appendHistory[0].container, harness.detailDialog);
  assert.equal(harness.detailDialog.children.length, 0);
  assert.equal(harness.documentMock.activeElement, harness.originalFocus);
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
  assert.match(app, /closeMermaidTemplateBtn[\s\S]*addEventListener\("click", closeMermaidTemplateDetails\)/);
  assert.match(app, /mermaidTemplateDialog\.addEventListener\("close"[\s\S]*trigger\.focus\(\{ preventScroll: true \}\)/);
});

test("ライト・ダーク共通変数と狭幅container queryで表示する", () => {
  const guideCss = css.match(/\.syntax-guide-dialog[\s\S]*?\.syntax-guide-copy-fallback\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(guideCss, /var\(--paper\)/);
  assert.match(guideCss, /var\(--ink\)/);
  assert.match(guideCss, /var\(--line\)/);
  assert.match(guideCss, /var\(--section-bg\)/);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)[\s\S]*\.syntax-guide-dialog,[\s\S]*\.mermaid-template-dialog,[\s\S]*\.table-paste-dialog\s*\{[^}]*width:\s*calc\(100vw - 16px\)/s);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)[\s\S]*\.syntax-guide-items,[\s\S]*\.mermaid-type-list,[\s\S]*\.syntax-guide-aliases\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /\.mermaid-template-dialog \.syntax-guide-item pre\s*\{[^}]*white-space:\s*pre;[^}]*overflow-wrap:\s*normal;/s);
});

test("app.jsのキャッシュ番号を更新し、PR #24の画面外Mermaid描画経路を維持する", () => {
  assert.match(html, /app\.js\?v=0\.4\.0-86/);
  assert.match(html, /table-block-utils\.js\?v=0\.4\.0-4/);
  assert.match(app, /mermaid\.render\(/);
  assert.doesNotMatch(app, /mermaid\.run\(/);
  assert.match(app, /mermaidRenderGeneration/);
  assert.match(app, /mermaidRenderQueue/);
});
