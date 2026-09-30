"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const playwright = require("playwright");

const browserName = process.env.MEMO_NEXUS_E2E_BROWSER || "chromium";

async function zipBytes(page, { id, title, body, updatedAt, version = 2 }) {
  return Buffer.from(await page.evaluate(async (source) => {
    const exportedAt = "2026-09-01T00:00:00.000Z";
    const note = { id: source.id, title: source.title, updatedAt: source.updatedAt, createdAt: "2026-08-01T00:00:00.000Z" };
    const files = [
      { name: "manifest.json", content: JSON.stringify({ format: "memo-nexus-backup", version: source.version, exportedAt }) },
      { name: "collections.json", content: "[]" },
      { name: "tags.json", content: "[]" },
      { name: `notes/${source.id}.md`, content: serializeLocalNote(note, source.body) }
    ];
    const blob = await makeZip(files);
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { id, title, body, updatedAt, version }));
}

async function selectZip(page, buffer, name = "restore.zip") {
  await page.locator("#importMarkdownZipInput").setInputFiles({ name, mimeType: "application/zip", buffer });
  await page.locator("#backupPreviewDialog").waitFor({ state: "visible" });
}

async function storedNote(page, id) {
  return page.evaluate(async (noteId) => (await getStoredNotes()).find((note) => note.id === noteId) || null, id);
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
    const context = await browser.newContext({ viewport: { width: 1100, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "domcontentloaded" });
    await page.locator("#appStartupGuard").waitFor({ state: "hidden" });
    const editingId = await page.evaluate(() => currentId);
    await page.locator("#editor").fill("取り込み前の未保存編集");
    const buffer = await zipBytes(page, { id: "restore-a", title: "<img src=x onerror=alert(1)>", body: "復元本文", updatedAt: "2030-01-01T00:00:00.000Z" });
    await page.locator("#settingsBtn").click();
    await selectZip(page, buffer);
    assert.equal(await storedNote(page, "restore-a"), null, "preview must not save");
    assert.match(await page.locator("#backupPreviewContent").innerText(), /追加するメモ（1件）/);
    assert.equal(await page.locator("#backupPreviewContent img").count(), 0, "untrusted title stays text");
    for (const width of [320, 390, 1100]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `${width}px horizontal overflow`);
    }
    await page.locator("#cancelBackupPreviewBtn").click();
    assert.equal(await storedNote(page, "restore-a"), null, "cancel must not save");
    assert.equal((await storedNote(page, editingId)).body, "取り込み前の未保存編集", "normal editor save survives cancel");
    await selectZip(page, buffer);
    await page.locator("#confirmBackupPreviewBtn").click();
    await page.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();
    assert.equal((await storedNote(page, "restore-a")).body, "復元本文");
    await page.locator("#cancelBackupPreviewBtn").click();

    const conflictBuffer = await zipBytes(page, { id: "restore-b", title: "競合", body: "バックアップ本文", updatedAt: "2030-01-01T00:00:00.000Z" });
    await selectZip(page, conflictBuffer);
    const otherPage = await context.newPage();
    await otherPage.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "domcontentloaded" });
    await otherPage.locator("#appStartupGuard").waitFor({ state: "hidden" });
    await otherPage.evaluate(async () => {
      await putNote({ id: "restore-b", title: "別タブ", body: "別タブの本文", createdAt: "2031-01-01T00:00:00.000Z", updatedAt: "2031-01-01T00:00:00.000Z", bodyUpdatedAt: "2031-01-01T00:00:00.000Z", collectionId: "unclassified", tags: [], deletedAt: null });
    });
    await page.locator("#confirmBackupPreviewBtn").click();
    await page.locator("#backupPreviewStatus").getByText(/再確認してください/).waitFor();
    assert.equal((await storedNote(page, "restore-b")).body, "別タブの本文", "stale plan must not overwrite");
    assert.equal(await page.locator("#confirmBackupPreviewBtn").isDisabled(), true);
    await page.locator("#cancelBackupPreviewBtn").click();

    const updateBuffer = await zipBytes(page, { id: "restore-a", title: "更新", body: "新しい本文", updatedAt: "2040-01-01T00:00:00.000Z" });
    await selectZip(page, updateBuffer);
    assert.match(await page.locator("#backupPreviewContent").innerText(), /更新するメモ（1件）/);
    await otherPage.evaluate(async () => {
      const note = (await getStoredNotes()).find((item) => item.id === "restore-a");
      await putNote({ ...note, body: "日時を変えない別タブ編集" });
    });
    await page.locator("#confirmBackupPreviewBtn").click();
    await page.locator("#backupPreviewStatus").getByText(/再確認してください/).waitFor();
    assert.equal((await storedNote(page, "restore-a")).body, "日時を変えない別タブ編集");
    await page.locator("#cancelBackupPreviewBtn").click();

    const attachmentConflict = await zipBytes(page, { id: "restore-c", title: "添付競合", body: "本文", updatedAt: "2040-01-01T00:00:00.000Z" });
    await selectZip(page, attachmentConflict);
    await otherPage.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("attachments", "readwrite");
        transaction.objectStore("attachments").put({ id: "outside-asset", memoId: "restore-c", fileName: "outside.txt", kind: "image",
          mimeType: "text/plain", size: 1, createdAt: "2030-01-01T00:00:00.000Z" });
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      });
    });
    await page.locator("#confirmBackupPreviewBtn").click();
    await page.locator("#backupPreviewStatus").getByText(/再確認してください/).waitFor();
    assert.equal(await storedNote(page, "restore-c"), null, "attachment conflict stops all writes");
    await page.locator("#cancelBackupPreviewBtn").click();

    await selectZip(page, attachmentConflict);
    await otherPage.evaluate(async () => {
      await putTagDefinitions([{ id: "outside-tag", name: "別タブタグ", color: "#557799", createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z" }]);
    });
    await page.locator("#confirmBackupPreviewBtn").click();
    await page.locator("#backupPreviewStatus").getByText(/再確認してください/).waitFor();
    assert.equal(await storedNote(page, "restore-c"), null, "tag conflict stops all writes");
    await page.locator("#cancelBackupPreviewBtn").click();

    const failedBuffer = Buffer.from(await page.evaluate(async () => {
      const exportedAt = "2026-09-01T00:00:00.000Z";
      const updatedAt = "2040-01-01T00:00:00.000Z";
      const note = { id: "restore-fail", title: "保存失敗", collectionId: "failed-collection", tags: ["failed-tag"], updatedAt };
      const blob = await makeZip([
        { name: "manifest.json", content: JSON.stringify({ format: "memo-nexus-backup", version: 2, exportedAt }) },
        { name: "collections.json", content: JSON.stringify([{ id: "failed-collection", name: "未保存コレクション", updatedAt }]) },
        { name: "tags.json", content: JSON.stringify([{ id: "failed-tag", name: "未保存タグ", color: "#557799", updatedAt }]) },
        { name: "notes/failed.md", content: serializeLocalNote(note, "失敗時に残さない") }
      ]);
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }));
    await selectZip(page, failedBuffer);
    await page.evaluate(() => {
      window.originalBackupTestPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = window.originalBackupTestPut.apply(this, args);
        if (this.name === "notes" && args[0]?.id === "restore-fail") this.transaction.abort();
        return request;
      };
    });
    await page.locator("#confirmBackupPreviewBtn").click();
    await page.locator("#backupPreviewStatus").getByText(/保存に失敗したため/).waitFor();
    assert.equal(await storedNote(page, "restore-fail"), null, "aborted transaction leaves no note");
    assert.deepEqual(await page.evaluate(async () => ({
      collection: (await getAllCollections()).find((item) => item.id === "failed-collection") || null,
      tag: (await getAllTagDefinitions()).find((item) => item.id === "failed-tag") || null,
      liveNote: notes.find((item) => item.id === "restore-fail") || null
    })), { collection: null, tag: null, liveNote: null }, "abort rolls back every target store and memory");
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalBackupTestPut; });
    await page.locator("#confirmBackupPreviewBtn").click();
    await page.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();
    assert.equal((await storedNote(page, "restore-fail")).body, "失敗時に残さない", "retry after abort succeeds");
    assert.ok((await page.evaluate(async () => getAllCollections())).some((item) => item.id === "failed-collection"));
    assert.ok((await page.evaluate(async () => getAllTagDefinitions())).some((item) => item.id === "failed-tag"));
    await page.locator("#cancelBackupPreviewBtn").click();

    await selectZip(page, updateBuffer);
    await page.locator("#confirmBackupPreviewBtn").click();
    await page.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();
    assert.equal((await storedNote(page, "restore-a")).body, "新しい本文", "newer backup replaces stored note");
    await page.locator("#cancelBackupPreviewBtn").click();
    await selectZip(page, buffer);
    assert.match(await page.locator("#backupPreviewContent").innerText(), /現在の内容を維持するメモ（1件）/);
    assert.equal(await page.locator("#confirmBackupPreviewBtn").isDisabled(), true, "no-op plan cannot write");
    await page.locator("#cancelBackupPreviewBtn").click();

    const legacyBuffer = await zipBytes(page, { id: "legacy-backup", title: "旧形式", body: "旧形式本文", updatedAt: "2030-01-01T00:00:00.000Z", version: 1 });
    await selectZip(page, legacyBuffer);
    assert.match(await page.locator("#backupPreviewContent").innerText(), /旧形式から読み込み時に移行/);
    await page.locator("#confirmBackupPreviewBtn").click();
    await page.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();
    assert.equal((await storedNote(page, "legacy-backup")).body, "旧形式本文");
    await page.locator("#cancelBackupPreviewBtn").click();

    const relatedZip = Buffer.from(await page.evaluate(async () => {
      const exportedAt = "2026-09-01T00:00:00.000Z";
      const updatedAt = "2050-01-01T00:00:00.000Z";
      const note = { id: "restore-a", title: "所属とタグ", body: "関連変更", collectionId: "backup-collection", tags: ["backup-tag"], updatedAt };
      const files = [
        { name: "manifest.json", content: JSON.stringify({ format: "memo-nexus-backup", version: 2, exportedAt }) },
        { name: "collections.json", content: JSON.stringify([{ id: "backup-collection", name: "追加コレクション", parentId: null,
          sortOrder: 0, isSystem: false, createdAt: exportedAt, updatedAt }]) },
        { name: "tags.json", content: JSON.stringify([{ id: "backup-tag", name: "追加タグ", color: "#557799",
          createdAt: exportedAt, updatedAt }]) },
        { name: "notes/related.md", content: serializeLocalNote(note, note.body) }
      ];
      return Array.from(new Uint8Array(await (await makeZip(files)).arrayBuffer()));
    }));
    await selectZip(page, relatedZip);
    assert.match(await page.locator("#backupPreviewContent").innerText(), /コレクションの追加・更新（1件）/);
    assert.match(await page.locator("#backupPreviewContent").innerText(), /タグ定義の追加・変更・補完（1件）/);
    await page.locator("#backupPreviewContent summary").getByText(/ゴミ箱・所属コレクションの変更/).click();
    assert.match(await page.locator("#backupPreviewContent").innerText(), /所属を backup-collection へ変更/);
    await page.locator("#confirmBackupPreviewBtn").click();
    await page.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();
    const related = await page.evaluate(async () => ({
      note: (await getStoredNotes()).find((item) => item.id === "restore-a"),
      collection: (await getAllCollections()).find((item) => item.id === "backup-collection"),
      tag: (await getAllTagDefinitions()).find((item) => item.id === "backup-tag")
    }));
    assert.equal(related.note.collectionId, "backup-collection");
    assert.deepEqual(related.note.tags, ["backup-tag"]);
    assert.equal(related.collection.name, "追加コレクション");
    assert.equal(related.tag.name, "追加タグ");
    await page.locator("#cancelBackupPreviewBtn").click();

    await otherPage.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("tags", "readwrite");
        transaction.objectStore("tags").put({ id: "raw-tag", name: "旧タグ", createdAt: null, updatedAt: null });
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      });
    });
    const colorZip = await zipBytes(page, { id: "tag-color-migration", title: "タグ色補完", body: "本文", updatedAt: "2040-01-01T00:00:00.000Z" });
    await selectZip(page, colorZip);
    assert.match(await page.locator("#backupPreviewContent").innerText(), /タグ定義の追加・変更・補完（1件）/);
    await page.locator("#confirmBackupPreviewBtn").click();
    await page.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();
    assert.match(await page.evaluate(async () => new Promise((resolve) => {
      const request = db.transaction("tags", "readonly").objectStore("tags").get("raw-tag");
      request.onsuccess = () => resolve(request.result.color);
    })), /^#[0-9a-f]{6}$/i, "planned color migration is saved");
    await page.locator("#cancelBackupPreviewBtn").click();

    if (browserName === "chromium") {
      const replaceAsset = (value) => new Promise((resolve, reject) => {
        const transaction = db.transaction("attachments", "readwrite");
        transaction.objectStore("attachments").put({ id: "same-size-asset", memoId: "restore-a", fileName: "same.png",
          kind: "image", mimeType: "image/png", size: 1, blob: new Blob([Uint8Array.of(value)], { type: "image/png" }),
          createdAt: "2030-01-01T00:00:00.000Z" });
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      });
      await otherPage.evaluate(replaceAsset, 1);
      const byteConflictZip = await zipBytes(page, { id: "restore-a", title: "添付比較", body: "添付比較", updatedAt: "2060-01-01T00:00:00.000Z" });
      await selectZip(page, byteConflictZip);
      await otherPage.evaluate(replaceAsset, 2);
      await page.locator("#confirmBackupPreviewBtn").click();
      await page.locator("#backupPreviewStatus").getByText(/再確認してください/).waitFor();
      assert.deepEqual(await page.evaluate(async () => Array.from(new Uint8Array(await (await getAttachmentRecord("same-size-asset")).blob.arrayBuffer()))), [2]);
      await page.locator("#cancelBackupPreviewBtn").click();
    }

    await page.evaluate(() => {
      editor.value = "通常保存に失敗しても残す編集";
      window.originalBackupTestSave = saveCurrentNote;
      saveCurrentNote = async () => { throw new Error("テスト用の通常保存失敗"); };
    });
    await page.locator("#importMarkdownZipInput").setInputFiles({ name: "save-fail.zip", mimeType: "application/zip", buffer: attachmentConflict });
    await page.locator("#backupImportStatus").getByText(/通常保存失敗/).waitFor();
    assert.equal(await page.locator("#backupPreviewDialog").isVisible(), false);
    assert.equal(await storedNote(page, "restore-c"), null);
    assert.equal(await page.locator("#editor").inputValue(), "通常保存に失敗しても残す編集");
    await page.evaluate(() => { saveCurrentNote = window.originalBackupTestSave; });

    await page.evaluate(() => {
      window.originalBackupTestArrayBuffer = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () {
        if (this.name !== "slow.zip") return window.originalBackupTestArrayBuffer.call(this);
        return new Promise((resolve) => { window.releaseBackupTestRead = () => resolve(window.originalBackupTestArrayBuffer.call(this)); });
      };
    });
    await page.locator("#importMarkdownZipInput").setInputFiles({ name: "slow.zip", mimeType: "application/zip", buffer: attachmentConflict });
    await page.locator("#cancelBackupReadBtn").click();
    await page.evaluate(() => { window.releaseBackupTestRead(); File.prototype.arrayBuffer = window.originalBackupTestArrayBuffer; });
    await page.locator("#backupImportStatus").getByText(/キャンセルしました/).waitFor();
    assert.equal(await page.locator("#backupPreviewDialog").isVisible(), false, "late parse cannot reopen preview");

    const ordinaryZip = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await makeZip([
      { name: "ordinary.md", content: "# 通常ZIP\n\n通常本文" }
    ])).arrayBuffer()))));
    await page.locator("#importMarkdownZipInput").setInputFiles({ name: "ordinary.zip", mimeType: "application/zip", buffer: ordinaryZip });
    await page.waitForFunction(async () => (await getStoredNotes()).some((note) => note.body.includes("通常本文")));
    assert.equal(await page.locator("#backupPreviewDialog").isVisible(), false, "ordinary Markdown ZIP keeps old path");
    await page.locator("#settingsBtn").click();
    const assetZip = Buffer.from(await page.evaluate(async () => {
      const exportedAt = "2026-09-01T00:00:00.000Z";
      const markdown = serializeLocalNote(
        { id: "asset-restore", title: "添付付き", createdAt: exportedAt, updatedAt: "2040-01-01T00:00:00.000Z" },
        "![添付](attachment://asset-original)",
        [{ id: "asset-original", fileName: "asset-original.png", mimeType: "image/png", kind: "image" }]
      );
      const blob = await makeZip([
        { name: "manifest.json", content: JSON.stringify({ format: "memo-nexus-backup", version: 2, exportedAt }) },
        { name: "collections.json", content: "[]" }, { name: "tags.json", content: "[]" },
        { name: "notes/asset.md", content: markdown }, { name: "assets/asset-original.png", content: Uint8Array.of(1, 2, 3) }
      ]);
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }));
    await selectZip(page, assetZip);
    assert.match(await page.locator("#backupPreviewContent").innerText(), /添付の追加・置換・保持・欠損（1件）/);
    await page.locator("#confirmBackupPreviewBtn").click();
    if (browserName === "webkit") {
      // The baseline app also fails to store Blobs in local Windows Playwright WebKit.
      // Assert that this failure leaves neither the memo nor its asset behind.
      await page.locator("#backupPreviewStatus").getByText(/保存に失敗したため/).waitFor();
      assert.equal(await storedNote(page, "asset-restore"), null);
      assert.equal(await page.evaluate(async () => (await getAttachmentsForMemo("asset-restore")).length), 0);
    } else {
      await page.locator("#backupPreviewStatus").getByText(/取り込みが完了しました/).waitFor();
      assert.equal(await page.evaluate(async () => (await getAttachmentsForMemo("asset-restore")).length), 1);
    }
    await page.locator("#cancelBackupPreviewBtn").click();

    const tombstoneZip = await zipBytes(page, { id: "permanently-deleted", title: "削除済み", body: "復活しない", updatedAt: "2050-01-01T00:00:00.000Z" });
    await selectZip(page, tombstoneZip);
    await otherPage.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("note-tombstones", "readwrite");
        transaction.objectStore("note-tombstones").put({ noteId: "permanently-deleted", deletionId: "other-tab-delete",
          deletedAt: "2040-01-01T00:00:00.000Z", schemaVersion: 1 });
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      });
    });
    await page.locator("#confirmBackupPreviewBtn").click();
    await page.locator("#backupPreviewStatus").getByText(/再確認してください/).waitFor();
    await page.locator("#backupPreviewContent summary").getByText(/保護によりスキップするメモ（1件）/).waitFor();
    assert.match(await page.locator("#backupPreviewContent").innerText(), /保護によりスキップするメモ（1件）/);
    assert.equal(await page.locator("#confirmBackupPreviewBtn").isDisabled(), true);
    assert.equal(await storedNote(page, "permanently-deleted"), null);
    await page.locator("#cancelBackupPreviewBtn").click();
    assert.deepEqual(errors, [], "page errors");
    await context.close();
    process.stdout.write(`Backup restore E2E (${browserName}): PASS\n`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
