const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sourceDisplayLabel, normalizeSource, serializeSources, parseSourceDocument, parseSourceMarker, sourceSelectionFromRaw, insertSourceCitation, withSources, safeSourceUrl,
  extractCitations, referencedSources
} = require("./source-utils.js");
const { buildMarkdownBundleImport } = require("./markdown-bundle-utils.js");
const { serializeImageBlock, splitImageBlocks } = require("./attachment-utils.js");

const first = { id: "source-a", title: "<script>資料</script>\n続き", author: "<b>著者</b>",
  publisher: "<img src=x onerror=alert(1)>出版社", date: "2026-10-01", url: `https://example.org/資料?x=${"長".repeat(8000)}`,
  accessedAt: "2026-10-01", page: "12", sourceType: "primary" };
const second = { id: "source-b", title: "二番目" };

test("Source marker roundtrip preserves UTF-8, newlines, long URL, body, and stable IDs", () => {
  const body = "本文末尾  \n\n[@source-a]";
  const saved = withSources(body, [first, second]);
  const parsed = parseSourceDocument(saved);
  assert.equal(parsed.body, body);
  assert.deepEqual(parsed.sources[0], first);
  assert.equal(parsed.sources[1].id, second.id);
  assert.equal(parsed.sources[1].author, "");
  assert.equal(withSources(saved, parsed.sources), saved);
  assert.equal(parseSourceDocument(withSources("行1\r\n行2\r\n", [first])).body, "行1\r\n行2\r\n");
  assert.equal(parseSourceDocument(`${saved}\n追記`).body, `${body}\n追記`);
});

test("invalid markers remain visible and invalid records and duplicate IDs are ignored", () => {
  const broken = "本文\n<!-- memo-nexus:sources-v1:zz -->";
  assert.deepEqual(parseSourceDocument(broken), { body: broken, sources: [] });
  assert.equal(parseSourceMarker("<!-- memo-nexus:sources-v1:ff -->"), null);
  assert.equal(normalizeSource({ id: "bad id" }), null);
  assert.deepEqual(parseSourceDocument(withSources("本文", [null, [], { id: "bad id" }, first, { ...first, title: "重複" }])).sources, [first]);
});

test("only valid http and https URLs become links", () => {
  assert.match(safeSourceUrl("https://example.org/path"), /^https:/);
  assert.match(safeSourceUrl("http://example.org/path"), /^http:/);
  for (const value of ["javascript:alert(1)", "data:text/html,hi", "https://", "not-a-url"]) {
    assert.equal(safeSourceUrl(value), "");
  }
});

test("Citation order, repetition, missing IDs, code and deletion references", () => {
  const body = "[@source-b] `[@source-a]` [@missing]\n```js\n[@source-a]\n```\n[@source-a] [@source-b]";
  assert.deepEqual(extractCitations(body), ["source-b", "missing", "source-a", "source-b"]);
  assert.deepEqual(referencedSources(body, [first, second]).map((source) => source.id), ["source-b", "source-a"]);
  assert.equal(extractCitations("文章 [@source-a] もう一度 [@source-a]").length, 2);
  assert.equal(extractCitations("`[@source-a]`\n```\n[@source-a]\n```" ).length, 0);
});

test("raw editor offsets after a Source marker map to body offsets without corrupting the marker", () => {
  const raw = `${withSources("本文", [first])}\n追記`;
  const rawEnd = raw.length;
  const selection = sourceSelectionFromRaw(raw, rawEnd, rawEnd);
  assert.deepEqual(selection, { start: "本文\n追記".length, end: "本文\n追記".length });
  const inserted = insertSourceCitation(raw, first.id, selection);
  assert.equal(parseSourceDocument(inserted.body).body, "本文\n追記[@source-a]");
  assert.deepEqual(parseSourceDocument(inserted.body).sources[0], first);
  assert.match(inserted.body, /^<!-- memo-nexus:sources-v1:[0-9a-f]+ -->\n/);
  assert.equal(inserted.body.slice(0, inserted.caret), inserted.body.slice(0, inserted.body.indexOf("\n") + 1) + "本文\n追記[@source-a]");
  assert.equal(inserted.caret, inserted.body.length);
});

test("selection before and across a Source marker replaces only logical body text", () => {
  const raw = `${withSources("前の文字", [first])}\n後の文字`;
  const start = raw.indexOf("文字");
  const end = raw.lastIndexOf("文字") + "文字".length;
  const selection = sourceSelectionFromRaw(raw, start, end);
  assert.deepEqual(selection, { start: 2, end: "前の文字\n後の文字".length });
  const inserted = insertSourceCitation(raw, first.id, selection);
  assert.equal(parseSourceDocument(inserted.body).body, "前の[@source-a]");
  assert.equal(parseSourceDocument(inserted.body).sources[0].id, first.id);
});

test("Markdown ZIP import keeps Source marker and Figure metadata", () => {
  const body = withSources(`${serializeImageBlock([{ id: "old", figureMetadata: { caption: "旧図", sourceType: "primary" } }])}\n[@source-a]`, [first]);
  const imported = buildMarkdownBundleImport([{ name: "memo.md", data: new TextEncoder().encode(body) }], () => "unused")[0];
  assert.deepEqual(parseSourceDocument(imported.body).sources[0], first);
  assert.equal(splitImageBlocks(imported.body).find((block) => block.type === "image").images[0].figureMetadata.caption, "旧図");
});

test("Sourceの表示ラベルはtitle・author・url・idの順にfallbackする", () => {
  const values = { id: "source-test", title: "資料名", author: "著者のみ", url: "https://example.org/label-test" };
  assert.equal(sourceDisplayLabel(values), values.title);
  assert.equal(sourceDisplayLabel({ ...values, title: "" }), values.author);
  assert.equal(sourceDisplayLabel({ ...values, title: "", author: "" }), values.url);
  assert.equal(sourceDisplayLabel({ ...values, title: "", author: "", url: "" }), values.id);
  const cases = [
    [{ ...values, title: "   " }, values.author],
    [{ ...values, title: "\n\t ", author: "" }, values.url],
    [{ ...values, title: "　" }, values.author],
    [{ ...values, title: " ", author: "\t", url: "　\n" }, values.id],
    [{ ...values, title: "", author: "　\t", url: "" }, values.id],
    [{ ...values, title: "  資料名　" }, "  資料名　"],
    [{ ...values, title: " ", author: " 著者　" }, " 著者　"]
  ];
  for (const [source, expected] of cases) {
    const original = structuredClone(source);
    const stored = serializeSources([source]);
    assert.equal(sourceDisplayLabel(source), expected);
    assert.deepEqual(source, original, "表示判定はSource値を書き換えない");
    assert.equal(serializeSources([source]), stored);
    assert.deepEqual(parseSourceMarker(stored), [normalizeSource(original)]);
  }
});
