"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

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

test("下部ステータスバーに操作可能な文字数チップと詳細統計を置く", () => {
  assert.match(html, /id="textStatsBtn"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);
  assert.match(html, /id="textStatsPopover"[^>]*role="dialog"[^>]*hidden/);
  assert.match(html, /文字数 0字/);
  assert.match(html, /text-stats-utils\.js\?v=0\.4\.0-2/);
  assert.match(html, /style\.css\?v=0\.4\.0-50/);
  assert.match(html, /app\.js\?v=0\.4\.0-77/);
  assert.match(css, /\.status-chip\s*\{[^}]*min-height:\s*26px/s);
  assert.match(css, /\.text-stats-popover\s*\{[^}]*width:\s*min\(360px, calc\(100vw - 32px\)\)/s);
});

test("本文更新とキーボード・外側クリックで文章統計を制御する", () => {
  assert.match(app, /function renderTextStats\(\)/);
  assert.match(app, /function setTextStatsOpen\(open\)/);
  assert.match(app, /function scheduleSave\([\s\S]*?renderTextStats\(\)/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /document\.addEventListener\("pointerdown"/);
});

test("下部保存チップは実際のブラウザ状態と未設定ローカル状態を分けて表示する", () => {
  assert.match(html, /id="browserSaveStatusBtn"[^>]*aria-controls="browserSavePopover"/);
  assert.match(html, /id="localSaveStatusBtn"[^>]*aria-controls="localSavePopover"/);
  assert.match(app, /function performLocalWorkspaceSave\(reason = "change"\)/);
  assert.match(app, /function browserSaveStatusModel\(\)/);
  assert.match(app, /function localSaveStatusModel\(\)/);
  assert.match(app, /localSaveLabel\(localSaveState\.status\)/);
  assert.match(app, /ブラウザ \$\{browser\.label\}/);
  assert.match(app, /setSaveStatusPopoverOpen\("", false\)/);
});

test("ブラウザ保存状態の遷移とローカル未設定状態を実際の状態モデルで表示する", () => {
  const browserSaveStatusModel = extractFunction(app, "browserSaveStatusModel");
  const localSaveStatusModel = extractFunction(app, "localSaveStatusModel");
  const modelFor = new Function("saveStatusState", "saveStatusTime", "saveStatusNotice", `${browserSaveStatusModel}\nreturn browserSaveStatusModel();`);
  assert.deepEqual(modelFor("saving", null, ""), { state: "saving", label: "保存中", savedAt: null, notice: "" });
  assert.deepEqual(modelFor("saved", "2026-08-14T12:34:56.000Z", ""), { state: "saved", label: "保存済み", savedAt: "2026-08-14T12:34:56.000Z", notice: "" });
  assert.deepEqual(modelFor("error", null, "保存できません"), { state: "error", label: "保存失敗", savedAt: null, notice: "保存できません" });
  const localModel = new Function("localSaveState", "localSaveLabel", `${localSaveStatusModel}\nreturn localSaveStatusModel();`);
  assert.deepEqual(localModel({ status: "unconfigured", lastSuccessAt: null, errorMessage: "", directoryName: "", requiresUserAction: false }, () => "未設定"), {
    state: "unconfigured", label: "未設定", savedAt: null, notice: "", directoryName: "", requiresUserAction: false
  });
});

test("保存状態バーは狭幅で集約し、ライト・ダーク共通テーマ変数と状態色を使う", () => {
  assert.match(html, /id="combinedSaveStatusBtn"/);
  assert.match(css, /\.save-status-chip\[data-state="saved"\][^}]*var\(--green\)/);
  assert.match(css, /\.save-status-chip\[data-state="saving"\][^}]*var\(--accent\)/);
  assert.match(css, /\.save-status-chip\[data-state="error"\][^}]*var\(--danger\)/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.combined-save-status\s*\{\s*display:\s*inline-flex/s);
});
