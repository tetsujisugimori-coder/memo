"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const css = fs.readFileSync("style.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");

function cssRule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} rule should exist`);
  const end = css.indexOf("}", start);
  assert.notEqual(end, -1, `${selector} rule should close`);
  return css.slice(start, end + 1);
}

test("コードブロックは親幅とビューポート幅を超えず横スクロールを抑止する", () => {
  const rule = cssRule(".code-block");
  assert.match(rule, /max-width:\s*min\(100%,\s*calc\(100vw - 36px\)\)/);
  assert.match(rule, /overflow-x:\s*hidden/);
});

test("コードの実改行と空白を保ったまま長い連続文字を折り返す", () => {
  const rule = cssRule(".code-block code");
  assert.match(rule, /white-space:\s*pre-wrap/);
  assert.match(rule, /overflow-wrap:\s*anywhere/);
  assert.match(rule, /word-break:\s*normal/);
  assert.doesNotMatch(rule, /text-indent|content\s*:/);
});

test("コード内容はDOM分割せず保持しhighlight.jsへ元テキストを渡す", () => {
  assert.match(app, /<code class="code-content\$\{languageClass\}">\$\{escapeHtml\(code\)\}<\/code>/);
  assert.match(app, /const code = codeElement\.textContent;/);
  assert.match(app, /codeElement\.innerHTML = highlightedHtml;/);
});
