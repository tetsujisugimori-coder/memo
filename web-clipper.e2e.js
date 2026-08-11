/*
 * Run with Playwright's bundled Chromium (not Chrome/Edge):
 *   $env:NODE_PATH = '<directory containing playwright/node_modules>'
 *   node web-clipper.e2e.js
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const root = __dirname;
const artifacts = path.join(root, "e2e-artifacts");
const appUrl = "http://127.0.0.1:5500/";
const articleUrl = "http://127.0.0.1:5500/e2e-source.html";
const marker = "E2E確認用固有文字列: memo-nexus-web-clipper-78";
const selectionText = "選択確認用の段落です。";
const longText = "長文確認用テキスト ".repeat(16000);

function articleHtml() {
  return `<!doctype html><meta charset="utf-8"><title>E2E記事タイトル</title><article><h1>取得元の見出し</h1><p>${selectionText}</p><p>複数段落の二段落目です。${marker}</p><ul><li>リスト項目 一</li><li>リスト項目 二</li></ul><p><a href="https://example.test/reference">確認用リンク</a></p><p>${longText}</p></article>`;
}

function server() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, appUrl);
    if (url.pathname === "/e2e-source.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(articleHtml());
    }
    if (url.pathname === "/no-ack.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end("<!doctype html><script>window.transferEvents=0;window.timeoutSeen=false;window.addEventListener('message',e=>{if(e.data&&e.data.type==='memo-nexus-web-clip-transfer')window.transferEvents++;if(e.data&&e.data.code==='timeout')window.timeoutSeen=true});</script><p>ACKなし受信先</p>");
    }
    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^[/\\]+/, "");
    const file = path.resolve(root, relative);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404); return response.end("not found");
    }
    const mime = file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream";
    response.writeHead(200, { "content-type": `${mime}; charset=utf-8` });
    response.end(fs.readFileSync(file));
  });
}

async function storage(worker, key) {
  return worker.evaluate(async (keyName) => (await chrome.storage.local.get(keyName))[keyName], key);
}

async function setStorage(worker, key, value) {
  await worker.evaluate(async ({ keyName, item }) => chrome.storage.local.set({ [keyName]: item }), { keyName: key, item: value });
}

async function waitForWorker(context) {
  return context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
}

async function openPopup(context, worker, extensionId) {
  // Create the actual extension popup document as an inactive tab. This keeps
  // the source article as Chrome's active tab while popup.js reads it.
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const popupPromise = context.waitForEvent("page", { timeout: 10000, predicate: page => page.url().startsWith(popupUrl) });
  await worker.evaluate(async (url) => new Promise((resolve) => chrome.tabs.create({ url, active: false }, resolve)), popupUrl);
  const popup = await popupPromise;
  try {
    await popup.locator("#send:not([disabled])").waitFor({ timeout: 5000 });
  } catch (cause) {
    throw new Error(`popup did not become ready: status=${await popup.locator("#selectionStatus").textContent()} error=${await popup.locator("#error").textContent()} (${cause.message})`);
  }
  return popup;
}

async function waitForClipPage(context, before) {
  const page = await context.waitForEvent("page", { timeout: 10000, predicate: candidate => !before.has(candidate) });
  await page.waitForLoadState("domcontentloaded");
  await page.locator("#webClipDialog[open]").waitFor();
  return page;
}

async function capture(context, worker, extensionId, mode) {
  const before = new Set(context.pages());
  const popup = await openPopup(context, worker, extensionId);
  await popup.selectOption("#clipMode", mode);
  if (mode === "memo") await popup.locator("#userMemo").fill("E2Eメモ: あとで確認");
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (tab?.id) await chrome.tabs.update(tab.id, { active: true });
  }, articleUrl);
  await Promise.all([waitForClipPage(context, before), popup.locator("#send").click()]);
  const receiver = context.pages().find((page) => !before.has(page) && page.url().startsWith(appUrl));
  assert(receiver, "Memo-Nexus confirmation page was not opened");
  await receiver.locator("#webClipDialog[open]").waitFor();
  return { popup, receiver };
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const httpServer = server();
  await new Promise((resolve) => httpServer.listen(5500, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "memo-nexus-web-clipper-"));
  let context;
  try {
    const extension = path.join(root, "extensions", "web-clipper");
    context = await chromium.launchPersistentContext(profile, {
      // Chromium's extension Service Worker is not started in its headless
      // shell, so use the bundled full Chromium in a persistent context.
      headless: false,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    const worker = await waitForWorker(context);
    const extensionId = new URL(worker.url()).host;
    assert.match(extensionId, /^[a-p]{32}$/, "extension ID must come from its actual Service Worker URL");
    console.log(`Playwright bundled Chromium: ${chromium.executablePath()}`);
    console.log(`Loaded extension Service Worker ID: ${extensionId}`);

    const source = await context.newPage();
    await source.goto(articleUrl);
    await source.evaluate((text) => {
      const node = [...document.querySelectorAll("p")].find((item) => item.textContent.includes(text)).firstChild;
      const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, selectionText);

    for (const mode of ["selection", "link", "memo"]) {
      const { popup, receiver } = await capture(context, worker, extensionId, mode);
      assert.equal(await receiver.locator("#webClipMode").inputValue(), mode);
      assert.equal(await receiver.locator("#webClipTitle").inputValue(), "E2E記事タイトル");
      assert.equal(await receiver.locator("#webClipUrl").inputValue(), articleUrl);
      if (mode === "link") assert.equal(await receiver.locator("#webClipSelection").inputValue(), "");
      else assert.match(await receiver.locator("#webClipSelection").inputValue(), new RegExp(selectionText));
      if (mode === "memo") assert.equal(await receiver.locator("#webClipUserMemo").inputValue(), "E2Eメモ: あとで確認");
      await popup.close(); await receiver.close();
    }

    // Suppress the app's first ACKs to exercise actual transfer retries and
    // duplicate receipt. The pending entry must remain until an ACK is sent.
    await context.addInitScript(() => {
      const post = window.postMessage.bind(window);
      window.__memoNexusOriginalPostMessage = post;
      window.__memoNexusBlockedAcks = 0;
      window.postMessage = (message, targetOrigin, transfer) => {
        if (message?.type === "memo-nexus-web-clip-transfer-ack") { window.__memoNexusBlockedAcks++; window.__memoNexusTransferId = message.transferId; return; }
        return post(message, targetOrigin, transfer);
      };
    });
    const { popup, receiver } = await capture(context, worker, extensionId, "page");
    await receiver.waitForFunction(() => window.__memoNexusBlockedAcks >= 2, null, { timeout: 5000 });
    const transferId = await receiver.evaluate(() => window.__memoNexusTransferId);
    const transferKey = `memoNexusTransfer:${transferId}`;
    assert(await storage(worker, transferKey), "storage.local entry was removed before ACK");
    assert.doesNotMatch(await receiver.locator("#webClipReceivedStatus").textContent(), /ページ本文を受信しています。/);
    const body = await receiver.locator("#webClipSelection").inputValue();
    assert.match(body, /# 取得元の見出し/);
    assert.match(body, new RegExp(marker));
    assert.match(body, /- リスト項目 一/);
    assert.match(body, /\[確認用リンク\]\(https:\/\/example\.test\/reference\)/);
    assert(body.length > 100000, "long article was not transferred");
    await receiver.screenshot({ path: path.join(artifacts, "web-clipper-page-transfer.png"), fullPage: true });
    await receiver.evaluate(() => window.__memoNexusOriginalPostMessage({ type: "memo-nexus-web-clip-transfer-ack", transferId: window.__memoNexusTransferId }, location.origin));
    await receiver.waitForTimeout(250);
    assert.equal(await storage(worker, transferKey), undefined, "storage.local entry remains after ACK");
    await popup.close(); await receiver.close();

    // A real content script on a local receiver page retries without ACK and
    // eventually emits its timeout message; the entry is deliberately retained.
    const timeoutId = crypto.randomUUID();
    const timeoutKey = `memoNexusTransfer:${timeoutId}`;
    await setStorage(worker, timeoutKey, { clip: { title: "timeout", url: articleUrl, host: "127.0.0.1", selection: "timeout", clipMode: "page", capturedAt: new Date().toISOString() }, createdAt: Date.now() });
    const noAck = await context.newPage();
    await noAck.goto(`${appUrl}no-ack.html#clip-transfer=${timeoutId}`);
    await noAck.waitForFunction(() => window.transferEvents >= 2, null, { timeout: 5000 });
    assert(await storage(worker, timeoutKey), "storage.local entry was removed without ACK");
    await noAck.waitForFunction(() => window.timeoutSeen === true, null, { timeout: 14000 });
    assert(await storage(worker, timeoutKey), "timeout must not delete storage.local entry");
    await noAck.screenshot({ path: path.join(artifacts, "web-clipper-timeout.png"), fullPage: true });
    console.log("PASS: selection, link, memo, page transfer, retry/duplicate, ACK lifecycle, timeout, and long article");
  } finally {
    if (context) await context.close();
    await new Promise((resolve) => httpServer.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
