const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const enhancements = require("./markdown-enhancements-utils.js");

function createDomHarness(textEntries) {
  class FakeElement {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.className = "";
      this.ownerDocument = documentRef;
    }
    closest(selector) {
      const classNames = selector.split(",").map((item) => item.trim().replace(/^\./, ""));
      for (let element = this; element; element = element.parentElement) {
        const ownClasses = String(element.className || "").split(/\s+/);
        if (classNames.some((className) => ownClasses.includes(className))) return element;
      }
      return null;
    }
    append(...children) {
      children.forEach((child) => {
        this.children.push(child);
        child.parentNode = this;
        child.parentElement = this;
      });
    }
    insertBefore(child, reference) {
      const index = this.children.indexOf(reference);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
      child.parentNode = this;
      child.parentElement = this;
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
    dispatchEvent(event) {
      if (!event.target) event.target = this;
      event.currentTarget = this;
      event.preventDefault ||= () => { event.defaultPrevented = true; };
      (this.listeners[event.type] || []).forEach((listener) => listener(event));
      if (event.bubbles && this.parentElement) this.parentElement.dispatchEvent(event);
      return !event.defaultPrevented;
    }
  }
  class FakeTextNode {
    constructor(value, parent) {
      this.nodeValue = value;
      this.parentNode = parent;
      this.parentElement = parent;
      this.ownerDocument = documentRef;
    }
    splitText(offset) {
      const sibling = new FakeTextNode(this.nodeValue.slice(offset), this.parentNode);
      this.nodeValue = this.nodeValue.slice(0, offset);
      const index = this.parentNode.children.indexOf(this);
      this.parentNode.children.splice(index + 1, 0, sibling);
      return sibling;
    }
  }
  const documentRef = {
    createTreeWalker(root) {
      let index = 0;
      const textNodes = [];
      const visit = (node) => {
        if (node instanceof FakeTextNode) textNodes.push(node);
        else (node.children || []).forEach(visit);
      };
      visit(root);
      return { nextNode: () => textNodes[index++] || null };
    },
    createElement: (tagName) => new FakeElement(tagName)
  };
  const root = new FakeElement("div");
  const nodes = textEntries.map(({ text, tagName = "span", className = "" }) => {
    const parent = new FakeElement(tagName);
    parent.className = className;
    const node = new FakeTextNode(text, parent);
    parent.children.push(node);
    root.append(parent);
    return { parent, node };
  });
  const queryAll = (predicate) => {
    const matches = [];
    const visit = (node) => {
      if (node instanceof FakeElement && predicate(node)) matches.push(node);
      (node.children || []).forEach(visit);
    };
    visit(root);
    return matches;
  };
  const dispatch = (element, type, options = {}) => element.dispatchEvent({ type, bubbles: true, ...options });
  return { root, nodes, queryAll, dispatch, FakeElement };
}

function explanationFor(body, target, id = "explanation-1", start = body.indexOf(target)) {
  return { id, target, start, end: start + target.length, type: "補足", body: `${target}の説明`, updatedAt: 100 };
}

function markerParents(harness) {
  return harness.queryAll((element) => element.className === "explanation-marker").map((marker) => marker.parentElement);
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

function loadAppFunction(name, deps = {}) {
  const source = sourceOf(name);
  return new Function("deps", `
    let notes = deps.notes || [];
    let pendingExplanation = deps.pendingExplanation;
    const currentNote = deps.currentNote;
    const normalizeExplanations = deps.normalizeExplanations;
    const insertExplanationAnchorIntoBody = deps.insertExplanationAnchorIntoBody;
    const captureUndoSnapshot = deps.captureUndoSnapshot || (() => {});
    const scheduleSave = deps.scheduleSave || (() => {});
    const markLocalMemoDirty = deps.markLocalMemoDirty || (() => {});
    const enqueueNoteSave = deps.enqueueNoteSave || (() => Promise.resolve());
    const putNote = deps.putNote;
    const getAllNotes = deps.getAllNotes || (() => []);
    const renderPreview = deps.renderPreview || (() => {});
    const explanationBodyInput = deps.explanationBodyInput;
    const explanationTypeSelect = deps.explanationTypeSelect;
    const explanationDialog = deps.explanationDialog;
    const editor = deps.editor;
    const crypto = deps.crypto;
    ${source}
    return ${name};
  `)(deps);
}

const safeExternalUrl = Function(`${sourceOf("safeExternalUrl")} return safeExternalUrl;`)();
const renderOrderedListBlock = Function("renderMarkdownInline", `${sourceOf("renderOrderedListBlock")} return renderOrderedListBlock;`)((text) => text);

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
  assert.match(app, /function renderOrderedListBlock[\s\S]*?startAttribute/);
  assert.match(app, /task-list-checkbox[\s\S]*data-task-index/);
  assert.match(app, /\^\(---\+\|\\\*\\\*\\\*\+\|___\+\)\$/);
  ["NOTE", "TIP", "IMPORTANT", "WARNING"].forEach((type) => assert.match(css, new RegExp(`callout-${type.toLowerCase()}`)));
});

