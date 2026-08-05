const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AI_CONNECTION_STATES,
  AI_GENERATION_STATES,
  classifyModelFamily,
  createNdjsonParser,
  groupModels,
  isLoopbackBaseUrl,
  normalizeAiSettings,
  normalizeModels,
  resolveSavedAiState,
  withAiProviderSettings
} = require("./ai-provider");

test("AI settings default to disabled local Ollama", () => {
  const settings = normalizeAiSettings({});
  assert.equal(settings.enabled, false);
  assert.equal(settings.provider, "ollama");
  assert.equal(settings.baseUrl, "http://127.0.0.1:11434");
  assert.equal(isLoopbackBaseUrl(settings.baseUrl), true);
  assert.equal(isLoopbackBaseUrl("https://ollama.example.com"), false);
});

test("legacy AI settings migrate into the Ollama provider settings", () => {
  const settings = normalizeAiSettings({
    enabled: true,
    baseUrl: "http://localhost:11434",
    selectedModel: "qwen3.5:latest"
  });
  assert.equal(settings.provider, "ollama");
  assert.equal(settings.providers.ollama.baseUrl, "http://localhost:11434");
  assert.equal(settings.providers.ollama.selectedModel, "qwen3.5:latest");
  assert.equal(settings.geminiApiKey, "");
});

test("provider-specific settings survive switching between Ollama and Gemini", () => {
  const ollama = normalizeAiSettings({ baseUrl: "http://localhost:11434", selectedModel: "phi4-mini" });
  const gemini = normalizeAiSettings(withAiProviderSettings(ollama, "gemini", {
    apiKey: "test-key",
    selectedModel: "models/gemini-3.6-flash"
  }));
  const returned = normalizeAiSettings(withAiProviderSettings(gemini, "ollama"));
  assert.equal(gemini.provider, "gemini");
  assert.equal(gemini.geminiApiKey, "test-key");
  assert.equal(returned.provider, "ollama");
  assert.equal(returned.baseUrl, "http://localhost:11434");
  assert.equal(returned.selectedModel, "phi4-mini");
  assert.equal(returned.providers.gemini.selectedModel, "models/gemini-3.6-flash");
});

test("clearing an invalid provider model does not restore the previous selection", () => {
  const settings = withAiProviderSettings({ provider: "gemini", geminiApiKey: "test-key", selectedModel: "models/removed" }, "gemini", { selectedModel: "" });
  assert.equal(settings.selectedModel, "");
  assert.equal(settings.providers.gemini.selectedModel, "");
});

const verifiedDraft = (overrides = {}) => ({
  enabled: true,
  baseUrl: "http://127.0.0.1:11434",
  selectedModel: "qwen3.5:latest",
  timeoutMs: 60000,
  ...overrides
});
const verifiedModels = [{ name: "qwen3.5:latest" }, { name: "phi4-mini:latest" }];

test("saved AI state preserves a verified endpoint, models, and selected model", () => {
  const state = resolveSavedAiState({
    draftSettings: verifiedDraft(),
    modelsEndpoint: "http://127.0.0.1:11434",
    draftConnection: AI_CONNECTION_STATES.CONNECTED,
    models: verifiedModels
  });
  assert.deepEqual(state, { preserveModels: true, connection: AI_CONNECTION_STATES.CONNECTED, generation: AI_GENERATION_STATES.IDLE });
});

test("verified connection without a selected model remains connected but requires a model", () => {
  const state = resolveSavedAiState({
    draftSettings: verifiedDraft({ selectedModel: "" }),
    modelsEndpoint: "http://127.0.0.1:11434",
    draftConnection: AI_CONNECTION_STATES.CONNECTED,
    models: verifiedModels
  });
  assert.equal(state.preserveModels, true);
  assert.equal(state.connection, AI_CONNECTION_STATES.CONNECTED);
  assert.equal(state.generation, AI_GENERATION_STATES.MODEL_REQUIRED);
});

