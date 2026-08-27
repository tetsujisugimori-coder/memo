"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const {
  TAG_COLOR_PALETTE,
  assignRegisteredTag,
  countTagUsage,
  createTagDefinition,
  mergeTagDefinitions,
  mergeTagDefinitionsFromNotes,
  normalizeTagColor,
  normalizeTagDefinitions,
  normalizeTagId,
  normalizeTagIds,
  removeMemoTag,
  restrictTagIds,
  searchTagOptions,
  summarizeTagIds,
  tagColorFromId,
  tagColorForId,
  updateTagDefinitionColor
} = require("./tags.js");

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

test("tags.jsをapp.jsより前に読み込みwindow APIとして公開する", () => {
  assert.ok(html.indexOf('src="tags.js?v=0.5.0-4"') < html.indexOf('src="app.js?v=0.5.0-117"'));
  assert.match(fs.readFileSync("tags.js", "utf8"), /global\.MemoNexusTags = api/);
});

test("タグID正規化は空文字・空白・null・undefined・重複を除外する", () => {
  assert.equal(normalizeTagId(" Work "), "work");
  assert.equal(normalizeTagId("  "), null);
  assert.equal(normalizeTagId(null), null);
  assert.equal(normalizeTagId(undefined), null);
  assert.deepEqual(normalizeTagIds([" Work ", "", "work", "WORK", " 資料 ", null, undefined]), ["work", "資料"]);
});

