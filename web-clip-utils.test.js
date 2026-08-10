const test = require("node:test");
const assert = require("node:assert/strict");
const { safeExternalUrl, normalizeWebClip, buildWebClipMarkdown } = require("./web-clip-utils.js");

test("web clip accepts only http and https URLs", () => {
  assert.equal(safeExternalUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(safeExternalUrl("javascript:alert(1)"), "");
  assert.equal(safeExternalUrl("data:text/plain,test"), "");
});

test("web clip markdown quotes Japanese selections and keeps metadata", () => {
  const clip = normalizeWebClip({ title: "記事", url: "https://example.com", selection: "日本語\n選択文", capturedAt: "2026-08-10T00:00:00.000Z" });
  assert.match(buildWebClipMarkdown(clip), /> 日本語\n> 選択文/);
  assert.match(buildWebClipMarkdown(clip), /URL: \[https:\/\/example\.com\/\]\(https:\/\/example\.com\/\)/);
});
