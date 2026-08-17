const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createRuntimeManager } = require("./codex-bridge-runtime.js");

class FakeChild extends EventEmitter {
  constructor({ autoExit = true, onWrite = null } = {}) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.messages = [];
    this.writeCallbacks = [];
    this.killCalls = [];
    this.killed = false;
    this.exitCode = null;
    this.autoExit = autoExit;
    this.onWrite = onWrite;
    this.stdin = {
      writable: true,
      write: (line, callback) => {
        const message = JSON.parse(line);
        this.messages.push(message);
        this.writeCallbacks.push(callback);
        if (this.onWrite) this.onWrite(message, callback, this);
        else callback?.();
        return true;
      }
    };
  }

  respond(id, result = {}) {
    this.stdout.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }

  fail(id, message) {
    this.stdout.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id, error: { message } })}\n`);
  }

  kill(signal = "SIGTERM") {
    this.killCalls.push(signal);
    this.killed = true;
    if (this.autoExit) queueMicrotask(() => this.exit(0));
    return true;
  }

  exit(code = 0) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.emit("exit", code);
    this.emit("close", code);
  }
}

class FakeSseResponse {
  constructor() {
    this.writableEnded = false;
    this.writes = [];
    this.endCalls = 0;
  }
  write(value) { this.writes.push(String(value)); }
  end() { this.endCalls += 1; this.writableEnded = true; }
  events() { return this.writes.map((value) => JSON.parse(value.slice(6))); }
}

function createFakeTimers() {
  let nextId = 0;
  const tasks = new Map();
  return {
    setTimer(callback) { const id = ++nextId; tasks.set(id, { callback, cleared: false }); return id; },
    clearTimer(id) { const task = tasks.get(id); if (task) task.cleared = true; },
    fire(id, includeCleared = false) { const task = tasks.get(id); if (!task || task.cleared && !includeCleared) return false; tasks.delete(id); task.callback(); return true; },
    fireFirst() { const item = Array.from(tasks).find(([, task]) => !task.cleared); return item ? this.fire(item[0]) : false; },
    ids() { return Array.from(tasks.keys()); },
    activeCount() { return Array.from(tasks.values()).filter((task) => !task.cleared).length; }
  };
}

function autoRespond(message, callback, child) {
  callback?.();
  if (message.id === undefined) return;
  const result = message.method === "thread/start" ? { thread: { id: "thread-1" } }
    : message.method === "turn/start" ? { turn: { id: "turn-1" } }
      : {};
  queueMicrotask(() => child.respond(message.id, result));
}

function createHarness(childFactory, extra = {}) {
  const children = [];
  const removed = [];
  let tempId = 0;
  const manager = createRuntimeManager({
    spawnChild: (cwd, runtime) => { const child = childFactory(cwd, runtime, children.length); children.push(child); return child; },
    createTempDir: () => `temp-${++tempId}`,
    removeTempDir: async (cwd) => { removed.push(cwd); },
    exitTimeoutMs: 20,
    forceExitTimeoutMs: 20,
    diagnose: () => {},
    ...extra
  });
  return { children, manager, removed };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("initialize→initialized通知を共有startupPromiseで1プロセスだけに送る", async () => {
  const harness = createHarness(() => new FakeChild({ onWrite: autoRespond }));
  const first = harness.manager.ensureServer();
  const second = harness.manager.ensureServer();
  assert.strictEqual(first, second);
  const runtime = await first;
  assert.equal(harness.children.length, 1);
  assert.deepEqual(harness.children[0].messages.map((message) => message.method), ["initialize", "initialized"]);
  assert.equal("id" in harness.children[0].messages[1], false);
  assert.equal(runtime.initialized, true);
  await harness.manager.shutdown();
});

test("initialized前のthread操作を拒否し、initialize失敗後は再接続できる", async () => {
  let firstInitialize;
  const harness = createHarness((cwd, runtime, index) => new FakeChild({
    onWrite: (message, callback, child) => {
      callback?.();
      if (index === 0 && message.method === "initialize") firstInitialize = () => child.fail(message.id, "初期化失敗");
      else if (message.id !== undefined) queueMicrotask(() => child.respond(message.id, {}));
    }
  }));
  const startup = harness.manager.ensureServer();
  await assert.rejects(harness.manager.send(harness.manager.getCurrentRuntime(), "thread/start", {}), /初期化が完了/);
  firstInitialize();
  await assert.rejects(startup, /初期化失敗/);
  const next = await harness.manager.ensureServer();
  assert.equal(next.initialized, true);
  assert.equal(harness.children.length, 2);
  await harness.manager.shutdown();
});

test("古いruntimeのexit・error・stdout・stderrは新しいruntimeを変更しない", async () => {
  const harness = createHarness(() => new FakeChild({ autoExit: false, onWrite: autoRespond }));
  const oldRuntime = await harness.manager.ensureServer();
  const oldChild = harness.children[0];
  const oldCleanup = harness.manager.disposeRuntime(oldRuntime, new Error("再接続"));
  const newRuntime = await harness.manager.ensureServer();
  const newChild = harness.children[1];
  let requestId;
  newChild.onWrite = (message, callback) => { callback?.(); if (message.id !== undefined) requestId = message.id; };
  const pending = harness.manager.send(newRuntime, "thread/start", {});
  oldChild.stdout.emit("data", `${JSON.stringify({ id: requestId, result: { source: "old" } })}\n`);
  oldChild.stderr.emit("data", "古いstderr");
  oldChild.emit("error", new Error("古いerror"));
  oldChild.exit(1);
  await oldCleanup;
  assert.equal(oldChild.killCalls.length, 1);
  assert.strictEqual(harness.manager.getCurrentRuntime(), newRuntime);
  assert.equal(newChild.killCalls.length, 0);
  newChild.respond(requestId, { source: "new" });
  assert.deepEqual(await pending, { source: "new" });
  await harness.manager.shutdown();
});

test("旧RPCの遅延timeoutとwrite callbackは新しいruntimeを破棄しない", async () => {
  const timers = createFakeTimers();
  const harness = createHarness(() => new FakeChild({ autoExit: false, onWrite: autoRespond }), {
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });
  const oldRuntime = await harness.manager.ensureServer();
  const oldChild = harness.children[0];
  let writeCallback;
  oldChild.onWrite = (message, callback, child) => {
    writeCallback = callback;
    queueMicrotask(() => child.respond(message.id, { ok: true }));
  };
  await harness.manager.send(oldRuntime, "thread/start", {});
  const staleTimer = timers.ids().at(-1);
  const cleanup = harness.manager.disposeRuntime(oldRuntime, new Error("切替"));
  oldChild.exit(0);
  await cleanup;
  const newRuntime = await harness.manager.ensureServer();
  timers.fire(staleTimer, true);
  writeCallback(new Error("遅延write error"));
  await flush();
  assert.strictEqual(harness.manager.getCurrentRuntime(), newRuntime);
  assert.equal(harness.children[1].killCalls.length, 0);
  const shutdown = harness.manager.shutdown();
  harness.children[1].exit(0);
  await shutdown;
  assert.equal(timers.activeCount(), 0);
});

test("runtime破棄はpending・SSE・kill・cleanupを一度だけ処理しexit後に削除する", async () => {
  const harness = createHarness(() => new FakeChild({ autoExit: false, onWrite: autoRespond }));
  const runtime = await harness.manager.ensureServer();
  const child = harness.children[0];
  child.onWrite = (message, callback) => callback?.();
  let rejected = 0;
  const pending = harness.manager.send(runtime, "thread/start", {}).catch(() => { rejected += 1; });
  const response = new FakeSseResponse();
  harness.manager.attachStream(runtime, "turn-a", response);
  const first = harness.manager.disposeRuntime(runtime, new Error("終了"));
  const second = harness.manager.disposeRuntime(runtime, new Error("二重終了"));
  assert.strictEqual(first, second);
  await flush();
  assert.equal(child.killCalls.length, 1);
  assert.equal(response.endCalls, 1);
  assert.deepEqual(harness.removed, []);
  child.exit(0);
  await Promise.all([first, second, pending]);
  assert.equal(rejected, 1);
  assert.deepEqual(harness.removed, ["temp-1"]);
});

test("終了待ちtimeoutでは強制終了後に所有tempだけを削除しタイマーを残さない", async () => {
  const timers = createFakeTimers();
  const harness = createHarness(() => new FakeChild({ autoExit: false, onWrite: autoRespond }), {
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });
  const oldRuntime = await harness.manager.ensureServer();
  const cleanup = harness.manager.disposeRuntime(oldRuntime, new Error("終了"));
  const newRuntime = await harness.manager.ensureServer();
  assert.equal(timers.fireFirst(), true);
  await flush();
  assert.deepEqual(harness.children[0].killCalls, ["SIGTERM", "SIGKILL"]);
  assert.equal(timers.fireFirst(), true);
  await cleanup;
  assert.deepEqual(harness.removed, ["temp-1"]);
  assert.equal(newRuntime.tempCwd, "temp-2");
  assert.equal(timers.activeCount(), 0);
  const shutdown = harness.manager.shutdown();
  harness.children[1].exit(0);
  await shutdown;
});

test("cleanup失敗時は所有tempの参照と診断情報を保持する", async () => {
  const diagnostics = [];
  const harness = createHarness(() => new FakeChild({ onWrite: autoRespond }), {
    removeTempDir: async () => { throw new Error("directory in use"); },
    diagnose: (message) => diagnostics.push(message)
  });
  const runtime = await harness.manager.ensureServer();
  await harness.manager.disposeRuntime(runtime, new Error("終了"));
  assert.equal(runtime.tempCwd, "temp-1");
  assert.match(diagnostics.join("\n"), /temp-1.*directory in use/);
});

test("initialize・thread/start・turn/startのtimeoutは対象runtimeだけを破棄する", async () => {
  for (const method of ["initialize", "thread/start", "turn/start"]) {
    const timers = createFakeTimers();
    const harness = createHarness(() => new FakeChild({ onWrite: method === "initialize" ? (message, callback) => callback?.() : autoRespond }), {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });
    let request;
    if (method === "initialize") request = harness.manager.ensureServer();
    else {
      const runtime = await harness.manager.ensureServer();
      harness.children[0].onWrite = (message, callback) => callback?.();
      request = harness.manager.send(runtime, method, {});
    }
    assert.equal(timers.fireFirst(), true);
    await assert.rejects(request, new RegExp(method.replace("/", "\\/") + " が時間内"));
    await flush();
    assert.equal(harness.manager.getCurrentRuntime(), null);
    assert.equal(harness.children[0].killCalls.length, 1);
    assert.equal(timers.activeCount(), 0);
  }
});

test("stdin.writeの同期例外とコールバックエラーは対象runtimeを破棄する", async () => {
  for (const mode of ["throw", "callback"]) {
    const harness = createHarness(() => new FakeChild({ onWrite: autoRespond }));
    const runtime = await harness.manager.ensureServer();
    const child = harness.children[0];
    child.onWrite = (message, callback) => {
      if (mode === "throw") throw new Error("write failed");
      callback(new Error("write failed"));
    };
    await assert.rejects(harness.manager.send(runtime, "thread/start", {}), /送信できませんでした/);
    await flush();
    assert.equal(harness.manager.getCurrentRuntime(), null);
    assert.equal(child.killCalls.length, 1);
  }
});

test("error通知はturn単位に記録しturn/completedの最終状態だけでSSEを終える", async () => {
  const harness = createHarness(() => new FakeChild({ onWrite: autoRespond }));
  const runtime = await harness.manager.ensureServer();
  const failed = new FakeSseResponse();
  const completed = new FakeSseResponse();
  harness.manager.attachStream(runtime, "turn-failed", failed);
  harness.manager.attachStream(runtime, "turn-completed", completed);
  harness.manager.handleMessage(runtime, { method: "error", params: { threadId: "thread-1", turnId: "turn-failed", willRetry: false, error: { message: "実スキーマの失敗" } } });
  harness.manager.handleMessage(runtime, { method: "warning", params: { message: "警告" } });
  assert.equal(failed.endCalls, 0);
  assert.equal(completed.endCalls, 0);
  harness.manager.handleMessage(runtime, { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-failed", status: "failed", error: null } } });
  harness.manager.handleMessage(runtime, { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-completed", status: "completed" } } });
  harness.manager.handleMessage(runtime, { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-completed", status: "failed", error: { message: "遅延失敗" } } } });
  assert.deepEqual(failed.events(), [{ type: "error", error: "実スキーマの失敗" }]);
  assert.equal(failed.endCalls, 1);
  assert.deepEqual(completed.events(), [{ type: "done", threadId: "thread-1", text: "" }]);
  assert.equal(completed.endCalls, 1);
  await harness.manager.shutdown();
});

test("failedはturn.errorを優先しinterruptedと未知statusはerrorになる", async () => {
  const harness = createHarness(() => new FakeChild({ onWrite: autoRespond }));
  const runtime = await harness.manager.ensureServer();
  const cases = [
    ["failed", { message: "最終エラー" }, "最終エラー"],
    ["interrupted", null, "中断"],
    ["inProgress", null, "不明な状態"]
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const [status, error, expected] = cases[index];
    const turnId = `turn-${index}`;
    const response = new FakeSseResponse();
    harness.manager.attachStream(runtime, turnId, response);
    harness.manager.handleMessage(runtime, { method: "turn/completed", params: { threadId: "thread-1", turn: { id: turnId, status, error } } });
    assert.match(response.events()[0].error, new RegExp(expected));
    assert.equal(response.endCalls, 1);
  }
  await harness.manager.shutdown();
});
