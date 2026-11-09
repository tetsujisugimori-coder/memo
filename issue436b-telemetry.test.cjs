"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { describeDurations, summarize, safePath } = require("./issue436b-telemetry.cjs");

test("HTTP timing pairs by request identity, never by delivery position alone", () => {
  const events = [
    { event: "http:received", key: "a", monoMs: 100 },
    { event: "http:received", key: "b", monoMs: 120 },
    { event: "http:finish", key: "b", monoMs: 130 },
    { event: "http:finish", key: "a", monoMs: 170 },
  ];
  const x = describeDurations(events, "http:received", "http:finish");
  assert.deepEqual(x, { count: 2, pending: 0, maxMs: 70, p95Ms: 70 });
});
test("unfinished request is pending, not a zero-duration success", () => {
  const x = describeDurations([{ event: "route:start", key: "orphan", monoMs: 10 }],
    "route:start", "route:end");
  assert.deepEqual(x, { count: 0, pending: 1, maxMs: null, p95Ms: null });
});
test("no Node event gets mixed with a browser timeOrigin", () => {
  const x = summarize([{ event: "browser:snapshot", info: { timeOrigin: 18000000, resources: [] } },
    { event: "host:sample", monoMs: 50 }]);
  assert.equal(x.http.maxMs, null);
  assert.equal(x.route.maxMs, null);
  assert.equal(x.browser.snapshots, 1);
  assert.equal(x.host.samples, 1);
  assert.equal(x.rootCause, "UNKNOWN");
});
test("path normalization removes query and fragment from diagnostic evidence", () => {
  assert.equal(safePath("http://127.0.0.1:8901/index.html?draft=private#x"), "/index.html");
  assert.equal(safePath("/foo.js?token=ignore"), "/foo.js");
});

test("summary surfaces browser and optional Windows counters without assigning cause", () => {
  const s = summarize([
    { event: "browser:snapshot", info: { navigation: { domContentLoadedEndMs: 120 },
      resources: [{ durationMs: 68 }, { durationMs: 95 }] } },
    { event: "host:sample", nodeEventLoopLagMaxMs: 22 },
    { event: "win:counters", pagesPerSec: 7, availableMBytes: 440 },
  ]);
  assert.equal(s.browser.maxResourceDurationMs, 95);
  assert.equal(s.browser.maxNavigationDclMs, 120);
  assert.equal(s.host.maxNodeEventLoopLagMs, 22);
  assert.equal(s.host.maxWindowsPagesPerSec, 7);
  assert.equal(s.rootCause, "UNKNOWN");
});
