"use strict";
// Test-only logical 5500/8791 URLs routed to ephemeral loopback listeners.
async function fetchReceiver(route, port) {
  const url = route.request().url().replace("http://127.0.0.1:8791", `http://127.0.0.1:${port}`);
  const headers = { ...route.request().headers(), host: `127.0.0.1:${port}` };
  return route.fetch({ url, headers, maxRetries: 0, timeout: 10000 });
}
async function attachTransport(context, staticPort, receiverPort) {
  await context.route("http://127.0.0.1:5500/**", async (route) => {
    const url = route.request().url().replace("http://127.0.0.1:5500", `http://127.0.0.1:${staticPort}`);
    await route.fulfill({ response: await route.fetch({ url, headers: { ...route.request().headers(), host: `127.0.0.1:${staticPort}` } }) });
  });
  await context.route("http://127.0.0.1:8791/**", async (route) => {
    try { await route.fulfill({ response: await fetchReceiver(route, typeof receiverPort === "function" ? receiverPort() : receiverPort) }); }
    catch { await route.abort().catch(() => {}); }
  });
}
module.exports = { attachTransport, fetchReceiver };
