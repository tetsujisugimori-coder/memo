"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const playwright = require("playwright");
const { observe, assertClean, snapshot, createServer, waitForSavedNote } = require("./storage-guide.e2e.cjs");
const { captureState, capturePair, waitForOutcome, exerciseRecovery } = require("./storage-guide-tabs-observer.cjs");
const { evaluateSafety, evaluateTabReport, uiConsistency } = require("./storage-guide-tabs-contract.cjs");
const tabNames = new WeakMap();
const output = path.join(process.env.STORAGE_GUIDE_ARTIFACTS || os.tmpdir(), "multiple-tabs");
const report = { testedHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim(), startedAt: new Date().toISOString(), platform: process.platform, browsers: [], limitations: ["Only the recorded natural autosave schedules are observed; all schedules and real Safari/PWA remain UNKNOWN", "No real profiles, real data, direct save calls, storage reset, modified timers or blocked BroadcastChannel"] };
const expectations = ["Two tabs share one ephemeral context and origin", "Both tabs display the same note", "Single UI writer autosaves", "Clean reader reflects stored content", "Complete method A or B preserves both edits", "Saved UI agrees with storage or explicitly separates conflict drafts", "No warning-only acceptance: rejection, preservation and recovery are proven", "Reload and close/reopen retain the merge or recoverable conflict draft", "Guide leaves storage unchanged", "Fallback uses the same tab"];

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
  return captureState(page, id, tabNames.get(page));
}

async function saved(page, id, body) {
  await waitForSavedNote(page, id, { body });
}

async function appReady(page) {
  await page.locator("#appStartupGuard").waitFor({ state: "attached" });
  await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
  await page.locator("#editor").waitFor({ state: "visible" });
}
async function reloadApp(page) { await page.reload({ waitUntil: "commit" }); await appReady(page); }
async function openApp(page, url) { await page.goto(url, { waitUntil: "commit" }); await appReady(page); }

function check(result, number, expected, actual, passed) {
  result.checks.push({ number, expected, actual, status: typeof passed === "string" ? passed : passed ? "PASS" : "FAIL" });
}

