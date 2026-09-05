"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  GEOMETRY_BLOCK_VERSION,
  GEOMETRY_BLOCK_LIMITS,
  createGeometryBlock,
  insertGeometryBlock,
  normalizeGeometryBlock,
  parseGeometryBlockLine,
  replaceGeometryBlock,
  serializeGeometryBlock,
  splitGeometryBlocks,
  validateGeometryBlock
} = require("./geometry-block-utils.js");

function utf8ToHex(value) {
  return Array.from(new TextEncoder().encode(String(value)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function markerForJson(value) {
  return `<!-- memo-nexus:geometry-block:${utf8ToHex(value)} -->`;
}

function geometryBlocks(markdown) {
  return splitGeometryBlocks(markdown).filter((segment) => segment.type === "geometry");
}

function segmentsToMarkdown(segments) {
  return segments.map((segment) => segment.type === "text" ? segment.text : segment.raw).join("");
}

function triangle(overrides = {}) {
  return normalizeGeometryBlock({
    type: "geometry",
    version: 1,
    id: "triangle-1",
    caption: "三角形ABC",
    viewBox: { x: -10, y: -10, width: 120, height: 100 },
    points: [
      { id: "a", x: 10, y: 80 },
      { id: "b", x: 50, y: 10 },
      { id: "c", x: 90, y: 80 }
    ],
    objects: [
      { id: "ab", type: "segment", role: "edge", pointIds: ["a", "b"] },
      { id: "bc", type: "segment", role: "edge", pointIds: ["b", "c"] },
      { id: "ca", type: "segment", role: "edge", pointIds: ["c", "a"] },
      { id: "face", type: "polygon", pointIds: ["a", "b", "c"] }
    ],
    annotations: [
      { id: "angle-a", type: "angle", pointIds: ["b", "a", "c"], value: 60, label: "60度" },
      { id: "length-ab", type: "length-label", objectId: "ab", value: 5, label: "5 cm" },
      { id: "vertex-a", type: "vertex-label", pointId: "a", label: "A" },
      { id: "vertex-b", type: "vertex-label", pointId: "b", label: "B" },
      { id: "vertex-c", type: "vertex-label", pointId: "c", label: "C" },
      { id: "fill", type: "fill-region", objectId: "face", fill: "accent" }
    ],
    ...overrides
  });
}

test("空の幾何学ブロックを一意IDと既定viewBox付きで作成できる", () => {
  const first = createGeometryBlock();
  const second = createGeometryBlock();
  assert.equal(first.type, "geometry");
  assert.equal(first.version, GEOMETRY_BLOCK_VERSION);
  assert.ok(first.id);
  assert.notEqual(first.id, second.id);
  assert.equal(first.caption, "");
  assert.deepEqual(first.viewBox, { x: 0, y: 0, width: 100, height: 100 });
  assert.deepEqual(first.points, []);
  assert.deepEqual(first.objects, []);
  assert.deepEqual(first.annotations, []);
  assert.equal(validateGeometryBlock(first).valid, true);
});

test("正常なバージョン1データを既定値と文字列を補って正規化する", () => {
  const normalized = normalizeGeometryBlock({ id: " geometry-1 ", caption: 123 });
  assert.deepEqual(normalized, {
    type: "geometry",
    version: 1,
    id: "geometry-1",
    caption: "123",
    viewBox: { x: 0, y: 0, width: 100, height: 100 },
    points: [],
    objects: [],
    annotations: []
  });
});

test("日本語の頂点名、キャプション、長さラベルを完全に往復する", () => {
  const source = triangle({
    caption: "日本語の図形：三角形",
    points: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 0 },
      { id: "c", x: 20, y: 0 }
    ],
    objects: [{ id: "ab", type: "segment", pointIds: ["a", "b"] }, { id: "bc", type: "segment", pointIds: ["b", "c"] }],
    annotations: [
      { id: "length", type: "length-label", objectId: "ab", label: "長さ五センチ" },
      { id: "vertex-a", type: "vertex-label", pointId: "a", label: "頂点あ" },
      { id: "vertex-b", type: "vertex-label", pointId: "b", label: "頂点い" },
      { id: "vertex-c", type: "vertex-label", pointId: "c", label: "頂点う" }
    ]
  });
  const restored = parseGeometryBlockLine(serializeGeometryBlock(source));
  assert.deepEqual(restored, source);
  assert.equal(restored.caption, "日本語の図形：三角形");
  assert.equal(restored.annotations[0].label, "長さ五センチ");
  assert.equal("label" in restored.points[0], false);
});

test("点IDを参照する線分と点・図形を参照する注釈を往復する", () => {
  const source = triangle();
  const restored = parseGeometryBlockLine(serializeGeometryBlock(source));
  assert.deepEqual(restored.objects[0].pointIds, ["a", "b"]);
  assert.deepEqual(restored.annotations, source.annotations);
});

test("予定する図形・注釈の全種類を点IDまたは図形ID参照で表現できる", () => {
  const block = normalizeGeometryBlock({
    id: "all-types",
    points: [
      { id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0 },
      { id: "c", x: 10, y: 10 }, { id: "d", x: 0, y: 10 }
    ],
    objects: [
      { id: "edge", type: "segment", role: "edge", pointIds: ["a", "b"] },
      { id: "diagonal", type: "segment", role: "diagonal", pointIds: ["a", "c"] },
      { id: "helper", type: "segment", role: "auxiliary", pointIds: ["b", "d"] },
      { id: "polygon", type: "polygon", pointIds: ["a", "b", "c", "d"] },
      { id: "region", type: "region", pointIds: ["a", "b", "c"] }
    ],
    annotations: [
      { id: "right", type: "right-angle", pointIds: ["a", "b", "c"] },
      { id: "angle", type: "angle", pointIds: ["a", "b", "c"], value: 90, label: "直角" },
      { id: "equal", type: "equal-length", objectIds: ["edge", "diagonal"], mark: 1 },
      { id: "parallel", type: "parallel", objectIds: ["edge", "helper"], mark: 2 },
      { id: "length", type: "length-label", objectId: "edge", value: 10, label: "10 cm" },
      { id: "vertex", type: "vertex-label", pointId: "a", label: "A" },
      { id: "fill", type: "fill-region", objectId: "region", fill: "secondary" }
    ]
  });
  assert.deepEqual(parseGeometryBlockLine(serializeGeometryBlock(block)), block);
});

test("線分のedgeIndex 1と半径0の円を外部データとして拒否する", () => {
  const valid = triangle();
  const invalidSegmentLabel = {
    ...valid,
    annotations: [{ id: "invalid-length", type: "length-label", objectId: "ab", edgeIndex: 1, label: "表示されない" }]
  };
  assert.equal(validateGeometryBlock(invalidSegmentLabel).valid, false);
  assert.throws(() => serializeGeometryBlock(invalidSegmentLabel), /edgeIndex/);
  assert.equal(parseGeometryBlockLine(markerForJson(JSON.stringify(invalidSegmentLabel))), null);
  assert.throws(() => normalizeGeometryBlock({
    id: "zero-radius-circle",
    points: [{ id: "center", x: 30, y: 30 }, { id: "radius", x: 30, y: 30 }],
    objects: [{ id: "circle", type: "circle", pointIds: ["center", "radius"] }]
  }), /中心と異なる位置/);
});

test("右角・角注釈のpointIds順序を始点・頂点・終点で保持する", () => {
  const block = normalizeGeometryBlock({
    id: "angles",
    points: [
      { id: "origin", x: 0, y: 0 },
      { id: "vertex", x: 10, y: 0 },
      { id: "end", x: 10, y: 10 }
    ],
    objects: [
      { id: "origin-vertex", type: "segment", pointIds: ["origin", "vertex"] },
      { id: "vertex-end", type: "segment", pointIds: ["vertex", "end"] }
    ],
    annotations: [
      { id: "right-angle", type: "right-angle", pointIds: ["origin", "vertex", "end"] },
      { id: "angle", type: "angle", pointIds: ["origin", "vertex", "end"], value: 90, label: "90度" },
      { id: "vertex-origin", type: "vertex-label", pointId: "origin", label: "O" },
      { id: "vertex-vertex", type: "vertex-label", pointId: "vertex", label: "V" },
      { id: "vertex-end", type: "vertex-label", pointId: "end", label: "E" }
    ]
  });
  const restored = parseGeometryBlockLine(serializeGeometryBlock(block));
  assert.deepEqual(restored.annotations[0].pointIds, ["origin", "vertex", "end"]);
  assert.deepEqual(restored.annotations[1].pointIds, ["origin", "vertex", "end"]);
});

test("直角注釈はsize未指定時に既定値6を補完する", () => {
  const block = normalizeGeometryBlock({
    id: "right-angle-default-size",
    points: [
      { id: "origin", x: 0, y: 0 },
      { id: "vertex", x: 10, y: 10 },
      { id: "end", x: 10, y: 20 }
    ],
    objects: [
      { id: "origin-vertex", type: "segment", pointIds: ["origin", "vertex"] },
      { id: "vertex-end", type: "segment", pointIds: ["vertex", "end"] }
    ],
    annotations: [
      { id: "right-angle", type: "right-angle", pointIds: ["origin", "vertex", "end"] }
    ]
  });
  const rightAngle = block.annotations.find((annotation) => annotation.type === "right-angle");
  assert.equal(rightAngle.size, 6, "直角注釈の既定表示サイズは6");
});

test("直角注釈はsize指定値を保持して正規化する", () => {
  const block = normalizeGeometryBlock({
    id: "right-angle-explicit-size",
    points: [
      { id: "origin", x: 0, y: 0 },
      { id: "vertex", x: 10, y: 10 },
      { id: "end", x: 10, y: 20 }
    ],
    objects: [
      { id: "origin-vertex", type: "segment", pointIds: ["origin", "vertex"] },
      { id: "vertex-end", type: "segment", pointIds: ["vertex", "end"] }
    ],
    annotations: [
      { id: "right-angle", type: "right-angle", pointIds: ["origin", "vertex", "end"], size: 9 }
    ]
  });
  const rightAngle = block.annotations.find((annotation) => annotation.type === "right-angle");
  assert.equal(rightAngle.size, 9, "直角注釈の指定sizeは保持される");
});

test("重複IDは正規化時に安全に拒否する", () => {
  assert.throws(() => normalizeGeometryBlock({
    id: "duplicates",
    points: [{ id: "p", x: 0, y: 0 }, { id: "p", x: 1, y: 1 }]
  }), /重複ID/);
  assert.throws(() => normalizeGeometryBlock({
    id: "duplicates",
    points: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 1 }],
    objects: [
      { id: "line", type: "segment", pointIds: ["a", "b"] },
      { id: "line", type: "segment", pointIds: ["b", "a"] }
    ]
  }), /重複ID/);
  assert.throws(() => normalizeGeometryBlock({
    ...triangle(),
    annotations: [
      { id: "label", type: "vertex-label", pointId: "a", label: "A" },
      { id: "label", type: "vertex-label", pointId: "b", label: "B" }
    ]
  }), /重複ID/);
});

