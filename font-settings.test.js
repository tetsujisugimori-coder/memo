"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  DEFAULT_FONT_SETTINGS,
  FONT_COMPARISON_URL,
  FONT_OPTIONS,
  MAX_FONT_SAMPLE_LENGTH,
  TITLE_FONT_SIZES,
  buildFontComparisonUrl,
  comparisonSample,
  effectiveFontSettings,
  fontIdsInSettings,
  fontOption,
  fontWeightRequestsInSettings,
  normalizeFontSettings,
  noteFontSettingsEqual,
  populateFontSelectOptions,
  readFontSelection,
  withoutFontSelectionParams
} = require("./font-settings");

const EXPECTED_WEB_FONTS = [
  ["noto-sans-jp-web", "Noto Sans JP", '"Noto Sans JP", "Yu Gothic UI", "Hiragino Sans", Meiryo, sans-serif'],
  ["noto-serif-jp-web", "Noto Serif JP", '"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", "MS PMincho", serif'],
  ["noto-sans-sc-web", "Noto Sans SC", '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif'],
  ["noto-sans-tc-web", "Noto Sans TC", '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif'],
  ["source-han-sans-web", "Source Han Sans", '"Source Han Sans CN", "Noto Sans SC", "Microsoft YaHei", sans-serif'],
  ["inter-web", "Inter", 'Inter, "Segoe UI", Arial, sans-serif'],
  ["ibm-plex-sans-web", "IBM Plex Sans", '"IBM Plex Sans", "Segoe UI", Arial, sans-serif'],
  ["jetbrains-mono-web", "JetBrains Mono", '"JetBrains Mono", "Cascadia Code", Consolas, monospace'],
  ["zen-kaku-gothic-new-web", "Zen Kaku Gothic New", '"Zen Kaku Gothic New", "Yu Gothic UI", "Hiragino Sans", Meiryo, sans-serif'],
  ["shippori-mincho-web", "Shippori Mincho", '"Shippori Mincho", "Yu Mincho", "Hiragino Mincho ProN", "MS PMincho", serif']
];

const EXPECTED_FONT_SELECT_LABELS = new Map([
  ["segoe-ui", "Segoe UI"],
  ["yu-gothic-ui", "Yu Gothic UI（日本語フォント）"],
  ["meiryo", "Meiryo（メイリオ）"],
  ["ms-mincho", "MS Mincho（ＭＳ 明朝）"],
  ["consolas", "Consolas"],
  ["cascadia-code", "Cascadia Code"],
  ["courier-new", "Courier New"],
  ["times-new-roman", "Times New Roman"],
  ["noto-sans-jp-web", "Noto Sans JP（日本語フォント）"],
  ["noto-serif-jp-web", "Noto Serif JP（日本語フォント）"],
  ["noto-sans-sc-web", "Noto Sans SC（简体中文）"],
  ["noto-sans-tc-web", "Noto Sans TC（繁體中文）"],
  ["source-han-sans-web", "Source Han Sans（思源黑体／简体中文）"],
  ["inter-web", "Inter"],
  ["ibm-plex-sans-web", "IBM Plex Sans"],
  ["jetbrains-mono-web", "JetBrains Mono"],
  ["zen-kaku-gothic-new-web", "Zen Kaku Gothic New（日本語フォント）"],
  ["shippori-mincho-web", "Shippori Mincho（しっぽり明朝）"]
]);

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

test("カタログは既存8システムと契約どおりの10 Webフォントを単一管理する", () => {
  assert.equal(FONT_OPTIONS.length, 18);
  assert.equal(FONT_OPTIONS.filter((font) => font.sourceType === "system").length, 8);
  assert.equal(FONT_OPTIONS.filter((font) => font.sourceType === "web").length, 10);
  for (const [id, label, cssFamily] of EXPECTED_WEB_FONTS) {
    assert.equal(fontOption(id).label, label);
    assert.equal(fontOption(id).cssFamily, cssFamily);
    assert.equal(fontOption(id).sourceType, "web");
    assert.ok(fontOption(id).loading);
  }
  assert.deepEqual(
    FONT_OPTIONS.map((font) => [font.id, font.selectLabel]),
    [...EXPECTED_FONT_SELECT_LABELS]
  );
  assert.equal(fontOption("noto-sans-jp-web").loading.url, "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap");
  assert.equal(fontOption("noto-serif-jp-web").loading.url, "https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=swap");
  assert.equal(fontOption("noto-sans-sc-web").loading.url, "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap");
  assert.equal(fontOption("noto-sans-tc-web").loading.url, "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=swap");
  assert.equal(fontOption("inter-web").loading.url, "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap");
  assert.equal(fontOption("ibm-plex-sans-web").loading.url, "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;700&display=swap");
  assert.equal(fontOption("jetbrains-mono-web").loading.url, "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap");
  assert.equal(fontOption("zen-kaku-gothic-new-web").loading.url, "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;700&display=swap");
  assert.equal(fontOption("shippori-mincho-web").loading.url, "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;700&display=swap");
  assert.deepEqual(fontOption("source-han-sans-web").loading.files, {
    400: "https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-sans@2.005R/SubsetOTF/CN/SourceHanSansCN-Regular.otf",
    700: "https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-sans@2.005R/SubsetOTF/CN/SourceHanSansCN-Bold.otf"
  });
});

