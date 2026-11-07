"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
function createServer(root = process.env.MEMO_SAVE_APP_ROOT || __dirname) {
  root = path.resolve(root);
  return http.createServer(async (request, response) => {
    try {
      const relative = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, "") || "index.html";
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
      const data = await fs.readFile(file);
      response.writeHead(200, { "Content-Type": ({ ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream" });
      response.end(data);
    } catch { response.writeHead(404).end(); }
  });
}
function observe(page) {
  const log = { exceptions: [], consoleErrors: [], failedResponses: [], failedRequests: [], requests: [] };
  page.on("pageerror", (error) => log.exceptions.push(error.stack));
  page.on("console", (message) => { if (message.type() === "error") log.consoleErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) log.failedResponses.push(`${response.status()} ${response.url()}`); });
  page.on("requestfailed", (request) => log.failedRequests.push(request.url()));
  page.on("request", (request) => log.requests.push(request.url()));
  return log;
}
function assertClean(log) { for (const name of ["exceptions", "consoleErrors", "failedResponses", "failedRequests"]) assert.deepEqual(log[name], [], name); }
async function snapshot(page) {
  return page.evaluate(async () => {
    const entries = await Promise.all([...db.objectStoreNames].map((name) => new Promise((resolve, reject) => {
      const transaction = db.transaction(name, "readonly"), request = transaction.objectStore(name).getAll();
      transaction.oncomplete = () => resolve([name, request.result]);
      transaction.onabort = () => reject(transaction.error);
    })));
    return { stores: Object.fromEntries(entries), local: { ...localStorage }, session: { ...sessionStorage } };
  });
}
async function appReady(page) {
  await page.locator("#appStartupGuard").waitFor({ state: "attached" });
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
  await page.locator("#editor").waitFor({ state: "visible" });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (await page.evaluate(() => innerWidth < 1000) && await page.locator("#contextPanel").getAttribute("aria-hidden") === "false") {
    await page.locator("#closeContextPanelBtn").click();
    await page.locator("#contextPanel").waitFor({ state: "hidden" });
  }
}
async function openApp(page, url) { await page.goto(url, { waitUntil: "commit" }); await appReady(page); }
async function saved(page, id, body) {
  const start = Date.now();
  let actual;
  while (Date.now() - start < 10000) {
    actual = await page.evaluate(async (id) => {
      const transaction = db.transaction("notes", "readonly"), read = transaction.objectStore("notes").get(id);
      const stored = await new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(read.result); transaction.onabort = () => reject(transaction.error); });
      return { stored, state: noteSaveFoundation.getState(id), editor: document.querySelector("#editor").value,
        badge: document.querySelector("#browserSaveStatusBtn").dataset.state };
    }, id);
    if (actual.stored?.body === body && actual.editor === body && actual.state?.status === "saved" && !actual.state.dirty && actual.badge === "saved") return actual;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Normal autosave did not commit expected body for ${id}: ${JSON.stringify(actual)}`);
}
module.exports = { createServer, observe, assertClean, snapshot, appReady, openApp, saved };
