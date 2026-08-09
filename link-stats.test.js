const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { findAutomaticTermMatches, findTermCountMatches } = require("./term-link-utils.js");

const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const statsStart = appSource.indexOf("function countPhraseOccurrences(");
const statsEnd = appSource.indexOf("\nfunction renderLinkStats(", statsStart);
const statsSource = appSource.slice(statsStart, statsEnd);

function collectStats(notes) {
  const collectLinkStats = new Function(
    "currentNote", "activeNotes", "titleInput", "editor", "extractLinks", "findTermCountMatches",
    `${statsSource}\nreturn collectLinkStats;`
  )(
    () => null,
    () => notes,
    { value: "" },
    { value: "" },
    (body) => [...String(body).matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]),
    findTermCountMatches
  );
  return collectLinkStats();
}

test("語句ランキングは C の共通自動一致判定で出現回数と対象メモ数を集計する", () => {
  const stats = collectStats([
    { id: "a", title: "C", body: "[[C]]\nC言語とCを学ぶ。Complete CSS CSV ABC C++ C# Cドライブ" },
    { id: "b", title: "別メモ", body: " C の基本。Cについて。CSS" },
    { id: "c", title: "除外メモ", body: "Complete CSS CSV ABC C++ C# Cドライブ" }
  ]);
  assert.deepEqual(stats, [{ title: "C", count: 5, noteCount: 2, missing: false }]);
});

test("通常語句のランキングは集計用共通一致関数と同じ件数を維持する", () => {
  const notes = [
    { id: "a", title: "JavaScript", body: "[[JavaScript]] JavaScriptと[[DOM]]" },
    { id: "b", title: "DOM", body: "JavaScriptではDOMを扱う。DOM API" },
    { id: "c", title: "その他", body: "JavaScripter DOM_kit" }
  ];
  const stats = collectStats(notes);
  const byTitle = new Map(stats.map((entry) => [entry.title, entry]));
  ["JavaScript", "DOM"].forEach((term) => {
    const matches = notes.map((note) => findTermCountMatches(note.body, term, ["JavaScript", "DOM"]));
    assert.equal(byTitle.get(term).count, matches.reduce((sum, found) => sum + found.length, 0));
    assert.equal(byTitle.get(term).noteCount, matches.filter((found) => found.length > 0).length);
  });
});

test("重複登録語句のランキングは長い語句と内包された短い語句を別々に数える", () => {
  const notes = [
    { id: "a", title: "GPT5.6", body: "[[GPT5.6]]" },
    { id: "b", title: "GPT5.6 sol", body: "[[GPT5.6 sol]]" },
    { id: "c", title: "比較", body: "GPT5.6 sol と GPT5.6 を比較し、再び GPT5.6 sol を使う。" }
  ];
  const byTitle = new Map(collectStats(notes).map((entry) => [entry.title, entry]));
  assert.deepEqual(byTitle.get("GPT5.6 sol"), { title: "GPT5.6 sol", count: 3, noteCount: 2, missing: false });
  assert.deepEqual(byTitle.get("GPT5.6"), { title: "GPT5.6", count: 5, noteCount: 3, missing: false });
});

test("C と C言語のランキングは内包を数えつつ C の除外規則を維持する", () => {
  const stats = collectStats([
    { id: "a", title: "C", body: "[[C]]" },
    { id: "b", title: "C言語", body: "[[C言語]]" },
    { id: "c", title: "本文", body: "C言語を学ぶ。CSS Complete C++ C#" }
  ]);
  const byTitle = new Map(stats.map((entry) => [entry.title, entry]));
  assert.deepEqual(byTitle.get("C言語"), { title: "C言語", count: 2, noteCount: 2, missing: false });
  assert.deepEqual(byTitle.get("C"), { title: "C", count: 3, noteCount: 3, missing: false });
});