test("存在しない点IDと図形IDへの参照を検出する", () => {
  assert.throws(() => normalizeGeometryBlock({
    id: "missing-point",
    points: [{ id: "a", x: 0, y: 0 }],
    objects: [{ id: "line", type: "segment", pointIds: ["a", "missing"] }]
  }), /参照先が存在しません/);
  assert.throws(() => normalizeGeometryBlock({
    id: "missing-object",
    annotations: [{ id: "length", type: "length-label", objectId: "missing", label: "1" }]
  }), /参照先が存在しません/);
});

test("不正な16進数を安全に拒否する", () => {
  assert.equal(parseGeometryBlockLine("<!-- memo-nexus:geometry-block:xyz -->"), null);
  assert.equal(parseGeometryBlockLine("<!-- memo-nexus:geometry-block:abc -->"), null);
});

test("壊れたJSONを安全に拒否する", () => {
  assert.equal(parseGeometryBlockLine(markerForJson('{"type":"geometry"')), null);
});

test("NaNとInfinity、および正でないviewBox寸法を拒否する", () => {
  assert.throws(() => normalizeGeometryBlock({ id: "nan", points: [{ id: "p", x: NaN, y: 0 }] }), /有限の数値/);
  assert.throws(() => normalizeGeometryBlock({ id: "infinity", viewBox: { width: Infinity } }), /有限の数値/);
  assert.throws(() => normalizeGeometryBlock({ id: "zero", viewBox: { width: 0, height: 100 } }), /正の数/);
  assert.throws(() => normalizeGeometryBlock({ id: "null-width", viewBox: { width: null } }), /有限の数値/);
  assert.throws(() => normalizeGeometryBlock({ id: "null-arrays", points: null }), /配列/);
  assert.throws(() => normalizeGeometryBlock({ id: "invalid-viewbox", viewBox: "0 0 100 100" }), /オブジェクト/);
});

