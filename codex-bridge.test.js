"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createBridgeApplication } = require("./codex-bridge.js");

const LOCAL_ORIGIN = "http://127.0.0.1:8765";
const PUBLIC_ORIGIN = "https://tetsujisugimori-coder.github.io";
const TOKEN = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";

function fakeRuntimeManager({ holdStream = false } = {}) {
  const calls = [];
  const runtime = { initialized: true, tempCwd: "temporary-empty-directory" };
  const state = { calls, closedStreams: 0, ensureCalls: 0, shutdownCalls: 0 };
  return {
    state,
    async ensureServer() { state.ensureCalls += 1; return runtime; },
    async send(activeRuntime, method, params, options = {}) {
      calls.push({ activeRuntime, method, params });
      if (method === "thread/start") return { thread: { id: "thread-new" } };
      if (method === "thread/resume") return { thread: { id: params.threadId } };
      if (method === "turn/start") {
        const result = { turn: { id: "turn-1" } };
        options.onResult?.(result);
        return result;
      }
      return {};
    },
    attachStream(activeRuntime, turnId, res, initialEvent) {
      res.once("close", () => { state.closedStreams += 1; });
      res.write(`data: ${JSON.stringify(initialEvent)}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "delta", delta: "統合回答" })}\n\n`);
      if (!holdStream) {
        res.write(`data: ${JSON.stringify({ type: "done", threadId: "thread-new", text: "統合回答" })}\n\n`);
        res.end();
      }
      return true;
    },
    detachStream() { state.closedStreams += 1; return true; },
    discardTurn() { return true; },
    failStream() { return false; },
    getLastStartupError() { return ""; },
    async shutdown() { state.shutdownCalls += 1; }
  };
}

async function startApplication(t, options = {}) {
  const runtimeManager = options.runtimeManager || fakeRuntimeManager(options);
  const logs = [];
  const application = createBridgeApplication({
    runtimeManager,
    token: TOKEN,
    logger: { error: (message) => logs.push(String(message)) }
  });
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => application.shutdown());
  const address = application.server.address();
  assert.equal(address.address, "127.0.0.1");
  return { application, baseUrl: `http://127.0.0.1:${address.port}`, logs, runtimeManager };
}

function requestHeaders(origin, authorization = "") {
  const headers = { Origin: origin };
  if (authorization) headers.Authorization = authorization;
  return headers;
}

