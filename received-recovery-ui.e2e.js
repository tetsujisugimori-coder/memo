"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const { attachTransport } = require("./received-e2e-transport.js");
const { createQueue, notesRequest } = require("./dummy-preview-queue.js");
(async () => {
  const server = http.createServer(async (req, res) => {
    const file = path.resolve(__dirname, new URL(req.url, "http://localhost").pathname.slice(1) || "index.html");
    if (!file.startsWith(__dirname + path.sep)) return res.writeHead(403).end();
    try { res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : "application/javascript" }); res.end(await fs.readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  let browser, context;
  const results = [];
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ headless: true }); context = await browser.newContext();
    await attachTransport(context, server.address().port, 1);
    let response, error, mode = "fixture";
    const queue = createQueue();
    const payload = { requestId: randomUUID(), notes: ["A", "B", "C"].map((title) => ({ title, body: `原文${title}` })) };
    const batch = queue.submit(notesRequest(payload));
    await context.route("http://127.0.0.1:8791/**", async (route) => {
      if (error === "network") return route.abort();
      if (error) return route.fulfill({ status: error === "unauthorized" ? 401 : 503, json: { error, detail: "PRIVATE C:\\secret Bearer TOKEN 原文" } });
      const url = new URL(route.request().url());
      if (mode === "fixture") return route.fulfill({ json: { request: response } });
      const args = route.request().postDataJSON(); let record;
      if (url.pathname === "/status") record = queue.status(args.requestId, args.itemId);
      else if (url.pathname === "/begin") record = queue.begin(args.requestId, args.collectionId, args.previousAttemptId, args.itemId);
      else if (url.pathname === "/complete") record = queue.complete(args.requestId, args.attemptId, args.itemId);
      else throw new Error(`Unexpected route ${url.pathname}`);
      return route.fulfill({ json: { request: record } });
    });
    const page = await context.newPage(); await page.goto("http://127.0.0.1:5500/");
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await page.waitForFunction(() => typeof webClipReceiverReady !== "undefined" && webClipReceiverReady);
    const idle = () => page.waitForFunction(() => !document.getElementById("dummyPreviewCheckBtn").disabled);
    const check = async () => { await page.locator("#dummyPreviewToken").fill("T".repeat(43)); await page.locator("#dummyPreviewCheckBtn").click(); await idle(); };
    const open = async (id) => {
      await page.locator("#dummyPreviewOpenBtn").evaluate((el) => { el.closest("details").open = true; });
      await page.locator("#dummyPreviewOpenBtn").click(); await page.locator("#receivedRequestLookup").fill(id); await check();
    };
    const now = Date.now(), requestId = randomUUID();
    const base = { formatVersion: 1, requestId, dummy: false, title: "タイトル", body: "本文", state: "queued", receivedAt: now, expiresAt: now + 600000, saved: false, savePlan: null, attemptId: null };
    response = base; await open(requestId);
    const labels = { queued: /未保存/, saving: /保存結果不明/, save_failed: /保存失敗・結果未確認/, saved: /保存完了通知済み.*未照合/, rejected: /破棄済み/, expired: /期限切れ/, queue_full: /受信拒否/ };
    for (const state of Object.keys(labels)) for (const missing of [false, true]) {
      const planned = ["saving", "save_failed", "saved"].includes(state);
      response = { ...base, state, saved: state === "saved", savePlan: planned ? { noteId: randomUUID(), collectionId: "system-unclassified" } : null, attemptId: planned ? randomUUID() : null,
        ...(missing ? { title: "", body: "", bodyAvailable: false } : {}) };
      await check(); assert.match(await page.locator("#dummyPreviewBadge").textContent(), labels[state]);
      assert.match(await page.locator("#dummyPreviewState").textContent(), missing ? /原文なし/ : /原文あり/);
      assert.equal(await page.locator("#dummyPreviewSaveBtn").isDisabled(), missing || ["rejected", "expired", "queue_full"].includes(state));
      if (["rejected", "expired", "queue_full"].includes(state)) assert.doesNotMatch(await page.locator("#dummyPreviewBody").textContent(), /再送待ち/);
    }
    results.push("14 state/body combinations and save permissions");
    for (const [code, pattern] of [["history_write_failed", /履歴の書き込み/], ["history_unavailable", /履歴を利用できない/], ["replay_required", /原文の再送/], ["history_full", /128要求の上限/], ["history_capacity", /容量上限/], ["unauthorized", /認証に失敗/], ["network", /通信を確認/], ["PRIVATE C:\\secret Bearer TOKEN 原文", /操作の結果を確認/]]) {
      error = code; await check(); const text = await page.locator("#dummyPreviewStatus").textContent();
      assert.match(text, pattern); assert.doesNotMatch(text, /PRIVATE|C:\\secret|Bearer|TOKEN|原文$/);
      if (!code.startsWith("history_")) assert.match(text, /未確認/);
    }
    error = null; results.push("allowlisted errors, auth/network distinction, unknown details hidden");
    response = base; await check();
    // Exercise the same diagnosis during save; no DB write can occur while status fails.
    const baseline = await page.evaluate(() => notes.length);
    for (const code of ["history_write_failed", "history_unavailable", "replay_required", "history_full", "history_capacity", "unauthorized", "network", "PRIVATE path TOKEN"]) {
      response = base; await check(); error = code;
      await page.locator("#dummyPreviewSaveBtn").click(); await idle();
      const text = await page.locator("#dummyPreviewStatus").textContent();
      assert.match(text, /保存完了を確認できません/); assert.doesNotMatch(text, /PRIVATE|TOKEN/);
      assert.equal(await page.evaluate(() => notes.length), baseline); error = null;
    }
    results.push("save diagnostics preserve uncertainty and create zero notes");
    mode = "queue"; await page.locator("#receivedRequestLookup").fill(payload.requestId); await check();
    const select = async (id) => { const el = page.locator(`[data-item-id="${id}"]`); await el.evaluate((el) => { const details = el.closest("details"); if (details) details.open = true; }); await el.click(); };
    for (const item of batch.notes) { await select(item.itemId); await page.locator("#dummyPreviewSaveBtn").click(); await idle(); }
    for (const item of batch.notes) {
      await select(item.itemId); assert.match(await page.locator("#dummyPreviewBadge").textContent(), /照合済み/);
      assert.equal(await page.locator("#dummyPreviewSaveBtn").isDisabled(), true);
    }
    assert.equal(await page.evaluate(() => notes.length), baseline + 3);
    assert.equal(await page.locator("#receivedNotesProcessed button").filter({ hasText: "照合済み" }).count(), 3);
    results.push("A-B-C saves, B-A selection and list retain all verified tuples with three real DB commits");
    mode = "fixture"; const saved = queue.status(payload.requestId, batch.notes[0].itemId);
    for (const changed of [{ attemptId: randomUUID() }, { requestId: randomUUID() }, { recoveryRequired: true }]) {
      response = { ...saved, ...changed }; await check();
      assert.match(await page.locator("#dummyPreviewBadge").textContent(), /未照合/);
      assert.equal(await page.locator("#dummyPreviewSaveBtn").isDisabled(), false);
    }
    mode = "queue"; await check(); await select(batch.notes[0].itemId);
    await page.evaluate(() => {
      window.realDiagnosticSave = window.MemoNexusReceivedPreview.save;
      window.MemoNexusReceivedPreview.save = async () => { throw Object.assign(new Error("PRIVATE C:\\secret Bearer TOKEN 原文"), { userMessage: true, code: "recovery_blocked" }); };
    });
    await page.locator("#dummyPreviewSaveBtn").click(); await idle();
    assert.doesNotMatch(await page.locator("#dummyPreviewStatus").textContent(), /PRIVATE|secret|Bearer|TOKEN/);
    assert.equal(await page.evaluate(() => notes.length), baseline + 3);
    await page.evaluate(() => { window.MemoNexusReceivedPreview.save = window.realDiagnosticSave; });
    await page.locator("#dummyPreviewSaveBtn").click(); await idle();
    assert.equal(await page.evaluate(() => notes.length), baseline + 3);
    await page.locator("#dummyPreviewCloseBtn").click(); await open(payload.requestId); await select(batch.notes[0].itemId);
    assert.match(await page.locator("#dummyPreviewBadge").textContent(), /未照合/);
    await page.locator("#dummyPreviewSaveBtn").click(); await idle(); assert.equal(await page.evaluate(() => notes.length), baseline + 3);
    await page.reload(); await page.locator("#appStartupGuard").waitFor({ state: "hidden" }); await open(payload.requestId); await select(batch.notes[0].itemId);
    assert.match(await page.locator("#dummyPreviewBadge").textContent(), /未照合/);
    results.push("attempt/request/restart changes invalidate proof; close and page navigation clear session; reverify creates zero notes");
    await fs.mkdir(path.join(__dirname, "e2e-artifacts/received-preview"), { recursive: true });
    await fs.writeFile(path.join(__dirname, "e2e-artifacts/received-preview/recovery-ui.json"), JSON.stringify({ platform: process.platform, results }, null, 2));
    for (const result of results) console.log(`PASS ${result}`);
  } finally {
    if (context) await context.close(); if (browser) await browser.close();
    await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
