"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { validateOutcome, classifyException } = require("./poll-outcomes.cjs");
const event = event => ({ event });
const base = { fulfilled: true, routeError: null, outcome: "delivered:200", events: [event("fixture_response"), event("fulfill_start"), event("fulfill_return")] };
test("valid scenarios require exact outcomes and event evidence", () => {
  validateOutcome("immediate", base);
  validateOutcome("held", { ...base, events: [...base.events, { event: "hold_250ms_start", at: 0 }, { event: "hold_250ms_end", at: 250 }] });
  validateOutcome("abort", { ...base, outcome: "rejected:AbortError", events: [...base.events, event("abort_requested"), event("requestfailed")] });
  validateOutcome("session_switch", { ...base, outcome: "discarded_old_session", events: [...base.events, event("session_switched")] });
  validateOutcome("page_closed", { ...base, outcome: "page_closed", events: [...base.events, event("page_close_start"), event("page_closed")] });
  validateOutcome("context_closed", { ...base, outcome: "page_closed", events: [...base.events, event("context_close_before_fulfill"), event("context_closed"), event("page_closed")] });
  validateOutcome("duplicate_fulfill", { ...base, routeError: { reason: "already_handled" }, events: [...base.events, event("second_fulfill_start")] });
});
test("unexpected exceptions, wrong classification, missing abort, stale delivery and absent closure fail", () => {
  for (const scenario of ["abort", "page_closed", "context_closed"]) assert.throws(() => validateOutcome(scenario, { ...base, routeError: { reason: "other_redacted" }, outcome: "page_closed" }));
  assert.throws(() => validateOutcome("duplicate_fulfill", { ...base, routeError: { reason: "other_redacted" }, events: [...base.events, event("second_fulfill_start")] }));
  assert.throws(() => validateOutcome("abort", { ...base, outcome: "delivered:200", events: [...base.events, event("abort_requested")] }));
  assert.throws(() => validateOutcome("session_switch", { ...base, events: [...base.events, event("session_switched")] }));
  for (const scenario of ["page_closed", "context_closed"]) assert.throws(() => validateOutcome(scenario, { ...base, outcome: "page_closed" }));
});
test("exception classification is fixed and excludes arbitrary data", () => {
  assert.equal(classifyException(new Error("Route is already handled! secret" )).reason, "already_handled");
  assert.equal(classifyException(new Error("secret-token" )).reason, "other_redacted");
  assert.ok(!JSON.stringify(classifyException(new Error("secret-token"))).includes("secret-token"));
});
