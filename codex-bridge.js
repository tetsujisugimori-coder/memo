"use strict";
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const port = Number(process.env.CODEX_BRIDGE_PORT || 8787);
const origins = new Set((process.env.CODEX_BRIDGE_ORIGINS || "http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:8765,http://localhost:8765").split(","));
let child = null, rpcId = 0, tempCwd = null, initialized = false, startupError = "", buffer = "";
const pending = new Map(); const streams = new Map();
function allowed(origin) { return !origin || origins.has(origin); }
function json(res, status, body, origin) { if (origin && origins.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); }
function send(method, params) { return new Promise((resolve, reject) => { const id = ++rpcId; pending.set(id, { resolve, reject }); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); }); }
function onLine(line) { let message; try { message = JSON.parse(line); } catch { return; }
  if (message.id !== undefined && message.method) { child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "この会話専用ブリッジでは承認・ツール要求を許可しません" } })}\n`); return; }
  if (message.id !== undefined) { const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message || "Codex App Server error")) : waiter.resolve(message.result); return; }
  if (message.method === "item/agentMessage/delta") { const state = streams.get(message.params.turnId); if (state) { state.text += message.params.delta; state.res.write(`data: ${JSON.stringify({ type: "delta", delta: message.params.delta })}\n\n`); } }
  if (message.method === "turn/completed") { const state = streams.get(message.params.turn.id); if (state) { state.res.write(`data: ${JSON.stringify({ type: "done", threadId: message.params.threadId, text: state.text })}\n\n`); state.res.end(); streams.delete(message.params.turn.id); } }
}
async function ensureServer() { if (initialized && child && !child.killed) return; startupError = ""; tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "memo-nexus-codex-"));
  child = spawn("codex", ["app-server", "--stdio"], { cwd: tempCwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.on("error", (error) => { startupError = error.code === "ENOENT" ? "Codex CLIが見つかりません" : error.message; initialized = false; });
  child.on("exit", () => { initialized = false; }); child.stdout.on("data", (chunk) => { buffer += chunk; let index; while ((index = buffer.indexOf("\n")) >= 0) { onLine(buffer.slice(0, index)); buffer = buffer.slice(index + 1); } }); child.stderr.on("data", (chunk) => { startupError = String(chunk).trim() || startupError; });
  await send("initialize", { clientInfo: { name: "memo-nexus-codex-chat", version: "0.1.0" }, capabilities: {} }); initialized = true;
}
function safeThreadOptions() { return { cwd: tempCwd, sandbox: "read-only", approvalPolicy: "never", developerInstructions: "Memo Nexusの会話専用です。ファイルの読み書き、コマンド実行、ネットワーク接続、GitHub、MCP、動的ツールを使わず、会話テキストだけで応答してください。" }; }
async function readBody(req) { let value = ""; for await (const chunk of req) value += chunk; return JSON.parse(value || "{}"); }
const server = http.createServer(async (req, res) => { const origin = req.headers.origin || ""; if (!allowed(origin)) return json(res, 403, { error: "ローカル開発Originのみ許可されています" }, origin);
  if (req.method === "OPTIONS") { if (origin) res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.end(); return; }
  if (req.method === "GET" && req.url === "/health") { try { await ensureServer(); } catch (error) { startupError = startupError || error.message; } return json(res, 200, { ok: initialized, status: initialized ? "connected" : (startupError || "ローカル連携が起動していません") }, origin); }
  if (req.method !== "POST" || req.url !== "/chat") return json(res, 404, { error: "Not found" }, origin);
  try { const body = await readBody(req); const message = String(body.message || "").trim(); if (!message) return json(res, 400, { error: "メッセージを入力してください" }, origin); await ensureServer();
    let threadId = String(body.threadId || ""); if (threadId) await send("thread/resume", { threadId, ...safeThreadOptions() }); else { const created = await send("thread/start", { ...safeThreadOptions(), ephemeral: false }); threadId = created.thread.id; }
    const turn = await send("turn/start", { threadId, input: [{ type: "text", text: message }], approvalPolicy: "never", sandboxPolicy: { type: "readOnly", networkAccess: false } });
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-cache"); streams.set(turn.turn.id, { res, text: "" }); res.write(`data: ${JSON.stringify({ type: "thread", threadId })}\n\n`);
  } catch (error) { json(res, 503, { error: startupError || error.message || "Codexローカル連携に接続できません" }, origin); }
});
server.listen(port, "127.0.0.1", () => console.log(`Memo Nexus Codex bridge: http://127.0.0.1:${port}`));
function shutdown() { server.close(); child?.kill(); if (tempCwd) fs.rmSync(tempCwd, { recursive: true, force: true }); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
