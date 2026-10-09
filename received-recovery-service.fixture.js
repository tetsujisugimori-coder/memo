"use strict";
// IPC-only test fixture. No HTTP test control route or production environment flag.
const { createPersistentPreviewService } = require("./dummy-preview-service.js");
let gate = null;
process.on("message", (message) => {
  if (message.type === "gate") { gate = message.path; process.send({ type: "armed" }); }
});
(async () => {
  try {
    const { server } = await createPersistentPreviewService({
      browserToken: process.env.MEMO_PREVIEW_BROWSER_TOKEN, adapterToken: process.env.MEMO_PREVIEW_ADAPTER_TOKEN,
      directory: process.env.MEMO_PREVIEW_HISTORY_DIR,
      beforeReply: async (route, record) => {
        if (route === gate) {
          process.send({ type: "checkpoint", path: route, requestId: record.requestId, itemId: record.itemId });
          await new Promise(() => {});
        }
      }
    });
    server.once("error", () => process.exit(1));
    server.listen(0, "127.0.0.1", () => process.send({ type: "ready", port: server.address().port }));
  } catch (error) { process.send({ type: "failed", code: error.code || "startup_failed" }, () => process.exit(1)); }
})();
