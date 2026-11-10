"use strict";
// Synthetic observer contract checks; no real browser or production data.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { instrument } = require("./issue436-startup-diagnostic.cjs");
const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");

function lifecycleHarness() {
  const listeners = new Map(), marks = [], effects = [], transactionListeners = new Map();
  let errorReads = 0;
  const database = { objectStoreNames: ["notes", "note-conflicts"], close: () => effects.push("database.close") };
  const request = { readyState: "pending", result: database,
    get error() {
      errorReads++;
      if (this.readyState !== "done") throw Object.assign(new Error("pending request error access"), { name: "InvalidStateError" });
      return null;
    },
    addEventListener(kind, fn) { listeners.set(kind, fn); },
    transaction: { addEventListener(kind, fn) { transactionListeners.set(kind, fn); } }
  };
  const context = vm.createContext({ __i436Mark: (event, data) => marks.push({ event, data }) });
  vm.runInContext(instrument("indexeddb-lifecycle.js", read("indexeddb-lifecycle.js")), context);
  const promise = context.MemoNexusIndexedDbLifecycle.openManagedDatabase({
    indexedDB: { open: () => { effects.push("indexedDB.open"); return request; } }, name: "synthetic-issue436", version: 7,
    onBlocked: () => effects.push("product.onBlocked"), upgrade: () => effects.push("product.upgrade"),
    onVersionChange: () => effects.push("product.versionchange")
  });
  const dispatch = (kind, event = {}) => {
    listeners.get(kind)?.(event);
    request["on" + kind]?.(event);
  };
  return { request, database, marks, effects, promise, transactionListeners, dispatch, errorReads: () => errorReads };
}

test("diagnostic: pending blocked observation never reads request.error and retains the product blocked callback", async () => {
  const h = lifecycleHarness();
  assert.doesNotThrow(() => h.dispatch("blocked", { oldVersion: 6, newVersion: 7 }));
  assert.equal(h.errorReads(), 0);
  const blocked = h.marks.find((mark) => mark.event === "T7:idb:blocked");
  assert.equal(blocked?.data.state, "pending");
  assert.equal(blocked.data.error, null);
  assert.deepEqual(h.effects, ["indexedDB.open", "product.onBlocked"]);
  h.request.readyState = "done";
  h.dispatch("success");
  assert.equal(await h.promise, h.database);
});

test("diagnostic: upgrade observer retains original upgrade and upgrade-transaction events without a pending error read", async () => {
  const h = lifecycleHarness();
  assert.doesNotThrow(() => h.dispatch("upgradeneeded", { oldVersion: 6, newVersion: 7 }));
  assert.equal(h.errorReads(), 0);
  assert.deepEqual(h.effects, ["indexedDB.open", "product.upgrade"]);
  assert.ok(h.marks.some((mark) => mark.event === "T7:idb:upgradeneeded" && mark.data.oldVersion === 6));
  h.transactionListeners.get("complete")();
  assert.ok(h.marks.some((mark) => mark.event === "upgrade-transaction:complete"));
  h.request.readyState = "done"; h.dispatch("success");
  assert.equal(await h.promise, h.database);
});

test("diagnostic: completed success and versionchange preserve resolve and close order", async () => {
  const h = lifecycleHarness();
  h.request.readyState = "done"; h.dispatch("success");
  assert.equal(await h.promise, h.database);
  const success = h.marks.find((mark) => mark.event === "T7:idb:success");
  assert.deepEqual(Array.from(success.data.stores), ["notes", "note-conflicts"]);
  h.database.onversionchange({ oldVersion: 7, newVersion: 8 });
  assert.deepEqual(h.effects, ["indexedDB.open", "product.versionchange", "database.close"]);
  assert.deepEqual(h.marks.filter((mark) => mark.event.startsWith("idb:")).map((mark) => mark.event),
    ["idb:versionchange", "idb:close:call", "idb:close:return"]);
});

test("diagnostic: app transformation adds synchronous stamps only and exactly preserves original statements and await order", () => {
  const original = read("app.js"), transformed = instrument("app.js", original);
  new vm.Script(transformed);
  const restored = transformed.replace(/globalThis\.__i436Mark\("(?:\\.|[^"\\])*"\);/g, "");
  assert.equal(restored, original);
  for (const name of ["note-conflict-store.js", "note-save-foundation.js", "draft-mirror.js"])
    assert.equal(instrument(name, "unchanged fixture bytes"), "unchanged fixture bytes");
});