async function runBrowser(browser, name, origin) {
  const { context, external } = await fixtureContext(browser, origin);
  const result = { browser: name, executionStatus: "RUNNING", checks: [], observations: {}, logs: [] };
  let first = await context.newPage();
  let second;
  tabNames.set(first, "A");
  first.setDefaultTimeout(10000);
  result.logs.push(observe(first));
  try {
    await openApp(first, `${origin}/index.html`);
    const id = await first.evaluate(() => currentId);
    await first.locator("#titleInput").fill("複数タブ隔離試験428");
    await first.locator("#editor").fill("lineA=base\nlineB=base");
    await saved(first, id, "lineA=base\nlineB=base");
    second = await context.newPage();
    tabNames.set(second, "B");
    second.setDefaultTimeout(10000);
    result.logs.push(observe(second));
    await openApp(second, `${origin}/index.html`);
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
    result.evidence = { spec: { noteId: id, baselineBody: baseline, baselineRevision: result.observations.sequential[0].stored.revision,
      drafts: { A: "lineA=overlap-A\nlineB=sequential", B: "lineA=single\nlineB=overlap-B" } },
      execution: { completed: false, errors: [] }, observations: { before: result.observations.overlapDirty } };
    const outcome = await waitForOutcome([first, second], id);
    result.evidence.wait = outcome;
    result.observations.overlapSaved = outcome.states;
    result.evidence.observations.terminal = outcome.states;
    if (!["saved", "conflict-stopped"].includes(outcome.kind)) throw new Error(`${outcome.kind}: ${outcome.reason}`);
    check(result, 6, expectations[5], outcome.states, uiConsistency(outcome.states));
    await first.screenshot({ path: path.join(output, `${name}-overlap-first.png`), fullPage: true });
    await second.screenshot({ path: path.join(output, `${name}-overlap-second.png`), fullPage: true });
    await reloadApp(first);
    await reloadApp(second);
    const reloadOutcome = await waitForOutcome([first, second], id);
    result.observations.reloadOutcome = reloadOutcome;
    result.observations.reloaded = await capturePair([first, second], id);
    result.evidence.observations.reloaded = result.observations.reloaded;
    if (!["saved", "conflict-stopped"].includes(reloadOutcome.kind)) throw new Error(`reload ${reloadOutcome.kind}: ${reloadOutcome.reason}`);
    // A session-only or in-memory draft cannot survive this part of the probe.
    await first.close();
    await second.close();
    const reopened = [];
    for (const tab of ["A", "B"]) {
      const page = await context.newPage();
      tabNames.set(page, tab);
      page.setDefaultTimeout(10000);
      result.logs.push(observe(page));
      await openApp(page, `${origin}/index.html`);
      // Startup may select a new Today memo after the original was renamed.
      // Select the same fixture through the real UI; never call openNote/save.
      if (await page.evaluate(() => currentId) !== id) {
        if (!await page.locator("#contextMemoListTab").isVisible()) await page.locator("#collectionsBtn").click();
        await page.locator("#contextMemoListTab").click();
        await page.locator("#memoList .memo-title").filter({ hasText: "複数タブ隔離試験428" }).click();
        await page.waitForFunction((noteId) => currentId === noteId, id);
      }
      reopened.push(page);
    }
    [first, second] = reopened;
    const reopenOutcome = await waitForOutcome(reopened, id);
    result.observations.reopenOutcome = reopenOutcome;
    result.evidence.observations.reopened = await capturePair(reopened, id);
    if (!["saved", "conflict-stopped"].includes(reopenOutcome.kind)) throw new Error(`close/reopen ${reopenOutcome.kind}: ${reopenOutcome.reason}`);
    result.evidence.recovery = await exerciseRecovery(reopened, id, output);

    const direct = await fixtureContext(browser, origin);
    try {
      const page = await direct.context.newPage();
      result.logs.push(observe(page));
      await page.goto(`${origin}/storage-guide.html`);
      await page.locator("footer summary").click();
      await Promise.all([page.waitForURL(`${origin}/index.html`, { waitUntil: "commit" }), page.getByRole("link", { name: "このタブでアプリを開く", exact: true }).click()]);
      await appReady(page);
      check(result, 10, "Direct visitor can navigate in the same tab; closing guide leaves original app tabs", { directPages: direct.context.pages().length, originalPages: context.pages().length }, direct.context.pages().length === 1 && context.pages().length === 2);
      assert.ok(direct.external.every((url) => new URL(url).hostname === "cdn.jsdelivr.net"));
    } finally { await direct.context.close(); }
    result.logs.forEach(assertClean);
    assert.ok(external.every((url) => new URL(url).hostname === "cdn.jsdelivr.net"), "no real external/MCP/OAuth request");
    result.externalFixtures = external;
    result.evidence.execution.completed = true;
    result.executionStatus = "COMPLETED";
    result.acceptance = evaluateSafety(result.evidence);
    for (const number of [5, 7, 8]) check(result, number, expectations[number - 1], result.acceptance, result.acceptance.status);
    result.checks.sort((a, b) => a.number - b.number);
    assert.equal(result.checks.length, 10);
    result.status = result.checks.every((entry) => entry.status === "PASS") ? "PASS" : "FAIL";
  } catch (error) {
    result.status = "FAIL";
    result.executionStatus = "FAILED";
    result.error = error.stack;
    if (result.evidence) result.evidence.execution.errors.push(error.stack);
    expectations.forEach((expected, index) => {
      if (!result.checks.some((entry) => entry.number === index + 1)) result.checks.push({ number: index + 1, expected, actual: "Not reached because execution stopped", status: "UNKNOWN" });
    });
    result.checks.sort((a, b) => a.number - b.number);
    await Promise.allSettled(context.pages().map((page, index) => page.screenshot({ path: path.join(output, `${name}-unexpected-failure-${index}.png`), fullPage: true })));
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
      } catch (error) { report.browsers.push({ browser: name, status: "FAIL", executionStatus: "NOT_TESTED", error: error.stack,
        checks: expectations.map((expected, i) => ({ number: i + 1, expected, status: "UNKNOWN", actual: "Browser execution did not complete" })) }); }
      finally { await browser?.close(); }
    }
  } catch (error) { report.error = error.stack; }
  finally {
    server.close();
    report.finishedAt = new Date().toISOString();
    report.judgement = evaluateTabReport(report);
    report.status = report.judgement.status;
    report.productSafety = report.judgement.productSafety;
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ testedHead: report.testedHead, status: report.status, browsers: report.browsers.map(({ browser, status, error, checks }) => ({ browser, status, error, checks: checks?.map(({ number, status }) => ({ number, status })) })) }, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
