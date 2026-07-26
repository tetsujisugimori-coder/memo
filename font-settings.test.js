"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  DEFAULT_FONT_SETTINGS,
  FONT_COMPARISON_URL,
  MAX_FONT_SAMPLE_LENGTH,
  TITLE_FONT_SIZES,
  buildFontComparisonUrl,
  comparisonSample,
  effectiveFontSettings,
  normalizeFontSettings,
  noteFontSettingsEqual,
  readFontSelection,
  withoutFontSelectionParams
} = require("./font-settings");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");

test("Font Comparison連携URLへ対象・現在値・戻り先・比較文章を安全に設定する", () => {
  const url = new URL(buildFontComparisonUrl({
    target: "body",
    scope: "note",
    currentFontId: "yu-gothic-ui",
    returnUrl: "https://tetsujisugimori-coder.github.io/memo/?view=1",
    sample: "日本語 & symbols +",
    memoId: "memo-1"
  }));

  assert.equal(`${url.origin}${url.pathname}`, FONT_COMPARISON_URL);
  assert.equal(url.searchParams.get("mode"), "memo-nexus");
  assert.equal(url.searchParams.get("target"), "body");
  assert.equal(url.searchParams.get("scope"), "note");
  assert.equal(url.searchParams.get("sample"), "日本語 & symbols +");
  assert.equal(url.searchParams.get("memoId"), "memo-1");
});

test("比較文章は任意文章、メモ本文、標準文章の順で選び最大長を守る", () => {
  assert.equal(comparisonSample("  任意文章  ", "本文", "body"), "任意文章");
  assert.equal(comparisonSample("", "  メモ本文  ", "body"), "メモ本文");
  assert.match(comparisonSample("", "", "body"), /日本語の本文サンプル/);
  const codeSample = comparisonSample("x".repeat(MAX_FONT_SAMPLE_LENGTH), "", "code");
  assert.equal(codeSample.length, MAX_FONT_SAMPLE_LENGTH);
});

test("全体設定と有効なメモ個別設定を正規化して切り替える", () => {
  const global = normalizeFontSettings({
    titleFontId: "meiryo",
    titleFontSize: 28,
    bodyFontId: "meiryo",
    bodyFontSize: 20
  });
  assert.equal(effectiveFontSettings(global, null).titleFontId, "meiryo");
  assert.equal(effectiveFontSettings(global, null).titleFontSize, 28);
  assert.equal(effectiveFontSettings(global, null).bodyFontId, "meiryo");
  const note = effectiveFontSettings(global, {
    enabled: true,
    titleFontId: "ms-mincho",
    titleFontSize: 24,
    bodyFontId: "segoe-ui"
  });
  assert.equal(note.titleFontId, "ms-mincho");
  assert.equal(note.titleFontSize, 24);
  assert.equal(note.bodyFontId, "segoe-ui");
  assert.deepEqual(normalizeFontSettings({ bodyFontId: "unknown", bodyFontSize: 999 }), DEFAULT_FONT_SETTINGS);
  assert.equal(normalizeFontSettings({ titleFontId: "unknown", titleFontSize: 999 }).titleFontSize, 26);
  assert.deepEqual(TITLE_FONT_SIZES, [18, 20, 21, 24, 26, 28, 32]);
});

test("既存メモの題名設定は現在の既定値へ補完される", () => {
  const oldSettings = {
    enabled: true,
    bodyFontId: "meiryo",
    bodyFontSize: 18,
    headingFontId: "meiryo",
    codeFontId: "consolas",
    codeFontSize: 14
  };
  const normalized = effectiveFontSettings(DEFAULT_FONT_SETTINGS, oldSettings);
  assert.equal(normalized.titleFontId, DEFAULT_FONT_SETTINGS.titleFontId);
  assert.equal(normalized.titleFontSize, DEFAULT_FONT_SETTINGS.titleFontSize);
});

test("メモ個別設定の実質的な変更だけを判定する", () => {
  assert.equal(noteFontSettingsEqual(null, undefined), true);
  assert.equal(noteFontSettingsEqual(
    { enabled: true, bodyFontId: "meiryo" },
    { enabled: true, bodyFontId: "meiryo", titleFontId: "yu-gothic-ui", titleFontSize: 26 }
  ), true);
  assert.equal(noteFontSettingsEqual(
    { enabled: true, titleFontId: "yu-gothic-ui", titleFontSize: 26 },
    { enabled: true, titleFontId: "ms-mincho", titleFontSize: 24 }
  ), false);
  assert.equal(noteFontSettingsEqual({ enabled: true }, null), false);
});

