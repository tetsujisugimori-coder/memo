"use strict";
// Isolated browser + actual IndexedDB + fictional RS256 issuer. No ChatGPT/Auth0 tenant connection.
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"), http = require("node:http");
const { randomBytes } = require("node:crypto"), { chromium, webkit } = require("playwright");
const { createPreviewService } = require("./dummy-preview-service.js"), { createAuthenticatedServer } = require("./mcp-http-server.js");
const { config, issuerFixture, listen, close, wire } = require("./mcp-http-oauth.fixture.js"), { attachTransport, fetchReceiver } = require("./received-e2e-transport.js");
const { classifyException } = require("./experiments/mcp-search-worker-feasibility/poll-outcomes.cjs");
const { metadata, hash } = require("./experiments/mcp-search-worker-feasibility/stage5-evidence.cjs");
const { bounded } = require("./experiments/mcp-search-worker-feasibility/context-harness.cjs");
async function settled(page) {
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
  await page.waitForFunction(() => typeof webClipReceiverReady !== "undefined" && webClipReceiverReady);
  // Settle the startup editor DOM through the normal save entry before measuring search immutability.
  await page.evaluate(async () => { await saveCurrentNote(); await Promise.all(notes.map(note => noteSaveFoundation.whenIdle(note.id))); });
}
async function snapshot(page) {
  return page.evaluate(async () => {
    async function encode(value) {
      if (value instanceof Blob) return { type: value.type, bytes: [...new Uint8Array(await value.arrayBuffer())] };
      if (value instanceof ArrayBuffer) return [...new Uint8Array(value)];
      if (ArrayBuffer.isView(value)) return [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)];
      if (Array.isArray(value)) return Promise.all(value.map(encode));
      if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.keys(value).sort().map(async key => [key, await encode(value[key])])));
      return value;
    }
    const result = {};
    for (const name of [...db.objectStoreNames].sort()) {
      result[name] = await new Promise((resolve, reject) => {
        const transaction = db.transaction(name, "readonly"), store = transaction.objectStore(name), keys = store.getAllKeys(), values = store.getAll();
        transaction.oncomplete = async () => resolve(await encode(keys.result.map((key, i) => [key, values.result[i]])));
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
    }
    return result;
  });
}
(async () => {
  const browserToken = randomBytes(32).toString("base64url"), adapterToken = randomBytes(32).toString("base64url");
  let clock = Date.now(), browser, receiver, oauth, staticServer, releaseOldPoll;
  const errors = [], results = [], artifacts = path.join(__dirname, "e2e-artifacts/memo-search");
  const timeline = [], tracked = new Map(); let sequence = 0, phase = "setup";
  const record = (event, detail = {}) => timeline.push({ ms: performance.now(), phase, event, ...detail });
  await fs.mkdir(artifacts, { recursive: true });
  try {
    receiver = createPreviewService({ browserToken, adapterToken, now: () => clock }).server; const receiverPort = await listen(receiver);
    staticServer = http.createServer(async (req, res) => {
      const file = path.resolve(__dirname, new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "index.html");
      if (!file.startsWith(__dirname + path.sep)) return res.writeHead(403).end();
      try { res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "application/javascript" }); res.end(await fs.readFile(file)); }
      catch { res.end(); }
    });
    const staticPort = await listen(staticServer), issuer = await issuerFixture();
    oauth = await createAuthenticatedServer({ ...config, scopes_supported: ["memo:submit", "memo:search"] }, { adapterToken, receiverPort, fetchImpl: issuer.fetchImpl });
    const oauthPort = await listen(oauth), token = await issuer.sign({ scope: "memo:search" });
    const call = async (name, args = {}) => {
      const response = await wire(oauthPort, token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      assert.equal(response.status, 200); assert.ok(response.json.result); return JSON.parse(response.json.result.content[0].text);
    };
    const run = (sessionId, query, scope = { type: "all" }, rest = {}) => call("search_saved_memos", { sessionId, conditions: { query, scope, limit: 2, ...rest } });
    const engine = process.env.MEMO_SEARCH_BROWSER === "webkit" ? webkit : chromium;
    console.log("Search fixture ready; launching isolated", engine.name());
    browser = await engine.launch({ headless: true, timeout: 30000 });
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, timezoneId: "Asia/Tokyo" });
    await attachTransport(context, staticPort, receiverPort);
    const page = await context.newPage();
    context.on("request", request => {
      const endpoint = new URL(request.url()).pathname;
      if (!["/search/poll", "/search/revoke"].includes(endpoint)) return;
      const id = ++sequence; tracked.set(request, id); record("request", { id, endpoint, method: request.method(), resourceType: request.resourceType() });
    });
    context.on("response", response => { if (tracked.has(response.request())) record("response", { id: tracked.get(response.request()), status: response.status() }); });
    context.on("requestfinished", request => { if (tracked.has(request)) record("requestfinished", { id: tracked.get(request) }); });
    context.on("requestfailed", request => { if (tracked.has(request)) { const error = request.failure()?.errorText || ""; record("requestfailed", { id: tracked.get(request), reason: /cancel|abort/i.test(error) ? "cancelled" : /block/i.test(error) ? "blocked" : /connect/i.test(error) ? "connection" : "other_redacted" }); } });
    page.on("pageerror", error => { errors.push(error.message); record("pageerror", { category: /search\/poll due to access control checks/.test(error.message) ? "poll_access_control" : "other" }); });
    page.on("close", () => record("page_closed"));
    context.on("close", () => record("context_closed"));
    phase = "test";
    page.on("requestfailed", request => {
      if (request.url().endsWith("/search/inspect")) console.log("Search inspect transport failed", request.failure()?.errorText);
    });
    page.on("response", async response => {
      if (response.url().endsWith("/search/inspect")) {
        const value = await response.json().catch(() => ({}));
        console.log("Search inspect HTTP", response.status(), /^[a-z_]+$/.test(value.error || "") ? value.error : "no_error");
      }
    });
    await page.goto("http://127.0.0.1:5500/"); await settled(page);
    // Both startups (including normal draft-mirror restoration) precede the immutable search boundary.
    const otherTab = await context.newPage(); await otherTab.goto("http://127.0.0.1:5500/"); await settled(otherTab);
    await page.bringToFront();
    console.log("Search fixture browser storage ready");
    await page.evaluate(async () => {
      const transaction = db.transaction(["collections", "notes", "tags"], "readwrite"), store = transaction.objectStore("notes");
      transaction.objectStore("tags").put({ id: "日本語", name: "日本語", color: "#b87333", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
      transaction.objectStore("collections").put({ id: "search-one", name: "検索対象の長いコレクション名".repeat(12), parentId: null, sortOrder: 10, isSystem: false });
      transaction.objectStore("collections").put({ id: "search-child", name: "子コレクション", parentId: "search-one", sortOrder: 11, isSystem: false });
      for (let i = 0; i < 1000; i++) store.put({ id: `search-${String(i).padStart(4, "0")}`, title: i === 0 ? "日本語タイトル一致" : "保存本文", body: i === 0 ? "タイトルのみ" : `${"長文".repeat(i === 1 ? 100000 : 20)}日本語キーワード`, collectionId: i < 3 ? "search-one" : "search-child", tags: [], deletedAt: i === 2 ? 1 : null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
      store.put({ id: "search-0000", title: "日本語タイトル一致", body: "タイトルのみ\r\n😀\n```js\n// 日本語\n```\n[[語句]]<script>untrusted</script>", collectionId: "search-one", tags: ["日本語"], deletedAt: null });
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(transaction.error); });
      window.searchReadWrites = 0; const originalTransaction = db.transaction.bind(db);
      db.transaction = (stores, mode, ...rest) => { if (mode === "readwrite") window.searchReadWrites++; return originalTransaction(stores, mode, ...rest); };
    });
    const before = await snapshot(page);
    record("snapshot_before", { sha256: hash(JSON.stringify(before)) });
    async function allow(scope = "all", target = page, allowRead = false) {
      await target.bringToFront();
      const pair = await call("prepare_memo_search");
      await target.keyboard.press("Escape");
      await target.locator("#memoSearchOpen").evaluate(el => { el.closest("details").open = true; });
      await target.locator("#memoSearchOpen").click();
      if (await target.locator("#memoSearchRevoke").isEnabled()) {
        await target.locator("#memoSearchRevoke").click();
        await target.waitForFunction(() => !document.getElementById("memoSearchInspect").disabled);
      }
      await target.locator("#memoSearchToken").fill(browserToken); await target.locator("#memoSearchCode").fill(pair.pairingCode);
      assert.equal(await target.locator("#memoSearchGrant").isEnabled(), false);
      await target.locator("#memoSearchInspect").click();
      try { await target.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("pairing待ち"), null, { timeout: 12000 }); }
      catch { throw new Error(`Search inspect failed: ${await target.locator("#memoSearchStatus").innerText()}`); }
      assert.ok((await target.locator("#memoSearchPrincipal").innerText()).includes(config.allowedSubjects[0]));
      await target.locator("#memoSearchScope").selectOption(scope);
      await target.locator("#memoSearchAllowRead").setChecked(allowRead);
      await target.locator("#memoSearchGrant").click(); await target.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("検索許可中"));
      return pair;
    }
    const pair = await allow("collection:search-one");
    assert.ok((await page.locator("#memoSearchGrantedScope").innerText()).includes("全コレクション許可：なし"));
    assert.equal(await page.locator("#memoSearchScope").inputValue(), "");
    assert.equal(await page.locator("#memoSearchScope").isDisabled(), true);
    for (const width of [375, 390, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("#memoSearchRevoke").scrollIntoViewIfNeeded();
      assert.equal(await page.locator("#memoSearchDialog").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      for (const id of ["memoSearchRefresh", "memoSearchRevoke", "memoSearchClose"]) {
        const rect = await page.locator(`#${id}`).boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
      }
      await page.screenshot({ path: path.join(artifacts, `permission-${engine.name()}-${width}.png`) });
    }
    await page.locator("#memoSearchRefresh").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("検索可能"));
    // Simulate visibility notifications; real OS suspension/iPhone lifecycle is separate acceptance.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.ok(!(await page.locator("#memoSearchStatus").innerText()).includes("検索可能"));
    await page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("検索可能"));
    const readMemo = (sessionId, memoId, offset = 0) => call("read_saved_memo", { sessionId, memoId, offset });
    assert.equal((await readMemo(pair.sessionId, "search-0000")).error, "read_permission_required");
    assert.equal((await run(pair.sessionId, "日本語")).error, "scope_forbidden");
    const first = await run(pair.sessionId, "日本語", { type: "collection", collectionId: "search-one" });
    assert.deepEqual(first.results.map(note => note.id), ["search-0000", "search-0001"]); assert.equal(first.hasMore, false);
    assert.ok(first.results[1].snippet.includes("日本語"));
    await page.screenshot({ path: path.join(artifacts, "permission.png") });
    const otherBefore = await snapshot(page);
    assert.equal(await otherTab.locator("#memoSearchDialog").isVisible(), false);
    const otherPair = await allow("all", otherTab);
    const [oneResult, otherResult] = await Promise.all([run(pair.sessionId, "タイトル", { type: "collection", collectionId: "search-one" }), run(otherPair.sessionId, "キーワード")]);
    assert.deepEqual(oneResult.results.map(note => note.id), ["search-0000"]);
    assert.deepEqual(otherResult.results.map(note => note.id), ["search-0001", "search-0003"]);
    assert.deepEqual(await snapshot(page), otherBefore);
    const otherRevoke = otherTab.waitForResponse(response => response.url().endsWith("/search/revoke"));
    await otherTab.locator("#memoSearchRevoke").click(); await otherRevoke; await otherTab.close(); await page.bringToFront();
    assert.equal((await run(pair.sessionId, "タイトル", { type: "collection", collectionId: "search-one" })).count, 1);
    const firstRevoke = page.waitForResponse(response => response.url().endsWith("/search/revoke"));
    await page.locator("#memoSearchRevoke").click(); await firstRevoke;
    assert.equal((await run(pair.sessionId, "日本語", { type: "collection", collectionId: "search-one" })).error, "permission_revoked");
    const readPair = await allow("collection:search-one", page, true);
    const readBefore = await snapshot(page);
    await page.evaluate(() => { window.readOriginalDraftReader = getAllNotes; getAllNotes = () => { throw new Error("draft reader must not run"); }; });
    const markdown = await readMemo(readPair.sessionId, "search-0000");
    assert.equal(markdown.body, "タイトルのみ\r\n😀\n```js\n// 日本語\n```\n[[語句]]<script>untrusted</script>");
    assert.deepEqual(markdown.tags, ["日本語"]);
    await page.evaluate(() => { getAllNotes = window.readOriginalDraftReader; });
    const filtered = await run(readPair.sessionId, "日本語", { type: "collection", collectionId: "search-one" }, { fields: ["title"], tagIds: ["日本語"] });
    assert.deepEqual(filtered.results.map(note => [note.id, note.collectionId]), [["search-0000", "search-one"]]);
    const readFirst = await readMemo(readPair.sessionId, "search-0001");
    assert.equal(readFirst.error, undefined, "first read must succeed");
    const readNext = await readMemo(readPair.sessionId, "search-0001", readFirst.nextOffset);
    assert.equal(readNext.error, undefined, "next read must succeed");
    assert.equal(readFirst.offset, 0); assert.equal(readNext.offset, 512);
    assert.equal(readFirst.body + readNext.body, "長文".repeat(512));
    assert.equal((await readMemo(readPair.sessionId, "search-0003")).error, "memo_unavailable");
    assert.equal((await readMemo(readPair.sessionId, "search-0002")).error, "memo_unavailable");
    assert.equal((await readMemo(readPair.sessionId, "missing-note")).error, "memo_unavailable");
    assert.deepEqual(await snapshot(page), readBefore);
    const readRevoke = page.waitForResponse(response => response.url().endsWith("/search/revoke"));
    await page.locator("#memoSearchRevoke").click(); await readRevoke;
    assert.equal((await readMemo(readPair.sessionId, "search-0000")).error, "permission_revoked");
    const allPair = await allow();
    const many = await run(allPair.sessionId, "日本語"); assert.equal(many.count, 2); assert.ok(many.nextCursor);
    const next = await run(allPair.sessionId, "日本語", { type: "all" }, { cursor: many.nextCursor });
    assert.deepEqual(next.results.map(note => note.id), ["search-0003", "search-0004"]);
    assert.equal((await run(allPair.sessionId, "日本語", { type: "all" }, { cursor: many.nextCursor })).error, "invalid_cursor");
    assert.equal((await run(allPair.sessionId, "存在しない語")).count, 0);
    assert.equal((await run(allPair.sessionId, "日本語", { type: "collection", collectionId: "missing-collection" })).error, "collection_unavailable");
    await page.evaluate(() => { dbConnectionClosedForUpgrade = true; });
    assert.equal((await run(allPair.sessionId, "日本語")).error, "storage_unavailable");
    await page.evaluate(() => { dbConnectionClosedForUpgrade = false; });
    // An unsaved in-memory edit is deliberately absent from the database and search.
    await page.evaluate(() => { window.searchOriginalStoredReader = getAllNotes; getAllNotes = () => { throw new Error("draft reader must not run"); }; });
    assert.equal((await run(allPair.sessionId, "日本語")).count, 2);
    await page.evaluate(() => { getAllNotes = window.searchOriginalStoredReader; });
    await page.evaluate(() => { window.searchRealReader = window.MemoNexusSavedSearch.search; window.MemoNexusSavedSearch.search = () => new Promise(resolve => { window.releaseSearchResult = () => resolve({ results: [], count: 0, hasMore: false }); }); });
    const cancelled = run(allPair.sessionId, "日本語");
    await page.waitForFunction(() => typeof window.releaseSearchResult === "function");
    const revokeResponse = page.waitForResponse(response => response.url().endsWith("/search/revoke"));
    await page.locator("#memoSearchRevoke").click(); await revokeResponse;
    assert.equal((await cancelled).error, "permission_revoked");
    await page.evaluate(() => { releaseSearchResult(); window.MemoNexusSavedSearch.search = window.searchRealReader; });
    // Lost revoke acknowledgement + old poll arriving after a new, narrower session.
    clock += 60001; // Reset the fixture rate window without changing permission duration.
    phase = "lost_revoke_ack_held_poll";
    const lostAckPair = await allow();
    let pollArrived;
    const oldPollReady = new Promise(resolve => { pollArrived = resolve; });
    let claimed = false, finishHeldPoll, heldError;
    const heldPollDone = new Promise(resolve => { finishHeldPoll = resolve; });
    // Keep the route registered until its held response is handled. A times:1
    // route removes itself while the callback is still awaiting the release.
    const holdOldPoll = async route => {
      if (claimed) return route.fallback();
      claimed = true;
      try {
      record("held_route_fetch_start", { id: tracked.get(route.request()), method: route.request().method(), pageClosed: page.isClosed() });
      const response = await fetchReceiver(route, receiverPort);
      record("held_route_fetch_return", { id: tracked.get(route.request()), status: response.status() });
      pollArrived(); await new Promise(resolve => { releaseOldPoll = resolve; });
      record("held_route_fulfill_start", { id: tracked.get(route.request()), pageClosed: page.isClosed() });
      await route.fulfill({ response }); record("held_route_fulfill_return", { id: tracked.get(route.request()) });
      } catch (error) { heldError = classifyException(error); record("held_route_fulfill_failed", { id: tracked.get(route.request()), ...heldError }); }
      finally { finishHeldPoll(); }
    };
    await page.route("**/search/poll", holdOldPoll);
    await page.locator("#memoSearchRefresh").click(); await bounded(oldPollReady, 12000, "held poll did not arrive");
    await page.route("**/search/revoke", async route => {
      record("revoke_fixture_fetch_start", { id: tracked.get(route.request()) });
      await fetchReceiver(route, receiverPort); // Server committed, but browser cannot confirm it.
      record("revoke_fixture_abort", { id: tracked.get(route.request()) });
      await route.abort();
    }, { times: 1 });
    await page.locator("#memoSearchRevoke").click();
    await page.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("取り消し結果は未確認"));
    assert.ok(!(await page.locator("#memoSearchStatus").innerText()).includes("検索可能"));
    assert.equal((await run(lostAckPair.sessionId, "日本語")).error, "permission_revoked");
    await page.locator("#memoSearchRefresh").click();
    await page.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("取り消されています"));
    const narrower = await allow("collection:search-one");
    record("held_poll_release"); releaseOldPoll();
    await bounded(heldPollDone, 10000, "held route did not finish");
    assert.equal(heldError, undefined, "held poll must finish without route errors");
    await page.unroute("**/search/poll", holdOldPoll);
    await page.locator("#memoSearchRefresh").click();
    await page.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("検索可能"));
    assert.ok((await page.locator("#memoSearchGrantedScope").innerText()).includes("全コレクション許可：なし"));
    assert.equal((await run(narrower.sessionId, "日本語")).error, "scope_forbidden");
    await page.locator("#memoSearchRevoke").click();
    await page.waitForFunction(() => !document.getElementById("memoSearchInspect").disabled);
    phase = "test";
    // A request that never reaches the receiver must not display revoke success either.
    const failedRevokePair = await allow("collection:search-one");
    await page.route("**/search/revoke", route => route.abort(), { times: 1 });
    await page.locator("#memoSearchRevoke").click();
    await page.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("取り消し結果は未確認"));
    await page.locator("#memoSearchRefresh").click();
    await page.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("取り消しは未確認"));
    await page.locator("#memoSearchRevoke").click();
    await page.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("取り消されています"));
    assert.equal((await run(failedRevokePair.sessionId, "日本語")).error, "permission_revoked");
    results.push("desktop/375/390 long-name layout and keyboard refresh; lost/failed revoke acknowledgement; stale poll after narrower reconnect rejected");
    const localExpired = await allow();
    await page.evaluate(() => { window.searchOriginalNow = Date.now; Date.now = () => window.searchOriginalNow() + 600001; });
    await page.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("期限が切れ"));
    await page.evaluate(() => { Date.now = window.searchOriginalNow; });
    assert.equal((await run(localExpired.sessionId, "日本語")).error, "permission_revoked");
    const expired = await allow(); clock += 600001;
    assert.equal((await run(expired.sessionId, "日本語")).error, "permission_expired");
    await page.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("期限"));
    await allow();
    phase = "injected_poll_abort";
    await context.route("**/search/poll", route => route.abort());
    await page.waitForFunction(() => document.getElementById("memoSearchStatus").textContent.includes("通信に失敗"));
    await context.unroute("**/search/poll"); phase = "test";
    const after = await snapshot(page);
    record("snapshot_after", { sha256: hash(JSON.stringify(after)), readwriteCount: await page.evaluate(() => window.searchReadWrites) });
    assert.deepEqual(after, before); assert.equal(await page.evaluate(() => window.searchReadWrites), 0);
    const reloadPair = await allow("all", page, true);
    await page.reload(); await settled(page);
    assert.equal(await page.locator("#memoSearchAllowRead").isChecked(), false);
    // Unload cancellation is best effort; advance the fixture clock past its heartbeat grace.
    clock += 5001;
    assert.ok(["permission_revoked", "browser_disconnected"].includes((await readMemo(reloadPair.sessionId, "search-0000")).error));
    results.push("real IndexedDB all-store equality; zero readwrite transactions; Japanese/long/1000 notes; collection/trash boundary; cursor; second tab; cancel race; expiry");
    // New browser context has a separate IndexedDB and no inherited grant.
    const separate = await browser.newContext(); await attachTransport(separate, staticPort, receiverPort);
    const separatePage = await separate.newPage(); await separatePage.goto("http://127.0.0.1:5500/"); await settled(separatePage);
    assert.equal(await separatePage.evaluate(async () => (await window.MemoNexusSavedSearch.search({ query: "日本語", scope: { type: "all" } }, null)).count), 0);
    await separate.close();
    const disconnected = await allow();
    phase = "injected_revoke_abort_and_page_close";
    await context.route("**/search/revoke", route => route.abort()); record("page_close_start"); await page.close(); record("page_close_return"); clock += 5001;
    assert.equal((await run(disconnected.sessionId, "日本語")).error, "browser_disconnected");
    assert.deepEqual(errors, []); results.push("separate profile isolation; closed browser without revoke is disconnected; no page errors");
    await fs.writeFile(path.join(artifacts, `result-${engine.name()}.json`), JSON.stringify({ mode: `fictional issuer and automated ${engine.name()}, not actual ChatGPT`, passed: results }, null, 2));
    console.log("PASS memo search browser/IndexedDB/OAuth integration (fictional issuer, not actual ChatGPT)");
  } finally {
    phase = "cleanup"; record("cleanup_start");
    releaseOldPoll?.();
    if (browser) { record("browser_close_start"); await browser.close(); record("browser_close_return"); }
    for (const [name, server] of [["oauth", oauth], ["receiver", receiver], ["static", staticServer]]) if (server?.listening) { record("server_close_start", { name }); await close(server); record("server_close_return", { name }); }
    const recordedAtJST = new Date(Date.now() + 9 * 3600000).toISOString().replace("Z", "+09:00");
    await fs.writeFile(path.join(artifacts, `timeline-${process.env.MEMO_SEARCH_BROWSER || "chromium"}-${Date.now()}-${randomBytes(4).toString("hex")}.json`), JSON.stringify({ test: "memo-search-e2e-route-diagnostic", ...await metadata(["memo-search.e2e.js", "received-e2e-transport.js", "memo-search-ui.js", "memo-search-broker.js", "experiments/mcp-search-worker-feasibility/stage5-evidence.cjs"]), recordedAtJST, engine: process.env.MEMO_SEARCH_BROWSER || "chromium", timeline }, null, 2), { flag: "wx" });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
