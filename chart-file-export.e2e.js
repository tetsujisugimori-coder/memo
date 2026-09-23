"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const playwright = require("playwright");
const { parseCsvTable, parseTsvTable } = require("./table-block-utils.js");

const browserName = process.env.MEMO_NEXUS_E2E_BROWSER || "chromium";
const sourceTsv = "項目\t売上\t利益\t費用\n1月\t100\t20\t10\n2月\t120\t25\t0";
const savedRows = [["項目", "売上", "利益", "費用"], ["1月", "100", "20", "10"], ["2月", "120", "25", "0"]];
const draftRows = [["項目", "利益", "売上", "費用"], ["2月", "25", "120", "0"], ["編集途中, 1月", "20", "1.2345678901234567", "10"]];
const secondRows = [["項目", "人数"], ["東京", "42"], ["大阪", "17"]];
const panel = (page, index = 0) => page.locator(".chart-block-editor").nth(index);
const card = (page, index = 0) => page.locator("#preview .chart-block").nth(index);
const editorButton = (page, index, format) => panel(page, index).locator(`[data-chart-action="save-file"][data-chart-file-format="${format}"]`);
const cardButton = (page, index, format) => card(page, index).locator(`[data-chart-file-format="${format}"]`);

async function idle(page) {
  await page.waitForFunction(() => !noteSaveFoundation.isDirty(currentId) && saveTimer === null
    && window.MemoNexusTypingDerivedUiScheduler.pendingRequestType() === null);
}

async function snapshot(page) {
  return page.evaluate(async () => ({
    body: editor.value, note: structuredClone(currentNote()), state: noteSaveFoundation.getState(currentId),
    saveTimer, pendingUi: window.MemoNexusTypingDerivedUiScheduler.pendingRequestType(),
    undo: structuredClone(undoStack), redo: structuredClone(redoStack),
    drafts: structuredClone([...chartEditorOriginalCharts]),
    stored: (await getStoredNotes()).find((note) => note.id === currentId)
  }));
}

async function paste(page, index, value) {
  await panel(page, index).locator('[data-chart-action="paste-table"]').click();
  await page.getByRole("dialog").locator("textarea").fill(value);
  await page.getByRole("button", { name: "貼り付け内容を反映", exact: true }).click();
}

async function confirm(page, index) {
  await panel(page, index).locator('[data-chart-action="confirm"]').click();
  await page.waitForFunction((i) => document.querySelectorAll(".chart-block-editor")[i]
    ?.querySelector(":scope > .chart-block-status")?.textContent === "入力内容を保存しました", index);
  await idle(page);
}

async function setup(page) {
  const oldId = await page.evaluate(() => currentId);
  await page.locator("#newBtn").click();
  await page.waitForFunction((id) => currentId !== id && editor.value === "", oldId);
  await page.locator("#titleInput").fill("売上:集計.csv");
  await page.locator("#insertChartBtn").click();
  await paste(page, 0, sourceTsv);
  await confirm(page, 0);
  await paste(page, 0, sourceTsv);
}

async function installProbe(page) {
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    const click = HTMLAnchorElement.prototype.click;
    window.chartExportProbe = { created: [], revoked: [], clicks: [] };
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      chartExportProbe.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => { chartExportProbe.revoked.push(url); return revoke(url); };
    HTMLAnchorElement.prototype.click = function (...args) {
      if (this.hasAttribute("download")) chartExportProbe.clicks.push({ anchor: this, href: this.href, name: this.download });
      return click.apply(this, args);
    };
  });
}

async function probe(page) {
  return page.evaluate(() => ({
    created: [...chartExportProbe.created], revoked: [...chartExportProbe.revoked],
    clicks: chartExportProbe.clicks.map(({ anchor, href, name }) => ({
      href, name, connected: anchor.isConnected, currentHref: anchor.getAttribute("href")
    }))
  }));
}

function assertReleased(before, after, names) {
  const created = after.created.slice(before.created.length);
  const revoked = after.revoked.slice(before.revoked.length);
  const clicks = after.clicks.slice(before.clicks.length);
  assert.equal(created.length, names.length, "one independent Object URL per request");
  assert.equal(new Set(created).size, names.length);
  assert.deepEqual(revoked, created, "all Object URLs are revoked after delivery");
  assert.deepEqual(clicks.map((entry) => entry.name), names);
  clicks.forEach((entry, index) => {
    assert.equal(entry.href, created[index]);
    assert.equal(entry.connected, false, "temporary link is removed");
    assert.equal(entry.currentHref, null, "temporary link loses its href");
  });
}