test("タグ色は固定パレットの正規化済み16進色だけを受け付ける", () => {
  assert.equal(TAG_COLOR_PALETTE.length, 9);
  TAG_COLOR_PALETTE.forEach((color) => assert.match(color, /^#[0-9a-f]{6}$/));
  assert.equal(normalizeTagColor(" #B85C5C ", "work"), "#b85c5c");
  assert.equal(normalizeTagColor("#3a7", "work"), tagColorFromId("work"));
  assert.equal(normalizeTagColor("#123456", "work"), tagColorFromId("work"));
  assert.equal(normalizeTagColor("javascript:alert(1)", "work"), tagColorFromId("work"));
});

test("同じタグIDの自動色は順序や再実行に依存せず、複数IDを色分けする", () => {
  const ids = ["work", "資料", "調査", "ai", "重要"];
  const first = ids.map(tagColorFromId);
  const reversed = [...ids].reverse().map((id) => [id, tagColorFromId(id)]);
  assert.deepEqual(first, ids.map(tagColorFromId));
  assert.deepEqual(new Map(reversed), new Map(ids.map((id) => [id, tagColorFromId(id)])));
  assert.ok(new Set(first).size > 1);
  first.forEach((color) => assert.ok(TAG_COLOR_PALETTE.includes(color)));
});

test("既存の有効色を維持し、色なし・不正色を冪等に自動補完する", () => {
  const source = [
    { id: "work", name: "Work", color: "#b85c5c" },
    { id: "資料", name: "資料" },
    { id: "bad", name: "不正", color: "transparent" }
  ];
  const once = normalizeTagDefinitions(source);
  const twice = normalizeTagDefinitions(once);
  assert.equal(once.find((tag) => tag.id === "work").color, "#b85c5c");
  assert.equal(once.find((tag) => tag.id === "資料").color, tagColorFromId("資料"));
  assert.equal(once.find((tag) => tag.id === "bad").color, tagColorFromId("bad"));
  assert.deepEqual(twice, once);
  assert.equal(tagColorForId(source, "資料"), tagColorFromId("資料"));
});

test("一覧用タグ要約は先頭3件と残数を返しタグなしでも安全", () => {
  assert.deepEqual(summarizeTagIds(["a", "b", "c", "d", "e"]), {
    visibleTagIds: ["a", "b", "c"],
    hiddenCount: 2
  });
  assert.deepEqual(summarizeTagIds(undefined), { visibleTagIds: [], hiddenCount: 0 });
});

test("登録済みタグ一覧はID重複を除き表示名順に並べる", () => {
  const definitions = normalizeTagDefinitions([
    { id: "work", name: "Work" }, { id: "資料", name: "資料" }, { id: " WORK ", name: "重複" }, null
  ]);
  assert.deepEqual(definitions.map(({ id, name }) => ({ id, name })), [
    { id: "work", name: "Work" }, { id: "資料", name: "資料" }
  ]);
});

test("既存メモのタグから登録済みタグを冪等に作成し本文の#タグは解析しない", () => {
  const existing = [{ id: "work", name: "Work", createdAt: "old", updatedAt: "old" }];
  const notes = [
    { tags: ["WORK", "資料"], body: "#調査\n# 見出し" },
    { body: "本文だけ #未登録" }
  ];
  const once = mergeTagDefinitionsFromNotes(existing, notes, "2026-08-16T00:00:00.000Z");
  const twice = mergeTagDefinitionsFromNotes(once, notes, "2026-08-17T00:00:00.000Z");
  assert.deepEqual(twice, once);
  assert.deepEqual(once.map((definition) => definition.id), ["work", "資料"]);
  assert.equal(once.some((definition) => definition.id === "調査" || definition.id === "未登録"), false);
});

test("取り込みタグは新しいupdatedAtだけを採用し表示名AIを保持する", () => {
  const existing = [{ id: "ai", name: "人工知能", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" }];
  const newer = mergeTagDefinitions(existing, [{ id: "AI", name: "AI", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z" }]);
  assert.equal(newer[0].id, "ai");
  assert.equal(newer[0].name, "AI");
  const unsafe = mergeTagDefinitions(newer, [{ id: "ai", name: "上書き不可", updatedAt: "invalid" }]);
  assert.equal(unsafe[0].name, "AI");
});

test("タグ作成は空名を拒否し正規化IDの重複を通知可能にする", () => {
  const registered = [{ id: "work", name: "Work" }];
  assert.equal(createTagDefinition("   ", registered).status, "invalid");
  assert.equal(createTagDefinition(" WORK ", registered).status, "exists");
  const created = createTagDefinition(" 調査 ", registered, "2026-08-16T00:00:00.000Z");
  assert.equal(created.status, "created");
  assert.deepEqual(created.definition, {
    id: "調査", name: "調査", color: tagColorFromId("調査"), createdAt: "2026-08-16T00:00:00.000Z", updatedAt: "2026-08-16T00:00:00.000Z"
  });
});

test("新規タグは選択色を保存し、重複時は既存タグの色を変更しない", () => {
  const existing = [{ id: "work", name: "Work", color: "#b85c5c" }];
  const created = createTagDefinition("資料", existing, "2026-08-16T00:00:00.000Z", "#3f7fa6");
  assert.equal(created.definition.color, "#3f7fa6");
  const duplicate = createTagDefinition("WORK", existing, "2026-08-17T00:00:00.000Z", "#8064a2");
  assert.equal(duplicate.status, "exists");
  assert.equal(duplicate.definition.color, "#b85c5c");
});

test("タグ色変更は実変更時だけcolorとupdatedAtを変え、他項目を維持する", () => {
  const source = { id: "work", name: "Work", color: "#b85c5c", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" };
  const unchanged = updateTagDefinitionColor(source, "#b85c5c", "2026-08-03T00:00:00.000Z");
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.definition.updatedAt, source.updatedAt);
  const updated = updateTagDefinitionColor(source, "#3f7fa6", "2026-08-03T00:00:00.000Z");
  assert.deepEqual(updated.definition, { ...source, color: "#3f7fa6", updatedAt: "2026-08-03T00:00:00.000Z" });
});

test("新旧タグ定義のマージは色なし旧データで既存の有効色を失わない", () => {
  const existing = [{ id: "work", name: "Work", color: "#8064a2", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" }];
  const legacyNewer = normalizeTagDefinitions([{ id: "work", name: "仕事", updatedAt: "2026-08-03T00:00:00.000Z" }]);
  const merged = mergeTagDefinitions(existing, legacyNewer);
  assert.equal(merged[0].name, "仕事");
  assert.equal(merged[0].color, "#8064a2");
});

test("登録済みタグだけを付与し同じタグを二重に付けない", () => {
  const definitions = [{ id: "調査", name: "調査" }, { id: "資料", name: "資料" }];
  assert.deepEqual(assignRegisteredTag([], "未登録", definitions), []);
  assert.deepEqual(assignRegisteredTag([], "調査", definitions), ["調査"]);
  assert.deepEqual(assignRegisteredTag(["調査"], " 調査 ", definitions), ["調査"]);
  assert.deepEqual(restrictTagIds(["調査", "未登録"], definitions), ["調査"]);
});

test("タグチップ解除はメモとの紐付けだけを外しタグ定義を残す", () => {
  const definitions = [{ id: "調査", name: "調査" }, { id: "資料", name: "資料" }];
  assert.deepEqual(removeMemoTag(["調査", "資料"], "調査"), ["資料"]);
  assert.deepEqual(definitions, [{ id: "調査", name: "調査" }, { id: "資料", name: "資料" }]);
  const source = readFunctionSource("renderNoteTags");
  assert.match(source, /removeMemoTag\(note\.tags, tagId\)/);
  assert.doesNotMatch(source, /deleteTag|tagTx|objectStore/);
});

test("使用件数0件を含む登録済みタグを数え削除済みメモを除外する", () => {
  const definitions = [{ id: "調査", name: "調査" }, { id: "未使用", name: "未使用" }];
  const counts = countTagUsage(definitions, [
    { tags: ["調査"], deletedAt: null }, { tags: ["調査"], deletedAt: 1 }
  ]);
  assert.deepEqual([...counts], [["調査", 1], ["未使用", 0]]);
});

test("タグ作成後の定義は一覧と未付与候補へ直ちに反映できる", () => {
  const created = createTagDefinition("調査", []);
  const definitions = normalizeTagDefinitions([created.definition]);
  assert.deepEqual(searchTagOptions(definitions, "調", []), [created.definition]);
  assert.deepEqual(searchTagOptions(definitions, "", ["調査"]), []);
  const source = readFunctionSource("registerNewTag");
  assert.match(source, /registeredTags = normalizeTagDefinitions/);
  assert.match(source, /renderTagPanel\(\)/);
  assert.match(source, /renderNoteTagOptions\(\)/);
  assert.doesNotMatch(source, /updateCurrentNoteTags|addRegisteredTagToCurrentNote/);
});

test("選択式UIは未登録入力を案内し登録済み候補だけを追加経路へ渡す", () => {
  assert.match(html, /id="noteTagInput"[^>]*role="combobox"[^>]*aria-autocomplete="list"[^>]*aria-controls="noteTagOptions"/);
  assert.match(html, /id="noteTagOptions"[^>]*role="listbox"/);
  assert.match(html, /id="createTagBtn"[^>]*>タグを作成<\/button>/);
  assert.match(html, /id="createTagDialog"[\s\S]*id="createTagForm"[\s\S]*id="createTagNameInput"/);
  assert.match(readFunctionSource("submitCurrentNoteTagSelection"), /findTagDefinition\(registeredTags[\s\S]*タグタブから新しいタグを作成してください/);
  assert.match(readFunctionSource("addRegisteredTagToCurrentNote"), /assignRegisteredTag\(currentTags, definition\.id, registeredTags\)/);
  assert.match(readFunctionSource("renderNoteTagOptions"), /document\.activeElement === noteTagInput/);
  assert.match(readFunctionSource("renderNoteTagOptions"), /createTagColorDot\(definition\.id\)/);
  assert.match(css, /\.tag-color-dot[\s\S]*border-radius: 50%/);
});

test("DB v6のtagsストアを維持し既存タグ色を冪等移行する", () => {
  assert.match(app, /const TAG_STORE_NAME = "tags"/);
  assert.match(app, /const DB_VERSION = 6/);
  assert.match(app, /objectStoreNames\.contains\(TAG_STORE_NAME\)[\s\S]*createObjectStore\(TAG_STORE_NAME, \{ keyPath: "id" \}\)/);
  const source = readFunctionSource("synchronizeRegisteredTagsForNotes");
  assert.match(source, /getRawTagDefinitions\(\)/);
  assert.match(source, /mergeTagDefinitionsFromNotes\(stored, notes\)/);
  assert.match(source, /!existingIds\.has\(definition\.id\)/);
  assert.match(source, /rawById\.get\(definition\.id\)\?\.color !== definition\.color/);
  assert.match(source, /putTagDefinitions\(colorUpdates\)/);
  assert.doesNotMatch(source, /updatedAt\s*=/);
});

test("タグ定義変更はローカル要保存となり各取り込み直後に共通同期する", () => {
  assert.match(readFunctionSource("putTagDefinitions"), /transaction\.oncomplete[\s\S]*markLocalWorkspacePending\(\)/);
  for (const name of ["applyLocalCandidate", "importMarkdownZip", "applyPortableBackupImport", "restoreFromLocalFolder"]) {
    assert.match(readFunctionSource(name), /synchronizeRegisteredTagsForNotes\(/, `${name}でタグ同期すること`);
  }
  assert.match(readFunctionSource("applyPortableBackupTransaction"), /TAG_STORE_NAME/);
  assert.doesNotMatch(readFunctionSource("performLocalWorkspaceSave"), /putTagDefinitions|synchronizeRegisteredTagsForNotes/);
  const startup = readFunctionSource("init");
  assert.ok(startup.indexOf("initializeLocalFolderSaving()") < startup.indexOf("synchronizeRegisteredTagsForNotes()"));
});
