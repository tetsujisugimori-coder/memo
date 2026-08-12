(function initTextStatsUtils(globalScope) {
  "use strict";

  const TEXT_STATS_CHARS_PER_MINUTE = 500;
  const segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

  function splitGraphemes(value) {
    const text = String(value ?? "");
    return segmenter ? [...segmenter.segment(text)].map((part) => part.segment) : Array.from(text);
  }

  function countCharacterTypes(value) {
    const counts = { kanji: 0, hiragana: 0, katakana: 0, alphabet: 0, digits: 0, symbols: 0, whitespace: 0, other: 0 };
    for (const grapheme of splitGraphemes(value)) {
      if (/^\s$/u.test(grapheme)) counts.whitespace += 1;
      else if (/\p{Script=Han}/u.test(grapheme)) counts.kanji += 1;
      else if (/\p{Script=Hiragana}/u.test(grapheme)) counts.hiragana += 1;
      else if (/[\p{Script=Katakana}\uFF66-\uFF9F]/u.test(grapheme)) counts.katakana += 1;
      else if (/[A-Za-zＡ-Ｚ]/u.test(grapheme)) counts.alphabet += 1;
      else if (/[0-9０-９]/u.test(grapheme)) counts.digits += 1;
      else if (/\p{Extended_Pictographic}/u.test(grapheme)) counts.other += 1;
      else if (/[\p{P}\p{S}]/u.test(grapheme)) counts.symbols += 1;
      else counts.other += 1;
    }
    return counts;
  }

  function calculateParagraphCount(value) {
    return String(value ?? "").split(/\r\n?|\n/).reduce((count, line, index, lines) => {
      if (!line.trim()) return count;
      return index === 0 || !lines[index - 1].trim() ? count + 1 : count;
    }, 0);
  }

  function estimateReadingTime(charactersWithoutWhitespace) {
    const estimatedReadingMinutes = Math.ceil(Math.max(0, charactersWithoutWhitespace) / TEXT_STATS_CHARS_PER_MINUTE);
    return {
      estimatedReadingMinutes,
      label: charactersWithoutWhitespace < TEXT_STATS_CHARS_PER_MINUTE ? "1分未満" : `約${estimatedReadingMinutes}分`
    };
  }

  function calculateTextStats(value) {
    const characterTypes = countCharacterTypes(value);
    const charactersWithWhitespace = Object.values(characterTypes).reduce((total, count) => total + count, 0);
    const charactersWithoutWhitespace = charactersWithWhitespace - characterTypes.whitespace;
    return {
      charactersWithoutWhitespace,
      charactersWithWhitespace,
      paragraphs: calculateParagraphCount(value),
      ...estimateReadingTime(charactersWithoutWhitespace),
      characterTypes
    };
  }

  const api = { TEXT_STATS_CHARS_PER_MINUTE, splitGraphemes, countCharacterTypes, calculateParagraphCount, estimateReadingTime, calculateTextStats };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.TextStatsUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
