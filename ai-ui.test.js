const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");

test("local AI scripts and disabled-by-default settings are connected", () => {
  assert.match(html, /ai-provider\.js/);
  assert.match(html, /ollama-adapter\.js/);
  assert.match(html, /ai-prompts\.js/);
  assert.match(html, /id="aiEnabledInput" type="checkbox"/);
  assert.match(html, /http:\/\/127\.0\.0\.1:11434/);
  assert.match(app, /AI_SETTINGS_STORAGE_KEY/);
});

test("robot is an accessible button and controls the single AI panel", () => {
  assert.match(html, /<button id="aiRobotBtn"[^>]+aria-controls="aiPanel"[^>]+aria-expanded="false"[^>]+aria-label=/);
  assert.match(html, /<aside id="aiPanel"[^>]+aria-hidden="true" inert>/);
  assert.match(app, /aiRobotBtn\.addEventListener\("click"[\s\S]{0,160}openAiAssistant\(\)/);
  assert.match(app, /closeAiPanelBtn\.addEventListener\("click", \(\) => setAiPanelOpen\(false\)\)/);
});

test("AI panel provides required purposes, controls, and explicit result actions", () => {
  ["要約", "整理", "翻訳", "自由質問", "送信", "停止", "コピー", "現在のメモへ挿入", "新規メモとして保存"].forEach((label) => {
    assert.match(html, new RegExp(label));
  });
  assert.match(app, /prompt\(`AI回答を/);
  assert.match(app, /1: カーソル位置/);
  assert.match(app, /2: 本文末尾/);
  assert.doesNotMatch(app, /event\.type === "text"[\s\S]{0,200}editor\.value/);
});

test("single chat panel supports explicit reference modes and normal launch resets to none", () => {
  ["参照なし", "現在のメモ", "選択した文章", "指定したメモ", "参照を解除"].forEach((label) => {
    assert.match(html, new RegExp(label));
  });
  assert.equal((html.match(/id="aiPanel"/g) || []).length, 1);
  assert.match(app, /openAiAssistant\(\)/);
  assert.match(app, /referenceMode = AI_REFERENCE_MODES\.NONE/);
  assert.match(app, /selectedTextSnapshot/);
  assert.match(app, /activeNotes\(\).*\.filter/);
});

test("chat history stores the send-time reference snapshot", () => {
  assert.match(app, /aiReferenceSnapshot\(reference\)/);
  assert.match(app, /reference: referenceSnapshot/);
  assert.match(app, /sentAt: Date\.now\(\)/);
  assert.match(app, /aiReferenceLabel\(message\.reference\)/);
});

test("existing memo list is placed at the furthest right without duplication", () => {
  assert.equal((html.match(/id="memoList"/g) || []).length, 1);
  assert.match(css, /grid-template-columns:\s*minmax\(360px, 1fr\) 300px/);
  assert.match(css, /\.sidebar\s*\{[\s\S]*?grid-column:\s*2/);
  assert.match(css, /@container app-width \(max-width: 1039\.98px\)[\s\S]*?inset:\s*0 0 0 auto/);
});

test("AI panel is responsive, dark-theme compatible, and reduced-motion safe", () => {
  assert.match(css, /width:\s*min\(380px, 92vw\)/);
  assert.match(css, /width:\s*100vw/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ai-panel/);
  assert.match(css, /background:\s*var\(--panel\)/);
});

test("closing the panel does not stop generation while page exit does", () => {
  const panelFunction = app.match(/function setAiPanelOpen[\s\S]*?\n}\n\nfunction aiStatusText/)?.[0] || "";
  assert.doesNotMatch(panelFunction, /abort\(/);
  assert.match(app, /window\.addEventListener\("pagehide"[\s\S]*?stopAiGeneration\(\)/);
  assert.match(app, /requestNoteId:\s*note\?\.id/);
});

test("AI settings keep an unsaved draft separate from runtime settings", () => {
  assert.match(app, /let aiSettingsDraft = \{ \.\.\.DEFAULT_AI_SETTINGS \}/);
  assert.match(app, /const draftSettings = readAiSettingsForm\(\)/);
  assert.match(app, /aiSettings = \{ \.\.\.draftSettings \}/);
  assert.match(app, /aiModelsEndpoint/);
  assert.doesNotMatch(app.match(/async function checkAiConnection[\s\S]*?\n}\n\nfunction beginAiSettingsSession/)?.[0] || "", /aiSettings = candidate/);
});

test("connection checks are latest-request-wins and invalid draft models do not overwrite saved selection", () => {
  assert.match(app, /const requestId = \+\+aiConnectionRequestId/);
  assert.match(app, /aiConnectionAbortController\?\.abort\(\)/);
  assert.match(app, /requestId !== aiConnectionRequestId \|\| sessionId !== aiSettingsSessionId/);
  assert.match(app, /aiSettingsDraft = \{ \.\.\.candidate, selectedModel: "" \}/);
  assert.doesNotMatch(app.match(/async function checkAiConnection[\s\S]*?\n}\n\nfunction beginAiSettingsSession/)?.[0] || "", /aiAssistantState\.connection = AI_CONNECTION_STATES\.CONNECTED/);
});

test("saving resolves verified draft state before clearing model results", () => {
  const saveFunction = app.match(/function saveAiSettings\(\)[\s\S]*?\r?\n}\r?\n\r?\nfunction renderAiSettings/)?.[0] || "";
  assert.match(saveFunction, /const verifiedEndpoint = aiModelsEndpoint/);
  assert.match(saveFunction, /const verifiedModels = \[\.\.\.aiModels\]/);
  assert.match(saveFunction, /resolveSavedAiState\(/);
  assert.match(saveFunction, /aiModels = verifiedModels/);
  assert.match(saveFunction, /aiAssistantState\.generation = savedState\.generation/);
});
