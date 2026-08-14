"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const {
  openManagedDatabase,
  runGuardedStartup,
  startupFailureReason
} = require("./indexeddb-lifecycle.js");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function fakeOpen() {
  const events = [];
  const database = {
    close() { events.push("close"); }
  };
  const request = { result: database, error: null };
  return {
    database,
    events,
    indexedDB: {
      open(name, version) {
        events.push(`open:${name}:${version}`);
        queueMicrotask(() => request.onsuccess?.());
        return request;
      }
    },
    request
  };
}

test("古いIndexedDB接続はversionchange通知で退避処理後に閉じる", async () => {
  const fake = fakeOpen();
  const database = await openManagedDatabase({
    indexedDB: fake.indexedDB,
    name: "memo-nexus",
    version: 4,
    onVersionChange: () => fake.events.push("draft")
  });
  database.onversionchange({ newVersion: 5 });
  assert.deepEqual(fake.events, ["open:memo-nexus:4", "draft", "close"]);
  const handler = app.match(/function handleDatabaseVersionChange\([\s\S]*?\n}/)?.[0] || "";
  assert.ok(handler.indexOf("saveCurrentDraftMirror()") < handler.indexOf("dbConnectionClosedForUpgrade = true"));
  assert.match(handler, /新しい版を開くため保存接続を閉じました。再読み込みしてください/);
  assert.doesNotMatch(handler, /location\.reload/);
});

test("IndexedDB更新が別タブに妨げられても案内後に同じopen要求で起動を再開する", async () => {
  const fake = fakeOpen();
  fake.indexedDB.open = (name, version) => {
    fake.events.push(`open:${name}:${version}`);
    queueMicrotask(() => {
      fake.request.onblocked?.({ oldVersion: 4, newVersion: 5 });
      fake.events.push("old-tab-closed");
      fake.request.onsuccess?.();
    });
    return fake.request;
  };
  let blocked = 0;
  const database = await openManagedDatabase({
    indexedDB: fake.indexedDB,
    name: "memo-nexus",
    version: 5,
    onBlocked: () => { blocked += 1; fake.events.push("blocked-message"); }
  });
  assert.equal(database, fake.database);
  assert.equal(blocked, 1);
  assert.deepEqual(fake.events, ["open:memo-nexus:5", "blocked-message", "old-tab-closed"]);
  assert.match(app, /別のMemo Nexusタブを閉じると更新を続行します/);
});

test("起動例外を捕捉して安全な失敗表示へ渡す", async () => {
  const events = [];
  const failure = Object.assign(new Error("blocked storage"), { name: "InvalidStateError" });
  const result = await runGuardedStartup({
    onLoading: () => events.push("loading"),
    start: async () => { throw failure; },
    onReady: () => events.push("ready"),
    onFailure: (error) => events.push(`failure:${error.name}`)
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, failure);
  assert.deepEqual(events, ["loading", "failure:InvalidStateError"]);
  assert.match(startupFailureReason(failure), /保存領域を開けませんでした/);
  assert.match(html, /メモを読み込んでいます/);
  assert.match(html, /サイトデータを削除しないでください。保存済みデータが残っている可能性があります/);
  assert.match(app, /title: "メモを読み込めませんでした"/);
  assert.match(app, /void runGuardedStartup\(\{/);
  assert.doesNotMatch(app, /\ninit\(\);/);
});

test("起動完了まで初期HTMLの編集UIを隠し、成功時だけガードを解除する", async () => {
  const events = [];
  const result = await runGuardedStartup({
    onLoading: () => events.push("loading"),
    start: async () => "ready-data",
    onReady: (value) => events.push(value),
    onFailure: () => events.push("failure")
  });
  assert.deepEqual(result, { ok: true, result: "ready-data" });
  assert.deepEqual(events, ["loading", "ready-data"]);
  assert.match(html, /<body class="app-starting">/);
  assert.match(html, /id="appStartupGuard"[^>]*aria-busy="true"/);
  assert.match(html, /indexeddb-lifecycle\.js\?v=0\.4\.0-1/);
  assert.match(app, /onReady: hideStartupGuard/);
});
