"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { randomBytes, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { createPreviewService } = require("./dummy-preview-service.js");
const { notesRequest } = require("./dummy-preview-queue.js");
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
      const response = await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "submit_notes_preview", arguments: value, _meta: { progressToken: "pr3-e2e" } } });
      assert.equal(response.error, undefined); assert.equal(response.result.isError, false);
      return JSON.parse(response.result.content[0].text);
    })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("MCP timeout")), 10000); })]);
  } finally { clearTimeout(timer); child.kill(); }
}
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const browserToken = randomBytes(32).toString("base64url"), adapterToken = randomBytes(32).toString("base64url");
  let serviceClock = Date.now();
  const { server: receiver, queue } = createPreviewService({ browserToken, adapterToken, now: () => serviceClock });
  const staticServer = http.createServer(async (req, res) => {
    const file = path.resolve(__dirname, new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html");
    if (!file.startsWith(__dirname + path.sep)) return res.writeHead(403).end();
    try { const data = await fs.readFile(file); res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "application/javascript" }); res.end(data); }
    catch { res.writeHead(404).end(); }
  });
  let browser, receiverRunning = false, staticRunning = false, page;
  const results = [], errors = [], unsafe = [];
  const idle = (p) => p.waitForFunction(() => !document.getElementById("dummyPreviewCheckBtn").disabled);
  const check = async (p) => { await p.locator("#dummyPreviewCheckBtn").click(); await idle(p); };
  const open = async (p) => {
    await p.keyboard.press("Escape");
    if (await p.locator("#mobileWritingDoneBtn").isVisible()) await p.locator("#mobileWritingDoneBtn").click();
    await p.locator("#dummyPreviewOpenBtn").evaluate((el) => { el.closest("details").open = true; });
    await p.locator("#dummyPreviewOpenBtn").focus(); await p.keyboard.press("Enter");
    await p.locator("#dummyPreviewToken").fill(browserToken); await check(p);
  };
  const select = async (p, id) => {
    const el = p.locator(`[data-item-id="${id}"]`);
    await el.evaluate((el) => { const details = el.closest("details"); if (details) details.open = true; });
    await el.click();
  };
  const clickSave = async (p) => { await p.locator("#dummyPreviewSaveBtn").click(); await idle(p); };
  const reject = async (p) => { await p.locator("#dummyPreviewRejectBtn").click(); await idle(p); };
  const gate = (p, mode = "write") => p.evaluate((mode) => {
    window.originalNotesPut = putNote; window.notesPutCalls = 0;
    window.notesWriteGate = new Promise((resolve) => { window.releaseNotesWrite = resolve; });
    putNote = async (...args) => { window.notesPutCalls++; await window.notesWriteGate; if (mode === "fail") throw new DOMException("検証用容量不足", "QuotaExceededError"); return window.originalNotesPut(...args); };
  }, mode);
  const waitLock = (p, id) => p.waitForFunction(async (id) => (await navigator.locks.query()).pending.some((lock) => lock.name === `memo-received-request:${id}`), id);
  try {
    await listen(receiver, 8791); receiverRunning = true; await listen(staticServer, 5500); staticRunning = true;
    browser = await chromium.launch({ headless: true, ...(channel === "chromium" ? {} : { channel }) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
    page = await context.newPage();
    context.on("page", (p) => { p.on("pageerror", (e) => errors.push(e.message)); p.on("request", (r) => { if (r.url().includes("notes-test.invalid")) unsafe.push(r.url()); }); });
    page.on("pageerror", (e) => errors.push(e.message)); page.on("request", (r) => { if (r.url().includes("notes-test.invalid")) unsafe.push(r.url()); });
    await context.route("**/*notes-test.invalid/**", (r) => r.abort());
    await page.goto("http://127.0.0.1:5500/"); await settled(page);
    await page.evaluate(async () => {
      const collection = { id: "notes-test-collection", name: "複数受信検証", parentId: null, sortOrder: 20, isSystem: false };
      const tx = db.transaction(["collections", "attachments", "tags"], "readwrite");
      tx.objectStore("collections").put(collection);
      tx.objectStore("attachments").put({ id: "notes-test-attachment", noteId: "preserved", blob: new Blob([new Uint8Array([0, 1, 254, 255])], { type: "image/png" }) });
      tx.objectStore("tags").put(createTagDefinition("既存タグ", [], Date.now(), "#3f7fa6").definition);
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      collections.push(collection); selectedCollectionId = collection.id;
      await createNote("既存メモ保護", "既存\n[[知識リンク]]");
      const trashed = await createNote("ゴミ箱保護", "削除済みの原文"); trashed.deletedAt = Date.now(); await putNote(trashed);
    });
    const baseline = await snapshot(page), editor = await page.locator("#editor").inputValue();
    const value = { requestId: randomUUID(), notes: Array.from({ length: 5 }, (_, i) => ({ title: i === 0 ? "😀".repeat(200) : `複数メモ${i + 1}`, body: `原文${i}\r\n\n- 箇条書き  \n<script>window.notesExecuted=true</script>\n<img src="https://notes-test.invalid/image" onerror="window.notesExecuted=true">\n[リンク](https://notes-test.invalid/link)\n![画像](https://notes-test.invalid/md-image)\n` })) };
    const received = await mcp(adapterToken, value); assert.equal(received.saved, false); assert.equal(received.notes.length, 5);
    assert.deepEqual(await mcp(adapterToken, value), received);
    await open(page); assert.equal(await page.locator("#receivedNotesPending button").count(), 5);
    for (const item of received.notes) {
      await select(page, item.itemId);
      assert.equal(await page.locator("#dummyPreviewTitle").textContent(), item.title);
      assert.equal(await page.locator("#dummyPreviewBody").textContent(), item.body);
      assert.match(await page.locator("#dummyPreviewDestination").textContent(), /複数受信検証/);
    }
    assert.deepEqual(await snapshot(page), baseline); assert.equal(await page.locator("#editor").inputValue(), editor);
    assert.equal(await page.locator("#dummyPreviewBody img, #dummyPreviewBody script, #dummyPreviewBody a").count(), 0);
    assert.deepEqual(unsafe, []); assert.equal(await page.evaluate(() => window.notesExecuted), undefined);
    await page.setViewportSize({ width: 320, height: 740 });
    assert.ok(await page.locator("#dummyPreviewDialog").evaluate((el) => el.scrollWidth <= el.clientWidth));
    await page.screenshot({ path: path.join(artifacts, `${channel}-notes-five-320.png`) });
    for (const item of received.notes.slice(0, 2)) { await select(page, item.itemId); await clickSave(page); assert.match(await page.locator("#dummyPreviewBadge").textContent(), /保存済み/); }
    await select(page, received.notes[2].itemId); await reject(page);
    assert.deepEqual(queue.status(value.requestId).notes.map((item) => item.state), ["saved", "saved", "rejected", "queued", "queued"]);
    assert.equal(await page.locator("#receivedNotesPending button").count(), 2);
    assert.equal(await page.locator("#receivedNotesProcessed button").count(), 3);
    const partial = await snapshot(page); const savedIds = queue.status(value.requestId).notes.slice(0, 2).map((item) => item.savePlan.noteId);
    const unchanged = structuredClone(partial); unchanged.notes = unchanged.notes.filter(([id]) => !savedIds.includes(id)); assert.deepEqual(unchanged, baseline);
    for (let i = 0; i < 2; i++) assert.equal(partial.notes.find(([id]) => id === savedIds[i])[1].body, value.notes[i].body);
    assert.equal((await mcp(adapterToken, value)).notes.filter((item) => item.saved).length, 2);
    await page.reload(); await settled(page); await open(page);
    assert.equal(await page.locator("#receivedNotesPending button").count(), 2); assert.equal(await page.locator("#receivedNotesProcessed button").count(), 3);
    const reloaded = await snapshot(page); for (const id of savedIds) assert.deepEqual(reloaded.notes.find(([key]) => key === id), partial.notes.find(([key]) => key === id));
    for (const store of Object.keys(partial).filter((key) => key !== "notes")) assert.deepEqual(reloaded[store], partial[store]);
    results.push("five unsaved; exact text/safe preview; 2 saved/1 discarded/2 pending; all stores, attachment bytes, existing/trash notes preserved; partial reload and replay do not resurrect terminal items");

    const fourth = received.notes[3], fifth = received.notes[4];
    await select(page, fourth.itemId); await page.evaluate(() => { window.quotaPut = putNote; putNote = async () => { throw new DOMException("容量不足", "QuotaExceededError"); }; });
    await clickSave(page); assert.equal(queue.status(value.requestId, fourth.itemId).state, "save_failed");
    const fixed = queue.status(value.requestId, fourth.itemId).savePlan;
    assert.deepEqual(await snapshot(page), reloaded);
    await page.evaluate(() => { putNote = window.quotaPut; });
    // Drop complete before delivery: committed note, server remains saving.
    await page.route("**:8791/complete", (r) => r.abort());
    await clickSave(page); assert.equal(queue.status(value.requestId, fourth.itemId).state, "saving");
    assert.match(await page.locator("#dummyPreviewStatus").textContent(), /保存完了を確認できません/);
    await page.unroute("**:8791/complete"); await page.reload(); await settled(page); await open(page);
    await select(page, fourth.itemId); await clickSave(page);
    assert.equal(queue.status(value.requestId, fourth.itemId).state, "saved"); assert.deepEqual(queue.status(value.requestId, fourth.itemId).savePlan, fixed);
    assert.equal((await snapshot(page)).notes.filter(([id]) => id === fixed.noteId).length, 1);
    results.push("quota failure preserves all committed siblings; dropped completion request -> reload -> explicit retry recovers one fixed note");

    // Two tabs, same item, same displayed destination; a request lock covers the entire operation.
    const b = await context.newPage(); await b.goto("http://127.0.0.1:5500/"); await settled(b);
    await page.evaluate(() => { selectedCollectionId = "notes-test-collection"; }); await b.evaluate(() => { selectedCollectionId = "notes-test-collection"; });
    await check(page); await select(page, fifth.itemId); await open(b); await select(b, fifth.itemId);
    await gate(page); await page.locator("#dummyPreviewSaveBtn").click(); await page.waitForFunction(() => window.notesPutCalls === 1);
    await page.locator("#dummyPreviewSaveBtn").click({ force: true });
    await b.locator("#dummyPreviewSaveBtn").click(); await waitLock(b, value.requestId);
    const beforeDiscard = queue.status(value.requestId, fifth.itemId); await b.locator("#dummyPreviewRejectBtn").click({ force: true }); assert.deepEqual(queue.status(value.requestId, fifth.itemId), beforeDiscard);
    await page.evaluate(() => window.releaseNotesWrite()); await Promise.all([idle(page), idle(b)]);
    assert.equal(await page.evaluate(() => window.notesPutCalls), 1); assert.equal(queue.status(value.requestId, fifth.itemId).state, "saved");
    const lastId = queue.status(value.requestId, fifth.itemId).savePlan.noteId;
    assert.equal((await snapshot(page)).notes.filter(([id]) => id === lastId).length, 1);
    await check(page); assert.equal(await page.locator("#receivedNotesPending button").count(), 0); assert.equal(await page.locator("#receivedNotesProcessed button").count(), 5);
    assert.equal(queue.peek(), null); await b.close();
    await page.reload(); await settled(page); await open(page); await page.locator("#receivedRequestLookup").fill(value.requestId); await check(page);
    assert.equal(await page.locator("#receivedNotesPending button").count(), 0); assert.equal(await page.locator("#receivedNotesProcessed button").count(), 5);
    assert.equal((await mcp(adapterToken, value)).state, "completed");
    results.push("double click/two tabs/saving-discard race: one committed item; completed request lookup after reload keeps all five terminal receipts");

    // Fresh batch: different destinations in competing tabs, then a different item while the request lock is held.
    serviceClock += 60000; // Start an independent test phase without exhausting the unchanged 120/minute rate limit.
    const competing = { requestId: randomUUID(), notes: [{ title: "競合A", body: "原文A" }, { title: "競合B", body: "原文B" }] };
    const receipt = await mcp(adapterToken, competing); await page.locator("#receivedRequestLookup").fill(""); await check(page);
    const c = await context.newPage(); await c.goto("http://127.0.0.1:5500/"); await settled(c); await open(c);
    await page.evaluate(() => { selectedCollectionId = "notes-test-collection"; }); await check(page); await select(page, receipt.notes[0].itemId);
    await select(c, receipt.notes[0].itemId); await c.evaluate(() => { window.saveCalls = 0; window.realNotesSave = window.MemoNexusReceivedPreview.save; window.MemoNexusReceivedPreview.save = async (...args) => { window.saveCalls++; return window.realNotesSave(...args); }; });
    await gate(page); await page.locator("#dummyPreviewSaveBtn").click(); await page.waitForFunction(() => window.notesPutCalls === 1);
    await c.locator("#dummyPreviewSaveBtn").click(); await waitLock(c, competing.requestId);
    await page.evaluate(() => window.releaseNotesWrite()); await Promise.all([idle(page), idle(c)]);
    assert.equal(await c.evaluate(() => window.saveCalls), 0); assert.match(await c.locator("#dummyPreviewStatus").textContent(), /別タブ.*保存先.*もう一度/);
    await clickSave(c); assert.equal(await c.evaluate(() => window.saveCalls), 1);
    await select(page, receipt.notes[1].itemId); await select(c, receipt.notes[1].itemId);
    await page.evaluate(() => { putNote = window.originalNotesPut; }); await gate(page, "fail");
    await page.locator("#dummyPreviewSaveBtn").click(); await page.waitForFunction(() => window.notesPutCalls === 1);
    await c.locator("#dummyPreviewRejectBtn").click(); await waitLock(c, competing.requestId);
    await page.evaluate(() => window.releaseNotesWrite()); await Promise.all([idle(page), idle(c)]);
    assert.equal(queue.status(competing.requestId, receipt.notes[1].itemId).state, "rejected");
    assert.equal(queue.status(competing.requestId, receipt.notes[0].itemId).state, "saved"); await c.close();
    results.push("per-item destination mismatch stops before DB; explicit reconfirmation; failed sibling/discard leaves saved sibling intact");
    serviceClock += 60000;
    const independent = { requestId: randomUUID(), notes: [{ title: "別タブ項目1", body: "保存1" }, { title: "別タブ項目2", body: "保存2" }] };
    const independentReceipt = await mcp(adapterToken, independent);
    await page.evaluate(() => { putNote = window.originalNotesPut; }); await check(page);
    const d = await context.newPage(); await d.goto("http://127.0.0.1:5500/"); await settled(d); await open(d);
    await select(page, independentReceipt.notes[0].itemId); await select(d, independentReceipt.notes[1].itemId);
    await page.route("**:8791/complete", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch(); await route.abort(); // Service accepted completion; only its response is lost.
    });
    await gate(page); await page.locator("#dummyPreviewSaveBtn").click(); await page.waitForFunction(() => window.notesPutCalls === 1);
    await d.locator("#dummyPreviewSaveBtn").click(); await waitLock(d, independent.requestId);
    await page.evaluate(() => window.releaseNotesWrite()); await Promise.all([idle(page), idle(d)]);
    assert.deepEqual(queue.status(independent.requestId).notes.map((item) => item.state), ["saved", "saved"]);
    assert.match(await page.locator("#dummyPreviewStatus").textContent(), /保存完了を確認できません/);
    await page.unroute("**:8791/complete"); await clickSave(page);
    assert.equal(await page.evaluate(() => window.notesPutCalls), 1);
    for (const item of queue.status(independent.requestId).notes) assert.equal((await snapshot(page)).notes.filter(([id]) => id === item.savePlan.noteId).length, 1);
    await check(page); assert.equal(await page.locator("#receivedNotesPending button").count(), 0); await d.close();
    results.push("different items in two tabs serialize under the existing request lock; lost accepted-completion response retries without another DB write; each sibling saved once");
    assert.deepEqual(unsafe, []); assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, `${channel}-notes-results.json`), JSON.stringify({ results, unsafe, errors }, null, 2));
    console.log(JSON.stringify({ channel, results }, null, 2));
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(artifacts, `${channel}-notes-failure.png`) }).catch(() => {}); console.error(await page.locator("#dummyPreviewStatus").textContent().catch(() => "")); }
    throw error;
  } finally { await browser?.close(); if (staticRunning) await close(staticServer); if (receiverRunning) await close(receiver); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
