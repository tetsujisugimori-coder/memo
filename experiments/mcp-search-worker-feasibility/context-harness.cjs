"use strict";
const { performance } = require("node:perf_hooks");
function bounded(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
async function inContext(browser, label, url, action, events, limits) {
  const contextId = label;
  const log = (event, details = {}) => events.push({ seq: events.length + 1, source: "node", nodeMs: performance.now(), contextId, event, ...details });
  let context, page; const result = { contextId, processSeparated: false, contextClose: "NOT_RUN", pageErrors: [] };
  log("context_create_start");
  try {
    const creation = browser.newContext();
    creation.then(late => { if (result.contextCreate === "UNKNOWN") void late.close().catch(() => {}); }, () => {});
    context = await bounded(creation, 8000, "context create timeout"); result.contextCreate = "OBSERVED"; log("context_created");
    result.value = await bounded((async () => {
      page = await context.newPage(); page.on?.("pageerror", error => result.pageErrors.push(error.message));
      await page.goto(url); log("trial_start"); return action(page);
    })(), limits.contextMs, "context trial timeout");
    log("trial_end", { outcome: "returned" });
  } catch (error) {
    if (!context) result.contextCreate = "UNKNOWN";
    result.error = error.message; log("trial_error", { outcome: error.message });
    if (page) { try { result.partial = await bounded(page.evaluate(() => window.diagnosticProgress || null), 500, "partial snapshot timeout"); } catch { result.partial = "UNKNOWN"; } }
  } finally {
    if (context) {
      log("context_close_start");
      try { await bounded(context.close(), limits.closeMs, "context close timeout"); result.contextClose = "RETURNED"; }
      catch (error) { result.contextClose = "UNKNOWN"; result.contextCloseError = error.message; }
      log("context_close_end", { outcome: result.contextClose, actualResourceRelease: "UNKNOWN" });
    }
  }
  return result;
}
module.exports = { bounded, inContext };
