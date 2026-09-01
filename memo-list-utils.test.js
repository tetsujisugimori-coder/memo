"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { buildMemoListView } = require("./memo-list-utils");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");

function readFunctionSource(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name}を読み取れる`);
  const parametersStart = app.indexOf("(", start);
  let parameterDepth = 0;
  let openingBrace = -1;
  for (let index = parametersStart; index < app.length; index += 1) {
    if (app[index] === "(") parameterDepth += 1;
    if (app[index] === ")") parameterDepth -= 1;
    if (parameterDepth === 0) {
      openingBrace = app.indexOf("{", index);
      break;
    }
  }
  assert.ok(openingBrace >= 0, `${name}の本体を読み取れる`);
  let depth = 0;
  for (let index = openingBrace; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }
  throw new Error(`${name}の終端を読み取れません`);
}

const notes = [
  { id: "history", collectionId: "history", tags: ["歴史", "資料"], deletedAt: null },
  { id: "child", collectionId: "history-child", tags: ["歴史"], deletedAt: null },
  { id: "unclassified", collectionId: "system-unclassified", tags: ["資料"], deletedAt: null },
  { id: "deleted-history", collectionId: "history", tags: ["歴史"], deletedAt: 100 },
  { id: "deleted-unclassified", collectionId: "system-unclassified", deletedAt: 200 }
];

function ids(view) {
  return view.notes.map((note) => note.id);
}

test("通常のメモ一覧はすべての未削除メモと一致する", () => {
  const view = buildMemoListView(notes, null);
  assert.equal(view.heading, "メモ一覧");
  assert.deepEqual(ids(view), ["history", "child", "unclassified"]);
});

test("通常コレクション選択は従来どおり左一覧を絞り込まない", () => {
  const view = buildMemoListView(notes, "history");
  assert.equal(view.heading, "メモ一覧");
  assert.deepEqual(ids(view), ["history", "child", "unclassified"]);
});

test("未分類選択も従来どおり左一覧を絞り込まない", () => {
  const view = buildMemoListView(notes, "system-unclassified");
  assert.equal(view.heading, "メモ一覧");
  assert.deepEqual(ids(view), ["history", "child", "unclassified"]);
});

test("ゴミ箱は削除済みメモだけを表示して見出しと一致する", () => {
  const view = buildMemoListView(notes, "trash");
  assert.equal(view.heading, "ゴミ箱");
  assert.deepEqual(ids(view), ["deleted-history", "deleted-unclassified"]);
});

test("長いコレクション名を選択しても通常の見出しを維持する", () => {
  const view = buildMemoListView(notes, "非常に長いコレクション名が続いても上部へは表示しない");
  assert.equal(view.heading, "メモ一覧");
  assert.deepEqual(ids(view), ["history", "child", "unclassified"]);
});

test("タグ選択は該当する未削除メモだけを表示する", () => {
  const view = buildMemoListView(notes, null, " 歴史 ");
  assert.equal(view.heading, "メモ一覧（タグ: 歴史）");
  assert.deepEqual(ids(view), ["history", "child"]);
});

test("コレクションとタグを選択すると両方に一致するメモだけを表示する", () => {
  assert.deepEqual(ids(buildMemoListView(notes, "history", "歴史")), ["history"]);
  assert.deepEqual(ids(buildMemoListView(notes, "system-unclassified", "資料")), ["unclassified"]);
});

test("タグを持たない旧メモはタグ絞り込みでエラーにならない", () => {
  assert.deepEqual(ids(buildMemoListView(notes, null, "missing")), []);
  const trashView = buildMemoListView(notes, "trash", "歴史");
  assert.equal(trashView.heading, "ゴミ箱（タグ: 歴史）");
  assert.deepEqual(ids(trashView), ["deleted-history"]);
});

test("登録制タグUIと右サイドバーのタグタブを保存・解除処理へ接続する", () => {
  assert.match(html, /id="noteTagForm"[\s\S]*id="noteTagInput"[\s\S]*id="noteTagOptions"/);
  assert.match(html, /id="createTagBtn"[\s\S]*タグを作成/);
  assert.match(html, /id="contextTagTab"[^>]+aria-controls="tagPanel"/);
  assert.match(html, /id="clearTagFilterBtn"/);
  assert.match(html, /id="memoTagFilterSelect"[\s\S]*<option value="">すべて<\/option>/);
  assert.match(html, /id="clearMemoTagFilterBtn"[^>]*aria-label="タグの絞り込みを解除"/);
  assert.match(app, /function updateCurrentNoteTags\(value, targetNoteId = currentId\)[\s\S]*const noteId = targetNoteId[\s\S]*restrictTagIds\(value, registeredTags\)[\s\S]*await enqueueNoteSave\(noteId\)/);
  assert.match(app, /function updateCurrentNoteTags\(value, targetNoteId = currentId\)[\s\S]*currentId === noteId[\s\S]*renderNoteTags\(note\);[\s\S]*renderTagPanel\(\);[\s\S]*renderList\(\);[\s\S]*await enqueueNoteSave\(noteId\)/);
  assert.match(readFunctionSource("renderNoteTags"), /createTagChip\(tagId, \{ location: "本文タイトル下" \}\)/);
  assert.match(app, /button\.className = "tag-list-item"/);
  assert.match(app, /buildMemoListView\(notes, selectedCollectionId, selectedTagFilter\)/);
  assert.match(readFunctionSource("clearTagFilter"), /applyTagFilter\(null\)/);
  assert.match(app, /tags: normalizeTagIds\(draft\.tags \|\| existingNote\?\.tags\)/);
});

test("タグ作成・色変更ダイアログはキーボード操作可能な固定パレットを使う", () => {
  assert.match(html, /id="createTagColorPalette"[^>]*role="radiogroup"/);
  assert.match(html, /id="editTagColorDialog"[\s\S]*id="editTagColorPalette"[^>]*role="radiogroup"/);
  const paletteSource = readFunctionSource("renderTagColorPalette");
  assert.match(paletteSource, /TAG_COLOR_PALETTE\.forEach/);
  assert.match(paletteSource, /setAttribute\("role", "radio"\)/);
  assert.match(paletteSource, /setAttribute\("aria-label"/);
  assert.match(paletteSource, /ArrowLeft[\s\S]*ArrowRight[\s\S]*ArrowUp[\s\S]*ArrowDown/);
  assert.match(readFunctionSource("setTagPaletteSelection"), /aria-checked/);
  assert.match(css, /\.tag-color-swatch\.is-selected::after[\s\S]*content: "✓"/);
});

test("タグ一覧の色変更は検索ボタンと分離され保存成功後だけ表示を同期する", () => {
  const panelSource = readFunctionSource("renderTagPanel");
  const saveSource = readFunctionSource("saveEditedTagColor");
  assert.match(panelSource, /className = "tag-list-row"/);
  assert.match(panelSource, /className = "tag-list-item"[\s\S]*applyTagFilter\(definition\.id/);
  assert.match(panelSource, /className = "tag-color-edit"[\s\S]*event\.stopPropagation\(\)[\s\S]*openEditTagColorDialog/);
  assert.doesNotMatch(readFunctionSource("openEditTagColorDialog"), /applyTagFilter/);
  assert.ok(saveSource.indexOf("await putTagDefinitions") < saveSource.indexOf("registeredTags = normalizeTagDefinitions"));
  assert.match(saveSource, /renderTagPanel\(\)[\s\S]*renderNoteTags\(\)[\s\S]*renderNoteTagOptions\(\)[\s\S]*renderMemoListPanel\(\)/);
  assert.doesNotMatch(saveSource, /updateCurrentNoteTags|enqueueNoteSave|putNote/);
});

test("本文と一覧のタグチップは同じ描画・検索更新経路を使いメモを開かない", () => {
  const chipSource = readFunctionSource("createTagChip");
  assert.match(chipSource, /className = "tag-chip"/);
  assert.match(chipSource, /aria-pressed/);
  assert.match(chipSource, /applyTagFilter\(tagId, \{ revealMemoList: true \}\)/);
  assert.doesNotMatch(chipSource, /openNote|createNote|openOrCreateLinkedNote/);
  assert.match(readFunctionSource("renderNoteTags"), /createTagChip\(tagId/);
  assert.match(readFunctionSource("createMemoListTags"), /createTagChip\(tagId/);
  assert.match(readFunctionSource("applyTagFilter"), /selectedTagFilter = normalizeTagId\(value\)/);
  assert.match(readFunctionSource("applyTagFilter"), /renderTagPanel\(\)[\s\S]*renderNoteTags\(\)[\s\S]*renderMemoListPanel\(\)/);
});

test("メモ一覧はタイトル直下に最大3タグとクリックしない残数を表示する", () => {
  const createSource = readFunctionSource("createMemoListTags");
  const listSource = readFunctionSource("renderList");
  assert.match(createSource, /summarizeTagIds\(note\.tags, 3\)/);
  assert.match(createSource, /if \(!visibleTagIds\.length\) return null/);
  assert.match(createSource, /overflow\.textContent = `\+\$\{hiddenCount\}`/);
  assert.doesNotMatch(createSource, /overflow\.addEventListener/);
  assert.ok(listSource.indexOf(".memo-title") < listSource.indexOf(".after(memoTags)"));
  assert.ok(listSource.indexOf(".after(memoTags)") < listSource.indexOf('item.addEventListener("click"'));
});

test("タグは付箋形状と色フォールバックを持ち語句リンクの既存経路を維持する", () => {
  assert.match(css, /\.tag-chip[\s\S]*--tag-color: #5f8f57[\s\S]*border-left-width: 4px[\s\S]*border-radius: 3px 0 3px 3px/);
  assert.match(css, /\.tag-chip::after[\s\S]*width: 12px[\s\S]*height: 12px[\s\S]*clip-path: polygon/);
  assert.match(css, /\.tag-chip[\s\S]*background: var\(--section-bg\)[\s\S]*color-mix/);
  assert.match(css, /\.tag-chip\[aria-pressed="true"\][\s\S]*var\(--tag-color\)/);
  assert.match(css, /\.memo-item \.tag-chip[\s\S]*min-height: 32px/);
  assert.match(readFunctionSource("renderWikiButton"), /wiki-link[\s\S]*term-wiki-link/);
  assert.match(readFunctionSource("renderPreview"), /querySelectorAll\("\.term-wiki-link"\)[\s\S]*openOrCreateLinkedNote/);
  assert.match(readFunctionSource("renderList"), /querySelectorAll\("\.term-chip"\)[\s\S]*openOrCreateLinkedNote/);
});

test("タグ関連スクリプトのキャッシュ番号を更新する", () => {
  assert.match(html, /href="style\.css\?v=0\.5\.0-71"/);
  assert.match(html, /src="tags\.js\?v=0\.5\.0-4"/);
  assert.match(html, /src="memo-list-utils\.js\?v=0\.5\.0-5"/);
  assert.match(html, /src="local-markdown\.js\?v=0\.5\.0-4"/);
  assert.match(html, /src="app\.js\?v=0\.5\.0-132"/);
  assert.ok(html.indexOf('src="tags.js?v=0.5.0-4"') < html.indexOf('src="memo-list-utils.js?v=0.5.0-5"'));
  assert.ok(html.indexOf('src="memo-list-utils.js?v=0.5.0-5"') < html.indexOf('src="app.js?v=0.5.0-132"'));
});
