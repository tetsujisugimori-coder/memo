(function initLocalFsAdapter(globalScope) {
  "use strict";

  function supportStatus(scope = globalScope) {
    const host = String(scope?.location?.hostname || "");
    const secure = scope?.isSecureContext !== false || host === "localhost" || host === "127.0.0.1";
    if (!secure) return { supported: false, reason: "ローカルフォルダ保存はHTTPSまたはlocalhostで利用できます。" };
    if (typeof scope?.showDirectoryPicker !== "function") return { supported: false, reason: "このブラウザはローカルフォルダ保存に対応していません。Markdown ZIPの書出し・取込を利用してください。" };
    return { supported: true, reason: "" };
  }

  async function selectDirectory(scope = globalScope) {
    return scope.showDirectoryPicker({ mode: "readwrite" });
  }

  async function queryPermission(handle, mode = "readwrite") {
    if (!handle?.queryPermission) return "granted";
    return handle.queryPermission({ mode });
  }

  async function requestPermission(handle, mode = "readwrite") {
    if (!handle?.requestPermission) return "granted";
    return handle.requestPermission({ mode });
  }

  async function resolveWorkspaceRoot(selectedHandle, create = true) {
    if (!selectedHandle) throw new Error("ローカル保存フォルダが選択されていません");
    if (String(selectedHandle.name || "").toLocaleLowerCase() === "memo-nexus") return selectedHandle;
    return selectedHandle.getDirectoryHandle("Memo-Nexus", { create });
  }

  async function ensureWorkspaceLayout(selectedHandle) {
    const root = await resolveWorkspaceRoot(selectedHandle, true);
    const notes = await root.getDirectoryHandle("notes", { create: true });
    const assets = await root.getDirectoryHandle("assets", { create: true });
    const inbox = await root.getDirectoryHandle("inbox", { create: true });
    return { root, notes, assets, inbox };
  }

  function safeSegments(path) {
    const segments = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean);
    if (!segments.length || segments.includes("..")) throw new Error("安全でないローカルパスです");
    return segments;
  }

  async function directoryAt(root, segments, create = false) {
    let current = root;
    for (const segment of segments) current = await current.getDirectoryHandle(segment, { create });
    return current;
  }

  async function writeFile(root, path, content) {
    const segments = safeSegments(path);
    const fileName = segments.pop();
    const directory = await directoryAt(root, segments, true);
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(content);
      await writable.close();
    } catch (error) {
      if (typeof writable.abort === "function") await writable.abort().catch(() => {});
      throw error;
    }
    return fileHandle;
  }

  async function readFile(root, path) {
    const segments = safeSegments(path);
    const fileName = segments.pop();
    const directory = await directoryAt(root, segments, false);
    return (await directory.getFileHandle(fileName)).getFile();
  }

  async function readText(root, path) {
    return (await readFile(root, path)).text();
  }

  async function readJson(root, path, fallback) {
    try { return JSON.parse(await readText(root, path)); }
    catch (error) {
      if (error?.name === "NotFoundError") return fallback;
      throw error;
    }
  }

  async function writeJson(root, path, value) {
    return writeFile(root, path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async function collectMarkdown(directory, prefix, results) {
    if (!directory?.values) return;
    for await (const handle of directory.values()) {
      if (handle.kind === "file" && /\.md$/i.test(handle.name)) {
        const file = await handle.getFile();
        results.push({ path: `${prefix}${handle.name}`, name: handle.name, file, handle });
      }
    }
  }

  async function scanMarkdownFiles(selectedHandle) {
    const root = await resolveWorkspaceRoot(selectedHandle, false).catch(() => null);
    const results = [];
    await collectMarkdown(selectedHandle, "", results);
    if (root) {
      for (const name of ["inbox", "notes"]) {
        try { await collectMarkdown(await root.getDirectoryHandle(name), `${name}/`, results); }
        catch (error) { if (error?.name !== "NotFoundError") throw error; }
      }
    }
    return results.filter((item, index, all) => all.findIndex((candidate) => candidate.path === item.path && candidate.file.lastModified === item.file.lastModified) === index);
  }

  function configStore(db, storeName, mode = "readonly") {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function getConfig(db, storeName, key) {
    return new Promise((resolve, reject) => {
      const request = configStore(db, storeName).get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  }

  function putConfig(db, storeName, key, value) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put({ key, value });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  function deleteConfig(db, storeName, key) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  const api = {
    deleteConfig, ensureWorkspaceLayout, getConfig, putConfig, queryPermission, readFile, readJson,
    readText, requestPermission, resolveWorkspaceRoot, scanMarkdownFiles, selectDirectory,
    supportStatus, writeFile, writeJson
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusLocalFsAdapter = api;
})(typeof window !== "undefined" ? window : globalThis);
