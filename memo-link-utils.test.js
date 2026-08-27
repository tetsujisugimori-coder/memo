"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildMemoLinkRelationIndex,
  buildMemoLinkTitleIndex,
  createMemoLinkRelationCache,
  parseMemoLinks,
  resolveMemoLinkTitle,
  rewriteResolvedMemoLinks
} = require("./memo-link-utils.js");
const { extractExplicitTerms } = require("./term-link-utils.js");

test("語句リンクと正式なメモリンクを別々に抽出する", () => {
  const body = "[[SQLite]] [[* SQLite実験]] [[*メモ名]] [[ * メモ名]] [[* ]] [[＊ メモ名]]";
  assert.deepEqual(extractExplicitTerms(body), ["SQLite"]);
  assert.deepEqual(parseMemoLinks(body).map((link) => link.title), ["SQLite実験"]);
});

test("コード領域を除外し通常本文・リスト・引用・見出しの本文順を保つ", () => {
  const body = [
    "通常 [[* A]]",
    "- [[* B]]",
    "> [[* C]]",
    "# [[* D]]",
    "`[[* inline]]` と [[* E]]",
    "```js",
    "[[* fenced]]",
    "```",
    "```mermaid",
    "A --> [[* mermaid]]",
    "```"
  ].join("\n");
  assert.deepEqual(parseMemoLinks(body).map((link) => link.title), ["A", "B", "C", "D", "E"]);
});

test("メモ名の前後空白を除去し # はタイトルの一部として保持する", () => {
  assert.deepEqual(parseMemoLinks("[[*   メモ名#見出し  ]]").map((link) => link.title), ["メモ名#見出し"]);
});

test("タイトル解決は完全一致・削除状態・同名件数から3状態を返す", () => {
  const notes = [
    { id: "a", title: "実験結果" },
    { id: "b", title: "実験結果", deletedAt: "2026-01-01" },
    { id: "c", title: "EXPERIMENT" }
  ];
  assert.deepEqual(resolveMemoLinkTitle(" 実験結果 ", notes), { status: "resolved", title: "実験結果", noteId: "a" });
  assert.deepEqual(resolveMemoLinkTitle("experiment", notes), { status: "missing", title: "experiment", noteId: null });
  assert.deepEqual(resolveMemoLinkTitle("削除済み", [{ id: "x", title: "削除済み", deletedAt: "now" }]), { status: "missing", title: "削除済み", noteId: null });
  assert.deepEqual(resolveMemoLinkTitle("同名", [{ id: "x", title: "同名" }, { id: "y", title: "同名" }]), {
    status: "ambiguous",
    title: "同名",
    noteId: null,
    candidateNoteIds: ["x", "y"]
  });
});

test("索引はresolvedだけをバックリンクにし参照元と重複リンクを一件へ整理する", () => {
  const notes = [
    { id: "a", title: "A", body: "[[* B]] と再び [[* B]] [[* Missing]] [[* Same]]" },
    { id: "b", title: "B", body: "[[* B]]" },
    { id: "s1", title: "Same", body: "" },
    { id: "s2", title: "Same", body: "" },
    { id: "trash", title: "Trash", body: "[[* B]]", deletedAt: "now" }
  ];
  const index = buildMemoLinkRelationIndex(notes);
  assert.deepEqual(index.bySourceNoteId.get("a").map((item) => item.resolutionStatus), ["resolved", "missing", "ambiguous"]);
  assert.deepEqual(index.backlinksByTargetId.get("b").map((item) => item.sourceNoteId), ["a"]);
  assert.equal(index.backlinksByTargetId.has("s1"), false);
  assert.equal(index.backlinksByTargetId.has("s2"), false);
  assert.equal(index.bySourceNoteId.has("trash"), false);
});

test("キャッシュは明示的な無効化まで同じ索引を共有し本文変更後に再構築する", () => {
  const notes = [{ id: "a", title: "A", body: "" }, { id: "b", title: "B", body: "" }];
  const cache = createMemoLinkRelationCache();
  const first = cache.get(notes);
  assert.equal(cache.get(notes), first);
  notes[0].body = "[[* B]]";
  assert.equal(cache.get(notes), first);
  cache.invalidate();
  const rebuilt = cache.get(notes);
  assert.notEqual(rebuilt, first);
  assert.deepEqual(rebuilt.backlinksByTargetId.get("b").map((item) => item.sourceNoteId), ["a"]);
});

