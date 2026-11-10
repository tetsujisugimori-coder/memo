"use strict";
const fs = require("node:fs/promises"), path = require("node:path"), { chromium, webkit } = require("playwright");
const { bounded } = require("./context-harness.cjs");
const engine = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engine)) throw new Error("unsupported browser");
(async () => {
  const source = await fs.readFile(path.join(__dirname, "recovery-model.cjs"), "utf8");
  const browser = await bounded(({ chromium, webkit })[engine].launch({ headless: true }), 30000, "launch timeout");
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: `{ const module = { exports: {} }; ${source}\n window.createRecoveryModel = module.exports.createRecoveryModel; }` });
    const result = await bounded(page.evaluate(async () => {
      const url = URL.createObjectURL(new Blob([`onmessage = ({data}) => { if (data.payload !== "hang") postMessage({requestId:data.requestId, sessionId:data.sessionId, value:"fixture"}); }`], { type: "text/javascript" }));
      const model = window.createRecoveryModel({ createWorker: () => new Worker(url), maxWorkers: 2 });
      try {
        model.setSession("old", Date.now() + 10000);
        const first = await model.start("hang", 100);
        model.setSession("new", Date.now() + 10000);
        const second = await model.start("search", 3000);
        const third = await model.start("read", 3000);
        return { first, second, third, stats: model.stats() };
      } finally { model.cancel(); URL.revokeObjectURL(url); }
    }), 10000, "browser test timeout");
    if (result.first.status !== "timeout" || result.second.status !== "result" || result.second.value !== "fixture" || result.third.status !== "capacity_unknown" || result.stats.allocatedUnknown !== 2 || result.stats.active !== 0) throw new Error(JSON.stringify(result));
    console.log(JSON.stringify({ engine, browserVersion: browser.version(), result }));
  } finally { await bounded(browser.close(), 5000, "browser close timeout"); }
})().catch(error => { console.error(error); process.exitCode = 1; });
