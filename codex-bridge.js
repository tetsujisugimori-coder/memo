"use strict";

const http = require("node:http");
const { createRuntimeManager } = require("./codex-bridge-runtime.js");

const port = Number(process.env.CODEX_BRIDGE_PORT || 8787);
const origins = new Set((process.env.CODEX_BRIDGE_ORIGINS || "http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:8765,http://localhost:8765").split(","));
const runtimeManager = createRuntimeManager();

function allowed(origin) {
  return !origin || origins.has(origin);
}

function json(res, status, body, origin) {
  if (origin && origins.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function safeThreadOptions(runtime) {
  return {
    cwd: runtime.tempCwd,
    sandbox: "read-only",
    approvalPolicy: "never",
    developerInstructions: "Memo Nexusの会話専用です。ファイルやコマンド、GitHub、MCP、動的ツールを使わず、会話テキストだけで応答してください。"
  };
}

async function readBody(req) {
  let value = "";
  for await (const chunk of req) value += chunk;
  return JSON.parse(value || "{}");
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  if (!allowed(origin)) return json(res, 403, { error: "ローカル開発Originのみ許可されています" }, origin);
  if (req.method === "OPTIONS") {
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") {
    try {
      const runtime = await runtimeManager.ensureServer();
      return json(res, 200, { ok: runtime.initialized, status: runtime.initialized ? "connected" : "ローカル連携が起動していません" }, origin);
    } catch (error) {
      return json(res, 200, { ok: false, status: runtimeManager.getLastStartupError() || error.message || "ローカル連携が起動していません" }, origin);
    }
  }
  if (req.method !== "POST" || req.url !== "/chat") return json(res, 404, { error: "Not found" }, origin);

  let sse = false;
  let activeRuntime = null;
  let activeTurnId = "";
  let clientDisconnected = false;
  req.once("aborted", () => {
    clientDisconnected = true;
    if (activeRuntime && activeTurnId) runtimeManager.detachStream(activeRuntime, activeTurnId, res);
  });
  try {
    const body = await readBody(req);
    const message = String(body.message || "").trim();
    if (!message) return json(res, 400, { error: "メッセージを入力してください" }, origin);
    const runtime = await runtimeManager.ensureServer();
    let threadId = String(body.threadId || "");
    if (threadId) {
      await runtimeManager.send(runtime, "thread/resume", { threadId, ...safeThreadOptions(runtime) });
    } else {
      const created = await runtimeManager.send(runtime, "thread/start", { ...safeThreadOptions(runtime), ephemeral: false });
      threadId = created.thread.id;
    }
    await runtimeManager.send(runtime, "turn/start", {
      threadId,
      input: [{ type: "text", text: message }],
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false }
    }, {
      onResult: (result) => {
        activeRuntime = runtime;
        activeTurnId = String(result?.turn?.id || "");
        if (!activeTurnId) throw new Error("Codex App Serverからturn IDが返されませんでした。");
        if (clientDisconnected || res.destroyed) {
          runtimeManager.discardTurn(runtime, activeTurnId);
          return;
        }
        if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        sse = true;
        if (!runtimeManager.attachStream(runtime, activeTurnId, res, { type: "thread", threadId })) {
          throw new Error("CodexのSSE接続を開始できませんでした。");
        }
      }
    });
  } catch (error) {
    const message = runtimeManager.getLastStartupError() || error.message || "Codexローカル連携に接続できません";
    if (clientDisconnected || res.destroyed) {
      if (activeRuntime && activeTurnId) runtimeManager.discardTurn(activeRuntime, activeTurnId);
      return;
    }
    if (sse || res.headersSent) {
      if (activeRuntime && activeTurnId && runtimeManager.failStream(activeRuntime, activeTurnId, error)) return;
      if (!res.writableEnded) {
        try { res.write(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`); }
        catch (_) {}
        finally {
          if (!res.writableEnded && !res.destroyed) {
            try { res.end(); }
            catch (_) { if (!res.destroyed) try { res.destroy(); } catch (_) {} }
          }
        }
      }
    } else {
      json(res, 503, { error: message }, origin);
    }
  }
});

async function shutdown() {
  const serverClosed = server.listening ? new Promise((resolve) => server.close(resolve)) : Promise.resolve();
  await runtimeManager.shutdown();
  await serverClosed;
}

if (require.main === module) {
  server.listen(port, "127.0.0.1", () => console.log(`Memo Nexus Codex bridge: http://127.0.0.1:${port}`));
  const stop = () => {
    shutdown().catch((error) => console.error(error)).finally(() => { process.exitCode = 0; });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

module.exports = { runtimeManager, safeThreadOptions, server, shutdown };