test("分割された番号付きリストもMarkdownの開始番号をカード表示に保持する", () => {
  assert.equal(renderOrderedListBlock(["1. OpenAIのニュース"]), "<ol><li>OpenAIのニュース</li></ol>");
  assert.equal(renderOrderedListBlock(["2. Anthropicのニュース"]), "<ol start=\"2\"><li>Anthropicのニュース</li></ol>");
  assert.equal(renderOrderedListBlock(["3. Metaのニュース"]), "<ol start=\"3\"><li>Metaのニュース</li></ol>");
  assert.equal(renderOrderedListBlock(["4. 続き", "5. 次の項目"]), "<ol start=\"4\"><li>続き</li><li>次の項目</li></ol>");
});

test("Callout操作と解説カードの独立保存UIを提供する", () => {
  assert.match(html, /id="calloutTypeSelect"/);
  assert.match(html, /id="insertCalloutBtn"/);
  assert.match(html, /id="addExplanationBtn"/);
  assert.match(html, /id="explanationDialog"/);
  assert.match(app, /note\.explanations/);
  assert.match(app, /const target = editor\.value\.slice\(range\.start, range\.end\)/);
  assert.match(app, /confirm\("この解説カードを削除しますか？"\)/);
  assert.match(css, /\.callout-warning/);
  assert.match(css, /\.explanation-card/);
});

test("新規解説の最初の保存要求でnote.bodyへアンカーを反映する", () => {
  const anchorId = "anchor-put";
  const baseBody = "本文を選択して解説作成";
  const note = {
    id: "note-1",
    title: "解説テスト",
    body: baseBody,
    explanations: [],
    updatedAt: 123
  };
  const expectedBody = enhancements.insertExplanationAnchorIntoBody(baseBody, baseBody.length, anchorId).body;
  const putNotes = [];
  const events = [];
  const deps = {
    currentNote: () => note,
    normalizeExplanations: (target) => target.explanations,
    insertExplanationAnchorIntoBody: (...args) => enhancements.insertExplanationAnchorIntoBody(...args),
    captureUndoSnapshot: () => events.push("undo"),
    scheduleSave: () => events.push("schedule-save"),
    markLocalMemoDirty: () => {},
    enqueueNoteSave: async () => {
      putNotes.push(structuredClone(note));
      return { ok: true };
    },
    explanationBodyInput: { value: "対象の説明" },
    explanationTypeSelect: { value: "用語解説" },
    explanationDialog: { close: () => events.push("dialog-close") },
    editor: {
      value: baseBody,
      selectionStart: baseBody.length,
      selectionEnd: baseBody.length
    },
    renderPreview: () => events.push("render-preview"),
    pendingExplanation: {
      id: anchorId,
      start: baseBody.length,
      end: baseBody.length,
      target: "",
      before: "",
      after: "",
      cursorInsertion: true
    },
    crypto: { randomUUID: () => "uuid-fallback" }
  };
  const saveExplanationFromDialog = loadAppFunction("saveExplanationFromDialog", deps);
  saveExplanationFromDialog({ preventDefault: () => {} });
  assert.equal(putNotes.length, 1);
  assert.equal(putNotes[0].body, expectedBody);
  assert.equal(putNotes[0].explanations[0].id, anchorId);
  assert.equal(note.body, expectedBody);
  assert.equal(note.explanations[0].id, anchorId);
  assert.match(putNotes[0].body, /<!-- memo-nexus:explanation id="anchor-put" -->/);
  assert.equal(events.includes("schedule-save"), true);
});

