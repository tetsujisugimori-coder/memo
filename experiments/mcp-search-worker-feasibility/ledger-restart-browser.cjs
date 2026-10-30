"use strict";
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium, webkit } = require("playwright"), { bounded } = require("./context-harness.cjs");
const engine = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engine)) throw new Error("unsupported browser");
(async () => {
  const source = await fs.readFile(path.join(__dirname, "shared-ledger.js"), "utf8");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "memo-ledger-fixture-"));
  const launch = () => bounded(({ chromium, webkit })[engine].launchPersistentContext(profile, { headless: true }), 30000, "launch");
  const setup = async context => { await context.route("**/*", r => r.fulfill({ contentType: "text/html", body: "fixture" })); const page = context.pages()[0] || await context.newPage(); await page.goto("https://fixture.invalid/"); await page.addScriptTag({ content: source }); return page; };
  let context = await launch();
  try {
    let page = await setup(context);
    const first = await page.evaluate(async () => { await SharedWorkerLedger.createFixture("restart-ledger", 1); await SharedWorkerLedger.createFixture("interrupted-reservation", 1);
      await SharedWorkerLedger.reserve("interrupted-reservation", 1, "departed"); let made = 0;
      const result = await SharedWorkerLedger.start("restart-ledger", 1, "first", () => { made++; return new Worker(URL.createObjectURL(new Blob(["onmessage=()=>{}"], { type: "text/javascript" }))); });
      return { status: result.status, made }; });
    assert.deepEqual(first, { status: "running", made: 1 });
    await context.close(); context = null;
    context = await launch(); page = await setup(context);
    const after = await page.evaluate(async () => { let made = 0; const state = await SharedWorkerLedger.inspect("restart-ledger", 1);
      const result = await SharedWorkerLedger.start("restart-ledger", 1, "next", () => { made++; return new Worker("missing.js"); });
      const interrupted = await SharedWorkerLedger.inspect("interrupted-reservation", 1);
      const next = await SharedWorkerLedger.start("interrupted-reservation", 1, "next", () => { made++; return new Worker("missing.js"); });
      return { slots: state.slots.length, slotState: state.slots[0].state, status: result.status, interrupted: interrupted.slots[0].state, interruptedStatus: next.status, made }; });
    assert.deepEqual(after, { slots: 1, slotState: "running", status: "capacity_unknown", interrupted: "reserved", interruptedStatus: "capacity_unknown", made: 0 });
    console.log(JSON.stringify({ engine, first, after, browserRestart: true, physicalRelease: "UNKNOWN", profile: "isolated temporary" }));
  } finally { if (context) await context.close(); /* retain isolated profile for forensic inspection */ }
})().catch(e => { console.error(e); process.exitCode = 1; });
