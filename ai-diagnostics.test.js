"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createStore } = require("./ai-diagnostics");
const { OllamaAdapter } = require("./ollama-adapter");
const { GeminiAdapter } = require("./gemini-adapter");
const provider = require("./ai-provider");
const prompts = require("./ai-prompts");
const context = require("./ai-context");
const encoder = new TextEncoder();
const event = (content = "", done = true, thinking = "") => JSON.stringify({ message: { content, thinking }, done }) + "\n";
function response(chunks, options = {}) {
  let i = 0;
  return { ok: true, status: 200, body: { getReader: () => ({
    async read() {
      if (i < chunks.length) { const value = chunks[i++]; return { done: false, value: typeof value === "string" ? encoder.encode(value) : value }; }
      if (options.disconnect) throw new TypeError("PRIVATE_CONNECTION_DETAIL");
      return { done: true };
    }, async cancel() { options.cancelled = true; }
  }) } };
}
async function run(chunks, { enabled = true, disconnect = false, observerThrows = false } = {}) {
  const store = createStore(); store.setEnabled(enabled);
  const request = store.begin({ provider: "ollama", model: "qwen:tiny", messages: [{ role: "user", content: "PRIVATE_QUESTION" }] });
  let answer = "", errorCode;
  const adapter = new OllamaAdapter({ fetchImpl: async () => response(chunks, { disconnect }) });
  try {
    for await (const item of adapter.generate({ model: "qwen:tiny", messages: [], onDiagnostic: observerThrows ? () => { throw Error("observer failed"); } : request.observe })) {
      if (item.type === "text") answer += item.content;
    }
  } catch (e) { errorCode = e.code; }
  request.ui(answer.trim() ? answer.length : 0);
  request.finish({ characters: answer.length, errorCode });
  return { answer, errorCode, record: store.snapshot()[0], store };
}
for (const [name, chunks, result, answer] of [
  ["normal text", [event("回答")], "COMPLETED_WITH_TEXT", "回答"],
  ["empty done", [event()], "COMPLETED_EMPTY", ""],
  ["thinking only", [event("", true, "PRIVATE_THINKING")], "COMPLETED_EMPTY", ""],
  ["thinking and content", [event("本文", true, "PRIVATE_THINKING")], "COMPLETED_WITH_TEXT", "本文"],
  ["no done", [event("partial", false)], "STREAM_ENDED_WITHOUT_DONE", "partial"],
  ["incomplete tail", [event("partial", false), '{"message":'], "ERROR", "partial"],
  ["multiple events and duplicate done", [event("A", false) + event("B") + event()], "COMPLETED_WITH_TEXT", "AB"],
  ["empty receive chunks", [new Uint8Array(), event("C")], "COMPLETED_WITH_TEXT", "C"],
  ["no newline at EOF", [event("tail").trim()], "COMPLETED_WITH_TEXT", "tail"]
]) test(`Ollama diagnostic: ${name}`, async () => {
  const value = await run(chunks);
  assert.equal(value.answer, answer); assert.equal(value.record.result, result);
  assert.equal(value.record.httpStatus, 200);
  assert.equal(value.record.finalAnswerCharacters, answer.length);
  assert.equal(value.record.uiCharacters, answer.length);
  if (name.includes("thinking")) { assert.equal(value.record.thinkingPresent, true); assert.equal(value.record.thinkingCharacters, 16); }
  if (name.includes("duplicate")) assert.equal(value.record.doneCount, 2);
  assert.doesNotMatch(value.store.exportJson(), /PRIVATE_/);
});
test("byte-split UTF-8 and NDJSON are reconstructed without duplicate text", async () => {
  const bytes = encoder.encode(event("日本語🙂"));
  const value = await run([...bytes].map(byte => new Uint8Array([byte])));
  assert.equal(value.answer, "日本語🙂"); assert.equal(value.record.bodyCharacters, 5);
  assert.equal(value.record.receivedChunks, bytes.length);
});
test("malformed thinking cannot change legacy content generation, including EOF tail", async () => {
  for (const suffix of ["\n", ""]) {
    const payload = JSON.stringify({ message: { content: "answer", thinking: { toString: null } }, done: true }) + suffix;
    const observed = await run([payload]);
    assert.equal(observed.answer, "answer"); assert.equal(observed.errorCode, undefined);
    assert.equal(observed.record.thinkingCharacters, 0);
    const adapter = new OllamaAdapter({ fetchImpl: async () => response([payload]) });
    let plain = "";
    for await (const item of adapter.generate({ model: "test", messages: [] })) if (item.type === "text") plain += item.content;
    assert.equal(plain, observed.answer);
  }
});
test("disconnect preserves partial text and has no normal stream end", async () => {
  const value = await run([event("partial", false)], { disconnect: true });
  assert.equal(value.record.result, "ERROR"); assert.equal(value.record.errorType, "connection");
  assert.equal(value.record.streamEndedNormally, false); assert.equal(value.answer, "partial");
});
for (const timeout of [false, true]) test(timeout ? "inactivity timeout is TIMEOUT" : "AbortController stop is INTERRUPTED", async () => {
  const store = createStore(), trace = store.begin(), controller = new AbortController();
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const adapter = new OllamaAdapter({ timeoutMs: 10, fetchImpl: async (_url, { signal }) => ({ ok: true, status: 200,
    body: { getReader: () => ({ read: () => { entered(); return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("private"), { name: "AbortError" })), { once: true })); }, cancel: async () => {} }) } }) });
  const pending = (async () => { try { for await (const _item of adapter.generate({ model: "test", signal: controller.signal, onDiagnostic: trace.observe })) {} }
    catch (error) { trace.finish({ errorCode: error.code }); } })();
  await ready; if (!timeout) controller.abort(); await pending;
  assert.equal(store.snapshot()[0].result, timeout ? "TIMEOUT" : "INTERRUPTED");
});
test("diagnostics ON/OFF and a throwing observer preserve the exact output", async () => {
  const chunks = [event("one", false), event("two")];
  const on = await run(chunks), off = await run(chunks, { enabled: false }), throwing = await run(chunks, { observerThrows: true });
  assert.equal(on.answer, off.answer); assert.equal(on.answer, throwing.answer);
  assert.equal(off.store.snapshot().length, 0); assert.equal(throwing.errorCode, undefined);
});
test("metadata whitelist prevents secrets in copied diagnostics and unknown errors", () => {
  const store = createStore();
  const handle = store.begin({ model: "PRIVATE_KEY", secrets: ["PRIVATE_KEY"], provider: "PRIVATE_PROVIDER", purpose: "PRIVATE_TASK",
    messages: [{ role: "PRIVATE_ROLE", content: "PRIVATE_MEMO" }], apiKey: "PRIVATE_KEY", question: "PRIVATE_QUESTION", referenceMode: "PRIVATE_NOTE" });
  handle.observe("unknown", { content: "PRIVATE_ANSWER", thinking: "PRIVATE_THINKING" });
  handle.finish({ errorCode: "PRIVATE_ERROR", error: new Error("PRIVATE_ERROR") });
  const exported = store.exportJson(); assert.doesNotMatch(exported, /PRIVATE_/); assert.match(exported, /REDACTED/);
  assert.equal(store.snapshot()[0].errorType, "UNKNOWN"); assert.equal(store.snapshot()[0].result, "ERROR");
});
test("count, serialized byte and age bounds; clear and OFF invalidate old handles", () => {
  let clock = 0; const store = createStore({ now: () => clock, maxRecords: 2, maxAgeMs: 100, maxBytes: 4000 });
  const old = store.begin(); store.begin(); store.begin();
  assert.equal(store.snapshot().length, 2); old.observe("body", { characters: 500 });
  assert.equal(store.snapshot()[0].bodyCharacters, 0);
  clock = 101; assert.deepEqual(store.snapshot(), []);
  const handle = store.begin(); store.clear(); handle.observe("done"); assert.deepEqual(store.snapshot(), []);
  const disabled = store.begin(); store.setEnabled(false); store.setEnabled(true); disabled.observe("done"); assert.deepEqual(store.snapshot(), []);
  const small = createStore({ maxBytes: 100 }); small.begin(); assert.deepEqual(small.snapshot(), []);
});
test("age expiry removes retained records without reads", async () => {
  const store = createStore({ maxAgeMs: 5 }); store.begin();
  await new Promise(resolve => setTimeout(resolve, 15)); assert.deepEqual(store.snapshot(), []);
});
test("expiry also clears the actual diagnostic DOM snapshot without user interaction", async () => {
  const host = { textContent: "" };
  const box = { document: { getElementById: () => host } };
  vm.createContext(box); vm.runInContext(source("renderAiDiagnostics"), box);
  box.aiDiagnostics = createStore({ maxAgeMs: 5, onExpire: () => box.renderAiDiagnostics() });
  box.aiDiagnostics.begin({ model: "private-model-name" }); box.renderAiDiagnostics();
  assert.match(host.textContent, /private-model-name/);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(host.textContent, "診断記録はありません。");
});
test("throwing expiry observers cannot escape the diagnostic timer", async () => {
  let calls = 0, clock = 0;
  const store = createStore({ now: () => clock, maxAgeMs: 5, onExpire: () => { calls++; throw Error("PRIVATE_OBSERVER"); } });
  // Make the scheduled callback due independently of wall-clock rounding on loaded CI runners.
  store.begin(); clock = 5; await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 1); assert.deepEqual(store.snapshot(), []);
});
test("final records are immutable to late callbacks and returned snapshots are copies", () => {
  const store = createStore(), h = store.begin({ messages: [{ role: "user", content: "x" }] });
  h.finish({ characters: 0 }); h.observe("body", { characters: 99 }); h.ui(99);
  const first = store.snapshot()[0]; first.messageRoles.push("private"); first.bodyCharacters = 100;
  assert.equal(store.snapshot()[0].bodyCharacters, 0); assert.deepEqual(store.snapshot()[0].messageRoles, ["user"]);
});