test("最初の保存要求時点で保存対象本文と説明カードは対応している", () => {
  const anchorId = "anchor-put-sync";
  const baseBody = "再読み込みが走っても壊れない本文";
  const note = {
    id: "note-2",
    title: "解説同期テスト",
    body: baseBody,
    explanations: []
  };
  let savedArgument = null;
  const saveEvents = [];
  const deps = {
    currentNote: () => note,
    normalizeExplanations: (target) => target.explanations,
    insertExplanationAnchorIntoBody: (...args) => enhancements.insertExplanationAnchorIntoBody(...args),
    captureUndoSnapshot: () => saveEvents.push("undo"),
    scheduleSave: () => saveEvents.push("schedule-save"),
    markLocalMemoDirty: () => {},
    enqueueNoteSave: async () => {
      savedArgument = structuredClone(note);
      return { ok: true };
    },
    explanationBodyInput: { value: "同期確認用解説" },
    explanationTypeSelect: { value: "用語解説" },
    explanationDialog: { close: () => saveEvents.push("dialog-close") },
    editor: { value: baseBody, selectionStart: baseBody.length, selectionEnd: baseBody.length },
    renderPreview: () => saveEvents.push("render-preview"),
    pendingExplanation: {
      id: anchorId,
      start: 5,
      end: 6,
      target: baseBody.slice(5, 6),
      before: "",
      after: "",
      cursorInsertion: false
    },
    crypto: { randomUUID: () => "uuid-fallback" }
  };
  const saveExplanationFromDialog = loadAppFunction("saveExplanationFromDialog", deps);
  saveExplanationFromDialog({ preventDefault: () => {} });
  assert.equal(Boolean(savedArgument), true);
  assert.match(savedArgument.body, new RegExp(`<!-- memo-nexus:explanation id="${anchorId}" -->`));
  assert.equal(savedArgument.body, note.body);
  assert.equal(saveEvents.includes("schedule-save"), true);
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
});

test("Markdown記号を含むソース選択から表示文字列と出現順を分けて解決する", () => {
  const body = "**保存** 保存";
  assert.deepEqual(enhancements.visibleTargetForSourceRange(body, 0, 6), { displayText: "保存", ordinal: 0, matched: true });
  const plainStart = body.lastIndexOf("保存");
  assert.deepEqual(enhancements.visibleTargetForSourceRange(body, plainStart, plainStart + 2), { displayText: "保存", ordinal: 1, matched: true });
  assert.deepEqual(enhancements.visibleTargetForSourceRange("**保存** と *閉じる*", 0, 13), { displayText: "閉じる", ordinal: 0, matched: true });
});

test("解説対象は単一段落内ならその表示位置へ挿入し続ける", () => {
  const body = "本文の先頭保存本文の末尾";
  const start = body.indexOf("保存");
  const explanation = explanationFor(body, body.slice(start, start + 2));
  const harness = createDomHarness([{ text: "本文の先頭", tagName: "p" }, { text: "保存", tagName: "p" }, { text: "本文の末尾", tagName: "p" }]);
  const results = enhancements.hydrateExplanationCardsIntoDom(harness.root, body, [explanation]);
  const marker = markerParents(harness).find((parent) => parent.tagName === "P");
  const cards = harness.queryAll((element) => element.className === "explanation-card");
  assert.equal(results[0].visibleTarget.matched, true);
  assert.equal(results[0].visibleTarget.displayText, "保存");
  assert.equal(marker?.tagName, "P");
  const markerNode = marker?.children.find((child) => child.className === "explanation-marker");
  assert.equal(markerNode?.textContent, "1");
  assert.equal(cards.length, 1);
});

test("HTMLコメントアンカーは指定IDで1件だけ本文へ挿入される", () => {
  const body = "本文本文";
  const anchorId = "anchor-1";
  const result = enhancements.insertExplanationAnchorIntoBody(body, body.length, anchorId);
  const comment = enhancements.buildExplanationAnchorComment(anchorId);
  const parsed = enhancements.findExplanationAnchorMatches(result.body);
  assert.equal(parsed.length, 1);
  assert.equal(result.markerStart, body.length);
  assert.equal(result.markerEnd, body.length + comment.length);
  assert.equal(result.body, `${body}${comment}`);
});

test("アンカー付き解説は同IDを最優先して解決し、末尾の位置へ挿入される", () => {
  const body = "本文前\n本文中\n本文後";
  const anchorId = "anchor-order";
  const anchorInserted = enhancements.insertExplanationAnchorIntoBody(body, body.length, anchorId);
  const explanation = explanationFor(anchorInserted.body, anchorInserted.body, anchorId, 0);
  const harness = createDomHarness([{ text: "本文前", tagName: "p" }, { text: "本文中", tagName: "p" }, { text: "本文後", tagName: "p" }]);
  const results = enhancements.hydrateExplanationCardsIntoDom(harness.root, anchorInserted.body, [explanation]);
  assert.equal(results[0].resolved.matched, true);
  assert.equal(results[0].resolved.start, anchorInserted.markerStart);
  assert.equal(results[0].visibleTarget.matched, true);
  assert.equal(results[0].orphaned, false);
  const marker = markerParents(harness).find((parent) => parent.tagName === "P" && parent.children.some((child) => child.className === "explanation-marker"));
  assert.equal(marker?.tagName, "P");
});

