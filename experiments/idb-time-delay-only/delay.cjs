"use strict";
async function fixedDelay(ms, life) {
  const details = { ...life.state.transactions.at(-1), requestedDelayMs: ms };
  life.log("delay_start", details);
  await new Promise(resolve => setTimeout(resolve, ms));
  life.log("delay_end", { ...details, outcome: "timer_returned" });
}
function observedTerminal(state, errors) {
  if (errors.has(state?.transactionId)) return "error";
  return ["complete", "abort"].includes(state?.terminal) ? state.terminal : "UNKNOWN";
}
module.exports = { fixedDelay, observedTerminal };
