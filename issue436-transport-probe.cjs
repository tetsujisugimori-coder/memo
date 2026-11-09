"use strict";
// Synthetic browser/transport probe. No product code, IndexedDB, save or Worker.
const { webkit, chromium } = require("playwright"), http = require("node:http");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const engine = process.argv[2] || "webkit";
const dir = path.resolve(process.env.I436_OUTPUT || `e2e-artifacts/issue436/${process.platform}-transport-${engine}`);
const count = 64;
const html = '<!doctype html><title>Synthetic transport only</title><p>Issue436: no app or IDB</p>' +
  Array.from({ length: count }, (_, n) => `<script src="/s/${n}.js"></script>`).join("") + '<script>window.probeReady=true</script>';
async function bound(promise, ms) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("diagnostic-read-deadline")), ms); })]); } finally { clearTimeout(timer); } }
async function main() {
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(path.join(dir, "results.json"))) throw new Error("Evidence exists; choose a new I436_OUTPUT");
  const report = { kind: "SYNTHETIC_TRANSPORT_ONLY", engine, node: process.version, platform: process.platform,
    release: os.release(), playwright: require("playwright/package.json").version, freeMemory: os.freemem(), startedAt: new Date().toISOString(),
    scripts: count, cases: [], productAcceptance: "NOT_TESTED" };
  let active;
  const mark = (event, data = {}) => active?.events.push({ event, ms: performance.now(), epoch: Date.now(), ...data });
  const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
  const heartbeat = setInterval(() => mark("heartbeat", { freeMemory: os.freemem() }), 1000);
  const server = http.createServer((req, res) => {
    mark("server:request", { url: req.url });
    res.on("finish", () => mark("server:finish", { url: req.url }));
    if (req.url === "/index.html") res.writeHead(200, { "Content-Type": "text/html" }).end(html);
    else if (/^\/s\/\d+\.js$/.test(req.url)) res.writeHead(200, { "Content-Type": "application/javascript" }).end("/*" + "x".repeat(req.url === "/s/0.js" ? 900000 : 8000) + "*/");
    else res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  try {
    for (const options of [{ route: true, sentinel: false }, { route: false, sentinel: false }, { route: true, sentinel: true }]) {
      active = { ...options, status: "FAIL", events: [], steps: [], startedAt: new Date().toISOString() };
      report.cases.push(active);
      let browser, context, current;
      async function step(name, action) {
        const start = performance.now(); mark("step:start", { name });
        try { const value = await action(); active.steps.push({ name, start, end: performance.now(), elapsedMs: performance.now() - start, status: "COMPLETE" }); mark("step:end", { name }); return value; }
        catch (e) { active.steps.push({ name, start, end: performance.now(), elapsedMs: performance.now() - start, status: "FAIL", error: e.stack }); throw e; }
        finally { fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(report, null, 2)); }
      }
      async function page() {
        const p = current = await context.newPage(); p.setDefaultTimeout(10000);
        p.on("domcontentloaded", () => mark("DOMContentLoaded")); p.on("load", () => mark("load"));
        p.on("request", r => mark("request", { url: r.url() })); p.on("requestfinished", r => mark("requestfinished", { url: r.url() }));
        await p.goto(url, { waitUntil: "commit", timeout: 10000 });
        await p.waitForFunction(() => window.probeReady === true, null, { timeout: 10000 }); return p;
      }
      try {
        browser = await ({ webkit, chromium })[engine].launch({ timeout: 30000 });
        context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        if (options.route) await context.route("**/*", route => {
          mark("route:start", { url: route.request().url() });
          return route.continue().then(() => mark("route:end", { url: route.request().url() }));
        });
        const a = await step("first-open", page), b = await step("second-open", page);
        for (const [name, p] of [["first-reload", a], ["second-reload", b]]) await step(name, async () => {
          current = p; await p.reload({ waitUntil: "commit", timeout: 10000 }); await p.waitForFunction(() => window.probeReady === true, null, { timeout: 10000 });
        });
        if (options.sentinel) await context.newPage();
        await step("close-original-tabs", async () => { await a.close(); await b.close(); });
        active.pagesBeforeReopen = context.pages().length;
        await step("reopen", page); active.status = "COMPLETE";
      } catch (e) {
        active.error = e.stack;
        try { active.delayedSnapshot = await bound(current.evaluate(() => ({ readyState: document.readyState, ready: window.probeReady, navigation: performance.getEntriesByType("navigation").map(n => n.toJSON()) })), 1500); }
        catch (error) { active.snapshotError = error.message; }
      } finally {
        active.eventLoopMaxMs = lag.max / 1e6; lag.reset();
        await context?.close(); await browser?.close(); active.finishedAt = new Date().toISOString();
        fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(report, null, 2) + "\n");
        console.log(JSON.stringify({ route: active.route, sentinel: active.sentinel, status: active.status, steps: active.steps.map(x => ({ name: x.name, status: x.status, elapsedMs: x.elapsedMs })), error: active.error }));
      }
    }
  } finally { clearInterval(heartbeat); lag.disable(); server.closeAllConnections(); server.close(); }
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(report, null, 2) + "\n");
  if (report.cases.some(c => c.status !== "COMPLETE")) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
