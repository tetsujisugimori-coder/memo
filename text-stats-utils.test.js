"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { calculateTextStats, calculateParagraphCount, calculateEmptyLineCount, TEXT_STATS_CHARS_PER_MINUTE } = require("./text-stats-utils.js");

test("空白なし文字数と文字種別をUnicodeの文字単位で集計する", () => {
  const stats = calculateTextStats("漢あアｶＡA１1 !　\t\n😀#");
  assert.equal(stats.charactersWithWhitespace, 15);
  assert.equal(stats.charactersWithoutWhitespace, 11);
  assert.deepEqual(stats.characterTypes, { kanji: 1, hiragana: 1, katakana: 2, alphabet: 2, digits: 2, symbols: 2, whitespace: 4, other: 1 });
  assert.equal(Object.values(stats.characterTypes).reduce((total, count) => total + count, 0), stats.charactersWithWhitespace);
});

test("日本語・英語・絵文字・Markdown記号を二重計上しない", () => {
  const stats = calculateTextStats("今日は AI を使う。\n# Title 😀");
  assert.equal(stats.charactersWithoutWhitespace, stats.charactersWithWhitespace - stats.characterTypes.whitespace);
  assert.equal(stats.characterTypes.kanji, 3);
  assert.equal(stats.characterTypes.alphabet, 7);
  assert.equal(stats.characterTypes.symbols, 2);
  assert.equal(stats.characterTypes.other, 1);
});

test("空行区切りだけを段落境界として数える", () => {
  assert.equal(calculateParagraphCount("A\nB"), 1);
  assert.equal(calculateParagraphCount("A\n\nB"), 2);
  assert.equal(calculateParagraphCount("A\n\n\nB"), 2);
  assert.equal(calculateParagraphCount("A\n \t\nB"), 2);
  assert.equal(calculateParagraphCount(" \n\t"), 0);
});

test("空行数は既存の統計計算と同じ改行解釈で返す", () => {
  assert.equal(calculateEmptyLineCount("A\n\nB\n \t\n"), 3);
  assert.equal(calculateTextStats("A\n\nB").emptyLines, 1);
});

test("推定読了時間は定数に基づき表示用の値を返す", () => {
  assert.equal(calculateTextStats("A".repeat(TEXT_STATS_CHARS_PER_MINUTE - 1)).label, "1分未満");
  assert.equal(calculateTextStats("A".repeat(TEXT_STATS_CHARS_PER_MINUTE * 2)).label, "約2分");
});
