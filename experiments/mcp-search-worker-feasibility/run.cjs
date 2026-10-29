"use strict";
const http = require("node:http"), fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto"), cp = require("node:child_process");
const { chromium, webkit } = require("playwright");
const root = __dirname, engineName = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engineName)) throw new Error("unsupported browser");
(async () => {
  const server = http.createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname === "/" ? "index.html" : new URL(req.url, "http://127.0.0.1").pathname.slice(1);
    if (!["index.html", "worker.js", "suite.js", "controls.js", "cleanup.js"].includes(name)) return res.writeHead(404).end();
    try { const data = await fs.readFile(path.join(root, name)); res.writeHead(200, { "Content-Type": name.endsWith(".html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-store" }); res.end(data); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser, output;
  const sourceHashes = {};
  for (const name of ["worker.js", "suite.js", "index.html", "run.cjs", "controls.js", "cleanup.js"]) sourceHashes[name] = crypto.createHash("sha256").update(await fs.readFile(path.join(root, name))).digest("hex");
  let gitHead = "UNKNOWN";
  try { gitHead = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch {}
  output = { engine: engineName, platform: process.platform, nodeVersion: process.version, gitHead, githubRunId: process.env.GITHUB_RUN_ID || null, githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null, sourceHashes };
  try {
    browser = await ({ chromium, webkit })[engineName].launch({ headless: true }); output.browserVersion = browser.version();
    const context = await browser.newContext(); const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(() => window.runWorkerStudy());
    const controls = await page.evaluate(() => window.runWorkerControls());
    const injection = await page.evaluate(() => window.runWorkerStudy({ injectAt: "T6.gate" }));
    const expected = ["T1.search", "T2.unresolved", "T3.terminate", "T4.recovery", "T5.stale", "T6.gate", "T7 iteration 1.upgrade", "T9.reading", "T10.race", "T12.failure-injection", "T8.snapshot", "T8.compare", "T11.summary"];
    const stageProbes = await page.evaluate(labels => Promise.all(labels.map(label => window.runWorkerStudy({ stageProbe: true, injectAt: label }))), expected);
    const stagesValid = stageProbes.every((probe, i) => probe.failure?.startsWith(expected[i] + ":") && probe.states[expected[i].match(/^T[0-9]+/)[0]] === "FAIL");
    const injectionValid = injection.failure?.startsWith("T6.gate:") && injection.states.T6 === "FAIL" && injection.states.T7 === "NOT_RUN";
    const timeline = [ ...result.timeline.map(event => ({ ...event, runKind: "primary" })), ...controls.timeline.map(event => ({ ...event, runKind: "control" })), ...injection.timeline.map(event => ({ ...event, runKind: "injection" })) ].sort((a, b) => a.mainMs - b.mainMs).map((event, i) => ({ ...event, seq: i + 1 }));
    output = { ...output, ...result, timeline, controls: controls.results, controlsRoundsPerCondition: controls.roundsPerCondition, stageProbes: { count: expected.length, valid: stagesValid }, realInjection: { valid: injectionValid, failure: injection.failure, states: injection.states, cleanup: injection.cleanup }, pageErrors: errors, instrumentation: controls.measurementEffects };
    if (result.failure || result.cleanup?.status !== "PASS" || Object.values(controls.results).some(item => item.outcome !== "PASS" || item.cleanup?.status !== "PASS") || !stagesValid || !injectionValid || injection.cleanup?.status !== "PASS" || errors.length) process.exitCode = 1;
  } catch (error) { output.fatal = String(error.stack || error); process.exitCode = 1; }
  finally {
    const directory = path.resolve(root, "../../e2e-artifacts/mcp-worker-diagnostics");
    await fs.mkdir(directory, { recursive: true });
    const filename = `results-${engineName}-${process.env.GITHUB_RUN_ID || "local"}-${process.env.GITHUB_RUN_ATTEMPT || "1"}-${crypto.randomUUID()}.json`;
    await fs.writeFile(path.join(directory, filename), JSON.stringify(output, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ file: filename, engine: engineName, gitHead, failure: output.failure || output.fatal || null, states: output.states || null, cleanup: output.cleanup || null, controls: output.controls || null, stageProbes: output.stageProbes || null, realInjection: output.realInjection || null }));
    if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
