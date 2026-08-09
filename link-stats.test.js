const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { findAutomaticTermMatches } = require("./term-link-utils.js");

const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const statsStart = appSource.indexOf("function countPhraseOccurrences(");
const statsEnd = appSource.indexOf("\nfunction renderLinkStats(", statsStart);
const statsSource = appSource.slice(statsStart, statsEnd);

function collectStats(notes) {
  const collectLinkStats = new Function(
    "currentNote", "activeNotes", "titleInput", "editor", "extractLinks", "findAutomaticTermMatches",
    `${statsSource}\nreturn collectLinkStats;`
  )(
    () => null,
    () => notes,
    { value: "" },
    { value: "" },
    (body) => [...String(body).matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]),
    findAutomaticTermMatches
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

test("通常語句のランキングは共通一致関数と同じ件数を維持する", () => {
  const notes = [
    { id: "a", title: "JavaScript", body: "[[JavaScript]] JavaScriptと[[DOM]]" },
    { id: "b", title: "DOM", body: "JavaScriptではDOMを扱う。DOM API" },
    { id: "c", title: "その他", body: "JavaScripter DOM_kit" }
  ];
  const stats = collectStats(notes);
  const byTitle = new Map(stats.map((entry) => [entry.title, entry]));
  ["JavaScript", "DOM"].forEach((term) => {
    const matches = notes.map((note) => findAutomaticTermMatches(note.body, [term]));
    assert.equal(byTitle.get(term).count, matches.reduce((sum, found) => sum + found.length, 0));
    assert.equal(byTitle.get(term).noteCount, matches.filter((found) => found.length > 0).length);
  });
});
