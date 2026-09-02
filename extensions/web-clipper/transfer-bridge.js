(function (root) {
  "use strict";

  const ANNOUNCE_INTERVAL_MS = 1000;
  const ACK_TIMEOUT_MS = 8000;
  const TYPES = root.MemoNexusClipperTransferLifecycle?.TRANSFER_MESSAGE_TYPES
    || (typeof require === "function" ? require("./transfer-lifecycle.js").TRANSFER_MESSAGE_TYPES : null);

  function createTransferBridge(options) {
    const {
      transferId, lifecycle, read, remove, post, clearSession,
      now = Date.now,
      extensionVersion = "",
      setInterval: setIntervalFn = setInterval,
      clearInterval: clearIntervalFn = clearInterval,
      setTimeout: setTimeoutFn = setTimeout,
      clearTimeout: clearTimeoutFn = clearTimeout,
      log = () => {}
    } = options;
    const key = lifecycle.transferStorageKey(transferId);
    let announceTimer = 0;
    let ackTimer = 0;
    let attempt = 0;
    let phase = "idle";
    let payloadSent = false;
    let receiverProtocol = "current";
    let stopped = false;

    function diagnostic(code, extra = {}) {
      return { transferId, phase, code, attempt, ackReceived: false, extensionVersion: String(extensionVersion || ""), ...extra };
    }

    function announce() {
      if (stopped || phase !== "waiting_receiver") return;
      post({ type: TYPES.CONTENT_READY, transferId, attempt });
      log(diagnostic("content_ready"));
    }

    function clearAckTimer() {
      if (!ackTimer) return;
      clearTimeoutFn(ackTimer);
      ackTimer = 0;
    }

    function stopTimers() {
      if (announceTimer) clearIntervalFn(announceTimer);
      announceTimer = 0;
      clearAckTimer();
    }

    function reportError(code) {
      phase = "error";
      const details = diagnostic(code);
      post({ type: TYPES.ERROR, transferId, code, diagnostics: details });
      log(details);
    }

    async function deliver(protocol = "current") {
      if (stopped || !key || phase === "reading" || phase === "awaiting_ack" || phase === "complete") return;
      receiverProtocol = protocol;
      phase = "reading";
      attempt += 1;
      let record;
      try {
        record = await read(key);
      } catch (_) {
        reportError("storage_unavailable");
        return;
      }
      const validation = lifecycle.validateTransferRecord(record, now());
      if (!validation.ok) {
        if (lifecycle.isTerminalTransferRecordError(validation.code)) {
          try { await remove(key); } catch (_) {}
        }
        reportError(validation.code);
        return;
      }
      phase = "awaiting_ack";
      payloadSent = true;
      post({ type: TYPES.PAYLOAD, transferId, record, clip: record.clip });
      log(diagnostic("payload_sent", { recordPresent: true, receiverProtocol }));
      clearAckTimer();
      ackTimer = setTimeoutFn(() => {
        ackTimer = 0;
        if (!stopped && phase === "awaiting_ack") reportError("ack_timeout");
      }, ACK_TIMEOUT_MS);
    }

    async function acknowledge() {
      if (stopped || !payloadSent || phase === "complete") return;
      clearAckTimer();
      try {
        await remove(key);
      } catch (_) {
        reportError("storage_remove_failed");
        return;
      }
      phase = "complete";
      stopTimers();
      clearSession();
      const details = diagnostic("ack_confirmed", { ackReceived: true });
      post({ type: TYPES.ACK_CONFIRMED, transferId, diagnostics: details });
      log(details);
    }

    async function cancel() {
      if (stopped || phase === "complete") return;
      clearAckTimer();
      try {
        await remove(key);
      } catch (_) {
        reportError("storage_remove_failed");
        return;
      }
      phase = "complete";
      stopTimers();
      clearSession();
      post({ type: TYPES.CANCEL_CONFIRMED, transferId });
      log(diagnostic("cancel_confirmed"));
    }

    async function handleMessage(message) {
      if (stopped || !message || message.transferId !== transferId) return;
      if (message.type === TYPES.RECEIVER_READY && phase === "waiting_receiver") await deliver("current");
      else if (message.type === TYPES.CONTENT_READY && phase === "waiting_receiver" && !Number.isFinite(message.attempt)) await deliver("legacy");
      else if (message.type === TYPES.RETRY) {
        clearAckTimer();
        phase = "waiting_receiver";
        await deliver(receiverProtocol);
      } else if (message.type === TYPES.ACK) await acknowledge();
      else if (message.type === TYPES.CANCEL) await cancel();
    }

    function start() {
      if (stopped || !key || phase !== "idle") return;
      phase = "waiting_receiver";
      announceTimer = setIntervalFn(announce, ANNOUNCE_INTERVAL_MS);
      announce();
    }

    function stop() {
      stopped = true;
      stopTimers();
    }

    return { handleMessage, start, stop };
  }

  const api = { ACK_TIMEOUT_MS, ANNOUNCE_INTERVAL_MS, TYPES, createTransferBridge };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusClipperTransferBridge = api;
})(globalThis);
