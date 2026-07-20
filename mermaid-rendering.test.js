"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");
const indexHtml = fs.readFileSync("index.html", "utf8");

function functionSource(name, nextName) {
  const asyncStart = app.indexOf(`async function ${name}`);
  const start = asyncStart === -1 ? app.indexOf(`function ${name}`) : asyncStart;
  const asyncEnd = app.indexOf(`\nasync function ${nextName}`, start);
  const syncEnd = app.indexOf(`\nfunction ${nextName}`, start);
  const end = asyncEnd === -1 ? syncEnd : (syncEnd === -1 ? asyncEnd : Math.min(asyncEnd, syncEnd));
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return app.slice(start, end);
}

const renderMermaidGeneration = Function(
  `${functionSource("renderMermaidGeneration", "createMermaidRenderHost")}; return renderMermaidGeneration;`
)();

const mermaidDiagramDomId = Function(
  `${functionSource("mermaidDiagramDomId", "stableMermaidIdPart")}
   ${functionSource("stableMermaidIdPart", "renderMermaidDiagrams")}
   return mermaidDiagramDomId;`
)();

class FakeDiagram {
  constructor(id, source) {
    this.id = id;
    this.source = source;
    this.svg = null;
    this.block = null;
  }

  get textContent() {
    return this.svg ? this.svg.textContent : this.source;
  }

  set innerHTML(value) {
    if (!value) {
      this.svg = null;
      return;
    }
    const id = value.match(/<svg id="([^"]+)"/)?.[1] || "";
    const textContent = value.match(/<text>([\s\S]*?)<\/text>/)?.[1] || "";
    this.svg = { id, textContent };
  }

  closest(selector) {
    return selector === ".mermaid-block" ? this.block : null;
  }

  querySelector(selector) {
    return selector === "svg" ? this.svg : null;
  }

  querySelectorAll(selector) {
    return selector === "svg" && this.svg ? [this.svg] : [];
  }
}

class FakeBlock {
  constructor(diagram) {
    this.diagram = diagram;
    this.error = false;
    diagram.block = this;
  }

  querySelectorAll(selector) {
    return selector === "svg" && this.diagram.svg ? [this.diagram.svg] : [];
  }

  isEmpty() {
    return !this.diagram.svg && !this.error;
  }
}

function makePreview(noteId, generation, sources) {
  const diagrams = sources.map((source, index) => (
    new FakeDiagram(mermaidDiagramDomId(noteId, generation, index), source)
  ));
  return {
    generation,
    diagrams,
    blocks: diagrams.map((diagram) => new FakeBlock(diagram))
  };
}

function renderedText(source) {
  if (source.startsWith("classDiagram")) return "Memo Attachment contains";
  if (source.startsWith("stateDiagram-v2")) return "編集中 保存済み";
  if (source.startsWith("sequenceDiagram")) return "ユーザー Memo Nexus メモを保存 保存完了";
  if (source.startsWith("flowchart")) return "条件を満たす? 保存する 見直す";
  return source;
}

function renderArguments({ mermaid, preview, isCurrent, renderIds, errors }) {
  return {
    diagrams: preview.diagrams,
    mermaid,
    isCurrent,
    createRenderHost: (renderId) => ({
      id: `host-${renderId}`,
      removed: false,
      remove() { this.removed = true; }
    }),
    nextRenderId: (index) => {
      const id = `mermaid-svg-g${preview.generation}-b${index}-r${renderIds.length + 1}`;
      renderIds.push(id);
      return id;
    },
    onError: (block) => {
      block.error = true;
      errors.push(block);
    }
  };
}

const diagramSources = [
  "classDiagram\n  class Memo\n  class Attachment",
  "stateDiagram-v2\n  [*] --> 編集中\n  編集中 --> 保存済み",
  "sequenceDiagram\n  participant U as ユーザー\n  participant M as Memo Nexus\n  U->>M: メモを保存\n  M-->>U: 保存完了",
  "flowchart TD\n  A{条件を満たす?} --> B[保存する]\n  A --> C[見直す]"
];

