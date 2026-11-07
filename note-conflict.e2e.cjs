"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { execFileSync } = require("node:child_process");
const playwright = require("playwright");
const { createServer, observe, assertClean, snapshot, openApp, appReady, saved } = require("./note-conflict-test-support.cjs");
const { capturePair, waitForOutcome, exerciseRecovery } = require("./note-conflict-observer.cjs");
const { evaluateSafety } = require("./note-conflict-acceptance.cjs");
const output = path.resolve(process.env.MEMO_SAVE_ARTIFACTS || path.join(os.tmpdir(), "memo-issue429/browser"));
const baselineBody = "lineA=single\nlineB=sequential";
const drafts = { A: "lineA=overlap-A\nlineB=sequential", B: "lineA=single\nlineB=overlap-B" };

async function collision(browser, browserName, origin, { width = 1280, order = "AB", theme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: "reduce",
    storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: "memo-nexus-theme", value: theme }] }] } });
  let timedOut = false;
  const watchdog = setTimeout(() => { timedOut = true; void context.close(); }, 90000);
  const logs = [], external = [], result = { browser: browserName, width, order, theme, checks: [], logs, external };
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url());
    return route.fulfill({ status: 200, contentType: route.request().resourceType() === "stylesheet" ? "text/css" : "application/javascript", body: "" });
  });
  const newPage = async (url) => { const page = await context.newPage(); page.setDefaultTimeout(10000); logs.push(observe(page)); await openApp(page, url); return page; };
  let pages = [];
  try {
    const first = await newPage(`${origin}/index.html`);
    assert.equal(await first.evaluate(() => document.body.classList.contains("dark")), theme === "dark", "actual app theme follows the isolated preference fixture");
    const id = await first.evaluate(() => currentId);
    // Keep the Today title so that fresh tabs naturally select this exact memo.
    await first.locator("#editor").fill("lineA=single\nlineB=base");
    await saved(first, id, "lineA=single\nlineB=base");
    const second = await newPage(`${origin}/index.html`);
    assert.equal(await second.evaluate(() => currentId), id);
    await second.locator("#editor").fill(baselineBody);
    await saved(second, id, baselineBody);
    await first.waitForFunction((body) => document.querySelector("#editor").value === body, baselineBody);
    pages = [first, second];
    const stored = (await snapshot(first)).stores.notes.find((note) => note.id === id);
    await pages[order === "AB" ? 0 : 1].bringToFront();
    for (const tab of order) await pages[tab === "A" ? 0 : 1].locator("#editor").fill(drafts[tab]);
    const before = await capturePair(pages, id);
    assert.ok(before.every((state) => state.save.dirty && state.stored.body === baselineBody), "both drafts dirty before unmodified natural 280ms autosave");
    const evidence = result.evidence = { spec: { noteId: id, baselineBody, baselineRevision: stored.revision, drafts },
      execution: { completed: false, errors: [] }, observations: { before } };
    evidence.wait = await waitForOutcome(pages, id);
    evidence.observations.terminal = evidence.wait.states;
    assert.ok(["saved", "conflict-stopped"].includes(evidence.wait.kind), evidence.wait.reason);
    const committed = evidence.wait.states[0].stored;
    const blockedTab = committed.body === drafts.A ? "B" : committed.body === drafts.B ? "A" : null;
    const blockedIndex = blockedTab === "A" ? 0 : 1;
    result.blockedTab = blockedTab;
    result.winner = blockedTab === "A" ? "B" : blockedTab === "B" ? "A" : null;
    if (blockedTab && evidence.wait.kind === "conflict-stopped") {
      const blocked = pages[blockedIndex], button = blocked.locator("[data-memo-conflict-export]");
      await button.focus();
      await blocked.keyboard.press("Shift+Tab");
      await blocked.keyboard.press("Tab");
      const focus = await button.evaluate((element) => ({ active: document.activeElement === element,
        width: getComputedStyle(element).outlineWidth, style: getComputedStyle(element).outlineStyle }));
      assert.ok(focus.active && parseFloat(focus.width) >= 2 && focus.style !== "none", "keyboard focus must be visible");
      const downloadWait = blocked.waitForEvent("download");
      await blocked.keyboard.press("Enter");
      assert.equal(await fs.readFile(await (await downloadWait).path(), "utf8"), drafts[blockedTab]);
      result.keyboardExport = { status: "PASS", focus };
    }
    for (const [index, page] of pages.entries()) await page.screenshot({ path: path.join(output, `${browserName}-${width}-${order}-${index}-terminal.png`), fullPage: true });
    for (const page of pages) { await page.reload({ waitUntil: "commit" }); await appReady(page); }
    evidence.observations.reloaded = await capturePair(pages, id);
    for (const page of pages) await page.close();
    pages = [await newPage(`${origin}/index.html`), await newPage(`${origin}/index.html`)];
    // Fresh tabs have no former tab identity. The user explicitly opens the
    // durable draft via the real recovery UI; no state/ownership is mocked.
    if (blockedTab && await pages[blockedIndex].locator("[data-conflict-open]").count()) {
      const list = pages[blockedIndex].locator("#noteConflictHost details");
      await list.locator("summary").click();
      await list.locator("[data-conflict-open]").first().click();
      await pages[blockedIndex].locator("[data-memo-conflict]").waitFor({ state: "visible" });
    }
    evidence.observations.reopened = await capturePair(pages, id);
    evidence.recovery = await exerciseRecovery(pages, id, output);
    evidence.execution.completed = true;
    result.acceptance = evaluateSafety(evidence);
    result.status = result.acceptance.status;
    if (result.acceptance.status === "PASS") {
      assert.equal(result.acceptance.acceptedMethod, "B", "no automatic merge implementation");
      const blocked = pages[blockedIndex];
      await blocked.locator("[data-memo-conflict-resume]").click();
      await blocked.waitForFunction((body) => document.querySelector("#editor").value === body && !document.querySelector("#editor").readOnly, drafts[blockedTab]);
      assert.equal(await blocked.locator("#editor").inputValue(), drafts[blockedTab]);
      // A further real tab commits while the user is comparing/re-editing.
      const third = await newPage(`${origin}/index.html`);
      const newerBody = committed.body + "\nthird-tab-update";
      await third.locator("#editor").fill(newerBody);
      await saved(third, id, newerBody);
      await blocked.locator("[data-memo-conflict-save]").click();
      await blocked.waitForFunction(() => document.querySelector("#browserSaveStatusBtn").dataset.state === "conflict" && document.querySelector("[data-memo-conflict]") && !saveTimer);
      const repeated = await snapshot(blocked);
      assert.equal(repeated.stores.notes.find((note) => note.id === id).body, newerBody);
      assert.ok(repeated.stores["note-conflicts"].filter((row) => row.kind === "memo-conflict-draft").length >= 2);
      result.repeatedConflict = { status: "PASS", snapshot: repeated };
      await blocked.reload({ waitUntil: "commit" }); await appReady(blocked);
      await blocked.locator("[data-memo-conflict-resume]").waitFor({ state: "visible" });
      assert.equal(await blocked.locator("[data-conflict-draft-body]").textContent(), drafts[blockedTab]);
      await blocked.locator("[data-memo-conflict-resume]").click();
      await blocked.waitForFunction((body) => document.querySelector("#editor").value === body && !document.querySelector("#editor").readOnly, drafts[blockedTab]);
      await blocked.locator("[data-memo-conflict-save]").click();
      await saved(blocked, id, drafts[blockedTab]);
      const after = await snapshot(blocked);
      assert.ok(after.stores["note-conflicts"].some((row) => row.kind === "memo-conflict-draft" && row.resolvedAt && row.body === drafts[blockedTab]));
      result.explicitResolution = { status: "PASS", snapshot: after };
    }
    for (const page of pages) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal page overflow");
    }
    logs.forEach(assertClean);
    assert.ok(external.every((url) => new URL(url).hostname === "cdn.jsdelivr.net"));
    return result;
  } catch (error) {
    result.status = "FAIL"; result.error = (timedOut ? "Case watchdog timed out (90s); unreached conditions are NOT_TESTED.\n" : "") + error.stack;
    if (result.evidence) result.evidence.execution.errors.push(error.stack);
    for (const [index, page] of context.pages().entries()) await page.screenshot({ path: path.join(output, `${browserName}-${width}-${order}-${index}-failure.png`), fullPage: true }).catch(() => {});
    return result;
  } finally { clearTimeout(watchdog); await context.close(); }
}