async function readDownload(download, format, expected, name) {
  assert.equal(download.suggestedFilename(), name);
  assert.equal(await download.failure(), null);
  const bytes = fs.readFileSync(await download.path());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = new TextDecoder("utf-8").decode(bytes);
  const parsed = format === "csv" ? parseCsvTable(text) : parseTsvTable(text);
  assert.deepEqual(parsed.rows, expected);
  assert.match(text, /\r\n/);
  assert.equal(text.replace(/\r\n/g, "").includes("\n"), false, "records use CRLF");
}

async function status(page, surface, index) {
  return (surface === "editor" ? panel(page, index) : card(page, index))
    .locator(surface === "editor" ? ":scope > .chart-block-status" : ".chart-tsv-copy-controls [role=status]");
}

async function save(page, events, surface, index, format, expected, { tap = false, keyboard = false } = {}) {
  const button = surface === "editor" ? editorButton(page, index, format) : cardButton(page, index, format);
  const before = await probe(page), count = events.length;
  const event = page.waitForEvent("download");
  if (keyboard) { await button.focus(); await button.press("Enter"); }
  else if (tap) await button.tap();
  else await button.click();
  await readDownload(await event, format, expected, `売上_集計-chart-${index + 1}.${format}`);
  await (await status(page, surface, index)).filter({ hasText: new RegExp(`^${format.toUpperCase()}ファイルを保存しました`) }).waitFor();
  assert.equal(events.length, count + 1, "one activation makes one browser download");
  assertReleased(before, await probe(page), [`売上_集計-chart-${index + 1}.${format}`]);
  assert.equal(await button.isDisabled(), false);
  assert.equal(await button.getAttribute("aria-busy"), null);
}

async function assertLayout(page, host, width) {
  const metrics = await host.locator(".chart-tsv-copy-controls").evaluate((controls) => {
    const box = (element) => element.getBoundingClientRect().toJSON();
    return {
      doc: document.documentElement.scrollWidth, body: document.body.scrollWidth,
      client: document.documentElement.clientWidth, controls: box(controls),
      buttons: [...controls.querySelectorAll("button")].map(box)
    };
  });
  assert.ok(metrics.doc <= metrics.client && metrics.body <= metrics.client, JSON.stringify(metrics));
  assert.ok(metrics.controls.left >= 0 && metrics.controls.right <= width + 1, JSON.stringify(metrics));
  for (const rect of metrics.buttons) {
    assert.ok(rect.left >= metrics.controls.left - 1 && rect.right <= metrics.controls.right + 1, JSON.stringify(metrics));
  }
  for (let i = 0; i < metrics.buttons.length; i++) for (let j = i + 1; j < metrics.buttons.length; j++) {
    const a = metrics.buttons[i], b = metrics.buttons[j];
    assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1,
      `buttons overlap: ${JSON.stringify([a, b])}`);
  }
}

async function openCardOnMobile(page) {
  if (await page.locator("#mobileWritingDoneBtn").isVisible()) await page.locator("#mobileWritingDoneBtn").click();
  if (await page.locator("#previewCard").getAttribute("aria-hidden") === "true") await page.locator("#cardPaneBtn").click();
  await page.waitForFunction(() => document.getElementById("previewCard").getAttribute("aria-hidden") === "false");
}

