"use strict";
// Experimental, synthetic-only persistence check. Does not replace the original 10 acceptance cases.
// launchPersistentContext.close() ends its browser; a second launch uses the SAME temporary disk profile.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const playwright = require("playwright");
const { createServer, snapshot, openApp, saved, observe, assertClean } = require("./note-conflict-test-support.cjs");
const { capturePair, waitForOutcome } = require("./note-conflict-observer.cjs");
const out = path.resolve(process.env.MEMO_RESTART_OUTPUT || path.join(os.tmpdir(), "memo-process-restart-artifacts"));
const baselineBody = "lineA=single\nlineB=sequential";
const drafts = { A: "lineA=restart-A\nlineB=sequential", B: "lineA=single\nlineB=restart-B" };

async function run(engine, origin) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "memo442-persistent-" + engine + "-"));
  const report = { engine, platform: process.platform, method: "Playwright launchPersistentContext close/relaunch",
    startedAt: new Date().toISOString(), status: "FAIL", completed: [], evidence: {},
    limitations: ["Graceful browser process closure, not crash/power-loss simulation",
      "No OS PID proof or long-duration disk-fsync proof", "Synthetic notes and disposable temporary userDataDir only",
      "Not a real Safari/mobile/device/profile or production-data test"] };
  let context = null;
  const logs = [];
  const launch = () => playwright[engine].launchPersistentContext(profile, {
    headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", acceptDownloads: true
  });
  async function openPage() {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    logs.push(observe(page));
    await openApp(page, origin + "/index.html");
    return page;
  }
  async function routeExternal() {
    await context.route("**/*", (route) => {
      const target = new URL(route.request().url());
      if (target.origin === origin) return route.continue();
      return route.fulfill({ status: 200,
        contentType: route.request().resourceType() === "stylesheet" ? "text/css" : "application/javascript", body: "" });
    });
  }
  try {
    context = await launch();
    await routeExternal();
    const first = await openPage();
    const id = await first.evaluate(() => currentId);
    assert.ok(id, "initial note ID is required");
    await first.locator("#editor").fill("lineA=single\nlineB=base");
    await saved(first, id, "lineA=single\nlineB=base");
    const second = await openPage();
    assert.equal(await second.evaluate(() => currentId), id, "both tabs share note");
    await second.locator("#editor").fill(baselineBody);
    await saved(second, id, baselineBody);
    await first.waitForFunction((body) => document.querySelector("#editor").value === body, baselineBody);
    await first.locator("#editor").fill(drafts.A);
    await second.locator("#editor").fill(drafts.B);
    const before = await capturePair([first, second], id);
    assert.ok(before.every((state) => state.save.dirty && state.stored.body === baselineBody),
      "both independent UI drafts must exist before autosave");
    const outcome = await waitForOutcome([first, second], id);
    assert.equal(outcome.kind, "conflict-stopped", "must observe a real stopped conflict, not a synthetic receipt");
    const stored = outcome.states[0].stored;
    const blocked = stored.body === drafts.A ? "B" : stored.body === drafts.B ? "A" : null;
    assert.ok(blocked, "committed content must be exactly one real draft");
    assert.ok(outcome.states.some((state) => state.conflictUi.visible && state.conflictUi.draftBody === drafts[blocked]),
      "blocked draft must be visible before process stop");
    const prior = await snapshot(first);
    assert.ok(prior.stores["note-conflicts"].some((row) => row.kind === "memo-conflict-draft" && row.body === drafts[blocked]),
      "blocked draft must be durably present before process stop");
    report.evidence.before = { noteId: id, storedBody: stored.body, blockedTab: blocked,
      conflictRecordCount: prior.stores["note-conflicts"].length };
    report.completed.push("real-two-tab-CAS-conflict", "blocked-draft-stored");

    // Closing the owning persistent context closes its browser process, not merely a page.
    await context.close();
    context = null;
    report.completed.push("first-persistent-browser-closed");

    // This is a fresh Playwright browser launch, using the same disposable on-disk profile.
    context = await launch();
    await routeExternal();
    const reopened = await openPage();
    assert.equal(await reopened.evaluate(() => currentId), id);
    const after = await snapshot(reopened);
    assert.equal(after.stores.notes.find((note) => note.id === id)?.body, stored.body,
      "committed note must survive a browser-process stop and restart");
    assert.ok(after.stores["note-conflicts"].some((row) => row.kind === "memo-conflict-draft" && row.body === drafts[blocked]),
      "blocked draft must survive a browser-process stop and restart");
    report.completed.push("second-persistent-browser-launched", "committed-and-blocked-recovered");

    if (!(await reopened.locator("[data-memo-conflict-resume]").isVisible())) {
      const summary = reopened.locator("#noteConflictHost details summary").first();
      await summary.click();
      await reopened.locator("[data-conflict-open]").first().click();
    }
    await reopened.locator("[data-memo-conflict-resume]").waitFor({ state: "visible" });
    assert.equal(await reopened.locator("[data-conflict-draft-body]").textContent(), drafts[blocked]);
    const awaitingDownload = reopened.waitForEvent("download");
    await reopened.locator("[data-memo-conflict-export]").click();
    const download = await awaitingDownload;
    assert.equal(await fs.readFile(await download.path(), "utf8"), drafts[blocked],
      "exported recovery draft must be byte-for-byte preserved");
    report.completed.push("visible-recovery-and-exact-export");
    await reopened.locator("[data-memo-conflict-resume]").click();
    await reopened.waitForFunction((body) => document.querySelector("#editor").value === body &&
      !document.querySelector("#editor").readOnly, drafts[blocked]);
    await reopened.locator("[data-memo-conflict-save]").click();
    await saved(reopened, id, drafts[blocked]);
    const resolved = await snapshot(reopened);
    assert.equal(resolved.stores.notes.find((note) => note.id === id)?.body, drafts[blocked]);
    assert.ok(resolved.stores["note-conflicts"].some((row) =>
      row.kind === "memo-conflict-draft" && row.resolvedAt && row.body === drafts[blocked]));
    logs.forEach(assertClean);
    report.evidence.after = { noteId: id, savedBody: drafts[blocked], conflictRecordCount: resolved.stores["note-conflicts"].length };
    report.completed.push("explicit-re-save-after-restart");
    report.status = "PASS";
  } catch (error) {
    report.error = String(error?.stack || error);
  } finally {
    if (context) await context.close().catch((error) => { report.closeError = String(error); });
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, engine + ".json"), JSON.stringify(report, null, 2) + "\n");
    await fs.rm(profile, { recursive: true, force: true }).catch((error) => {
      report.cleanupError = String(error); console.error("Temporary profile cleanup failed", String(error)); process.exitCode = 1;
    });
  }
  return report;
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const server = createServer(__dirname);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = "http://127.0.0.1:" + server.address().port;
  try {
    const engines = (process.env.MEMO_RESTART_ENGINES || "chromium,webkit").split(",");
    for (const engine of engines) {
      if (!["chromium", "webkit"].includes(engine)) throw new Error("Unsupported engine: " + engine);
      const result = await run(engine, origin);
      console.log(engine + " process restart research: " + result.status + " " + result.completed.join(", "));
      if (result.status !== "PASS") { console.error(result.error); process.exitCode = 1; }
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });