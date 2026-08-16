const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMemoExportBundle } = require("./attachment-utils.js");
const { buildMarkdownBundleImport, parseStoredZipEntries } = require("./markdown-bundle-utils.js");
const { parseLocalNote, serializeLocalNote } = require("./local-markdown.js");

function u16(value) { return Uint8Array.from([value & 255, value >>> 8 & 255]); }
function u32(value) { return Uint8Array.from([value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255]); }
function concat(parts) { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; parts.forEach((part) => { result.set(part, offset); offset += part.length; }); return result; }
function storedEntry(name, data) {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const body = typeof data === "string" ? encoder.encode(data) : data;
  return concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(0), u32(body.length), u32(body.length), u16(nameBytes.length), u16(0), nameBytes, body]);
}

test("Memo-Nexusの無圧縮ZIPエントリを安全に読み取る", () => {
  const zip = concat([storedEntry("記事/記事.md", "本文"), storedEntry("記事/attachments/photo.png", Uint8Array.from([1, 2, 3]))]);
  const entries = parseStoredZipEntries(zip);
  assert.deepEqual(entries.map((entry) => entry.name), ["記事/記事.md", "記事/attachments/photo.png"]);
  assert.throws(() => parseStoredZipEntries(storedEntry("../outside.md", "x")), /安全でないパス/);
});

test("画像ブロックを書き出して再取り込みしてもローカル参照と位置を維持する", async () => {
  const bundle = buildMemoExportBundle({
    markdownPath: "記事.md",
    markdownContent: "前\n\n<!-- memo-nexus:image-block -->\n![図](attachment://image-id)\n<!-- /memo-nexus:image-block -->\n\n後",
    attachments: [{ id: "image-id", kind: "image", fileName: "図.png", blob: new Blob(["png"], { type: "image/png" }) }]
  });
  const entries = await Promise.all(bundle.files.map(async (file) => ({
    name: file.name,
    data: typeof file.content === "string" ? new TextEncoder().encode(file.content) : new Uint8Array(await file.content.arrayBuffer())
  })));
  const [plan] = buildMarkdownBundleImport(entries, () => "restored-image-id");
  assert.equal(plan.attachments.length, 1);
  assert.equal(plan.attachments[0].mimeType, "image/png");
  assert.match(plan.body, /前[\s\S]*attachment:\/\/restored-image-id[\s\S]*後/);
  assert.doesNotMatch(plan.body, /<attachments\//);
});

test("通常Markdown ZIPのfront matterタグを取り込み経路へ渡せる", () => {
  const markdown = serializeLocalNote({ id: "source", title: "タグ付き", tags: ["AI", "資料"] }, "本文");
  const [plan] = buildMarkdownBundleImport([{ name: "タグ付き.md", data: new TextEncoder().encode(markdown) }]);
  const parsed = parseLocalNote(plan.body);
  assert.equal(parsed.metadata.title, "タグ付き");
  assert.deepEqual(parsed.metadata.tags, ["ai", "資料"]);
  assert.equal(parsed.body, "本文");
});