test("同一語句が複数ある本文でも、同IDアンカーで対象を一意に特定できる", () => {
  const body = "保存 保存";
  const firstStart = body.indexOf("保存");
  const secondStart = body.lastIndexOf("保存");
  const anchorId = "anchor-dup";
  const anchorInserted = enhancements.insertExplanationAnchorIntoBody(body, secondStart + 2, anchorId);
  const explanation = explanationFor(anchorInserted.body, body.slice(firstStart, firstStart + 2), anchorId, firstStart);
  const harness = createDomHarness([{ text: "保存", tagName: "p" }, { text: " ", tagName: "p" }, { text: "保存", tagName: "p" }]);
  const result = enhancements.hydrateExplanationCardsIntoDom(harness.root, anchorInserted.body, [explanation])[0];
  const marker = markerParents(harness).find((parent) => parent.tagName === "P");
  assert.equal(result.orphaned, false);
  assert.equal(marker?.children?.some((node) => node.className === "explanation-marker"), true);
});

test("本文編集で対象文言が変わってもアンカーがあれば解説位置は維持される", () => {
  const body = "保存してから本文を編集";
  const editedBody = "全然別の本文です";
  const anchorId = "anchor-edit";
  const anchored = enhancements.insertExplanationAnchorIntoBody(body, body.indexOf("本文"), anchorId);
  const explanation = explanationFor(anchored.body, "保存", anchorId, 0);
  const initialHarness = createDomHarness([{ text: "保存してから", tagName: "p" }, { text: "本文を編集", tagName: "p" }]);
  const initial = enhancements.hydrateExplanationCardsIntoDom(initialHarness.root, anchored.body, [explanation])[0];
  assert.equal(initial.orphaned, false);
  const editedHarness = createDomHarness([{ text: editedBody, tagName: "p" }]);
  const afterEdit = enhancements.hydrateExplanationCardsIntoDom(editedHarness.root, enhancements.insertExplanationAnchorIntoBody(editedBody, 5, anchorId).body, [explanation])[0];
  assert.equal(afterEdit.visibleTarget.matched, true);
  assert.equal(afterEdit.orphaned, false);
});

test("同IDアンカーがない説明は旧ロジックの再解決順序で配置される", () => {
  const body = "保存して閉じる。";
  const explanation = explanationFor(body, "保存", "legacy", body.indexOf("保存"));
  const harness = createDomHarness([{ text: "保存", tagName: "p" }, { text: "して", tagName: "p" }, { text: "閉じる。", tagName: "p" }]);
  const results = enhancements.hydrateExplanationCardsIntoDom(harness.root, body, [explanation]);
  assert.equal(results[0].resolved.matched, true);
  assert.equal(results[0].orphaned, false);
});

test("本文内コメントはプレビュー描画文字列として除去される", () => {
  const comment = enhancements.buildExplanationAnchorComment("preview");
  const body = `本文前${comment}\n本文後`;
  const stripped = enhancements.stripExplanationAnchorComments(body);
  assert.equal(stripped, "本文前\n本文後");
});

test("同IDアンカー1件削除関数で本文から対象コメントだけ除去する", () => {
  const first = enhancements.buildExplanationAnchorComment("delete-1");
  const second = enhancements.buildExplanationAnchorComment("delete-2");
  const body = `${first}本文${second}本文`;
  const removed = enhancements.removeExplanationAnchorFromBody(body, "delete-1");
  assert.equal(removed.body.includes(first), false);
  assert.equal(removed.body.includes(second), true);
  assert.equal(removed.removed, true);
  const fallback = enhancements.removeExplanationAnchorFromBody(removed.body, "missing");
  assert.equal(fallback.removed, false);
});

test("複数段落をまたぐ選択では末尾段落の直後へ解説カードを置く", () => {
  const body = "一段目\n二段目\n三段目保存";
  const start = body.indexOf("一段目");
  const end = body.length;
  const explanation = explanationFor(body, body.slice(start, end), "cross-paragraph");
  const harness = createDomHarness([
    { text: "一段目", tagName: "p" },
    { text: "二段目", tagName: "p" },
    { text: "三段目保存", tagName: "p" }
  ]);
  const results = enhancements.hydrateExplanationCardsIntoDom(harness.root, body, [explanation]);
  assert.equal(results[0].visibleTarget.matched, true);
  assert.equal(results[0].visibleTarget.displayText, "三段目保存");
  const marker = markerParents(harness).find((parent) => parent.tagName === "P");
  assert.equal(marker?.tagName, "P");
  const card = harness.queryAll((element) => element.className === "explanation-card")[0];
  const markerNode = marker.children.find((child) => child.className === "explanation-marker");
  assert.equal(markerNode?.textContent, "1");
  assert.equal(harness.root.children.indexOf(card), harness.root.children.indexOf(marker) + 1);
});

