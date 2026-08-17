"use strict";

const http = require("node:http");
const { createRuntimeManager } = require("./codex-bridge-runtime.js");
const {
  authorizeHeader,
  loadAllowedOrigins,
  parseAllowedOriginList,
  validateConfiguredToken
} = require("./codex-bridge-config.js");

function parsePort(value) {
  const port = Number(value || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("CODEX_BRIDGE_PORTには1から65535の整数を指定してください。");
  }
  return port;
}

function originAllowed(origin, origins) {
  return !origin || origin !== "null" && origins.has(origin);
}

function appendVary(res, value) {
  const current = String(res.getHeader("Vary") || "");
  const values = new Set(current.split(",").map((item) => item.trim()).filter(Boolean));
  values.add(value);
  res.setHeader("Vary", Array.from(values).join(", "));
}

function setCorsHeaders(res, origin, origins) {
  if (!origin || !origins.has(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  appendVary(res, "Origin");
}

function json(res, status, body, origin, origins, includeCors = true) {
  if (includeCors) setCorsHeaders(res, origin, origins);
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

function requestedHeadersAllowed(value, allowedHeaders) {
  if (!value) return true;
  return String(value).split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean)
    .every((header) => allowedHeaders.has(header));
}

function handlePreflight(req, res, origin, origins) {
  const route = req.url === "/health"
    ? { method: "GET", headers: new Set(["authorization"]) }
    : req.url === "/chat"
      ? { method: "POST", headers: new Set(["authorization", "content-type"]) }
      : null;
  if (!route) return json(res, 404, { error: "Not found" }, origin, origins);
  const requestedMethod = String(req.headers["access-control-request-method"] || "").toUpperCase();
  if (requestedMethod !== route.method) {
    return json(res, 405, { error: "許可されていないプリフライトです" }, origin, origins);
  }
  if (!requestedHeadersAllowed(req.headers["access-control-request-headers"], route.headers)) {
    return json(res, 400, { error: "許可されていないリクエストヘッダーです" }, origin, origins);
  }
  setCorsHeaders(res, origin, origins);
  res.statusCode = 204;
  res.setHeader("Access-Control-Allow-Methods", route.method);
  res.setHeader("Access-Control-Allow-Headers", Array.from(route.headers).map((header) => header === "content-type" ? "Content-Type" : "Authorization").join(", "));
  if (req.headers["access-control-request-private-network"] === "true") {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  appendVary(res, "Access-Control-Request-Headers");
  return res.end();
}

function createBridgeApplication(options = {}) {
  const env = options.env || process.env;
  const runtimeManager = options.runtimeManager || createRuntimeManager();
  const origins = options.origins
    ? new Set(parseAllowedOriginList(Array.from(options.origins).join(","), "allowedOrigins"))
    : loadAllowedOrigins(env);
  const expectedToken = validateConfiguredToken(options.token === undefined ? env.CODEX_BRIDGE_TOKEN : options.token);
  const logger = options.logger || console;

  const server = http.createServer(async (req, res) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    if (!originAllowed(origin, origins)) {
      return json(res, 403, { error: "Originが許可されていません" }, origin, origins, false);
    }
    if (req.method === "OPTIONS") return handlePreflight(req, res, origin, origins);

    if (req.method === "GET" && req.url === "/health") {
      if (req.headers.authorization === undefined) {
        return json(res, 200, { ok: true, status: "running", authRequired: true }, origin, origins);
      }
      if (!authorizeHeader(req.headers.authorization, expectedToken)) {
        return json(res, 401, { error: "認証に失敗しました" }, origin, origins);
      }
      try {
        const runtime = await runtimeManager.ensureServer();
        return json(res, 200, { ok: Boolean(runtime.initialized), status: runtime.initialized ? "connected" : "unavailable" }, origin, origins);
      } catch {
        logger.error("Codex App Serverを初期化できませんでした。");
        return json(res, 503, { ok: false, status: "unavailable" }, origin, origins);
      }
    }

    if (req.method !== "POST" || req.url !== "/chat") {
      return json(res, 404, { error: "Not found" }, origin, origins);
    }
    if (!authorizeHeader(req.headers.authorization, expectedToken)) {
      return json(res, 401, { error: "認証に失敗しました" }, origin, origins);
    }

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
      if (!message) return json(res, 400, { error: "メッセージを入力してください" }, origin, origins);
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
          setCorsHeaders(res, origin, origins);
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
        json(res, 503, { error: message }, origin, origins);
      }
    }
  });

  async function shutdown() {
    const serverClosed = server.listening ? new Promise((resolve) => server.close(resolve)) : Promise.resolve();
    await runtimeManager.shutdown();
    await serverClosed;
  }

  return { origins, runtimeManager, server, shutdown };
}

if (require.main === module) {
  let application;
  try {
    application = createBridgeApplication();
    const port = parsePort(process.env.CODEX_BRIDGE_PORT);
    application.server.listen(port, "127.0.0.1", () => console.log(`Memo Nexus Codex bridge: http://127.0.0.1:${port}`));
  } catch (error) {
    console.error(`[Codex bridge] ${error.message}`);
    process.exitCode = 1;
  }
  if (application) {
    const stop = () => {
      application.shutdown().catch((error) => console.error(error)).finally(() => { process.exitCode = 0; });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
}

module.exports = {
  createBridgeApplication,
  handlePreflight,
  originAllowed,
  parsePort,
  safeThreadOptions
};
