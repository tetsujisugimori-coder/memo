"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const playwright = require("playwright");
const { observe, assertClean, snapshot, createServer } = require("./storage-guide.e2e.cjs");
const output = path.join(process.env.STORAGE_GUIDE_ARTIFACTS || os.tmpdir(), "multiple-tabs");
const report = { testedHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim(), startedAt: new Date().toISOString(), platform: process.platform, browsers: [], limitations: ["Only the recorded natural autosave schedules are observed; all schedules and real Safari/PWA remain UNKNOWN", "No real profiles, real data, direct save calls, storage reset, modified timers or blocked BroadcastChannel"] };

async function fixtureContext(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const external = [];
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url());
    return route.fulfill({ status: 200, contentType: route.request().resourceType() === "stylesheet" ? "text/css" : "application/javascript", body: "" });
  });
  return { context, external };
}

async function state(page, id) {
  return page.evaluate(async (noteId) => ({
    at: Date.now(),
    currentId,
    title: document.querySelector("#titleInput").value,
    editor: document.querySelector("#editor").value,
    stored: (await getStoredNotes()).find((note) => note.id === noteId),
    save: noteSaveFoundation.getState(noteId),
    badge: document.querySelector("#browserSaveStatusBtn").textContent,
    badgeState: document.querySelector("#browserSaveStatusBtn").dataset.state,
    pending: pendingMemoSync,
    notice: saveStatusNotice,
    messages: window.__observedMessages || [],
  }), id);
}

async function saved(page, id, body) {
  await page.waitForFunction(async ({ noteId, expected }) => {
    const note = (await getStoredNotes()).find((item) => item.id === noteId);
    return note?.body === expected && !noteSaveFoundation.isDirty(noteId) && document.querySelector("#browserSaveStatusBtn").dataset.state === "saved";
  }, { noteId: id, expected: body }, { timeout: 10000 });
}

function check(result, number, expected, actual, passed) {
  result.checks.push({ number, expected, actual, status: passed ? "PASS" : "FAIL" });
}

