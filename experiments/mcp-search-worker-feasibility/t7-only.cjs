"use strict";
// 元のT7と同じworker/suiteを使用。毎回新規ブラウザ・context・架空DB。
const http = require("node:http"), fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const { chromium, webkit } = require("playwright");
const { bounded, inContext } = require("./context-harness.cjs");
const root = __dirname, engine = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engine)) throw new Error("unsupported browser");
const files = ["index.html", "worker.js", "suite.js", "controls.js", "cleanup.js", "diagnostic-plan.js", "diagnostic.js", "diagnostic-worker.js"];
(async () => {
  const hashes = {};
  for (const name of [...files, "t7-only.cjs", "context-harness.cjs"]) hashes[name] = crypto.createHash("sha256").update(await fs.readFile(path.join(root, name))).digest("hex");
  const result = { engine, platform: process.platform, node: process.version, hashes, separateBrowserProcess: true, runs: 1, processRelease: "UNKNOWN" };
  const server = http.createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
    if (!files.includes(name)) return res.writeHead(404).end();
    try { res.writeHead(200, { "Content-Type": name.endsWith(".html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-store" }); res.end(await fs.readFile(path.join(root, name))); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser, forced = false;
  try {
    browser = await bounded(({ chromium, webkit })[engine].launch({ headless: true }), 30000, "browser launch timeout");
    result.browserVersion = browser.version(); result.contextEvents = [];
    result.trial = await inContext(browser, "t7-only", `http://127.0.0.1:${server.address().port}/`,
      page => page.evaluate(() => window.runWorkerStudy({ t7Only: true })), result.contextEvents, { contextMs: 180000, closeMs: 5000 });
    const trial = result.trial;
    if (trial.error || trial.pageErrors.length || trial.contextClose !== "RETURNED" || trial.value?.failure || trial.value?.cleanup?.status !== "PASS" || trial.value?.states?.T7 !== "PARTIAL") process.exitCode = 1;
  } catch (error) { result.fatal = String(error); process.exitCode = 1; }
  finally {
    if (browser) { try { await bounded(browser.close(), 5000, "browser close timeout"); result.browserClose = "RETURNED"; } catch { result.browserClose = "UNKNOWN"; process.exitCode = 1; forced = true; } }
    server.closeAllConnections?.();
    try { await bounded(new Promise(resolve => server.close(resolve)), 5000, "server close timeout"); } catch { result.serverClose = "UNKNOWN"; process.exitCode = 1; forced = true; }
    const dir = path.resolve(root, "../../e2e-artifacts/mcp-worker-diagnostics");
    await fs.mkdir(dir, { recursive: true });
    const filename = `t7-only-${engine}-${crypto.randomUUID()}.json`;
    await fs.writeFile(path.join(dir, filename), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ file: filename, engine, browserVersion: result.browserVersion, trial: result.trial?.value && { states: result.trial.value.states, failure: result.trial.value.failure, cleanup: result.trial.value.cleanup, observations: result.trial.value.observations }, fatal: result.fatal }));
    if (forced) process.exit(1);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
