"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { FONT_OPTIONS, fontOption, normalizeFontSettings } = require("./font-settings");
const { recommendFonts } = require("./font-recommendation");
const { createWebFontLoader } = require("./web-font-loader");

function fakeDocument({ loadFont = () => Promise.resolve([]) } = {}) {
  const links = [];
  const fontLoads = [];
  const addedFaces = [];
  return {
    links,
    fontLoads,
    addedFaces,
    createElement(tagName) {
      assert.equal(tagName, "link");
      return { dataset: {}, remove() { this.removed = true; } };
    },
    head: { appendChild(link) { links.push(link); } },
    fonts: {
      load(value) { fontLoads.push(value); return loadFont(value); },
      add(face) { addedFaces.push(face); }
    }
  };
}

test("起動・設定表示・検索候補表示だけではWebフォントを要求しない", () => {
  const documentObject = fakeDocument();
  const loader = createWebFontLoader({ fontLookup: fontOption, documentObject });
  recommendFonts(FONT_OPTIONS, { language: "japanese", mood: "neutral", purpose: "writing" });
  assert.equal(documentObject.links.length, 0);
  assert.deepEqual(loader.getStates(), []);
  assert.equal(loader.getState("noto-sans-jp-web").status, "idle");
});

test("Google Webフォントは必要Weightだけを読み込み、読込済みを再取得せず不足分を追加する", async () => {
  const documentObject = fakeDocument();
  const loader = createWebFontLoader({ fontLookup: fontOption, documentObject });

  const first = loader.requestFont("noto-sans-jp-web", [400]);
  const duplicate = loader.requestFont("noto-sans-jp-web", [400]);
  assert.equal(documentObject.links.length, 1);
  assert.deepEqual(loader.getState("noto-sans-jp-web").loadingWeights, [400]);
  documentObject.links[0].onload();
  await Promise.all([first, duplicate]);
  assert.deepEqual(documentObject.fontLoads, ['400 1em "Noto Sans JP"']);
  assert.deepEqual(loader.getState("noto-sans-jp-web").loadedWeights, [400]);

  await loader.requestFont("noto-sans-jp-web", [400]);
  assert.equal(documentObject.fontLoads.length, 1);
  await loader.requestFont("noto-sans-jp-web", [400, 700]);
  assert.deepEqual(documentObject.fontLoads, ['400 1em "Noto Sans JP"', '700 1em "Noto Sans JP"']);
  assert.deepEqual(loader.getState("noto-sans-jp-web").loadedWeights, [400, 700]);
  assert.equal(documentObject.links.length, 1);
});

test("Source Han Sansは指定したWeightのOTFだけを読み込む", async () => {
  const documentObject = fakeDocument();
  const faces = [];
  class FakeFontFace {
    constructor(family, source, descriptors) {
      this.family = family;
      this.source = source;
      this.descriptors = descriptors;
      faces.push(this);
    }
    load() { return Promise.resolve(this); }
  }
  const loader = createWebFontLoader({ fontLookup: fontOption, documentObject, FontFaceClass: FakeFontFace });
  await Promise.all([
    loader.requestFont("source-han-sans-web", [400]),
    loader.requestFont("source-han-sans-web", [400])
  ]);
  assert.equal(faces.length, 1);
  assert.match(faces[0].source, /SourceHanSansCN-Regular\.otf/);
  assert.equal(faces[0].descriptors.weight, "400");

  await loader.requestFont("source-han-sans-web", [700]);
  assert.equal(faces.length, 2);
  assert.match(faces[1].source, /SourceHanSansCN-Bold\.otf/);
  assert.equal(faces[1].descriptors.weight, "700");
});

test("stylesheet失敗後は失敗Weightを保持し、再試行時に失敗linkとPromiseを再利用しない", async () => {
  const documentObject = fakeDocument();
  const loader = createWebFontLoader({ fontLookup: fontOption, documentObject });
  const selected = normalizeFontSettings({ bodyFontId: "inter-web" });
  const failed = loader.requestFont(selected.bodyFontId, [400]);
  documentObject.links[0].onerror();
  assert.equal((await failed).status, "error");
  assert.equal(documentObject.links[0].removed, true);
  assert.deepEqual(loader.getState(selected.bodyFontId).failedWeights, [400]);

  const retry = loader.requestFont(selected.bodyFontId, [400]);
  const retryDuplicate = loader.requestFont(selected.bodyFontId, [400]);
  assert.equal(documentObject.links.length, 2);
  documentObject.links[1].onload();
  await Promise.all([retry, retryDuplicate]);
  assert.equal(documentObject.fontLoads.length, 1);
  assert.deepEqual(loader.getState(selected.bodyFontId).loadedWeights, [400]);
  assert.deepEqual(loader.getState(selected.bodyFontId).failedWeights, []);
  assert.equal(selected.bodyFontId, "inter-web");
  assert.equal(fontOption(selected.bodyFontId).cssFamily, 'Inter, "Segoe UI", Arial, sans-serif');
});

test("Source Han Sansの一部失敗はWeight単位で保持し、失敗分だけ再試行する", async () => {
  const documentObject = fakeDocument();
  const faces = [];
  let failBold = true;
  class FakeFontFace {
    constructor(family, source, descriptors) {
      this.family = family;
      this.source = source;
      this.descriptors = descriptors;
      faces.push(this);
    }
    load() {
      if (this.descriptors.weight === "700" && failBold) return Promise.reject(new Error("bold failed"));
      return Promise.resolve(this);
    }
  }
  const loader = createWebFontLoader({ fontLookup: fontOption, documentObject, FontFaceClass: FakeFontFace });
  await loader.requestFont("source-han-sans-web", [400, 700]);
  assert.deepEqual(loader.getState("source-han-sans-web").loadedWeights, [400]);
  assert.deepEqual(loader.getState("source-han-sans-web").failedWeights, [700]);
  failBold = false;
  await Promise.all([
    loader.requestFont("source-han-sans-web", [700]),
    loader.requestFont("source-han-sans-web", [700])
  ]);
  assert.equal(faces.filter((face) => face.descriptors.weight === "400").length, 1);
  assert.equal(faces.filter((face) => face.descriptors.weight === "700").length, 2);
  assert.deepEqual(loader.getState("source-han-sans-web").loadedWeights, [400, 700]);
  assert.deepEqual(loader.getState("source-han-sans-web").failedWeights, []);
});