test("未対応の将来バージョンを変換せず本文中の元文字列として残す", () => {
  const future = markerForJson(JSON.stringify({ ...createGeometryBlock("future"), version: 2 }));
  assert.equal(parseGeometryBlockLine(future), null);
  assert.throws(() => normalizeGeometryBlock({ ...createGeometryBlock("future"), version: 2 }), /対応していません/);
  assert.deepEqual(splitGeometryBlocks(`前\n${future}\n後`), [{
    type: "text", text: `前\n${future}\n後`, start: 0, end: `前\n${future}\n後`.length
  }]);
});

test("件数・文字数・デコード後JSONサイズの上限超過を拒否する", () => {
  assert.throws(() => normalizeGeometryBlock({
    id: "too-many-points",
    points: Array.from({ length: GEOMETRY_BLOCK_LIMITS.points + 1 }, (_, index) => ({ id: `p-${index}`, x: index, y: 0 }))
  }), /件数が上限/);
  assert.throws(() => normalizeGeometryBlock({
    id: "long-caption", caption: "あ".repeat(GEOMETRY_BLOCK_LIMITS.captionChars + 1)
  }), /長すぎます/);
  const oversizedHex = "00".repeat(GEOMETRY_BLOCK_LIMITS.jsonBytes + 1);
  assert.equal(parseGeometryBlockLine(`<!-- memo-nexus:geometry-block:${oversizedHex} -->`), null);
});

