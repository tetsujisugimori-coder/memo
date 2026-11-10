"use strict";
// Controlled transport diagnostic, not the product E2E or a real authorization test.
const http = require("node:http"), assert = require("node:assert/strict");
const { chromium, webkit } = require("playwright");
const { bounded } = require("./context-harness.cjs");
const { classifyException: classify, validateOutcome } = require("./poll-outcomes.cjs");
const { execFileSync } = require("node:child_process"), os = require("node:os"), crypto = require("node:crypto"), fs = require("node:fs");
const engine = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engine)) throw new Error("unsupported browser");
function git(...args) { try { return execFileSync("git", args, { cwd: __dirname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "UNKNOWN"; } }
function jst() { return new Date(Date.now() + 9 * 3600000).toISOString().replace("Z", "+09:00"); }
(async () => {
  const started = jst();
  const server = http.createServer((req, res) => { res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "application/json" }); res.end('{"ok":true}'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await ({ chromium, webkit })[engine].launch({ headless: true });
  const all = [];
  try {
    for (const scenario of ["immediate", "held", "abort", "session_switch", "page_closed", "context_closed", "duplicate_fulfill"]) {
      const context = await browser.newContext(), page = await context.newPage();
      const events = [], time = () => Math.round(performance.now() * 1000) / 1000;
      const log = (event, data = {}) => events.push({ at: time(), event, ...data });
      let readyResolve, releaseResolve, routeDoneResolve;
      const ready = new Promise(r => { readyResolve = r; }), release = new Promise(r => { releaseResolve = r; }), routeDone = new Promise(r => { routeDoneResolve = r; });
      let fulfilled = false, routeError = null;
      page.on("pageerror", () => log("pageerror", { category: "redacted" }));
      page.on("requestfailed", req => { if (req.url().endsWith("/poll")) log("requestfailed", { reason: req.failure()?.errorText || "unknown" }); });
      page.on("requestfinished", req => { if (req.url().endsWith("/poll")) log("requestfinished"); });
      page.on("response", res => { if (res.url().endsWith("/poll")) log("response", { status: res.status() }); });
      page.on("close", () => log("page_closed")); context.on("close", () => log("context_closed"));
      await context.route("http://fixture.invalid/**", r => r.fulfill({ status: 200, contentType: "text/html", body: "fixture" }));
      await context.route("http://receiver.invalid/poll", async r => {
        log("route_start", { request: "poll-1" });
        try {
          const response = await r.fetch({ url: `http://127.0.0.1:${server.address().port}/poll` });
          log("fixture_response", { status: response.status() }); readyResolve();
          if (scenario !== "immediate") await release;
          log("fulfill_start"); await r.fulfill({ response }); fulfilled = true; log("fulfill_return");
          if (process.env.POLL_INJECT_UNEXPECTED === "1" && scenario === "immediate") throw new Error("injected_unexpected_failure");
          if (scenario === "duplicate_fulfill") { log("second_fulfill_start"); await r.fulfill({ response }); }
        } catch (e) { routeError = classify(e); log("fulfill_or_fetch_exception", routeError); }
        finally { routeDoneResolve(); }
      });
      await page.goto("http://fixture.invalid/");
      await page.evaluate(() => { window.controller = new AbortController(); window.session = 1; window.outcome = "pending";
        fetch("http://receiver.invalid/poll", { signal: window.controller.signal }).then(r => { window.outcome = window.session === 1 ? `delivered:${r.status}` : "discarded_old_session"; }, e => { window.outcome = `rejected:${e.name}`; }); });
      await bounded(ready, 5000, "route did not reach fixture");
      if (scenario === "abort") { log("abort_requested"); await page.evaluate(() => controller.abort()); }
      if (scenario === "session_switch") { log("session_switched"); await page.evaluate(() => { window.session = 2; }); }
      if (scenario === "page_closed") { log("page_close_start"); await page.close(); }
      if (scenario === "context_closed") { log("context_close_before_fulfill"); await context.close(); }
      if (scenario === "held") { log("hold_250ms_start"); await new Promise(resolve => setTimeout(resolve, 250)); log("hold_250ms_end"); }
      if (scenario !== "immediate") { log("release"); releaseResolve(); }
      await bounded(routeDone, 5000, "route remained unfinished");
      let outcome = "page_closed";
      if (!page.isClosed()) { await page.waitForFunction(() => window.outcome !== "pending", null, { timeout: 5000 }); outcome = await page.evaluate(() => window.outcome); }
      let check = { fulfilled, routeError, outcome, events };
      const injections = {
        unexpected_abort: ["abort", x => ({ ...x, routeError: { reason: "other_redacted" } })],
        bad_duplicate: ["duplicate_fulfill", x => ({ ...x, routeError: { reason: "other_redacted" } })],
        bad_abort: ["abort", x => ({ ...x, outcome: "delivered:200" })],
        bad_session: ["session_switch", x => ({ ...x, outcome: "delivered:200" })],
        missing_page: ["page_closed", x => ({ ...x, events: x.events.filter(e => e.event !== "page_closed") })],
        missing_context: ["context_closed", x => ({ ...x, events: x.events.filter(e => e.event !== "context_closed") })]
      };
      const injected = process.env.POLL_INJECT_CASE, injection = injections[injected];
      if (injection?.[0] === scenario) check = injection[1](check);
      try { validateOutcome(scenario, check); }
      catch (error) { if (injection?.[0] === scenario) console.error(`EXPECTED_POLL_VALIDATION_CASE:${injected}`); throw error; }
      if (scenario !== "context_closed") { log("context_close_start"); await context.close(); }
      assert.equal(events.filter(e => e.event === "pageerror").length, 0, `${scenario}: unexpected pageerror`);
      all.push({ scenario, result: "PASS", exceptionCategory: routeError?.reason || "none", fulfilled, routeError, outcome, events });
    }
    const dirty = git("status", "--porcelain");
    const hash = name => crypto.createHash("sha256").update(fs.readFileSync(name)).digest("hex");
    console.log(JSON.stringify({ test: "poll-controlled-compare", baselineCommit: "ddee81fd50d23e6b49d105e2e57167ce1db61b1f", testedCommit: git("rev-parse", "HEAD"), testedTree: git("rev-parse", "HEAD^{tree}"), workingTreeDirty: dirty === "UNKNOWN" ? "UNKNOWN" : dirty !== "", scriptSha256: hash(__filename), validatorSha256: hash(require.resolve("./poll-outcomes.cjs")), browserEngine: engine, browserVersion: browser.version(), platform: `${os.platform()}-${os.arch()}`, testStartedAt: started, results: all }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => {
  if (process.env.POLL_INJECT_UNEXPECTED === "1" && String(e?.message || "").includes("immediate: unexpected route exception")) console.error("EXPECTED_ROUTE_ASSERTION");
  console.error("diagnostic failed:", classify(e)); process.exitCode = 1;
});
