(function exposeCalculationEngine(root, factory) {
  const engine = factory();
  if (typeof module === "object" && module.exports) module.exports = engine;
  if (root) root.MemoCalculationEngine = engine;
}(typeof globalThis === "object" ? globalThis : this, function createCalculationEngine() {
  "use strict";

  const ALLOWED_EXPRESSION = /^[0-9+\-*/().%\s]+$/;
  const MAX_EXPRESSION_LENGTH = 10000;

  class CalculationError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "CalculationError";
      this.code = code;
      this.userMessage = "計算できません";
    }
  }

  function fail(code, message) {
    throw new CalculationError(code, message);
  }

  function normalizeExpression(expression) {
    return String(expression || "")
      .replace(/[＋+]/g, "+")
      .replace(/[−–—]/g, "-")
      .replace(/[×xX]/g, "*")
      .replace(/÷/g, "/")
      .replace(/\s+/g, "");
  }

  function validateExpression(expression) {
    const original = String(expression || "");
    if (original.length > MAX_EXPRESSION_LENGTH) fail("too-long", "式が長すぎます");

    const normalized = normalizeExpression(original);
    if (!normalized) fail("empty", "式を入力してください");
    if (!ALLOWED_EXPRESSION.test(normalized)) fail("invalid-character", "使用できない文字が含まれています");

    let depth = 0;
    for (const character of normalized) {
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (depth < 0) fail("parentheses", "括弧の対応を確認してください");
    }
    if (depth !== 0) fail("parentheses", "括弧の対応を確認してください");
    if (/[+\-*/.(]$/.test(normalized)) fail("incomplete", "式が不完全です");

    return normalized;
  }

  function expandPercent(expression) {
    let expanded = expression;
    let previous = "";
    while (expanded !== previous) {
      previous = expanded;
      expanded = expanded
        .replace(/(\d+(?:\.\d+)?)%/g, "($1/100)")
        .replace(/(\([^()%]+\))%/g, "($1/100)");
    }
    if (expanded.includes("%")) fail("percent", "% の位置を確認してください");
    return expanded;
  }

  function prepareExpression(expression) {
    const normalized = validateExpression(expression);
    return {
      normalized,
      expanded: expandPercent(normalized)
    };
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) return "計算できません";
    if (value === 0) return "0";

    const absolute = Math.abs(value);
    if (absolute >= 1e15 || absolute < 1e-9) {
      return value
        .toExponential(10)
        .replace(/\.0+e/, "e")
        .replace(/(\.\d*?)0+e/, "$1e");
    }

    return new Intl.NumberFormat("ja-JP", {
      maximumFractionDigits: 12,
      useGrouping: true
    }).format(value);
  }

  function formatExpression(expression) {
    return normalizeExpression(expression)
      .replace(/(?<![\d.])(\d+(?:\.\d+)?)/g, (number) => (
        new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 12 }).format(Number(number))
      ))
      .replace(/\*/g, " × ")
      .replace(/\//g, " ÷ ")
      .replace(/\+/g, " ＋ ")
      .replace(/-/g, " − ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function evaluateExpression(expression, evaluator) {
    const prepared = prepareExpression(expression);
    if (typeof evaluator !== "function") fail("engine-unavailable", "計算エンジンを利用できません");

    let raw;
    try {
      raw = evaluator(prepared.expanded);
    } catch (error) {
      fail("evaluation", "式が不完全か、計算できない内容です");
    }

    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      if (prepared.normalized.includes("/0")) fail("division-by-zero", "0では割れません");
      fail("non-finite", "計算結果を求められません");
    }
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) fail("unsafe-integer", "扱える桁数を超えました");

    return {
      value,
      result: formatNumber(value),
      displayExpression: formatExpression(expression),
      normalized: prepared.normalized,
      expanded: prepared.expanded
    };
  }

  return {
    ALLOWED_EXPRESSION,
    MAX_EXPRESSION_LENGTH,
    CalculationError,
    normalizeExpression,
    validateExpression,
    expandPercent,
    prepareExpression,
    evaluateExpression,
    formatNumber,
    formatExpression
  };
}));
