"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");

test("Mermaid描画はプレビュー世代で失効管理し、全処理をキューで直列化する", () => {
  assert.match(app, /let mermaidRenderGeneration = 0;/);
  assert.match(app, /let mermaidRenderQueue = Promise\.resolve\(\);/);
  assert.match(app, /const renderGeneration = \+\+mermaidRenderGeneration;/);
  assert.match(app, /mermaidRenderQueue\.then\(async \(\) =>/);
  assert.match(app, /isCurrentMermaidPreview\(previewRoot, renderGeneration\)/);
});

test("同じプレビューの正常なMermaidノードは1回のrunへまとめて渡す", () => {
  assert.match(app, /const validDiagrams = \[\];/);
  assert.match(app, /await window\.mermaid\.run\(\{ nodes: validDiagrams, suppressErrors: true \}\);/);
  assert.doesNotMatch(app, /diagrams\.forEach\(\(diagram\) => renderMermaidDiagram/);
});

test("Mermaidはブロック単位で検証し、失敗したブロックだけエラー表示する", () => {
  assert.match(app, /await window\.mermaid\.parse\(source, \{ suppressErrors: true \}\)/);
  assert.match(app, /showMermaidError\(diagram\.closest\("\.mermaid-block"\)\)/);
  assert.match(app, /if \(diagram\) diagram\.hidden = true;/);
  assert.match(app, /message\.textContent = "Mermaid構文エラー";/);
});

test("MermaidブロックIDはメモとコードブロック番号から安定して生成する", () => {
  assert.match(app, /stableMermaidIdPart\(noteId\)/);
  assert.match(app, /mermaid-diagram-\$\{stableMermaidIdPart\(noteId\)\}-\$\{index\}/);
});

test("隣接するコードフェンスの分割は空行を要求しない", () => {
  const functionStart = app.indexOf("function splitFencedBlocks(body)");
  const functionEnd = app.indexOf("\nfunction renderTextBlock", functionStart);
  const source = app.slice(functionStart, functionEnd);
  const splitFencedBlocks = Function(`${source}; return splitFencedBlocks;`)();
  const body = [
    "```mermaid", "classDiagram", "class Memo", "```",
    "```mermaid", "stateDiagram-v2", "[*] --> Saved", "```",
    "```mermaid", "sequenceDiagram", "A->>B: save", "```",
    "```mermaid", "flowchart LR", "A --> B", "```"
  ].join("\n");

  const blocks = splitFencedBlocks(body);
  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks.map((block) => block.language), ["mermaid", "mermaid", "mermaid", "mermaid"]);
  assert.deepEqual(blocks.map((block) => block.code.split("\n")[0]), [
    "classDiagram", "stateDiagram-v2", "sequenceDiagram", "flowchart LR"
  ]);
});