test("解決した表示位置へ実際にマーカーを挿入し、カードと既存マーカーは検索対象から除外する", () => {
  const harness = createDomHarness([
    { text: "保存" },
    { text: "保存" },
    { text: "保存" },
    { text: "保存", className: "explanation-cards" },
    { text: "保存", className: "explanation-marker" }
  ]);
  const inserted = enhancements.insertExplanationMarkerIntoDom(harness.root, { displayText: "保存", ordinal: 2, number: 3 });
  assert.equal(inserted?.className, "explanation-marker");
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
  assert.equal(enhancements.insertExplanationMarkerIntoDom(harness.root, { ...visible, number: 1 })?.className, "explanation-marker");
  assert.equal(harness.nodes[0].parent.children.some((child) => child.className === "explanation-marker"), true);
});

test("解説カードは本文内の順序でインライン挿入される", () => {
  const body = "前文保存後文メモ";
  const startA = body.indexOf("保存");
  const startB = body.indexOf("メモ");
  const first = explanationFor(body, "メモ", "later", startB);
  const second = explanationFor(body, "保存", "early", startA);
  const harness = createDomHarness([
    { text: "前文", tagName: "p" },
    { text: "保存", tagName: "p" },
    { text: "後文", tagName: "p" },
    { text: "メモ", tagName: "p" }
  ]);
  enhancements.hydrateExplanationCardsIntoDom(harness.root, body, [first, second], { onPersistCollapsed: () => {} });
  const cards = harness.queryAll((element) => element.className === "explanation-card");
  const cardIds = cards.map((card) => card.id);
  const findOrder = (target, node = harness.root) => {
    let index = -1;
    let found = -1;
    const visit = (current) => {
      index += 1;
      if (current === target) {
        found = index;
        return true;
      }
      for (const child of current.children || []) {
        if (visit(child)) return true;
      }
      return false;
    };
    visit(node);
    return found;
  };
  const earlyCard = cards.find((card) => card.id === "explanation-card-early");
  const laterCard = cards.find((card) => card.id === "explanation-card-later");
  const earlyIndex = findOrder(earlyCard);
  const laterIndex = findOrder(laterCard);
  assert.equal(cardIds.length, 2);
  assert.ok(earlyIndex >= 0 && laterIndex >= 0);
  assert.equal(earlyIndex < laterIndex, true);
});

test("再特定は一意な文脈または一意な対象だけを採用し、曖昧なら孤立する", () => {
  const body = "保存して閉じる。\n設定を保存する。";
  assert.deepEqual(enhancements.resolveExplanationTarget(body, { target: "保存", start: 999, end: 1001, before: "設定を", after: "する。" }), { start: body.lastIndexOf("保存"), end: body.lastIndexOf("保存") + 2, matched: true });
  assert.deepEqual(enhancements.resolveExplanationTarget("保存する。\n保存する。", { target: "保存", start: 999, end: 1001 }), { start: -1, end: -1, matched: false });
  assert.deepEqual(enhancements.resolveExplanationTarget("保存する。", { target: "保存", start: 999, end: 1001 }), { start: 0, end: 2, matched: true });
});

test("Markdownリンクの構文全体と末尾本文を、それぞれ実際のDOM位置へ挿入する", () => {
  const body = "[保存](https://example.com/保存) 保存";
  const linkSource = "[保存](https://example.com/保存)";
  const linkHarness = createDomHarness([{ text: "保存", tagName: "a" }, { text: " 保存", tagName: "p" }]);
  const linkResult = enhancements.hydrateExplanationCardsIntoDom(linkHarness.root, body, [explanationFor(body, linkSource)]);
  assert.equal(linkResult[0].visibleTarget.displayText, "保存");
  assert.equal(linkResult[0].visibleTarget.ordinal, 0);
  assert.equal(linkResult[0].orphaned, false);
  assert.deepEqual(markerParents(linkHarness).map((parent) => parent.tagName), ["A"]);

  const plainStart = body.lastIndexOf("保存");
  const plainHarness = createDomHarness([{ text: "保存", tagName: "a" }, { text: " 保存", tagName: "p" }]);
  const plainResult = enhancements.hydrateExplanationCardsIntoDom(plainHarness.root, body, [explanationFor(body, "保存", "plain-link", plainStart)]);
  assert.equal(plainResult[0].visibleTarget.ordinal, 1);
  assert.equal(plainResult[0].orphaned, false);
  assert.deepEqual(markerParents(plainHarness).map((parent) => parent.tagName), ["P"]);
});

