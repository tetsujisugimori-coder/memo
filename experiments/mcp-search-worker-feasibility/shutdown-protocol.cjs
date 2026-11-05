"use strict";
// Synthetic coordination only: an acknowledgement is not a termination proof.
function createShutdownProtocol({ id, generation }) {
  if (typeof id !== "string" || !id || !Number.isSafeInteger(generation) || generation < 1) throw new Error("invalid_identity");
  let phase = "running", invalidated = false;
  function stop() {
    if (phase !== "running") return false;
    invalidated = true;
    phase = "stop_requested";
    return true;
  }
  function receive(message) {
    if (phase !== "stop_requested" || !message || message.type !== "shutdown_ack" || message.id !== id || message.generation !== generation || message.idbClosed !== true) return false;
    phase = "shutdown_acknowledged";
    return true;
  }
  function deadline() {
    if (phase === "stop_requested") phase = "unknown";
  }
  return { stop, receive, deadline, state: () => ({ phase, invalidated, reusable: false, physicalRelease: "UNKNOWN" }) };
}
module.exports = { createShutdownProtocol };
