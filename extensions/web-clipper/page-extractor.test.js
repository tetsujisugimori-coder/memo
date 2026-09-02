const test = require("node:test");
const assert = require("node:assert/strict");
const { extractMetadata } = require("./page-extractor.js");

function metadataDocument({ title = "", meta = {}, jsonLd = [] } = {}) {
  return {
    title,
    querySelector(selector) {
      return Object.hasOwn(meta, selector) ? { getAttribute: () => meta[selector] } : null;
    },
    querySelectorAll(selector) {
      return selector === 'script[type="application/ld+json"]'
        ? jsonLd.map((value) => ({ textContent: JSON.stringify(value) }))
        : [];
    }
  };
}

test("Open Graph、通常description、サイト名、JSON-LD articleBodyを抽出する", () => {
  const metadata = extractMetadata(metadataDocument({
    title: "document title",
    meta: {
      'meta[property="og:title"]': "OG title",
      'meta[name="description"]': "記事の説明",
      'meta[property="og:site_name"]': "Example News"
    },
    jsonLd: [{ "@type": "NewsArticle", articleBody: "構造化データの本文" }]
  }));
  assert.deepEqual(metadata, {
    title: "OG title",
    description: "記事の説明",
    siteName: "Example News",
    articleBody: "構造化データの本文"
  });
});

test("記事型でないJSON-LDと壊れた値は本文候補へ使わない", () => {
  const metadata = extractMetadata(metadataDocument({
    title: "ページ",
    jsonLd: [{ "@type": "WebSite", articleBody: "ナビゲーション文" }]
  }));
  assert.equal(metadata.title, "ページ");
  assert.equal(metadata.articleBody, "");
});
