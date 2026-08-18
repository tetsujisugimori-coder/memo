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

  const SYSTEM = "system";
  const WEB = "web";
  const languageSupport = (latin, japanese, simplifiedChinese, traditionalChinese) => ({
    latin,
    japanese,
    simplifiedChinese,
    traditionalChinese
  });
  const systemFont = (id, label, cssFamily, details) => ({
    id,
    label,
    cssFamily,
    sourceType: SYSTEM,
    ...details
  });
  const webFont = (id, label, cssFamily, details) => ({
    id,
    label,
    cssFamily,
    sourceType: WEB,
    ...details
  });

  const FONT_OPTIONS = [
    systemFont("segoe-ui", "Segoe UI", '"Segoe UI", "Yu Gothic UI", sans-serif', {
      categoryType: "sans-serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("supported", "partial", "unknown", "unknown"),
      impression: ["中立", "読みやすい"], uses: ["欧文UI", "本文", "見出し"]
    }),
    systemFont("yu-gothic-ui", "Yu Gothic UI", '"Yu Gothic UI", "Hiragino Sans", Meiryo, system-ui, sans-serif', {
      categoryType: "sans-serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("supported", "supported", "unknown", "unknown"),
      impression: ["中立", "落ち着いた"], uses: ["日本語本文", "長文", "UI", "見出し"]
    }),
    systemFont("meiryo", "Meiryo", 'Meiryo, "Yu Gothic UI", sans-serif', {
      categoryType: "sans-serif", recommendedFor: ["body"],
      languages: languageSupport("supported", "supported", "unknown", "unknown"),
      impression: ["読みやすい", "実用的"], uses: ["日本語本文", "長文", "UI"]
    }),
    systemFont("ms-mincho", "MS Mincho", '"ＭＳ 明朝", "MS Mincho", serif', {
      categoryType: "serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("partial", "supported", "unknown", "unknown"),
      impression: ["落ち着いた", "古典的"], uses: ["日本語本文", "長文", "見出し"]
    }),
    systemFont("consolas", "Consolas", 'Consolas, "Courier New", monospace', {
      categoryType: "monospace", recommendedFor: ["code"],
      languages: languageSupport("supported", "unsupported", "unsupported", "unsupported"),
      impression: ["中立", "実用的"], uses: ["コード"]
    }),
    systemFont("cascadia-code", "Cascadia Code", '"Cascadia Code", Consolas, monospace', {
      categoryType: "monospace", recommendedFor: ["code"],
      languages: languageSupport("supported", "unsupported", "unsupported", "unsupported"),
      impression: ["現代的", "明快"], uses: ["コード"]
    }),
    systemFont("courier-new", "Courier New", '"Courier New", Consolas, monospace', {
      categoryType: "monospace", recommendedFor: ["code"],
      languages: languageSupport("supported", "unsupported", "unsupported", "unsupported"),
      impression: ["古典的"], uses: ["コード"]
    }),
    systemFont("times-new-roman", "Times New Roman", '"Times New Roman", "ＭＳ 明朝", serif', {
      categoryType: "serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("supported", "unsupported", "unsupported", "unsupported"),
      impression: ["落ち着いた", "古典的"], uses: ["欧文本文", "長文", "見出し"]
    }),
    webFont("noto-sans-jp-web", "Noto Sans JP", '"Noto Sans JP", "Yu Gothic UI", "Hiragino Sans", Meiryo, sans-serif', {
      categoryType: "sans-serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("supported", "supported", "unknown", "unknown"),
      impression: ["読みやすい", "汎用"], uses: ["日本語本文", "長文", "UI", "見出し"],
      loading: { type: "stylesheet", family: "Noto Sans JP", url: "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" }
    }),
    webFont("noto-serif-jp-web", "Noto Serif JP", '"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", "MS PMincho", serif', {
      categoryType: "serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("supported", "supported", "unknown", "unknown"),
      impression: ["端正", "落ち着いた"], uses: ["日本語本文", "長文", "見出し"],
      loading: { type: "stylesheet", family: "Noto Serif JP", url: "https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=swap" }
    }),
    webFont("noto-sans-sc-web", "Noto Sans SC", '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif', {
      categoryType: "sans-serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("supported", "unknown", "supported", "partial"),
      impression: ["明快", "汎用"], uses: ["簡体字本文", "長文", "UI", "見出し"],
      loading: { type: "stylesheet", family: "Noto Sans SC", url: "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap" }
    }),
    webFont("noto-sans-tc-web", "Noto Sans TC", '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif', {
      categoryType: "sans-serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("supported", "unknown", "partial", "supported"),
      impression: ["明快", "汎用"], uses: ["繁体字本文", "長文", "UI", "見出し"],
      loading: { type: "stylesheet", family: "Noto Sans TC", url: "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=swap" }
    }),
    webFont("source-han-sans-web", "Source Han Sans", '"Source Han Sans CN", "Noto Sans SC", "Microsoft YaHei", sans-serif', {
      categoryType: "sans-serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("supported", "unknown", "supported", "partial"),
      impression: ["実用的", "明快"], uses: ["簡体字本文", "長文", "UI", "見出し"],
      loading: {
        type: "font-face", family: "Source Han Sans CN", files: {
          400: "https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-sans@2.005R/SubsetOTF/CN/SourceHanSansCN-Regular.otf",
          700: "https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-sans@2.005R/SubsetOTF/CN/SourceHanSansCN-Bold.otf"
        }
      }
    }),
    webFont("inter-web", "Inter", 'Inter, "Segoe UI", Arial, sans-serif', {
      categoryType: "sans-serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("supported", "unsupported", "unsupported", "unsupported"),
      impression: ["可読性", "現代的"], uses: ["欧文本文", "長文", "欧文UI", "見出し"],
      loading: { type: "stylesheet", family: "Inter", url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" }
    }),
    webFont("ibm-plex-sans-web", "IBM Plex Sans", '"IBM Plex Sans", "Segoe UI", Arial, sans-serif', {
      categoryType: "sans-serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("supported", "unsupported", "unsupported", "unsupported"),
      impression: ["中立", "端正"], uses: ["欧文本文", "長文", "欧文UI", "見出し"],
      loading: { type: "stylesheet", family: "IBM Plex Sans", url: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;700&display=swap" }
    }),
    webFont("jetbrains-mono-web", "JetBrains Mono", '"JetBrains Mono", "Cascadia Code", Consolas, monospace', {
      categoryType: "monospace", recommendedFor: ["code"],
      languages: languageSupport("supported", "unsupported", "unsupported", "unsupported"),
      impression: ["明快", "現代的"], uses: ["コード"],
      loading: { type: "stylesheet", family: "JetBrains Mono", url: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" }
    }),
    webFont("zen-kaku-gothic-new-web", "Zen Kaku Gothic New", '"Zen Kaku Gothic New", "Yu Gothic UI", "Hiragino Sans", Meiryo, sans-serif', {
      categoryType: "sans-serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("supported", "supported", "unknown", "unknown"),
      impression: ["親しみ", "現代的"], uses: ["日本語本文", "長文", "UI", "見出し"],
      loading: { type: "stylesheet", family: "Zen Kaku Gothic New", url: "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;700&display=swap" }
    }),
    webFont("shippori-mincho-web", "Shippori Mincho", '"Shippori Mincho", "Yu Mincho", "Hiragino Mincho ProN", "MS PMincho", serif', {
      categoryType: "serif", recommendedFor: ["body", "heading"],
      languages: languageSupport("supported", "supported", "unknown", "unknown"),
      impression: ["上品", "落ち着いた"], uses: ["日本語本文", "長文", "見出し"],
      loading: { type: "stylesheet", family: "Shippori Mincho", url: "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;700&display=swap" }
    })
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

  function populateFontSelectOptions(select, documentObject = globalScope?.document) {
    if (!select || !documentObject || select.options?.length) return;
    [
      [SYSTEM, "システムフォント"],
      [WEB, "Webフォント（選択時に読込）"]
    ].forEach(([sourceType, label]) => {
      const group = documentObject.createElement("optgroup");
      group.label = label;
      FONT_OPTIONS.filter((font) => font.sourceType === sourceType).forEach((font) => {
        const option = documentObject.createElement("option");
        option.value = font.id;
        option.textContent = font.label;
        group.appendChild(option);
      });
      select.appendChild(group);
    });
  }

  function fontIdsInSettings(settings) {
    const normalized = normalizeFontSettings(settings);
    return [...new Set([
      normalized.titleFontId,
      normalized.bodyFontId,
      normalized.headingFontId,
      normalized.codeFontId
    ])];
  }

  function fontWeightRequestsInSettings(settings) {
    const normalized = normalizeFontSettings(settings);
    const weightsByFont = new Map();
    [
      [normalized.titleFontId, 700],
      [normalized.bodyFontId, 400],
      [normalized.headingFontId, 700],
      [normalized.codeFontId, 400]
    ].forEach(([fontId, weight]) => {
      if (!weightsByFont.has(fontId)) weightsByFont.set(fontId, new Set());
      weightsByFont.get(fontId).add(weight);
    });
    return [...weightsByFont].map(([fontId, weights]) => ({
      fontId,
      weights: [...weights].sort((first, second) => first - second)
    }));
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
    fontIdsInSettings,
    fontWeightRequestsInSettings,
    fontOption,
    normalizeFontSettings,
    normalizeNoteFontSettings,
    noteFontSettingsEqual,
    populateFontSelectOptions,
    readFontSelection,
    withoutFontSelectionParams
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusFontSettings = api;
})(typeof window !== "undefined" ? window : globalThis);