test("バッククォートとチルダのコードフェンス内では記法例を認識しない", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("code"));
  const markdown = ["```markdown", marker, "```", "~~~text", marker, "~~~"].join("\n");
  assert.equal(geometryBlocks(markdown).length, 0);
  assert.equal(segmentsToMarkdown(splitGeometryBlocks(markdown)), markdown);
});

test("リスト内のバッククォート・チルダコードフェンスでは記法例を認識しない", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("list-fence"));
  const cases = [
    ["箇条書きバッククォート", ["- 図形", "    ```markdown", `    ${marker}`, "    ```"]],
    ["箇条書きチルダ", ["- 図形", "    ~~~markdown", `    ${marker}`, "    ~~~"]],
    ["番号付きバッククォート", ["1. 図形", "    ```markdown", `    ${marker}`, "    ```"]],
    ["番号付きチルダ", ["1. 図形", "    ~~~markdown", `    ${marker}`, "    ~~~"]],
    ["入れ子バッククォート", ["- 親", "  - 子", "      ```markdown", `      ${marker}`, "      ```"]],
    ["入れ子チルダ", ["- 親", "  - 子", "      ~~~markdown", `      ${marker}`, "      ~~~"]],
    ["空行を挟んだリスト継続", ["- 図形", "", "    ```markdown", `    ${marker}`, "    ```"]],
    ["スペースとタブが混在", ["- 図形", "  \t ```markdown", `  \t ${marker}`, "  \t ```"]]
  ];
  cases.forEach(([name, lines]) => {
    const markdown = lines.join("\n");
    assert.equal(geometryBlocks(markdown).length, 0, name);
    assert.equal(segmentsToMarkdown(splitGeometryBlocks(markdown)), markdown, name);
  });
});

test("リスト基準から4列以上深い終了フェンス風の行ではコードフェンスを閉じない", () => {
  const first = serializeGeometryBlock(createGeometryBlock("still-fenced-first"));
  const second = serializeGeometryBlock(createGeometryBlock("still-fenced-second"));
  const markdown = [
    "- 図形", "    ```markdown", `    ${first}`, "      ```", `    ${second}`, "    ```"
  ].join("\n");
  assert.equal(geometryBlocks(markdown).length, 0);
  assert.equal(segmentsToMarkdown(splitGeometryBlocks(markdown)), markdown);
});

