const test = require("node:test");
const assert = require("node:assert/strict");
const { safeExternalUrl, normalizeWebClip, buildWebClipMarkdown, encodeWebClipPayload, decodeWebClipPayload, readWebClipFragment } = require("./web-clip-utils.js");

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

test("web clip payload preserves Japanese, special characters, newlines, and emoji", () => {
  const clip = { title: "記事 📝", url: "https://example.com/a?x=1&y=日本語", host: "example.com", selection: "1行目\n特殊文字: &?#%\n絵文字 😀", capturedAt: "2026-08-10T12:00:00.000Z" };
  const payload = encodeWebClipPayload(clip);
  assert.match(payload, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeWebClipPayload(payload), normalizeWebClip(clip));
});

test("web clip payload accepts an empty selection but rejects broken or incomplete payloads", () => {
  const clip = { title: "URLクリップ", url: "https://example.com/", host: "example.com", selection: "", capturedAt: "2026-08-10T12:00:00.000Z" };
  const payload = encodeWebClipPayload(clip);
  assert.equal(readWebClipFragment(`#clip=${payload}`).clip.selection, "");
  assert.equal(decodeWebClipPayload("not-a-valid-payload"), null);
  assert.throws(() => encodeWebClipPayload({ ...clip, title: "" }));
});
