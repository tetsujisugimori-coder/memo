"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const engine = require("./calculation-engine.js");

function safeArithmeticEvaluator(expression) {
  let index = 0;
  const source = String(expression);

  function skipSpaces() {
    while (/\s/.test(source[index] || "")) index += 1;
  }

  function parseNumber() {
    skipSpaces();
    const match = source.slice(index).match(/^\d+(?:\.\d+)?/);
    if (!match) throw new Error("number expected");
    index += match[0].length;
    return Number(match[0]);
  }

  function parsePrimary() {
    skipSpaces();
    if (source[index] === "(") {
      index += 1;
      const value = parseAdditive();
      skipSpaces();
      if (source[index] !== ")") throw new Error("closing parenthesis expected");
      index += 1;
      return value;
    }
    if (source[index] === "+" || source[index] === "-") {
      const sign = source[index];
      index += 1;
      const value = parsePrimary();
      return sign === "-" ? -value : value;
    }
    return parseNumber();
  }

  function parseMultiplicative() {
    let value = parsePrimary();
    while (true) {
      skipSpaces();
      const operator = source[index];
      if (operator !== "*" && operator !== "/") return value;
      index += 1;
      const right = parsePrimary();
      value = operator === "*" ? value * right : value / right;
    }
  }

  function parseAdditive() {
    let value = parseMultiplicative();
    while (true) {
      skipSpaces();
      const operator = source[index];
      if (operator !== "+" && operator !== "-") return value;
      index += 1;
      const right = parseMultiplicative();
      value = operator === "+" ? value + right : value - right;
    }
  }

  const result = parseAdditive();
  skipSpaces();
  if (index !== source.length) throw new Error("unexpected token");
  return result;
}

function calculate(expression) {
  return engine.evaluateExpression(expression, safeArithmeticEvaluator);
}

test("Calculator Memoと同じ四則演算・括弧・小数・負数を計算する", () => {
  const cases = [
    ["2+3", 5],
    ["2+3*4", 14],
    ["(2+3)*4", 20],
    ["10/4", 2.5],
    ["-3+1", -2],
    ["0.1+0.2", 0.1 + 0.2]
  ];
  cases.forEach(([expression, expected]) => {
    assert.equal(calculate(expression).value, expected);
  });
});

test("Calculator Memoと同じ単項パーセント解釈を使用する", () => {
  const cases = [
    ["200+10%", 200.1],
    ["200-10%", 199.9],
    ["200*10%", 20],
    ["200/10%", 2000],
    ["10%", 0.1],
    ["(50+50)%", 1],
    ["200*(5%+5%)", 20]
  ];
  cases.forEach(([expression, expected]) => {
    assert.equal(calculate(expression).value, expected);
  });
});

test("全角演算子、空白、xをCalculator Memoと同じ規則で正規化する", () => {
  assert.equal(engine.normalizeExpression(" １２ + ３ "), "１２+３");
  assert.equal(engine.normalizeExpression("10 ＋ 2 − 1 × 3 ÷ 2"), "10+2-1*3/2");
  assert.equal(engine.normalizeExpression("5 x 4 X 2"), "5*4*2");
  assert.equal(calculate("10 ＋ 2 × 3").value, 16);
});

test("結果表示と表示用演算子をCalculator Memoと同じ規則で整形する", () => {
  assert.equal(engine.formatNumber(16500), "16,500");
  assert.equal(engine.formatNumber(1 / 3), "0.333333333333");
  assert.equal(engine.formatNumber(1e15), "1e+15");
  assert.equal(engine.formatExpression("(10000 + 5000) * 1.1"), "(10,000 ＋ 5,000) × 1.1");
  assert.equal(calculate("(10000 + 5000) * 1.1").result, "16,500");
});

test("空、括弧不一致、不完全式、ゼロ除算、未対応演算・関数を分類して拒否する", () => {
  const cases = [
    ["", "empty"],
    ["100+(", "parentheses"],
    ["100+", "incomplete"],
    ["1/0", "division-by-zero"],
    ["2^10", "invalid-character"],
    ["sqrt(2)", "invalid-character"],
    ["alert(1)", "invalid-character"],
    ["1;2", "invalid-character"],
    ["<script>alert(1)</script>", "invalid-character"]
  ];
  cases.forEach(([expression, code]) => {
    assert.throws(
      () => calculate(expression),
      (error) => error instanceof engine.CalculationError && error.code === code
    );
  });
});

test("極端に長い入力は評価せず安全に拒否する", () => {
  let evaluated = false;
  const expression = "1+".repeat(engine.MAX_EXPRESSION_LENGTH) + "1";
  assert.throws(
    () => engine.evaluateExpression(expression, () => {
      evaluated = true;
      return 0;
    }),
    (error) => error.code === "too-long"
  );
  assert.equal(evaluated, false);
});

test("任意のJavaScript実行APIを計算エンジン内で使用しない", () => {
  const source = require("node:fs").readFileSync("calculation-engine.js", "utf8");
  assert.doesNotMatch(source, /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/);
});
