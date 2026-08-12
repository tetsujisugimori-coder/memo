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
const zlib = require("node:zlib");
const { chromium } = require("playwright");

const root = __dirname;
const artifacts = path.join(root, "e2e-artifacts");
const appUrl = "http://127.0.0.1:5500/";
const articleUrl = "http://127.0.0.1:5500/e2e-source.html";
const cdnUrl = "http://127.0.0.1:5501/cdn-image.png";
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
let unsafeSvgRequests = 0;

function articleHtml() {
  const decorativeSvg = Array.from({ length: 25 }, (_, index) => `<img class="share-icon" src="${appUrl}safe.svg?icon=${index}" alt="共有アイコン" width="160" height="120">`).join("");
  return `<!doctype html><meta charset="utf-8"><title>E2E記事タイトル</title><article><h1>取得元の見出し</h1><p>${selectionText}</p>${decorativeSvg}<figure><img src="http://127.0.0.1:5501/redirect-image?asset=photo" alt="クロスオリジンJPEG" width="160" height="120"><figcaption>リダイレクトJPEGの説明</figcaption></figure><p>画像間の段落です。${marker}</p><figure><img src="${cdnUrl}?version=2" alt="CDN PNG" width="160" height="120"><figcaption>CDN画像の説明</figcaption></figure><img src="${appUrl}local-image.webp?format=webp" alt="WebP画像" width="160" height="120"><figure><img src="${appUrl}animated.gif" alt="アニメーションGIF" width="100" height="50"><figcaption>アニメーション図版</figcaption></figure><img src="${appUrl}safe.svg" alt="SVG画像" width="160" height="120"><img src="${appUrl}sample.avif" alt="AVIF画像" width="160" height="120"><img src="http://127.0.0.1:5501/missing.png" alt="取得失敗画像" width="160" height="120"><img src="http://127.0.0.1:5501/slow-image?timeout=1" alt="タイムアウト画像" width="160" height="120"><img class="site-logo" src="${appUrl}local-image.png" alt="ロゴ" width="160" height="120"><img src="${cdnUrl}?version=2" alt="重複画像" width="160" height="120"><img src="${appUrl}local-image.png" alt="追跡ピクセル" width="1" height="1"><ul><li>リスト項目 一</li><li>リスト項目 二</li></ul><p><a href="https://example.test/reference">確認用リンク</a></p><p>${longText}</p></article>`;
}

function server() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, appUrl);
    if (url.pathname === "/e2e-source.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(articleHtml());
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

function cdnServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1:5501/");
    if (url.pathname === "/redirect-image") {
      response.writeHead(302, { location: "/cdn-image.jpg?resolved=1" });
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
    assert.equal(await popup.locator("#extensionVersion").textContent(), "0.3.0");
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
  try {
    const extension = path.join(root, "extensions", "web-clipper");
    context = await chromium.launchPersistentContext(profile, {
      // Chromium's extension Service Worker is not started in its headless
      // shell, so use the bundled full Chromium in a persistent context.
      headless: false,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    let worker = await waitForWorker(context);
    const extensionId = new URL(worker.url()).host;
    assert.match(extensionId, /^[a-p]{32}$/, "extension ID must come from its actual Service Worker URL");
    console.log(`Playwright bundled Chromium: ${chromium.executablePath()}`);
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

    for (const mode of ["selection", "link", "memo"]) {
      const { popup, receiver } = await capture(context, worker, extensionId, mode);
      assert.equal(await receiver.locator("#webClipMode").inputValue(), mode);
      assert.equal(await receiver.locator("#webClipTitle").inputValue(), "E2E記事タイトル");
      assert.equal(await receiver.locator("#webClipUrl").inputValue(), articleUrl);
      if (mode === "link") assert.equal(await receiver.locator("#webClipSelection").inputValue(), "");
      else assert.match(await receiver.locator("#webClipSelection").inputValue(), new RegExp(selectionText));
      if (mode === "memo") assert.equal(await receiver.locator("#webClipUserMemo").inputValue(), "E2Eメモ: あとで確認");
      if (!popup.isClosed()) await popup.close(); await receiver.close();
    }

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
    }, (response) => resolve({ response, error: chrome.runtime.lastError?.message || "" }))), `${appUrl}local-image.jpg`);
    assert.equal(restartResponse.error, "", `Service Worker restart message failed: ${restartResponse.error}`);
    assert.equal(restartResponse.response?.images?.[0]?.status, "ready", "Service Worker did not fetch after restart");
    worker = restartPage;
    await source.bringToFront();
    assert.equal(new URL(worker.url()).host, extensionId, "extension ID changed after Service Worker restart");

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
    await receiver.evaluate(() => window.__memoNexusOriginalPostMessage({ type: "memo-nexus-web-clip-transfer-ack", transferId: window.__memoNexusTransferId }, location.origin));
    await receiver.waitForTimeout(250);
    assert.equal(await storage(worker, transferKey), undefined, "storage.local entry remains after ACK");
    await receiver.locator("#saveWebClipBtn").click();
    await receiver.locator("#webClipDialog").waitFor({ state: "hidden" });
    await receiver.locator("#attachmentCount").waitFor({ state: "visible" });
    assert.equal(await receiver.locator("#attachmentCount").textContent(), "6件");
    const savedBody = await receiver.locator("#editor").inputValue();
    assert.match(savedBody, /attachment:\/\//);
    assert.match(savedBody, /画像を保存できませんでした: 取得失敗画像/);
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
    await receiver.reload();
    await receiver.locator(".image-block img").first().waitFor({ state: "visible" });
    assert.equal(await receiver.locator(".image-block img").count(), 6);
    assert.equal(await receiver.locator("#attachmentCount").textContent(), "6件");
    assert.match(await receiver.locator("#editor").inputValue(), /attachment:\/\//);
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
    await failedSave.goto(`${appUrl}#clip-transfer=${invalidImageId}`);
    await failedSave.locator("#webClipDialog[open]").waitFor();
    await failedSave.locator("#saveWebClipBtn").click();
    await failedSave.locator("#webClipError").filter({ hasText: "保存に失敗しました" }).waitFor();
    assert(await failedSave.locator("#webClipDialog").getAttribute("open") !== null, "dialog closed after selected image save failed");
    assert.equal(await failedSave.locator(".web-clip-image-card.has-save-error").count(), 1);
    assert(await failedSave.locator("#saveWebClipBtn").isEnabled(), "retry button was not re-enabled");
    await failedSave.locator("#saveWebClipTextOnlyBtn").click();
    await failedSave.locator("#webClipDialog").waitFor({ state: "hidden" });
    assert.equal(await failedSave.locator("#attachmentCount").textContent(), "0件");
    await failedSave.close();

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
    console.log("PASS: actual MV3 extension, Service Worker restart, JPEG/PNG/WebP/GIF/SVG/AVIF, IndexedDB, reload, failure, ACK lifecycle, and long article");
  } finally {
    if (context) await context.close();
    await new Promise((resolve) => httpServer.close(resolve));
    await new Promise((resolve) => imageServer.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