test("コードフェンス外のリスト子要素マーカーは引き続き認識する", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("list-geometry"));
  const cases = [
    ["箇条書き", ["- 図形", `    ${marker}`]],
    ["番号付き", ["1. 図形", `    ${marker}`]],
    ["入れ子", ["- 親", "  - 子", `      ${marker}`]],
    ["空行を挟んだリスト継続", ["- 図形", "", `    ${marker}`]]
  ];
  cases.forEach(([name, lines]) => {
    const markdown = lines.join("\n");
    const [block] = geometryBlocks(markdown);
    assert.equal(block.geometry.id, "list-geometry", name);
    assert.equal(markdown.slice(block.start, block.end), block.raw, name);
    assert.equal(segmentsToMarkdown(splitGeometryBlocks(markdown)), markdown, name);
  });
});

test("4スペースインデントコード内のマーカーを認識しない", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("indent-space"));
  const markdown = ["通常行", `    ${marker}`, "通常行"].join("\n");
  assert.equal(geometryBlocks(markdown).length, 0);
  assert.equal(segmentsToMarkdown(splitGeometryBlocks(markdown)), markdown);
});

test("タブインデントコード内のマーカーを認識しない", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("indent-tab"));
  const markdown = ["通常行", `\t${marker}`, "通常行"].join("\n");
  assert.equal(geometryBlocks(markdown).length, 0);
  assert.equal(segmentsToMarkdown(splitGeometryBlocks(markdown)), markdown);
});

test("半角スペースとタブが混在するインデントコード内のマーカーを認識しない", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("indent-mixed"));
  const indents = [" \t", "  \t", "   \t", " \t\t", "  \t \t"];
  const markdown = indents.map((indent) => `${indent}${marker}`).join("\n");
  assert.equal(geometryBlocks(markdown).length, 0);
  assert.equal(segmentsToMarkdown(splitGeometryBlocks(markdown)), markdown);
});

test("インデントなしと1～3スペースの行は通常の幾何学ブロックとして認識する", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("indent-short"));
  const markdown = [marker, ` ${marker}`, `  ${marker}`, `   ${marker}`].join("\n");
  assert.equal(geometryBlocks(markdown).length, 4);
  assert.equal(segmentsToMarkdown(splitGeometryBlocks(markdown)), markdown);
});

test("リスト項目の子要素として配置したマーカーを幾何学ブロックとして認識する", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("list-child"));
  const markdown = ["- 図形", `    ${marker}`, "    説明"].join("\n");
  const [block] = geometryBlocks(markdown);
  assert.equal(block.geometry.id, "list-child");
  assert.equal(markdown.slice(block.start, block.end), block.raw);
  assert.equal(block.raw, `    ${marker}`);
  assert.equal(segmentsToMarkdown(splitGeometryBlocks(markdown)), markdown);
});

test("空行を挟んだ明確なリスト継続内のマーカーを幾何学ブロックとして認識する", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("list-child-after-blank"));
  const markdown = ["- 図形", "", `    ${marker}`, "", "    説明"].join("\r\n");
  const [block] = geometryBlocks(markdown);
  assert.equal(block.geometry.id, "list-child-after-blank");
  assert.equal(markdown.slice(block.start, block.end), block.raw);
  assert.equal(segmentsToMarkdown(splitGeometryBlocks(markdown)), markdown);
});

test("リストの基準インデントに加えて4列字下げしたマーカーはコードとして扱う", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("list-code"));
  const markdown = ["- 図形", `      ${marker}`].join("\n");
  assert.equal(geometryBlocks(markdown).length, 0);
  assert.equal(segmentsToMarkdown(splitGeometryBlocks(markdown)), markdown);
});

