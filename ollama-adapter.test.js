const test = require("node:test");
const assert = require("node:assert/strict");

const { OllamaAdapter } = require("./ollama-adapter");

function jsonResponse(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => payload
  };
}

function streamResponse(chunks) {
  let index = 0;
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: encoder.encode(chunks[index++]) };
          }
        };
      }
    }
  };
}

test("connection check returns normalized local models", async () => {
  const adapter = new OllamaAdapter({ fetchImpl: async () => jsonResponse({ models: [{ name: "Qwen2.5" }] }) });
  const result = await adapter.checkConnection();
  assert.equal(result.connected, true);
  assert.equal(result.hasModels, true);
  assert.equal(result.models[0].family, "qwen");
});

test("connection check distinguishes an empty model list", async () => {
  const adapter = new OllamaAdapter({ fetchImpl: async () => jsonResponse({ models: [] }) });
  const result = await adapter.checkConnection();
  assert.equal(result.connected, true);
  assert.equal(result.hasModels, false);
});

test("connection failures receive a stable error code", async () => {
  const adapter = new OllamaAdapter({ fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(adapter.checkConnection(), (error) => error.code === "connection");
});

test("invalid model-list responses are rejected", async () => {
  const adapter = new OllamaAdapter({ fetchImpl: async () => jsonResponse({ unexpected: [] }) });
  await assert.rejects(adapter.listModels(), (error) => error.code === "invalid_response");
});

test("Ollama error responses remain provider errors", async () => {
  const adapter = new OllamaAdapter({
    fetchImpl: async () => jsonResponse({ error: "server busy" }, { ok: false, status: 500 })
  });
  await assert.rejects(adapter.listModels(), (error) => error.code === "provider" && error.status === 500);
});

test("connection checks time out", async () => {
  const adapter = new OllamaAdapter({
    timeoutMs: 5,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    })
  });
  await assert.rejects(adapter.checkConnection(), (error) => error.code === "timeout");
});

test("streaming generation joins split NDJSON events", async () => {
  const adapter = new OllamaAdapter({
    fetchImpl: async () => streamResponse([
      '{"message":{"content":"こん"}}\n{"message":',
      '{"content":"にちは"}}\n{"done":true,"model":"qwen"}\n'
    ])
  });
  const events = [];
  for await (const event of adapter.generate({ model: "qwen", messages: [] })) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["text", "text", "done"]);
  assert.equal(events.filter((event) => event.type === "text").map((event) => event.content).join(""), "こんにちは");
});

test("missing model responses receive a stable error code", async () => {
  const adapter = new OllamaAdapter({
    fetchImpl: async () => jsonResponse({ error: "model not found" }, { ok: false, status: 404 })
  });
  await assert.rejects(async () => {
    for await (const _event of adapter.generate({ model: "missing", messages: [] })) {}
  }, (error) => error.code === "model_missing");
});

test("generation rejects a response without a readable stream", async () => {
  const adapter = new OllamaAdapter({ fetchImpl: async () => ({ ok: true, status: 200, body: null }) });
  await assert.rejects(async () => {
    for await (const _event of adapter.generate({ model: "qwen", messages: [] })) {}
  }, (error) => error.code === "invalid_response");
});

test("external abort stops generation", async () => {
  const controller = new AbortController();
  const adapter = new OllamaAdapter({
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    })
  });
  const generation = (async () => {
    for await (const _event of adapter.generate({ model: "qwen", messages: [], signal: controller.signal })) {}
  })();
  controller.abort();
  await assert.rejects(generation, (error) => error.code === "aborted");
});