test("WebフォントIDは全体・個別設定で保持し、未知IDだけ既定値へ戻す", () => {
  const normalized = normalizeFontSettings({
    titleFontId: "noto-serif-jp-web",
    bodyFontId: "noto-sans-jp-web",
    headingFontId: "shippori-mincho-web",
    codeFontId: "jetbrains-mono-web"
  });
  assert.equal(normalized.titleFontId, "noto-serif-jp-web");
  assert.equal(normalized.bodyFontId, "noto-sans-jp-web");
  assert.equal(normalized.headingFontId, "shippori-mincho-web");
  assert.equal(normalized.codeFontId, "jetbrains-mono-web");
  assert.equal(normalizeFontSettings({ bodyFontId: "not-registered" }).bodyFontId, DEFAULT_FONT_SETTINGS.bodyFontId);
  assert.deepEqual(fontIdsInSettings(normalized), ["noto-serif-jp-web", "noto-sans-jp-web", "shippori-mincho-web", "jetbrains-mono-web"]);
});

test("用途ごとの必要Weightをフォント単位で集約する", () => {
  const weightsFor = (settings, fontId) => fontWeightRequestsInSettings(settings)
    .find((request) => request.fontId === fontId)?.weights;
  assert.deepEqual(weightsFor({ titleFontId: "noto-sans-jp-web" }, "noto-sans-jp-web"), [700]);
  assert.deepEqual(weightsFor({ bodyFontId: "noto-sans-jp-web" }, "noto-sans-jp-web"), [400]);
  assert.deepEqual(weightsFor({ headingFontId: "noto-sans-jp-web" }, "noto-sans-jp-web"), [700]);
  assert.deepEqual(weightsFor({ codeFontId: "jetbrains-mono-web" }, "jetbrains-mono-web"), [400]);
  assert.deepEqual(weightsFor({
    titleFontId: "noto-sans-jp-web",
    bodyFontId: "noto-sans-jp-web",
    headingFontId: "noto-sans-jp-web",
    codeFontId: "noto-sans-jp-web"
  }, "noto-sans-jp-web"), [400, 700]);
});