async function runBrowser(browser, name, origin) {
  const { context, external } = await fixtureContext(browser, origin);
  const result = { browser: name, checks: [], observations: {}, logs: [] };
  const first = await context.newPage();
  first.setDefaultTimeout(10000);
  result.logs.push(observe(first));
  try {
    await first.goto(`${origin}/index.html`);
    await first.locator("#appStartupGuard").waitFor({ state: "hidden" });
    const id = await first.evaluate(() => currentId);
    await first.locator("#titleInput").fill("複数タブ隔離試験428");
    await first.locator("#editor").fill("lineA=base\nlineB=base");
    await saved(first, id, "lineA=base\nlineB=base");
    const second = await context.newPage();
    second.setDefaultTimeout(10000);
    result.logs.push(observe(second));
    await second.goto(`${origin}/index.html`);
    await second.locator("#appStartupGuard").waitFor({ state: "hidden" });
    check(result, 1, "Two tabs share one ephemeral context and origin", { pages: context.pages().length, origins: [new URL(first.url()).origin, new URL(second.url()).origin] }, context.pages().length === 2);
    const secondId = await second.evaluate(() => currentId);
    check(result, 2, "Both UI tabs display the same synthetic note", { firstId: id, secondId, body: await second.locator("#editor").inputValue() }, secondId === id && await second.locator("#editor").inputValue() === "lineA=base\nlineB=base");
    assert.equal(secondId, id, "collision precondition: same memo ID");
    for (const page of [first, second]) await page.evaluate(() => {
      window.__observedMessages = [];
      memoSyncChannel?.addEventListener("message", (event) => window.__observedMessages.push({ at: Date.now(), message: event.data }));
    });
    await first.locator("#editor").fill("lineA=single\nlineB=base");
    await saved(first, id, "lineA=single\nlineB=base");
    result.observations.singleWriter = await state(first, id);
    check(result, 3, "Single writer saves through normal UI autosave", result.observations.singleWriter, result.observations.singleWriter.stored.body === "lineA=single\nlineB=base");
    await second.waitForFunction(() => document.querySelector("#editor").value === "lineA=single\nlineB=base");
    const singleReader = await state(second, id);
    check(result, 4, "Clean second tab reflects stored content and saved state", singleReader, singleReader.editor === singleReader.stored.body && singleReader.badgeState === "saved");

    // Sequential edits first establish that ordinary cross-tab notifications work.
    await second.locator("#editor").fill("lineA=single\nlineB=sequential");
    await saved(second, id, "lineA=single\nlineB=sequential");
    await first.waitForFunction(() => document.querySelector("#editor").value === "lineA=single\nlineB=sequential");
    result.observations.sequential = [await state(first, id), await state(second, id)];

    const before = [await snapshot(first), await snapshot(second)];
    await first.locator("#settingsBtn").click();
    const opened = first.waitForEvent("popup");
    await first.locator("a.storage-guide-link").click();
    const guide = await opened;
    result.logs.push(observe(guide));
    await guide.waitForLoadState("load");
    await guide.locator("nav a[href='#backup']").click();
    const unchanged = JSON.stringify([await snapshot(first), await snapshot(second)]) === JSON.stringify(before);
    check(result, 9, "Reading guide changes no IDB store/localStorage/sessionStorage in either app tab", { unchanged, appTabs: context.pages().filter((page) => new URL(page.url()).pathname === "/index.html").length }, unchanged);
    assert.match(await guide.locator("#return-guidance").textContent(), /タブを閉じて元のアプリタブへ戻って/);
    assert.equal(await guide.locator("a[target='_blank']").count(), 0);
    await guide.close();
    await first.locator("#closeSettingsBtn").click();

    // Each tab edits a DIFFERENT line from the same baseline before the natural
    // 280ms autosave. No save function, timer, IDB writer or channel is replaced.
    const baseline = "lineA=single\nlineB=sequential";
    assert.equal(await first.locator("#editor").inputValue(), baseline);
    assert.equal(await second.locator("#editor").inputValue(), baseline);
    await first.locator("#editor").fill("lineA=overlap-A\nlineB=sequential");
    await second.locator("#editor").fill("lineA=single\nlineB=overlap-B");
    result.observations.overlapDirty = [await state(first, id), await state(second, id)];
    assert.ok(result.observations.overlapDirty.every((item) => item.save.dirty), "collision precondition: both UI drafts dirty before autosave");
    await Promise.all([first, second].map((page) => page.waitForFunction((noteId) => !noteSaveFoundation.isDirty(noteId), id)));
    // Observation window for already-completed saves/queued notifications, not a save delay.
    await first.waitForTimeout(500);
    result.observations.overlapSaved = [await state(first, id), await state(second, id)];
    const bothEdits = (body) => body.includes("lineA=overlap-A") && body.includes("lineB=overlap-B");
    const merged = result.observations.overlapSaved.every((item) => bothEdits(item.stored.body));
    check(result, 5, "Staggered overlapping drafts preserve both independent edits or stop with a visible conflict", { baseline, before: result.observations.overlapDirty, after: result.observations.overlapSaved }, merged);
    const consistent = result.observations.overlapSaved.every((item) => item.editor === item.stored.body);
    check(result, 6, "Saved UI content agrees with the stored record in both tabs", result.observations.overlapSaved.map(({ editor, stored, badge, pending }) => ({ editor, stored, badge, pending })), consistent);
    // A silent pending flag is not a visible warning, nor does it prevent a stale write.
    check(result, 7, "Both edits survive; otherwise existing protection must visibly warn or block overwrite", { bothEditsPreserved: merged, notices: result.observations.overlapSaved.map((item) => item.notice), pending: result.observations.overlapSaved.map((item) => item.pending), dirty: result.observations.overlapSaved.map((item) => item.save.dirty) }, merged);
    await first.screenshot({ path: path.join(output, `${name}-overlap-first.png`), fullPage: true });
    await second.screenshot({ path: path.join(output, `${name}-overlap-second.png`), fullPage: true });
    await first.reload();
    await first.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await second.reload();
    await second.locator("#appStartupGuard").waitFor({ state: "hidden" });
    result.observations.reloaded = [await state(first, id), await state(second, id)];
    check(result, 8, "Reload keeps both edits and displays the persisted record", result.observations.reloaded, result.observations.reloaded.every((item) => bothEdits(item.stored.body) && item.editor === item.stored.body));

    const direct = await fixtureContext(browser, origin);
    try {
      const page = await direct.context.newPage();
      result.logs.push(observe(page));
      await page.goto(`${origin}/storage-guide.html`);
      await page.locator("footer summary").click();
      await Promise.all([page.waitForURL(`${origin}/index.html`), page.getByRole("link", { name: "このタブでアプリを開く", exact: true }).click()]);
      await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
      check(result, 10, "Direct visitor can navigate in the same tab; closing guide leaves original app tabs", { directPages: direct.context.pages().length, originalPages: context.pages().length }, direct.context.pages().length === 1 && context.pages().length === 2);
      assert.ok(direct.external.every((url) => new URL(url).hostname === "cdn.jsdelivr.net"));
    } finally { await direct.context.close(); }
    result.logs.forEach(assertClean);
    assert.ok(external.every((url) => new URL(url).hostname === "cdn.jsdelivr.net"), "no real external/MCP/OAuth request");
    result.externalFixtures = external;
    result.checks.sort((a, b) => a.number - b.number);
    assert.equal(result.checks.length, 10);
    result.status = result.checks.every((entry) => entry.status === "PASS") ? "PASS" : "FAIL";
  } catch (error) {
    result.status = "FAIL";
    result.error = error.stack;
    await first.screenshot({ path: path.join(output, `${name}-unexpected-failure.png`), fullPage: true }).catch(() => {});
  } finally { await context.close(); }
  return result;
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const name of ["chromium", "webkit"]) {
      let browser;
      try {
        browser = await playwright[name].launch();
        report.browsers.push(await runBrowser(browser, name, origin));
      } catch (error) { report.browsers.push({ browser: name, status: "FAIL", error: error.stack }); }
      finally { await browser?.close(); }
    }
  } catch (error) { report.error = error.stack; }
  finally {
    server.close();
    report.status = !report.error && report.browsers.length === 2 && report.browsers.every((item) => item.status === "PASS") ? "PASS" : "FAIL";
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
