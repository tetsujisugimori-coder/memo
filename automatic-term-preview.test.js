const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { findAutomaticTermMatches } = require("./term-link-utils.js");

const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const renderStart = appSource.indexOf("function renderAutomaticTermText(");
const renderEnd = appSource.indexOf("\nfunction renderMarkdownInline(", renderStart);
const rendererSource = appSource.slice(renderStart, renderEnd);
const renderAutomaticTermText = new Function("findAutomaticTermMatches", "escapeHtml", "renderWikiButton", `${rendererSource}\nreturn renderAutomaticTermText;`)(
  findAutomaticTermMatches,
  (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  (term, source) => `<button class="wiki-link term-wiki-link" data-title="${term}" data-term-source="${source}">${term}</button>`
);

test("通常本文の登録済み語句を表示専用の既存Wikiリンクとして装飾する", () => {
  const body = "JavaScriptではDOMを扱う";
  const html = renderAutomaticTermText(body, ["JavaScript", "DOM"]);
  assert.equal(body, "JavaScriptではDOMを扱う");
  assert.match(html, /data-title="JavaScript" data-term-source="automatic"/);
  assert.match(html, /data-title="DOM" data-term-source="automatic"/);
  assert.match(html, /^<button[\s\S]+?JavaScript/);
});

test("Markdownの明示リンク、コード、外部リンク内は自動装飾をしない経路を使う", () => {
  assert.match(appSource, /token\.type === "term-link"\) \{\s+html \+= renderWikiButton\(token\.content\)/);
  assert.match(appSource, /token\.type === "code"\) \{\s+html \+= `<code class="inline-code">\$\{escapeHtml\(token\.content\)\}<\/code>`/);
  assert.match(appSource, /token\.type === "link"[\s\S]*?automaticEnabled: false/);
  assert.match(appSource, /token\.type === "image"[\s\S]*?automaticEnabled: false/);
});