async function verifyResponsive(page, events) {
  for (const theme of ["light", "dark"]) {
    await page.locator("#settingsBtn").click();
    await page.locator("#themeSelect").selectOption(theme);
    await page.locator("#closeSettingsBtn").click();
    for (const width of [320, 375, 390, 430, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction((w) => innerWidth === w && document.body.dataset.layoutMode === (w < 600 ? "mobile" : "wide"), width);
      if (width < 600 && await page.locator("#contextPanel").getAttribute("aria-hidden") === "false") {
        await page.locator("#closeContextPanelBtn").click();
      }
      await editorButton(page, 0, "csv").scrollIntoViewIfNeeded();
      await assertLayout(page, panel(page), width);
      for (const format of ["csv", "tsv"]) {
        const button = editorButton(page, 0, format);
        await button.focus();
        assert.equal(await button.evaluate((element) => element === document.activeElement), true);
        await save(page, events, "editor", 0, format, savedRows, { tap: width < 600 });
      }
      if (width < 600) await openCardOnMobile(page);
      await cardButton(page, 0, "csv").scrollIntoViewIfNeeded();
      await assertLayout(page, card(page), width);
      for (const format of ["csv", "tsv"]) {
        const button = cardButton(page, 0, format);
        await button.focus();
        assert.equal(await button.evaluate((element) => element === document.activeElement), true);
        await save(page, events, "card", 0, format, savedRows, { tap: width < 600 });
      }
      if (width < 600) await page.locator("#closeCardPaneBtn").click();
    }
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForFunction(() => document.body.dataset.layoutMode === "wide");
}

async function expectInputError(page, events, target, value, pattern) {
  const button = editorButton(page, 0, "csv");
  const before = await probe(page), count = events.length;
  const targets = Array.isArray(target) ? target : [target];
  const values = Array.isArray(value) ? value : [value];
  const originals = [];
  for (let i = 0; i < targets.length; i++) {
    originals.push(await targets[i].evaluate((element, next) => {
      const previous = element.value;
      element.value = next;
      return previous;
    }, values[i]));
  }
  try {
    await button.click();
    const message = await (await status(page, "editor", 0)).textContent();
    assert.match(message, pattern, `input lengths: ${JSON.stringify(await Promise.all(targets.map((entry) => entry.evaluate((element) => element.value.length))))}`);
    assert.equal(events.length, count, "invalid input must not start a download");
    assert.deepEqual(await probe(page), before, "invalid input must not create a link or Object URL");
    assert.equal(await button.isDisabled(), false);
    assert.equal(await button.getAttribute("aria-busy"), null);
  } finally {
    for (let i = 0; i < targets.length; i++) {
      await targets[i].evaluate((element, previous) => { element.value = previous; }, originals[i]);
    }
  }
  await save(page, events, "editor", 0, "csv", savedRows);
}

(async () => {
  const root = __dirname;
  const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "application/javascript" });
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await playwright[browserName].launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, hasTouch: true, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [], events = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    page.on("download", (download) => events.push(download));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await idle(page);
    await installProbe(page);
    await setup(page);
    await panel(page).locator('[data-chart-series-value][data-chart-series-index="0"]').first().fill("1.2345678901234567");
    await panel(page).locator('[data-chart-item-field="label"]').first().fill("編集途中, 1月");
    await panel(page).locator('.chart-block-item-row[data-chart-item-index="0"] [data-chart-action="move-item-down"]').click();
    await page.waitForFunction(() => document.activeElement?.dataset.chartAction?.startsWith("move-item-"));
    await panel(page).locator('.chart-block-series-row[data-chart-series-index="1"] [data-chart-action="move-series-up"]').click();
    await page.waitForFunction(() => document.activeElement?.dataset.chartAction?.startsWith("move-series-"));
    const draftBefore = await snapshot(page);
    for (const format of ["csv", "tsv"]) await save(page, events, "editor", 0, format, draftRows);
    assert.deepEqual(await snapshot(page), draftBefore, "draft export changes neither persistence nor draft/history/save scheduling");
    await panel(page).locator('[data-chart-action="cancel"]').click();
    await page.waitForFunction(() => document.querySelector(".chart-block-editor > .chart-block-status")?.textContent === "編集内容を取り消しました");
    await idle(page);
    const savedBefore = await snapshot(page);
    for (const format of ["csv", "tsv"]) await save(page, events, "card", 0, format, savedRows);
    await save(page, events, "card", 0, "tsv", savedRows, { keyboard: true });
    assert.equal(await cardButton(page, 0, "tsv").evaluate((button) => button === document.activeElement), true,
      "keyboard export on a saved card returns focus to its button");
    assert.deepEqual(await snapshot(page), savedBefore, "saved export changes neither persistence nor history");
    assert.equal(await card(page).locator("[aria-live]").count(), 1, "reuse the existing chart live region");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await idle(page);
    await installProbe(page);
    for (const format of ["csv", "tsv"]) await save(page, events, "card", 0, format, savedRows);
    await verifyResponsive(page, events);
    const firstValue = panel(page).locator('[data-chart-series-value]').first();
    const firstLabel = panel(page).locator('[data-chart-item-field="label"]').first();
    await expectInputError(page, events, firstLabel, "NUL\0項目", /項目1.*NUL文字/);
    await expectInputError(page, events, firstValue, "Infinity", /項目1.*有限な数値/);
    await expectInputError(page, events, [
      firstLabel, panel(page).locator('[data-chart-item-field="label"]').nth(1),
      ...[0, 1, 2].map((index) => panel(page).locator('[data-chart-series-field="name"]').nth(index))
    ], Array(5).fill("あ".repeat(450000)), /ファイルサイズが上限の5MiB/);
    const repeatedBefore = await probe(page), repeatedCount = events.length;
    const repeatedEvent = page.waitForEvent("download");
    await editorButton(page, 0, "csv").evaluate((button) => { button.click(); button.click(); });
    await readDownload(await repeatedEvent, "csv", savedRows, "売上_集計-chart-1.csv");
    await (await status(page, "editor", 0)).filter({ hasText: /^CSVファイルを保存しました/ }).waitFor();
    assert.equal(events.length, repeatedCount + 1, "rapid repeated activation starts only one download");
    assertReleased(repeatedBefore, await probe(page), ["売上_集計-chart-1.csv"]);
    await save(page, events, "editor", 0, "tsv", savedRows, { keyboard: true });
    assert.equal(await editorButton(page, 0, "tsv").evaluate((button) => button === document.activeElement), true,
      "keyboard export returns focus to its button");
    await page.locator("#insertChartBtn").click();
    await page.waitForFunction(() => document.querySelectorAll(".chart-block-editor").length === 2);
    await paste(page, 1, "項目\t人数\n東京\t42\n大阪\t17");
    await confirm(page, 1);
    const twoBefore = await snapshot(page), parallelBefore = await probe(page), parallelCount = events.length;
    const downloads = [
      page.waitForEvent("download", { predicate: (download) => download.suggestedFilename() === "売上_集計-chart-1.csv" }),
      page.waitForEvent("download", { predicate: (download) => download.suggestedFilename() === "売上_集計-chart-2.tsv" })
    ];
    await page.evaluate(() => {
      const NativeChannel = window.MessageChannel;
      const gate = { release: null, restore: () => { window.MessageChannel = NativeChannel; } };
      window.chartDeliveryGate = gate;
      window.MessageChannel = class {
        constructor() {
          const channel = new NativeChannel();
          this.port1 = channel.port1;
          this.port2 = {
            close: () => channel.port2.close(),
            postMessage: (...args) => {
              if (!gate.release) gate.release = () => channel.port2.postMessage(...args);
              else channel.port2.postMessage(...args);
            }
          };
        }
      };
    });
    try {
      await cardButton(page, 0, "csv").click();
      await page.waitForFunction(() => chartDeliveryGate.release
        && document.querySelector('#preview [data-chart-file-index="0"][data-chart-file-format="csv"]')?.disabled);
      await cardButton(page, 1, "tsv").click();
      await page.waitForFunction(() => document.querySelector('#preview [data-chart-file-index="1"][data-chart-file-format="tsv"]')?.disabled);
      assert.equal((await probe(page)).created.length, parallelBefore.created.length + 1,
        "second user activation is in flight while the first delivery remains pending");
    } finally {
      await page.evaluate(() => {
        chartDeliveryGate.restore();
        chartDeliveryGate.release?.();
      });
    }
    try {
      await Promise.all(downloads);
    } catch (error) {
      console.error("parallel delivery diagnostics", {
        names: events.slice(parallelCount).map((entry) => entry.suggestedFilename()),
        first: await (await status(page, "card", 0)).textContent(),
        second: await (await status(page, "card", 1)).textContent(),
        probeCounts: await page.evaluate(() => ({
          created: chartExportProbe.created.length,
          revoked: chartExportProbe.revoked.length,
          clicks: chartExportProbe.clicks.length
        }))
      });
      throw error;
    }
    const delivered = events.slice(parallelCount);
    assert.equal(delivered.length, 2, "both independent requests deliver exactly once");
    await readDownload(delivered[0], "csv", savedRows, "売上_集計-chart-1.csv");
    await readDownload(delivered[1], "tsv", secondRows, "売上_集計-chart-2.tsv");
    await (await status(page, "card", 0)).filter({ hasText: /^CSVファイルを保存しました/ }).waitFor();
    await (await status(page, "card", 1)).filter({ hasText: /^TSVファイルを保存しました/ }).waitFor();
    assertReleased(parallelBefore, await probe(page), ["売上_集計-chart-1.csv", "売上_集計-chart-2.tsv"]);
    assert.deepEqual(await snapshot(page), twoBefore, "parallel export does not change either chart or save state");
    assert.deepEqual(errors, []);
    console.log(`Chart file export E2E (${browserName}) passed: draft/reorder/cancel/reload, simultaneous downloads and cleanup, input errors/retry, 10 theme-width layouts and touch`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