test("ローカル・公開Originを許可し類似Origin・path・nullをCORSなしで拒否する", async (t) => {
  const { baseUrl } = await startApplication(t);
  for (const origin of [LOCAL_ORIGIN, new URL(`${PUBLIC_ORIGIN}/memo/`).origin]) {
    const response = await fetch(`${baseUrl}/health`, { headers: requestHeaders(origin) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.deepEqual(await response.json(), { ok: true, status: "running", authRequired: true });
  }
  for (const origin of [
    `${PUBLIC_ORIGIN}/memo/`,
    "https://evil-tetsujisugimori-coder.github.io",
    "https://tetsujisugimori-coder.github.io.evil.example",
    "null"
  ]) {
    const response = await fetch(`${baseUrl}/health`, { headers: requestHeaders(origin) });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});

test("OPTIONSはrouteごとのmethod・headerとPrivate Networkだけを許可する", async (t) => {
  const { baseUrl } = await startApplication(t);
  const response = await fetch(`${baseUrl}/chat`, {
    method: "OPTIONS",
    headers: {
      Origin: PUBLIC_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type",
      "Access-Control-Request-Private-Network": "true"
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), PUBLIC_ORIGIN);
  assert.equal(response.headers.get("access-control-allow-methods"), "POST");
  assert.equal(response.headers.get("access-control-allow-headers"), "Authorization, Content-Type");
  assert.equal(response.headers.get("access-control-allow-private-network"), "true");

  const rejected = await fetch(`${baseUrl}/chat`, {
    method: "OPTIONS",
    headers: {
      Origin: PUBLIC_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, x-unsafe-header"
    }
  });
  assert.equal(rejected.status, 400);
});

test("healthは公開情報を最小化しtokenなし・不正形式・不一致を同じ401で拒否する", async (t) => {
  const { baseUrl, logs, runtimeManager } = await startApplication(t);
  const publicHealth = await fetch(`${baseUrl}/health`, { headers: requestHeaders(PUBLIC_ORIGIN) });
  const publicBody = await publicHealth.json();
  assert.deepEqual(publicBody, { ok: true, status: "running", authRequired: true });
  assert.deepEqual(Object.keys(publicBody).sort(), ["authRequired", "ok", "status"]);
  assert.equal(runtimeManager.state.ensureCalls, 0);

  const secretProbe = "wrong-secret-that-must-never-appear-123456789";
  for (const authorization of [secretProbe, `Basic ${secretProbe}`, `Bearer ${secretProbe}`]) {
    const response = await fetch(`${baseUrl}/health`, { headers: requestHeaders(PUBLIC_ORIGIN, authorization) });
    assert.equal(response.status, 401);
    const body = await response.text();
    assert.equal(body.includes(secretProbe), false);
    assert.deepEqual(JSON.parse(body), { error: "認証に失敗しました" });
  }
  assert.equal(logs.join("\n").includes(secretProbe), false);
  assert.equal(runtimeManager.state.ensureCalls, 0);

  const connected = await fetch(`${baseUrl}/health`, { headers: requestHeaders(PUBLIC_ORIGIN, `Bearer ${TOKEN}`) });
  assert.equal(connected.status, 200);
  assert.deepEqual(await connected.json(), { ok: true, status: "connected" });
  assert.equal(runtimeManager.state.ensureCalls, 1);
});

test("chatは認証後だけthread開始・再開・turn開始とSSEへ進む", async (t) => {
  const { baseUrl, runtimeManager } = await startApplication(t);
  for (const authorization of ["", "Bearer wrong-token-value-that-is-long-enough-123456", `Basic ${TOKEN}`]) {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { ...requestHeaders(PUBLIC_ORIGIN, authorization), "Content-Type": "application/json" },
      body: JSON.stringify({ message: "認証前には送らない" })
    });
    assert.equal(response.status, 401);
  }
  assert.equal(runtimeManager.state.ensureCalls, 0);
  assert.equal(runtimeManager.state.calls.length, 0);

  const first = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { ...requestHeaders(PUBLIC_ORIGIN, `Bearer ${TOKEN}`), "Content-Type": "application/json" },
    body: JSON.stringify({ message: "短い会話", threadId: "" })
  });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("access-control-allow-origin"), PUBLIC_ORIGIN);
  const events = (await first.text()).trim().split(/\n\n/).map((frame) => JSON.parse(frame.slice(6)));
  assert.deepEqual(events.map((event) => event.type), ["thread", "delta", "done"]);
  assert.deepEqual(runtimeManager.state.calls.map((call) => call.method), ["thread/start", "turn/start"]);

  runtimeManager.state.calls.length = 0;
  const resumed = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { ...requestHeaders(LOCAL_ORIGIN, `Bearer ${TOKEN}`), "Content-Type": "application/json" },
    body: JSON.stringify({ message: "同じメモで再開", threadId: "thread-saved" })
  });
  assert.equal(resumed.status, 200);
  await resumed.text();
  assert.deepEqual(runtimeManager.state.calls.map((call) => call.method), ["thread/resume", "turn/start"]);
  assert.equal(runtimeManager.state.calls[0].params.threadId, "thread-saved");
});

test("ストリーミング中のブラウザ切断でresponse参照を解放できる", async (t) => {
  const runtimeManager = fakeRuntimeManager({ holdStream: true });
  const { baseUrl } = await startApplication(t, { runtimeManager });
  await new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}/chat`, {
      method: "POST",
      headers: { ...requestHeaders(PUBLIC_ORIGIN, `Bearer ${TOKEN}`), "Content-Type": "application/json" }
    }, (response) => {
      response.once("data", () => response.destroy());
      response.once("close", resolve);
    });
    request.once("error", (error) => {
      if (error.code === "ECONNRESET") resolve();
      else reject(error);
    });
    request.end(JSON.stringify({ message: "切断確認" }));
  });
  for (let attempt = 0; attempt < 50 && runtimeManager.state.closedStreams === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(runtimeManager.state.closedStreams, 1);
});