test("実フォーム用選択肢は全8欄で再利用できるシステム／Web optgroupを生成する", () => {
  const fakeDocument = {
    createElement(tagName) {
      return {
        tagName,
        children: [],
        style: {},
        appendChild(child) { this.children.push(child); }
      };
    }
  };
  function select() {
    return {
      options: [],
      children: [],
      appendChild(group) {
        this.children.push(group);
        this.options.push(...group.children);
      }
    };
  }
  const fields = Array.from({ length: 8 }, select);
  fields.forEach((field) => populateFontSelectOptions(field, fakeDocument));
  fields.forEach((field) => {
    assert.deepEqual(field.children.map((group) => group.label), ["システムフォント", "Webフォント（選択時に読込）"]);
    assert.equal(field.options.length, 18);
    assert.deepEqual(field.options.map((option) => option.value), FONT_OPTIONS.map((font) => font.id));
    assert.deepEqual(field.options.map((option) => option.textContent), FONT_OPTIONS.map((font) => font.selectLabel));
    assert.deepEqual(field.options.map((option) => option.style.fontFamily), FONT_OPTIONS.map((font) => font.cssFamily));
  });
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

test("Font Comparisonから10 Webフォントを正確なfamilyだけで安全に受け取る", () => {
  for (const [fontId, label, fontFamily] of EXPECTED_WEB_FONTS) {
    const search = new URLSearchParams({
      fontSource: "font-comparison",
      fontTarget: fontId === "jetbrains-mono-web" ? "code" : "body",
      fontScope: "note",
      fontId,
      fontFamily,
      fontLabel: "改ざんされた表示名",
      fontMemoId: "memo-web"
    });
    const selection = readFontSelection(`?${search}`);
    assert.equal(selection.fontId, fontId);
    assert.equal(selection.fontFamily, fontFamily);
    assert.equal(selection.label, label);
  }
  const unknown = new URLSearchParams({
    fontSource: "font-comparison", fontTarget: "body", fontScope: "global",
    fontId: "unknown-web", fontFamily: "sans-serif"
  });
  assert.throws(() => readFontSelection(`?${unknown}`), /不正/);
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
  assert.match(html, /id="fontRecommendationForm"/);
  assert.match(html, /<details class="font-recommendation-panel" open>/);
  assert.match(html, /<summary>条件からフォントを探す<\/summary>/);
  assert.match(html, /使用言語・文章の雰囲気・主な用途を選ぶと、条件に合うフォントを3件表示します。/);
  assert.match(html, /アンケートは条件から候補を検索します。/);
  assert.match(html, /フォント選択欄では一覧から直接選べます。/);
  assert.match(html, /Font Comparisonでは実際の表示を詳しく比較できます。/);
  assert.match(html, />この条件で検索<\/button>/);
  assert.match(html, /name="recommendationLanguage" value="japanese" checked/);
  assert.match(html, /name="recommendationMood" value="neutral" checked/);
  assert.match(html, /name="recommendationPurpose" value="writing" checked/);
  assert.match(html, /id="fontWebLoadStatus"[^>]*aria-live="polite"/);
  assert.ok(html.indexOf('font-recommendation.js?v=0.5.0-1') < html.indexOf('app.js?v=0.5.0-104'));
  assert.ok(html.indexOf('web-font-loader.js?v=0.5.0-2') < html.indexOf('app.js?v=0.5.0-104'));
  assert.match(app, /function prepareFontSettingsDialog\(\)[\s\S]*?renderFontRecommendations\(\)/);
  assert.match(app, /function syncFontSelectDisplay\(select\) \{[\s\S]*?select\.style\.fontFamily = font\?\.cssFamily \|\| "";/);
  assert.match(app, /\[fields\.titleFont, fields\.bodyFont, fields\.headingFont, fields\.codeFont\]\.forEach\(syncFontSelectDisplay\)/);
  assert.match(app, /function handleFontRecommendationAnswerChange\(\) \{\s*renderFontRecommendations\(\);\s*\}/);
  assert.match(app, /selectButton\.textContent = `\$\{recommendationTargetLabel\(recommendationTarget\(answers\.purpose\)\)\}の候補にする`/);
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
    /if \(!noteFontSettingsEqual\(previousNoteSettings, nextNoteSettings\)\) \{[\s\S]*?markLocalMemoDirty\(note\);[\s\S]*?await enqueueNoteSave\(note\.id\);/
  );
  assert.equal((source.match(/markLocalMemoDirty\(note\)/g) || []).length, 1);
});

test("アプリ統合は実表示・プレビュー・受取確定だけをWebフォント要求へ接続する", () => {
  const effective = app.match(/function applyEffectiveFontSettings\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const preview = app.match(/function updateFontSettingsPreview\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const received = app.match(/function applyPendingFontSelectionToDraft\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const recommendations = app.match(/function renderFontRecommendations\(event\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(effective, /requestWebFontsForSettings\(settings\)/);
  assert.match(preview, /requestWebFontsForSettings\(settings\)/);
  const applyCandidate = app.match(/function applyRecommendedFont\(fontId, purpose\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(received, /webFontLoader\.requestFont\(selectedFontId, \[weight\]\)/);
  assert.doesNotMatch(recommendations, /requestFont|requestWebFontsForSettings/);
  assert.match(applyCandidate, /selectMap\[scope\]/);
  assert.match(applyCandidate, /updateFontSettingsPreview\(\)/);
  assert.doesNotMatch(applyCandidate, /saveFontSettings|localStorage|putNote/);
  assert.match(app, /retryButton\.textContent = "再試行"/);
  assert.match(app, /retryButton\.disabled = loadingWeights\.length > 0/);
  assert.doesNotMatch(app.match(/function renderWebFontLoadStatus\(\) \{[\s\S]*?\n\}/)?.[0] || "", /innerHTML/);
});
