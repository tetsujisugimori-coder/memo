const test = require("node:test");
const assert = require("node:assert/strict");
const {
  safeExternalUrl, normalizeWebClip, buildWebClipMarkdown, encodeWebClipPayload, decodeWebClipPayload,
  readWebClipFragment, compareSemanticVersions, isWebClipperVersionCompatible, webClipUrlWithoutLaunchMarker,
  normalizeWebClipComparisonUrl
} = require("./web-clip-utils.js");
const { buildWebClipDestination } = require("./extensions/web-clipper/clip-payload.js");

test("web clip accepts only http and https URLs", () => {
  assert.equal(safeExternalUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(safeExternalUrl("javascript:alert(1)"), "");
  assert.equal(safeExternalUrl("data:text/plain,test"), "");
});

test("再クリップ比較URLはfragmentと末尾slashだけを正規化し、queryは維持する", () => {
  assert.equal(normalizeWebClipComparisonUrl("https://example.com/article/#section"), "https://example.com/article");
  assert.equal(normalizeWebClipComparisonUrl("https://example.com/article"), "https://example.com/article");
  assert.notEqual(normalizeWebClipComparisonUrl("https://example.com/article?lang=ja"), normalizeWebClipComparisonUrl("https://example.com/article?lang=en"));
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

test("リンクのみ・メモ付き・ページ全文のclipModeをMarkdownとメタデータ用に正規化する", () => {
  const link = normalizeWebClip({ title: "リンク", url: "https://example.com", host: "example.com", selection: "", clipMode: "link", capturedAt: "2026-08-11T01:23:45.000Z" });
  const memo = normalizeWebClip({ ...link, clipMode: "memo", selection: "選択", userMemo: "あとで確認 😀" });
  const page = normalizeWebClip({ ...link, clipMode: "page", selection: "# 見出し\n\n本文" });
  assert.match(buildWebClipMarkdown(link), /出典: リンク/);
  assert.match(buildWebClipMarkdown(memo), /メモ: あとで確認 😀/);
  assert.match(buildWebClipMarkdown(page), /# 見出し/);
  assert.equal(page.clipMode, "page");
});

test("拡張payloadを本体が日本語・改行・絵文字を含めて復元できる", () => {
  const clip = {
    title: "日本語タイトル 📝",
    url: "https://example.com/articles/web-clip?lang=ja",
    host: "日本語サイト名",
    selection: "1行目\n2行目 😀",
    capturedAt: "2026-08-11T01:23:45.000Z"
  };
  const destination = buildWebClipDestination("https://tetsujisugimori-coder.github.io/memo/", clip);
  const decoded = readWebClipFragment(new URL(destination).hash).clip;
  assert.deepEqual(decoded, normalizeWebClip(clip));
});

test("拡張payloadを本体が選択本文なしでも復元できる", () => {
  const clip = { title: "URLクリップ", url: "https://example.com/", host: "example.com", selection: "", capturedAt: "2026-08-11T01:23:45.000Z" };
  const destination = buildWebClipDestination("http://127.0.0.1:5500/", clip);
  const url = new URL(destination);
  assert.equal(url.origin, "http://127.0.0.1:5500");
  assert.equal(url.searchParams.get("web-clip"), "1");
  assert.deepEqual(readWebClipFragment(url.hash).clip, normalizeWebClip(clip));
});

test("拡張は既存の選択本文上限を長文クリップとして分類する", () => {
  const clip = { title: "長文", url: "https://example.com/", host: "example.com", selection: "x".repeat(100001), capturedAt: "2026-08-11T01:23:45.000Z" };
  assert.throws(() => buildWebClipDestination("http://127.0.0.1:5500/", clip), (error) => error.code === "clip-too-large");
});

test("web-clip起動目印だけを全件削除し、他のqueryとhashを維持する", () => {
  assert.equal(webClipUrlWithoutLaunchMarker("https://memo.test/?web-clip=1"), "/");
  assert.equal(webClipUrlWithoutLaunchMarker("https://memo.test/?web-clip=1&foo=bar"), "/?foo=bar");
  assert.equal(webClipUrlWithoutLaunchMarker("https://memo.test/?foo=bar&web-clip=1&web-clip=2"), "/?foo=bar");
  assert.equal(webClipUrlWithoutLaunchMarker("https://memo.test/?popout=abc&web-clip=1#clip-transfer=id"), "/?popout=abc#clip-transfer=id");
});

test("Web Clipper最低互換版をSemVerで比較し、欠落を旧版として扱う", () => {
  assert.equal(compareSemanticVersions("0.1.0", "0.3.0"), -1);
  assert.equal(compareSemanticVersions("0.3.0", "0.3.0"), 0);
  assert.equal(compareSemanticVersions("0.3.1", "0.3.0"), 1);
  assert.equal(compareSemanticVersions("0.10.0", "0.3.0"), 1);
  assert.equal(isWebClipperVersionCompatible("", "0.3.0"), false);
  assert.equal(isWebClipperVersionCompatible("0.1.0", "0.3.0"), false);
  assert.equal(isWebClipperVersionCompatible("0.3.0", "0.3.0"), true);
});

test("Web Clipper診断情報をpayload往復で維持する", () => {
  const clip = {
    title: "診断", url: "https://example.com/", host: "example.com", selection: "本文", capturedAt: "2026-08-12T00:00:00.000Z",
    extensionVersion: "0.3.2", manifestVersion: 3, browserFamily: "Edge", targetEnvironment: "development", distributionChannel: "unpacked-development"
  };
  assert.deepEqual(decodeWebClipPayload(encodeWebClipPayload(clip)), normalizeWebClip(clip));
});
