"use strict";
// Actual application writers and natural 280ms autosave. Synthetic fixtures only;
// no replacement of persistence, timers, BroadcastChannel, or application globals.
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { createHash } = require("node:crypto"), { execFileSync } = require("node:child_process");
const playwright = require("playwright");
const { createServer, openApp, saved, snapshot, observe, assertClean } = require("./note-conflict-test-support.cjs");
const { captureState, waitForOutcome } = require("./note-conflict-observer.cjs");
const output = path.resolve(process.env.MEMO_SAVE_ARTIFACTS || path.join(os.tmpdir(), "memo-issue429/browser"), "postmerge");
const collectionId = "fictional-postmerge-collection", unrelatedId = "fictional-unrelated-collection";
const drafts = { A: "A_NEW\n架空メモ α", B: "B_DRAFT\n架空メモ β" };
async function seed(page) {
  return page.evaluate(async ({ collectionId, unrelatedId }) => {
    for (const id of [collectionId, unrelatedId]) await putCollection({ id, name: id, parentId: null, isSystem: false, sortOrder: 1 });
    collections = await getAllCollections();
    await mutateNotesAtomically([currentId], note => { note.collectionId = collectionId; });
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 2;
    canvas.getContext("2d").fillRect(0, 0, 2, 2);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "fictional.png", { type: "image/png" });
    const old = await prepareAttachmentFile(file, "image", currentId); old.source = { type: "web-clip" };
    const unrelated = await prepareAttachmentFile(file, "image", currentId);
    await putAttachments([old, unrelated]);
    return { id: currentId, oldAttachmentId: old.id, unrelatedAttachmentId: unrelated.id,
      imageBase64: canvas.toDataURL("image/png").split(",")[1] };
  }, { collectionId, unrelatedId });
}
async function invoke(page, kind, fixture) {
  return page.evaluate(async ({ kind, fixture, collectionId }) => {
    try {
      if (kind === "collection") await deleteCollectionSafely(collectionId);
      else await createWebClipNoteWithImages("Fictional clip", {
        title: "Fictional clip", url: "https://example.invalid/fictional", host: "example.invalid",
        clipMode: "page", selection: "CLIP_DRAFT\n全文保全確認", capturedAt: "2026-11-11T00:00:00.000Z",
        images: [{ token: "fixture-image", status: "ready", selected: true, dataBase64: fixture.imageBase64,
          mimeType: "image/png", fileName: "fictional.png", alt: "fictional" }]
      }, { type: "web-clip" }, collectionId, currentNote());
      return { resolved: true };
    } catch (error) { return { resolved: false, message: error.message, code: error.code, conflictDetected: error.conflictDetected, preserved: error.preserved }; }
  }, { kind, fixture, collectionId });
}
function attachmentIds(storage) { return storage.stores.attachments.map(row => row.id).sort(); }
async function runCase(browser, browserName, origin, kind, conflict) {
  // The tested WebKit private contexts reject IndexedDB Blob writes before CAS is reached.
  // A unique disposable persistent profile exercises the same real attachment path.
  const profile = browserName === "webkit" ? await fs.mkdtemp(path.join(output, "webkit-profile-")) : null;
  const contextOptions = { viewport: { width: 1280, height: 900 } };
  const context = profile
    ? await playwright.webkit.launchPersistentContext(profile, { ...contextOptions, headless: true })
    : await browser.newContext(contextOptions);
  const result = { browser: browserName, kind, scenario: conflict ? "conflict" : "success-next-autosave", status: "FAIL", logs: [] };
  result.contextMode = profile ? "isolated-persistent-profile" : "isolated-private-context";
  result.browserVersion = context.browser()?.version() || browser?.version() || null;
  let timedOut = false;
  const watchdog = setTimeout(() => { timedOut = true; void context.close(); }, 90000);
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.fulfill({ status: 200, contentType: route.request().resourceType() === "stylesheet" ? "text/css" : "application/javascript", body: "" }));
  const open = async () => { const page = await context.newPage(); page.setDefaultTimeout(10000); result.logs.push(observe(page));
    page.on("dialog", dialog => dialog.accept()); await openApp(page, `${origin}/index.html`); return page; };
  let target;
  try {
    const a = target = await open(); const fixture = result.fixture = await seed(a);
    await a.locator("#editor").fill("BASE"); await saved(a, fixture.id, "BASE");
    if (conflict) {
      const b = await open(); assert.equal(await b.evaluate(() => currentId), fixture.id);
      await a.locator("#editor").fill(drafts.A); await b.locator("#editor").fill(drafts.B);
      // Read only this note concurrently: full attachment-store snapshots can outlast
      // the natural autosave window. These observations are not cross-tab atomic.
      result.beforeAutosave = await Promise.all([a, b].map((page, index) => page.evaluate(async ({ id, tab }) => {
        const transaction = db.transaction("notes", "readonly"), request = transaction.objectStore("notes").get(id);
        const stored = await new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve(request.result);
          transaction.onabort = () => reject(transaction.error);
        });
        return { tab, at: Date.now(), stored, save: noteSaveFoundation.getState(id) };
      }, { id: fixture.id, tab: index ? "B" : "A" })));
      assert.ok(result.beforeAutosave.every(row => row.save.dirty && row.stored.body === "BASE"), "both actual UI drafts dirty before unmodified autosave");
      result.collision = await waitForOutcome([a, b], fixture.id);
      assert.equal(result.collision.kind, "conflict-stopped");
      const committed = result.collision.states[0].stored;
      assert.ok(Object.values(drafts).includes(committed.body));
      const blockedIndex = committed.body === drafts.A ? 1 : 0;
      target = [a, b][blockedIndex]; result.blockedDraft = blockedIndex ? drafts.B : drafts.A;
      result.before = await captureState(target, fixture.id, "blocked");
      assert.equal(result.before.editor, result.blockedDraft); assert.equal(result.before.save.dirty, true);
      result.operation = await invoke(target, kind, fixture);
      result.after = await captureState(target, fixture.id, "blocked");
      // Capture raw outcome before assertions so old-main silent overwrite remains evidence.
      assert.equal(result.operation.resolved, false, "custom writer must refuse an already-conflicting draft");
      assert.equal(result.operation.conflictDetected, true);
      assert.deepEqual(result.after.stored, committed, "committed note must not change");
      assert.equal(result.after.editor, result.blockedDraft, "original dirty editor survives the rejected operation");
      assert.equal(result.after.save.dirty, true); assert.notEqual(result.after.badgeState, "saved");
      assert.ok(result.after.storage.stores["note-conflicts"].some(row => row.kind === "memo-conflict-draft" && row.body === result.blockedDraft), "original full draft remains durably preserved");
      assert.deepEqual(result.after.storage.stores.collections, result.before.storage.stores.collections);
      assert.deepEqual(result.after.storage.stores.attachments, result.before.storage.stores.attachments);
    } else {
      result.before = await snapshot(a); result.operation = await invoke(a, kind, fixture);
      result.after = await snapshot(a); assert.equal(result.operation.resolved, true, result.operation.message);
      const stored = result.after.stores.notes.find(row => row.id === fixture.id);
      assert.equal(stored.collectionId, kind === "collection" ? "system-unclassified" : collectionId);
      assert.equal(result.after.stores.collections.some(row => row.id === collectionId), kind !== "collection");
      assert.ok(result.after.stores.collections.some(row => row.id === unrelatedId));
      assert.ok(attachmentIds(result.after).includes(fixture.unrelatedAttachmentId));
      assert.equal(attachmentIds(result.after).includes(fixture.oldAttachmentId), kind === "collection");
      if (kind === "webclip") assert.equal(result.after.stores.attachments.length, result.before.stores.attachments.length);
      await a.locator("#editor").fill("NEXT_NORMAL_AUTOSAVE\n追記");
      result.nextSave = await saved(a, fixture.id, "NEXT_NORMAL_AUTOSAVE\n追記");
      assert.ok(result.nextSave.stored.revision > stored.revision);
    }
    result.logs.forEach(assertClean); result.status = "PASS";
  } catch (error) { result.error = (timedOut ? "90s watchdog; remaining checks NOT_TESTED.\n" : "") + error.stack; }
  finally {
    if (target && !target.isClosed()) await target.screenshot({ path: path.join(output, `${browserName}-${kind}-${result.scenario}.png`), fullPage: true }).catch(error => { result.screenshotError = error.message; });
    clearTimeout(watchdog); await context.close();
  }
  return result;
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const root = path.resolve(process.env.MEMO_SAVE_APP_ROOT || __dirname);
  const hash = async file => createHash("sha256").update(await fs.readFile(file)).digest("hex");
  const engines = (process.env.MEMO_SAVE_BROWSERS || "chromium,webkit").split(",");
  const report = { testedHead: process.env.MEMO_SAVE_SOURCE_HEAD || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    appSha256: await hash(path.join(root, "app.js")), runnerSha256: await hash(__filename),
    sourceHashes: Object.fromEntries(await Promise.all(["app.js", "note-conflict-store.js", "note-conflict-ui.js", "note-save-foundation.js"].map(async file => [file, await hash(path.join(root, file))]))),
    platform: process.platform, playwrightVersion: require(path.join(path.dirname(require.resolve("playwright")), "package.json")).version,
    runnerHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim(),
    workingTreeDiff: process.env.MEMO_SAVE_SOURCE_HEAD ? "Archived source; source hashes recorded" : execFileSync("git", ["diff", "--stat"], { cwd: root, encoding: "utf8" }),
    startedAt: new Date().toISOString(), expectedCases: engines.length * 4, cases: [],
    limitations: ["Isolated synthetic data; actual browser and production writers", "No export/download, persistent-process recovery, real Safari/PWA or long-term durability tested by this supplemental runner"] };
  const server = createServer(root); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const name of engines) {
      let browser;
      try { if (name !== "webkit") browser = await playwright[name].launch();
        for (const kind of ["collection", "webclip"]) for (const conflict of [true, false]) {
          const result = await runCase(browser, name, origin, kind, conflict); report.cases.push(result);
        }
      } catch (error) { report.cases.push({ browser: name, status: "NOT_TESTED", error: error.stack }); }
      finally { await browser?.close(); }
    }
  } finally {
    server.close(); report.finishedAt = new Date().toISOString();
    report.status = report.cases.length === report.expectedCases && report.cases.every(row => row.status === "PASS") ? "PASS" : "FAIL";
    const file = path.join(output, "results.json"); await fs.writeFile(file, JSON.stringify(report, null, 2) + "\n");
    const files = (await fs.readdir(output)).filter(name => name.endsWith(".png") || name === "results.json");
    await fs.writeFile(path.join(output, "SHA256SUMS"), (await Promise.all(files.map(async name => `${await hash(path.join(output, name))}  ${name}`))).join("\n") + "\n");
    console.log(JSON.stringify({ status: report.status, cases: report.cases.map(({ browser, kind, scenario, status, error }) => ({ browser, kind, scenario, status, error })) }, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