test("戻り値は送信元・用途・登録済みfont-familyを検証する", () => {
  const search = new URLSearchParams({
    fontSource: "font-comparison",
    fontTarget: "code",
    fontScope: "global",
    fontId: "consolas",
    fontFamily: 'Consolas, "Courier New", monospace',
    fontMemoId: "memo-1"
  }).toString();
  assert.equal(readFontSelection(`?${search}`).fontId, "consolas");

  const tampered = new URLSearchParams(search);
  tampered.set("fontFamily", "serif; color: red");
  assert.throws(() => readFontSelection(`?${tampered}`), /font-family/);
});

test("処理済みの戻り値だけをURLから除去する", () => {
  assert.equal(
    withoutFontSelectionParams("https://example.test/memo/?keep=1&fontSource=font-comparison&fontId=meiryo#top"),
    "/memo/?keep=1#top"
  );
});

test("設定UIは明示保存・個別設定・比較・受取確認を持つ", () => {
  assert.match(html, /id="globalTitleFontSelect"/);
  assert.match(html, /id="globalTitleFontSizeSelect"/);
  assert.match(html, /id="globalBodyFontSelect"/);
  assert.match(html, /id="noteFontOverrideEnabled"/);
  assert.match(html, /id="noteTitleFontSelect"/);
  assert.match(html, /id="noteTitleFontSizeSelect"/);
  assert.match(html, /data-font-scope="global" data-font-target="body"[^>]*>フォントを比較して選ぶ<\/button>/);
  assert.match(html, /id="receivedFontSelection"[^>]*hidden/);
  assert.match(html, /id="saveFontSettingsBtn"/);
  assert.match(app, /history\.replaceState\(history\.state, "", withoutFontSelectionParams\(location\.href\)\)/);
  assert.match(app, /選択をプレビューへ反映しました。保存すると確定します。/);
});

test("題名入力・本文・見出し・コードだけに専用CSS変数を適用する", () => {
  assert.match(css, /\.title-input\s*\{[^}]*font-family:\s*var\(--memo-title-font-family\)[^}]*font-size:\s*var\(--memo-title-font-size\)/s);
  const memoTitleRule = css.match(/\.memo-title\s*\{[^}]*\}/s)?.[0] || "";
  assert.doesNotMatch(memoTitleRule, /--memo-title-font-/);
  assert.match(css, /#editor\s*\{[^}]*font-family:\s*var\(--memo-body-font-family\)/s);
  assert.match(css, /\.preview h1,[\s\S]*?font-family:\s*var\(--memo-heading-font-family\)/);
  assert.match(css, /\.code-block code\s*\{[^}]*font-family:\s*var\(--memo-code-font-family\)/s);
  assert.doesNotMatch(css, /body\s*\{[^}]*font-family:\s*var\(--memo-body-font-family\)/s);
  assert.match(css, /\.preview \.math-inline\s*\{[^}]*font-size:\s*17px/s);
  assert.match(css, /\.preview \.math-block\s*\{[^}]*font-size:\s*17px/s);
  assert.match(css, /\.mermaid-block\s*\{[^}]*font-size:\s*17px/s);
});

test("狭幅画面では題名サイズを既存の21px以内に収める", () => {
  assert.match(css, /@container app-width \(max-width: 719\.98px\)[\s\S]*?\.title-input\s*\{[^}]*font-size:\s*min\(var\(--memo-title-font-size\), 21px\)/);
});

test("フォント設定保存は本文値を書き換えず、個別設定が変わった時だけ更新日時を変更する", () => {
  const source = app.match(/async function saveFontSettings\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(source, /editor\.value\s*=/);
  assert.doesNotMatch(source, /note\.body\s*=/);
  assert.match(
    source,
    /if \(!noteFontSettingsEqual\(previousNoteSettings, nextNoteSettings\)\) \{[\s\S]*?note\.updatedAt = Date\.now\(\);[\s\S]*?await putNote\(note\);/
  );
  assert.equal((source.match(/note\.updatedAt = Date\.now\(\)/g) || []).length, 1);
});
