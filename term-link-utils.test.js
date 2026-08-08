const assert = require("node:assert/strict");
const test = require("node:test");
const { bodyContainsRegisteredTerm, buildTermRelationIndex, termColor } = require("./term-link-utils.js");

test("明示語句は本文に含まれる別メモへ自動関連として表示する", () => {
  const index = buildTermRelationIndex([
    { id: "a", body: "[[JavaScript]]について" },
    { id: "b", body: "JavaScriptではDOMを扱う" },
    { id: "c", body: "JavaScriptのニュース" }
  ]);
  assert.deepEqual(index.byNoteId.get("a").explicitTerms, ["JavaScript"]);
  assert.deepEqual(index.byNoteId.get("b").automaticTerms, ["JavaScript"]);
  assert.equal(index.byNoteId.get("b").terms[0].source, "automatic");
  assert.deepEqual(index.byNoteId.get("c").automaticTerms, ["JavaScript"]);
});

test("登録済みでない語句は自動関連にせず、短い英数字は単語境界で判定する", () => {
  const index = buildTermRelationIndex([{ id: "a", body: "本文だけ" }, { id: "b", body: "本文だけ" }]);
  assert.deepEqual(index.byNoteId.get("b").terms, []);
  assert.equal(bodyContainsRegisteredTerm("AIの利用", "AI"), true);
  assert.equal(bodyContainsRegisteredTerm("FAIL", "AI"), false);
  assert.equal(bodyContainsRegisteredTerm("Web_kit", "Web"), false);
});

test("明示語句が残る限り登録は維持され、削除後は自動関連も消える", () => {
  const retained = buildTermRelationIndex([{ id: "a", body: "[[DOM]]" }, { id: "b", body: "[[DOM]]" }, { id: "c", body: "DOM API" }]);
  assert.deepEqual(retained.byNoteId.get("c").automaticTerms, ["DOM"]);
  const removed = buildTermRelationIndex([{ id: "a", body: "DOM" }, { id: "b", body: "DOM API" }]);
  assert.deepEqual(removed.registeredTerms, []);
  assert.deepEqual(removed.byNoteId.get("b").terms, []);
  const removedFromBody = buildTermRelationIndex([{ id: "a", body: "[[DOM]]" }, { id: "b", body: "別の本文" }]);
  assert.deepEqual(removedFromBody.byNoteId.get("b").automaticTerms, []);
});

test("複数の登録済み語句は同じ色を保ち、1メモへ個別に並ぶ", () => {
  const index = buildTermRelationIndex([
    { id: "a", body: "[[JavaScript]] [[DOM]] [[CSS]]" },
    { id: "b", body: "JavaScript、DOM、CSSを使う" }
  ]);
  const terms = index.byNoteId.get("b").terms;
  assert.deepEqual(terms.map((entry) => entry.term), ["JavaScript", "DOM", "CSS"]);
  assert.deepEqual(terms.map((entry) => entry.source), ["automatic", "automatic", "automatic"]);
  assert.equal(terms[0].color, index.byNoteId.get("a").terms[0].color);
});

test("語句色は英字・数字・かな・漢字で再現可能に決まる", () => {
  assert.equal(termColor("JavaScript"), termColor("JavaScript"));
  assert.equal(termColor("42番"), termColor("42番"));
  assert.equal(termColor("かきくけこ"), termColor("かきくけこ"));
  assert.equal(termColor("漢字"), termColor("漢字"));
  assert.notEqual(termColor("JavaScript"), termColor("DOM"));
});
