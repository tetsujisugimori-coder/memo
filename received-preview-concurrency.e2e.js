"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { randomBytes, randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const { createPreviewService } = require("./dummy-preview-service.js");
const { textRequest } = require("./dummy-preview-queue.js");
const before = process.argv.includes("--before");
const channel = process.env.MEMO_NEXUS_E2E_CHANNEL || "chromium";
const artifacts = path.join(__dirname, "e2e-artifacts/received-preview");
const listen = (server, port) => new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
const close = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
async function ready(page) {
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
  await page.waitForFunction(() => typeof webClipReceiverReady !== "undefined" && webClipReceiverReady);
  await page.evaluate(async () => { await flushScheduledNoteSave(currentId); await Promise.all(notes.map((note) => noteSaveFoundation.whenIdle(note.id))); });
}
async function open(page, token) {
  await page.keyboard.press("Escape");
  if (await page.locator("#mobileWritingDoneBtn").isVisible()) await page.locator("#mobileWritingDoneBtn").click();
  await page.locator("#dummyPreviewOpenBtn").evaluate((el) => { el.closest("details").open = true; });
  await page.locator("#dummyPreviewOpenBtn").focus(); await page.keyboard.press("Enter");
  await page.locator("#dummyPreviewToken").fill(token);
  await page.locator("#dummyPreviewCheckBtn").click();
  await idle(page);
}
const idle = (page) => page.waitForFunction(() => !document.getElementById("dummyPreviewCheckBtn").disabled);
async function gate(page, mode = "write") {
  await page.evaluate((mode) => {
    window.gateReached = false;
    window.gatedPut = putNote;
    window.writeGate = new Promise((resolve) => { window.releaseWrite = resolve; });
    putNote = async (...args) => {
      window.gateReached = true;
      await window.writeGate;
      if (mode === "fail") throw new DOMException("検証用未コミット失敗", "QuotaExceededError");
      const result = await window.gatedPut(...args);
      if (mode === "commit-then-fail") throw new Error("検証用コミット後失敗");
      return result;
    };
  }, mode);
}
async function pending(page, requestId) {
  await page.waitForFunction(async (requestId) => (await navigator.locks.query()).pending.some((lock) => lock.name === `memo-received-request:${requestId}`), requestId);
}
async function stored(page, id) { return page.evaluate(async (id) => (await getStoredNoteSnapshots([id])).get(id) || null, id); }
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const browserToken = randomBytes(32).toString("base64url"), adapterToken = randomBytes(32).toString("base64url");
  const { server: receiver, queue } = createPreviewService({ browserToken, adapterToken });
  const routes = [];
  receiver.on("request", (req) => { if (req.method === "POST") routes.push(req.url); });
  const staticServer = http.createServer(async (req, res) => {
    const file = path.resolve(__dirname, new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html");
    if (!file.startsWith(__dirname + path.sep)) return res.writeHead(403).end();
    try { const data = await fs.readFile(file); res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "application/javascript" }); res.end(data); }
    catch { res.writeHead(404).end(); }
  });
  let browser, receiverRunning = false, staticRunning = false;
  const results = [];
  try {
    await listen(receiver, 8791); receiverRunning = true; await listen(staticServer, 5500); staticRunning = true;
    browser = await chromium.launch({ headless: true, ...(channel === "chromium" ? {} : { channel }) });
    async function tabs(value, different = false) {
      queue.submit(textRequest(value));
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const a = await context.newPage(); await a.goto("http://127.0.0.1:5500/"); await ready(a);
      await a.evaluate(async () => {
        const transaction = db.transaction("collections", "readwrite");
        for (const id of ["A", "B"]) transaction.objectStore("collections").put({ id: `test-${id}`, name: `保存先${id}`, parentId: null, sortOrder: 20, isSystem: false });
        await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
      });
      await a.reload(); await ready(a);
      const b = await context.newPage(); await b.goto("http://127.0.0.1:5500/"); await ready(b);
      await a.evaluate(() => { selectedCollectionId = "test-A"; });
      await b.evaluate((different) => { selectedCollectionId = different ? "test-B" : "test-A"; }, different);
      await open(a, browserToken); await open(b, browserToken);
      return { context, a, b };
    }
    const value = (title) => ({ requestId: randomUUID(), title, body: "日本語\r\n\r\n- 原文保持  \r\n<script>window.competitionExecuted=true</script>" });

    const destination = value("保存先不一致");
    {
      const { context, a, b } = await tabs(destination, true);
      assert.match(await b.locator("#dummyPreviewDestination").textContent(), /保存先B/);
      await b.evaluate(() => { window.saveCalls = 0; window.realPreviewSave = window.MemoNexusReceivedPreview.save; window.MemoNexusReceivedPreview.save = async (...args) => { window.saveCalls++; return window.realPreviewSave(...args); }; });
      const originalCount = (await a.evaluate(() => getStoredNotes())).length;
      await gate(a); await a.locator("#dummyPreviewSaveBtn").click(); await a.waitForFunction(() => window.gateReached);
      const plan = queue.status(destination.requestId).savePlan;
      await b.locator("#dummyPreviewSaveBtn").click();
      if (before) await b.waitForFunction(() => window.saveCalls === 1); else await pending(b, destination.requestId);
      await a.evaluate(() => window.releaseWrite()); await Promise.all([idle(a), idle(b)]);
      if (before) {
        assert.equal(await b.evaluate(() => window.saveCalls), 1);
        assert.match(await b.locator("#dummyPreviewStatus").textContent(), /保存しました/);
        results.push("BEFORE problem 1 reproduced: B displayed collection B but saved/confirmed collection A on its first click");
      } else {
        assert.equal(await b.evaluate(() => window.saveCalls), 0);
        assert.match(await b.locator("#dummyPreviewStatus").textContent(), /別タブ.*保存先.*もう一度/);
        assert.match(await b.locator("#dummyPreviewDestination").textContent(), /保存先A/);
        await b.locator("#dummyPreviewSaveBtn").click(); await idle(b);
        assert.equal(await b.evaluate(() => window.saveCalls), 1);
        results.push("AFTER problem 1: mismatched destination stops before DB access; new explicit click confirms fixed A without another memo");
      }
      const all = await a.evaluate(() => getStoredNotes());
      assert.equal(all.length, originalCount + 1);
      assert.equal(all.filter((note) => note.id === plan.noteId).length, 1);
      assert.equal((await stored(a, plan.noteId)).body, destination.body);
      assert.equal((await stored(a, plan.noteId)).collectionId, "test-A");
      await context.close();
    }

    const competing = value("保存と失敗破棄の競合");
    {
      const { context, a, b } = await tabs(competing);
      const originalCount = (await a.evaluate(() => getStoredNotes())).length;
      await gate(a); await a.locator("#dummyPreviewSaveBtn").click(); await a.waitForFunction(() => window.gateReached);
      const plan = queue.status(competing.requestId).savePlan;
      await b.evaluate(() => { window.realDb = db; db = null; });
      await b.locator("#dummyPreviewSaveBtn").click();
      if (before) {
        await idle(b); assert.equal(queue.status(competing.requestId).state, "save_failed");
        await b.locator("#dummyPreviewRejectBtn").click(); await idle(b);
        assert.equal(queue.status(competing.requestId).state, "rejected");
        assert.match(await b.locator("#dummyPreviewStatus").textContent(), /破棄しました/);
      } else {
        await pending(b, competing.requestId);
        const rejects = routes.filter((route) => route === "/reject").length;
        await b.locator("#dummyPreviewRejectBtn").click({ force: true });
        assert.equal(routes.filter((route) => route === "/reject").length, rejects);
        assert.equal(queue.status(competing.requestId).state, "saving");
        assert.equal(await stored(a, plan.noteId), null);
      }
      await a.evaluate(() => window.releaseWrite()); await Promise.all([idle(a), idle(b)]);
      await b.evaluate(() => { db = window.realDb; });
      assert.equal((await stored(a, plan.noteId)).body, competing.body);
      assert.equal((await a.evaluate(() => getStoredNotes())).length, originalCount + 1);
      assert.equal(queue.status(competing.requestId).state, before ? "rejected" : "saved");
      results.push(before ? "BEFORE problem 2 reproduced: B discarded while A was pending; A committed but queue remained rejected and complete failed" : "AFTER problem 2: B failure/discard waits for A's complete; one committed memo and saved queue, no discard success during save");
      await context.close();
    }
    if (!before) {
      for (const mode of ["fail", "commit-then-fail"]) {
        const failed = value(`失敗と破棄-${mode}`);
        const { context, a, b } = await tabs(failed);
        await gate(a, mode); await a.locator("#dummyPreviewSaveBtn").click(); await a.waitForFunction(() => window.gateReached);
        const plan = queue.status(failed.requestId).savePlan;
        await b.locator("#dummyPreviewRejectBtn").click(); await pending(b, failed.requestId);
        assert.equal(queue.status(failed.requestId).state, "saving");
        await a.evaluate(() => window.releaseWrite()); await Promise.all([idle(a), idle(b)]);
        assert.equal(queue.status(failed.requestId).state, "rejected");
        assert.equal(Boolean(await stored(a, plan.noteId)), mode === "commit-then-fail");
        assert.match(await b.locator("#dummyPreviewStatus").textContent(), /作成済みメモ.*取り消しません/);
        const count = await a.evaluate(() => getStoredNotes());
        await b.reload(); await ready(b);
        assert.equal((await b.evaluate(() => getStoredNotes())).length, count.length);
        assert.equal(queue.submit(textRequest(failed)).state, "rejected");
        results.push(`${mode}: discard runs after save ends; ${mode === "fail" ? "no late creation" : "committed memo retained"}; rejected receipt never resurrects`);
        await context.close();
      }
      for (const lifecycle of ["close", "reload"]) {
        const recovery = value(`保存途中の${lifecycle}`);
        const { context, a, b } = await tabs(recovery);
        await gate(a); await a.locator("#dummyPreviewSaveBtn").click(); await a.waitForFunction(() => window.gateReached);
        const firstAttempt = queue.status(recovery.requestId);
        if (lifecycle === "close") await a.close(); else { await a.reload(); await ready(a); }
        await b.locator("#dummyPreviewSaveBtn").click(); await idle(b);
        const recovered = queue.status(recovery.requestId);
        assert.equal(recovered.state, "saved");
        assert.deepEqual(recovered.savePlan, firstAttempt.savePlan);
        assert.notEqual(recovered.attemptId, firstAttempt.attemptId);
        const all = await b.evaluate(() => getStoredNotes());
        assert.equal(all.filter((note) => note.id === recovered.savePlan.noteId).length, 1);
        assert.equal((await stored(b, recovered.savePlan.noteId)).body, recovery.body);
        assert.throws(() => queue.failed(recovery.requestId, firstAttempt.attemptId), /stale_save_attempt/);
        results.push(`${lifecycle} during gated save: lock released and same memo ID/destination recovered; old attempt cannot change state`);
        await context.close();
      }
      // Close the actual browser process, then reopen the same isolated storage directory.
      const restart = value("ブラウザ終了後の回復"); queue.submit(textRequest(restart));
      const profile = await fs.mkdtemp(path.join(artifacts, "concurrency-profile-"));
      const options = { headless: true, viewport: { width: 390, height: 844 }, ...(channel === "chromium" ? {} : { channel }) };
      let persistent = await chromium.launchPersistentContext(profile, options);
      try {
        const page = persistent.pages()[0]; await page.goto("http://127.0.0.1:5500/"); await ready(page); await open(page, browserToken);
        const originalCount = (await page.evaluate(() => getStoredNotes())).length;
        await gate(page); await page.locator("#dummyPreviewSaveBtn").click(); await page.waitForFunction(() => window.gateReached);
        const firstAttempt = queue.status(restart.requestId);
        await persistent.close(); persistent = await chromium.launchPersistentContext(profile, options);
        const recoveredPage = persistent.pages()[0]; await recoveredPage.goto("http://127.0.0.1:5500/"); await ready(recoveredPage); await open(recoveredPage, browserToken);
        assert.equal(queue.status(restart.requestId).state, "saving");
        await recoveredPage.locator("#dummyPreviewSaveBtn").click(); await idle(recoveredPage);
        const recovered = queue.status(restart.requestId);
        assert.equal(recovered.state, "saved"); assert.deepEqual(recovered.savePlan, firstAttempt.savePlan);
        assert.equal((await stored(recoveredPage, recovered.savePlan.noteId)).body, restart.body);
        assert.equal((await recoveredPage.evaluate(() => getStoredNotes())).length, originalCount + 1);
        results.push("actual browser process close/reopen with same isolated profile: original memo ID/destination recovered exactly once");
      } finally { await persistent.close(); }
    }
    await fs.writeFile(path.join(artifacts, `${channel}-concurrency-${before ? "before" : "after"}.json`), JSON.stringify({ before, channel, results, timing: "promise gates and Web Locks query; no fixed sleeps", tunnel: "not exercised" }, null, 2));
    console.log(results.join("\n"));
  } finally { await browser?.close(); if (receiverRunning) await close(receiver); if (staticRunning) await close(staticServer); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
