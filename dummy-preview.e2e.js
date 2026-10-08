"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { randomBytes, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { createPreviewService } = require("./dummy-preview-service.js");
const { createQueue, dummyRequest, FIXTURE, TTL_MS } = require("./dummy-preview-queue.js");
const artifacts = path.join(__dirname, "e2e-artifacts/dummy-preview");
const channel = process.env.MEMO_NEXUS_E2E_CHANNEL || "chromium";
function listen(server, port) {
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
}
function close(server) { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); }
async function snapshot(page) {
  return page.evaluate(async () => {
    async function encode(value) {
      if (value instanceof Blob) return { kind: "Blob", type: value.type, bytes: Array.from(new Uint8Array(await value.arrayBuffer())) };
      if (value instanceof ArrayBuffer) return { kind: "ArrayBuffer", bytes: Array.from(new Uint8Array(value)) };
      if (ArrayBuffer.isView(value)) return { kind: value.constructor.name, bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
      if (value instanceof Date) return { kind: "Date", value: value.toISOString() };
      if (Array.isArray(value)) return Promise.all(value.map(encode));
      if (value && typeof value === "object") {
        const entries = await Promise.all(Object.keys(value).sort().map(async (key) => [key, await encode(value[key])]));
        return Object.fromEntries(entries);
      }
      return value;
    }
    const database = await new Promise((resolve, reject) => { const req = indexedDB.open("memo-nexus"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    try {
      const stores = {};
      for (const name of Array.from(database.objectStoreNames).sort()) {
        const pairs = await new Promise((resolve, reject) => {
          const transaction = database.transaction(name, "readonly"); const store = transaction.objectStore(name);
          const keys = store.getAllKeys(); const values = store.getAll();
          transaction.oncomplete = () => resolve(keys.result.map((key, index) => [key, values.result[index]]));
          transaction.onerror = () => reject(transaction.error);
        });
        stores[name] = await encode(pairs);
      }
      return stores;
    } finally { database.close(); }
  });
}
function compareNormalReload(before, after, currentId) {
  const oldNote = before.notes.find(([key]) => key === currentId)[1];
  const newNote = after.notes.find(([key]) => key === currentId)[1];
  const changed = Object.keys(oldNote).filter((key) => JSON.stringify(oldNote[key]) !== JSON.stringify(newNote[key])).sort();
  assert.deepEqual(changed, ["bodyUpdatedAt", "revision", "updatedAt"]);
  assert.equal(newNote.revision, oldNote.revision + 1);
  assert.ok(newNote.bodyUpdatedAt >= oldNote.bodyUpdatedAt && newNote.updatedAt >= oldNote.updatedAt);
  const normalized = structuredClone(after);
  const note = normalized.notes.find(([key]) => key === currentId)[1];
  for (const key of changed) note[key] = oldNote[key];
  assert.deepEqual(normalized, before, "only exact existing normal-reload metadata changes are permitted");
  return { noteId: currentId, changedFields: changed, before: Object.fromEntries(changed.map((key) => [key, oldNote[key]])), after: Object.fromEntries(changed.map((key) => [key, newNote[key]])) };
}
async function settled(page) {
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
  await page.waitForFunction(() => typeof webClipReceiverReady !== "undefined" && webClipReceiverReady);
  await page.evaluate(async () => { await flushScheduledNoteSave(currentId); await Promise.all(notes.map((note) => noteSaveFoundation.whenIdle(note.id))); });
}
async function mcpRoundTrip(adapterToken, requestId) {
  const child = spawn(process.execPath, [path.join(__dirname, "dummy-preview-mcp.js")], { windowsHide: true, env: { ...process.env, MEMO_PREVIEW_ADAPTER_TOKEN: adapterToken }, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = ""; let resolveNext; let rejectNext;
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString(); const newline = buffer.indexOf("\n");
    if (newline !== -1 && resolveNext) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); resolveNext(JSON.parse(line)); resolveNext = null; }
  });
  child.on("error", (error) => rejectNext?.(error));
  child.on("exit", () => rejectNext?.(new Error("MCP child exited")));
  const call = (message) => new Promise((resolve, reject) => { resolveNext = resolve; rejectNext = reject; child.stdin.write(JSON.stringify(message) + "\n"); });
  const deadline = setTimeout(() => { rejectNext?.(new Error("MCP timeout")); child.kill(); }, 5000);
  try {
    await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "isolated-test", version: "1" } } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const response = await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "submit_dummy_preview", arguments: { requestId } } });
    assert.equal(response.result.isError, false);
    const result = JSON.parse(response.result.content[0].text);
    assert.equal(result.requestId, requestId); assert.equal(result.body, FIXTURE.body); assert.equal(result.title, FIXTURE.title);
    return result;
  } finally { clearTimeout(deadline); child.kill(); }
}
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const browserToken = randomBytes(32).toString("base64url"); const adapterToken = randomBytes(32).toString("base64url");
  let time = Date.now(); const queue = createQueue({ now: () => time });
  const { server: receiver } = createPreviewService({ browserToken, adapterToken, queue });
  const root = __dirname;
  const staticServer = http.createServer(async (req, res) => {
    const relative = new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try { const data = await fs.readFile(file); res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "application/javascript" }); res.end(data); }
    catch { res.writeHead(404).end(); }
  });
  let browser; let receiverRunning = false; let staticRunning = false; const results = [];
  try {
    await listen(receiver, 8791); receiverRunning = true; await listen(staticServer, 5500); staticRunning = true;
    browser = await chromium.launch({ headless: true, ...(channel === "chromium" ? {} : { channel }) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
    const page = await context.newPage(); const pageErrors = []; const unsafeRequests = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (req) => { if (req.url().includes("example.invalid")) unsafeRequests.push(req.url()); });
    await page.goto("http://127.0.0.1:5500/", { waitUntil: "domcontentloaded" }); await settled(page);
    // Prepare all kinds of existing records, then let the ordinary startup normalize them before taking the baseline.
    await page.evaluate(async () => {
      const note = await createNote("既存の検証メモ", "# 既存本文\n[[知識リンク]]\n", { tags: ["preview-existing-tag"] });
      const deleted = await createNote("削除済みの検証メモ", "既存の削除済み本文");
      deleted.deletedAt = Date.now(); await putNote(deleted);
      const transaction = db.transaction(["collections", "tags", "attachments", "local-config", "note-tombstones"], "readwrite");
      transaction.objectStore("collections").put({ id: "preview-existing-collection", name: "既存コレクション", parentId: null, sortOrder: 20, isSystem: false });
      transaction.objectStore("tags").put({ id: "preview-existing-tag", name: "既存タグ", color: "#5f8f57", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      transaction.objectStore("attachments").put({ id: "preview-existing-attachment", memoId: note.id, name: "existing.bin", mimeType: "application/octet-stream", blob: new Blob([new Uint8Array([0, 1, 127, 128, 255])], { type: "application/octet-stream" }), createdAt: Date.now() });
      transaction.objectStore("local-config").put({ key: "preview-existing-config", value: { enabled: false, label: "既存設定" } });
      transaction.objectStore("note-tombstones").put({ noteId: "preview-permanently-deleted", deletionId: "preview-deletion-record", deletedAt: Date.now() });
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
    });
    await page.reload(); await settled(page); const controlBefore = await snapshot(page);
    const currentNoteId = await page.evaluate(() => currentId);
    await page.reload(); await settled(page); const baseline = await snapshot(page);
    const controlReload = compareNormalReload(controlBefore, baseline, currentNoteId);
    results.push("no-receive reload control: existing draft restore advances only current note bodyUpdatedAt, updatedAt and revision");
    const editorBefore = await page.locator("#editor").inputValue();
    // Assert no save capabilities are called after ordinary startup; throw if any path is reached.
    await page.evaluate(() => {
      window.previewSaveCalls = [];
      for (const name of ["createNote", "persistIncomingNote", "putNote", "enqueueNoteSave", "saveWebClip", "importMarkdownZip"]) {
        if (typeof window[name] === "function") window[name] = () => { window.previewSaveCalls.push(name); throw new Error("Unexpected persistence call"); };
      }
    });
    const requestId = randomUUID(); const toolResult = await mcpRoundTrip(adapterToken, requestId);
    assert.equal(queue.peek().requestId, requestId);
    const open = async () => {
      await page.keyboard.press("Escape");
      if (await page.locator("#mobileWritingDoneBtn").isVisible()) await page.locator("#mobileWritingDoneBtn").click();
      await page.locator("#dummyPreviewOpenBtn").evaluate((el) => { const details = el.closest("details"); if (details) details.open = true; });
      await page.locator("#dummyPreviewOpenBtn").focus(); await page.keyboard.press("Enter");
      assert.equal(await page.locator("#dummyPreviewToken").evaluate((el) => el === document.activeElement), true, JSON.stringify({ state: await page.evaluate(() => ({ active: document.activeElement.id, open: document.getElementById("dummyPreviewDialog").open })), pageErrors }));
      await page.locator("#dummyPreviewToken").fill(browserToken);
    };
    const check = async () => {
      await page.locator("#dummyPreviewCheckBtn").click();
      await page.waitForFunction(() => !document.getElementById("dummyPreviewCheckBtn").disabled);
    };
    await open(); await check();
    assert.equal(await page.locator("#dummyPreviewBody").textContent(), FIXTURE.body);
    assert.equal(await page.locator("#dummyPreviewTitle").textContent(), FIXTURE.title);
    assert.equal(await page.locator("#dummyPreviewRequestId").textContent(), toolResult.requestId);
    assert.match(await page.locator("#dummyPreviewStatus").textContent(), /未保存/);
    assert.equal(await page.locator("#dummyPreviewToken").inputValue(), "");
    await check(); assert.equal(await page.locator("#dummyPreviewContent").count(), 1);
    assert.equal(await page.locator("#dummyPreviewStatus").getAttribute("role"), "status");
    await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.getElementById("dummyPreviewDialog").contains(document.activeElement)), true);
    await page.locator("#dummyPreviewDialog").evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: path.join(artifacts, `${channel}-390.png`) });
    assert.equal(await page.locator("#dummyPreviewDialog").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.locator("#dummyPreviewBody img, #dummyPreviewBody script, #dummyPreviewBody a").count(), 0);
    assert.equal(await page.evaluate(() => window.previewExecuted), undefined); assert.deepEqual(unsafeRequests, []);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement === document.getElementById("dummyPreviewOpenBtn"));
    assert.equal(queue.peek().requestId, requestId);
    await open(); await check(); assert.equal(await page.locator("#dummyPreviewBody").textContent(), FIXTURE.body);
    results.push("real stdio MCP → authenticated local queue → 390px browser: exact requestId/title/body; repeat and close/reopen; HTML stays text");
    await page.route("http://127.0.0.1:8791/reject", (route) => route.fulfill({ status: 503, headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:5500" }, body: "{}" }));
    await page.locator("#dummyPreviewRejectBtn").click();
    await page.waitForFunction(() => document.getElementById("dummyPreviewStatus").textContent.includes("拒否の完了を確認できません"));
    assert.equal(queue.peek().requestId, requestId);
    await page.unroute("http://127.0.0.1:8791/reject");
    await page.locator("#dummyPreviewRejectBtn").click();
    await page.waitForFunction(() => document.getElementById("dummyPreviewStatus").textContent.includes("拒否が完了"));
    assert.equal(queue.status(requestId).state, "rejected");
    const expiredId = randomUUID(); queue.submit(dummyRequest(expiredId)); await check(); time += TTL_MS;
    await check(); assert.match(await page.locator("#dummyPreviewState").textContent(), /期限切れ/);
    assert.equal(await page.locator("#dummyPreviewRejectBtn").isDisabled(), true);
    await page.locator("#dummyPreviewCloseBtn").click(); await open();
    await page.locator("#dummyPreviewToken").fill(randomBytes(32).toString("base64url")); await check();
    assert.match(await page.locator("#dummyPreviewStatus").textContent(), /認証に失敗/);
    await page.locator("#dummyPreviewToken").fill(browserToken);
    await page.route("http://127.0.0.1:8791/pending", (route) => route.abort("accessdenied")); await check();
    assert.match(await page.locator("#dummyPreviewStatus").textContent(), /受信を確認できません/);
    await page.unroute("http://127.0.0.1:8791/pending");
    await page.route("http://127.0.0.1:8791/pending", async (route) => { await new Promise((resolve) => setTimeout(resolve, 5500)); await route.abort().catch(() => {}); });
    await check(); assert.match(await page.locator("#dummyPreviewStatus").textContent(), /受信を確認できません/);
    await page.unroute("http://127.0.0.1:8791/pending");
    await page.route("http://127.0.0.1:8791/pending", (route) => route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:5500" }, body: JSON.stringify({ pending: { ...dummyRequest(randomUUID()), noteId: "forbidden" } }) }));
    await check(); assert.match(await page.locator("#dummyPreviewStatus").textContent(), /受信を確認できません/);
    await page.unroute("http://127.0.0.1:8791/pending");
    await close(receiver); receiverRunning = false; await check();
    assert.match(await page.locator("#dummyPreviewStatus").textContent(), /受信を確認できません/);
    await page.locator("#dummyPreviewCloseBtn").click();
    assert.deepEqual(await page.evaluate(() => window.previewSaveCalls), []);
    assert.equal(await page.locator("#editor").inputValue(), editorBefore);
    assert.deepEqual(await snapshot(page), baseline, "after all receive operations");
    const secretStored = await page.evaluate((secret) => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(secret), browserToken);
    assert.equal(secretStored, false);
    await page.reload(); await settled(page); const afterReload = await snapshot(page); const receiveReload = compareNormalReload(baseline, afterReload, currentNoteId);
    assert.equal(afterReload.notes.length - baseline.notes.length, 0);
    assert.deepEqual(pageErrors, []);
    results.push("rejection failure/retry, expiry, invalid auth, simulated permission denial and timeout, actual service stop; no save calls; all six stores and attachment bytes identical immediately after operations; reload has only the same three metadata changes as control; 0 new notes");
    const summary = { channel, browserVersion: browser.version(), platform: process.platform, node: process.version, origin: "http://127.0.0.1:5500", requestId, controlReload, receiveReload, results,
      notVerified: ["GitHub Pages real Origin / HTTPS → loopback LNA and mixed content", "real permission prompt and denied LNA", "ChatGPT → Secure MCP Tunnel", "MCP OAuth", "manual assistive technology readout"] };
    await fs.writeFile(path.join(artifacts, `${channel}-control-before.json`), JSON.stringify(controlBefore, null, 2));
    await fs.writeFile(path.join(artifacts, `${channel}-baseline.json`), JSON.stringify(baseline, null, 2));
    await fs.writeFile(path.join(artifacts, `${channel}-after.json`), JSON.stringify(afterReload, null, 2));
    await fs.writeFile(path.join(artifacts, `${channel}-result.json`), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    await context.close();
  } catch (error) {
    await fs.writeFile(path.join(artifacts, `${channel}-failure.txt`), error.stack || String(error)); throw error;
  } finally {
    await browser?.close(); if (receiverRunning) await close(receiver); if (staticRunning) await close(staticServer);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
