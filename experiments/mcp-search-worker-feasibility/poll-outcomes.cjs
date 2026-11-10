"use strict";
const assert = require("node:assert/strict");
function classifyException(error) {
  const message = String(error?.message || "");
  const reason = /already handled/i.test(message) ? "already_handled" : /target.*closed|page.*closed|context.*closed/i.test(message) ? "target_closed" : /intercept|route|request/i.test(message) ? "route_or_request" : "other_redacted";
  const rawName = String(error?.name || "");
  return { name: ["Error", "TypeError", "AbortError", "TimeoutError"].includes(rawName) ? rawName : "OtherError", reason };
}
function validateOutcome(scenario, { fulfilled, routeError, outcome, events }) {
  const has = name => events.some(e => e.event === name);
  assert.ok(has("fixture_response") && has("fulfill_start"), `${scenario}: missing fixture/fulfill observation`);
  assert.ok(!routeError || ["abort", "page_closed", "context_closed", "duplicate_fulfill"].includes(scenario), `${scenario}: unexpected route exception`);
  if (scenario === "duplicate_fulfill") {
    assert.equal(fulfilled, true); assert.ok(has("second_fulfill_start")); assert.equal(routeError?.reason, "already_handled"); assert.equal(outcome, "delivered:200"); return;
  }
  if (["abort", "page_closed", "context_closed"].includes(scenario)) {
    assert.ok(!routeError || routeError.reason === "target_closed", `${scenario}: unexpected route exception`);
    if (routeError) assert.equal(fulfilled, false, `${scenario}: exception after successful fulfill`);
    assert.ok(fulfilled || routeError, `${scenario}: route outcome unobserved`);
    if (scenario === "abort") { assert.ok(has("abort_requested") && has("requestfailed")); assert.equal(outcome, "rejected:AbortError"); }
    if (scenario === "page_closed") { assert.ok(has("page_close_start") && has("page_closed")); assert.equal(outcome, "page_closed"); }
    if (scenario === "context_closed") { assert.ok(has("context_close_before_fulfill") && has("context_closed") && has("page_closed")); assert.equal(outcome, "page_closed"); }
    return;
  }
  assert.equal(routeError, null); assert.equal(fulfilled, true); assert.ok(has("fulfill_return"));
  if (scenario === "immediate") assert.equal(outcome, "delivered:200");
  else if (scenario === "held") { const start = events.find(e => e.event === "hold_250ms_start"), end = events.find(e => e.event === "hold_250ms_end"); assert.ok(start && end && end.at - start.at >= 249, "held: insufficient hold"); assert.equal(outcome, "delivered:200"); }
  else if (scenario === "session_switch") { assert.ok(has("session_switched")); assert.equal(outcome, "discarded_old_session"); }
  else throw new Error("unknown_scenario");
}
module.exports = { classifyException, validateOutcome };