test("描画途中の旧世代を失効し、新世代の4ブロックへ対応SVGだけを反映する", async () => {
  let currentGeneration = 1;
  let releaseOldRender;
  let oldRenderStarted;
  const oldStarted = new Promise((resolve) => { oldRenderStarted = resolve; });
  const oldRelease = new Promise((resolve) => { releaseOldRender = resolve; });
  const renderCalls = [];
  const mermaid = {
    async render(id, source, host) {
      renderCalls.push({ id, source, host });
      if (source.startsWith("classDiagram") && currentGeneration === 1) {
        oldRenderStarted();
        await oldRelease;
      }
      return { svg: `<svg id="${id}"><text>${renderedText(source)}</text></svg>` };
    }
  };

  const oldPreview = makePreview("memo-1", 1, diagramSources);
  const newPreview = makePreview("memo-1", 2, diagramSources);
  const oldRenderIds = [];
  const newRenderIds = [];
  const errors = [];

  const oldTask = renderMermaidGeneration(renderArguments({
    mermaid,
    preview: oldPreview,
    isCurrent: () => currentGeneration === 1,
    renderIds: oldRenderIds,
    errors
  }));

  await oldStarted;
  currentGeneration = 2;
  releaseOldRender();
  await oldTask;

  await renderMermaidGeneration(renderArguments({
    mermaid,
    preview: newPreview,
    isCurrent: () => currentGeneration === 2,
    renderIds: newRenderIds,
    errors
  }));

  assert.equal(oldPreview.diagrams.filter((diagram) => diagram.svg).length, 0);
  assert.equal(renderCalls.filter((call) => call.id.includes("-g1-")).length, 1);
  assert.equal(newPreview.blocks.length, 4);
  assert.deepEqual(newPreview.blocks.map((block) => block.querySelectorAll("svg").length), [1, 1, 1, 1]);
  assert.equal(newPreview.blocks.some((block) => block.isEmpty()), false);
  assert.equal(errors.length, 0);
  assert.deepEqual(newPreview.diagrams.map((diagram) => diagram.svg.textContent), [
    "Memo Attachment contains",
    "編集中 保存済み",
    "ユーザー Memo Nexus メモを保存 保存完了",
    "条件を満たす? 保存する 見直す"
  ]);

  const sequenceText = newPreview.diagrams[2].svg.textContent;
  const flowchartText = newPreview.diagrams[3].svg.textContent;
  assert.match(sequenceText, /ユーザー.*Memo Nexus.*メモを保存.*保存完了/);
  assert.doesNotMatch(sequenceText, /条件を満たす\?|保存する|見直す/);
  assert.match(flowchartText, /条件を満たす\?.*保存する.*見直す/);
  assert.doesNotMatch(flowchartText, /ユーザー|Memo Nexus|メモを保存|保存完了/);

  const oldDomIds = new Set(oldPreview.diagrams.map((diagram) => diagram.id));
  const newDomIds = newPreview.diagrams.map((diagram) => diagram.id);
  assert.equal(newDomIds.some((id) => oldDomIds.has(id)), false);
  assert.equal(new Set([...oldRenderIds, ...newRenderIds]).size, oldRenderIds.length + newRenderIds.length);
});

test("1ブロックの構文エラー後も残りの図を直列描画する", async () => {
  const preview = makePreview("memo-error", 3, diagramSources);
  const calls = [];
  const renderIds = [];
  const errors = [];
  const mermaid = {
    async render(id, source) {
      calls.push(source.split("\n")[0]);
      if (source.startsWith("stateDiagram-v2")) throw new Error("syntax error");
      return { svg: `<svg id="${id}"><text>${renderedText(source)}</text></svg>` };
    }
  };

  await renderMermaidGeneration(renderArguments({
    mermaid,
    preview,
    isCurrent: () => true,
    renderIds,
    errors
  }));

  assert.deepEqual(calls, ["classDiagram", "stateDiagram-v2", "sequenceDiagram", "flowchart TD"]);
  assert.deepEqual(preview.blocks.map((block) => block.querySelectorAll("svg").length), [1, 0, 1, 1]);
  assert.equal(preview.blocks[1].error, true);
  assert.equal(errors.length, 1);
});

test("空行なしと空行ありの連続Mermaidフェンスを4ブロックへ分割する", () => {
  const splitFencedBlocks = Function(
    `${functionSource("splitFencedBlocks", "renderTextBlock")}; return splitFencedBlocks;`
  )();
  const fenced = diagramSources.map((source) => `\`\`\`mermaid\n${source}\n\`\`\``);

  for (const separator of ["\n", "\n\n"]) {
    const blocks = splitFencedBlocks(fenced.join(separator)).filter((block) => block.type === "code");
    assert.equal(blocks.length, 4);
    assert.deepEqual(blocks.map((block) => block.language), ["mermaid", "mermaid", "mermaid", "mermaid"]);
    assert.deepEqual(blocks.map((block) => block.code.split("\n")[0]), [
      "classDiagram", "stateDiagram-v2", "sequenceDiagram", "flowchart TD"
    ]);
  }
});

test("プレビュー世代をDOM IDへ渡し、配信時にapp.jsのキャッシュを更新する", () => {
  assert.match(app, /renderPreviewHtml\(body, note\.id, renderGeneration\)/);
  assert.match(app, /renderMermaidBlock\(block\.code, noteId, renderGeneration, codeBlockIndex\)/);
  assert.match(app, /mermaid-diagram-\$\{stableMermaidIdPart\(noteId\)\}-g\$\{renderGeneration\}-b\$\{index\}/);
  assert.match(indexHtml, /<script src="app\.js\?v=0\.4\.0-17"><\/script>/);
});
