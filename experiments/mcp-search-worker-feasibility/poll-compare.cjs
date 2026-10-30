"use strict";
// Controlled transport diagnostic, not the product E2E or a real authorization test.
const http = require("node:http"), assert = require("node:assert/strict");
const { chromium, webkit } = require("playwright");
const { bounded } = require("./context-harness.cjs");
const engine = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engine)) throw new Error("unsupported browser");
function classify(error) {
  const message = String(error?.message || "");
  const reason = /already handled/i.test(message) ? "already_handled" : /target.*closed|page.*closed|context.*closed/i.test(message) ? "target_closed" : /intercept|route|request/i.test(message) ? "route_or_request" : "other_redacted";
  return { name: String(error?.name || "Error").replace(/[^A-Za-z]/g, "").slice(0, 40), reason,
    safeMessage: reason === "already_handled" ? "Route is already handled" : "redacted" };
}
(async () => {
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
      if (["immediate", "held", "session_switch"].includes(scenario)) {
        assert.equal(routeError, null, `${scenario}: unexpected route exception`); assert.equal(fulfilled, true);
        assert.equal(outcome, scenario === "session_switch" ? "discarded_old_session" : "delivered:200");
      } else if (scenario === "duplicate_fulfill") {
        assert.equal(fulfilled, true); assert.ok(routeError, "expected second fulfill exception must be observed");
      } else if (!routeError && !fulfilled) throw new Error(`${scenario}: route outcome unobserved`);
      if (scenario !== "context_closed") { log("context_close_start"); await context.close(); }
      assert.equal(events.filter(e => e.event === "pageerror").length, 0, `${scenario}: unexpected pageerror`);
      all.push({ scenario, fulfilled, routeError, outcome, events });
    }
    console.log(JSON.stringify({ test: "poll-controlled-compare", engine, version: browser.version(), at: new Date().toISOString(), parent: "df9a713b3ef9188b4a6bc8ae500f92d20b9124ea", results: all }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error("diagnostic failed:", classify(e)); process.exitCode = 1; });
