/*
 * Run with an installed Edge channel:
 *   $env:NODE_PATH = '<directory containing playwright/node_modules>'
 *   $env:MEMO_NEXUS_E2E_CHANNEL = 'msedge'
 *   node web-clipper.e2e.js
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { chromium } = require("playwright");

const root = __dirname;
const artifacts = path.join(root, "e2e-artifacts");
const appUrl = "http://127.0.0.1:5500/";
const articleUrl = "http://127.0.0.1:5500/e2e-source.html";
const fixtureAssetUrl = "http://assets.memo-nexus.test:5500/";
const cdnBaseUrl = "http://cdn.memo-nexus.test:5501/";
const cdnUrl = `${cdnBaseUrl}cdn-image.png`;
const marker = "E2E確認用固有文字列: memo-nexus-web-clipper-78";
const selectionText = "選択確認用の段落です。";
const longText = "長文確認用テキスト ".repeat(16000);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0); name.copy(chunk, 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return chunk;
}

function pngImage(red, green, blue) {
  const width = 160; const height = 120;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4); raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 4;
      raw[pixel] = red; raw[pixel + 1] = green; raw[pixel + 2] = blue; raw[pixel + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

const localImage = pngImage(208, 62, 62);
const cdnImage = pngImage(55, 112, 210);
const animatedGif = Buffer.from("R0lGODlhZAAyAPAAAAD/AAAAACH5BAABAAAAIf8LTkVUU0NBUEUyLjADAQAAACwAAAAAZAAyAAACTYSPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kzX9o3n+s73/g8MCofEovGITCqXzKbzCY1Kp9Sq9YrNarfcrvcLDovH5LL5bCsAACH5BAAQJwAALAAAAABkADIAgP8AAAAAAAJNhI+py+0Po5y02ouz3rz7D4biSJbmiabqyrbuC8fyTNf2jef6zvf+DwwKh8Si8YhMKpfMpvMJjUqn1Kr1is1qt9yu9wsOi8fksvlsKwAAOw==", "base64");
const avifImage = Buffer.from(fs.readFileSync(path.join(root, "extensions", "web-clipper", "test-fixtures", "colors-sdr-srgb.avif.b64"), "utf8").replace(/\s+/g, ""), "base64");
const svgImage = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><script>fetch("http://127.0.0.1:5501/svg-script-called")</script><image href="http://127.0.0.1:5501/svg-external" width="10" height="10"/><rect width="160" height="120" fill="#d33"/><text x="12" y="65" fill="white">SVG</text></svg>');
const generatedRaster = { jpeg: Buffer.alloc(0), webp: Buffer.alloc(0) };
const browserChannel = String(process.env.MEMO_NEXUS_E2E_CHANNEL || "").trim();
let unsafeSvgRequests = 0;
let developmentManifestRequests = 0;
let developmentManifestUnavailable = false;
let appScriptDelayMs = 0;

function articleHtml() {
  const decorativeSvg = Array.from({ length: 25 }, (_, index) => `<img class="share-icon" src="${appUrl}safe.svg?icon=${index}" alt="共有アイコン" width="160" height="120">`).join("");
  return `<!doctype html><meta charset="utf-8"><title>E2E記事タイトル</title><article><h1>取得元の見出し</h1><p>${selectionText}</p>${decorativeSvg}<figure><img src="${cdnBaseUrl}redirect-image?asset=photo" alt="クロスオリジンJPEG" width="160" height="120"><figcaption>リダイレクトJPEGの説明</figcaption></figure><p>画像間の段落です。${marker}</p><figure><img src="${cdnUrl}?version=2" alt="CDN PNG" width="160" height="120"><figcaption>CDN画像の説明</figcaption></figure><img src="${fixtureAssetUrl}local-image.webp?format=webp" alt="WebP画像" width="160" height="120"><figure><img src="${fixtureAssetUrl}animated.gif" alt="アニメーションGIF" width="100" height="50"><figcaption>アニメーション図版</figcaption></figure><img src="${fixtureAssetUrl}safe.svg" alt="SVG画像" width="160" height="120"><img src="${fixtureAssetUrl}sample.avif" alt="AVIF画像" width="160" height="120"><img src="${cdnBaseUrl}missing.png" alt="取得失敗画像" width="160" height="120"><img src="${cdnBaseUrl}slow-image?timeout=1" alt="タイムアウト画像" width="160" height="120"><img class="site-logo" src="${fixtureAssetUrl}local-image.png" alt="ロゴ" width="160" height="120"><img src="${cdnUrl}?version=2" alt="重複画像" width="160" height="120"><img src="${fixtureAssetUrl}local-image.png" alt="追跡ピクセル" width="1" height="1"><ul><li>リスト項目 一</li><li>リスト項目 二</li></ul><p><a href="https://example.test/reference">確認用リンク</a></p><p>${longText}</p></article>`;
}

function server() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, appUrl);
    if (url.pathname === "/e2e-source.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(articleHtml());
    }
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      return response.end();
    }
    if (url.pathname === "/local-image.png") {
      response.writeHead(200, { "content-type": "image/png", "content-length": localImage.length });
      return response.end(localImage);
    }
    if (url.pathname === "/local-image.jpg") {
      response.writeHead(200, { "content-type": "image/jpeg", "content-length": generatedRaster.jpeg.length });
      return response.end(generatedRaster.jpeg);
    }
    if (url.pathname === "/local-image.webp") {
      response.writeHead(200, { "content-type": "image/webp", "content-length": generatedRaster.webp.length });
      return response.end(generatedRaster.webp);
    }
    if (url.pathname === "/animated.gif") {
      response.writeHead(200, { "content-type": "image/gif", "content-length": animatedGif.length });
      return response.end(animatedGif);
    }
    if (url.pathname === "/safe.svg") {
      response.writeHead(200, { "content-type": "image/svg+xml", "content-length": svgImage.length });
      return response.end(svgImage);
    }
    if (url.pathname === "/sample.avif") {
      response.writeHead(200, { "content-type": "image/avif", "content-length": avifImage.length });
      return response.end(avifImage);
    }
    if (url.pathname === "/extensions/web-clipper/manifest.json") {
      developmentManifestRequests += 1;
      if (developmentManifestUnavailable) {
        response.writeHead(503, { "content-type": "application/json" });
        return response.end('{"error":"development server unavailable"}');
      }
    }
    if (url.pathname === "/no-ack.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end("<!doctype html><script>window.transferEvents=0;window.timeoutSeen=false;window.addEventListener('message',e=>{const m=e.data||{};if(m.type==='memo-nexus-web-clip-content-ready')window.postMessage({type:'memo-nexus-web-clip-receiver-ready',transferId:m.transferId},location.origin);if(m.type==='memo-nexus-web-clip-transfer')window.transferEvents++;if(m.type==='memo-nexus-web-clip-transfer-error'&&m.code==='ack_timeout')window.timeoutSeen=true});</script><p>ACKなし受信先</p>");
    }
    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^[/\\]+/, "");
    const file = path.resolve(root, relative);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404); return response.end("not found");
    }
    const mime = file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream";
    const finish = () => {
      if (response.destroyed) return;
      response.writeHead(200, { "content-type": `${mime}; charset=utf-8` });
      response.end(fs.readFileSync(file));
    };
    if (url.pathname === "/app.js" && appScriptDelayMs > 0) {
      const delay = appScriptDelayMs;
      appScriptDelayMs = 0;
      setTimeout(finish, delay);
      return;
    }
    finish();
  });
}

function cdnServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1:5501/");
    if (url.pathname === "/redirect-image") {
      response.writeHead(302, { location: "/cdn-image.jpg?resolved=1" });
      return response.end();
    }
    if (url.pathname === "/redirect-chain/2") {
      response.writeHead(302, { location: "/redirect-chain/1" });
      return response.end();
    }
    if (url.pathname === "/redirect-chain/1") {
      response.writeHead(302, { location: "/cdn-image.png?chain=complete" });
      return response.end();
    }
    if (url.pathname === "/cdn-image.jpg") {
      response.writeHead(200, { "content-type": "image/jpeg", "content-length": generatedRaster.jpeg.length });
      return response.end(generatedRaster.jpeg);
    }
    if (url.pathname === "/cdn-image.png") {
      response.writeHead(200, { "content-type": "application/octet-stream", "content-length": cdnImage.length });
      return response.end(cdnImage);
    }
    if (url.pathname === "/slow-image") {
      setTimeout(() => { if (!response.destroyed) { response.writeHead(200, { "content-type": "image/png" }); response.end(cdnImage); } }, 17000);
      return;
    }
    if (url.pathname === "/svg-script-called" || url.pathname === "/svg-external") {
      unsafeSvgRequests += 1;
      response.writeHead(200, { "content-type": "image/png" });
      return response.end(cdnImage);
    }
    response.writeHead(404, { "content-type": "text/plain" }); response.end("missing");
  });
}

async function storage(worker, key) {
  return worker.evaluate(async (keyName) => (await chrome.storage.local.get(keyName))[keyName], key);
}

async function setStorage(worker, key, value) {
  await worker.evaluate(async ({ keyName, item }) => chrome.storage.local.set({ [keyName]: item }), { keyName: key, item: value });
}

async function waitForStorageRemoval(worker, key, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await storage(worker, key) === undefined) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`storage.local entry was not removed after ACK: ${key}`);
}

async function transferKeys(worker) {
  return worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((key) => key.startsWith("memoNexusTransfer:")).sort());
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
    assert.equal(await popup.locator("#extensionVersion").textContent(), "0.3.8");
  } catch (cause) {
    throw new Error(`popup did not become ready: status=${await popup.locator("#selectionStatus").textContent()} error=${await popup.locator("#error").textContent()} (${cause.message})`);
  }
  return popup;
}

async function waitForClipPage(context, before) {
  const page = await context.waitForEvent("page", { timeout: 40000, predicate: candidate => !before.has(candidate) });
  await page.waitForLoadState("domcontentloaded");
  await page.locator("#webClipDialog[open]").waitFor();
  return page;
}

async function capture(context, worker, extensionId, mode) {
  const before = new Set(context.pages());
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (tab?.id) await chrome.tabs.update(tab.id, { active: true });
  }, articleUrl);
  const popup = await openPopup(context, worker, extensionId);
  await popup.selectOption("#clipMode", mode);
  if (mode === "memo") await popup.locator("#userMemo").fill("E2Eメモ: あとで確認");
  const receiverPromise = waitForClipPage(context, before);
  await popup.locator("#send").click();
  try { await receiverPromise; }
  catch (cause) {
    const diagnostics = popup.isClosed() ? "popup closed" : `modeStatus=${await popup.locator("#modeStatus").textContent()} error=${await popup.locator("#error").textContent()}`;
    throw new Error(`clip receiver did not open: ${diagnostics} (${cause.message})`);
  }
  const receiver = context.pages().find((page) => !before.has(page) && page.url().startsWith(appUrl));
  assert(receiver, "Memo-Nexus confirmation page was not opened");
  await receiver.locator("#webClipDialog[open]").waitFor();
  return { popup, receiver };
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const httpServer = server();
  const imageServer = cdnServer();
  await new Promise((resolve) => httpServer.listen(5500, "127.0.0.1", resolve));
  await new Promise((resolve) => imageServer.listen(5501, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "memo-nexus-web-clipper-"));
  let context;
  const appConsoleErrors = [];
  const appPageErrors = [];
  const expectedConsoleErrorPages = new WeakSet();
  try {
    const extension = path.join(root, "extensions", "web-clipper");
    context = await chromium.launchPersistentContext(profile, {
      ...(browserChannel ? { channel: browserChannel } : {}),
      // Chromium extension Service Workers are not started in the headless
      // shell, so use a full visible browser in a persistent context.
      headless: false,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        "--host-resolver-rules=MAP assets.memo-nexus.test 127.0.0.1, MAP cdn.memo-nexus.test 127.0.0.1"
      ]
    });
    context.on("page", (page) => {
      page.on("console", (message) => {
        const isAppPage = (() => { try { const url = new URL(page.url()); return url.origin === new URL(appUrl).origin && url.pathname === "/"; } catch (_) { return false; } })();
        if (message.type() === "error" && isAppPage && !(expectedConsoleErrorPages.has(page) && message.text().startsWith("Web clip save failed"))) appConsoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => {
        const isAppPage = (() => { try { const url = new URL(page.url()); return url.origin === new URL(appUrl).origin && url.pathname === "/"; } catch (_) { return false; } })();
        if (isAppPage) appPageErrors.push(error.message);
      });
    });
    let worker = await waitForWorker(context);
    const extensionId = new URL(worker.url()).host;
    assert.match(extensionId, /^[a-p]{32}$/, "extension ID must come from its actual Service Worker URL");
    console.log(browserChannel ? `Playwright browser channel: ${browserChannel}` : `Playwright bundled Chromium: ${chromium.executablePath()}`);
    console.log(`Loaded extension Service Worker ID: ${extensionId}`);

    const fixturePage = await context.newPage();
    const rasterUrls = await fixturePage.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 120;
      const context2d = canvas.getContext("2d"); context2d.fillStyle = "#2864c7"; context2d.fillRect(0, 0, canvas.width, canvas.height);
      return { jpeg: canvas.toDataURL("image/jpeg", 0.9), webp: canvas.toDataURL("image/webp", 0.9) };
    });
    generatedRaster.jpeg = Buffer.from(rasterUrls.jpeg.split(",")[1], "base64");
    generatedRaster.webp = Buffer.from(rasterUrls.webp.split(",")[1], "base64");
    assert(generatedRaster.jpeg.length > 0 && generatedRaster.webp.length > 0, "browser raster fixtures were not generated");
    await fixturePage.close();

    const source = await context.newPage();
    await source.goto(articleUrl);
    await source.evaluate((text) => {
      const node = [...document.querySelectorAll("p")].find((item) => item.textContent.includes(text)).firstChild;
      const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, selectionText);

    developmentManifestUnavailable = true;
    const offlineDevelopmentPopup = await openPopup(context, worker, extensionId);
    assert.match(await offlineDevelopmentPopup.locator("#updateStatus").textContent(), /更新確認を省略しました。クリップ機能は通常どおり利用できます/);
    developmentManifestUnavailable = false;
    await offlineDevelopmentPopup.close();

    const activeCleanupId = crypto.randomUUID();
    const activeCleanupKey = `memoNexusTransfer:${activeCleanupId}`;
    const expiredCleanupKey = `memoNexusTransfer:${crypto.randomUUID()}`;
    const cleanupClip = { title: "清掃確認", url: articleUrl, host: "127.0.0.1", selection: "本文", clipMode: "page", capturedAt: new Date().toISOString() };
    await setStorage(worker, activeCleanupKey, { clip: cleanupClip, createdAt: Date.now() });
    await setStorage(worker, expiredCleanupKey, { clip: cleanupClip, createdAt: Date.now() - 10 * 60 * 1000 - 1 });
    const cleanupPopup = await openPopup(context, worker, extensionId);
    assert.equal(await storage(worker, expiredCleanupKey), undefined, "expired transfer was not cleaned during update check");
    assert(await storage(worker, activeCleanupKey), "active transfer was removed during stale cleanup");
    await worker.evaluate(async (key) => chrome.storage.local.remove(key), activeCleanupKey);
    await cleanupPopup.close();

    const targetPopup = await openPopup(context, worker, extensionId);
    assert.equal(await targetPopup.locator("#environmentStatus").textContent(), "接続先: 開発環境／ローカル開発版・更新確認あり");
    await targetPopup.selectOption("#target", "production");
    await targetPopup.waitForFunction(() => document.querySelector("#environmentStatus")?.textContent === "接続先: 本番環境／ローカル開発版");
    const manifestRequestsBeforeProductionReopen = developmentManifestRequests;
    await targetPopup.close();
    const persistedTargetPopup = await openPopup(context, worker, extensionId);
    assert.equal(await persistedTargetPopup.locator("#target").inputValue(), "production");
    assert.equal(await persistedTargetPopup.locator("#environmentStatus").textContent(), "接続先: 本番環境／ローカル開発版");
    assert.equal(developmentManifestRequests, manifestRequestsBeforeProductionReopen, "production popup contacted the development manifest");
    await persistedTargetPopup.selectOption("#target", "development");
    await persistedTargetPopup.waitForFunction(() => document.querySelector("#environmentStatus")?.textContent === "接続先: 開発環境／ローカル開発版・更新確認あり");
    await persistedTargetPopup.close();

    for (const mode of ["selection", "link", "memo"]) {
      const { popup, receiver } = await capture(context, worker, extensionId, mode);
      assert.equal(new URL(receiver.url()).searchParams.has("web-clip"), false, "one-time launch marker remained in the URL");
      assert.equal(new URL(receiver.url()).hash, "", "clip payload remained in the URL");
      assert.equal(await receiver.locator("#webClipMode").inputValue(), mode);
      assert.equal(await receiver.locator("#webClipTitle").inputValue(), "E2E記事タイトル");
      assert.equal(await receiver.locator("#webClipUrl").inputValue(), articleUrl);
      if (mode === "link") assert.equal(await receiver.locator("#webClipSelection").inputValue(), "");
      else assert.match(await receiver.locator("#webClipSelection").inputValue(), new RegExp(selectionText));
      if (mode === "memo") assert.equal(await receiver.locator("#webClipUserMemo").inputValue(), "E2Eメモ: あとで確認");
      if (mode === "link") {
        await receiver.locator("#cancelWebClipBtn").click();
        await receiver.reload();
        assert.equal(await receiver.locator("#webClipDialog").getAttribute("open"), null, "web clip dialog reopened after marker consumption");
      }
      if (!popup.isClosed()) await popup.close(); await receiver.close();
    }

    await source.bringToFront();
    const failedOpenPopup = await openPopup(context, worker, extensionId);
    await failedOpenPopup.selectOption("#clipMode", "page");
    const transferKeysBeforeOpenFailure = await transferKeys(worker);
    const openStubbed = await failedOpenPopup.evaluate(() => {
      Object.defineProperty(window, "open", { configurable: true, value: () => null });
      return window.open("about:blank") === null;
    });
    assert.equal(openStubbed, true, "window.open failure could not be simulated");
    await failedOpenPopup.locator("#send").click();
    await failedOpenPopup.locator("#error:not(:empty)").waitFor({ timeout: 30000 });
    assert.ok((await failedOpenPopup.locator("#error").textContent()).trim(), "window.open failure did not show an error");
    assert.deepEqual(await transferKeys(worker), transferKeysBeforeOpenFailure, "window.open failure left its transfer entry");
    await failedOpenPopup.close();

    const invalidLaunch = await context.newPage();
    await invalidLaunch.goto(`${appUrl}?foo=bar&web-clip=1&web-clip=2#clip=invalid`);
    await invalidLaunch.locator("#webClipDialog[open]").waitFor();
    assert.equal(invalidLaunch.url(), `${appUrl}?foo=bar`, "failed clip receipt did not consume only the launch marker");
    assert.match(await invalidLaunch.locator("#webClipReceivedStatus").textContent(), /クリップデータを読み取れませんでした/);
    await invalidLaunch.locator("#cancelWebClipBtn").click();
    await invalidLaunch.reload();
    assert.equal(await invalidLaunch.locator("#webClipDialog").getAttribute("open"), null, "failed clip dialog reopened after reload");
    await invalidLaunch.close();

    const cdp = await context.newCDPSession(source);
    const targets = await cdp.send("Target.getTargets");
    const workerTarget = targets.targetInfos.find((targetInfo) => targetInfo.type === "service_worker" && targetInfo.url.includes(extensionId));
    assert(workerTarget, "extension Service Worker target was not found");
    await cdp.send("Target.closeTarget", { targetId: workerTarget.targetId });
    const restartPage = await context.newPage();
    await restartPage.goto(`chrome-extension://${extensionId}/popup.html`);
    const restartResponse = await restartPage.evaluate((url) => new Promise((resolve) => chrome.runtime.sendMessage({
      type: "memo-nexus-fetch-clip-image", requestId: crypto.randomUUID(),
      candidate: { token: "web-clip-image-1", url }, options: { timeoutMs: 3000 }
    }, (response) => resolve({ response, error: chrome.runtime.lastError?.message || "" }))), `${fixtureAssetUrl}local-image.jpg`);
    assert.equal(restartResponse.error, "", `Service Worker restart message failed: ${restartResponse.error}`);
    assert.equal(restartResponse.response?.images?.[0]?.status, "ready", "Service Worker did not fetch after restart");
    for (const [label, imageUrl] of [
      ["direct image", `${cdnBaseUrl}cdn-image.png?direct=1`],
      ["single redirect image", `${cdnBaseUrl}redirect-image?asset=single`],
      ["multiple redirect image", `${cdnBaseUrl}redirect-chain/2`]
    ]) {
      const result = await restartPage.evaluate(({ url, name }) => new Promise((resolve) => chrome.runtime.sendMessage({
        type: "memo-nexus-fetch-clip-image",
        requestId: crypto.randomUUID(),
        candidate: { token: `web-clip-image-${name.length}`, url },
        options: { timeoutMs: 3000 }
      }, resolve)), { url: imageUrl, name: label });
      const fetchedImage = result?.images?.[0];
      assert.equal(fetchedImage?.status, "ready", `${label} was not fetched by the MV3 Service Worker: ${JSON.stringify({ status: fetchedImage?.status, errorCode: fetchedImage?.errorCode, error: fetchedImage?.error })}`);
    }
    worker = restartPage;
    await source.bringToFront();
    assert.equal(new URL(worker.url()).host, extensionId, "extension ID changed after Service Worker restart");

    const delayedTransferId = crypto.randomUUID();
    const delayedTransferKey = `memoNexusTransfer:${delayedTransferId}`;
    const delayedRecord = {
      createdAt: Date.now(),
      clip: { title: "15秒遅延転送", url: `${articleUrl}?delayed=1`, host: "127.0.0.1", selection: "15秒を超えて保持された本文", clipMode: "page", capturedAt: new Date().toISOString(), extensionVersion: "0.3.8", manifestVersion: 3 }
    };
    await setStorage(worker, delayedTransferKey, delayedRecord);
    appScriptDelayMs = 15_500;
    const delayedReceiver = await context.newPage();
    const delayedNavigation = delayedReceiver.goto(`${appUrl}?web-clip=1#clip-transfer=${delayedTransferId}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await delayedReceiver.waitForTimeout(13_000);
    assert(await storage(worker, delayedTransferKey), "15秒の受信準備待ち中に転送レコードが削除された");
    await delayedNavigation;
    await delayedReceiver.locator("#webClipDialog[open]").waitFor({ timeout: 20000 });
    assert.equal(await delayedReceiver.locator("#webClipTitle").inputValue(), delayedRecord.clip.title);
    assert.equal(await delayedReceiver.locator("#webClipSelection").inputValue(), delayedRecord.clip.selection);
    await waitForStorageRemoval(worker, delayedTransferKey);
    await delayedReceiver.close();

    await context.addInitScript(() => {
      const params = new URLSearchParams(location.search);
      const blockKey = "memoNexusE2EFirstAckBlocked";
      if (!params.has("e2e-block-first-transfer-ack") || sessionStorage.getItem(blockKey)) return;
      const post = window.postMessage.bind(window);
      window.postMessage = (message, targetOrigin, transfer) => {
        if (message?.type === "memo-nexus-web-clip-transfer-ack") {
          sessionStorage.setItem(blockKey, "1");
          return;
        }
        return post(message, targetOrigin, transfer);
      };
    });
    const reloadTransferId = crypto.randomUUID();
    const reloadTransferKey = `memoNexusTransfer:${reloadTransferId}`;
    const reloadRecord = {
      createdAt: Date.now(),
      clip: { title: "再読込転送", url: `${articleUrl}?reload=1`, host: "127.0.0.1", selection: "再読込後に復元する本文", clipMode: "page", capturedAt: new Date().toISOString() }
    };
    await setStorage(worker, reloadTransferKey, reloadRecord);
    const reloadReceiver = await context.newPage();
    await reloadReceiver.goto(`${appUrl}?web-clip=1&e2e-block-first-transfer-ack=1#clip-transfer=${reloadTransferId}`);
    await reloadReceiver.locator("#webClipDialog[open]").waitFor();
    assert.equal(await reloadReceiver.locator("#webClipTitle").inputValue(), reloadRecord.clip.title);
    assert(await storage(worker, reloadTransferKey), "ACKを遮断したのに転送レコードが削除された");
    await reloadReceiver.reload();
    await reloadReceiver.locator("#webClipDialog[open]").waitFor();
    assert.equal(await reloadReceiver.locator("#webClipSelection").inputValue(), reloadRecord.clip.selection);
    await waitForStorageRemoval(worker, reloadTransferKey);
    await reloadReceiver.close();

    const missingTransferId = crypto.randomUUID();
    const missingTransferKey = `memoNexusTransfer:${missingTransferId}`;
    const recoveredRecord = {
      createdAt: Date.now(),
      clip: { title: "欠落後の再受信", url: `${articleUrl}?recovered=1`, host: "127.0.0.1", selection: "失敗後に受信した本文", clipMode: "page", capturedAt: new Date().toISOString() }
    };
    const missingReceiver = await context.newPage();
    await missingReceiver.goto(`${appUrl}?web-clip=1#clip-transfer=${missingTransferId}`);
    await missingReceiver.locator("#webClipReceiveActions:visible").waitFor();
    assert.match(await missingReceiver.locator("#webClipReceivedStatus").textContent(), /\[record_missing\]/);
    assert.equal(await missingReceiver.locator("#saveWebClipBtn").isDisabled(), true);
    await setStorage(worker, missingTransferKey, recoveredRecord);
    await missingReceiver.locator("#retryWebClipTransferBtn").click();
    await missingReceiver.waitForFunction(() => document.getElementById("webClipTitle")?.value === "欠落後の再受信");
    await waitForStorageRemoval(worker, missingTransferKey);
    await missingReceiver.locator("#webClipTitle").fill("ユーザーが変更した題名");
    await missingReceiver.evaluate(({ transferId, record }) => window.postMessage({ type: "memo-nexus-web-clip-transfer", transferId, record }, location.origin), { transferId: missingTransferId, record: recoveredRecord });
    await missingReceiver.waitForTimeout(150);
    assert.equal(await missingReceiver.locator("#webClipTitle").inputValue(), "ユーザーが変更した題名", "重複payloadが確認画面を初期化した");
    await missingReceiver.close();

    const expiredTransferId = crypto.randomUUID();
    const expiredTransferKey = `memoNexusTransfer:${expiredTransferId}`;
    await setStorage(worker, expiredTransferKey, { ...recoveredRecord, createdAt: Date.now() - 10 * 60 * 1000 - 1 });
    const expiredReceiver = await context.newPage();
    await expiredReceiver.goto(`${appUrl}?web-clip=1#clip-transfer=${expiredTransferId}`);
    await expiredReceiver.locator("#webClipReceiveActions:visible").waitFor();
    assert.match(await expiredReceiver.locator("#webClipReceivedStatus").textContent(), /\[transfer_expired\]/);
    assert.equal(await storage(worker, expiredTransferKey), undefined, "期限切れの対象レコードが清掃されなかった");
    await expiredReceiver.close();

    const firstTabId = crypto.randomUUID();
    const secondTabId = crypto.randomUUID();
    const firstTabKey = `memoNexusTransfer:${firstTabId}`;
    const secondTabKey = `memoNexusTransfer:${secondTabId}`;
    const firstTabRecord = { ...recoveredRecord, createdAt: Date.now(), clip: { ...recoveredRecord.clip, title: "複数タブ一件目", url: `${articleUrl}?tab=1` } };
    const secondTabRecord = { ...recoveredRecord, createdAt: Date.now(), clip: { ...recoveredRecord.clip, title: "複数タブ二件目", url: `${articleUrl}?tab=2` } };
    await setStorage(worker, firstTabKey, firstTabRecord);
    await setStorage(worker, secondTabKey, secondTabRecord);
    const firstTab = await context.newPage();
    const secondTab = await context.newPage();
    await Promise.all([
      firstTab.goto(`${appUrl}?web-clip=1#clip-transfer=${firstTabId}`),
      secondTab.goto(`${appUrl}?web-clip=1#clip-transfer=${secondTabId}`)
    ]);
    await Promise.all([firstTab.locator("#webClipDialog[open]").waitFor(), secondTab.locator("#webClipDialog[open]").waitFor()]);
    assert.equal(await firstTab.locator("#webClipTitle").inputValue(), "複数タブ一件目");
    assert.equal(await secondTab.locator("#webClipTitle").inputValue(), "複数タブ二件目");
    await Promise.all([waitForStorageRemoval(worker, firstTabKey), waitForStorageRemoval(worker, secondTabKey)]);
    await firstTab.close();
    await secondTab.close();

    const missingContentId = crypto.randomUUID();
    const plainBrowser = await chromium.launch({ ...(browserChannel ? { channel: browserChannel } : {}), headless: true });
    try {
      const missingContentReceiver = await plainBrowser.newPage();
      await missingContentReceiver.goto(`${appUrl}?web-clip=1#clip-transfer=${missingContentId}`);
      await missingContentReceiver.locator("#webClipReceiveActions:visible").waitFor({ timeout: 12000 });
      assert.match(await missingContentReceiver.locator("#webClipReceivedStatus").textContent(), /\[content_script_missing\]/);
      assert.equal(await missingContentReceiver.locator("#saveWebClipBtn").isDisabled(), true);
    } finally {
      await plainBrowser.close();
    }

    const rejectedOriginPage = await context.newPage();
    await rejectedOriginPage.goto(appUrl);
    await rejectedOriginPage.waitForFunction(() => document.getElementById("titleInput") && !document.getElementById("appStartupGuard")?.open);
    await rejectedOriginPage.evaluate((clip) => {
      window.dispatchEvent(new MessageEvent("message", { source: window, origin: "chrome-extension://opejammnohhbjflpbhmmdlknhjkhfhdp", data: { type: "memo-nexus-web-clip", clip } }));
    }, recoveredRecord.clip);
    await rejectedOriginPage.waitForTimeout(150);
    assert.equal(await rejectedOriginPage.locator("#webClipDialog").getAttribute("open"), null, "削除したOriginのlegacyメッセージを受理した");
    await rejectedOriginPage.close();

    const transferKeysBeforePageClip = await transferKeys(worker);
    const { popup, receiver } = await capture(context, worker, extensionId, "page");
    await receiver.waitForFunction(() => !/受信しています|受信確認を完了しています/.test(document.getElementById("webClipReceivedStatus")?.textContent || ""));
    assert.deepEqual(await transferKeys(worker), transferKeysBeforePageClip, "ACK後にページ全文の転送レコードが残った");
    const body = await receiver.locator("#webClipSelection").inputValue();
    assert.match(body, /# 取得元の見出し/);
    assert.match(body, new RegExp(marker));
    assert.match(body, /- リスト項目 一/);
    assert.match(body, /\[確認用リンク\]\(https:\/\/example\.test\/reference\)/);
    assert(body.length > 100000, "long article was not transferred");
    await receiver.locator("#webClipImagesSummary").waitFor({ state: "visible" });
    console.log("Image cards:", await receiver.locator(".web-clip-image-card").allTextContents());
    assert.match(await receiver.locator("#webClipImagesSummary").textContent(), /候補8件のうち、保存可能6件・選択6件/);
    const imageCards = receiver.locator(".web-clip-image-card");
    assert.equal(await imageCards.count(), 8);
    assert.equal(await receiver.locator('.web-clip-image-card.status-ready input[type="checkbox"]:enabled').count(), 6);
    assert.equal(await receiver.locator(".web-clip-image-card.status-failed").count(), 1);
    assert.equal(await receiver.locator(".web-clip-image-card.status-timeout").count(), 1);
    assert.match(await imageCards.nth(0).textContent(), /image\/jpeg \/ \d+ B/);
    assert.match(await imageCards.nth(1).textContent(), /image\/png \/ \d+ B/);
    assert.match(await receiver.locator("#webClipImagesList").textContent(), /image\/webp/);
    assert.match(await receiver.locator("#webClipImagesList").textContent(), /image\/gif/);
    assert.doesNotMatch(await receiver.locator("#webClipImagesList").textContent(), /取得…|取得中/);
    assert.match(await receiver.locator("#webClipImagesList").textContent(), /タイムアウト \[TIMEOUT\]/);
    assert.equal(unsafeSvgRequests, 0, "sanitized SVG executed a script or loaded an external image");
    await receiver.screenshot({ path: path.join(artifacts, "web-clipper-page-transfer.png"), fullPage: true });
    const initialSaveState = await receiver.evaluate(() => ({
      disabled: document.getElementById("saveWebClipBtn").disabled,
      formValid: document.getElementById("webClipForm").checkValidity(),
      validationMessage: [...document.getElementById("webClipForm").elements].find((element) => !element.checkValidity?.())?.validationMessage || ""
    }));
    assert.deepEqual(initialSaveState, { disabled: false, formValid: true, validationMessage: "" }, "initial Web Clip save was not available");
    await receiver.locator("#saveWebClipBtn").click();
    await receiver.waitForFunction(() => !document.getElementById("webClipDialog").open);
    assert.equal(await receiver.evaluate(() => document.getElementById("attachmentCount")?.textContent || ""), "6件");
    const savedBody = await receiver.locator("#editor").inputValue();
    assert.match(savedBody, /attachment:\/\//);
    assert.match(savedBody, /画像を保存できませんでした: 取得失敗画像/);
    const savedClipSource = await receiver.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("memo-nexus");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const all = request.result.transaction("notes").objectStore("notes").getAll();
        all.onerror = () => reject(all.error);
        all.onsuccess = () => resolve(all.result.find((note) => note.source?.type === "web-clip" && note.source?.clipMode === "page")?.source || null);
      };
    }));
    assert.deepEqual({
      extensionVersion: savedClipSource?.extensionVersion,
      manifestVersion: savedClipSource?.manifestVersion,
      targetEnvironment: savedClipSource?.targetEnvironment,
      distributionChannel: savedClipSource?.distributionChannel
    }, { extensionVersion: "0.3.8", manifestVersion: 3, targetEnvironment: "development", distributionChannel: "unpacked-development" });
    const storedAttachments = await receiver.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("memo-nexus");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const all = request.result.transaction("attachments").objectStore("attachments").getAll();
        all.onerror = () => reject(all.error);
        all.onsuccess = async () => resolve(await Promise.all(all.result.map(async (attachment) => ({
          mimeType: attachment.mimeType,
          source: attachment.source,
          bytes: Array.from(new Uint8Array(await attachment.blob.arrayBuffer()))
        }))));
      };
    }));
    assert.equal(storedAttachments.length, 6, "selected images were not saved to IndexedDB");
    assert.deepEqual(new Set(storedAttachments.map((attachment) => attachment.mimeType)), new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]));
    const gifAttachment = storedAttachments.find((attachment) => attachment.mimeType === "image/gif");
    assert.deepEqual(Buffer.from(gifAttachment.bytes), animatedGif, "animated GIF bytes were changed");
    assert(gifAttachment.bytes.filter((byte) => byte === 0x2c).length >= 2, "GIF fixture does not contain multiple frames");
    const convertedSources = storedAttachments.filter((attachment) => attachment.source?.converted).map((attachment) => attachment.source?.sourceMimeType).sort();
    assert.deepEqual(convertedSources, ["image/avif", "image/svg+xml"]);
    await receiver.locator(".image-block img").first().waitFor({ state: "visible" });
    assert.equal(await receiver.locator(".image-block img").count(), 6);
    assert.equal(await receiver.locator("#attachmentCount").textContent(), "6件");
    assert.match(await receiver.locator("#editor").inputValue(), /attachment:\/\//);

    const originalClip = await receiver.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("memo-nexus");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(["notes", "attachments"], "readwrite");
        const noteStore = transaction.objectStore("notes");
        const getNotes = noteStore.getAll();
        getNotes.onerror = () => reject(getNotes.error);
        getNotes.onsuccess = () => {
          const note = getNotes.result.find((item) => item.source?.type === "web-clip" && item.source?.clipMode === "page");
          note.isFlagged = true;
          note.reclipTestMetadata = { keep: "yes" };
          noteStore.put(note);
          const attachments = transaction.objectStore("attachments").index("memoId").getAll(note.id);
          attachments.onsuccess = () => resolve({ id: note.id, collectionId: note.collectionId, oldAttachmentIds: attachments.result.map((item) => item.id) });
        };
      };
    }));
    const replacementId = crypto.randomUUID();
    await setStorage(worker, `memoNexusTransfer:${replacementId}`, {
      createdAt: Date.now(),
      clip: {
        title: "再クリップ更新", url: `${articleUrl}#reclip`, host: "127.0.0.1", clipMode: "page", capturedAt: new Date().toISOString(),
      selection: "新しい本文\n\n<!-- memo-nexus:web-clip-image:web-clip-image-1 -->",
        images: [{ token: "web-clip-image-1", url: `${appUrl}local-image.png`, alt: "新しい画像", caption: "", status: "ready", mimeType: "image/png", size: localImage.length, fileName: "replacement.png", dataBase64: localImage.toString("base64"), selected: true }]
      }
    });
    const replacementReceiver = await context.newPage();
    await replacementReceiver.goto(`${appUrl}#clip-transfer=${replacementId}`);
    await replacementReceiver.locator("#webClipDialog[open]").waitFor();
    assert.equal(await replacementReceiver.locator('input[name="webClipSaveMode"][value="update"]').isChecked(), true);
    await replacementReceiver.locator("#saveWebClipBtn").click();
    await replacementReceiver.locator("#webClipDialog").waitFor({ state: "hidden" });
    const replacementResult = await replacementReceiver.evaluate(({ oldIds, existingId }) => new Promise((resolve, reject) => {
      const request = indexedDB.open("memo-nexus");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(["notes", "attachments"]);
        const notesRequest = transaction.objectStore("notes").getAll();
        const attachmentsRequest = transaction.objectStore("attachments").getAll();
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => {
          const note = notesRequest.result.find((item) => item.id === existingId) || notesRequest.result.find((item) => item.reclipTestMetadata?.keep === "yes");
          resolve({ note, attachments: attachmentsRequest.result.map((item) => item.id), oldIds });
        };
      };
    }), { oldIds: originalClip.oldAttachmentIds, existingId: originalClip.id });
    assert.equal(replacementResult.note.id, originalClip.id, "reclip update changed the memo ID");
    assert.equal(replacementResult.note.collectionId, originalClip.collectionId, "reclip update changed the collection");
    assert.equal(replacementResult.note.isFlagged, true, "reclip update changed the flag");
    assert.deepEqual(replacementResult.note.reclipTestMetadata, { keep: "yes" }, "reclip update removed unrelated metadata");
    assert.match(replacementResult.note.body, /新しい本文/);
    assert.equal(replacementResult.attachments.length, 1, "reclip update did not replace old Web Clipper attachments");
    assert.equal(replacementResult.oldIds.some((id) => replacementResult.attachments.includes(id)), false, "old Web Clipper attachments remain after replacement");
    await replacementReceiver.close();

    const newSaveId = crypto.randomUUID();
    await setStorage(worker, `memoNexusTransfer:${newSaveId}`, { createdAt: Date.now(), clip: { title: "再クリップ新規保存", url: articleUrl, host: "127.0.0.1", clipMode: "link", selection: "", capturedAt: new Date().toISOString() } });
    const newSaveReceiver = await context.newPage();
    await newSaveReceiver.goto(`${appUrl}#clip-transfer=${newSaveId}`);
    await newSaveReceiver.locator("#webClipDialog[open]").waitFor();
    await newSaveReceiver.locator('input[name="webClipSaveMode"][value="new"]').check();
    assert.equal(await newSaveReceiver.locator('input[name="webClipSaveMode"][value="new"]').isChecked(), true, "new save mode was not selected");
    const newSaveStarted = await newSaveReceiver.evaluate(() => {
      document.getElementById("saveWebClipBtn").click();
      return document.getElementById("saveWebClipBtn").disabled;
    });
    assert.equal(newSaveStarted, true, "new reclip save did not start");
    await newSaveReceiver.waitForFunction(() => !document.getElementById("webClipDialog").open);
    await newSaveReceiver.waitForFunction(() => new Promise((resolve) => {
      const request = indexedDB.open("memo-nexus");
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const all = request.result.transaction("notes").objectStore("notes").getAll();
        all.onerror = () => resolve(false);
        all.onsuccess = () => resolve(all.result.some((note) => note.title === "再クリップ新規保存"));
      };
    }), null, { timeout: 5000 });
    const newSaveResult = await newSaveReceiver.evaluate((existingId) => new Promise((resolve, reject) => {
      const request = indexedDB.open("memo-nexus"); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const all = request.result.transaction("notes").objectStore("notes").getAll(); all.onsuccess = () => resolve(all.result.filter((note) => note.id === existingId || note.title === "再クリップ新規保存")); };
    }), originalClip.id);
    assert.equal(newSaveResult.length, 2, "new reclip save did not create a separate note");
    assert.equal(newSaveResult.find((note) => note.id === originalClip.id).title, "再クリップ更新", "new reclip save changed the existing note");
    await newSaveReceiver.close();

    const retryId = crypto.randomUUID();
    await setStorage(worker, `memoNexusTransfer:${retryId}`, { createdAt: Date.now(), clip: {
      title: "再試行確認", url: `${articleUrl}?retry=1`, host: "127.0.0.1", clipMode: "page", capturedAt: new Date().toISOString(), selection: "<!-- memo-nexus:web-clip-image:web-clip-image-1 -->", extensionVersion: "0.3.8", manifestVersion: 3,
      clipResult: {
        status: "partial",
        notice: "本文は取得できましたが、一部の画像を取得できませんでした。",
        issues: [{ stage: "image_fetch", code: "image_fetch_partial", userMessage: "本文は取得できましたが、一部の画像を取得できませんでした。", developerMessage: "1/1 image fetches failed", httpStatus: null, timedOut: false, retryable: false, partialSaveAvailable: true }],
        diagnostic: { occurredAt: new Date().toISOString(), stage: "image_fetch", code: "image_fetch_partial", articleFound: true, metadataFound: true, imageSuccessCount: 0, imageFailureCount: 1, fallbackUsed: false, fallbackKind: "", finalResult: "partial", sourceUrl: `${articleUrl}?secret=removed` }
      },
      images: [{ token: "web-clip-image-1", url: `${cdnBaseUrl}cdn-image.png?retry=1`, alt: "再試行画像", caption: "", status: "failed", errorCode: "NETWORK_ERROR", error: "一時失敗", selected: false }]
    } });
    const retryReceiver = await context.newPage();
    await retryReceiver.goto(`${appUrl}#clip-transfer=${retryId}`);
    await retryReceiver.locator("#webClipDialog[open]").waitFor();
    const retryInitialOutcome = await retryReceiver.locator("#webClipReceivedStatus").getAttribute("data-outcome");
    assert.equal(retryInitialOutcome, "partial", `retry fixture did not open as partial: ${JSON.stringify({ outcome: retryInitialOutcome, notice: await retryReceiver.locator("#webClipReceivedStatus").textContent(), error: await retryReceiver.locator("#webClipError").textContent() })}`);
    const retryLocks = await retryReceiver.evaluate(() => {
      document.getElementById("retryFailedWebClipImagesBtn").click();
      return {
        saveDisabled: document.getElementById("saveWebClipBtn").disabled,
        textOnlyDisabled: document.getElementById("saveWebClipTextOnlyBtn").disabled
      };
    });
    assert.equal(retryLocks.saveDisabled, true, "save remained enabled during image retry");
    assert.equal(retryLocks.textOnlyDisabled, true, "text-only save remained enabled during image retry");
    await retryReceiver.waitForFunction(() => !document.querySelector(".web-clip-image-card.status-pending"), null, { timeout: 25000 });
    const retryImageState = await retryReceiver.evaluate(() => ({
      readySelected: Boolean(document.querySelector('.web-clip-image-card.status-ready input[type="checkbox"]:checked')),
      card: document.querySelector(".web-clip-image-card")?.textContent || "",
      error: document.getElementById("webClipError").textContent,
      notice: document.getElementById("webClipReceivedStatus").textContent
    }));
    assert.equal(retryImageState.readySelected, true, `retried image was not ready: ${JSON.stringify(retryImageState)}`);
    assert.equal(await retryReceiver.locator("#webClipReceivedStatus").getAttribute("data-outcome"), "success");
    assert.match(await retryReceiver.locator("#webClipReceivedStatus").textContent(), /本文と画像1件を取得しました/);
    assert.equal(await retryReceiver.locator("#saveWebClipBtn").isEnabled(), true, "save was not restored after image retry");
    await retryReceiver.locator("#saveWebClipBtn").click();
    await retryReceiver.locator("#webClipDialog").waitFor({ state: "hidden" });
    assert.equal(await retryReceiver.locator("#attachmentCount").textContent(), "1件", "retried image was not saved as an attachment");
    assert.match(await retryReceiver.locator("#saveStatus").textContent(), /Webクリップを保存しました/);
    const retriedClipResult = await retryReceiver.evaluate((url) => new Promise((resolve, reject) => {
      const request = indexedDB.open("memo-nexus"); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const all = request.result.transaction("notes").objectStore("notes").getAll(); all.onsuccess = () => resolve(all.result.find((note) => note.source?.url === url)?.source?.clipResult || null); };
    }), `${articleUrl}?retry=1`);
    assert.equal(retriedClipResult?.status, "success");
    assert.equal(retriedClipResult?.diagnostic?.imageSuccessCount, 1);
    assert.equal(retriedClipResult?.diagnostic?.imageFailureCount, 0);
    assert.equal(retriedClipResult?.diagnostic?.finalResult, "success");
    assert.equal(retriedClipResult?.issues?.some((issue) => issue.code === "image_fetch_partial"), false);
    await retryReceiver.close();
    if (!popup.isClosed()) await popup.close(); await receiver.close();

    const { popup: textOnlyPopup, receiver: textOnlyReceiver } = await capture(context, worker, extensionId, "page");
    await textOnlyReceiver.locator("#clearAllWebClipImagesBtn").click();
    assert.match(await textOnlyReceiver.locator("#webClipImagesSummary").textContent(), /保存可能6件・選択0件/);
    await textOnlyReceiver.locator("#saveWebClipBtn").click();
    await textOnlyReceiver.locator("#webClipDialog").waitFor({ state: "hidden" });
    await textOnlyReceiver.locator("#attachmentCount").filter({ hasText: "0件" }).waitFor({ timeout: 5000 });
    assert.doesNotMatch(await textOnlyReceiver.locator("#editor").inputValue(), /attachment:\/\//);
    if (!textOnlyPopup.isClosed()) await textOnlyPopup.close(); await textOnlyReceiver.close();

    const invalidImageId = crypto.randomUUID();
    const invalidImageKey = `memoNexusTransfer:${invalidImageId}`;
    await setStorage(worker, invalidImageKey, {
      createdAt: Date.now(),
      clip: {
        title: "画像保存失敗確認", url: articleUrl, host: "127.0.0.1", clipMode: "page", capturedAt: new Date().toISOString(),
        selection: "本文前\n\n<!-- memo-nexus:web-clip-image:web-clip-image-1 -->\n\n本文後",
        images: [{ token: "web-clip-image-1", url: `${appUrl}broken.png`, alt: "壊れた画像", caption: "", status: "ready", mimeType: "image/png", size: 7, fileName: "broken.png", dataBase64: "aW52YWxpZA==", selected: true }]
      }
    });
    const failedSave = await context.newPage();
    expectedConsoleErrorPages.add(failedSave);
    await failedSave.goto(`${appUrl}#clip-transfer=${invalidImageId}`);
    await failedSave.locator("#webClipDialog[open]").waitFor();
    await failedSave.locator("#saveWebClipBtn").click();
    await failedSave.locator("#webClipError:not(:empty)").waitFor();
    assert.match(await failedSave.locator("#webClipError").textContent(), /画像.*保存できません/);
    assert(await failedSave.locator("#webClipDialog").getAttribute("open") !== null, "dialog closed after selected image save failed");
    assert.equal(await failedSave.locator(".web-clip-image-card.has-save-error").count(), 1);
    assert(await failedSave.locator("#saveWebClipBtn").isEnabled(), "retry button was not re-enabled");
    await failedSave.locator("#saveWebClipTextOnlyBtn").click();
    await failedSave.locator("#webClipDialog").waitFor({ state: "hidden" });
    assert.equal(await failedSave.locator("#attachmentCount").textContent(), "0件");
    await failedSave.close();

    // A real content script reports an ACK timeout but retains its transfer
    // entry so the app can retry within the TTL.
    const timeoutId = crypto.randomUUID();
    const timeoutKey = `memoNexusTransfer:${timeoutId}`;
    const otherTransferKey = `memoNexusTransfer:${crypto.randomUUID()}`;
    await setStorage(worker, timeoutKey, { clip: { title: "timeout", url: articleUrl, host: "127.0.0.1", selection: "timeout", clipMode: "page", capturedAt: new Date().toISOString() }, createdAt: Date.now() });
    await setStorage(worker, otherTransferKey, { clip: { title: "other", url: articleUrl, host: "127.0.0.1", selection: "other", clipMode: "page", capturedAt: new Date().toISOString() }, createdAt: Date.now() });
    const noAck = await context.newPage();
    await noAck.goto(`${appUrl}no-ack.html#clip-transfer=${timeoutId}`);
    await noAck.waitForFunction(() => window.transferEvents === 1, null, { timeout: 5000 });
    assert(await storage(worker, timeoutKey), "storage.local entry was removed without ACK");
    await noAck.waitForFunction(() => window.timeoutSeen === true, null, { timeout: 14000 });
    assert(await storage(worker, timeoutKey), "ACK timeout removed the transfer entry before TTL expiry");
    assert(await storage(worker, otherTransferKey), "timeout cleanup removed another active transfer");
    await worker.evaluate(async (keys) => chrome.storage.local.remove(keys), [timeoutKey, otherTransferKey]);
    await noAck.screenshot({ path: path.join(artifacts, "web-clipper-timeout.png"), fullPage: true });
    assert.deepEqual(appPageErrors, [], `app page errors: ${JSON.stringify(appPageErrors)}`);
    assert.deepEqual(appConsoleErrors, [], `app console errors: ${JSON.stringify(appConsoleErrors)}`);
    console.log("PASS: actual MV3 extension, 15s delayed ready handshake, reload recovery, multi-tab isolation, retry/failure UI, Origin rejection, ACK retention, images, IndexedDB, and all clip modes");
  } finally {
    if (context) await context.close();
    await new Promise((resolve) => httpServer.close(resolve));
    await new Promise((resolve) => imageServer.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
