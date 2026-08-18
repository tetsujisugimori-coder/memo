"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const calculationEngine = require("./calculation-engine.js");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const end = app.indexOf(`\nfunction ${nextName}`, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return app.slice(start, end);
}

const splitFencedBlocks = Function(
  `${functionSource("splitFencedBlocks", "splitMathAndCalculationBlocks")}; return splitFencedBlocks;`
)();
const splitMathAndCalculationBlocks = Function(
  `${functionSource("splitMathAndCalculationBlocks", "renderMathBlock")}; return splitMathAndCalculationBlocks;`
)();

function arithmeticEvaluator(expression) {
  const tokens = String(expression).match(/\d+(?:\.\d+)?|[()+\-*/]/g) || [];
  let position = 0;
  const primary = () => {
    const token = tokens[position++];
    if (token === "(") {
      const value = additive();
      if (tokens[position++] !== ")") throw new Error("parentheses");
      return value;
    }
    if (token === "-") return -primary();
    if (token === "+") return primary();
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("number");
    return value;
  };
  const multiplicative = () => {
    let value = primary();
    while (tokens[position] === "*" || tokens[position] === "/") {
      const operator = tokens[position++];
      const right = primary();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const additive = () => {
    let value = multiplicative();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const right = multiplicative();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const value = additive();
  if (position !== tokens.length) throw new Error("unexpected token");
  return value;
}

const escapeHtml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const renderCalculationBlock = Function(
  "window",
  "console",
  "escapeHtml",
  `${functionSource("renderCalculationBlock", "hydrateMathExpressions")}; return renderCalculationBlock;`
)(
  { MemoCalculationEngine: calculationEngine, math: { evaluate: arithmeticEvaluator } },
  { error() {} },
  escapeHtml
);

test("ブロック数式と計算ブロックを通常テキストから順番どおり分離する", () => {
  const source = [
    "前の文章",
    "$$",
    "\\frac{a}{b}",
    "$$",
    "中の文章 $x^2$",
    ":::calc",
    "(10000 + 5000) * 1.1",
    ":::",
    "後の文章"
  ].join("\n");
  assert.deepEqual(splitMathAndCalculationBlocks(source), [
    { type: "text", text: "前の文章" },
    { type: "math", source: "\\frac{a}{b}" },
    { type: "text", text: "中の文章 $x^2$" },
    { type: "calculation", source: "(10000 + 5000) * 1.1" },
    { type: "text", text: "後の文章" }
  ]);
});

test("fenced codeとMermaidは数式・計算ブロック解析より先に保護される", () => {
  const sample = [
    "```md",
    "$$",
    "E = mc^2",
    "$$",
    ":::calc",
    "100 + 200",
    ":::",
    "```",
    "```mermaid",
    "flowchart TD",
    "  A[$x^2$] --> B",
    "```"
  ].join("\n");
  const fenced = splitFencedBlocks(sample);
  assert.deepEqual(fenced.map((block) => block.type), ["code", "code"]);
  assert.match(fenced[0].code, /:::calc/);
  assert.match(fenced[1].code, /\$x\^2\$/);
  assert.equal(fenced.filter((block) => block.type === "text")
    .flatMap((block) => splitMathAndCalculationBlocks(block.text))
    .some((block) => block.type === "math" || block.type === "calculation"), false);
});

test("計算ブロックは式と結果を区別し、元Markdownを書き換えない", () => {
  const markdown = [":::calc", "(10000 + 5000) * 1.1", ":::"].join("\n");
  const output = renderCalculationBlock("(10000 + 5000) * 1.1");
  assert.match(output, /calculation-expression[^>]*>\(10,000 ＋ 5,000\) × 1\.1</);
  assert.match(output, /calculation-result[^>]*><span[^>]*>=<\/span> 16,500</);
  assert.equal(markdown, [":::calc", "(10000 + 5000) * 1.1", ":::"].join("\n"));
});

test("空・複数行・不正式を個別エラー表示にし、HTMLを実行可能な形で出力しない", () => {
  ["", "1 + 2\n3 + 4", "2^10", "sqrt(2)", "<img src=x onerror=alert(1)>"].forEach((source) => {
    const output = renderCalculationBlock(source);
    assert.match(output, /計算できません/);
    assert.match(output, /calculation-error/);
    assert.doesNotMatch(output, /<img src=x/);
    if (source.includes("<")) assert.match(output, /&lt;img/);
  });
});

test("複数の独立した計算ブロックは互いに参照せず分離される", () => {
  const blocks = splitMathAndCalculationBlocks([
    ":::calc", "1 + 2", ":::",
    "文章",
    ":::calc", "10%", ":::"
  ].join("\n"));
  const calculations = blocks.filter((block) => block.type === "calculation");
  assert.deepEqual(calculations.map((block) => block.source), ["1 + 2", "10%"]);
  assert.match(renderCalculationBlock(calculations[0].source), /> 3<\/div>/);
  assert.match(renderCalculationBlock(calculations[1].source), /> 0\.1<\/div>/);
});

test("インラインコードを先に選び、その内側の$を数式トークンにしない", () => {
  const findNextInlineToken = Function(
    "findAttachmentReference",
    `${functionSource("findNextInlineToken", "findInlineMathToken")}
     ${functionSource("findInlineMathToken", "renderCodeBlock")}
     return findNextInlineToken;`
  )(() => null);
  const text = "コード `$E = mc^2$` と数式 $A = \\\\pi r^2$";
  const first = findNextInlineToken(text, 0);
  const second = findNextInlineToken(text, first.end);
  assert.equal(first.type, "code");
  assert.equal(first.content, "$E = mc^2$");
  assert.equal(second.type, "math");
  assert.equal(second.content, "A = \\\\pi r^2");
});

test("KaTeX依存とmathjs依存を固定版で読み込み、動的スクリプト挿入を行わない", () => {
  assert.match(html, /katex@0\.16\.22\/dist\/katex\.min\.css/);
  assert.match(html, /katex@0\.16\.22\/dist\/katex\.min\.js/);
  assert.match(html, /mathjs@15\.2\.0\/lib\/browser\/math\.js/);
  assert.match(html, /calculation-engine\.js\?v=0\.5\.0-1/);
  assert.doesNotMatch(functionSource("renderCalculationBlock", "hydrateMathExpressions"), /createElement\(["']script|eval\(|new Function/);
});

test("数式と計算ブロックはテーマ変数を使い、内部だけ横スクロールする", () => {
  assert.match(css, /\.preview \.math-block\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.preview \.katex,[\s\S]*color:\s*inherit;[\s\S]*border-color:\s*currentColor;/);
  assert.match(css, /\.calculation-block\s*\{[^}]*max-width:\s*100%;[^}]*background:\s*var\(--section-bg\);[^}]*color:\s*var\(--ink\);/s);
  assert.match(css, /\.calculation-expression,[\s\S]*overflow-x:\s*auto;[\s\S]*white-space:\s*nowrap;/);
});
