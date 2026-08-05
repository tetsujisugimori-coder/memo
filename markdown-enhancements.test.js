const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const enhancements = require("./markdown-enhancements-utils.js");

function sourceOf(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} を定義する`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < app.length; index += 1) {
    if (app[index] === "{") { depth += 1; opened = true; }
    if (app[index] === "}" && opened && --depth === 0) return app.slice(start, index + 1);
  }
  throw new Error(`${name} の終端がありません`);
}

const safeExternalUrl = Function(`${sourceOf("safeExternalUrl")} return safeExternalUrl;`)();

test("通常リンクはhttp/httpsだけを許可する", () => {
  assert.equal(safeExternalUrl("https://openai.com/a_b"), true);
  assert.equal(safeExternalUrl("http://example.test"), true);
  assert.equal(safeExternalUrl("javascript:alert(1)"), false);
  assert.equal(safeExternalUrl("data:text/html,x"), false);
});

test("斜体トークンは単語内アンダースコア、太字、エスケープを誤変換しない", () => {
  assert.match(app, /function findDelimitedInlineToken[\s\S]*?options\.wordBoundary/);
  assert.match(app, /function findDelimitedInlineToken[\s\S]*?options\.rejectDouble/);
  assert.match(app, /function findDelimitedInlineToken[\s\S]*?isEscapedMarkdownCharacter/);
});

test("行レンダラは番号付きリスト、チェックリスト、水平線、Calloutを区別する", () => {
  assert.match(app, /function renderOrderedListBlock[\s\S]*?<ol>/);
  assert.match(app, /task-list-checkbox[\s\S]*data-task-index/);
  assert.match(app, /\^\(---\+\|\\\*\\\*\\\*\+\|___\+\)\$/);
  ["NOTE", "TIP", "IMPORTANT", "WARNING"].forEach((type) => assert.match(css, new RegExp(`callout-${type.toLowerCase()}`)));
});

test("Callout操作と解説カードの独立保存UIを提供する", () => {
  assert.match(html, /id="calloutTypeSelect"/);
  assert.match(html, /id="insertCalloutBtn"/);
  assert.match(html, /id="addExplanationBtn"/);
  assert.match(html, /id="explanationDialog"/);
  assert.match(app, /note\.explanations/);
  assert.match(app, /const target = editor\.value\.slice\(start, end\)/);
  assert.match(app, /confirm\("この解説カードを削除しますか？"\)/);
  assert.match(css, /\.callout-warning/);
  assert.match(css, /\.explanation-card/);
});

test("選択した複数行をCallout化しても本文を保持し、未選択時だけ空のひな型を作る", () => {
  assert.equal(enhancements.buildCalloutMarkdown("補足の1行目です。\n補足の2行目です。", "NOTE"), "> [!NOTE]\n> 補足の1行目です。\n> 補足の2行目です。");
  assert.equal(enhancements.buildCalloutMarkdown("", "WARNING"), "> [!WARNING]\n> ");
  assert.match(app, /buildCalloutMarkdown\(editor\.value\.slice\(start, end\), type\)/);
});

test("コードフェンス内のチェックリスト風文字列を除外し、正しい本文位置だけを更新する", () => {
  const body = ["```md", "- [ ] コード例", "```", "- [ ] 本文1", "- [x] 本文2"].join("\n");
  const entries = enhancements.checklistEntries(body);
  assert.equal(entries.length, 2);
  const updated = enhancements.updateChecklistAt(body, entries[1].markerStart, false);
  assert.match(updated, /- \[ \] 本文2/);
  assert.match(updated, /- \[ \] コード例/);
  assert.match(app, /checklistEntries\(editor\.value\)/);
  assert.match(app, /updateChecklistAt\(editor\.value, entry\.markerStart, checkbox\.checked\)/);
});

test("同じ語句の2番目の出現位置をマーカー対象として識別する", () => {
  const body = "保存を開始します。\n保存を完了します。";
  const start = body.lastIndexOf("保存");
  assert.equal(enhancements.targetOccurrenceOrdinal(body, "保存", start), 1);
  assert.match(app, /insertExplanationMarker\(explanation, index \+ 1, resolved, body\)/);
  assert.match(app, /targetOccurrenceOrdinal\(body, target, resolved\.start\)/);
});

test("解説カードの折りたたみ状態を永続保存する", () => {
  assert.match(app, /saveExplanationCollapsedState\(explanation, !details\.open\)/);
  assert.match(app, /function saveExplanationCollapsedState[\s\S]*?putNote\(note\)/);
});

test("解説カードは位置ずれ後も対象本文と文脈から再特定し、見失っても保持する", () => {
  assert.match(app, /function resolveExplanationTarget[\s\S]*?body\.slice\(start, end\) === target/);
  assert.match(app, /function resolveExplanationTarget[\s\S]*?body\.indexOf\(target\)/);
  assert.match(app, /contextual = body\.indexOf/);
  assert.match(app, /return found === -1 \? \{ start: -1, end: -1, matched: false \}/);
});
