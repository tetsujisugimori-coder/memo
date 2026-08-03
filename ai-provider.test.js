const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyModelFamily,
  createNdjsonParser,
  groupModels,
  isLoopbackBaseUrl,
  normalizeAiSettings,
  normalizeModels
} = require("./ai-provider");

test("AI settings default to disabled local Ollama", () => {
  const settings = normalizeAiSettings({});
  assert.equal(settings.enabled, false);
  assert.equal(settings.baseUrl, "http://127.0.0.1:11434");
  assert.equal(isLoopbackBaseUrl(settings.baseUrl), true);
  assert.equal(isLoopbackBaseUrl("https://ollama.example.com"), false);
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
