"use strict";
// Serialized into the diagnostic Worker only. No connection operation is added.
function waitForTransactionComplete(done, tx, life, errors) {
  const state = life.state.transactions.at(-1);
  if (!state) return Promise.reject(new Error("F_transaction_not_observed"));
  const details = () => ({ ...state, transactionTerminal: state.terminal });
  life.log("transaction_wait_start", details());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = terminal => {
      if (settled) return;
      settled = true;
      tx.removeEventListener("error", onError);
      const valid = terminal === "complete" && state.terminal === "complete" && !errors.has(state.transactionId);
      life.log("transaction_wait_end", { ...details(), outcome: valid ? "complete" : terminal === "complete" ? "error" : terminal });
      if (valid) resolve(); else reject(new Error(`F_transaction_${terminal === "complete" ? "error" : terminal}`));
    };
    const onError = () => finish("error");
    tx.addEventListener("error", onError);
    if (errors.has(state.transactionId)) finish("error");
    Promise.resolve(done).then(finish, () => finish("rejected"));
  });
}
module.exports = { waitForTransactionComplete };
