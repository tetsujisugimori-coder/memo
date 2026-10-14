"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { randomBytes, randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const { createPersistentPreviewService } = require("./dummy-preview-service.js");
const { attachTransport } = require("./received-e2e-transport.js");
const { httpFixture, listen, close, wire } = require("./mcp-http-oauth.fixture.js");
const { config } = require("./mcp-http-oauth.fixture.js");
const { receiverRequestId } = require("./mcp-http-auth.js");
async function snapshot(page) {
  return page.evaluate(async () => Object.fromEntries(await Promise.all([...db.objectStoreNames].sort().map(async name => {
    const entries = await new Promise((resolve, reject) => {
      const tx = db.transaction(name, "readonly"), store = tx.objectStore(name);
      const keys = store.getAllKeys(), values = store.getAll();
      tx.oncomplete = () => resolve(keys.result.map((key, i) => [key, values.result[i]])); tx.onerror = () => reject(tx.error);
    });
    return [name, entries];
  }))));
}
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "memo-oauth-e2e-"));
  const browserToken = randomBytes(32).toString("base64url"), adapterToken = randomBytes(32).toString("base64url");
  let receiver, gateway, browser;
  const staticServer = http.createServer(async (req, res) => {
    const file = path.resolve(__dirname, new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html");
    if (!file.startsWith(__dirname + path.sep)) return res.writeHead(403).end();
    try { const data = await fs.readFile(file); res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "application/javascript" }); res.end(data); }
    catch { res.writeHead(404).end(); }
  });
  const startReceiver = async () => {
    receiver = await createPersistentPreviewService({ directory, browserToken, adapterToken }); await listen(receiver.server);
    gateway = await httpFixture(receiver.server.address().port, adapterToken);
  };
  const stopReceiver = async () => { await close(gateway.server); await close(receiver.server); await receiver.history.close(); gateway = null; receiver = null; };
  try {
    await startReceiver(); await listen(staticServer);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ timezoneId: "Asia/Tokyo" });
    await attachTransport(context, staticServer.address().port, () => receiver.server.address().port);
    const page = await context.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:5500/", { waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await page.waitForFunction(() => typeof webClipReceiverReady !== "undefined" && webClipReceiverReady);
    await page.evaluate(async () => { await createNote("preserved", "Existing [[knowledge]]"); await flushScheduledNoteSave(currentId); await Promise.all(notes.map(note => noteSaveFoundation.whenIdle(note.id))); });
    const baseline = await snapshot(page);
    const principal = { issuer: config.authorization_servers[0], sub: config.allowedSubjects[0] };
    const call = async (name, input) => {
      const response = await wire(gateway.port, gateway.token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: input } });
      assert.equal(response.status, 200); assert.equal(response.json.result.isError, false);
      return JSON.parse(response.json.result.content[0].text);
    };
    const initialized = await wire(gateway.port, gateway.token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } });
    assert.equal(initialized.status, 200);
    assert.equal((await wire(gateway.port, gateway.token, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
    assert.equal((await wire(gateway.port, gateway.token, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json.result.tools.length, 2);
    const input = { requestId: randomUUID(), title: "OAuth未保存文章", body: "原文\r\n[[知識リンク]]\n<script>window.oauthExecuted=true</script>" };
    const received = await call("submit_text_preview", input); assert.equal(received.saved, false);
    const id = receiverRequestId(principal, input.requestId);
    await page.keyboard.press("Escape");
    await page.locator("#dummyPreviewOpenBtn").evaluate(el => { el.closest("details").open = true; });
    await page.locator("#dummyPreviewOpenBtn").click(); await page.locator("#dummyPreviewToken").fill(browserToken);
    const idle = () => page.waitForFunction(() => !document.getElementById("dummyPreviewCheckBtn").disabled);
    const check = async () => { await page.locator("#dummyPreviewCheckBtn").click(); await idle(); };
    await check();
    assert.equal(await page.locator("#dummyPreviewBody").textContent(), input.body);
    assert.match(await page.locator("#dummyPreviewBadge").textContent(), /未保存/);
    assert.deepEqual(await snapshot(page), baseline); assert.equal(await page.evaluate(() => window.oauthExecuted), undefined);
    // Both processes restart; only existing durable metadata survives, no body.
    await stopReceiver(); await startReceiver(); assert.equal(receiver.queue.peek().bodyAvailable, false);
    assert.equal((await call("submit_text_preview", input)).saved, false); assert.equal(receiver.queue.peek().requestId, id);
    await check(); assert.deepEqual(await snapshot(page), baseline);
    await page.locator("#dummyPreviewSaveBtn").click(); await idle();
    const saved = receiver.queue.status(id); assert.equal(saved.saved, true);
    const afterSave = await snapshot(page); assert.equal(afterSave.notes.length, baseline.notes.length + 1);
    const note = afterSave.notes.find(([key]) => key === saved.savePlan.noteId)[1]; assert.equal(note.title, input.title); assert.equal(note.body, input.body);
    assert.equal((await call("submit_text_preview", input)).saved, true); assert.deepEqual(await snapshot(page), afterSave);
    const multiple = { requestId: randomUUID(), notes: [{ title: "手動保存", body: "複数の1件目" }, { title: "破棄", body: "複数の2件目" }] };
    const batch = await call("submit_notes_preview", multiple); assert.equal(batch.saved, false); await check();
    const select = async itemId => { const button = page.locator(`[data-item-id="${itemId}"]`); await button.evaluate(el => { const details = el.closest("details"); if (details) details.open = true; }); await button.click(); };
    await select(batch.notes[0].itemId); assert.equal(await page.locator("#dummyPreviewBody").textContent(), multiple.notes[0].body);
    assert.deepEqual(await snapshot(page), afterSave);
    await page.locator("#dummyPreviewSaveBtn").click(); await idle(); await select(batch.notes[1].itemId);
    const beforeDiscard = await snapshot(page); await page.locator("#dummyPreviewRejectBtn").click(); await idle();
    assert.deepEqual(await snapshot(page), beforeDiscard);
    const final = await call("submit_notes_preview", multiple);
    assert.deepEqual(final.notes.map(item => item.state), ["saved", "rejected"]); assert.equal(final.saved, false);
    assert.equal((await snapshot(page)).notes.length, baseline.notes.length + 2);
    assert.deepEqual(errors, []);
    const historyText = await fs.readFile(path.join(directory, "history.json"), "utf8");
    for (const forbidden of [input.body, input.title, gateway.token, browserToken, adapterToken, principal.sub]) assert.ok(!historyText.includes(forbidden));
    console.log("OAuth HTTP -> isolated persistent receiver -> unsaved browser preview -> explicit save/discard: text, multiple notes, process restart, replay, existing notes preserved; no credentials/body in history; passed");
  } finally {
    if (browser) await browser.close(); if (gateway) await close(gateway.server);
    if (receiver) { await close(receiver.server); await receiver.history.close(); }
    await close(staticServer);
    const resolved = path.resolve(directory); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