test("インラインコード構文全体と末尾本文を、それぞれ実際のDOM位置へ挿入する", () => {
  const body = "`save()` save()";
  const codeHarness = createDomHarness([{ text: "save()", tagName: "code" }, { text: " save()", tagName: "p" }]);
  const codeResult = enhancements.hydrateExplanationCardsIntoDom(codeHarness.root, body, [explanationFor(body, "`save()`")]);
  assert.equal(codeResult[0].visibleTarget.displayText, "save()");
  assert.equal(codeResult[0].orphaned, false);
  assert.deepEqual(markerParents(codeHarness).map((parent) => parent.tagName), ["CODE"]);

  const plainStart = body.lastIndexOf("save()");
  const plainHarness = createDomHarness([{ text: "save()", tagName: "code" }, { text: " save()", tagName: "p" }]);
  const plainResult = enhancements.hydrateExplanationCardsIntoDom(plainHarness.root, body, [explanationFor(body, "save()", "plain-code", plainStart)]);
  assert.equal(plainResult[0].visibleTarget.ordinal, 1);
  assert.equal(plainResult[0].orphaned, false);
  assert.deepEqual(markerParents(plainHarness).map((parent) => parent.tagName), ["P"]);
});

test("対応不能な入れ子Markdownは誤挿入せず、正常カードを保ったまま孤立カードとして描画する", () => {
  const body = "通常 **[保存](https://example.com)**";
  const nested = "**[保存](https://example.com)**";
  const normal = explanationFor(body, "通常", "normal");
  const orphan = explanationFor(body, nested, "orphan");
  const original = structuredClone([normal, orphan]);
  let persistCalls = 0;
  const harness = createDomHarness([{ text: "通常 ", tagName: "p" }, { text: "保存", tagName: "a" }]);
  const results = enhancements.hydrateExplanationCardsIntoDom(harness.root, body, [normal, orphan], { onPersistCollapsed: () => { persistCalls += 1; } });
  assert.equal(results[0].orphaned, false);
  assert.equal(results[1].visibleTarget.matched, false);
  assert.equal(results[1].markerInserted, false);
  assert.equal(results[1].orphaned, true);
  assert.equal(markerParents(harness).length, 1);
  assert.equal(markerParents(harness)[0].tagName, "P");
  const cards = harness.queryAll((element) => element.className.includes("explanation-card"));
  const orphanCard = cards.find((card) => card.id === "explanation-card-orphan");
  assert.match(orphanCard.className, /explanation-orphaned/);
  const orphanStatus = harness.queryAll((element) => element.className === "explanation-card-status").find((status) => status.parentElement.parentElement === orphanCard);
  assert.equal(orphanStatus.textContent, "対象の文章が見つかりません。");
  assert.equal(harness.queryAll((element) => element.className === "explanation-card-body").some((bodyElement) => bodyElement.textContent === orphan.body), true);
  assert.deepEqual([normal, orphan], original);
  assert.equal(persistCalls, 0);
});

function createCollapseFixture(collapsed) {
  const explanation = { id: "collapse-1", target: "対象", type: "補足", body: "本文", updatedAt: 100 };
  if (collapsed !== undefined) explanation.collapsed = collapsed;
  const note = { id: "note-1", updatedAt: 200, explanations: [explanation] };
  const otherNote = { id: "note-2", updatedAt: 300, explanations: [{ id: "collapse-1", collapsed: false, updatedAt: 300 }] };
  const putCalls = [];
  let timestamp = 1000;
  const saver = enhancements.createExplanationCollapsedStateSaver({
    getNote: (noteId) => [note, otherNote].find((item) => item.id === noteId),
    putNote: async (savedNote) => { putCalls.push(structuredClone(savedNote)); },
    now: () => ++timestamp
  });
  const harness = createDomHarness([]);
  const card = enhancements.createExplanationCardElement(harness.root.ownerDocument, explanation, 1, {
    onPersistCollapsed: (target, nextCollapsed) => saver(note.id, target.id, nextCollapsed)
  });
  harness.root.append(card);
  const findTag = (tagName) => harness.queryAll((element) => element.tagName === tagName)[0];
  return { explanation, note, otherNote, putCalls, saver, harness, card, details: findTag("DETAILS"), summary: findTag("SUMMARY") };
}

test("定義済み・未定義のcollapsedを初期描画しても保存や更新日時変更を行わない", async () => {
  for (const collapsed of [true, undefined]) {
    const fixture = createCollapseFixture(collapsed);
    const before = structuredClone(fixture.note);
    assert.equal(fixture.details.open, collapsed !== true);
    fixture.harness.dispatch(fixture.details, "toggle");
    await fixture.saver.whenIdle();
    assert.equal(fixture.putCalls.length, 0);
    assert.deepEqual(fixture.note, before);
  }
});

