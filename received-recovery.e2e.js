"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { randomBytes, randomUUID } = require("node:crypto");
const { fork } = require("node:child_process");
const { chromium } = require("playwright");
const { attachTransport } = require("./received-e2e-transport.js");
let receiverPort;
const artifacts = path.join(__dirname, "e2e-artifacts/received-preview");
const channel = process.env.MEMO_NEXUS_E2E_CHANNEL || "chromium";
const results = [];
function messages(child) {
  const backlog = [], waits = [];
  child.on("exit", () => { for (const entry of waits.splice(0)) { clearTimeout(entry.timer); entry.reject(new Error("Service exited before checkpoint")); } });
  child.on("message", (value) => {
    const waiter = waits.find((entry) => entry.type === value.type);
    if (waiter) { waits.splice(waits.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(value); }
    else backlog.push(value);
  });
  return (type) => {
    const index = backlog.findIndex((value) => value.type === type);
    if (index >= 0) return Promise.resolve(backlog.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const entry = { type, resolve, reject, timer: setTimeout(() => reject(new Error(`IPC timeout: ${type}`)), 15000) }; waits.push(entry);
    });
  };
}
async function start(directory, tokens) {
  const child = fork(path.join(__dirname, "received-recovery-service.fixture.js"), [], { windowsHide: true,
    env: { ...process.env, MEMO_PREVIEW_HISTORY_DIR: directory, MEMO_PREVIEW_BROWSER_TOKEN: tokens.browser, MEMO_PREVIEW_ADAPTER_TOKEN: tokens.adapter }, silent: true });
  const wait = messages(child); let output = "";
  child.stderr.on("data", (data) => { output += data.toString(); });
  const ready = await Promise.race([wait("ready"), new Promise((_, reject) => child.once("exit", (code) => reject(new Error(`Service exit ${code}: ${output}`))))]);
  receiverPort = ready.port;
  return { child, wait, arm: async (route) => { child.send({ type: "gate", path: route }); await wait("armed"); } };
}
async function kill(service) {
  if (!service || service.child.exitCode !== null) return;
  const done = new Promise((resolve) => service.child.once("exit", resolve));
  service.child.kill("SIGKILL"); await done;
}
async function api(tokens, route, value, adapter = false) {
  const res = await fetch(`http://127.0.0.1:${receiverPort}${route}`, { method: "POST", headers: { Authorization: `Bearer ${adapter ? tokens.adapter : tokens.browser}`,
    "Content-Type": "application/json", ...(!adapter ? { Origin: "http://127.0.0.1:5500" } : {}) }, body: JSON.stringify(value) });
  return { code: res.status, ...(await res.json()) };
}
const settled = async (page) => {
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
  await page.waitForFunction(() => typeof webClipReceiverReady !== "undefined" && webClipReceiverReady);
  await page.evaluate(async () => { await flushScheduledNoteSave(currentId); await Promise.all(notes.map((note) => noteSaveFoundation.whenIdle(note.id))); });
};
const idle = (page) => page.waitForFunction(() => !document.getElementById("dummyPreviewCheckBtn").disabled);
async function open(page, token, requestId) {
  await page.keyboard.press("Escape");
  await page.locator("#dummyPreviewOpenBtn").evaluate((el) => { el.closest("details").open = true; });
  await page.locator("#dummyPreviewOpenBtn").focus(); await page.keyboard.press("Enter");
  await page.locator("#dummyPreviewToken").fill(token);
  await page.locator("#receivedRequestLookup").fill(requestId);
  await page.locator("#dummyPreviewCheckBtn").click(); await idle(page);
}
async function select(page, itemId) {
  const row = page.locator(`[data-item-id="${itemId}"]`);
  await row.evaluate((el) => { const details = el.closest("details"); if (details) details.open = true; }); await row.click();
}
async function save(page) { await page.locator("#dummyPreviewSaveBtn").click(); await idle(page); }
async function stored(page, id) {
  return page.evaluate(async (id) => (await getStoredNoteSnapshots([id])).get(id) || null, id);
}
async function counts(page) { return page.evaluate(() => notes.length); }
async function gateDB(page, afterCommit = false) {
  await page.evaluate((afterCommit) => {
    window.recoveryCheckpoint = false; window.recoveryGate = new Promise((resolve) => { window.releaseRecovery = resolve; });
    if (afterCommit) {
      window.realRecoveryPut = putNote;
      putNote = async (...args) => {
        const value = await window.realRecoveryPut(...args);
        if (args[1]?.receivedReceipt) { window.recoveryCheckpoint = true; await window.recoveryGate; }
        return value;
      };
    } else {
      window.realRecoveryCreate = createNote;
      createNote = async (...args) => {
        if (args[2]?.receivedReceipt) { window.recoveryCheckpoint = true; await window.recoveryGate; }
        return window.realRecoveryCreate(...args);
      };
    }
  }, afterCommit);
}
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-recovery-e2e-"));
  const staticServer = http.createServer(async (req, res) => {
    const file = path.resolve(__dirname, new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html");
    if (!file.startsWith(__dirname + path.sep)) return res.writeHead(403).end();
    try { res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "application/javascript" }); res.end(await fs.readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  let browser, service, context, page, listening = false;
  const tokens = { browser: randomBytes(32).toString("base64url"), adapter: randomBytes(32).toString("base64url") };
  try {
    await new Promise((resolve, reject) => { staticServer.once("error", reject); staticServer.listen(0, "127.0.0.1", resolve); }); listening = true;
    browser = await chromium.launch({ headless: true, ...(channel === "chromium" ? {} : { channel }) });
    for (const scenario of ["A-received", "B-preview", "C-before-db", "D-after-db", "E-complete-before-response", "F-failed", "G-partial", "H-rejected", "H-expired", "I-conflict", "missing-proof", "deleted", "mismatch", "destination-missing", "two-tabs", "two-tabs-pending", "destination-race"]) {
      const directory = path.join(root, scenario);
      service = await start(directory, tokens);
      context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });
      await attachTransport(context, staticServer.address().port, () => receiverPort);
      page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("http://127.0.0.1:5500/"); await settled(page);
      if (scenario === "destination-race") await page.evaluate(async () => {
        const c = { id: "race-collection", name: "保存先競合試験", parentId: null, sortOrder: 10, isSystem: false };
        const tx = db.transaction("collections", "readwrite"); tx.objectStore("collections").put(c);
        await new Promise((resolve) => { tx.oncomplete = resolve; }); collections.push(c); selectedCollectionId = c.id;
      });
      const baseline = await counts(page);
      const request = { requestId: randomUUID(), title: " 再起動試験 ", body: "# 再起動\n日本語\n<script>window.recoveryUnsafe=true</script>\n" };
      const multiple = scenario === "G-partial";
      const payload = multiple ? { requestId: request.requestId, notes: [{ title: request.title, body: request.body }, { title: "残り", body: "未保存" }, { title: "破棄", body: "破棄" }] } : request;
      const route = multiple ? "/notes" : "/text";
      const first = await api(tokens, route, payload, true); assert.equal(first.code, 200);
      assert.equal(JSON.stringify(first).includes("savePlan"), false); assert.equal(await counts(page), baseline);
      if (scenario !== "A-received") await open(page, tokens.browser, request.requestId);
      let detail = (await api(tokens, "/status", { requestId: request.requestId })).request;
      const control = { requestId: request.requestId, ...(multiple ? { itemId: detail.notes[0].itemId } : {}) };
      let plan;
      if (["C-before-db", "D-after-db", "two-tabs-pending", "destination-race"].includes(scenario)) {
        await gateDB(page, scenario === "D-after-db"); await page.locator("#dummyPreviewSaveBtn").click();
        await page.waitForFunction(() => window.recoveryCheckpoint);
        plan = (await api(tokens, "/status", control)).request.savePlan;
        assert.equal(Boolean(await stored(page, plan.noteId)), scenario === "D-after-db");
      } else if (scenario === "E-complete-before-response") {
        await service.arm("/complete"); await page.locator("#dummyPreviewSaveBtn").click(); await service.wait("checkpoint");
        detail = (await api(tokens, "/status", control)).request; assert.equal(detail.state, "saved"); plan = detail.savePlan;
      } else if (scenario === "F-failed") {
        await page.evaluate(() => { window.realRecoveryPut = putNote; putNote = async () => { throw new DOMException("test quota", "QuotaExceededError"); }; });
        await save(page); detail = (await api(tokens, "/status", control)).request; assert.equal(detail.state, "save_failed"); plan = detail.savePlan;
      } else if (["G-partial", "deleted", "mismatch", "destination-missing", "two-tabs", "two-tabs-pending", "destination-race"].includes(scenario)) {
        if (scenario === "destination-missing") await page.evaluate(async () => {
          const c = { id: "recovery-collection", name: "復旧試験", parentId: null, sortOrder: 10, isSystem: false };
          const tx = db.transaction("collections", "readwrite"); tx.objectStore("collections").put(c); await new Promise((resolve) => { tx.oncomplete = resolve; }); collections.push(c); selectedCollectionId = c.id;
        });
        if (scenario === "destination-missing") { await page.locator("#dummyPreviewCloseBtn").click(); await open(page, tokens.browser, request.requestId); }
        await save(page); detail = (await api(tokens, "/status", control)).request; assert.equal(detail.state, "saved"); plan = detail.savePlan;
        if (multiple) { const id = (await api(tokens, "/status", { requestId: request.requestId })).request.notes[2].itemId; await select(page, id); await page.locator("#dummyPreviewRejectBtn").click(); await idle(page); }
      } else if (scenario === "H-rejected") {
        await page.locator("#dummyPreviewRejectBtn").click(); await idle(page);
      } else if (scenario === "H-expired") {
        // Modify the isolated checksummed journal only after stopping, below.
      } else if (scenario === "missing-proof") {
        detail = (await api(tokens, "/begin", { ...control, collectionId: "system-unclassified", previousAttemptId: null })).request; plan = detail.savePlan;
      }
      await kill(service); service = null;
      if (["C-before-db", "D-after-db", "two-tabs-pending", "destination-race"].includes(scenario)) { await page.reload(); await settled(page); }
      if (scenario === "E-complete-before-response") await idle(page);
      if (scenario === "H-expired") {
        const file = path.join(directory, "history.json"), envelope = JSON.parse(await fs.readFile(file, "utf8"));
        envelope.records[0].receivedAt -= 660000; envelope.records[0].expiresAt -= 660000;
        envelope.checksum = require("node:crypto").createHash("sha256").update(JSON.stringify(envelope.records)).digest("hex"); await fs.writeFile(file, JSON.stringify(envelope));
      }
      service = await start(directory, tokens);
      await open(page, tokens.browser, request.requestId);
      assert.match(await page.locator("#dummyPreviewBadge").textContent(), /再送待ち/);
      assert.equal(await page.locator("#dummyPreviewSaveBtn").isDisabled(), true);
      const replay = await api(tokens, route, payload, true); assert.equal(replay.code, 200);
      assert.equal(JSON.stringify(replay).includes("collectionId"), false); assert.equal(JSON.stringify(replay).includes("noteId"), false);
      assert.equal((await api(tokens, route, multiple ? { ...payload, notes: [{ ...payload.notes[0], body: "changed" }, ...payload.notes.slice(1)] } : { ...payload, body: "changed" }, true)).code, 409);
      await page.locator("#dummyPreviewCheckBtn").click(); await idle(page);
      if (multiple) {
        const restored = (await api(tokens, "/status", { requestId: request.requestId })).request;
        assert.deepEqual(restored.notes.map((note) => note.itemId), first.request.notes.map((note) => note.itemId));
        assert.deepEqual(restored.notes.map((note) => note.state), ["saved", "queued", "rejected"]);
        await select(page, restored.notes[0].itemId); await save(page); assert.equal(await counts(page), baseline + 1);
        await select(page, restored.notes[1].itemId); await save(page); assert.equal(await counts(page), baseline + 2);
      } else if (["H-rejected", "H-expired"].includes(scenario)) {
        assert.equal(replay.request.state, scenario === "H-rejected" ? "rejected" : "expired"); assert.equal(await page.locator("#dummyPreviewSaveBtn").isDisabled(), true); assert.equal(await counts(page), baseline);
      } else {
        if (scenario === "F-failed") await page.evaluate(() => { putNote = window.realRecoveryPut; });
        if (["deleted", "mismatch", "destination-missing"].includes(scenario)) {
          await page.evaluate(async ({ id, scenario, collectionId }) => {
            const tx = db.transaction(["notes", "collections"], "readwrite");
            if (scenario === "destination-missing") tx.objectStore("collections").delete(collectionId);
            else {
              const get = tx.objectStore("notes").get(id); get.onsuccess = () => { const value = get.result; if (scenario === "deleted") value.deletedAt = Date.now(); else value.title = "変更済み"; tx.objectStore("notes").put(value); };
            }
            await new Promise((resolve) => { tx.oncomplete = resolve; });
            if (scenario === "destination-missing") collections = collections.filter((c) => c.id !== collectionId);
          }, { id: plan.noteId, scenario, collectionId: plan.collectionId });
        }
        const before = plan ? await stored(page, plan.noteId) : null;
        if (scenario === "destination-race") {
          await gateDB(page); await page.locator("#dummyPreviewSaveBtn").click(); await page.waitForFunction(() => window.recoveryCheckpoint);
          await page.evaluate(async () => {
            const tx = db.transaction("collections", "readwrite"); tx.objectStore("collections").delete("race-collection");
            await new Promise((resolve) => { tx.oncomplete = resolve; });
          });
          await page.evaluate(() => window.releaseRecovery()); await idle(page);
        }
        if (["two-tabs", "two-tabs-pending"].includes(scenario)) {
          const other = await context.newPage(); await other.goto("http://127.0.0.1:5500/"); await settled(other); await open(other, tokens.browser, request.requestId);
          await Promise.all([save(page), save(other)]); assert.equal(await counts(page), baseline + 1); await other.close();
        } else if (scenario !== "destination-race") await save(page);
        detail = (await api(tokens, "/status", control)).request;
        if (["missing-proof", "deleted", "mismatch", "destination-missing", "destination-race"].includes(scenario)) {
          assert.match(await page.locator("#dummyPreviewBadge").textContent(), /復旧不能/); assert.deepEqual(await stored(page, plan.noteId), before);
          if (scenario === "missing-proof") assert.notEqual(detail.state, "saved");
        } else {
          assert.equal(detail.state, "saved"); if (plan) assert.deepEqual(detail.savePlan, plan);
          assert.equal(await counts(page), baseline + 1); const note = await stored(page, detail.savePlan.noteId); assert.equal(note.body, request.body);
          if (before) assert.deepEqual(note, before);
        }
      }
      assert.equal(await page.evaluate(() => window.recoveryUnsafe), undefined); assert.deepEqual(errors, []);
      const history = await fs.readFile(path.join(directory, "history.json"), "utf8");
      for (const secret of [request.title, request.body, tokens.browser, tokens.adapter]) assert.equal(history.includes(secret), false);
      results.push({ scenario, result: "passed" }); console.log(`PASS ${scenario}`);
      await context.close(); context = null; await kill(service); service = null;
    }
    const failedDirectory = path.join(root, "write-failure"); service = await start(failedDirectory, tokens);
    const failedRequest = { requestId: randomUUID(), title: "書き込み失敗", body: "記録を破壊しない" };
    assert.equal((await api(tokens, "/text", failedRequest, true)).code, 200);
    const file = path.join(failedDirectory, "history.json"), intact = await fs.readFile(file, "utf8");
    await fs.mkdir(path.join(failedDirectory, "history.next"));
    const failure = await api(tokens, "/begin", { requestId: failedRequest.requestId, collectionId: "system-unclassified", previousAttemptId: null });
    assert.equal(failure.code, 503); assert.equal(failure.error, "history_write_failed");
    assert.equal(await fs.readFile(file, "utf8"), intact);
    assert.equal((await api(tokens, "/status", { requestId: failedRequest.requestId })).error, "history_unavailable");
    await kill(service); service = null; results.push({ scenario: "real-service-write-failure", result: "passed" });
    const brokenDirectory = path.join(root, "startup-corrupt"); await fs.mkdir(brokenDirectory); await fs.writeFile(path.join(brokenDirectory, "history.json"), "{broken");
    const broken = fork(path.join(__dirname, "received-recovery-service.fixture.js"), [], { windowsHide: true, silent: true,
      env: { ...process.env, MEMO_PREVIEW_HISTORY_DIR: brokenDirectory, MEMO_PREVIEW_BROWSER_TOKEN: tokens.browser, MEMO_PREVIEW_ADAPTER_TOKEN: tokens.adapter } });
    const brokenWait = messages(broken); assert.equal((await brokenWait("failed")).code, "history_corrupt");
    await new Promise((resolve) => broken.once("exit", resolve));
    results.push({ scenario: "real-service-startup-corrupt", result: "passed" });
    await fs.writeFile(path.join(artifacts, `recovery-${channel}.json`), JSON.stringify({ platform: process.platform, browser: channel, results }, null, 2));
  } catch (error) {
    await fs.writeFile(path.join(artifacts, `recovery-${channel}-failure.json`), JSON.stringify({ results, failure: error.stack }, null, 2));
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, `recovery-${channel}-failure.png`) }).catch(() => {});
    throw error;
  } finally {
    if (context) await context.close(); await kill(service); if (browser) await browser.close();
    if (listening) await new Promise((resolve) => { staticServer.closeAllConnections(); staticServer.close(resolve); });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
