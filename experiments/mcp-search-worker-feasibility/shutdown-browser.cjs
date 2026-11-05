"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"), http = require("node:http");
const { chromium, webkit } = require("playwright"), { bounded } = require("./context-harness.cjs");
const engine = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engine)) throw new Error("unsupported browser");
(async () => {
  const ledger = await fs.readFile(path.join(__dirname, "shared-ledger.js"), "utf8");
  const protocol = await fs.readFile(path.join(__dirname, "shutdown-protocol.cjs"), "utf8");
  const server = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("fixture"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await bounded(({ chromium, webkit })[engine].launch({ headless: true }), 30000, "launch");
  try {
    const context = await browser.newContext();
    const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({ content: ledger });
    await page.addScriptTag({ content: `{ const module = { exports: {} }; ${protocol}\nwindow.createShutdownProtocol = module.exports.createShutdownProtocol; }` });
    const result = await bounded(page.evaluate(async () => {
      const db = "shutdown-" + crypto.randomUUID(), L = SharedWorkerLedger;
      await L.createFixture(db, 1);
      const fixture = "fixture-" + crypto.randomUUID();
      await new Promise((resolve, reject) => { const r = indexedDB.open(fixture, 1); r.onupgradeneeded = () => r.result.createObjectStore("items").put("dummy", "key"); r.onsuccess = () => { r.result.close(); resolve(); }; r.onerror = () => reject(r.error); });
      const source = `onmessage = ({data}) => { try { const r = indexedDB.open(data.fixture); r.onerror = () => postMessage({type:'diagnostic', stage:'open_error'}); r.onblocked = () => postMessage({type:'diagnostic', stage:'open_blocked'}); r.onsuccess = () => { const db = r.result, tx = db.transaction('items', 'readonly'); tx.onerror = () => postMessage({type:'diagnostic', stage:'tx_error'}); tx.objectStore('items').get('key'); tx.oncomplete = () => { db.close(); const m = { type: 'shutdown_ack', id: data.id, generation: data.generation, idbClosed: true }; postMessage({...m, generation: data.generation - 1}); postMessage(m); postMessage(m); }; }; } catch(e) { postMessage({type:'diagnostic', stage:'exception', name:e.name}); } };`;
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      let created = 0;
      const entry = await L.start(db, 1, "owner", () => { created++; return new Worker(url); });
      const supervisor = createShutdownProtocol({ id: entry.id, generation: 2 }); supervisor.stop();
      const replies = await new Promise((resolve, reject) => {
        const seen = [], timeout = setTimeout(() => reject(new Error("ack_timeout")), 3000);
        entry.worker.onerror = e => { clearTimeout(timeout); const m = String(e.message || ""); reject(new Error(`worker_error_${/syntax/i.test(m) ? "syntax" : /security|origin/i.test(m) ? "security" : /network|load/i.test(m) ? "load" : "other"}`)); };
        entry.worker.onmessage = ({data}) => { if (data.type === "diagnostic") { clearTimeout(timeout); reject(new Error(`worker_${data.stage}_${data.name || "unknown"}`)); return; } seen.push(supervisor.receive(data)); if (seen.length === 3) { clearTimeout(timeout); resolve(seen); } };
        entry.worker.postMessage({ id: entry.id, generation: 2, fixture });
      });
      entry.worker.terminate(); URL.revokeObjectURL(url);
      const occupied = await L.inspect(db, 1);
      const second = await L.start(db, 1, "new", () => { created++; return new Worker(url); });
      return { replies, supervisor: supervisor.state(), slots: occupied.slots.length, state: occupied.slots[0].state, second: second.status, created };
    }), 10000, "shutdown test");
    assert.deepEqual(result.replies, [false, true, false]);
    assert.equal(result.supervisor.phase, "shutdown_acknowledged"); assert.equal(result.supervisor.reusable, false);
    assert.equal(result.supervisor.physicalRelease, "UNKNOWN"); assert.equal(result.slots, 1); assert.equal(result.state, "running");
    assert.equal(result.second, "capacity_unknown"); assert.equal(result.created, 1);
    console.log(JSON.stringify({ engine, version: browser.version(), result, note: "fixture IDB close was called before acknowledgement; physical termination is unobserved" }));
    await context.close();
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