test("一意解決済みの正式リンクだけを全件改名し空白・通常文・語句・コード領域を維持する", () => {
  const body = [
    "通常のメモB [[メモB]] [[*メモB]] [[ * メモB]] [[＊ メモB]]",
    "[[* メモB]] と [[*   メモB  ]] と `[[* メモB]]`",
    "```js",
    "[[* メモB]]",
    "```",
    "```mermaid",
    "A --> [[* メモB]]",
    "```"
  ].join("\n");
  const notes = [{ id: "source", title: "参照元", body }, { id: "target", title: "メモB", body: "" }];
  const rewritten = rewriteResolvedMemoLinks(body, {
    oldTitle: "メモB",
    newTitle: "メモC",
    targetNoteId: "target",
    sourceNoteId: "source",
    relationIndex: buildMemoLinkRelationIndex(notes)
  });
  assert.equal(rewritten.replacementCount, 2);
  assert.equal(rewritten.body, body
    .replace("[[* メモB]] と", "[[* メモC]] と")
    .replace("[[*   メモB  ]] と", "[[*   メモC  ]] と"));
});

test("CRLF原文の位置と改行形式を壊さずタイトル部分だけを書き換える", () => {
  const body = "先頭\r\n[[*   メモB  ]]\r\n末尾 [[* メモB]]";
  const links = parseMemoLinks(body);
  assert.equal(body.slice(links[0].titleStart, links[0].titleEnd), "メモB");
  assert.equal(body.slice(links[1].start, links[1].end), "[[* メモB]]");
  const relationIndex = buildMemoLinkRelationIndex([
    { id: "source", title: "参照元", body },
    { id: "target", title: "メモB", body: "" }
  ]);
  const rewritten = rewriteResolvedMemoLinks(body, {
    oldTitle: "メモB", newTitle: "メモC", targetNoteId: "target", sourceNoteId: "source", relationIndex
  });
  assert.equal(rewritten.body, "先頭\r\n[[*   メモC  ]]\r\n末尾 [[* メモC]]");
  assert.equal((rewritten.body.match(/\r\n/g) || []).length, 2);
});

test("missingとambiguousだったリンクは改名対象IDへ結び付けず更新しない", () => {
  const ambiguousNotes = [
    { id: "source", title: "参照元", body: "[[* メモB]] [[* Missing]]" },
    { id: "target", title: "メモB", body: "" },
    { id: "duplicate", title: "メモB", body: "" }
  ];
  const relationIndex = buildMemoLinkRelationIndex(ambiguousNotes);
  const ambiguous = rewriteResolvedMemoLinks(ambiguousNotes[0].body, {
    oldTitle: "メモB", newTitle: "メモC", targetNoteId: "target", sourceNoteId: "source", relationIndex
  });
  const missing = rewriteResolvedMemoLinks(ambiguousNotes[0].body, {
    oldTitle: "Missing", newTitle: "作成後", targetNoteId: "not-present", sourceNoteId: "source", relationIndex
  });
  assert.equal(ambiguous.changed, false);
  assert.equal(missing.changed, false);
});

test("自己リンクと連続改名が追従し、新タイトル重複後はambiguousになる", () => {
  const notes = [
    { id: "target", title: "メモB", body: "自己 [[* メモB]]" },
    { id: "existing", title: "メモC", body: "" }
  ];
  const firstIndex = buildMemoLinkRelationIndex(notes);
  const first = rewriteResolvedMemoLinks(notes[0].body, {
    oldTitle: "メモB", newTitle: "メモC", targetNoteId: "target", sourceNoteId: "target", relationIndex: firstIndex
  });
  notes[0].title = "メモC";
  notes[0].body = first.body;
  assert.equal(buildMemoLinkRelationIndex(notes).bySourceNoteId.get("target")[0].resolutionStatus, "ambiguous");

  notes.splice(1, 1);
  const secondIndex = buildMemoLinkRelationIndex(notes);
  const second = rewriteResolvedMemoLinks(notes[0].body, {
    oldTitle: "メモC", newTitle: "メモD", targetNoteId: "target", sourceNoteId: "target", relationIndex: secondIndex
  });
  assert.equal(second.body, "自己 [[* メモD]]");
});

test("1,000件超でもタイトル索引を1回だけ構築しリンク解決にMapを再利用する", () => {
  const notes = Array.from({ length: 1001 }, (_, index) => ({
    id: `note-${index}`,
    title: `題名${index}`,
    body: index < 1000 ? `[[* 題名${index + 1}]]` : ""
  }));
  let titleIndexBuilds = 0;
  const index = buildMemoLinkRelationIndex(notes, { onTitleIndexBuilt: () => { titleIndexBuilds += 1; } });
  assert.equal(titleIndexBuilds, 1);
  assert.equal(index.noteIdsByTitle.size, 1001);
  assert.equal(index.bySourceNoteId.get("note-0")[0].targetNoteId, "note-1");
  assert.deepEqual(buildMemoLinkTitleIndex(notes).noteIdsByTitle.get("題名1000"), ["note-1000"]);
  assert.match(buildMemoLinkRelationIndex.toString(), /resolveMemoLinkTitleFromIndex\(link\.title, titleIndex\)/);
  assert.doesNotMatch(buildMemoLinkRelationIndex.toString(), /resolveMemoLinkTitle\(link\.title, activeNotes\)/);
});
