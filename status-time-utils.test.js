"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { parseLocalNote, serializeLocalNote } = require("./local-markdown.js");
const { normalizeWebClip } = require("./web-clip-utils.js");

const {
  compareDateTimes,
  dateTimeAttribute,
  formatDateTimeWithSeconds,
  formatLocalDate,
  formatNoteDateTime,
  formatSaveSuccessTime,
  isSameLocalDate,
  localDateKey,
  timestampValue,
  validLocalDate
} = require("./status-time-utils.js");
const { createLocalSaveState, transitionLocalSaveState } = require("./local-save-state.js");
const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} が見つかること`);
  const parametersStart = source.indexOf("(", start);
  let parameterDepth = 0;
  let bodyStart = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === "(") parameterDepth += 1;
    if (source[index] === ")") parameterDepth -= 1;
    if (parameterDepth === 0) {
      bodyStart = source.indexOf("{", index + 1);
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `${name} の本体が見つかること`);
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

test("日時共通処理を利用側より先に読み込み、変更した配信識別子を更新する", () => {
  assert.match(html, /status-time-utils\.js\?v=0\.5\.0-2/);
  assert.match(html, /memo-popout-utils\.js\?v=0\.5\.0-4/);
  assert.match(html, /local-save-state\.js\?v=0\.5\.0-5/);
  assert.match(html, /local-markdown\.js\?v=0\.5\.0-4/);
  assert.match(html, /app\.js\?v=0\.5\.0-136/);
  assert.ok(html.indexOf("status-time-utils.js") < html.indexOf("memo-popout-utils.js"));
  assert.ok(html.indexOf("status-time-utils.js") < html.indexOf("local-save-state.js"));
  assert.ok(html.indexOf("local-save-state.js") < html.indexOf("local-markdown.js"));
  assert.ok(html.indexOf("status-time-utils.js") < html.indexOf("app.js"));
});

test("UTC境界の瞬間を指定タイムゾーンの日時と日付キーへ変換する", () => {
  const instant = "2026-08-19T23:19:22.291Z";
  const options = { timeZone: "Asia/Tokyo" };
  assert.equal(formatNoteDateTime(instant, options), "2026/8/20 08:19");
  assert.equal(localDateKey(instant, options), "2026-08-20");
  assert.notEqual(localDateKey(instant, options), "2026-08-19");
  assert.equal(isSameLocalDate(instant, "2026-08-20T03:00:00.000Z", options), true);
});

test("UTCより西側でも瞬間は現地日付へ変換し、日付だけの値は前日にずらさない", () => {
  const options = { timeZone: "America/Los_Angeles" };
  assert.equal(localDateKey("2026-08-20T01:00:00.000Z", options), "2026-08-19");
  assert.equal(localDateKey("2026-08-20", options), "2026-08-20");
  assert.equal(formatLocalDate("2026-08-20", options), "2026/8/20");
  assert.equal(dateTimeAttribute("2026-08-20"), "2026-08-20");
});

test("オフセット付き日時・数値タイムスタンプ・通常時刻を同じ瞬間として扱う", () => {
  const iso = "2026-08-20T08:19:22.291+09:00";
  const timestamp = Date.parse("2026-08-19T23:19:22.291Z");
  assert.equal(timestampValue(iso), timestamp);
  assert.equal(timestampValue(timestamp), timestamp);
  assert.equal(formatNoteDateTime(iso, { timeZone: "Asia/Tokyo" }), "2026/8/20 08:19");
  assert.equal(formatNoteDateTime("2026-08-20T03:00:00.000Z", { timeZone: "Asia/Tokyo" }), "2026/8/20 12:00");
});

test("不正・欠損日時は安全にフォールバックし、実時刻で並べ替える", () => {
  assert.equal(validLocalDate("invalid"), null);
  assert.equal(localDateKey("invalid"), "");
  assert.equal(formatLocalDate(null), "");
  assert.equal(dateTimeAttribute(undefined), "");
  const values = ["invalid", "2026-08-20T00:00:00.000Z", Date.parse("2026-08-21T00:00:00.000Z")];
  assert.deepEqual([...values].sort((a, b) => compareDateTimes(a, b, "desc")), [
    Date.parse("2026-08-21T00:00:00.000Z"), "2026-08-20T00:00:00.000Z", "invalid"
  ]);
});

test("タイムゾーンなしの旧形式は既存互換どおりブラウザのローカル日時として解析する", () => {
  const legacy = validLocalDate("2026-08-20 08:19");
  assert.ok(legacy);
  assert.equal(legacy.getFullYear(), 2026);
  assert.equal(legacy.getMonth(), 7);
  assert.equal(legacy.getDate(), 20);
  assert.equal(legacy.getHours(), 8);
  assert.equal(legacy.getMinutes(), 19);
});

test("今日メモとバックアップ日付キーを利用者のローカル日付で生成する", () => {
  const todayTitle = new Function("localDateKey", `${extractFunction(app, "todayTitle")}; return todayTitle;`)(localDateKey);
  const todayStamp = new Function("localDateKey", `${extractFunction(app, "todayStamp")}; return todayStamp;`)(localDateKey);
  const todayStampDashed = new Function("localDateKey", `${extractFunction(app, "todayStampDashed")}; return todayStampDashed;`)(localDateKey);
  const instant = "2026-08-19T23:19:22.291Z";
  assert.equal(todayTitle(instant, { timeZone: "Asia/Tokyo" }), "2026-08-20 今日メモ");
  assert.equal(todayStamp(instant, { timeZone: "Asia/Tokyo" }), "20260820");
  assert.equal(todayStampDashed(instant, { timeZone: "America/Los_Angeles" }), "2026-08-19");
});

test("新規作成・Markdown取込・Web Clipperで指定された瞬間を変更せず保存する", async () => {
  const stored = [];
  const createNoteSource = extractFunction(app, "createNote").replace(/^function createNote/, "async function createNote");
  const createNote = new Function(
    "Date", "crypto", "temporaryMemoTitle", "uniqueTitle", "resolveNewNoteCollection", "normalizeTagIds", "putNote", "notes", "invalidateTermRelationIndex", "noteForSave", "persistIncomingNote", "registerNoteSaveState",
    `${createNoteSource}; return createNote;`
  )(
    Date,
    { randomUUID: () => "generated-note" },
    () => "memo1",
    (title) => title,
    (collectionId) => collectionId || "unclassified",
    (tags) => tags || [],
    async (note) => { stored.push(note); },
    [],
    () => {},
    () => null,
    async (note) => note,
    () => {}
  );
  const capturedAt = normalizeWebClip({
    title: "記事", url: "https://example.com/", capturedAt: "2026-08-19T23:19:22.291Z"
  }).capturedAt;
  const original = await createNote("取込", "本文", {
    createdAt: capturedAt,
    localCreatedAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T01:00:00.000Z",
    bodyUpdatedAt: "2026-08-20T00:30:00.000Z",
    localSavedAt: "2026-08-20T02:00:00.000Z"
  });
  assert.equal(original.createdAt, capturedAt);
  assert.equal(formatNoteDateTime(original.createdAt, { timeZone: "Asia/Tokyo" }), "2026/8/20 08:19");
  const parsed = parseLocalNote(serializeLocalNote(original, original.body));
  assert.equal(parsed.metadata.createdAt, capturedAt);
  assert.equal(parsed.metadata.localCreatedAt, original.localCreatedAt);
  assert.equal(parsed.metadata.updatedAt, original.updatedAt);
  assert.equal(parsed.metadata.bodyUpdatedAt, original.bodyUpdatedAt);
  assert.equal(parsed.metadata.localSavedAt, original.localSavedAt);
  assert.equal(stored[0].createdAt, capturedAt);

  assert.match(app, /createdAt: hasMemoNexusMetadata \? parsedPlan\.metadata\.createdAt : undefined/);
  assert.match(app, /createNote\(title, body, \{ id: memoId, collectionId, createdAt: clip\.capturedAt/);
  assert.match(app, /createNote\(title, buildWebClipMarkdown\(clip\), \{ collectionId: webClipCollection\.value, createdAt: clip\.capturedAt/);
});

test("メモ本体・一覧・コレクションは同じ表示用作成日時を使う", () => {
  assert.match(app, /renderTimestamp\(noteCreatedAt, createdAt, formatNoteDateTime, "作成"\)/);
  assert.match(app, /compareDateTimes\(resolveDisplayedCreatedAt\(a\), resolveDisplayedCreatedAt\(b\), "desc"\)/);
  assert.match(app, /item\.title = `作成 \$\{formatNoteDateTime\(resolveDisplayedCreatedAt\(note\)\)\}/);
  assert.match(app, /return timestampValue\(resolveDisplayedCreatedAt\(note\)\)/);
  assert.match(app, /formatExplorerDate\(resolveDisplayedCreatedAt\(note\)\)/);
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
  assert.match(toggleFlag, /const noteId = note\.id[\s\S]*markLocalMemoDirty\(note\)[\s\S]*await enqueueNoteSave\(noteId\)/);
  assert.match(saveCurrentNote, /applyCurrentEditorDraft\(note\)[\s\S]*return flushScheduledNoteSave\(note\.id\)/);
  assert.match(app, /function handleNoteSaveStateChange\([\s\S]*?state\.status === "error"\) setSaveStatus\("error"\)[\s\S]*?else if \(state\.dirty\) setSaveStatus\("editing"\)[\s\S]*?else setSaveStatus\("saved"/);
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
