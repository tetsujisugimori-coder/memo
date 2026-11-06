"use strict";

// Isolated, synthetic data only. No persistent profile, external server or MCP.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const playwright = require("playwright");
const root = __dirname;
const output = process.env.STORAGE_GUIDE_ARTIFACTS
  ? path.resolve(process.env.STORAGE_GUIDE_ARTIFACTS)
  : path.join(os.tmpdir(), `memo-storage-guide-${Date.now()}`);
const summary = {
  testedHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  startedAt: new Date().toISOString(),
  playwright: require("playwright/package.json").version,
  platform: process.platform,
  cases: [],
  limitations: ["Real iPhone/Safari/PWA: NOT_TESTED", "Real user data, MCP, OAuth, Worker stop, IDB stop: NOT_TESTED (prohibited)", "External CDN behavior: NOT_TESTED (fulfilled locally in app regression)"],
};

function observe(page) {
  const log = { exceptions: [], consoleErrors: [], failedResponses: [], failedRequests: [], requests: [] };
  page.on("pageerror", (error) => log.exceptions.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") log.consoleErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) log.failedResponses.push(`${response.status()} ${response.url()}`); });
  page.on("request", (request) => log.requests.push(request.url()));
  page.on("requestfailed", (request) => log.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  return log;
}

function assertClean(log) {
  assert.deepEqual(log.exceptions, []);
  assert.deepEqual(log.consoleErrors, []);
  assert.deepEqual(log.failedResponses, []);
  assert.deepEqual(log.failedRequests, []);
}

async function saveFailure(page, name, error, log) {
  await Promise.allSettled([
    page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }),
    fs.writeFile(path.join(output, `${name}-failure.json`), JSON.stringify({ error: error.stack, url: page.url(), log }, null, 2) + "\n"),
  ]);
}

async function inspectLayout(page) {
  return page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    background: getComputedStyle(document.body).backgroundColor,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    motion: [...document.querySelectorAll("*")].filter((el) => {
      const s = getComputedStyle(el);
      return s.animationName !== "none" || s.transitionDuration.split(",").some((d) => parseFloat(d) > 0);
    }).length,
  }));
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const stores = [...db.objectStoreNames];
    const entries = await Promise.all(stores.map((name) => new Promise((resolve, reject) => {
      const tx = db.transaction(name, "readonly");
      const request = tx.objectStore(name).getAll();
      tx.oncomplete = () => resolve([name, request.result]);
      tx.onabort = () => reject(tx.error);
    })));
    return { stores: Object.fromEntries(entries), local: { ...localStorage }, session: { ...sessionStorage } };
  });
}

async function waitForSavedNote(page, noteId, expected, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let observed;
  do {
    observed = await page.evaluate(async (id) => ({
      note: (await getStoredNotes()).find((item) => item.id === id),
      dirty: noteSaveFoundation.isDirty(id),
      badge: document.querySelector("#browserSaveStatusBtn").dataset.state,
    }), noteId);
    if (observed.note && !observed.dirty && observed.badge === "saved"
      && Object.entries(expected).every(([key, value]) => observed.note[key] === value)) return observed;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`Saved note did not match within ${timeout}ms: ${JSON.stringify({ expected, observed })}`);
}

