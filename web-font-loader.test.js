"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { FONT_OPTIONS, fontOption, normalizeFontSettings } = require("./font-settings");
const { recommendFonts } = require("./font-recommendation");
const { createWebFontLoader } = require("./web-font-loader");

function fakeDocument() {
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
      load(value) { fontLoads.push(value); return Promise.resolve([]); },
      add(face) { addedFaces.push(face); }
    }
  };
}

test("起動・設定表示・推薦表示だけではWebフォントを要求しない", () => {
  const documentObject = fakeDocument();
  const loader = createWebFontLoader({ fontLookup: fontOption, documentObject });
  recommendFonts(FONT_OPTIONS, { language: "japanese", mood: "neutral", purpose: "writing" });
  assert.equal(documentObject.links.length, 0);
  assert.deepEqual(loader.getStates(), []);
  assert.equal(loader.getState("noto-sans-jp-web").status, "idle");
});

test("選択されたGoogle Webフォントだけを読み込み、loadingとloadedの重複要求をまとめる", async () => {
  const documentObject = fakeDocument();
  const changes = [];
  const loader = createWebFontLoader({
    fontLookup: fontOption,
    documentObject,
    onStateChange(fontId, state) { changes.push([fontId, state.status]); }
  });
  const first = loader.requestFont("noto-sans-jp-web");
  const duplicate = loader.requestFont("noto-sans-jp-web");
  assert.equal(first, duplicate);
  assert.equal(documentObject.links.length, 1);
  assert.equal(loader.getState("noto-sans-jp-web").status, "loading");
  assert.equal(loader.getState("inter-web").status, "idle");
  documentObject.links[0].onload();
  assert.equal((await first).status, "loaded");
  assert.equal(documentObject.fontLoads.length, 2);
  assert.equal(loader.requestFont("noto-sans-jp-web"), first);
  assert.equal(documentObject.links.length, 1);
  assert.deepEqual(changes, [["noto-sans-jp-web", "loading"], ["noto-sans-jp-web", "loaded"]]);
});

test("Source Han Sansは使用時だけregular/boldを読み込み、同時要求を重複させない", async () => {
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
  assert.equal(faces.length, 0);
  const first = loader.requestFont("source-han-sans-web");
  const duplicate = loader.requestFont("source-han-sans-web");
  assert.equal(first, duplicate);
  assert.equal((await first).status, "loaded");
  assert.equal(faces.length, 2);
  assert.equal(documentObject.addedFaces.length, 2);
  assert.match(faces[0].source, /SourceHanSansCN-Regular\.otf/);
  assert.match(faces[1].source, /SourceHanSansCN-Bold\.otf/);
});

test("外部読込失敗はerrorになり、選択IDとCSSフォールバックを保持する", async () => {
  const documentObject = fakeDocument();
  const loader = createWebFontLoader({ fontLookup: fontOption, documentObject });
  const selected = normalizeFontSettings({ bodyFontId: "inter-web" });
  const loading = loader.requestFont(selected.bodyFontId);
  documentObject.links[0].onerror();
  const result = await loading;
  assert.equal(result.status, "error");
  assert.equal(selected.bodyFontId, "inter-web");
  assert.equal(fontOption(selected.bodyFontId).cssFamily, 'Inter, "Segoe UI", Arial, sans-serif');
});
