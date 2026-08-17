"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_RPC_TIMEOUT_MS = 15000;
const DEFAULT_EXIT_TIMEOUT_MS = 2000;
const DEFAULT_FORCE_EXIT_TIMEOUT_MS = 500;

function errorMessage(error, fallback = "Codex App Serverとの接続が終了しました。") {
  return error?.message || String(error || fallback);
}

function createRuntimeManager(options = {}) {
  const spawnChild = options.spawnChild || ((cwd) => spawn("codex", ["app-server", "--stdio"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  }));
  const createTempDir = options.createTempDir || (() => fs.mkdtempSync(path.join(os.tmpdir(), "memo-nexus-codex-")));
  const removeTempDir = options.removeTempDir || ((cwd) => fs.promises.rm(cwd, { recursive: true, force: true }));
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const rpcTimeoutMs = options.rpcTimeoutMs || DEFAULT_RPC_TIMEOUT_MS;
  const exitTimeoutMs = options.exitTimeoutMs || DEFAULT_EXIT_TIMEOUT_MS;
  const forceExitTimeoutMs = options.forceExitTimeoutMs || DEFAULT_FORCE_EXIT_TIMEOUT_MS;
  const diagnose = options.diagnose || ((message) => console.error(`[Codex bridge] ${message}`));
  let currentRuntime = null;
  let nextRuntimeId = 0;
  let nextRpcId = 0;
  let lastStartupError = "";
  let shuttingDown = false;
  const runtimes = new Set();

  function createRuntime(tempCwd) {
    let resolveExit;
    const exitPromise = new Promise((resolve) => { resolveExit = resolve; });
    return {
      id: ++nextRuntimeId,
      child: null,
      tempCwd,
      initialized: false,
      startupPromise: null,
      startupError: "",
      buffer: "",
      pending: new Map(),
      streams: new Map(),
      turnErrors: new Map(),
      disposed: false,
      cleanupPromise: null,
      exited: false,
      exitPromise,
      resolveExit,
      killSent: false,
      forceKillSent: false
    };
  }

  function markExited(runtime) {
    if (runtime.exited) return;
    runtime.exited = true;
    runtime.resolveExit();
  }

  function writeSse(state, event) {
    if (state.ended || state.res.writableEnded) return false;
    state.res.write(`data: ${JSON.stringify(event)}\n\n`);
    return true;
  }

  function endStream(runtime, turnId, event) {
    const state = runtime.streams.get(turnId);
    if (!state || state.ended) return false;
    runtime.streams.delete(turnId);
    state.ended = true;
    if (!state.res.writableEnded) {
      state.res.write(`data: ${JSON.stringify(event)}\n\n`);
      state.res.end();
    }
    return true;
  }

  function failRuntimeStreams(runtime, error) {
    const message = errorMessage(error);
    for (const turnId of Array.from(runtime.streams.keys())) {
      endStream(runtime, turnId, { type: "error", error: message });
    }
  }

  function waitForExit(runtime, timeoutMs) {
    if (!runtime.child || runtime.exited || runtime.child.exitCode !== null && runtime.child.exitCode !== undefined) {
      markExited(runtime);
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        clearTimer(timer);
        resolve(value);
      };
      const timer = setTimer(() => finish(false), timeoutMs);
      runtime.exitPromise.then(() => finish(true));
    });
  }

  function disposeRuntime(runtime, error = new Error("Codex App Serverとの接続が終了しました。")) {
    if (!runtime) return Promise.resolve();
    if (runtime.cleanupPromise) return runtime.cleanupPromise;

    runtime.disposed = true;
    runtime.initialized = false;
    const wasCurrent = currentRuntime === runtime;
    if (wasCurrent) {
      currentRuntime = null;
      lastStartupError = errorMessage(error);
    }
    for (const waiter of Array.from(runtime.pending.values())) waiter.rejectOnce(error);
    runtime.pending.clear();
    failRuntimeStreams(runtime, error);
    runtime.turnErrors.clear();

    let resolveCleanup;
    let rejectCleanup;
    runtime.cleanupPromise = new Promise((resolve, reject) => { resolveCleanup = resolve; rejectCleanup = reject; });
    (async () => {
      const child = runtime.child;
      if (child && !runtime.exited) {
        if (!runtime.killSent) {
          runtime.killSent = true;
          try { child.kill(); } catch (killError) { diagnose(`runtime ${runtime.id} の終了要求に失敗: ${errorMessage(killError)}`); }
        }
        let exited = await waitForExit(runtime, exitTimeoutMs);
        if (!exited && !runtime.forceKillSent) {
          runtime.forceKillSent = true;
          diagnose(`runtime ${runtime.id} の終了待ちがタイムアウトしたため強制終了します。`);
          try { child.kill("SIGKILL"); } catch (killError) { diagnose(`runtime ${runtime.id} の強制終了に失敗: ${errorMessage(killError)}`); }
          exited = await waitForExit(runtime, forceExitTimeoutMs);
        }
        if (!exited) diagnose(`runtime ${runtime.id} の終了を確認できないまま一時ディレクトリの後始末を試みます。`);
      }
      if (runtime.tempCwd) {
        const ownedTempCwd = runtime.tempCwd;
        try {
          await removeTempDir(ownedTempCwd);
          runtime.tempCwd = null;
        } catch (cleanupError) {
          diagnose(`runtime ${runtime.id} の一時ディレクトリを削除できませんでした (${ownedTempCwd}): ${errorMessage(cleanupError)}`);
        }
      }
      runtimes.delete(runtime);
    })().then(resolveCleanup, rejectCleanup);
    return runtime.cleanupPromise;
  }

  function assertWritable(runtime, method) {
    if (!runtime || runtime.disposed) throw new Error("Codex App Serverが起動していません。");
    if (method !== "initialize" && !runtime.initialized) throw new Error("Codex App Serverの初期化が完了していません。");
    if (!runtime.child?.stdin?.writable) throw new Error("Codex App Serverが起動していません。");
  }

  function send(runtime, method, params, timeoutMs = rpcTimeoutMs) {
    try { assertWritable(runtime, method); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const id = ++nextRpcId;
      let settled = false;
      let timeout = null;
      const settle = (kind, value) => {
        if (settled) return false;
        settled = true;
        if (timeout !== null) clearTimer(timeout);
        runtime.pending.delete(id);
        if (kind === "resolve") resolve(value); else reject(value);
        return true;
      };
      const rejectOnce = (error) => settle("reject", error);
      timeout = setTimer(() => {
        const error = new Error(`${method} が時間内に応答しませんでした。`);
        if (rejectOnce(error)) void disposeRuntime(runtime, error);
      }, timeoutMs);
      runtime.pending.set(id, { resolveOnce: (value) => settle("resolve", value), rejectOnce, timeout });
      const failWrite = (cause) => {
        if (!runtime.pending.has(id)) return;
        const error = new Error(`Codex App Serverへ送信できませんでした: ${errorMessage(cause)}`);
        if (rejectOnce(error)) void disposeRuntime(runtime, error);
      };
      try {
        runtime.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
          if (error) failWrite(error);
        });
      } catch (error) {
        failWrite(error);
      }
    });
  }

  function notify(runtime, method, params) {
    try {
      if (method !== "initialized") assertWritable(runtime, method);
      else if (!runtime || runtime.disposed || !runtime.child?.stdin?.writable) throw new Error("Codex App Serverが起動していません。");
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (!error) return resolve();
        const wrapped = new Error(`Codex App Serverへ通知できませんでした: ${errorMessage(error)}`);
        reject(wrapped);
        void disposeRuntime(runtime, wrapped);
      };
      try {
        runtime.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`, finish);
      } catch (error) {
        finish(error);
      }
    });
  }

  function respondToServerRequest(runtime, message) {
    if (runtime.disposed || !runtime.child?.stdin?.writable) return;
    const response = { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "この会話専用ブリッジでは承認・ツール要求を許可しません" } };
    try {
      runtime.child.stdin.write(`${JSON.stringify(response)}\n`, (error) => {
        if (error) void disposeRuntime(runtime, error);
      });
    } catch (error) {
      void disposeRuntime(runtime, error);
    }
  }

  function handleMessage(runtime, message) {
    if (!runtime || runtime.disposed || !message || typeof message !== "object") return;
    if (message.id !== undefined && message.method) return respondToServerRequest(runtime, message);
    if (message.id !== undefined) {
      const waiter = runtime.pending.get(message.id);
      if (!waiter) return;
      if (message.error) waiter.rejectOnce(new Error(message.error.message || "Codex App Server error"));
      else waiter.resolveOnce(message.result);
      return;
    }
    if (message.method === "error") {
      const turnId = message.params?.turnId;
      const messageText = message.params?.error?.message;
      if (turnId && messageText) runtime.turnErrors.set(turnId, { message: messageText, willRetry: Boolean(message.params?.willRetry) });
      return;
    }
    if (message.method === "warning" || message.method === "configWarning") return;
    if (message.method === "item/agentMessage/delta") {
      const state = runtime.streams.get(message.params?.turnId);
      if (!state || state.ended) return;
      const delta = String(message.params?.delta || "");
      state.text += delta;
      try { writeSse(state, { type: "delta", delta }); } catch (_) { runtime.streams.delete(message.params.turnId); state.ended = true; }
      return;
    }
    if (message.method !== "turn/completed") return;
    const turn = message.params?.turn;
    const turnId = turn?.id;
    if (!turnId || !runtime.streams.has(turnId)) return;
    const recordedError = runtime.turnErrors.get(turnId);
    runtime.turnErrors.delete(turnId);
    if (turn.status === "completed") {
      endStream(runtime, turnId, { type: "done", threadId: message.params?.threadId, text: runtime.streams.get(turnId)?.text || "" });
    } else if (turn.status === "failed") {
      endStream(runtime, turnId, { type: "error", error: turn.error?.message || recordedError?.message || "Codexの回答に失敗しました。" });
    } else if (turn.status === "interrupted") {
      endStream(runtime, turnId, { type: "error", error: "Codexの回答が中断されました。" });
    } else {
      endStream(runtime, turnId, { type: "error", error: `Codexの回答が不明な状態で終了しました: ${turn.status || "unknown"}` });
    }
  }

  function handleStdout(runtime, chunk) {
    if (runtime.disposed) return;
    runtime.buffer += String(chunk);
    let index;
    while ((index = runtime.buffer.indexOf("\n")) >= 0) {
      const line = runtime.buffer.slice(0, index).trim();
      runtime.buffer = runtime.buffer.slice(index + 1);
      if (!line) continue;
      try { handleMessage(runtime, JSON.parse(line)); } catch (_) {}
    }
  }

  function bindChild(runtime) {
    const child = runtime.child;
    child.once("error", (error) => {
      const reason = error?.code === "ENOENT" ? new Error("Codex CLIが見つかりません") : error;
      runtime.startupError = errorMessage(reason);
      void disposeRuntime(runtime, reason);
    });
    child.once("exit", (code) => {
      markExited(runtime);
      if (!runtime.disposed) {
        const phase = runtime.initialized ? "異常終了しました" : "初期化前に終了しました";
        void disposeRuntime(runtime, new Error(`Codex App Serverが${phase} (${code ?? "unknown"})。`));
      }
    });
    child.once("close", () => markExited(runtime));
    child.stdout.on("data", (chunk) => handleStdout(runtime, chunk));
    child.stderr.on("data", (chunk) => {
      if (runtime.disposed) return;
      runtime.startupError = String(chunk).trim() || runtime.startupError;
    });
  }

  function startRuntime() {
    let tempCwd;
    try { tempCwd = createTempDir(); } catch (error) { return Promise.reject(error); }
    const runtime = createRuntime(tempCwd);
    runtimes.add(runtime);
    currentRuntime = runtime;
    lastStartupError = "";
    try {
      runtime.child = spawnChild(tempCwd, runtime);
      bindChild(runtime);
    } catch (error) {
      const reason = error?.code === "ENOENT" ? new Error("Codex CLIが見つかりません") : error;
      runtime.startupPromise = disposeRuntime(runtime, reason).then(() => { throw reason; });
      return runtime.startupPromise;
    }
    runtime.startupPromise = (async () => {
      try {
        await send(runtime, "initialize", { clientInfo: { name: "memo-nexus-codex-chat", version: "0.1.1" }, capabilities: {} });
        await notify(runtime, "initialized", {});
        if (runtime.disposed || currentRuntime !== runtime) throw new Error("Codex App Serverの起動が置き換えられました。");
        runtime.initialized = true;
        return runtime;
      } catch (error) {
        const detail = runtime.startupError && !errorMessage(error).includes(runtime.startupError) ? `${errorMessage(error)}: ${runtime.startupError}` : errorMessage(error);
        const reason = new Error(detail);
        await disposeRuntime(runtime, reason);
        throw reason;
      }
    })();
    return runtime.startupPromise;
  }

  function ensureServer() {
    if (shuttingDown) return Promise.reject(new Error("Codexブリッジを終了しています。"));
    if (currentRuntime && !currentRuntime.disposed) {
      if (currentRuntime.initialized && !currentRuntime.child?.killed) return Promise.resolve(currentRuntime);
      if (currentRuntime.startupPromise) return currentRuntime.startupPromise;
    }
    return startRuntime();
  }

  function attachStream(runtime, turnId, res) {
    if (!runtime || runtime.disposed) throw new Error("Codex App Serverとの接続が終了しました。");
    runtime.streams.set(turnId, { res, text: "", ended: false });
  }

  async function shutdown() {
    shuttingDown = true;
    const active = Array.from(runtimes);
    currentRuntime = null;
    await Promise.all(active.map((runtime) => disposeRuntime(runtime, new Error("Codexブリッジを終了しました。"))));
  }

  return {
    attachStream,
    disposeRuntime,
    ensureServer,
    getCurrentRuntime: () => currentRuntime,
    getLastStartupError: () => lastStartupError,
    handleMessage,
    handleStdout,
    notify,
    send,
    shutdown
  };
}

module.exports = { createRuntimeManager, DEFAULT_RPC_TIMEOUT_MS };
