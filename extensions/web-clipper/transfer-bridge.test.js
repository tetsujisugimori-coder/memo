"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTransferBridge, ACK_TIMEOUT_MS } = require("./transfer-bridge.js");
const lifecycle = require("./transfer-lifecycle.js");

const transferId = "11111111-1111-1111-1111-111111111111";
const transferKey = lifecycle.transferStorageKey(transferId);
const validRecord = {
  createdAt: Date.parse("2026-08-12T12:00:00.000Z"),
  clip: {
    title: "転送確認",
    url: "https://example.com/article",
    host: "example.com",
    selection: "本文",
    capturedAt: "2026-08-12T12:00:00.000Z"
  }
};

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function harness(record = validRecord) {
  let now = validRecord.createdAt;
  let sequence = 0;
  const scheduled = new Map();
  const messages = [];
  const removed = [];
  const records = new Map(record === undefined ? [] : [[transferKey, record]]);

  function schedule(callback, delay, repeating) {
    const id = ++sequence;
    scheduled.set(id, { callback, delay, due: now + delay, repeating });
    return id;
  }

  async function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const next = [...scheduled.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.due;
      if (timer.repeating) timer.due += timer.delay;
      else scheduled.delete(id);
      timer.callback();
      await flush();
    }
    now = target;
    await flush();
  }

  const bridge = createTransferBridge({
    transferId,
    lifecycle,
    now: () => now,
    read: async (key) => records.get(key),
    remove: async (key) => { removed.push(key); records.delete(key); },
    post: (message) => messages.push(message),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearInterval: (id) => scheduled.delete(id),
    setTimeout: (callback, delay) => schedule(callback, delay, false),
    clearTimeout: (id) => scheduled.delete(id),
    clearSession: () => messages.push({ type: "session-cleared" })
  });

  return { advance, bridge, messages, records, removed };
}

test("受信準備が15秒以上遅れてもpayloadを保持し、準備完了後にだけ送る", async () => {
  const state = harness();
  state.bridge.start();
  await state.advance(15_500);
  assert(state.records.has(transferKey), "準備待ち中に転送レコードを失った");
  assert.equal(state.messages.some((message) => message.type === "memo-nexus-web-clip-transfer"), false);

  await state.bridge.handleMessage({ type: "memo-nexus-web-clip-receiver-ready", transferId });
  assert.equal(state.messages.filter((message) => message.type === "memo-nexus-web-clip-transfer").length, 1);
  assert(state.records.has(transferKey), "ACK前に転送レコードを削除した");

  await state.bridge.handleMessage({ type: "memo-nexus-web-clip-transfer-ack", transferId: "22222222-2222-2222-2222-222222222222" });
  assert(state.records.has(transferKey), "別IDのACKで転送レコードを削除した");
  await state.bridge.handleMessage({ type: "memo-nexus-web-clip-transfer-ack", transferId });
  assert.equal(state.records.has(transferKey), false);
  assert.deepEqual(state.removed, [transferKey]);
  assert(state.messages.some((message) => message.type === "memo-nexus-web-clip-transfer-ack-confirmed"));
});

test("ACKタイムアウトではTTL内のレコードを保持し、再試行で再送できる", async () => {
  const state = harness();
  state.bridge.start();
  await state.bridge.handleMessage({ type: "memo-nexus-web-clip-receiver-ready", transferId });
  await state.advance(ACK_TIMEOUT_MS + 1);
  assert(state.records.has(transferKey));
  assert(state.messages.some((message) => message.type === "memo-nexus-web-clip-transfer-error" && message.code === "ack_timeout"));

  await state.bridge.handleMessage({ type: "memo-nexus-web-clip-transfer-retry", transferId });
  assert.equal(state.messages.filter((message) => message.type === "memo-nexus-web-clip-transfer").length, 2);
});

test("再読み込み相当のbridge再生成後もTTL内の同じ転送を再開する", async () => {
  const state = harness();
  state.bridge.start();
  await state.bridge.handleMessage({ type: "memo-nexus-web-clip-receiver-ready", transferId });
  state.bridge.stop();
  assert(state.records.has(transferKey));

  const resumedMessages = [];
  const resumed = createTransferBridge({
    transferId,
    lifecycle,
    now: () => validRecord.createdAt + 20_000,
    read: async (key) => state.records.get(key),
    remove: async (key) => state.records.delete(key),
    post: (message) => resumedMessages.push(message),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 2,
    clearTimeout: () => {},
    clearSession: () => {}
  });
  resumed.start();
  await resumed.handleMessage({ type: "memo-nexus-web-clip-receiver-ready", transferId });
  assert.equal(resumedMessages.filter((message) => message.type === "memo-nexus-web-clip-transfer").length, 1);
});

test("欠落は保持可能な明示エラー、期限切れと不正形式は対象キーだけ清掃する", async () => {
  const missing = harness(null);
  missing.bridge.start();
  await missing.bridge.handleMessage({ type: "memo-nexus-web-clip-receiver-ready", transferId });
  assert(missing.messages.some((message) => message.code === "record_missing"));
  assert.deepEqual(missing.removed, []);

  const expired = harness({ ...validRecord, createdAt: validRecord.createdAt - lifecycle.TRANSFER_TTL_MS - 1 });
  expired.bridge.start();
  await expired.bridge.handleMessage({ type: "memo-nexus-web-clip-receiver-ready", transferId });
  assert(expired.messages.some((message) => message.code === "transfer_expired"));
  assert.deepEqual(expired.removed, [transferKey]);

  const invalid = harness({ ...validRecord, clip: { ...validRecord.clip, host: "" } });
  invalid.bridge.start();
  await invalid.bridge.handleMessage({ type: "memo-nexus-web-clip-receiver-ready", transferId });
  assert(invalid.messages.some((message) => message.code === "host_invalid"));
  assert.deepEqual(invalid.removed, [transferKey]);
});

test("明示的なキャンセルは現在の転送キーだけを削除する", async () => {
  const state = harness();
  state.bridge.start();
  await state.bridge.handleMessage({ type: "memo-nexus-web-clip-transfer-cancel", transferId: "22222222-2222-2222-2222-222222222222" });
  assert(state.records.has(transferKey));
  await state.bridge.handleMessage({ type: "memo-nexus-web-clip-transfer-cancel", transferId });
  assert.equal(state.records.has(transferKey), false);
  assert.deepEqual(state.removed, [transferKey]);
  assert(state.messages.some((message) => message.type === "memo-nexus-web-clip-transfer-cancel-confirmed"));
});
