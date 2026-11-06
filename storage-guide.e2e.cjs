"use strict";

// Isolated, synthetic data only. No persistent profile, external server or MCP.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const playwright = require("playwright");
const root = __dirname;
const output = process.env.STORAGE_GUIDE_ARTIFACTS
  ? path.resolve(process.env.STORAGE_GUIDE_ARTIFACTS)
  : path.join(root, "docs/ui-storage-guide/browser");
const summary = {
  testedHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  startedAt: new Date().toISOString(),
  playwright: require("playwright/package.json").version,
  platform: process.platform,
  cases: [],
  limitations: ["Real iPhone/Safari/PWA: NOT_TESTED", "Real user data, MCP, OAuth, Worker stop, IDB stop: NOT_TESTED (prohibited)", "External CDN behavior: NOT_TESTED (fulfilled locally in app regression)"],
};

function observe(page) {
  const log = { exceptions: [], consoleErrors: [], failedResponses: [], requests: [] };
  page.on("pageerror", (error) => log.exceptions.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") log.consoleErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) log.failedResponses.push(`${response.status()} ${response.url()}`); });
  page.on("request", (request) => log.requests.push(request.url()));
  return log;
}

function assertClean(log) {
  assert.deepEqual(log.exceptions, []);
  assert.deepEqual(log.consoleErrors, []);
  assert.deepEqual(log.failedResponses, []);
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
    await page.locator("footer a").click();
    assert.equal(new URL(page.url()).hash, "#main");
    await page.screenshot({ path: path.join(output, `${browserName}-${width}-${theme}-${reducedMotion}.png`), fullPage: true });
    assert.deepEqual(await page.evaluate(() => window.__guideCalls), []);
    assert.ok(log.requests.every((url) => ["/storage-guide.html", "/storage-guide.css"].includes(new URL(url).pathname)), "guide requests only HTML/CSS");
    assertClean(log);
    summary.cases.push({ browser: browserName, width, theme, reducedMotion, status: "PASS", layout, focus, storageOrConnectionCalls: [], log });
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
    const id = await page.evaluate(() => currentId);
    await page.locator("#titleInput").fill("隔離試験426");
    await page.locator("#editor").fill("保存ガイド回帰試験・架空のメモのみ");
    // Wait for the real UI autosave path; never force saveCurrentNote().
    await page.waitForFunction(async (noteId) => {
      const note = (await getStoredNotes()).find((n) => n.id === noteId);
      return note?.title === "隔離試験426" && note.body === "保存ガイド回帰試験・架空のメモのみ";
    }, id);
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
    const returnPromise = guide.waitForEvent("popup");
    await guide.getByRole("link", { name: /アプリを開く/ }).click();
    const returned = await returnPromise;
    await returned.waitForLoadState("load");
    assert.equal(new URL(returned.url()).pathname, "/index.html");
    await returned.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await returned.close();
    await guide.close();
    await page.locator("#closeSettingsBtn").click();
    await page.locator("#editor").fill("ガイドを開いた後も保存できる・架空データ426");
    await page.waitForFunction(async (noteId) => (await getStoredNotes()).find((n) => n.id === noteId)?.body === "ガイドを開いた後も保存できる・架空データ426", id);
    await page.reload();
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#editor").inputValue(), "ガイドを開いた後も保存できる・架空データ426");
    assert.equal(await page.locator("#titleInput").inputValue(), "隔離試験426");
    assertClean(log);
    assertClean(guideLog);
    assert.ok(externalFixtures.every((url) => new URL(url).hostname === "cdn.jsdelivr.net"), "no MCP/OAuth or unexpected external request");
    summary.cases.push({ browser: browserName, width, type: "app-save-regression", status: "PASS", unchangedGuideSnapshot: true, saveBeforeAndAfter: true, persistedAfterReload: true, externalFixtures, log, guideLog });
  } finally { await context.close(); }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (request, response) => {
    const relative = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const data = await fs.readFile(file);
      const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" }[path.extname(file)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime }); response.end(data);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
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
  } finally {
    server.close();
    summary.finishedAt = new Date().toISOString();
    summary.status = process.exitCode ? "FAIL" : "PASS";
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify(summary, null, 2) + "\n");
    console.log(JSON.stringify({ status: summary.status, head: summary.testedHead, cases: summary.cases.map(({ browser, width, theme, reducedMotion, type, status, error }) => ({ browser, width, theme, reducedMotion, type, status, error })) }, null, 2));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
