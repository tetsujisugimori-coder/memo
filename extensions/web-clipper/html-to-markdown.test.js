const test = require("node:test");
const assert = require("node:assert/strict");
const { htmlToMarkdown } = require("./html-to-markdown.js");
const { extractPageHtml } = require("./page-extractor.js");

test("ページ抽出関数はexecuteScriptで単独実行できる自己完結関数である", () => {
  const source = extractPageHtml.toString();
  assert.match(source, /const exclude/);
  assert.match(source, /const score/);
  assert.doesNotMatch(source, /EXCLUDE/);
});

test("ページ本文の主要なHTMLを安全なMarkdownへ変換する", () => {
  const markdown = htmlToMarkdown('<nav>menu</nav><h1>日本語 😀</h1><p>本文と<strong>重要</strong><a href="https://example.com">リンク</a></p><ul><li>一つ</li></ul><blockquote>引用</blockquote><pre>const x = 1;</pre><script>alert(1)</script><footer>footer</footer>');
  assert.match(markdown, /# 日本語 😀/);
  assert.match(markdown, /\*\*重要\*\*/);
  assert.match(markdown, /\[リンク\]\(https:\/\/example\.com\)/);
  assert.match(markdown, /- 一つ/);
  assert.match(markdown, /> 引用/);
  assert.match(markdown, /```/);
  assert.doesNotMatch(markdown, /menu|alert|footer/);
});
