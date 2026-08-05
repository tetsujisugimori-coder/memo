const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const enhancements = require("./markdown-enhancements-utils.js");

function createDomHarness(textEntries) {
  class FakeElement {
    constructor(tagName = "div", excluded = false) {
      this.tagName = tagName.toUpperCase();
      this.excluded = excluded;
      this.children = [];
      this.listeners = {};
      this.attributes = {};
    }
    closest() { return this.excluded ? this : null; }
    insertBefore(child, reference) {
      const index = this.children.indexOf(reference);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
      child.parentNode = this;
      child.parentElement = this;
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }
  class FakeTextNode {
    constructor(value, parent) {
      this.nodeValue = value;
      this.parentNode = parent;
      this.parentElement = parent;
    }
    splitText(offset) {
      const sibling = new FakeTextNode(this.nodeValue.slice(offset), this.parentNode);
      this.nodeValue = this.nodeValue.slice(0, offset);
      const index = this.parentNode.children.indexOf(this);
      this.parentNode.children.splice(index + 1, 0, sibling);
      return sibling;
    }
  }
  const nodes = textEntries.map(({ text, excluded = false }) => {
    const parent = new FakeElement("span", excluded);
    const node = new FakeTextNode(text, parent);
    parent.children.push(node);
    return { parent, node };
  });
  const documentRef = {
    createTreeWalker() {
      let index = 0;
      const textNodes = nodes.map((entry) => entry.node);
      return { nextNode: () => textNodes[index++] || null };
    },
    createElement: (tagName) => new FakeElement(tagName)
  };
  return { root: { ownerDocument: documentRef }, nodes };
}

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

test("Markdownリンクと画像URLを表示位置の出現回数へ含めず、正しい対象を識別する", () => {
  const linked = "[保存](https://example.com/保存) 保存";
  const linkedStart = linked.lastIndexOf("保存");
  assert.equal(enhancements.visibleTargetOrdinal(linked, "保存", linkedStart, linkedStart + 2), 1);
  const image = "![説明](https://example.com/保存.png) 保存";
  const imageStart = image.lastIndexOf("保存");
  assert.equal(enhancements.visibleTargetOrdinal(image, "保存", imageStart, imageStart + 2), 0);
  assert.match(app, /visibleTargetForSourceRange\(body, resolved\.start, resolved\.end\)/);
});

test("Markdown記号を含むソース選択から表示文字列と出現順を分けて解決する", () => {
  const body = "**保存** 保存";
  assert.deepEqual(enhancements.visibleTargetForSourceRange(body, 0, 6), { displayText: "保存", ordinal: 0, matched: true });
  const plainStart = body.lastIndexOf("保存");
  assert.deepEqual(enhancements.visibleTargetForSourceRange(body, plainStart, plainStart + 2), { displayText: "保存", ordinal: 1, matched: true });
  assert.deepEqual(enhancements.visibleTargetForSourceRange("**保存** と *閉じる*", 0, 13), { displayText: "", ordinal: -1, matched: false });
});

test("解決した表示位置へ実際にマーカーを挿入し、カードと既存マーカーは検索対象から除外する", () => {
  const harness = createDomHarness([
    { text: "保存" },
    { text: "保存" },
    { text: "保存" },
    { text: "保存", excluded: true },
    { text: "保存", excluded: true }
  ]);
  const inserted = enhancements.insertExplanationMarkerIntoDom(harness.root, { displayText: "保存", ordinal: 2, number: 3 });
  assert.equal(inserted, true);
  assert.equal(harness.nodes[0].parent.children.some((child) => child.className === "explanation-marker"), false);
  assert.equal(harness.nodes[1].parent.children.some((child) => child.className === "explanation-marker"), false);
  const marker = harness.nodes[2].parent.children.find((child) => child.className === "explanation-marker");
  assert.equal(marker.textContent, "3");
  assert.equal(marker.attributes["aria-label"], "解説カード3を表示");
  assert.equal(harness.nodes[3].parent.children.length, 1);
  assert.equal(harness.nodes[4].parent.children.length, 1);
});

test("太字として描画された文字列にも解説マーカーを挿入できる", () => {
  const visible = enhancements.visibleTargetForSourceRange("**保存**", 0, 6);
  const harness = createDomHarness([{ text: "保存" }]);
  assert.equal(enhancements.insertExplanationMarkerIntoDom(harness.root, { ...visible, number: 1 }), true);
  assert.equal(harness.nodes[0].parent.children.some((child) => child.className === "explanation-marker"), true);
});

test("再特定は一意な文脈または一意な対象だけを採用し、曖昧なら孤立する", () => {
  const body = "保存して閉じる。\n設定を保存する。";
  assert.deepEqual(enhancements.resolveExplanationTarget(body, { target: "保存", start: 999, end: 1001, before: "設定を", after: "する。" }), { start: body.lastIndexOf("保存"), end: body.lastIndexOf("保存") + 2, matched: true });
  assert.deepEqual(enhancements.resolveExplanationTarget("保存する。\n保存する。", { target: "保存", start: 999, end: 1001 }), { start: -1, end: -1, matched: false });
  assert.deepEqual(enhancements.resolveExplanationTarget("保存する。", { target: "保存", start: 999, end: 1001 }), { start: 0, end: 2, matched: true });
});

test("折りたたみ状態は利用者操作で変わった場合だけ保存対象になる", () => {
  assert.equal(enhancements.shouldPersistCollapsedState(undefined, false, false), false);
  assert.equal(enhancements.shouldPersistCollapsedState(false, true, true), true);
  assert.equal(enhancements.shouldPersistCollapsedState(true, true, true), false);
  assert.match(app, /summary\.addEventListener\("click", \(\) => \{ userToggled = true; \}\)/);
  assert.match(app, /summary\.addEventListener\("keydown",/);
  assert.doesNotMatch(app, /details\.addEventListener\("click", \(\) => \{ userToggled = true; \}\)/);
  assert.match(app, /shouldPersistCollapsedState\(explanation\.collapsed, collapsed, userToggled\)/);
  assert.match(app, /function saveExplanationCollapsedState[\s\S]*?putNote\(note\)/);
});

test("Markdown拡張スクリプトとapp.jsは更新済みキャッシュ番号で読み込む", () => {
  assert.match(html, /markdown-enhancements-utils\.js\?v=0\.4\.0-3/);
  assert.match(html, /app\.js\?v=0\.4\.0-40/);
  assert.doesNotMatch(html, /app\.js\?v=0\.4\.0-39/);
});

test("インラインコードと通常本文の同じ語句を別の表示位置として数える", () => {
  const body = "`保存` 保存";
  const start = body.lastIndexOf("保存");
  assert.equal(enhancements.visibleTargetOrdinal(body, "保存", start, start + 2), 1);
});
