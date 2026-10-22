"use strict";
// Test setup only. Keep the production lock and its fail-closed behavior intact.
const fs = require("node:fs/promises"), net = require("node:net"), os = require("node:os"), path = require("node:path");
const { createHash } = require("node:crypto");
const selectedPorts = new Set();
function historyLockPort(directory) {
  const canonical = process.platform === "win32" ? directory.toLowerCase() : directory;
  return 20000 + (parseInt(createHash("sha256").update(canonical).digest("hex").slice(0, 8), 16) % 30000);
}
async function available(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen({ port, host: "127.0.0.1", exclusive: true }, () => probe.close(error => resolve(!error)));
  });
}
async function createHistoryDirectory(prefix = "memo-history-", parent = os.tmpdir()) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(parent, prefix)));
    const port = historyLockPort(directory);
    // Below the default Linux (32768+) and Windows (49152+) ephemeral ranges.
    // Probe availability as well; no actual openHistory call or assertion is retried.
    if (port < 30000 && !selectedPorts.has(port) && await available(port)) {
      selectedPorts.add(port); return directory;
    }
    await fs.rmdir(directory); // Only this helper's newly-created, empty directory.
  }
  throw new Error("history_fixture_unavailable");
}
module.exports = { createHistoryDirectory, historyLockPort };
