"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { commands, clampPosition } = require("./feature-palette.js");
const html = fs.readFileSync("index.html", "utf8");
const source = fs.readFileSync("feature-palette.js", "utf8");
test("15 stable command IDs describe original controls without duplicate dispatch", () => {
  assert.equal(commands.length, 15);
  for (const key of ["id", "controlId"]) assert.equal(new Set(commands.map(c => c[key])).size, 15);
  for (const c of commands) {
    for (const key of ["id", "controlId", "label", "description", "category", "icon"]) assert.ok(c[key]);
    assert.ok(c.keywords.length > 0);
    assert.equal((html.match(new RegExp(`id="${c.controlId}"`, "g")) || []).length, 1);
  }
  assert.doesNotMatch(source, /\.click\(|cloneNode|innerHTML|dispatchEvent|localStorage|indexedDB|fetch\(|Worker|setTimeout/);
});
test("clamp keeps dragged palette within visual viewport, including offset and tiny bounds", () => {
  assert.deepEqual(clampPosition({x:-10,y:-200},{width:372,height:480},{width:1280,height:800}),{x:8,y:8});
  assert.deepEqual(clampPosition({x:2000,y:2000},{width:372,height:480},{width:1280,height:800}),{x:900,y:312});
  assert.deepEqual(clampPosition({x:0,y:900},{width:304,height:300},{left:20,top:100,width:320,height:320}),{x:28,y:112});
  assert.deepEqual(clampPosition({x:30,y:30},{width:372,height:480},{width:320,height:200}),{x:8,y:8});
});
test("palette is initially hidden non-modal UI and original tools are outside normal flow", () => {
  assert.match(html,/id="featurePalette"[^>]*role="dialog"[^>]*aria-modal="false"[^>]*hidden/);
  for (const id of ["featurePaletteToggle", "mobileFeaturePaletteToggle"]) assert.match(html,new RegExp(`id="${id}"[^>]*aria-expanded="false"[^>]*aria-controls="featurePalette"`));
  assert.match(fs.readFileSync("style.css","utf8"),/\.feature-palette \{\s*position: fixed;/);
  assert.match(source,/doc\.querySelector\("dialog\[open\]"\)/);
  assert.match(source,/beforeCommand\(button.id\)/);
});
