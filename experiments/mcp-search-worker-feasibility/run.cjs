"use strict";
const http = require("node:http"), fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const { chromium, webkit } = require("playwright");
const root = __dirname, engineName = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engineName)) throw new Error("unsupported browser");
(async () => {
  const server = http.createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname === "/" ? "index.html" : new URL(req.url, "http://127.0.0.1").pathname.slice(1);
    if (!["index.html", "worker.js", "suite.js"].includes(name)) return res.writeHead(404).end();
    try { const data = await fs.readFile(path.join(root, name)); res.writeHead(200, { "Content-Type": name.endsWith(".html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-store" }); res.end(data); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await ({ chromium, webkit })[engineName].launch({ headless: true });
    const context = await browser.newContext(); const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(() => window.runWorkerStudy());
    if (errors.length) throw new Error(`page errors: ${errors.join(", ")}`);
    const sourceHashes = {};
    for (const name of ["worker.js", "suite.js", "index.html", "run.cjs"]) sourceHashes[name] = crypto.createHash("sha256").update(await fs.readFile(path.join(root, name))).digest("hex");
    const output = { engine: engineName, browserVersion: browser.version(), platform: process.platform, sourceHashes, ...result };
    await fs.writeFile(path.join(root, `results-${engineName}.json`), JSON.stringify(output, null, 2) + "\n");
    console.log(JSON.stringify(output, null, 2));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