test("unverified or changed endpoint discards connection results", () => {
  for (const input of [
    { modelsEndpoint: "http://127.0.0.1:11434", draftConnection: AI_CONNECTION_STATES.UNCHECKED },
    { modelsEndpoint: "http://localhost:11434", draftConnection: AI_CONNECTION_STATES.CONNECTED },
    { modelsEndpoint: "http://127.0.0.1:11434", draftConnection: AI_CONNECTION_STATES.CONNECTED, models: [] }
  ]) {
    const state = resolveSavedAiState({ draftSettings: verifiedDraft(), models: verifiedModels, ...input });
    assert.equal(state.preserveModels, false);
    assert.equal(state.generation, AI_GENERATION_STATES.DISCONNECTED);
  }
});

test("invalid selected model never becomes generation-ready", () => {
  const state = resolveSavedAiState({
    draftSettings: verifiedDraft({ selectedModel: "missing-model" }),
    modelsEndpoint: "http://127.0.0.1:11434",
    draftConnection: AI_CONNECTION_STATES.CONNECTED,
    models: verifiedModels
  });
  assert.equal(state.connection, AI_CONNECTION_STATES.CONNECTED);
  assert.equal(state.generation, AI_GENERATION_STATES.MODEL_REQUIRED);
});

test("disabled AI always resolves to disabled without preserving models", () => {
  const state = resolveSavedAiState({
    draftSettings: verifiedDraft({ enabled: false }),
    modelsEndpoint: "http://127.0.0.1:11434",
    draftConnection: AI_CONNECTION_STATES.CONNECTED,
    models: verifiedModels
  });
  assert.deepEqual(state, { preserveModels: false, connection: AI_CONNECTION_STATES.UNCHECKED, generation: AI_GENERATION_STATES.DISABLED });
});

test("a verified Gemini endpoint preserves Gemini models", () => {
  const state = resolveSavedAiState({
    draftSettings: normalizeAiSettings({ enabled: true, provider: "gemini", geminiApiKey: "test-key", selectedModel: "models/gemini-3.6-flash" }),
    modelsEndpoint: "gemini",
    draftConnection: AI_CONNECTION_STATES.CONNECTED,
    models: [{ name: "models/gemini-3.6-flash" }]
  });
  assert.equal(state.preserveModels, true);
  assert.equal(state.generation, AI_GENERATION_STATES.IDLE);
});

test("verified model families are detected case-insensitively", () => {
  assert.equal(classifyModelFamily("QWEN2.5:7b").id, "qwen");
  assert.equal(classifyModelFamily("phi4-mini").id, "phi");
  assert.equal(classifyModelFamily("IBM-GRANITE:latest").id, "granite");
  assert.equal(classifyModelFamily("llama3").verified, false);
});

test("models are normalized, deduplicated, and grouped", () => {
  const models = normalizeModels([
    { name: "llama3" },
    { model: "qwen2.5:7b" },
    { name: "qwen2.5:7b" },
    { name: "" }
  ]);
  assert.deepEqual(models.map((model) => model.id), ["qwen2.5:7b", "llama3"]);
  const groups = groupModels(models);
  assert.equal(groups.verified.length, 1);
  assert.equal(groups.other.length, 1);
});

test("NDJSON parser preserves split multibyte-independent chunks", () => {
  const parser = createNdjsonParser();
  assert.deepEqual(parser.push('{"message":{"content":"A"}}\n{"message":'), [
    { message: { content: "A" } }
  ]);
  assert.deepEqual(parser.push('{"content":"B"},"done":true}\n'), [
    { message: { content: "B" }, done: true }
  ]);
  assert.deepEqual(parser.finish(), []);
});

test("NDJSON parser rejects malformed responses", () => {
  const parser = createNdjsonParser();
  assert.throws(() => parser.push("not-json\n"), (error) => error.code === "invalid_response");
});