test("通常テキストと複数ブロックを順序・位置・raw付きで分割する", () => {
  const first = serializeGeometryBlock(createGeometryBlock("first"));
  const second = serializeGeometryBlock(createGeometryBlock("second"));
  const markdown = `前\r\n${first}\r\n中\n${second}\n後`;
  const segments = splitGeometryBlocks(markdown);
  const blocks = segments.filter((segment) => segment.type === "geometry");
  assert.deepEqual(blocks.map((block) => block.geometry.id), ["first", "second"]);
  assert.deepEqual(blocks.map((block) => block.raw), [first, second]);
  blocks.forEach((block) => assert.equal(markdown.slice(block.start, block.end), block.raw));
  assert.equal(segmentsToMarkdown(segments), markdown);
  assert.deepEqual(segments.map((segment) => segment.type), ["text", "geometry", "text", "geometry", "text"]);
});

test("LF本文でstart/end/rawがslice一致する", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("lf"));
  const source = `前\n${marker}\n後`;
  const [block] = geometryBlocks(source);
  assert.equal(block.start, 2);
  assert.equal(source.slice(block.start, block.end), block.raw);
  assert.equal(block.end, block.start + block.raw.length);
});

test("CRLF本文でstart/end/rawがslice一致する", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("crlf"));
  const source = `前\r\n${marker}\r\n後`;
  const [block] = geometryBlocks(source);
  assert.equal(block.start, 3);
  assert.equal(source.slice(block.start, block.end), block.raw);
  assert.equal(block.end, block.start + block.raw.length);
});

test("複数幾何学ブロックを含む本文をセグメントから完全再構築できる", () => {
  const first = serializeGeometryBlock(createGeometryBlock("first"));
  const second = serializeGeometryBlock(createGeometryBlock("second"));
  const third = serializeGeometryBlock(createGeometryBlock("third"));
  const source = `先頭\n${first}\n中間\n${second}\r\n${third}\n末尾`;
  const segments = splitGeometryBlocks(source);
  const blocks = segments.filter((segment) => segment.type === "geometry");
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((block) => block.geometry.id), ["first", "second", "third"]);
  assert.equal(segmentsToMarkdown(segments), source);
});

test("本文先頭・中間・末尾の各ブロック位置が正しい", () => {
  const first = serializeGeometryBlock(createGeometryBlock("head"));
  const middle = serializeGeometryBlock(createGeometryBlock("middle"));
  const last = serializeGeometryBlock(createGeometryBlock("tail"));
  const source = `${first}\n前\n${middle}\n後\n${last}`;
  const blocks = geometryBlocks(source);
  const expectedStarts = [source.indexOf(first), source.indexOf(middle), source.indexOf(last)];
  const expectedEnds = [
    expectedStarts[0] + first.length,
    expectedStarts[1] + middle.length,
    expectedStarts[2] + last.length
  ];
  assert.deepEqual(blocks.map((block) => block.start), expectedStarts);
  assert.deepEqual(blocks.map((block) => block.end), expectedEnds);
  blocks.forEach((block) => assert.equal(source.slice(block.start, block.end), block.raw));
  assert.equal(blocks.every((block) => block.end === block.start + block.raw.length), true);
});

test("前後に空白を持つマーカーでも位置が正しい", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("space"));
  const source = `行前\n  ${marker}  \n行後`;
  const block = geometryBlocks(source)[0];
  assert.equal(block.start, source.indexOf(`  ${marker}  `));
  assert.equal(block.end, block.start + `  ${marker}  `.length);
  assert.equal(source.slice(block.start, block.end), block.raw);
  assert.equal(block.raw.startsWith("  "), true);
  assert.equal(block.raw.endsWith("  "), true);
  assert.equal(segmentsToMarkdown(splitGeometryBlocks(source)), source);
});

test("画像ブロック内・隣接する表コメント・通常HTMLコメント・不正記法を誤認しない", () => {
  const marker = serializeGeometryBlock(createGeometryBlock("real"));
  const markdown = [
    "<!-- memo-nexus:image-block -->", marker, "<!-- /memo-nexus:image-block -->",
    "<!-- memo-nexus:table-block:abcd -->", "<!-- 通常コメント -->",
    "<!-- memo-nexus:geometry-block:not-hex -->", marker
  ].join("\n");
  assert.deepEqual(geometryBlocks(markdown).map((block) => block.geometry.id), ["real"]);
});

