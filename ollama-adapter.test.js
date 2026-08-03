const test = require("node:test");
const assert = require("node:assert/strict");

const { OllamaAdapter, combinedAbortSignal } = require("./ollama-adapter");

function jsonResponse(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => payload
  };
}

function streamResponse(chunks, delayMs = 0) {
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
            if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
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

test("stream activity resets the inactivity timeout", async () => {
  const adapter = new OllamaAdapter({
    timeoutMs: 15,
    fetchImpl: async () => streamResponse([
      '{"message":{"content":"a"}}\n',
      '{"message":{"content":"b"}}\n',
      '{"done":true}\n'
    ], 10)
  });
  const events = [];
  for await (const event of adapter.generate({ model: "qwen", messages: [] })) events.push(event);
  assert.equal(events.filter((event) => event.type === "text").map((event) => event.content).join(""), "ab");
});

test("stream reader is cancelled when generation is stopped early", async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const adapter = new OllamaAdapter({
    fetchImpl: async () => ({ ok: true, status: 200, body: { getReader: () => ({
      read: async () => ({ done: false, value: encoder.encode('{"message":{"content":"a"}}\n') }),
      cancel: async () => { cancelled = true; }
    }) } })
  });
  const generation = adapter.generate({ model: "qwen", messages: [] });
  await generation.next();
  await generation.return();
  assert.equal(cancelled, true);
});

test("inactivity watchdog can be reset and cleaned up", () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = new Map();
  let nextId = 0;
  global.setTimeout = (callback) => { const id = ++nextId; timers.set(id, callback); return id; };
  global.clearTimeout = (id) => timers.delete(id);
  try {
    const state = combinedAbortSignal(null, 100);
    assert.equal(timers.size, 1);
    state.markActivity();
    assert.equal(timers.size, 1);
    const callback = [...timers.values()][0];
    callback();
    assert.equal(state.didTimeout(), true);
    state.cleanup();
    assert.equal(timers.size, 0);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});
