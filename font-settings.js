(function (globalScope) {
  "use strict";

  const FONT_COMPARISON_URL = "https://tetsujisugimori-coder.github.io/font-comparison/";
  const FONT_SETTINGS_STORAGE_KEY = "memo-nexus-font-settings";
  const MAX_FONT_SAMPLE_LENGTH = 700;
  const TITLE_FONT_SIZES = [18, 20, 21, 24, 26, 28, 32];
  const BODY_FONT_SIZES = [13, 14, 15, 16, 17, 18, 20];
  const CODE_FONT_SIZES = [13, 14, 15, 16, 17, 18, 20];
  const FONT_TARGETS = ["body", "heading", "code"];
  const FONT_SCOPES = ["global", "note"];
  const FONT_RETURN_PARAMS = [
    "fontSource",
    "fontTarget",
    "fontId",
    "fontFamily",
    "fontLabel",
    "fontScope",
    "fontMemoId"
  ];

  const FONT_OPTIONS = [
    { id: "segoe-ui", label: "Segoe UI", cssFamily: '"Segoe UI", "Yu Gothic UI", sans-serif' },
    { id: "yu-gothic-ui", label: "Yu Gothic UI", cssFamily: '"Yu Gothic UI", "Hiragino Sans", Meiryo, system-ui, sans-serif' },
    { id: "meiryo", label: "Meiryo", cssFamily: 'Meiryo, "Yu Gothic UI", sans-serif' },
    { id: "ms-mincho", label: "MS Mincho", cssFamily: '"ＭＳ 明朝", "MS Mincho", serif' },
    { id: "consolas", label: "Consolas", cssFamily: 'Consolas, "Courier New", monospace' },
    { id: "cascadia-code", label: "Cascadia Code", cssFamily: '"Cascadia Code", Consolas, monospace' },
    { id: "courier-new", label: "Courier New", cssFamily: '"Courier New", Consolas, monospace' },
    { id: "times-new-roman", label: "Times New Roman", cssFamily: '"Times New Roman", "ＭＳ 明朝", serif' }
  ];

  const DEFAULT_FONT_SETTINGS = Object.freeze({
    titleFontId: "yu-gothic-ui",
    titleFontSize: 26,
    bodyFontId: "yu-gothic-ui",
    bodyFontSize: 17,
    headingFontId: "yu-gothic-ui",
    codeFontId: "consolas",
    codeFontSize: 13
  });

  const STANDARD_FONT_SAMPLE = [
    "日本語の本文サンプルです。",
    "漢字・ひらがな・カタカナを確認します。",
    "The quick brown fox jumps over the lazy dog.",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "abcdefghijklmnopqrstuvwxyz",
    "0123456789",
    "。、！？「」『』（）[]{}+-×÷=%"
  ].join("\n");

  const CODE_FONT_SAMPLE = [
    'const message = "日本語 ABC 123";',
    "function calculateTotal(price, tax) {",
    "  return price * (1 + tax);",
    "}"
  ].join("\n");

  function fontOption(fontId) {
    return FONT_OPTIONS.find((font) => font.id === fontId) || null;
  }

  function normalizeFontId(value, fallbackId) {
    return fontOption(value) ? value : fallbackId;
  }

  function normalizeSize(value, allowed, fallback) {
    const numeric = Number(value);
    return allowed.includes(numeric) ? numeric : fallback;
  }

  function normalizeFontSettings(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      titleFontId: normalizeFontId(source.titleFontId, DEFAULT_FONT_SETTINGS.titleFontId),
      titleFontSize: normalizeSize(source.titleFontSize, TITLE_FONT_SIZES, DEFAULT_FONT_SETTINGS.titleFontSize),
      bodyFontId: normalizeFontId(source.bodyFontId, DEFAULT_FONT_SETTINGS.bodyFontId),
      bodyFontSize: normalizeSize(source.bodyFontSize, BODY_FONT_SIZES, DEFAULT_FONT_SETTINGS.bodyFontSize),
      headingFontId: normalizeFontId(source.headingFontId, DEFAULT_FONT_SETTINGS.headingFontId),
      codeFontId: normalizeFontId(source.codeFontId, DEFAULT_FONT_SETTINGS.codeFontId),
      codeFontSize: normalizeSize(source.codeFontSize, CODE_FONT_SIZES, DEFAULT_FONT_SETTINGS.codeFontSize)
    };
  }

  function normalizeNoteFontSettings(value) {
    if (!value || typeof value !== "object" || value.enabled !== true) return null;
    return { enabled: true, ...normalizeFontSettings(value) };
  }

  function effectiveFontSettings(globalSettings, noteSettings) {
    return normalizeNoteFontSettings(noteSettings) || normalizeFontSettings(globalSettings);
  }

  function noteFontSettingsEqual(first, second) {
    const normalizedFirst = normalizeNoteFontSettings(first);
    const normalizedSecond = normalizeNoteFontSettings(second);
    if (!normalizedFirst || !normalizedSecond) return normalizedFirst === normalizedSecond;
    return Object.keys(DEFAULT_FONT_SETTINGS).every((key) => normalizedFirst[key] === normalizedSecond[key]);
  }

  function fontFamilyForTarget(settings, target) {
    const normalized = normalizeFontSettings(settings);
    const id = target === "heading"
      ? normalized.headingFontId
      : target === "code"
        ? normalized.codeFontId
        : normalized.bodyFontId;
    return fontOption(id).cssFamily;
  }

  function comparisonSample(customSample, memoBody, target) {
    const preferred = String(customSample || "").trim() || String(memoBody || "").trim() || STANDARD_FONT_SAMPLE;
    const codeSuffix = target === "code" ? `\n\n${CODE_FONT_SAMPLE}` : "";
    return `${preferred}${codeSuffix}`.slice(0, MAX_FONT_SAMPLE_LENGTH);
  }

  function buildFontComparisonUrl({
    target,
    scope = "global",
    currentFontId,
    returnUrl,
    sample,
    memoId = "",
    baseUrl = FONT_COMPARISON_URL
  }) {
    if (!FONT_TARGETS.includes(target)) throw new Error("フォントの選択対象が不正です");
    if (!FONT_SCOPES.includes(scope)) throw new Error("フォント設定の適用範囲が不正です");
    const font = fontOption(currentFontId);
    if (!font) throw new Error("現在のフォントIDが不正です");

    const url = new URL(baseUrl);
    url.searchParams.set("mode", "memo-nexus");
    url.searchParams.set("target", target);
    url.searchParams.set("scope", scope);
    url.searchParams.set("currentFontId", font.id);
    url.searchParams.set("returnUrl", String(returnUrl || ""));
    url.searchParams.set("sample", String(sample || "").slice(0, MAX_FONT_SAMPLE_LENGTH));
    if (memoId) url.searchParams.set("memoId", String(memoId).slice(0, 100));
    return url.toString();
  }

  function readFontSelection(search) {
    const params = new URLSearchParams(search);
    if (params.get("fontSource") !== "font-comparison") return null;

    const target = params.get("fontTarget");
    const scope = params.get("fontScope") || "global";
    const fontId = params.get("fontId");
    const font = fontOption(fontId);
    const returnedFamily = params.get("fontFamily");
    if (!FONT_TARGETS.includes(target) || !FONT_SCOPES.includes(scope) || !font) {
      throw new Error("フォント表示アプリからの選択情報が不正です");
    }
    if (typeof returnedFamily !== "string" || returnedFamily !== font.cssFamily || returnedFamily.length > 240) {
      throw new Error("安全でないfont-family指定を拒否しました");
    }

    return {
      source: "font-comparison",
      target,
      scope,
      fontId: font.id,
      fontFamily: font.cssFamily,
      label: font.label,
      memoId: String(params.get("fontMemoId") || "").slice(0, 100)
    };
  }

  function withoutFontSelectionParams(urlValue) {
    const url = new URL(urlValue);
    FONT_RETURN_PARAMS.forEach((name) => url.searchParams.delete(name));
    return `${url.pathname}${url.search}${url.hash}`;
  }

  const api = {
    BODY_FONT_SIZES,
    CODE_FONT_SAMPLE,
    CODE_FONT_SIZES,
    DEFAULT_FONT_SETTINGS,
    FONT_COMPARISON_URL,
    FONT_OPTIONS,
    FONT_RETURN_PARAMS,
    FONT_SETTINGS_STORAGE_KEY,
    FONT_TARGETS,
    MAX_FONT_SAMPLE_LENGTH,
    STANDARD_FONT_SAMPLE,
    TITLE_FONT_SIZES,
    buildFontComparisonUrl,
    comparisonSample,
    effectiveFontSettings,
    fontFamilyForTarget,
    fontOption,
    normalizeFontSettings,
    normalizeNoteFontSettings,
    noteFontSettingsEqual,
    readFontSelection,
    withoutFontSelectionParams
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusFontSettings = api;
})(typeof window !== "undefined" ? window : globalThis);
