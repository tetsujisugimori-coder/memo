"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");

function readFunctionSource(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name}を読み取れる`);
  const opening = app.indexOf("{", start);
  let depth = 0;
  for (let index = opening; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }
  throw new Error(`${name}の終端を読み取れません`);
}

test("インラインtokenは語句・メモ・不正式予約記法を分離しコードを優先する", () => {
  const functions = Function(
    "findAttachmentReference", "findInlineMathToken", "safeExternalUrl", "findDelimitedInlineToken",
    `${readFunctionSource("findNextKnowledgeLinkToken")} ${readFunctionSource("findNextInlineToken")} return { findNextKnowledgeLinkToken, findNextInlineToken };`
  )(() => null, () => null, () => false, () => null);
  assert.equal(functions.findNextInlineToken("[[語句]]", 0).type, "term-link");
  assert.deepEqual(functions.findNextInlineToken("[[* メモ名]]", 0), { type: "memo-link", start: 0, end: 9, content: "メモ名" });
  ["[[*メモ名]]", "[[ * メモ名]]", "[[* ]]", "[[＊ メモ名]]"].forEach((value) => {
    assert.equal(functions.findNextInlineToken(value, 0).type, "memo-link-invalid", value);
  });
  assert.equal(functions.findNextInlineToken("`[[* メモ名]]`", 0).type, "code");
});

test("プレビューはメモリンクの記号を隠し、不正式予約記法とインラインコードを通常表示する", () => {
  const start = app.indexOf("function renderMarkdownInline(");
  const source = app.slice(start, app.indexOf("\nfunction findNextInlineToken(", start));
  assert.match(source, /token\.type === "term-link"[\s\S]*renderWikiButton\(token\.content\)/);
  assert.match(source, /token\.type === "memo-link"[\s\S]*renderMemoLinkButton\(token\.content\)/);
  assert.match(source, /token\.type === "memo-link-invalid"[\s\S]*escapeHtml\(token\.content\)/);
  assert.match(source, /token\.type === "code"[\s\S]*inline-code/);
});

test("自動タイトルと一覧snippetから正式なメモリンク記号を除く", () => {
  const strip = Function(`${readFunctionSource("stripLinkMarkupForText")} return stripLinkMarkupForText;`)();
  const titleFromBody = Function(`${readFunctionSource("titleFromBody")} return titleFromBody;`)();
  const snippet = Function("tableBlockPlainText", "stripLinkMarkupForText", `${readFunctionSource("snippet")} return snippet;`)((value) => value, strip);
  assert.equal(titleFromBody("[[* 実験結果]]\n本文"), "実験結果");
  assert.equal(snippet("[[* 実験結果]] を参照"), "実験結果 を参照");
});

test("resolvedクリックだけが解決済みnote IDを開き、missingとambiguousは非破壊で案内する", () => {
  const opened = [];
  const notices = [];
  const openResolvedMemoLink = Function(
    "activeNotes", "openNote", "setSaveStatusNotice", "memoLinkResolutionForTitle",
    `${readFunctionSource("openResolvedMemoLink")} return openResolvedMemoLink;`
  )(
    () => [{ id: "target" }, { id: "replacement" }],
    (id) => opened.push(id),
    (message) => notices.push(message),
    (title) => title === "対象"
      ? { status: "resolved", noteId: "target" }
      : title === "古いDOM"
        ? { status: "resolved", noteId: "replacement" }
        : { status: title === "同名" ? "ambiguous" : "missing", noteId: null }
  );
  openResolvedMemoLink("target", "resolved", "対象");
  openResolvedMemoLink("", "missing", "不足");
  openResolvedMemoLink("", "ambiguous", "同名");
  openResolvedMemoLink("target", "resolved", "古いDOM");
  assert.deepEqual(opened, ["target"]);
  assert.match(notices[0], /リンク先メモがありません/);
  assert.match(notices[1], /同名のメモが複数/);
  assert.match(notices[2], /リンク状態が更新/);
  assert.match(readFunctionSource("openResolvedMemoLink"), /currentResolution\.noteId === noteId/);
  assert.doesNotMatch(readFunctionSource("openResolvedMemoLink"), /createNote|title.*find/);
});

test("メモリンク表示はresolved・missing・ambiguousへ専用classと解決済みIDを付ける", () => {
  const render = Function(
    "memoLinkResolutionForTitle", "escapeAttr", "escapeHtml",
    `${readFunctionSource("renderMemoLinkButton")} return renderMemoLinkButton;`
  )(
    (title) => ({ status: title, title: "対象", noteId: title === "resolved" ? "note-b" : null }),
    (value) => String(value),
    (value) => String(value)
  );
  assert.match(render("resolved"), /class="memo-link"[^>]*data-note-id="note-b"[^>]*data-memo-link-status="resolved"/);
  assert.match(render("missing"), /class="memo-link memo-link-missing"[^>]*aria-disabled="true"/);
  assert.match(render("ambiguous"), /class="memo-link memo-link-ambiguous"[^>]*aria-disabled="true"/);
});

test("グラフ辺はresolvedとmissingのメモリンクだけから作りambiguousを除外する", () => {
  const index = {
    bySourceNoteId: new Map([["a", [
      { resolutionStatus: "resolved", targetNoteId: "b", targetTitle: "B" },
      { resolutionStatus: "missing", targetNoteId: null, targetTitle: "Missing" },
      { resolutionStatus: "ambiguous", targetNoteId: null, targetTitle: "Same" }
    ]]])
  };
  const collectLinks = Function("currentMemoLinkRelationIndex", `${readFunctionSource("collectLinks")} return collectLinks;`)(() => index);
  assert.deepEqual(collectLinks([{ id: "a", title: "A" }, { id: "b", title: "B" }]), [
    { from: "A", to: "B", fromId: "a", toId: "b", status: "resolved" },
    { from: "A", to: "Missing", fromId: "a", toId: null, status: "missing" }
  ]);
});

test("表示・関連・グラフ・scheduler接続はメモリンク専用索引を共有する", () => {
  assert.match(readFunctionSource("renderMemoLinkButton"), /class="memo-link\$\{stateClass\}"/);
  assert.match(readFunctionSource("renderMemoLinkButton"), /memo-link-\$\{resolution\.status\}/);
  assert.match(css, /\.memo-link\s*\{/);
  assert.match(css, /\.memo-link-missing\s*\{/);
  assert.match(css, /\.memo-link-ambiguous\s*\{/);
  assert.match(readFunctionSource("collectLinks"), /resolutionStatus === "ambiguous"/);
  assert.match(readFunctionSource("findRelated"), /targetNoteIdsBySourceId/);
  assert.match(readFunctionSource("renderRelated"), /backlinksByTargetId/);
  assert.match(readFunctionSource("renderRelated"), /このメモへのリンク/);
  assert.match(readFunctionSource("renderTypingDerivedUi"), /invalidateTermRelationIndex[\s\S]*renderPreview[\s\S]*renderRelated/);
  assert.match(readFunctionSource("invalidateTermRelationIndex"), /termRelationCache\.invalidate\(\)[\s\S]*memoLinkRelationCache\.invalidate\(\)/);
});

test("改名batch成功時はcommitted snapshotへ統一し遅延通常保存後もnote別intentで再検証する", () => {
  const batchStart = app.indexOf("function handleNoteBatchSaveSuccess(");
  const batchHandler = app.slice(batchStart, app.indexOf("\nfunction handleNoteSaveError(", batchStart));
  const batchApply = readFunctionSource("applyNoteBatchSaveSuccess");
  const syncHandler = readFunctionSource("refreshMemoFromOtherWindow");
  const renameSyncHandler = readFunctionSource("applyMemoLinkRenameSync");
  const renameNoteHandler = readFunctionSource("reconcileMemoLinkRenameSyncNote");
  const storedRepairHandler = readFunctionSource("reconcileMemoLinkRenameStoredNote");
  const liveMergeHandler = readFunctionSource("mergeMemoLinkRenameIntoLiveDraft");
  const notifyStart = app.indexOf("function notifyMemoLinkRenamed(");
  const notifyHandler = app.slice(notifyStart, app.indexOf("\nfunction rememberProcessedMemoLinkRenameSync", notifyStart));
  assert.match(batchHandler, /syncCurrentEditorAfterBatch/);
  assert.match(batchHandler, /!currentResult\.state\.dirty/);
  assert.match(batchHandler, /currentResult\.savedSnapshot \|\| currentResult\.request\.snapshot/);
  assert.match(batchHandler, /titleInput\.value = note\.title[\s\S]*editor\.value = note\.body/);
  assert.match(batchHandler, /removeDraftMirrorForNote\(note\.id\)/);
  assert.match(batchApply, /if \(!state\.dirty\) noteLiveDrafts\.delete\(request\.noteId\)/);
  assert.match(renameSyncHandler, /memoLinkRenameSyncIntents[\s\S]*pendingNoteIds[\s\S]*rememberProcessedMemoLinkRenameSync/);
  assert.match(renameNoteHandler, /drainMemoLinkRenameLiveWork[\s\S]*runExclusive[\s\S]*reconcileMemoLinkRenameStoredNote/);
  assert.match(storedRepairHandler, /store\.get\(noteId\)[\s\S]*cloneNoteSnapshot\(storedNote\)[\s\S]*rewriteMemoLinksFromRenameNotification[\s\S]*store\.put\(savedNote\)/);
  assert.match(storedRepairHandler, /nextNote\.title[\s\S]*=== String\(rename\.oldTitle[\s\S]*nextNote\.title = rename\.newTitle/);
  assert.match(liveMergeHandler, /noteId === rename\?\.targetNoteId[\s\S]*note\.title[\s\S]*=== String\(rename\.oldTitle/);
  assert.match(notifyHandler, /type: "memo-link-renamed"[\s\S]*resolvedSourceNoteIds/);
  assert.match(syncHandler, /memoLinkResolutionMayHaveChanged[\s\S]*renderAll\(\)[\s\S]*renderPreview\(\)/);
});

test("専用モジュールはapp.jsより前に読み込み、保存基盤とDB schemaを変更しない", () => {
  assert.ok(html.indexOf('memo-link-utils.js?v=0.5.0-3') < html.indexOf('app.js?v=0.5.0-134'));
  assert.match(html, /term-link-utils\.js\?v=0\.5\.0-6[\s\S]*memo-link-utils\.js\?v=0\.5\.0-3[\s\S]*app\.js\?v=0\.5\.0-134/);
  assert.doesNotMatch(app, /memo-link-store|backlink-store|createObjectStore\([^)]*link/i);
});