test("本文の先頭・中間・末尾へ前後の文字を壊さず挿入する", () => {
  const geometry = createGeometryBlock("insert");
  const atStart = insertGeometryBlock("本文", 0, 0, geometry).value;
  const atMiddle = insertGeometryBlock("前XX後", 1, 3, geometry).value;
  const atEnd = insertGeometryBlock("本文", 2, 2, geometry).value;
  assert.match(atStart, /^<!-- memo-nexus:geometry-block:[0-9a-f]+ -->\n本文$/);
  assert.match(atMiddle, /^前\n<!-- memo-nexus:geometry-block:[0-9a-f]+ -->\n後$/);
  assert.match(atEnd, /^本文\n<!-- memo-nexus:geometry-block:[0-9a-f]+ -->$/);
  assert.equal(geometryBlocks(atStart).length, 1);
  assert.equal(geometryBlocks(atMiddle).length, 1);
  assert.equal(geometryBlocks(atEnd).length, 1);
  assert.match(insertGeometryBlock("前\r\n後", 1, 1, geometry).value, /^前\r\n<!-- memo-nexus:geometry-block:[0-9a-f]+ -->\r\n後$/);
});

test("取得後に位置が古くなった対象を誤置換せず、null指定では対象だけ削除する", () => {
  const source = `前\n${serializeGeometryBlock(createGeometryBlock("old"))}\n後`;
  const block = geometryBlocks(source)[0];
  assert.throws(() => replaceGeometryBlock(`追加${source}`, block, createGeometryBlock("new")), /変更されたため/);
  assert.equal(replaceGeometryBlock(source, block, null), "前\n\n後");
});

test("置換時にstart/end/rawの不整合を検出して拒否する", () => {
  const source = `前\n${serializeGeometryBlock(createGeometryBlock("old"))}\n後`;
  const block = geometryBlocks(source)[0];
  assert.throws(() => replaceGeometryBlock(source, { ...block, raw: `${block.raw} ` }, createGeometryBlock("new")), /変更されたため/);
  assert.throws(() => replaceGeometryBlock(source, { ...block, start: block.start + 1, end: block.end + 1 }, createGeometryBlock("new")), /変更されたため/);
  assert.throws(() => replaceGeometryBlock(source, { ...block, end: block.start }, createGeometryBlock("new")), /変更されたため/);
});

test("置換後も前後の改行コードを維持する", () => {
  const source = `前\r\n${serializeGeometryBlock(createGeometryBlock("old"))}\r\n後`;
  const block = geometryBlocks(source)[0];
  const updated = replaceGeometryBlock(source, block, createGeometryBlock("new"));
  const expected = `前\r\n${serializeGeometryBlock(createGeometryBlock("new"))}\r\n後`;
  assert.equal(updated, expected);
});

test("削除時に対象外の改行・本文を変更しない", () => {
  const source = `A\r\n${serializeGeometryBlock(createGeometryBlock("target"))}\r\nB`;
  const block = geometryBlocks(source)[0];
  assert.equal(replaceGeometryBlock(source, block, null), "A\r\n\r\nB");
});

test("V1の点ラベルはpointsから除外し、vertex-label注釈にのみ保持する", () => {
  const block = normalizeGeometryBlock({
    id: "vertex-label-only",
    points: [{ id: "p", x: 1, y: 2, label: "P" }],
    annotations: [{ id: "label", type: "vertex-label", pointId: "p", label: "P" }]
  });
  assert.equal("label" in block.points[0], false);
  const restored = parseGeometryBlockLine(serializeGeometryBlock(block));
  assert.equal("label" in restored.points[0], false);
  assert.equal(restored.annotations[0].label, "P");
});

test("直列化・解析・再直列化の結果が安定する", () => {
  const first = serializeGeometryBlock(triangle());
  const second = serializeGeometryBlock(parseGeometryBlockLine(first));
  assert.equal(second, first);
});

test("未知フィールドを保持せず、許可された型と表示値だけへ正規化する", () => {
  const normalized = normalizeGeometryBlock({
    id: "safe",
    rawHtml: "<svg onload=alert(1)>",
    points: [{ id: "a", x: 0, y: 0, onclick: "alert(1)" }]
  });
  assert.equal("rawHtml" in normalized, false);
  assert.equal("onclick" in normalized.points[0], false);
});
