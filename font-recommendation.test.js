"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { FONT_OPTIONS } = require("./font-settings");
const { languageStatusScore, recommendationTarget, recommendFonts } = require("./font-recommendation");

function font(id, languageStatus) {
  return {
    id,
    label: id,
    sourceType: "system",
    categoryType: "sans-serif",
    recommendedFor: ["body"],
    languages: { japanese: languageStatus },
    impression: [],
    uses: ["本文"]
  };
}

test("用途は本文・見出し・コードの既存設定欄へ決定論的に対応する", () => {
  assert.equal(recommendationTarget("writing"), "body");
  assert.equal(recommendationTarget("reading"), "body");
  assert.equal(recommendationTarget("heading"), "heading");
  assert.equal(recommendationTarget("code"), "code");
  assert.equal(recommendationTarget("unknown"), null);
});

test("日本語＋中立＋長文では日本語対応の本文向けを安定して3件返す", () => {
  const first = recommendFonts(FONT_OPTIONS, { language: "japanese", mood: "neutral", purpose: "writing" });
  const second = recommendFonts(FONT_OPTIONS, { language: "japanese", mood: "neutral", purpose: "writing" });
  assert.equal(first.length, 3);
  assert.deepEqual(first.map((result) => result.font.id), second.map((result) => result.font.id));
  assert.equal(first.every((result) => ["supported", "partial"].includes(result.font.languages.japanese)), true);
  assert.equal(new Set(first.map((result) => result.font.id)).size, 3);
  assert.equal(first.every((result) => result.reasons.length >= 1 && result.reasons.length <= 2), true);
});

test("日本語＋フォーマルでは明朝・セリフ系が上位になる", () => {
  const results = recommendFonts(FONT_OPTIONS, { language: "japanese", mood: "formal", purpose: "reading" });
  assert.equal(results.every((result) => result.font.categoryType === "serif"), true);
  assert.match(results[0].reasons.join(" "), /明朝・セリフ系/);
});

test("簡体字・繁体字・英数字コードは対応カタログを上位にする", () => {
  const simplified = recommendFonts(FONT_OPTIONS, { language: "simplifiedChinese", mood: "neutral", purpose: "reading" });
  assert.deepEqual(simplified.slice(0, 2).map((result) => result.font.id), ["noto-sans-sc-web", "source-han-sans-web"]);
  const traditional = recommendFonts(FONT_OPTIONS, { language: "traditionalChinese", mood: "neutral", purpose: "reading" });
  assert.equal(traditional[0].font.id, "noto-sans-tc-web");
  const code = recommendFonts(FONT_OPTIONS, { language: "latin", mood: "neutral", purpose: "code" });
  assert.equal(code.every((result) => result.font.categoryType === "monospace"), true);
  assert.equal(code.some((result) => result.font.id === "jetbrains-mono-web"), true);
});

test("unknownはunsupportedより上だが、対応済みが3件あれば候補へ混ぜない", () => {
  assert.ok(languageStatusScore("unknown") > languageStatusScore("unsupported"));
  const enough = recommendFonts([
    font("supported-a", "supported"),
    font("partial-b", "partial"),
    font("supported-c", "supported"),
    font("unknown-d", "unknown"),
    font("unsupported-e", "unsupported")
  ], { language: "japanese", mood: "neutral", purpose: "writing" });
  assert.equal(enough.some((result) => ["unknown-d", "unsupported-e"].includes(result.font.id)), false);

  const fallback = recommendFonts([
    font("supported-a", "supported"),
    font("unknown-b", "unknown"),
    font("unsupported-c", "unsupported")
  ], { language: "japanese", mood: "neutral", purpose: "writing" });
  assert.deepEqual(fallback.map((result) => result.font.id), ["supported-a", "unknown-b", "unsupported-c"]);
});

test("重複を除き最大3件とし、同点ではカタログ順を保つ", () => {
  const tied = [font("first", "supported"), font("second", "supported"), font("first", "supported"), font("third", "supported"), font("fourth", "supported")];
  const results = recommendFonts(tied, { language: "japanese", mood: "neutral", purpose: "writing" }, 20);
  assert.deepEqual(results.map((result) => result.font.id), ["first", "second", "third"]);
});

test("3問が揃わない場合は候補を断定しない", () => {
  assert.deepEqual(recommendFonts(FONT_OPTIONS, { language: "", mood: "neutral", purpose: "writing" }), []);
});
