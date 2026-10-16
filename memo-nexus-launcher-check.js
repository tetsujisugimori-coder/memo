"use strict";
// Private launcher child. Secrets arrive only through the role-specific environment.
const { loadConfig } = require("./mcp-http-auth.js");
const { ORIGINS, createPersistentPreviewService } = require("./dummy-preview-service.js");
function validate(configPath, memoUrl) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw Error("node_version");
  require.resolve("@modelcontextprotocol/sdk/server/mcp.js");
  require.resolve("jose");
  const config = loadConfig(configPath);
  if (config.port !== 8792) throw Error("launcher_port");
  const url = new URL(memoUrl);
  if (!ORIGINS.has(url.origin) || url.username || url.password || url.search || url.hash
    || !["/", "/memo/", "/memo/index.html", "/index.html"].includes(url.pathname)) throw Error("memo_url");
  return config;
}
async function run(role) {
  let server;
  try {
    if (role === "validate") { validate(process.argv[3], process.argv[4]); console.log("validated"); return; }
    if (role === "receiver") {
      ({ server } = await createPersistentPreviewService({ browserToken: process.env.MEMO_PREVIEW_BROWSER_TOKEN,
        adapterToken: process.env.MEMO_PREVIEW_ADAPTER_TOKEN, directory: process.env.MEMO_PREVIEW_HISTORY_DIR }));
    } else if (role === "oauth") {
      const { createAuthenticatedServer } = require("./mcp-http-server.js");
      server = await createAuthenticatedServer(loadConfig(process.argv[3]), {
        adapterToken: process.env.MEMO_PREVIEW_ADAPTER_TOKEN, diagnostics: process.env.MEMO_MCP_HTTP_DIAGNOSTICS === "1" });
    } else throw Error("role");
    // Graceful shutdown releases the history writer lock. Parent EOF also stops this child.
    let stopping = false;
    function stop() {
      if (stopping) return; stopping = true;
      server.close(); server.closeAllConnections(); process.stdin.destroy();
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", stop); process.stdin.on("end", stop);
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
    server.once("error", stop);
    server.listen(role === "receiver" ? 8791 : 8792, "127.0.0.1", () => console.log("local_listener_ready"));
  } catch (error) {
    const safe = ["history_corrupt", "history_locked", "history_permissions", "history_write_failed", "history_capacity", "history_full"];
    console.error(safe.includes(error.code) ? error.code : "launcher_child_refused"); process.exitCode = 1;
  }
}
if (require.main === module) void run(process.argv[2]);
module.exports = { validate };