test("summaryのクリック、Enter、Spaceは開閉状態を各1回保存し、再描画では保存しない", async () => {
  const fixture = createCollapseFixture(true);
  fixture.harness.dispatch(fixture.summary, "click");
  fixture.details.open = true;
  fixture.harness.dispatch(fixture.details, "toggle");
  await fixture.saver.whenIdle();
  assert.equal(fixture.details.open, true);
  assert.equal(fixture.putCalls.length, 1);
  assert.equal(fixture.putCalls[0].explanations[0].collapsed, false);

  fixture.harness.dispatch(fixture.summary, "keydown", { key: "Enter" });
  fixture.harness.dispatch(fixture.summary, "click");
  fixture.details.open = false;
  fixture.harness.dispatch(fixture.details, "toggle");
  await fixture.saver.whenIdle();
  assert.equal(fixture.details.open, false);
  assert.equal(fixture.putCalls.length, 2);
  assert.equal(fixture.putCalls[1].explanations[0].collapsed, true);

  fixture.harness.dispatch(fixture.summary, "keydown", { key: " " });
  fixture.harness.dispatch(fixture.summary, "click");
  fixture.details.open = true;
  fixture.harness.dispatch(fixture.details, "toggle");
  await fixture.saver.whenIdle();
  assert.equal(fixture.details.open, true);
  assert.equal(fixture.putCalls.length, 3);
  assert.equal(fixture.putCalls[2].explanations[0].collapsed, false);

  const updatedAt = fixture.note.updatedAt;
  const redrawHarness = createDomHarness([]);
  const redraw = enhancements.createExplanationCardElement(redrawHarness.root.ownerDocument, fixture.explanation, 1, {
    onPersistCollapsed: (target, nextCollapsed) => fixture.saver(fixture.note.id, target.id, nextCollapsed)
  });
  redrawHarness.root.append(redraw);
  const redrawDetails = redrawHarness.queryAll((element) => element.tagName === "DETAILS")[0];
  redrawHarness.dispatch(redrawDetails, "toggle");
  await fixture.saver.whenIdle();
  assert.equal(redrawDetails.open, true);
  assert.equal(fixture.putCalls.length, 3);
  assert.equal(fixture.note.updatedAt, updatedAt);
});

test("通常キーとカード内操作は折りたたみ保存を起こさず、後続toggleへ状態を残さない", async () => {
  const fixture = createCollapseFixture(false);
  let editCalls = 0;
  let deleteCalls = 0;
  const harness = createDomHarness([]);
  const card = enhancements.createExplanationCardElement(harness.root.ownerDocument, fixture.explanation, 1, {
    onPersistCollapsed: (target, nextCollapsed) => fixture.saver(fixture.note.id, target.id, nextCollapsed),
    onEdit: () => { editCalls += 1; },
    onDelete: () => { deleteCalls += 1; }
  });
  harness.root.append(card);
  const buttons = harness.queryAll((element) => element.tagName === "BUTTON");
  const bodyElement = harness.queryAll((element) => element.className === "explanation-card-body")[0];
  const link = harness.root.ownerDocument.createElement("a");
  bodyElement.append(link);
  const details = harness.queryAll((element) => element.tagName === "DETAILS")[0];
  const summary = harness.queryAll((element) => element.tagName === "SUMMARY")[0];

  harness.dispatch(summary, "keydown", { key: "Escape" });
  harness.dispatch(summary, "keydown", { key: "Enter" });
  details.open = false;
  harness.dispatch(details, "toggle");
  [buttons[0], buttons[1]].forEach((button) => {
    harness.dispatch(button, "click");
    harness.dispatch(button, "keydown", { key: "Enter" });
    harness.dispatch(button, "keydown", { key: " " });
  });
  harness.dispatch(bodyElement, "click");
  harness.dispatch(link, "click");
  details.open = false;
  harness.dispatch(details, "toggle");
  await fixture.saver.whenIdle();
  assert.equal(editCalls, 1);
  assert.equal(deleteCalls, 1);
  assert.equal(fixture.putCalls.length, 0);
  assert.equal(fixture.explanation.collapsed, false);
});

test("折りたたみ保存はメモIDとカードIDを固定し、短時間の開閉も順番どおり保存する", async () => {
  const fixture = createCollapseFixture(false);
  fixture.harness.dispatch(fixture.summary, "click");
  fixture.details.open = false;
  fixture.harness.dispatch(fixture.details, "toggle");
  fixture.harness.dispatch(fixture.summary, "click");
  fixture.details.open = true;
  fixture.harness.dispatch(fixture.details, "toggle");
  await fixture.saver.whenIdle();
  assert.deepEqual(fixture.putCalls.map((note) => note.explanations[0].collapsed), [true, false]);
  assert.equal(fixture.note.explanations[0].collapsed, false);
  assert.equal(fixture.otherNote.explanations[0].collapsed, false);
  assert.equal(fixture.otherNote.updatedAt, 300);
  await fixture.saver(fixture.note.id, fixture.explanation.id, false);
  assert.equal(fixture.putCalls.length, 2);
});

test("Markdown拡張スクリプトとapp.jsは更新済みキャッシュ番号で読み込む", () => {
  assert.match(html, /markdown-enhancements-utils\.js\?v=0\.5\.0-4/);
  assert.match(html, /app\.js\?v=0\.5\.0-140/);
  assert.doesNotMatch(html, /app\.js\?v=0\.5\.0-40/);
});

