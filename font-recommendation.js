(function (globalScope) {
  "use strict";

  const FONT_TONE_PROFILES = {
    "segoe-ui": ["neutral"],
    "yu-gothic-ui": ["neutral", "formal"],
    meiryo: ["neutral"],
    "ms-mincho": ["formal"],
    consolas: ["neutral"],
    "cascadia-code": ["neutral", "casual"],
    "courier-new": ["formal"],
    "times-new-roman": ["formal"],
    "noto-sans-jp-web": ["neutral"],
    "noto-serif-jp-web": ["formal"],
    "noto-sans-sc-web": ["neutral"],
    "noto-sans-tc-web": ["neutral"],
    "source-han-sans-web": ["neutral"],
    "inter-web": ["neutral", "casual"],
    "ibm-plex-sans-web": ["neutral"],
    "jetbrains-mono-web": ["neutral", "casual"],
    "zen-kaku-gothic-new-web": ["neutral", "casual"],
    "shippori-mincho-web": ["formal"]
  };

  const LANGUAGE_REASON = {
    japanese: "日本語向けとして登録",
    simplifiedChinese: "簡体字中国語向けとして登録",
    traditionalChinese: "繁体字中国語向けとして登録",
    latin: "英数字中心のUI・本文向け"
  };

  const MOOD_KEYWORDS = {
    casual: ["親しみ", "軽快", "現代的"],
    neutral: ["読みやすい", "可読性", "明快", "安定感", "汎用", "実用的", "中立"],
    formal: ["落ち着いた", "上品", "古典的", "印刷物風", "端正"]
  };

  function languageStatusScore(status) {
    return { supported: 12, partial: 4, unknown: 0, unsupported: -12 }[status] ?? 0;
  }

  function recommendationTarget(purpose) {
    return { writing: "body", reading: "body", heading: "heading", code: "code" }[purpose] || null;
  }

  function includesKeyword(values, keywords) {
    return (values || []).some((value) => keywords.some((keyword) => String(value).includes(keyword)));
  }

  function purposeScore(font, purpose) {
    const target = recommendationTarget(purpose);
    let score = font.recommendedFor?.includes(target) ? 5 : 0;
    const uses = font.uses || [];
    if (purpose === "code") {
      if (font.categoryType === "monospace") score += 10;
      if (includesKeyword(uses, ["コード"])) score += 5;
      return score;
    }
    if (font.categoryType === "monospace") score -= 3;
    if (purpose === "heading" && includesKeyword(uses, ["見出し", "UI"])) score += 4;
    if (purpose === "writing" && includesKeyword(uses, ["本文", "長文", "説明文"])) score += 4;
    if (purpose === "reading" && includesKeyword(uses, ["本文", "長文"])) score += 5;
    return score;
  }

  function moodScore(font, mood) {
    let score = FONT_TONE_PROFILES[font.id]?.includes(mood) ? 5 : 0;
    if (includesKeyword(font.impression, MOOD_KEYWORDS[mood] || [])) score += 2;
    if (mood === "formal" && font.categoryType === "serif") score += 4;
    if (mood === "neutral" && font.categoryType === "sans-serif") score += 2;
    if (mood === "casual" && font.categoryType === "sans-serif") score += 1;
    return score;
  }

  function recommendationReasons(font, answers) {
    const reasons = [];
    if (["supported", "partial"].includes(font.languages?.[answers.language])) {
      if (answers.language === "japanese" && ["writing", "reading"].includes(answers.purpose)) reasons.push("日本語の長文向け");
      else if (answers.language === "japanese" && answers.purpose === "heading") reasons.push("日本語の見出し向け");
      else if (answers.language === "latin" && answers.purpose === "code") reasons.push("英数字中心のコード向け");
      else reasons.push(LANGUAGE_REASON[answers.language]);
    } else if (font.languages?.[answers.language] === "unknown") {
      reasons.push("この言語への対応は未確認");
    }
    if (answers.mood === "formal" && font.categoryType === "serif") reasons.push("落ち着いた明朝・セリフ系");
    else if (FONT_TONE_PROFILES[font.id]?.includes(answers.mood)) {
      reasons.push({ casual: "親しみやすい雰囲気", neutral: "中立的で読みやすさを重視", formal: "落ち着いた・フォーマルな雰囲気" }[answers.mood]);
    }
    if (answers.purpose === "code" && font.categoryType === "monospace") reasons.push("等幅でコード向け");
    else if (font.recommendedFor?.includes(recommendationTarget(answers.purpose))) {
      reasons.push({ writing: "長文を書く用途向け", reading: "長文を読む用途向け", heading: "見出し・短文向け" }[answers.purpose]);
    }
    if (!reasons.length) reasons.push(font.sourceType === "web" ? "選択時に読み込むWebフォント" : "端末のシステムフォントを使用");
    return [...new Set(reasons)].slice(0, 2);
  }

  function completeAnswers(answers) {
    return Boolean(answers?.language && answers?.mood && recommendationTarget(answers?.purpose));
  }

  function scored(fonts, answers) {
    return fonts.map((font) => ({
      font,
      score: languageStatusScore(font.languages?.[answers.language]) + purposeScore(font, answers.purpose) + moodScore(font, answers.mood),
      reasons: recommendationReasons(font, answers)
    })).sort((first, second) => second.score - first.score || first.font.catalogIndex - second.font.catalogIndex);
  }

  function recommendFonts(fonts, answers, limit = 3) {
    if (!completeAnswers(answers)) return [];
    const seen = new Set();
    const unique = [];
    for (const font of fonts || []) {
      if (!font?.id || seen.has(font.id)) continue;
      seen.add(font.id);
      unique.push({ ...font, catalogIndex: unique.length });
    }
    const maximum = Math.max(0, Math.min(3, Number(limit) || 0));
    const preferred = unique.filter((font) => ["supported", "partial"].includes(font.languages?.[answers.language]));
    const unknown = unique.filter((font) => !font.languages || font.languages[answers.language] === "unknown" || !font.languages[answers.language]);
    const unsupported = unique.filter((font) => font.languages?.[answers.language] === "unsupported");
    const pool = preferred.length >= maximum
      ? scored(preferred, answers)
      : [...scored(preferred, answers), ...scored(unknown, answers), ...scored(unsupported, answers)];
    return pool.slice(0, maximum).map((result, index) => ({ ...result, rank: index + 1 }));
  }

  const api = { FONT_TONE_PROFILES, languageStatusScore, recommendationTarget, recommendFonts };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusFontRecommendation = api;
})(typeof window !== "undefined" ? window : globalThis);
