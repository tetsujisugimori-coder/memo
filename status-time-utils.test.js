"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const { formatDateTimeWithSeconds, formatNoteDateTime, formatSaveSuccessTime } = require("./status-time-utils.js");
const { createLocalSaveState, transitionLocalSaveState } = require("./local-save-state.js");
const app = fs.readFileSync("app.js", "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} が見つかること`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} の終端が見つかりません`);
}

test("タイトル日時と保存成功時刻を同じローカル日時部品から表示する", () => {
  const date = new Date(2026, 7, 14, 23, 9, 7);
  assert.equal(formatNoteDateTime(date), "2026/8/14 23:09");
  assert.equal(formatSaveSuccessTime(date), "8/14 23:09");
  assert.equal(formatDateTimeWithSeconds(date), "2026/8/14 23:09:07");
  assert.equal(formatNoteDateTime(null), "—");
  assert.equal(formatSaveSuccessTime("invalid"), "—");
});

test("ブラウザ保存成功時刻はsavedと有効な成功日時が揃った時だけ更新する", () => {
  const setSaveStatus = extractFunction(app, "setSaveStatus");
  const createController = new Function("validLocalDate", `
    let saveStatusState = "saved";
    let saveStatusTime = "2026-08-14T10:00:00.000Z";
    let saveStatusNotice = "";
    function renderSaveStatus() {}
    ${setSaveStatus}
    return {
      step(state, savedAt) {
        setSaveStatus(state, savedAt);
        return { state: saveStatusState, savedAt: saveStatusTime };
      }
    };
  `)(globalThis.MemoNexusStatusTimeUtils.validLocalDate);

  const original = "2026-08-14T10:00:00.000Z";
  for (const state of ["editing", "saving", "error"]) {
    assert.deepEqual(createController.step(state, "2026-08-14T11:00:00.000Z"), { state, savedAt: original });
  }
  assert.deepEqual(createController.step("saved", null), { state: "saved", savedAt: original });
  assert.deepEqual(createController.step("saved", "2026-08-14T12:34:00.000Z"), {
    state: "saved",
    savedAt: "2026-08-14T12:34:00.000Z"
  });

  const toggleFlag = extractFunction(app, "toggleCurrentNoteFlag");
  const saveCurrentNote = extractFunction(app, "saveCurrentNote");
  assert.match(toggleFlag, /await putNote\(note\)[\s\S]*setSaveStatus\("saved", Date\.now\(\)\)/);
  assert.match(saveCurrentNote, /try \{[\s\S]*await putNote\(note\)[\s\S]*setSaveStatus\("saved", Date\.now\(\)\)[\s\S]*catch \(error\) \{[\s\S]*setSaveStatus\("error"\)/);
});

test("ローカル成功時刻は実保存成功以外の状態遷移で更新しない", () => {
  const original = "2026-08-14T10:00:00.000Z";
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  for (const status of ["unconfigured", "pending", "saving", "conflict", "permission-required", "error", "unsupported"]) {
    const next = transitionLocalSaveState(createLocalSaveState({ status: "saved", lastSuccessAt: original }), status, {}, now);
    assert.equal(next.lastSuccessAt, original, `${status}で成功時刻を変更しない`);
  }
  const saved = transitionLocalSaveState(createLocalSaveState({ status: "saving", lastSuccessAt: original }), "saved", {
    lastSuccessAt: "2026-08-14T12:34:00.000Z"
  }, now);
  assert.equal(saved.lastSuccessAt, "2026-08-14T12:34:00.000Z");
});
