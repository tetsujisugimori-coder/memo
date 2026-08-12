"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeIsFlagged, parseFlaggedMarkdown, serializeNoteForMarkdown, withNormalizedFlag } = require("./note-flag-utils.js");

test("new and legacy notes normalize to unflagged", () => {
  assert.equal(normalizeIsFlagged(undefined), false);
  assert.equal(normalizeIsFlagged(false), false);
  assert.equal(normalizeIsFlagged(true), true);
  assert.deepEqual(withNormalizedFlag({ id: "legacy", title: "legacy" }), { id: "legacy", title: "legacy", isFlagged: false });
});

test("Markdown export and import preserve note flags", () => {
  const exported = serializeNoteForMarkdown({ title: "check", isFlagged: true }, "body", { includeTitle: true });
  assert.match(exported, /^<!-- memo-nexus-note:/);
  assert.deepEqual(parseFlaggedMarkdown(exported), { body: "# check\n\nbody", isFlagged: true });
  assert.deepEqual(parseFlaggedMarkdown("existing body"), { body: "existing body", isFlagged: false });
});
