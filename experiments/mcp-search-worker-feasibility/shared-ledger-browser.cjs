"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path");
const { chromium, webkit } = require("playwright"), { bounded } = require("./context-harness.cjs");
const engine = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engine)) throw new Error("unsupported browser");
(async () => {
  const source = await fs.readFile(path.join(__dirname, "shared-ledger.js"), "utf8");
  const browser = await bounded(({ chromium, webkit })[engine].launch({ headless: true }), 30000, "launch timeout");
  let context;
  try {
    context = await browser.newContext();
    await context.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>fixture</title>" }));
    const setup = async page => { await page.goto("https://fixture.invalid/"); await page.addScriptTag({ content: source }); };
    const a = await context.newPage(), b = await context.newPage();
    await setup(a); await setup(b);
    const db = "ledger-" + Date.now(), fixture = "notes-" + Date.now();
    await a.evaluate(async ({db, fixture}) => {
      await SharedWorkerLedger.createFixture(db, 1);
      await new Promise((resolve, reject) => { const r = indexedDB.open(fixture, 1);
        r.onupgradeneeded = () => r.result.createObjectStore("notes").put("架空メモ", "fixture");
        r.onsuccess = () => { r.result.close(); resolve(); }; r.onerror = () => reject(r.error); });
    }, { db, fixture });
    // Separate ledger: only reservations cancelled before creation may be reused.
    const preflight = await a.evaluate(async () => {
      const name = "preflight-" + crypto.randomUUID(), L = SharedWorkerLedger;
      await L.createFixture(name, 1);
      const first = await L.reserve(name, 1, "old");
      let wrongOwner;
      try { await L.releaseReserved(name, 1, "other", first.id); } catch (e) { wrongOwner = e.message; }
      const released = await L.releaseReserved(name, 1, "old", first.id);
      const repeated = await L.releaseReserved(name, 1, "old", first.id);
      const second = await L.reserve(name, 1, "new");
      const stale = await L.releaseReserved(name, 1, "old", first.id);
      await L.transition(name, 1, "new", second.id, "running");
      const running = await L.releaseReserved(name, 1, "new", second.id);
      const after = await L.inspect(name, 1);
      return { first: first.status, wrongOwner, released: released.status, repeated: repeated.status,
        second: second.status, distinct: first.id !== second.id, stale: stale.status, running: running.status, after };
    });
    assert.equal(preflight.first, "reserved"); assert.equal(preflight.wrongOwner, "owner_mismatch");
    assert.equal(preflight.released, "released_before_creation"); assert.equal(preflight.repeated, "already_absent");
    assert.equal(preflight.second, "reserved"); assert.equal(preflight.distinct, true);
    assert.equal(preflight.stale, "already_absent"); assert.equal(preflight.running, "release_unconfirmed");
    assert.equal(preflight.after.slots.length, 1); assert.equal(preflight.after.slots[0].state, "running");
    const failure = await a.evaluate(async () => {
      const name = "failure-" + crypto.randomUUID(), L = SharedWorkerLedger;
      await L.createFixture(name, 1); let attempts = 0, message;
      try { await L.start(name, 1, "creator", () => { attempts++; throw new Error("injected_factory_failure"); }); }
      catch (e) { message = e.message; }
      const after = await L.inspect(name, 1);
      const retry = await L.start(name, 1, "retry", () => { attempts++; throw new Error("must_not_create"); });
      return { attempts, message, state: after.slots[0].state, retry: retry.status };
    });
    assert.deepEqual(failure, { attempts: 1, message: "injected_factory_failure", state: "unknown", retry: "capacity_unknown" });
    const snapshot = page => page.evaluate(fixture => new Promise((resolve, reject) => {
      const r = indexedDB.open(fixture); r.onsuccess = () => { const db = r.result, tx = db.transaction("notes", "readonly");
        const q = tx.objectStore("notes").get("fixture"); tx.oncomplete = () => { db.close(); resolve(q.result); }; tx.onabort = tx.onerror = () => reject(tx.error); };
      r.onerror = () => reject(r.error);
    }), fixture);
    const before = await snapshot(a);
    const attempt = (page, owner) => page.evaluate(async ({ db, owner }) => {
      window.created = 0;
      const result = await SharedWorkerLedger.start(db, 1, owner, () => {
        window.created++;
        window.fixtureUrl = URL.createObjectURL(new Blob(["onmessage=()=>{}"], { type: "text/javascript" }));
        return window.fixtureWorker = new Worker(window.fixtureUrl);
      });
      return { status: result.status, id: result.id, created: window.created };
    }, { db, owner });
    const [ra, rb] = await Promise.all([attempt(a, "a"), attempt(b, "b")]);
    assert.deepEqual([ra.status, rb.status].sort(), ["capacity_unknown", "running"]);
    assert.equal(ra.created + rb.created, 1);
    const winner = ra.status === "running" ? a : b, loser = winner === a ? b : a;
    const owner = winner === a ? "a" : "b", id = (winner === a ? ra : rb).id;
    await loser.reload(); await loser.addScriptTag({ content: source });
    assert.deepEqual(await attempt(loser, "reload"), { status: "capacity_unknown", id: undefined, created: 0 });
    await winner.close(); // owner disappeared: physical termination/release remains UNKNOWN.
    const afterClose = await loser.evaluate(db => SharedWorkerLedger.inspect(db, 1), db);
    assert.equal(afterClose.slots.length, 1); assert.equal(afterClose.slots[0].state, "running");
    const c = await context.newPage(); await setup(c);
    assert.deepEqual(await attempt(c, "new-tab"), { status: "capacity_unknown", id: undefined, created: 0 });
    const missing = await c.evaluate(async () => {
      let created = 0;
      try { await SharedWorkerLedger.start("absent-" + crypto.randomUUID(), 1, "x", () => { created++; return new Worker("missing.js"); }); return { status: "unexpected", created }; }
      catch (e) { return { status: e.message, created }; }
    });
    assert.deepEqual(missing, { status: "ledger_missing", created: 0 });
    const corrupt = await c.evaluate(async () => {
      const name = "corrupt-" + crypto.randomUUID(); await SharedWorkerLedger.createFixture(name, 1);
      await new Promise((resolve, reject) => {
        const r = indexedDB.open(name); r.onsuccess = () => { const d = r.result, tx = d.transaction("ledger", "readwrite");
          tx.objectStore("ledger").put({ version: 1, capacity: 1, slots: "invalid" }, "state");
          tx.oncomplete = () => { d.close(); resolve(); }; tx.onerror = tx.onabort = () => reject(tx.error); }; r.onerror = () => reject(r.error);
      });
      let created = 0;
      try { await SharedWorkerLedger.start(name, 1, "x", () => { created++; return new Worker("missing.js"); }); return { status: "unexpected", created }; }
      catch (e) { return { status: e.message, created }; }
    });
    assert.deepEqual(corrupt, { status: "ledger_invalid", created: 0 });
    const stages = await c.evaluate(async ({db, owner, id}) => {
      const out = [];
      for (const state of ["invalidated", "stop_requested", "unknown"]) out.push((await SharedWorkerLedger.transition(db, 1, owner, id, state)).status);
      return out;
    }, { db, owner, id });
    assert.deepEqual(stages, ["invalidated", "stop_requested", "unknown"]);
    assert.deepEqual(await attempt(c, "after-unknown"), { status: "capacity_unknown", id: undefined, created: 0 });
    assert.equal(await snapshot(c), before);
    console.log(JSON.stringify({ engine, browserVersion: browser.version(), preflight, failure, concurrent: [ra.status, rb.status], workersCreated: ra.created + rb.created, reload: "capacity_unknown", ownerClosed: "capacity_unknown", stages, missing, corrupt, fixtureUnchanged: true, physicalResourceRelease: "UNKNOWN" }));
  } finally {
    if (context) await bounded(context.close(), 5000, "context close timeout");
    await bounded(browser.close(), 5000, "browser close timeout");
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