test("インラインコードと通常本文の同じ語句を別の表示位置として数える", () => {
  const body = "`保存` 保存";
  const start = body.lastIndexOf("保存");
  assert.equal(enhancements.visibleTargetOrdinal(body, "保存", start, start + 2), 1);
});

test("解説ボタンはpointerdownで選択位置を確定した状態で起動する", () => {
  assert.match(app, /addExplanationBtn\.addEventListener\("pointerdown"/);
  assert.match(app, /rememberEditorSelectionRange\(\)/);
  assert.match(app, /openExplanationDialog\(null, pendingExplanationSelection\)/);
  assert.match(app, /editor\.addEventListener\("select", rememberEditorSelectionRange\)/);
  assert.match(app, /document\.addEventListener\("selectionchange"/);
});

test("複数個目のリスト項目をまたぐ選択は末尾項目の直後へ解説カードを置く", () => {
  const body = "- 保存\n- 追加\n- 閉じる";
  const explanation = explanationFor(body, body, "multi-list");
  const harness = createDomHarness([
    { text: "保存", tagName: "li" },
    { text: "追加", tagName: "li" },
    { text: "閉じる", tagName: "li" }
  ]);
  const results = enhancements.hydrateExplanationCardsIntoDom(harness.root, body, [explanation]);
  const marker = markerParents(harness).find((parent) => parent.tagName === "LI");
  const card = harness.queryAll((element) => element.className === "explanation-card")[0];
  assert.equal(results[0].visibleTarget.matched, true);
  assert.equal(results[0].visibleTarget.displayText, "閉じる");
  assert.equal(results[0].orphaned, false);
  const markerNode = marker?.children.find((child) => child.className === "explanation-marker");
  assert.equal(markerNode?.textContent, "1");
  assert.equal(harness.root.children.indexOf(card), harness.root.children.indexOf(marker) + 1);
});

test("太字やリンクをまたぐ選択でも対象不明カードにならない", () => {
  const body = "**保存** と [リンク](https://example.com)";
  const explanation = explanationFor(body, body, "mixed-markdown");
  const harness = createDomHarness([
    { text: "保存", tagName: "p" },
    { text: " と ", tagName: "p" },
    { text: "リンク", tagName: "p" }
  ]);
  const results = enhancements.hydrateExplanationCardsIntoDom(harness.root, body, [explanation]);
  const statuses = harness.queryAll((element) => element.className === "explanation-card-status");
  assert.equal(results[0].visibleTarget.matched, true);
  assert.equal(results[0].visibleTarget.displayText, "リンク");
  assert.equal(results[0].orphaned, false);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].textContent, "");
});

test("本文編集で対象再解決できない場合、対象不明状態を保持する", () => {
  const originalBody = "**保存** と [リンク](https://example.com)";
  const explanation = explanationFor(originalBody, originalBody, "orphan-after-edit");
  const editedBody = "編集済み本文のみです。";
  const initialHarness = createDomHarness([{ text: "保存", tagName: "p" }, { text: "リンク", tagName: "p" }]);
  const initial = enhancements.hydrateExplanationCardsIntoDom(initialHarness.root, originalBody, [explanation]);
  assert.equal(initial[0].orphaned, false);

  const editedHarness = createDomHarness([{ text: editedBody, tagName: "p" }]);
  const afterEdit = enhancements.hydrateExplanationCardsIntoDom(editedHarness.root, editedBody, [explanation]);
  const orphanStatus = editedHarness.queryAll((element) => element.className === "explanation-card-status")[0];
  const orphanCard = editedHarness.queryAll((element) => {
    const classes = String(element.className || "");
    return classes.split(/\s+/).includes("explanation-card");
  })[0];
  assert.equal(afterEdit[0].visibleTarget.matched, false);
  assert.equal(afterEdit[0].orphaned, true);
  assert.equal(afterEdit[0].markerInserted, false);
  assert.equal(orphanCard?.className, "explanation-card explanation-orphaned");
  assert.equal(orphanStatus.textContent, "対象の文章が見つかりません。");
});

test("解説カード表示は枠線ではなく背景差分で通常と対象不明を区別する", () => {
  assert.match(css, /\.explanation-card\s*\{[^\}]*background:\s*color-mix\(in srgb, var\(--section-bg\)\s+70%, var\(--accent-soft\)\s+30%\)/);
  assert.match(css, /\.explanation-card\s*\{[^\}]*border:\s*0;/);
  assert.match(css, /\.explanation-orphaned\s*\{[^\}]*background:\s*color-mix\(in srgb, var\(--section-bg\)\s+54%, var\(--warning-strong-bg\)\s+46%\)/);
});
