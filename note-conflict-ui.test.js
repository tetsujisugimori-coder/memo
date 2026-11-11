"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");

// DOM fault-model checks complement the real browser/keyboard/download tests.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.textContent = ""; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  set innerHTML(_value) { throw new Error("Raw draft must never be rendered as HTML"); }
  click() { this.onclick?.(); }
}
function harness(preserved, missing = false) {
  const downloads = [], calls = [], host = new Element("host");
  const context = vm.createContext({ document: { createElement: (tag) => new Element(tag) }, Blob,
    URL: { createObjectURL(blob) { downloads.push(blob); return "blob:isolated"; }, revokeObjectURL() {} }, setTimeout() {},
    console });
  vm.runInContext(fs.readFileSync("note-conflict-ui.js", "utf8"), context);
  const ui = context.MemoNexusNoteConflictUi.create({ host, onChoose: () => calls.push("choose"),
    onResume: () => calls.push("resume"), onSave: () => calls.push("save"), onError: (error) => { throw error; } });
  const body = "<img src=x>\r\n  原文\t\n";
  ui.render({ noteId: "memo", missing, state: { preserved, recovery: { draft: { noteId: "memo", requestId: "attempt", body, title: "原稿" },
    receipt: { committedBody: "confirmed" } } }, committed: { body: "confirmed" } });
  const elements = [];
  function collect(element) { elements.push(element); element.children.forEach(collect); }
  collect(host);
  return { calls, downloads, elements, body, text: elements.map((element) => element.textContent).join("\n") };
}
test("preservation failure never says preserved and keeps exact draft export enabled while resume is disabled", async () => {
  const ui = harness(false);
  assert.match(ui.text, /保全に失敗/); assert.doesNotMatch(ui.text, /原稿はブラウザ内に保全済み/);
  const resume = ui.elements.find((element) => Object.hasOwn(element.attributes, "data-memo-conflict-resume"));
  const exportButton = ui.elements.find((element) => Object.hasOwn(element.attributes, "data-memo-conflict-export"));
  assert.equal(resume.disabled, true); assert.notEqual(exportButton.disabled, true);
  exportButton.click();
  assert.equal(await ui.downloads[0].text(), ui.body);
  assert.deepEqual(ui.calls, []);
});
test("preserved conflict shows both full texts and warns that ordinary ZIP excludes recovery drafts", () => {
  const ui = harness(true);
  assert.match(ui.text, /保全済み/); assert.match(ui.text, /バックアップZIPには含まれません/);
  assert.equal(ui.elements.find((element) => Object.hasOwn(element.attributes, "data-conflict-draft-body")).textContent, ui.body);
  assert.equal(ui.elements.find((element) => Object.hasOwn(element.attributes, "data-conflict-committed-body")).textContent, "confirmed");
  assert.equal(ui.elements.find((element) => Object.hasOwn(element.attributes, "data-memo-conflict-resume")).disabled, false);
  assert.deepEqual(ui.calls, []);
});

test("deleted-note recovery disables same-ID reedit but exports exact UTF-8 manuscript", async () => {
  const ui = harness(true, true);
  assert.match(ui.text, /完全削除/);
  assert.equal(ui.elements.find((element) => Object.hasOwn(element.attributes, "data-memo-conflict-resume")).disabled, true);
  ui.elements.find((element) => Object.hasOwn(element.attributes, "data-memo-conflict-export")).click();
  assert.equal(await ui.downloads[0].text(), ui.body);
  assert.match(ui.text, /バックアップZIPには含まれません/);
});
