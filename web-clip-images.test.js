const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeWebClip,
  buildWebClipMarkdown,
  replaceWebClipImageMarkers,
  webClipImageFailureMarkdown
} = require("./web-clip-utils.js");
const { serializeImageBlock } = require("./attachment-utils.js");
const { fetchClipImages, sniffImageType, gifDimensions } = require("./extensions/web-clipper/image-fetcher.js");
const { fetchImagesForMessage } = require("./extensions/web-clipper/background.js");

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

test("同一ドメインJPEGと別ドメインCDNのPNGをService Worker取得結果として保存対象にできる", async () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  const images = await fetchImagesForMessage({
    candidates: [
      { token: "web-clip-image-1", url: "https://article.example/photo" },
      { token: "web-clip-image-2", url: "https://cdn.example/image.bin" }
    ]
  }, {
    hasPermission: async () => true,
    fetchImages: (candidates, options) => fetchClipImages(candidates, {
      ...options,
      decodeImage: async () => {},
      fetchImpl: async (url) => new Response(url.includes("cdn.example") ? png : jpeg, {
        status: 200,
        headers: { "content-type": url.includes("cdn.example") ? "application/octet-stream" : "image/jpeg" }
      })
    })
  });
  assert.deepEqual(images.map((image) => image.status), ["ready", "ready"]);
  assert.deepEqual(images.map((image) => image.mimeType), ["image/jpeg", "image/png"]);
  assert.ok(images.every((image) => image.selected && image.size > 0 && image.dataBase64));
});

test("権限不足と一部取得失敗があっても成功画像は選択可能な確定状態になる", async () => {
  const candidates = [
    { token: "web-clip-image-1", url: "https://allowed.example/a.png" },
    { token: "web-clip-image-2", url: "https://allowed.example/missing.png" },
    { token: "web-clip-image-3", url: "https://denied.example/private.png" }
  ];
  const images = await fetchImagesForMessage({ candidates }, {
    hasPermission: async (origin) => !origin.includes("denied.example"),
    fetchImages: async (allowed) => allowed.map((candidate, index) => index === 0
      ? { ...candidate, status: "ready", selected: true, mimeType: "image/png", size: 10, dataBase64: "AA==" }
      : { ...candidate, status: "failed", selected: false, error: "HTTP 404で取得できません" })
  });
  assert.deepEqual(images.map((image) => image.status), ["ready", "failed", "permission-denied"]);
  assert.equal(images[0].selected, true);
  assert.ok(images.slice(1).every((image) => image.selected === false));
  assert.ok(images.every((image) => image.status !== "pending"));
});

test("画像取得タイムアウトは必ずtimeoutへ確定する", async () => {
  const images = await fetchClipImages([{ token: "web-clip-image-1", url: "https://slow.example/a.png" }], {
    timeoutMs: 1000,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    })
  });
  assert.equal(images[0].status, "timeout");
  assert.equal(images[0].selected, false);
  assert.match(images[0].error, /タイムアウト/);
});

test("アニメーションGIFはフレームを潰さず取得バイト列をそのまま保存対象にする", async () => {
  const gif = Uint8Array.from(Buffer.from("R0lGODlhZAAyAPAAAAD/AAAAACH5BAABAAAAIf8LTkVUU0NBUEUyLjADAQAAACwAAAAAZAAyAAACTYSPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kzX9o3n+s73/g8MCofEovGITCqXzKbzCY1Kp9Sq9YrNarfcrvcLDovH5LL5bCsAACH5BAAQJwAALAAAAABkADIAgP8AAAAAAAJNhI+py+0Po5y02ouz3rz7D4biSJbmiabqyrbuC8fyTNf2jef6zvf+DwwKh8Si8YhMKpfMpvMJjUqn1Kr1is1qt9yu9wsOi8fksvlsKwAAOw==", "base64"));
  const [image] = await fetchClipImages([{ token: "web-clip-image-1", url: "https://example.com/animated.bin" }], {
    fetchImpl: async () => new Response(gif, { headers: { "content-type": "application/octet-stream" } }),
    decodeImage: async () => ({ width: 100, height: 50 })
  });
  assert.equal(sniffImageType(gif), "image/gif");
  assert.deepEqual(gifDimensions(gif), { width: 100, height: 50 });
  assert.equal(image.status, "ready");
  assert.equal(image.mimeType, "image/gif");
  assert.deepEqual(Buffer.from(image.dataBase64, "base64"), Buffer.from(gif));
  assert.ok([...gif].filter((byte) => byte === 0x2c).length >= 2);
});

test("GIF署名だけを装いデコードできないデータは保存対象から除外する", async () => {
  const fake = Uint8Array.from([...Buffer.from("GIF89a", "ascii"), 2, 0, 2, 0, 0, 0]);
  const [image] = await fetchClipImages([{ token: "web-clip-image-1", url: "https://example.com/fake.gif" }], {
    fetchImpl: async () => new Response(fake, { headers: { "content-type": "image/gif" } }),
    decodeImage: async () => { throw new Error("broken"); }
  });
  assert.equal(image.status, "unsupported");
  assert.equal(image.errorCode, "DECODE_FAILED");
});

test("SVGとAVIFは変換器の安全なWebP結果だけを保存対象へ渡す", async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const avif = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0]);
  const stored = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const convertedTypes = [];
  const images = await fetchClipImages([
    { token: "web-clip-image-1", url: "https://example.com/a.svg" },
    { token: "web-clip-image-2", url: "https://example.com/a.avif" }
  ], {
    fetchImpl: async (url) => new Response(url.endsWith("svg") ? svg : avif, { headers: { "content-type": url.endsWith("svg") ? "image/svg+xml" : "image/avif" } }),
    convertImage: async ({ mimeType }) => { convertedTypes.push(mimeType); return { bytes: stored, mimeType: "image/webp", width: 100, height: 80 }; }
  });
  assert.deepEqual(convertedTypes.sort(), ["image/avif", "image/svg+xml"]);
  assert.deepEqual(images.map((image) => image.status), ["ready", "ready"]);
  assert.ok(images.every((image) => image.mimeType === "image/webp" && image.converted));
});

test("変換器が使えないSVG/AVIFも取得中のままにせず対応外へ確定する", async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  const [image] = await fetchClipImages([{ token: "web-clip-image-1", url: "https://example.com/a.svg" }], {
    fetchImpl: async () => new Response(svg, { headers: { "content-type": "image/svg+xml" } })
  });
  assert.equal(image.status, "unsupported");
  assert.equal(image.errorCode, "CONVERSION_UNAVAILABLE");
});
