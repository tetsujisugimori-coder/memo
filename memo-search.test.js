"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const { search, conditions, responseBytes, validateResult } = require("./memo-search.js");
const { createSearchBroker } = require("./memo-search-broker.js");
const { createPreviewService } = require("./dummy-preview-service.js");
const { createAuthenticatedServer } = require("./mcp-http-server.js");
const { config, issuerFixture, listen, close, wire } = require("./mcp-http-oauth.fixture.js");
const principal = { issuer: config.authorization_servers[0], sub: config.allowedSubjects[0] }, origin = "http://127.0.0.1:5500";
const all = { query: "日本語", scope: { type: "all" }, limit: 2 };
const scopeExplanations = [
  "全メモ検索は、子・孫コレクションを含むすべてのコレクションの保存済みメモを対象にします。",
  "コレクション指定検索は、指定先直下の保存済みメモのみを対象とし、子・孫コレクションは含みません。",
  "未保存ドラフト、ゴミ箱、添付データは、どちらの検索でも対象外です。"
];
const notes = [
  { id: "a", title: "日本語タイトル", body: "title-only", collectionId: "one" },
  { id: "b", title: "本文", body: "長文".repeat(100000) + "日本語の一致", collectionId: "one" },
  { id: "c", title: "日本語", body: "子", collectionId: "child" },
  { id: "d", title: "日本語", body: "秘密", collectionId: "two" },
  { id: "e", title: "日本語", body: "削除", collectionId: "one", deletedAt: 1 }
];
function grant(broker, selected = { type: "all" }) {
  const pair = broker.prepare(principal);
  const session = broker.grant({ pairingCode: pair.pairingCode, scope: selected }, origin);
  return { ...session, pairingCode: pair.pairingCode, auth: { sessionId: session.sessionId, capability: session.capability } };
}
function complete(broker, session, input = all, source = notes) {
  const promise = broker.search(principal, { sessionId: session.sessionId, conditions: input });
  const work = broker.poll(session.auth, origin).request;
  assert.ok(work);
  broker.result({ ...session.auth, requestId: work.requestId, result: search(source, work.conditions, work.afterId) }, origin);
  return promise;
}
test("permission screen and specification distinguish all collections from direct collection members", () => {
  const fs = require("node:fs"), path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const dialog = /<dialog id="memoSearchDialog"[\s\S]*?<\/dialog>/.exec(html)?.[0];
  assert.ok(dialog);
  const specification = fs.readFileSync(path.join(__dirname, "docs/mcp-saved-search.md"), "utf8");
  for (const explanation of scopeExplanations) {
    assert.ok(dialog.includes(explanation), `permission screen: ${explanation}`);
    assert.ok(specification.includes(explanation), `specification: ${explanation}`);
  }
});
test("Japanese title/body, long text, exact collection boundary, trash, deterministic pages and immutable input", () => {
  const before = structuredClone(notes);
  const first = search(notes, all); assert.deepEqual(first.results.map(n => n.id), ["a", "b"]); assert.equal(first.hasMore, true);
  assert.ok(first.results[1].snippet.includes("日本語")); assert.ok(Array.from(first.results[1].snippet).length <= 160);
  assert.deepEqual(search(notes, { ...all, scope: { type: "collection", collectionId: "one" } }).results.map(n => n.id), ["a", "b"]);
  assert.deepEqual(search(notes, all, "b").results.map(n => n.id), ["c", "d"]);
  assert.equal(search(notes, { ...all, query: "存在しない" }).count, 0);
  assert.equal(search([{ id: "x", title: "ASCII", body: "" }], { ...all, query: "ascii" }).count, 1);
  assert.deepEqual(notes, before);
});
test("unsupported options rejected; large result and JSON escaping stay within tool response budget", () => {
  for (const input of [{ ...all, query: " " }, { ...all, query: "語".repeat(101) }, { ...all, limit: 11 }, { ...all, regex: true },
    { ...all, scope: { type: "collection", collectionId: "one", recursive: true } }, { ...all, cursor: "offset:100" }]) assert.throws(() => conditions(input));
  for (const char of ["語", '"', "\\", "\u0000", "😀"]) {
    const huge = Array.from({ length: 10000 }, (_, i) => ({ id: String(i).padStart(5, "0"), title: char.repeat(200) + "語", body: char.repeat(160) }));
    const page = search(huge, { query: "語", scope: { type: "all" }, limit: 10 });
    assert.ok(page.count > 0 && page.count <= 10 && page.hasMore); validateResult(page, 10);
    assert.ok(responseBytes({ ...page, nextCursor: "x".repeat(43) }) <= 8192);
  }
});
test("pairing is explicit, one-use, bound to subject/origin/tab; collection cannot widen", async t => {
  const broker = createSearchBroker(); t.after(() => broker.close());
  const pair = broker.prepare(principal);
  await assert.rejects(broker.search(principal, { sessionId: pair.sessionId, conditions: all }), /permission_required/);
  assert.deepEqual(broker.inspect({ pairingCode: pair.pairingCode }).principal, principal);
  const session = grant(broker, { type: "collection", collectionId: "one" });
  assert.throws(() => broker.grant({ pairingCode: session.pairingCode, scope: { type: "all" } }, origin), /pairing_invalid/);
  await assert.rejects(broker.search({ ...principal, sub: config.allowedSubjects[1] }, { sessionId: session.sessionId, conditions: all }), /subject_mismatch/);
  await assert.rejects(broker.search(principal, { sessionId: session.sessionId, conditions: all }), /scope_forbidden/);
  for (const collectionId of ["child", "two"]) {
    await assert.rejects(broker.search(principal, { sessionId: session.sessionId,
      conditions: { ...all, scope: { type: "collection", collectionId } } }), /scope_forbidden/);
  }
  assert.throws(() => broker.poll({ ...session.auth, capability: randomBytes(32).toString("base64url") }, origin), /tab_forbidden/);
  assert.throws(() => broker.poll(session.auth, "https://tetsujisugimori-coder.github.io"), /tab_forbidden/);
  const secondTab = grant(broker); assert.notEqual(session.capability, secondTab.capability);
  assert.throws(() => broker.poll({ sessionId: session.sessionId, capability: secondTab.capability }, origin), /tab_forbidden/);
  assert.equal((await complete(broker, session, { ...all, scope: { type: "collection", collectionId: "one" } })).count, 2);
});
test("request correlation, cursor consumption/binding and cancellation erase pending results", async t => {
  const broker = createSearchBroker(); t.after(() => broker.close()); const session = grant(broker);
  const first = await complete(broker, session); assert.ok(first.nextCursor);
  await assert.rejects(broker.search(principal, { sessionId: session.sessionId, conditions: { ...all, query: "別", cursor: first.nextCursor } }), /invalid_cursor/);
  const second = await complete(broker, session, { ...all, cursor: first.nextCursor }); assert.deepEqual(second.results.map(n => n.id), ["c", "d"]);
  await assert.rejects(broker.search(principal, { sessionId: session.sessionId, conditions: { ...all, cursor: first.nextCursor } }), /invalid_cursor/);
  const pending = broker.search(principal, { sessionId: session.sessionId, conditions: all });
  const work = broker.poll(session.auth, origin).request;
  assert.throws(() => broker.result({ ...session.auth, requestId: "other", result: search(notes, all) }, origin), /request_mismatch/);
  await assert.rejects(broker.search(principal, { sessionId: session.sessionId, conditions: all }), /search_busy/);
  broker.revoke(session.auth, origin); assert.deepEqual(await pending, { error: "permission_revoked" });
  assert.throws(() => broker.result({ ...session.auth, requestId: work.requestId, result: search(notes, all) }, origin), /permission_revoked/);
  await assert.rejects(broker.search(principal, { sessionId: session.sessionId, conditions: all }), /permission_revoked/);
});
test("expiry, disconnected browser, responsive browser timeout and storage failure remain distinct", async t => {
  let time = 1000; const broker = createSearchBroker({ now: () => time, timeoutMs: 10 }); t.after(() => broker.close());
  const pair = broker.prepare(principal); time += 120001;
  assert.throws(() => broker.inspect({ pairingCode: pair.pairingCode }), /pairing_invalid_or_expired/);
  const session = grant(broker); time += 5001;
  await assert.rejects(broker.search(principal, { sessionId: session.sessionId, conditions: all }), /browser_disconnected/);
  broker.poll(session.auth, origin);
  assert.deepEqual(await broker.search(principal, { sessionId: session.sessionId, conditions: all }), { error: "search_timeout" });
  const pending = broker.search(principal, { sessionId: session.sessionId, conditions: all }), work = broker.poll(session.auth, origin).request;
  broker.result({ ...session.auth, requestId: work.requestId, error: "storage_unavailable" }, origin);
  assert.deepEqual(await pending, { error: "storage_unavailable" });
  const expires = broker.search(principal, { sessionId: session.sessionId, conditions: all }); time += 600000;
  assert.throws(() => broker.poll(session.auth, origin), /permission_expired/); assert.deepEqual(await expires, { error: "permission_expired" });
});
test("session and principal budgets include concurrent reservations and survive new permission sessions", async t => {
  const broker = createSearchBroker(); t.after(() => broker.close()); let session = grant(broker);
  for (let i = 0; i < 20; i++) await complete(broker, session, all, []);
  await assert.rejects(broker.search(principal, { sessionId: session.sessionId, conditions: all }), /search_budget_exhausted/);
  broker.revoke(session.auth, origin);
  session = grant(broker);
  const ten = { ...all, limit: 10 }, many = Array.from({ length: 20 }, (_, i) => ({ id: String(i).padStart(3, "0"), title: "日本語", body: "" }));
  for (let i = 0; i < 10; i++) await complete(broker, session, ten, many);
  await assert.rejects(broker.search(principal, { sessionId: session.sessionId, conditions: ten }), /search_budget_exhausted/);
  broker.revoke(session.auth, origin);
  const one = grant(broker), two = grant(broker);
  for (let i = 0; i < 9; i++) await complete(broker, one, ten, many);
  const pending = broker.search(principal, { sessionId: one.sessionId, conditions: ten });
  await assert.rejects(broker.search(principal, { sessionId: two.sessionId, conditions: ten }), /search_budget_exhausted/);
  broker.revoke(one.auth, origin); await pending;
  // Cancelling refunds rows/bytes but the request count remains spent.
  assert.equal((await complete(broker, two, ten, many)).count, 10);
});
test("OAuth search-only/submit-only and receiver HTTP boundaries use actual RS256 and SDK transport", async t => {
  const adapterToken = randomBytes(32).toString("base64url"), browserToken = randomBytes(32).toString("base64url");
  const service = createPreviewService({ browserToken, adapterToken });
  const receiver = service.server, receiverPort = await listen(receiver);
  const issuer = await issuerFixture(), logs = [];
  const server = await createAuthenticatedServer({ ...config, scopes_supported: ["memo:submit", "memo:search"] },
    { adapterToken, receiverPort, fetchImpl: issuer.fetchImpl, diagnostics: true, diagnosticWriter: line => logs.push(line) });
  const port = await listen(server); t.after(async () => { await close(server); await close(receiver); });
  const searchToken = await issuer.sign({ scope: "memo:search" }), submitToken = await issuer.sign();
  const call = (name, args = {}, token = searchToken) => wire(port, token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const unpack = response => JSON.parse(response.json.result.content[0].text);
  assert.equal((await call("prepare_memo_search", {}, undefined)).status, 200);
  assert.equal((await wire(port, undefined, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401);
  assert.equal((await call("prepare_memo_search", {}, submitToken)).status, 403);
  assert.equal((await call("submit_text_preview", {}, searchToken)).status, 403);
  assert.equal((await call("prepare_memo_search", {}, await issuer.sign({ exp: 1 }))).status, 401);
  const listed = (await wire(port, searchToken, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json.result.tools;
  assert.deepEqual(listed.map(tool => tool.name), ["submit_text_preview", "submit_notes_preview", "prepare_memo_search", "search_saved_memos"]);
  const description = listed.find(tool => tool.name === "search_saved_memos").description;
  for (const explanation of scopeExplanations) assert.ok(description.includes(explanation), `MCP tool: ${explanation}`);
  assert.ok(listed.filter(tool => ["prepare_memo_search", "search_saved_memos"].includes(tool.name))
    .every(tool => tool.securitySchemes[0].scopes[0] === "memo:search"));
  const bothToken = await issuer.sign({ scope: "memo:submit memo:search" });
  for (const name of ["submit_text_preview", "submit_notes_preview"]) {
    const note = { title: "fixture", body: "fixture body" }, requestId = randomUUID();
    const response = await call(name, { requestId, ...(name === "submit_text_preview" ? note : { notes: [note] }) }, bothToken);
    assert.equal(response.status, 200); assert.equal(response.json.result.isError, false);
    assert.equal(unpack(response).saved, false);
    const queued = service.queue.peek();
    if (name === "submit_text_preview") assert.equal(queued.savePlan, null);
    else assert.ok(queued.notes.every(note => note.savePlan === null && note.saved === false));
    if (queued.notes) for (const note of queued.notes) service.queue.reject(queued.requestId, note.itemId);
    else service.queue.reject(queued.requestId);
  }
  const bothPair = unpack(await call("prepare_memo_search", {}, bothToken));
  assert.ok(bothPair.sessionId);
  assert.equal(unpack(await call("search_saved_memos", { sessionId: bothPair.sessionId, conditions: all }, bothToken)).error, "permission_required");
  const pair = unpack(await call("prepare_memo_search"));
  assert.equal(unpack(await call("search_saved_memos", { sessionId: pair.sessionId, conditions: all })).error, "permission_required");
  async function browser(route, input, token = browserToken, browserOrigin = origin) {
    const response = await fetch(`http://127.0.0.1:${receiverPort}/search/${route}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(browserOrigin ? { Origin: browserOrigin } : {}) }, body: JSON.stringify(input) });
    return { status: response.status, json: await response.json() };
  }
  assert.equal((await browser("inspect", { pairingCode: pair.pairingCode }, adapterToken)).status, 401);
  assert.equal((await browser("inspect", { pairingCode: pair.pairingCode }, browserToken, null)).status, 403);
  assert.equal((await browser("inspect", { pairingCode: pair.pairingCode }, browserToken, "https://evil.invalid")).status, 403);
  assert.equal((await browser("prepare", { principal }, adapterToken)).status, 403);
  assert.deepEqual((await browser("inspect", { pairingCode: pair.pairingCode })).json.principal, principal);
  const session = (await browser("grant", { pairingCode: pair.pairingCode, scope: { type: "all" } })).json;
  const auth = { sessionId: session.sessionId, capability: session.capability };
  assert.equal(unpack(await call("search_saved_memos", { sessionId: session.sessionId, conditions: all }, await issuer.sign({ scope: "memo:search", sub: config.allowedSubjects[1] }))).error, "subject_mismatch");
  const pending = call("search_saved_memos", { sessionId: session.sessionId, conditions: all }, bothToken);
  let work;
  for (let i = 0; i < 100 && !work; i++) { work = (await browser("poll", auth)).json.request; if (!work) await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.ok(work); assert.equal((await browser("result", { ...auth, requestId: work.requestId, result: search(notes, work.conditions) })).status, 200);
  assert.deepEqual(unpack(await pending).results.map(note => note.id), ["a", "b"]);
  await browser("revoke", auth);
  assert.equal(unpack(await call("search_saved_memos", { sessionId: session.sessionId, conditions: all })).error, "permission_revoked");
  assert.equal(unpack(await call("search_saved_memos", { sessionId: session.sessionId, conditions: { ...all, regex: true } })).error, "unsupported_conditions");
  const log = logs.join("\n");
  for (const secret of [searchToken, submitToken, bothToken, browserToken, adapterToken, pair.pairingCode, bothPair.pairingCode, session.capability, all.query, notes[1].body, principal.sub]) assert.ok(!log.includes(secret));
  await close(receiver);
  assert.equal(unpack(await call("prepare_memo_search")).error, "receiver_unavailable");
});

test("byte and operation budgets, global concurrency and malformed browser responses fail closed", async t => {
  const broker = createSearchBroker(); t.after(() => broker.close());
  const one = grant(broker), two = grant(broker), three = grant(broker);
  const a = broker.search(principal, { sessionId: one.sessionId, conditions: all });
  const b = broker.search(principal, { sessionId: two.sessionId, conditions: all });
  await assert.rejects(broker.search(principal, { sessionId: three.sessionId, conditions: all }), /search_busy/);
  const work = broker.poll(one.auth, origin).request;
  for (const result of [
    { results: [{ id: "x", title: "語".repeat(201), snippet: "" }], hasMore: false, count: 1 },
    { results: [], count: 0, hasMore: true }, { results: [], count: 0, hasMore: false, body: "must not escape" },
    { results: [{ id: "x", title: "", snippet: "" }, { id: "x", title: "", snippet: "" }], count: 2, hasMore: false }
  ]) assert.throws(() => broker.result({ ...one.auth, requestId: work.requestId, result }, origin));
  broker.revoke(one.auth, origin); broker.revoke(two.auth, origin); await Promise.all([a, b]);
  const heavy = Array.from({ length: 20 }, (_, i) => ({ id: String(i).padStart(3, "0"), title: "語".repeat(200), body: "語".repeat(160) }));
  let consumed = 0, stopped = false;
  for (let i = 0; i < 20; i++) {
    const remaining = broker.poll(three.auth, origin).remaining;
    if (remaining.bytes < 8192) {
      await assert.rejects(broker.search(principal, { sessionId: three.sessionId, conditions: { query: "語", scope: { type: "all" }, limit: 10 } }), /search_budget_exhausted/);
      assert.ok(consumed <= 65536 && consumed > 57000); stopped = true; break;
    }
    const output = await complete(broker, three, { query: "語", scope: { type: "all" }, limit: 10 }, heavy); consumed += responseBytes(output);
  }
  assert.ok(stopped);
  broker.revoke(three.auth, origin);
  // Preparation attempts still count when the service's bounded session table is full.
  let denied = false;
  const limited = createSearchBroker(); t.after(() => limited.close());
  const session = grant(limited);
  for (let i = 0; i < 20; i++) await complete(limited, session, all, []);
  limited.revoke(session.auth, origin);
  for (let i = 0; i < 60; i++) {
    try { const next = grant(limited); limited.revoke(next.auth, origin); }
    catch (error) { if (error.code === "search_budget_exhausted") { denied = true; break; } assert.equal(error.code, "search_capacity"); }
  }
  assert.ok(denied);
});