async function guideCase(browser, origin, browserName, width, theme, reducedMotion) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const log = observe(page);
  // Probe access, not only writes, so a future script cannot silently enter storage/connection code.
  await page.addInitScript(() => {
    window.__guideCalls = [];
    for (const method of ["open", "deleteDatabase", "databases"]) {
      if (typeof IDBFactory.prototype[method] === "function") {
        IDBFactory.prototype[method] = function () { window.__guideCalls.push(`idb:${method}`); throw new Error("Guide accessed IndexedDB"); };
      }
    }
    for (const name of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(window, name, { get() { window.__guideCalls.push(name); throw new Error("Guide accessed storage"); } });
    }
    for (const name of ["fetch", "Worker", "SharedWorker", "WebSocket", "EventSource", "XMLHttpRequest"]) {
      window[name] = function () { window.__guideCalls.push(name); throw new Error("Guide accessed connection API"); };
    }
  });
  try {
    await page.goto(`${origin}/storage-guide.html`);
    assert.equal(await page.locator("script, iframe, form, input, button").count(), 0);
    for (const id of ["storage", "backup", "restore", "check"]) {
      assert.equal(await page.locator(`nav a[href='#${id}']`).count(), 1, `guide anchor #${id} missing`);
    }
    assert.match(await page.locator("#return-guidance").textContent(), /タブを閉じて元のアプリタブへ戻って/);
    assert.equal(await page.locator("a[target='_blank']").count(), 0, "guide must not spawn another app tab");
    const layout = await inspectLayout(page);
    assert.ok(layout.scrollWidth <= width, "guide horizontal overflow");
    assert.equal(layout.reducedMotion, reducedMotion === "reduce");
    assert.equal(layout.motion, 0);
    assert.equal(layout.background, theme === "dark" ? "rgb(17, 26, 22)" : "rgb(246, 247, 244)");
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").textContent(), "本文へ移動");
    const focus = await page.locator(":focus").evaluate((el) => ({ style: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth, top: el.getBoundingClientRect().top }));
    assert.equal(focus.style, "solid");
    assert.equal(focus.width, "3px");
    assert.ok(focus.top >= 0);
    await page.screenshot({ path: path.join(output, `${browserName}-${width}-${theme}-${reducedMotion}-focus.png`) });
    await page.keyboard.press("Enter");
    assert.equal(new URL(page.url()).hash, "#main");
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").getAttribute("href"), "#storage");
    for (const id of ["storage", "backup", "restore", "check"]) {
      const link = page.locator(`nav a[href='#${id}']`);
      await link.focus();
      await page.keyboard.press("Enter");
      assert.equal(new URL(page.url()).hash, `#${id}`);
      const y = await page.locator(`#${id}`).evaluate((el) => el.getBoundingClientRect().top);
      assert.ok(y >= -1 && y < 900, `anchor ${id} visible`);
    }
    await page.locator("footer a[href='#main']").click();
    assert.equal(new URL(page.url()).hash, "#main");
    await page.screenshot({ path: path.join(output, `${browserName}-${width}-${theme}-${reducedMotion}.png`), fullPage: true });
    assert.deepEqual(await page.evaluate(() => window.__guideCalls), []);
    assert.ok(log.requests.every((url) => new URL(url).origin === origin && ["/storage-guide.html", "/storage-guide.css"].includes(new URL(url).pathname)), "guide requests only local HTML/CSS");
    assertClean(log);
    summary.cases.push({ browser: browserName, width, theme, reducedMotion, status: "PASS", layout, focus, storageOrConnectionCalls: [], log });
  } catch (error) {
    await saveFailure(page, `${browserName}-${width}-${theme}-${reducedMotion}`, error, log);
    throw error;
  } finally { await context.close(); }
}