async function regressions(browser, name, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let timedOut = false;
  const watchdog = setTimeout(() => { timedOut = true; void context.close(); }, 90000);
  const result = { browser: name, kind: "normal-save-and-legacy-schema", status: "FAIL", checks: [], logs: [] };
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue()
    : route.fulfill({ status: 200, contentType: route.request().resourceType() === "stylesheet" ? "text/css" : "application/javascript", body: "" }));
  try {
    const first = await context.newPage(); first.setDefaultTimeout(10000); result.logs.push(observe(first));
    await first.goto(`${origin}/storage-guide.html`);
    await first.evaluate(async () => {
      const now = new Date(), key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("memo-nexus", 6);
        request.onupgradeneeded = () => {
          const notes = request.result.createObjectStore("notes", { keyPath: "id" });
          notes.createIndex("updatedAt", "updatedAt"); notes.createIndex("title", "title");
          notes.put({ id: "isolated-legacy-429", title: `${key} 今日メモ`, body: "legacy exact body", tags: [],
            collectionId: "system-unclassified", createdAt: Date.now(), updatedAt: Date.now(), unknownFuture: { nested: ["keep", "日本語"] } });
        };
        request.onsuccess = () => { request.result.close(); resolve(); };
        request.onerror = () => reject(request.error);
      });
    });
    await openApp(first, `${origin}/index.html`);
    assert.equal(await first.evaluate(() => currentId), "isolated-legacy-429");
    const legacyBefore = await snapshot(first);
    assert.equal(await first.evaluate(() => db.version), 7);
    assert.ok(legacyBefore.stores["note-conflicts"]);
    await first.locator("#editor").fill("legacy new exact body\n  日本語\t");
    await saved(first, "isolated-legacy-429", "legacy new exact body\n  日本語\t");
    const legacyAfter = await snapshot(first);
    assert.deepEqual(legacyAfter.stores.notes.find((row) => row.id === "isolated-legacy-429").unknownFuture, { nested: ["keep", "日本語"] });
    result.checks.push({ name: "v6-migration-missing-revision-and-unknown-fields", status: "PASS", before: legacyBefore, after: legacyAfter });
    for (const body of ["sequential-one", "sequential-two", "sequential-three"]) {
      await first.locator("#editor").fill(body); await saved(first, "isolated-legacy-429", body);
    }
    result.checks.push({ name: "single-tab-sequential-normal-save", status: "PASS" });
    const downloadWait = first.waitForEvent("download");
    await first.locator("#backupBtn").click();
    const download = await downloadWait, file = await download.path();
    const zip = await fs.readFile(file);
    assert.equal(zip.subarray(0, 2).toString(), "PK");
    await fs.writeFile(path.join(output, `${name}-isolated-backup.zip`), zip);
    await first.locator("#importMarkdownZipInput").setInputFiles({ name: "isolated429.zip", mimeType: "application/zip", buffer: zip });
    await first.locator("#backupPreviewDialog").waitFor({ state: "visible" });
    result.checks.push({ name: "existing-zip-output-and-import-preview", status: "PASS", bytes: zip.length });
    await first.locator("#cancelBackupPreviewBtn").click();
    const restoredContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await restoredContext.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue()
        : route.fulfill({ status: 200, contentType: route.request().resourceType() === "stylesheet" ? "text/css" : "application/javascript", body: "" }));
      const restored = await restoredContext.newPage(); restored.setDefaultTimeout(10000); result.logs.push(observe(restored));
      await openApp(restored, `${origin}/index.html`);
      await restored.locator("#importMarkdownZipInput").setInputFiles({ name: "isolated429.zip", mimeType: "application/zip", buffer: zip });
      await restored.locator("#confirmBackupPreviewBtn").click();
      await restored.locator("#confirmBackupPreviewBtn").waitFor({ state: "hidden" });
      const imported = await snapshot(restored);
      assert.equal(imported.stores.notes.find((row) => row.id === "isolated-legacy-429").body, "sequential-three");
      result.checks.push({ name: "existing-zip-restored-through-real-preview-confirmation", status: "PASS", snapshot: imported });
    } finally { await restoredContext.close(); }
    await first.locator("#newBtn").click();
    await first.waitForFunction(() => currentId !== "isolated-legacy-429");
    const secondId = await first.evaluate(() => currentId);
    assert.notEqual(secondId, "isolated-legacy-429");
    await first.locator("#editor").fill("other-memo-initial"); await saved(first, secondId, "other-memo-initial");
    const second = await context.newPage(); second.setDefaultTimeout(10000); result.logs.push(observe(second));
    await openApp(second, `${origin}/index.html?popout=isolated-legacy-429`);
    await first.locator("#editor").fill("other-memo-concurrent");
    await second.locator("#editor").fill("legacy-memo-concurrent");
    await saved(first, secondId, "other-memo-concurrent"); await saved(second, "isolated-legacy-429", "legacy-memo-concurrent");
    for (const page of [first, second]) { await page.reload({ waitUntil: "commit" }); await appReady(page); }
    const held = await snapshot(second);
    assert.equal(held.stores.notes.find((row) => row.id === secondId).body, "other-memo-concurrent");
    assert.equal(held.stores.notes.find((row) => row.id === "isolated-legacy-429").body, "legacy-memo-concurrent");
    result.checks.push({ name: "different-notes-concurrent-and-immediate-reload", status: "PASS", snapshot: held });
    const lowerVersion = await second.evaluate(() => new Promise((resolve) => {
      const request = indexedDB.open("memo-nexus", 6);
      request.onerror = () => resolve(request.error.name);
      request.onsuccess = () => { request.result.close(); resolve("unexpected success"); };
    }));
    assert.equal(lowerVersion, "VersionError");
    await second.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("memo-nexus", 8);
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    }));
    assert.equal(await second.evaluate(() => dbConnectionClosedForUpgrade), true);
    assert.equal(await second.locator("#browserSaveStatusBtn").getAttribute("data-state"), "error");
    await second.locator("#appStartupGuard").waitFor({ state: "visible" });
    result.checks.push({ name: "actual-version-error-and-versionchange-close-fail-closed", status: "PASS" });
    result.logs.forEach(assertClean);
    result.status = "PASS";
  } catch (error) { result.error = (timedOut ? "Case watchdog timed out (90s); unreached conditions are NOT_TESTED.\n" : "") + error.stack; }
  finally { clearTimeout(watchdog); await context.close(); }
  return result;
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const root = path.resolve(process.env.MEMO_SAVE_APP_ROOT || __dirname);
  const report = { testedHead: process.env.MEMO_SAVE_SOURCE_HEAD || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    runnerHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim(),
    workingTreeDiff: process.env.MEMO_SAVE_SOURCE_HEAD ? "Archived source bytes must be verified by the legacy-control wrapper" : execFileSync("git", ["diff", "--stat"], { cwd: root, encoding: "utf8" }),
    startedAt: new Date().toISOString(), platform: process.platform, cases: [], mode: process.env.MEMO_SAVE_SMOKE ? "SMOKE" : "FULL",
    expectedCases: (process.env.MEMO_SAVE_BROWSERS || "chromium,webkit").split(",").length * (process.env.MEMO_SAVE_SMOKE ? 1 : 5),
    limitations: ["Real Safari/PWA/long-term durability: UNKNOWN", "Only synthetic data and temporary browser contexts; no real MCP/OAuth/Worker operations"] };
  const server = createServer(root);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const name of (process.env.MEMO_SAVE_BROWSERS || "chromium,webkit").split(",")) {
      let browser;
      try {
        browser = await playwright[name].launch();
        const cases = process.env.MEMO_SAVE_SMOKE ? [{ width: Number(process.env.MEMO_SAVE_SMOKE_WIDTH || 1280), order: "AB" }] : [
          { width: 1280, order: "AB" }, { width: 1280, order: "BA", theme: "dark" },
          { width: 375, order: "AB" }, { width: 390, order: "BA", theme: "dark" }];
        for (const options of cases) report.cases.push(await collision(browser, name, origin, options));
        if (!process.env.MEMO_SAVE_SMOKE) report.cases.push(await regressions(browser, name, origin));
      } catch (error) { report.cases.push({ browser: name, status: "NOT_TESTED", error: error.stack }); }
      finally { await browser?.close(); }
    }
  } finally {
    server.close(); report.finishedAt = new Date().toISOString();
    report.commitOrderCoverage = Object.fromEntries((process.env.MEMO_SAVE_BROWSERS || "chromium,webkit").split(",").map((name) => [name,
      [...new Set(report.cases.filter((item) => item.browser === name && item.winner).map((item) => item.winner))]]));
    const coverageComplete = report.mode === "SMOKE" || Object.values(report.commitOrderCoverage).every((winners) => winners.includes("A") && winners.includes("B"));
    report.status = report.cases.length === report.expectedCases && coverageComplete && report.cases.every((item) => item.status === "PASS") ? "PASS" : "FAIL";
    if (!coverageComplete) report.coverageError = "Both actual commit orders were not observed: untested reverse order cannot pass";
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ head: report.testedHead, status: report.status, cases: report.cases.map(({ browser, width, order, status, error, acceptance }) => ({ browser, width, order, status, error, acceptance: acceptance?.acceptedMethod })) }, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
