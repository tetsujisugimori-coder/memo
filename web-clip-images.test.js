const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeWebClip,
  buildWebClipMarkdown,
  replaceWebClipImageMarkers,
  webClipImageFailureMarkdown
} = require("./web-clip-utils.js");
const { serializeImageBlock } = require("./attachment-utils.js");
const { fetchClipImages } = require("./extensions/web-clipper/image-fetcher.js");

const capturedAt = "2026-08-12T00:00:00.000Z";
const readyImage = (token, overrides = {}) => ({
  token,
  url: `https://example.com/${token}.png`,
  alt: token,
  caption: `${token}の説明`,
  status: "ready",
  mimeType: "image/png",
  size: 3,
  fileName: `${token}.png`,
  dataBase64: Buffer.from("img").toString("base64"),
  ...overrides
});

test("記事中の画像マーカーを同じ順序・位置の既存画像ブロックへ置換する", () => {
  const clip = normalizeWebClip({
    title: "記事",
    url: "https://example.com/article",
    host: "example.com",
    clipMode: "page",
    selection: "前\n\n<!-- memo-nexus:web-clip-image:web-clip-image-1 -->\n\n中\n\n<!-- memo-nexus:web-clip-image:web-clip-image-2 -->\n\n後",
    capturedAt,
    images: [readyImage("web-clip-image-1"), readyImage("web-clip-image-2")]
  });
  const replacements = new Map([
    ["web-clip-image-1", serializeImageBlock([{ id: "local-one", alt: "一枚目" }], "説明1")],
    ["web-clip-image-2", serializeImageBlock([{ id: "local-two", alt: "二枚目" }], "説明2")]
  ]);
  const body = replaceWebClipImageMarkers(buildWebClipMarkdown(clip), replacements, clip.images);
  assert.ok(body.indexOf("前") < body.indexOf("attachment://local-one"));
  assert.ok(body.indexOf("attachment://local-one") < body.indexOf("中"));
  assert.ok(body.indexOf("中") < body.indexOf("attachment://local-two"));
  assert.ok(body.indexOf("attachment://local-two") < body.indexOf("後"));
});

test("選択クリップは本文を引用しつつ画像マーカーだけを引用外へ保つ", () => {
  const clip = normalizeWebClip({
    title: "選択",
    url: "https://example.com/article",
    host: "example.com",
    clipMode: "selection",
    selection: "選択前\n\n<!-- memo-nexus:web-clip-image:web-clip-image-1 -->\n\n選択後",
    capturedAt,
    images: [readyImage("web-clip-image-1")]
  });
  const markdown = buildWebClipMarkdown(clip);
  assert.match(markdown, /> 選択前/);
  assert.match(markdown, /\n<!-- memo-nexus:web-clip-image:web-clip-image-1 -->\n/);
  assert.doesNotMatch(markdown, /> <!-- memo-nexus:web-clip-image/);
});

test("除外画像だけを空にし、取得失敗画像は理由付き注記を残す", () => {
  const failed = { ...readyImage("web-clip-image-2"), status: "failed", dataBase64: "", error: "CORS制限" };
  const markdown = "A\n\n<!-- memo-nexus:web-clip-image:web-clip-image-1 -->\n\nB\n\n<!-- memo-nexus:web-clip-image:web-clip-image-2 -->\n\nC";
  const result = replaceWebClipImageMarkers(markdown, { "web-clip-image-1": "" }, [readyImage("web-clip-image-1", { selected: false }), failed]);
  assert.doesNotMatch(result, /web-clip-image-1/);
  assert.match(result, /画像を保存できませんでした:[\s\S]*CORS制限/);
  assert.match(webClipImageFailureMarkdown(failed, failed.error), /^> 画像を保存できませんでした:/);
});

test("リンクのみでは画像データを受け付けない", () => {
  const clip = normalizeWebClip({ title: "リンク", url: "https://example.com", host: "example.com", clipMode: "link", selection: "", capturedAt, images: [readyImage("web-clip-image-1")] });
  assert.deepEqual(clip.images, []);
});

test("本体側でも既存画像ブロック非対応の形式を保存対象から除外する", () => {
  const clip = normalizeWebClip({
    title: "SVG",
    url: "https://example.com",
    host: "example.com",
    clipMode: "page",
    selection: "<!-- memo-nexus:web-clip-image:web-clip-image-1 -->",
    capturedAt,
    images: [readyImage("web-clip-image-1", { mimeType: "image/svg+xml" })]
  });
  assert.equal(clip.images[0].status, "unsupported");
  assert.equal(clip.images[0].selected, false);
});

test("画像取得は対応形式を保持し、形式外・合計上限・取得失敗を画像ごとに分離する", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url) => {
    if (url.endsWith("missing")) throw new TypeError("CORS");
    if (url.endsWith("svg")) return new Response(new Blob(["svg"], { type: "image/svg+xml" }), { status: 200 });
    return new Response(new Blob([url.endsWith("large") ? "1234" : "123"], { type: "image/png" }), { status: 200 });
  };
  const images = await fetchClipImages([
    { token: "web-clip-image-1", url: "https://example.com/ok" },
    { token: "web-clip-image-2", url: "https://example.com/large" },
    { token: "web-clip-image-3", url: "https://example.com/svg" },
    { token: "web-clip-image-4", url: "https://example.com/missing" }
  ], { perImageLimit: 4, totalLimit: 5, timeoutMs: 1000 });
  assert.equal(images[0].status, "ready");
  assert.equal(images[1].status, "too-large");
  assert.equal(images[2].status, "unsupported");
  assert.equal(images[3].status, "failed");
});
