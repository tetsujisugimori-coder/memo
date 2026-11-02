"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), http = require("node:http"), path = require("node:path");
const { chromium, webkit } = require("playwright"), { bounded } = require("./context-harness.cjs");
const { metadata, save, hash } = require("./stage5-evidence.cjs");
const engine = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engine)) throw new Error("unsupported engine");
const names = ["shared-ledger.js", "recovery-model.cjs", "stage5-browser.cjs", "stage5-evidence.cjs", "context-harness.cjs"];
(async () => {
  const report = { ...await metadata(names.map(f => `experiments/mcp-search-worker-feasibility/${f}`)), engine, cases: [], physicalRelease: "UNKNOWN", outcome: "FAIL" };
  const ledger = await fs.readFile(path.join(__dirname, names[0]), "utf8"), model = await fs.readFile(path.join(__dirname, names[1]), "utf8");
  const server = http.createServer((_req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("fictional fixture"); });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    browser = await ({ chromium, webkit })[engine].launch({ headless: true, timeout: 30000 }); report.version = browser.version();
    const setup = async page => {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.addScriptTag({ content: ledger });
      await page.addScriptTag({ content: `{ const module = {exports:{}}; ${model}\nObject.assign(window,module.exports); }` });
      await page.evaluate(() => {
        window.created = 0; window.entered = 0;
        window.workerUrl = URL.createObjectURL(new Blob([`onmessage=async({data})=>{
          if(data.payload==='hang'){postMessage({kind:'entered'}); await new Promise(()=>{});}
          else postMessage({...data,value:'fictional markdown'});
        }`], { type: "text/javascript" }));
        window.makeModel = (name, owner) => createSharedRecoveryModel({ ledger: SharedWorkerLedger, name, owner, maxWorkers: 2,
          createWorker: () => { created++; const w = new Worker(workerUrl); w.addEventListener('message', e => { if(e.data.kind==='entered') entered++; }); return w; } });
      });
    };
    // Sequential recovery is a second reservation, never a returned first slot.
    let context = await browser.newContext(); let page = await context.newPage(); await setup(page);
    const sequential = await bounded(page.evaluate(async () => {
      await SharedWorkerLedger.createFixture("stage5-sequential", 2);
      const model = window.model = makeModel("stage5-sequential", "a");
      model.setSession("old", Date.now() + 20000);
      let pollSettled = false;
      const oldPoll = new Promise(() => {}).finally(() => { pollSettled = true; });
      const broker = await Promise.race([oldPoll, new Promise(r => setTimeout(() => r("timeout"), 20))]);
      const first = await model.start("hang", 1000);
      const drainDeadline = performance.now() + 3500;
      while (model.state().workPending && performance.now() < drainDeadline) await new Promise(r => setTimeout(r, 5));
      if (model.state().workPending) throw new Error("ledger_cleanup_not_settled");
      model.setSession("new", Date.now() + 20000);
      const second = await model.start("read", 3000), third = await model.start("read", 3000);
      const slots = await SharedWorkerLedger.inspect("stage5-sequential", 2);
      const returns = await Promise.all(slots.slots.map(s => SharedWorkerLedger.releaseReserved("stage5-sequential", 2, s.owner, s.id)));
      return { broker, pollSettled, first, second, third, slots, returns, created, entered, state: model.state() };
    }), 12000, "sequential deadline");
    report.sequentialObservation = sequential; // Preserve the actual rejection/state even when a later assertion fails.
    assert.equal(sequential.broker, "timeout"); assert.equal(sequential.pollSettled, false);
    assert.equal(sequential.first.status, "timeout"); assert.equal(sequential.entered, 1);
    assert.equal(sequential.second.value, "fictional markdown"); assert.equal(sequential.third.status, "capacity_unknown");
    assert.equal(sequential.created, 2); assert.equal(sequential.slots.slots.length, 2);
    assert.ok(sequential.returns.every(r => r.status === "release_unconfirmed"));
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange"));
      delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal((await page.evaluate(() => model.start("read", 1000))).status, "capacity_unknown");
    await page.reload(); await setup(page);
    const reload = await page.evaluate(async () => { const m = makeModel("stage5-sequential", "reloaded"); m.setSession("new-page", Date.now() + 10000); return { result: await m.start("read", 1000), created }; });
    assert.equal(reload.result.status, "capacity_unknown"); assert.equal(reload.created, 0);
    report.cases.push({ name: "unresolved-broker-old-poll-second-slot-and-reload", outcome: "PASS", sequential, reload, visibility: "synthetic notifications only" });
    await context.close();
    // Three independently executing tabs contend for a capacity of exactly two.
    context = await browser.newContext(); const pages = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
    for (const p of pages) await setup(p);
    await pages[0].evaluate(() => SharedWorkerLedger.createFixture("stage5-concurrent", 2));
    const attempts = await Promise.all(pages.map((p, i) => p.evaluate(async owner => {
      const m = makeModel("stage5-concurrent", owner); m.setSession(owner, Date.now() + 10000);
      const result = await m.start("hang", 1000); return { result, created, entered };
    }, `owner-${i}`)));
    assert.deepEqual(attempts.map(x => x.result.status).sort(), ["capacity_unknown", "timeout", "timeout"]);
    assert.equal(attempts.reduce((n, x) => n + x.created, 0), 2); assert.equal(attempts.reduce((n, x) => n + x.entered, 0), 2);
    report.cases.push({ name: "three-tabs-capacity-two", outcome: "PASS", attempts }); await context.close();
    context = await browser.newContext(); page = await context.newPage(); await setup(page);
    // Use dedicated note stores, never the application's IndexedDB origin/profile.
    const integrity = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open("stage5-notes", 1); r.onupgradeneeded = () => {
        r.result.createObjectStore("notes").put({ body: "fictional", links: "[[語句]]" }, "n"); r.result.createObjectStore("metadata").put("fixture", "m"); };
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const snapshot = () => new Promise((resolve, reject) => { const names = [...db.objectStoreNames].sort(), tx = db.transaction(names, "readonly");
        const all = names.map(n => [n, tx.objectStore(n).getAllKeys(), tx.objectStore(n).getAll()]);
        tx.oncomplete = () => resolve(JSON.stringify(all.map(([n, k, v]) => [n, k.result, v.result]))); tx.onabort = tx.onerror = () => reject(tx.error); });
      const before = await snapshot(), outcomes = []; let readwrite = 0;
      const transaction = db.transaction.bind(db);
      db.transaction = (...args) => { if (args[1] === "readwrite") readwrite++; return transaction(...args); };
      const records = [null, { version: 0, capacity: 2, slots: [] }, { version: 1, capacity: 200, slots: [] },
        { version: 1, capacity: 2, slots: [{ id: "", owner: "a", state: "reserved" }] },
        { version: 1, capacity: 2, slots: [{ id: "x", owner: "a", state: "released" }] },
        { version: 1, capacity: 2, slots: [{ id: "x", owner: "a", state: "reserved" }, { id: "x", owner: "a", state: "reserved" }] }];
      for (let i = 0; i < records.length; i++) {
        const name = `invalid-${i}`; await SharedWorkerLedger.createFixture(name, 2);
        await new Promise((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => { const d = r.result, tx = d.transaction("ledger", "readwrite");
          tx.objectStore("ledger").put(records[i], "state"); tx.oncomplete = () => { d.close(); resolve(); }; tx.onabort = () => reject(tx.error); }; });
        const m = makeModel(name, "invalid"); m.setSession(`bad-${i}`, Date.now() + 10000); outcomes.push((await m.start("read", 1000)).status);
      }
      const after = await snapshot(); db.close(); return { before, after, outcomes, created, readwrite };
    });
    assert.equal(integrity.before, integrity.after); assert.equal(integrity.created, 0); assert.equal(integrity.readwrite, 0);
    assert.deepEqual(integrity.outcomes, Array(6).fill("failed_closed"));
    report.cases.push({ name: "invalid-or-old-ledger-and-fixture-integrity", outcome: "PASS", ...integrity, beforeHash: hash(integrity.before), afterHash: hash(integrity.after) });
    await context.close(); report.outcome = "PASS";
  } catch (error) { report.error = error.message; process.exitCode = 1; }
  finally {
    if (browser) try { await bounded(browser.close(), 5000, "browser close"); } catch { report.browserClose = "UNKNOWN"; report.outcome = "FAIL"; process.exitCode = 1; }
    server.closeAllConnections(); await new Promise(r => server.close(r)); await save(`browser-${engine}`, report);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