async function appCase(browser, origin, browserName, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const externalFixtures = [];
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    externalFixtures.push(route.request().url());
    // App third-party display assets are unnecessary for plain-text fixture saving.
    return route.fulfill({ status: 200, contentType: route.request().resourceType() === "stylesheet" ? "text/css" : "application/javascript", body: "" });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const log = observe(page);
  try {
    await page.goto(`${origin}/index.html`);
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    if (width === 390 && await page.locator("#contextPanel").getAttribute("aria-hidden") === "false") {
      await page.locator("#closeContextPanelBtn").click();
      await page.locator("#contextPanel").waitFor({ state: "hidden" });
    }
    const id = await page.evaluate(() => currentId);
    await page.locator("#titleInput").fill("隔離試験426");
    await page.locator("#editor").fill("保存ガイド回帰試験・架空のメモのみ");
    // Wait for the real UI autosave path; never force saveCurrentNote().
    await waitForSavedNote(page, id, { title: "隔離試験426", body: "保存ガイド回帰試験・架空のメモのみ" });
    if (width === 390) {
      if (await page.locator("#mobileWritingDoneBtn").isVisible()) await page.locator("#mobileWritingDoneBtn").click();
      if (await page.locator("#mobileAppMenu").getAttribute("open") === null) await page.locator("#mobileAppMenu > summary").click();
    }
    await page.locator("#settingsBtn").click();
    const entry = page.locator("#settingsDialog a[href='storage-guide.html']");
    await entry.scrollIntoViewIfNeeded();
    await page.keyboard.press("Tab");
    await entry.focus();
    assert.ok(await entry.evaluate((el) => getComputedStyle(el).outlineStyle !== "none"), "settings link keyboard focus visible");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `${browserName}-${width}-settings.png`) });
    const before = await snapshot(page);
    const popupPromise = page.waitForEvent("popup");
    await page.keyboard.press("Enter");
    const guide = await popupPromise;
    const guideLog = observe(guide);
    await guide.waitForLoadState("load");
    assert.equal(new URL(guide.url()).pathname, "/storage-guide.html");
    assert.equal(await guide.evaluate(() => window.opener), null);
    await guide.locator("nav a[href='#backup']").click();
    assert.deepEqual(await snapshot(page), before, "all IDB stores and browser settings unchanged while reading guide");
    const pageCount = context.pages().length;
    assert.equal(pageCount, 2, "only original app and guide are open");
    await guide.locator("footer summary").click();
    const appEntry = guide.getByRole("link", { name: "このタブでアプリを開く", exact: true });
    assert.equal(await appEntry.getAttribute("target"), null);
    await Promise.all([guide.waitForURL(`${origin}/index.html`), appEntry.click()]);
    await guide.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.equal(context.pages().length, pageCount, "direct-entry fallback navigates within guide tab");
    await guide.close();
    assert.equal(context.pages().length, 1, "closing guide leaves original app tab");
    await page.locator("#closeSettingsBtn").click();
    await page.locator("#editor").fill("ガイドを開いた後も保存できる・架空データ426");
    await waitForSavedNote(page, id, { body: "ガイドを開いた後も保存できる・架空データ426" });
    await page.reload();
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#editor").inputValue(), "ガイドを開いた後も保存できる・架空データ426");
    assert.equal(await page.locator("#titleInput").inputValue(), "隔離試験426");
    assertClean(log);
    assertClean(guideLog);
    assert.ok(externalFixtures.every((url) => new URL(url).hostname === "cdn.jsdelivr.net"), "no MCP/OAuth or unexpected external request");
    summary.cases.push({ browser: browserName, width, type: "app-save-regression", status: "PASS", unchangedGuideSnapshot: true, saveBeforeAndAfter: true, persistedAfterReload: true, sameTabFallback: true, appTabsAddedByFallback: 0, externalFixtures, log, guideLog });
  } catch (error) {
    await saveFailure(page, `${browserName}-${width}-app`, error, log);
    throw error;
  } finally { await context.close(); }
}

function createServer(servedRoot = root) {
  return http.createServer(async (request, response) => {
    const relative = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(servedRoot, relative);
    if (!file.startsWith(servedRoot + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const data = await fs.readFile(file);
      const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" }[path.extname(file)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime }); response.end(data);
    } catch { response.writeHead(404).end(); }
  });
}

async function runGuideSuite() {
  await fs.mkdir(output, { recursive: true });
  // Negative controls use a disposable static root; the runner itself stays fixed.
  const server = createServer(process.env.STORAGE_GUIDE_FIXTURE_ROOT || root);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const name of ["chromium", "webkit"]) {
      let browser;
      try {
        browser = await playwright[name].launch({ headless: true });
        for (const width of [1280, 390]) {
          for (const theme of ["light", "dark"]) {
            for (const motion of ["no-preference", "reduce"]) await guideCase(browser, origin, name, width, theme, motion);
          }
          await appCase(browser, origin, name, width);
        }
      } catch (error) {
        summary.cases.push({ browser: name, status: "FAIL", error: error.stack });
        process.exitCode = 1;
      } finally { await browser?.close(); }
    }
  } catch (error) {
    summary.cases.push({ type: "suite", status: "FAIL", error: error.stack });
    process.exitCode = 1;
  } finally {
    server.close();
    summary.finishedAt = new Date().toISOString();
    summary.expectedCases = 20;
    summary.status = !process.exitCode && summary.cases.length === 20 && summary.cases.every((entry) => entry.status === "PASS") ? "PASS" : "FAIL";
    if (summary.status !== "PASS") process.exitCode = 1;
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify(summary, null, 2) + "\n");
    console.log(JSON.stringify({ status: summary.status, head: summary.testedHead, cases: summary.cases.map(({ browser, width, theme, reducedMotion, type, status, error }) => ({ browser, width, theme, reducedMotion, type, status, error })) }, null, 2));
  }
}

module.exports = { observe, assertClean, snapshot, createServer, waitForSavedNote };
if (require.main === module) runGuideSuite().catch((error) => { console.error(error); process.exitCode = 1; });
