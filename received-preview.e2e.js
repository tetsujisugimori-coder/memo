"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { randomBytes, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { createPreviewService } = require("./dummy-preview-service.js");
const { textRequest } = require("./dummy-preview-queue.js");
const artifacts = path.join(__dirname, "e2e-artifacts/received-preview");
const channel = process.env.MEMO_NEXUS_E2E_CHANNEL || "chromium";
const listen = (server, port) => new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
const close = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
async function settled(page) {
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
  await page.waitForFunction(() => typeof webClipReceiverReady !== "undefined" && webClipReceiverReady);
  await page.evaluate(async () => { await flushScheduledNoteSave(currentId); await Promise.all(notes.map((note) => noteSaveFoundation.whenIdle(note.id))); });
}
async function snapshot(page) {
  return page.evaluate(async () => {
    async function encode(value) {
      if (value instanceof Blob) return { type: value.type, bytes: [...new Uint8Array(await value.arrayBuffer())] };
      if (value instanceof ArrayBuffer) return [...new Uint8Array(value)];
      if (ArrayBuffer.isView(value)) return [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)];
      if (Array.isArray(value)) return Promise.all(value.map(encode));
      if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.keys(value).sort().map(async (key) => [key, await encode(value[key])])));
      return value;
    }
    const result = {};
    for (const name of [...db.objectStoreNames].sort()) {
      const pairs = await new Promise((resolve, reject) => {
        const tx = db.transaction(name, "readonly"); const store = tx.objectStore(name); const keys = store.getAllKeys(); const values = store.getAll();
        tx.oncomplete = () => resolve(keys.result.map((key, index) => [key, values.result[index]])); tx.onabort = tx.onerror = () => reject(tx.error);
      });
      result[name] = await encode(pairs);
    }
    return result;
  });
}
async function mcp(token, value) {
  const child = spawn(process.execPath, [path.join(__dirname, "dummy-preview-mcp.js")], { windowsHide: true,
    env: { ...process.env, MEMO_PREVIEW_ADAPTER_TOKEN: token }, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", next;
  child.stdout.on("data", (chunk) => { buffer += chunk.toString(); const newline = buffer.indexOf("\n"); if (newline >= 0 && next) { const resolve = next; next = null; const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); resolve(JSON.parse(line)); } });
  const call = (message) => new Promise((resolve) => { next = resolve; child.stdin.write(JSON.stringify(message) + "\n"); });
  let timer;
  try {
    return await Promise.race([(async () => {
      await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      const response = await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "submit_text_preview", arguments: value, _meta: { progressToken: "pr2-e2e" } } });
      assert.equal(response.error, undefined); assert.equal(response.result.isError, false);
      return JSON.parse(response.result.content[0].text);
    })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("MCP timeout")), 10000); })]);
  } finally { clearTimeout(timer); child.kill(); }
}
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const browserToken = randomBytes(32).toString("base64url"), adapterToken = randomBytes(32).toString("base64url");
  const { server: receiver, queue } = createPreviewService({ browserToken, adapterToken });
  const staticServer = http.createServer(async (req, res) => {
    const relative = new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html";
    const file = path.resolve(__dirname, relative);
    if (!file.startsWith(__dirname + path.sep)) return res.writeHead(403).end();
    try { res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "application/javascript" }); res.end(await fs.readFile(file)); }
    catch { res.end(); }
  });
  let browser, page, receiverRunning = false, staticRunning = false;
  const results = [];
  try {
    await listen(receiver, 8791); receiverRunning = true; await listen(staticServer, 5500); staticRunning = true;
    browser = await chromium.launch({ headless: true, ...(channel === "chromium" ? {} : { channel }) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
    page = await context.newPage(); const unsafe = [], errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (request.url().includes("preview-test.invalid")) unsafe.push(request.url()); });
    await page.route("**/*preview-test.invalid/**", (route) => route.abort());
    await page.goto("http://127.0.0.1:5500/", { waitUntil: "domcontentloaded" }); await settled(page);
    await page.evaluate(async () => {
      const collection = { id: "received-test-collection", name: "受信検証専用", parentId: null, sortOrder: 20, isSystem: false };
      const transaction = db.transaction("collections", "readwrite"); transaction.objectStore("collections").put(collection);
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
      collections.push(collection); selectedCollectionId = collection.id;
      await createNote("既存メモ保護の検証", "既存の本文\n[[知識リンク]]");
    });
    const baseline = await snapshot(page); const editorBefore = await page.locator("#editor").inputValue();
    const open = async () => {
      await page.keyboard.press("Escape");
      if (await page.locator("#mobileWritingDoneBtn").isVisible()) await page.locator("#mobileWritingDoneBtn").click();
      await page.locator("#dummyPreviewOpenBtn").evaluate((el) => { el.closest("details").open = true; });
      await page.locator("#dummyPreviewOpenBtn").focus(); await page.keyboard.press("Enter");
      await page.locator("#dummyPreviewToken").fill(browserToken);
    };
    const check = async () => { await page.locator("#dummyPreviewCheckBtn").click(); await page.waitForFunction(() => !document.getElementById("dummyPreviewCheckBtn").disabled); };
    const doneSave = async () => { await page.waitForFunction(() => !document.getElementById("dummyPreviewCheckBtn").disabled); };
    const value = { requestId: randomUUID(), title: "日本語 受信保存テスト", body: "\n日本語本文\n\n- 箇条書き\n- 二つ目\n\n`inline code`\n```js\nconst value = '文字列';\n```\n\n<script>window.receivedExecuted=true</script>\n<img src='https://preview-test.invalid/image' onerror='window.receivedExecuted=true'>\n[外部URL](https://preview-test.invalid/link)\n![画像](https://preview-test.invalid/md-image)\n" + "長い本文\n".repeat(800) };
    const tool = await mcp(adapterToken, value); assert.equal(tool.saved, false); assert.equal(tool.body, value.body);
    assert.deepEqual(await mcp(adapterToken, value), tool);
    await open(); await check();
    assert.equal(await page.locator("#dummyPreviewBody").textContent(), value.body);
    assert.equal(await page.locator("#dummyPreviewTitle").textContent(), value.title);
    assert.match(await page.locator("#dummyPreviewBadge").textContent(), /未保存/);
    assert.match(await page.locator("#dummyPreviewDestination").textContent(), /受信検証専用/);
    assert.equal(await page.locator("#dummyPreviewBody img, #dummyPreviewBody a, #dummyPreviewBody script").count(), 0);
    assert.deepEqual(unsafe, []); assert.equal(await page.evaluate(() => window.receivedExecuted), undefined);
    assert.deepEqual(await snapshot(page), baseline); assert.equal(await page.locator("#editor").inputValue(), editorBefore);
    await page.locator("#dummyPreviewRejectBtn").click(); await doneSave();
    assert.equal(queue.status(value.requestId).state, "rejected"); assert.deepEqual(await snapshot(page), baseline);
    assert.equal((await mcp(adapterToken, value)).state, "rejected");
    results.push("real stdio MCP -> queue -> preview/discard: exact Japanese/blank lines/Markdown; all stores and editor unchanged; no external requests or code execution");

    const saving = { ...value, requestId: randomUUID() }; await mcp(adapterToken, saving); await check();
    await page.evaluate(() => {
      window.originalPreviewPut = putNote;
      putNote = async () => { throw new DOMException("検証用容量不足", "QuotaExceededError"); };
    });
    await page.locator("#dummyPreviewSaveBtn").click(); await doneSave();
    assert.match(await page.locator("#dummyPreviewStatus").textContent(), /保存完了を確認できません/);
    assert.equal(queue.peek().state, "save_failed"); assert.equal(queue.peek().saved, false);
    assert.equal(await page.locator("#dummyPreviewBody").textContent(), saving.body);
    assert.deepEqual(await snapshot(page), baseline);
    const plan = queue.peek().savePlan;
    // Abort an actual IndexedDB write transaction, then retain the exact same plan.
    await page.evaluate(() => {
      putNote = window.originalPreviewPut;
      window.previewRealTransaction = db.transaction.bind(db);
      db.transaction = (...args) => {
        const transaction = window.previewRealTransaction(...args);
        if (args[1] === "readwrite" && Array.from(typeof args[0] === "string" ? [args[0]] : args[0]).includes("notes")) queueMicrotask(() => transaction.abort());
        return transaction;
      };
    });
    await page.locator("#dummyPreviewSaveBtn").click(); await doneSave();
    assert.equal(queue.peek().state, "save_failed"); assert.deepEqual(queue.peek().savePlan, plan);
    assert.deepEqual(await snapshot(page), baseline);
    await page.locator("#dummyPreviewStatus").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, `${channel}-error-visible-390.png`) });
    await page.locator("#dummyPreviewDialog").evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.locator("#dummyPreviewDestination").scrollIntoViewIfNeeded();
    assert.equal(await page.locator("#dummyPreviewDialog").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: path.join(artifacts, `${channel}-failure-390.png`) });
    // Reload restores real save functions; retries must keep the original destination and ID.
    await page.reload(); await settled(page); await open(); await check();
    assert.equal(await page.locator("#dummyPreviewBody").textContent(), saving.body);
    assert.match(await page.locator("#dummyPreviewDestination").textContent(), /受信検証専用/);
    const beforeRetry = await snapshot(page);
    // Hold the real transaction path, click twice and verify the second click is ignored.
    await page.evaluate(() => { window.realPreviewPut = putNote; window.previewPutCount = 0; putNote = async (...args) => { window.previewPutCount++; await new Promise((resolve) => setTimeout(resolve, 300)); return window.realPreviewPut(...args); }; });
    await page.locator("#dummyPreviewSaveBtn").click();
    assert.equal(await page.locator("#dummyPreviewSaveBtn").isDisabled(), true);
    await page.locator("#dummyPreviewSaveBtn").evaluate((el) => el.click());
    await doneSave();
    assert.equal(await page.evaluate(() => window.previewPutCount), 1);
    assert.equal(queue.status(saving.requestId).saved, true);
    assert.match(await page.locator("#dummyPreviewBadge").textContent(), /保存済み/);
    const afterSave = await snapshot(page);
    assert.equal(afterSave.notes.length, beforeRetry.notes.length + 1);
    const saved = afterSave.notes.find(([id]) => id === plan.noteId)[1];
    assert.equal(saved.body, saving.body); assert.equal(saved.collectionId, "received-test-collection");
    const normalized = structuredClone(afterSave); normalized.notes = normalized.notes.filter(([id]) => id !== plan.noteId);
    assert.deepEqual(normalized, beforeRetry);
    assert.equal((await mcp(adapterToken, saving)).saved, true); assert.equal(queue.peek(), null);
    assert.throws(() => queue.submit(textRequest({ ...saving, body: "置換しない" })), /request_id_conflict/);
    results.push("quota failure keeps unsaved content; reload/retry uses same ID/destination; double click produces one transaction and one new memo; existing stores unchanged");
    await page.reload(); await settled(page);
    const persisted = (await snapshot(page)).notes.find(([id]) => id === plan.noteId)[1]; assert.equal(persisted.body, saving.body);
    await page.evaluate((id) => openNote(id), plan.noteId); await settled(page);
    assert.equal(await page.locator("#editor").inputValue(), saving.body);
    assert.equal(await page.evaluate(() => window.receivedExecuted), undefined); assert.deepEqual(unsafe, []);
    results.push("ordinary reload retains exact body; normal note preview does not execute received script/img onerror or request received URLs");

    // A committed transaction followed by an uncertain failure must not create a second note.
    const uncertain = { ...value, requestId: randomUUID(), title: "コミット後の再試行" }; await mcp(adapterToken, uncertain); await open(); await check();
    await page.evaluate(() => { window.realCreateReceived = createNote; window.onceReceivedFailure = true; createNote = async (...args) => { const note = await window.realCreateReceived(...args); if (window.onceReceivedFailure) { window.onceReceivedFailure = false; throw new Error("コミット後通知失敗の検証"); } return note; }; });
    const beforeUncertain = (await snapshot(page)).notes.length;
    await page.locator("#dummyPreviewSaveBtn").click(); await doneSave();
    assert.equal(queue.peek().saved, false); assert.equal((await snapshot(page)).notes.length, beforeUncertain + 1);
    await page.locator("#dummyPreviewSaveBtn").click(); await doneSave();
    assert.equal(queue.status(uncertain.requestId).saved, true); assert.equal((await snapshot(page)).notes.length, beforeUncertain + 1);
    results.push("post-commit uncertainty retries by reading the same stored record without creating or overwriting");

    const lostAck = { ...value, requestId: randomUUID(), title: "保存完了応答消失" }; await mcp(adapterToken, lostAck); await check();
    const beforeAck = (await snapshot(page)).notes.length;
    await page.route("http://127.0.0.1:8791/complete", async (route) => {
      await route.fetch();
      await route.fulfill({ status: 503, headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:5500" }, body: "{}" });
    });
    await page.locator("#dummyPreviewSaveBtn").click(); await doneSave();
    assert.match(await page.locator("#dummyPreviewStatus").textContent(), /保存完了を確認できません/);
    assert.equal(queue.status(lostAck.requestId).saved, true);
    await page.unroute("http://127.0.0.1:8791/complete");
    await page.locator("#dummyPreviewSaveBtn").click(); await doneSave();
    assert.match(await page.locator("#dummyPreviewStatus").textContent(), /ブラウザ内に保存しました/);
    assert.equal((await snapshot(page)).notes.length, beforeAck + 1);
    results.push("lost completion response retries an already-saved receipt without duplicating the memo");

    const parallel = { requestId: randomUUID(), title: "複数タブの保存検証", body: "\r\n日本語\r\n\r\n- 項目\r\n  末尾空白  \r\n" };
    await mcp(adapterToken, parallel); await check();
    const firstPage = page, secondPage = await context.newPage();
    await secondPage.goto("http://127.0.0.1:5500/", { waitUntil: "domcontentloaded" }); await settled(secondPage);
    page = secondPage; await open(); await check(); page = firstPage;
    for (const tab of [firstPage, secondPage]) await tab.evaluate(() => {
      window.parallelRealCreate = createNote; window.parallelCreateCalls = 0;
      createNote = async (...args) => { window.parallelCreateCalls++; await new Promise((resolve) => setTimeout(resolve, 100)); return window.parallelRealCreate(...args); };
    });
    const beforeParallel = (await snapshot(firstPage)).notes.length;
    await Promise.all([firstPage.locator("#dummyPreviewSaveBtn").click(), secondPage.locator("#dummyPreviewSaveBtn").click()]);
    await Promise.all([firstPage.waitForFunction(() => !document.getElementById("dummyPreviewCheckBtn").disabled), secondPage.waitForFunction(() => !document.getElementById("dummyPreviewCheckBtn").disabled)]);
    const planParallel = queue.status(parallel.requestId).savePlan;
    assert.equal(queue.status(parallel.requestId).saved, true);
    assert.equal((await snapshot(firstPage)).notes.length, beforeParallel + 1);
    assert.equal((await firstPage.evaluate(() => window.parallelCreateCalls)) + (await secondPage.evaluate(() => window.parallelCreateCalls)), 1);
    assert.equal((await snapshot(firstPage)).notes.find(([id]) => id === planParallel.noteId)[1].body, parallel.body);
    await secondPage.close();
    results.push("two tabs sharing the same browser DB serialize saves to one new memo; CRLF and trailing whitespace stay exact in storage");

    const offline = { ...value, requestId: randomUUID(), title: "保存領域なしの検証" }; await mcp(adapterToken, offline); await check();
    await page.evaluate(() => { window.receivedRealDb = db; db = null; });
    await page.locator("#dummyPreviewSaveBtn").click(); await doneSave();
    assert.equal(queue.peek().saved, false); assert.match(await page.locator("#dummyPreviewStatus").textContent(), /保存領域を利用できません/);
    await page.evaluate(() => { db = window.receivedRealDb; });
    await page.locator("#dummyPreviewRejectBtn").click(); await doneSave();
    assert.equal(queue.status(offline.requestId).state, "rejected");
    results.push("unavailable storage reports failure, retains input, and can discard the failed receipt without deleting notes");
    await page.locator("#dummyPreviewCloseBtn").click();
    await page.evaluate(() => { createNote = window.realCreateReceived; });
    const ordinaryBefore = (await snapshot(page)).notes.length;
    await page.locator("#newBtn").evaluate((el) => el.click()); await settled(page);
    await page.locator("#editor").fill("通常新規保存の検証\n"); await page.waitForTimeout(400); await settled(page);
    assert.equal((await snapshot(page)).notes.length, ordinaryBefore + 1);
    assert.equal(await page.evaluate(() => currentNote().body), "通常新規保存の検証\n");
    await page.setViewportSize({ width: 320, height: 640 });
    await open(); await check();
    assert.equal(await page.locator("#dummyPreviewDialog").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: path.join(artifacts, `${channel}-320.png`) });
    results.push("390px error/destination/actions and 320px dialog remain accessible without horizontal overflow");
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, `${channel}-result.json`), JSON.stringify({ channel, results, secureTunnel: "not exercised; local stdio only", errors, unsafe }, null, 2));
    console.log(results.join("\n"));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(artifacts, `${channel}-failure.png`) }).catch(() => {});
    await fs.writeFile(path.join(artifacts, `${channel}-error.txt`), String(error.stack)); throw error;
  } finally { await browser?.close(); if (receiverRunning) await close(receiver); if (staticRunning) await close(staticServer); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