// Execute actual app functions, including renderAiUi and the requestId guard, with a minimal DOM.
const app = fs.readFileSync("app.js", "utf8");
function source(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = app.indexOf("\n}", start) + 2;
  return (app.slice(start - 6, start) === "async " ? "async " : "") + app.slice(start, end);
}
function appHarness(fetchImpl) {
  const element = () => ({ value: "", textContent: "", dataset: {}, disabled: false });
  const sandbox = { ...provider, ...prompts, ...context, AbortController, Date, console,
    aiDiagnostics: createStore(), aiAbortController: null,
    aiSettings: { enabled: true, selectedModel: "qwen:test", provider: "ollama", systemInstruction: "SYSTEM", timeoutMs: 5000 },
    aiAssistantState: { generation: "idle", requestId: 0, history: [], answer: "", reference: { mode: "none" } },
    currentNote: () => null, activeNotes: () => [{ id: "fixture" }], flushSave: async () => {},
    renderAiReferenceUi() {}, renderAiChatHistory() {}, updateAiTargetPreview() {}, renderAiDiagnostics() {},
    aiStatusText: () => "status", connectionStatusText: () => "connection",
    createAiAdapter: () => new OllamaAdapter({ fetchImpl }),
    aiPurposeRequiresReference: p => p !== "question"
  };
  for (const name of ["aiInstructionInput", "aiPurposeSelect", "aiTranslationSelect", "aiTargetSelect", "aiRobotBtn", "aiRobotStatus", "aiConnectionBadge", "aiActiveModel", "aiGenerationStatus", "aiAnswer", "aiSendBtn", "aiStopBtn", "aiCopyBtn", "aiAppendBtn", "aiSaveNewBtn", "aiTranslationRow"]) sandbox[name] = element();
  sandbox.aiPurposeSelect.value = "question"; sandbox.aiTargetSelect.value = "none"; sandbox.aiTranslationSelect.value = "ja";
  vm.createContext(sandbox);
  vm.runInContext(["startAiGeneration", "renderAiUi", "resetAiAssistantConversation", "stopAiGeneration"].map(source).join("\n"), sandbox);
  return sandbox;
}
for (const repetitions of [2, 5]) test(`actual app: ${repetitions} consecutive generations preserve UI and request isolation`, async () => {
  let index = 0;
  const box = appHarness(async () => response([event(`回答${++index}`)]));
  for (let i = 1; i <= repetitions; i++) {
    box.aiInstructionInput.value = `question${i}`; await box.startAiGeneration();
    assert.equal(box.aiAnswer.textContent, `回答${i}`);
    assert.equal(box.aiAssistantState.generation, "completed");
  }
  const records = box.aiDiagnostics.snapshot();
  assert.equal(new Set(records.map(r => r.requestId)).size, repetitions);
  assert.deepEqual(records.map(r => r.historyMessageCount), Array.from({ length: repetitions }, (_, i) => i * 2));
  for (const r of records) { assert.equal(r.result, "COMPLETED_WITH_TEXT"); assert.equal(r.finalAnswerCharacters, r.uiCharacters); }
});
test("actual app: empty done keeps legacy completed UI but diagnoses empty", async () => {
  const box = appHarness(async () => response([event()])); box.aiInstructionInput.value = "Q"; await box.startAiGeneration();
  assert.equal(box.aiAssistantState.generation, "completed"); assert.equal(box.aiAnswer.textContent, "回答はここに表示されます。");
  assert.equal(box.aiDiagnostics.snapshot()[0].result, "COMPLETED_EMPTY"); assert.equal(box.aiDiagnostics.snapshot()[0].uiCharacters, 0);
});
test("actual app: delayed old response after conversation reset never enters new request/UI", async () => {
  let release, started, index = 0;
  const waiting = new Promise(resolve => { started = resolve; });
  const box = appHarness(async () => {
    if (++index === 1) { started(); await new Promise(resolve => { release = resolve; }); return response([event("OLD_PRIVATE")]); }
    return response([event("NEW")]);
  });
  box.aiInstructionInput.value = "old"; const first = box.startAiGeneration(); await waiting;
  box.resetAiAssistantConversation(); box.aiInstructionInput.value = "new"; await box.startAiGeneration();
  release(); await first;
  assert.equal(box.aiAnswer.textContent, "NEW"); assert.equal(box.aiAssistantState.history.length, 2);
  const [old, current] = box.aiDiagnostics.snapshot(); assert.equal(old.result, "INTERRUPTED"); assert.equal(old.staleResponse, true);
  assert.equal(current.result, "COMPLETED_WITH_TEXT"); assert.equal(current.bodyCharacters, 3);
});
test("actual app: panel close/resume preserves diagnostics; fresh open resets the conversation", async () => {
  const box = appHarness(async () => response([event("visible")]));
  Object.assign(box, { contextPanelTab: "ai", mobileCardOpen: false,
    isMobileWritingMode: () => false, setContextPanelTab: () => { box.aiAssistantState.panelOpen = true; },
    setContextPanelOpen: () => {}, setAiAssistantPanelActive: active => { box.aiAssistantState.panelOpen = active; },
    setRelatedDrawerOpen: () => {}, updateResponsiveLayoutUi: () => {}, closeAiPanelBtn: { focus() {} } });
  box.aiRobotBtn.focus = () => {};
  vm.runInContext(source("setAiPanelOpen"), box);
  box.aiInstructionInput.value = "Q"; await box.startAiGeneration();
  const id = box.aiDiagnostics.snapshot()[0].requestId;
  box.contextPanelTab = "collection"; box.aiAssistantState.panelOpen = true;
  box.setAiPanelOpen(false); box.setAiPanelOpen(true, { launchMode: "resume" });
  assert.equal(box.aiAnswer.textContent, "visible");
  box.contextPanelTab = "collection"; box.setAiPanelOpen(false); box.setAiPanelOpen(true);
  assert.equal(box.aiAssistantState.history.length, 0); assert.equal(box.aiDiagnostics.snapshot()[0].requestId, id);
});
test("actual app: model change uses new model metadata without deleting existing history", async () => {
  const sent = []; const box = appHarness(async (_url, options) => { sent.push(JSON.parse(options.body)); return response([event("A")]); });
  box.aiInstructionInput.value = "first"; await box.startAiGeneration();
  box.aiSettings.selectedModel = "phi:test"; box.aiInstructionInput.value = "second"; await box.startAiGeneration();
  assert.equal(sent[1].model, "phi:test");
  assert.equal(box.aiDiagnostics.snapshot()[1].model, "phi:test");
  assert.equal(box.aiDiagnostics.snapshot()[1].historyMessageCount, 2);
});
test("actual app: translation/question, history and language changes record the sent messages", async () => {
  const sent = []; const box = appHarness(async (_url, options) => { sent.push(JSON.parse(options.body).messages); return response([event("answer")]); });
  for (const purpose of ["translate", "question"]) for (const history of [false, true]) for (const language of ["ja", "en"]) {
    box.resetAiAssistantConversation(); box.aiPurposeSelect.value = purpose; box.aiTranslationSelect.value = language;
    box.aiAssistantState.reference = { mode: "selected-text", content: "REFERENCE_PRIVATE" }; box.aiTargetSelect.value = "selected-text";
    if (history) box.aiAssistantState.history = [{ role: "user", content: "PREVIOUS_PRIVATE" }, { role: "assistant", content: "PREVIOUS_ANSWER" }];
    box.aiInstructionInput.value = "INSTRUCTION_PRIVATE"; await box.startAiGeneration();
    const actual = sent.at(-1), record = box.aiDiagnostics.snapshot().at(-1);
    const prefix = purpose === "translate" ? ["system"] : ["system", "system"];
    assert.deepEqual(actual.map(m => m.role), [...prefix, ...(history ? ["user", "assistant"] : []), "user"]);
    assert.equal(record.sentMessageCount, actual.length); assert.equal(record.historyMessageCount, history ? 2 : 0);
    assert.equal(record.purpose, purpose); assert.equal(record.translationLanguage, language);
    assert.equal(record.inputCharacters, actual.reduce((n, m) => n + m.content.length, 0));
    if (purpose === "translate") {
      assert.ok(actual.at(-1).content.includes(language === "ja" ? "日本語" : "英語"));
      assert.match(actual.at(-1).content, /\[翻訳対象\]\nREFERENCE_PRIVATE$/);
      assert.equal(actual.filter(m => m.role === "system").some(m => m.content.includes("REFERENCE_PRIVATE")), false);
    }
    else assert.equal(actual.at(-1).content, "INSTRUCTION_PRIVATE");
  }
  assert.doesNotMatch(box.aiDiagnostics.exportJson(), /PRIVATE|PREVIOUS_ANSWER/);
});
test("Gemini provider finishReason and thinking-only are observed independently of its synthetic done", async () => {
  for (const [parts, finishReason, expected] of [
    [[{ text: "answer" }], "STOP", "COMPLETED_WITH_TEXT"],
    [[{ text: "answer" }], undefined, "STREAM_ENDED_WITHOUT_DONE"],
    [[{ text: "secret thought", thought: true }], "STOP", "COMPLETED_EMPTY"]
  ]) {
    const store = createStore(), h = store.begin({ provider: "gemini" }); let answer = "";
    const adapter = new GeminiAdapter({ apiKey: "FAKE_KEY", fetchImpl: async () => response([`data: ${JSON.stringify({ candidates: [{ content: { parts }, finishReason }] })}\n\n`]) });
    for await (const item of adapter.generate({ model: "gemini-test", messages: [{ role: "user", content: "test" }], onDiagnostic: h.observe })) if (item.type === "text") answer += item.content;
    h.finish({ characters: answer.length }); assert.equal(store.snapshot()[0].result, expected);
    assert.doesNotMatch(store.exportJson(), /secret thought|FAKE_KEY/);
  }
});

test("actual startup order initializes diagnostics before synchronous init renders AI UI", async () => {
  const { runGuardedStartup } = require("./indexeddb-lifecycle");
  const calls = [];
  const sandbox = {
    console: { log() {} }, APP_VERSION: "fixture", APP_LABEL: "fixture", APP_BUILD: "fixture",
    location: { href: "fixture" }, appVersionDisplays: [], isPopoutWindow: false, runGuardedStartup,
    window: { MemoNexusAiDiagnostics: { createStore: () => ({ snapshot: () => [] }) } },
    document: { getElementById: () => ({ textContent: "" }) },
    openDb: async () => { calls.push("openDb"); return {}; },
    checkLocalStorageAvailable: () => true
  };
  for (const name of ["restoreTheme", "restoreLogoAnimationSetting", "restoreEditorCaretAnimationSettings",
    "restoreImageBlockSize", "restoreCollectionSortOrder", "restoreGlobalFontSettings", "restoreAiSettings",
    "consumeReturnedFontSelection", "initializeResponsiveLayout", "renderAiSettings"]) sandbox[name] = () => {};
  // The real init prefix calls renderAiUi before its first await. Keep that order,
  // and exercise the actual diagnostic renderer; unrelated UI setup is stubbed.
  const initStart = app.indexOf("async function init() {");
  const firstDbAwait = app.indexOf("  db = await openDb();", initStart);
  assert.ok(initStart >= 0 && firstDbAwait > initStart);
  const initPrefix = app.slice(initStart, firstDbAwait + "  db = await openDb();".length) + "\n}";
  const declaration = "const aiDiagnostics = window.MemoNexusAiDiagnostics.createStore({ onExpire: renderAiDiagnostics });";
  const declarationIndex = app.indexOf(declaration);
  const startupIndex = app.indexOf("void runGuardedStartup({");
  assert.ok(declarationIndex >= 0 && startupIndex >= 0);
  const invoke = "startupResult = runGuardedStartup({ start: init });";
  const ordered = declarationIndex < startupIndex ? declaration + "\n" + invoke : invoke + "\n" + declaration;
  vm.createContext(sandbox);
  vm.runInContext(initPrefix + "\n" + source("renderAiDiagnostics")
    + "\nfunction renderAiUi() { renderAiDiagnostics(); }\n" + ordered, sandbox);
  const result = await sandbox.startupResult;
  assert.equal(result.ok, true, result.error?.message);
  assert.deepEqual(calls, ["openDb"]);
});
