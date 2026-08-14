(function initBackupBundleUtils(globalScope) {
  "use strict";

  const BACKUP_FORMAT = "memo-nexus-backup";
  const BACKUP_VERSION = 1;
  // 新しい形式では migrateV1ToV2 のような関数をここへ登録し、ZIPは変更せずメモリ上で移行する。
  const MIGRATIONS = Object.freeze({});
  const IMAGE_MIME_BY_EXTENSION = Object.freeze({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf" });

  function asText(entry) {
    return new TextDecoder("utf-8", { fatal: true }).decode(entry.data);
  }

  function entryMap(entries) {
    return new Map((entries || []).map((entry) => [String(entry.name), entry]));
  }

  function parseManifest(entries) {
    const manifestEntry = entryMap(entries).get("manifest.json");
    if (!manifestEntry) return null;
    let manifest;
    try { manifest = JSON.parse(asText(manifestEntry)); }
    catch (_) { throw new Error("バックアップのmanifest.jsonが壊れています"); }
    if (manifest?.format !== BACKUP_FORMAT) throw new Error("Memo-Nexusバックアップ形式ではありません");
    if (!Number.isInteger(manifest.version) || manifest.version < 1) throw new Error("バックアップのバージョンが不正です");
    if (manifest.version > BACKUP_VERSION) throw new Error("このバックアップは新しいMemo-Nexus形式です。より新しいアプリで開いてください");
    if (!manifest.exportedAt || Number.isNaN(Date.parse(manifest.exportedAt))) throw new Error("バックアップの書き出し日時が不正です");
    return manifest;
  }

  function migrateBackup(manifest, payload) {
    let version = manifest.version;
    let current = { manifest: { ...manifest }, ...payload };
    while (version < BACKUP_VERSION) {
      const migrate = MIGRATIONS[version];
      if (typeof migrate !== "function") throw new Error("このバックアップ形式を移行できません");
      current = migrate(current);
      version += 1;
      current.manifest.version = version;
    }
    return current;
  }

  function isPortableBackup(entries) {
    return entryMap(entries).has("manifest.json");
  }

  function buildPortableBackupFiles({ manifest, collections = [], notePlans = [], assetPlans = [] } = {}) {
    if (!manifest || manifest.format !== BACKUP_FORMAT || manifest.version !== BACKUP_VERSION) throw new Error("バックアップmanifestが不正です");
    const files = [{ name: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n`, updatedAt: manifest.exportedAt }, { name: "collections.json", content: `${JSON.stringify(collections, null, 2)}\n`, updatedAt: manifest.exportedAt }];
    notePlans.forEach((plan) => files.push({ name: `notes/${plan.fileName}`, content: plan.markdown, updatedAt: plan.updatedAt || manifest.exportedAt }));
    assetPlans.forEach((asset) => files.push({ name: `assets/${asset.fileName}`, content: asset.blob || asset.data, updatedAt: asset.updatedAt || manifest.exportedAt }));
    return files;
  }

  function safeCollection(item) {
    if (!item || !item.id || !item.name) return null;
    return { id: String(item.id), name: String(item.name), parentId: item.parentId == null ? null : String(item.parentId), sortOrder: Number(item.sortOrder || 0), isSystem: Boolean(item.isSystem), createdAt: item.createdAt || null, updatedAt: item.updatedAt || null };
  }

  function normalizeCollections(items, skipped) {
    const collections = (items || []).map(safeCollection).filter(Boolean);
    const ids = new Set(collections.map((item) => item.id));
    return collections.map((collection) => {
      if (collection.parentId && (!ids.has(collection.parentId) || collection.parentId === collection.id)) {
        skipped.push(`collections/${collection.id}（親コレクションを解除）`);
        return { ...collection, parentId: null };
      }
      return collection;
    });
  }

  function mimeForAsset(path) {
    const extension = String(path).split(".").pop().toLowerCase();
    return IMAGE_MIME_BY_EXTENSION[extension] || "application/octet-stream";
  }

  function parsePortableBackup(entries, { parseNote, idFactory = () => `attachment-${Math.random().toString(36).slice(2)}` } = {}) {
    const manifest = parseManifest(entries);
    if (!manifest) return null;
    if (typeof parseNote !== "function") throw new Error("バックアップの読み込み処理を初期化できませんでした");
    const files = entryMap(entries);
    const skipped = [];
    const collections = [];
    const collectionsEntry = files.get("collections.json");
    if (collectionsEntry) {
      try {
        const source = JSON.parse(asText(collectionsEntry));
        if (!Array.isArray(source)) throw new Error("配列ではありません");
        source.forEach((item, index) => { if (!safeCollection(item)) skipped.push(`collections.json:${index + 1}`); });
        collections.push(...normalizeCollections(source, skipped));
      } catch (_) { skipped.push("collections.json"); }
    } else skipped.push("collections.json");

    const notes = [];
    for (const [path, entry] of files) {
      if (!path.startsWith("notes/") || !/\.md$/i.test(path)) continue;
      try {
        const firstPass = parseNote(asText(entry), {});
        const attachmentByPath = new Map();
        const attachmentMetadata = new Map((Array.isArray(firstPass.metadata?.attachments) ? firstPass.metadata.attachments : [])
          .filter((asset) => asset && asset.id && asset.fileName)
          .map((asset) => [String(asset.fileName), asset]));
        const referencedPaths = new Set(firstPass.assetPaths);
        attachmentMetadata.forEach((asset) => referencedPaths.add(`../assets/${encodeURIComponent(asset.fileName)}`));
        const noteAssets = [];
        referencedPaths.forEach((assetPath) => {
          const assetEntry = files.get(assetPath.replace(/^\.\.\//, ""));
          if (!assetEntry) { skipped.push(`${path}:${assetPath}`); return; }
          const id = idFactory();
          attachmentByPath.set(assetPath, id);
          const sourceMetadata = attachmentMetadata.get(decodeURIComponent(String(assetPath).replace(/^\.\.\/assets\//, ""))) || {};
          noteAssets.push({ id, fileName: decodeURIComponent(assetPath.split("/").pop()), mimeType: sourceMetadata.mimeType || mimeForAsset(assetPath), kind: sourceMetadata.kind || null, data: assetEntry.data });
        });
        const parsed = parseNote(asText(entry), { assets: [...attachmentByPath].map(([assetPath, id]) => ({ path: assetPath, id })) });
        const metadata = parsed.metadata || {};
        if (!metadata.memoNexusId) throw new Error("メモIDがありません");
        const note = {
          id: String(metadata.memoNexusId), title: String(metadata.title || "無題のメモ"), body: parsed.body || "",
          collectionId: metadata.collectionId == null ? null : String(metadata.collectionId), createdAt: metadata.createdAt || null,
          localCreatedAt: metadata.localCreatedAt || null, updatedAt: metadata.updatedAt || metadata.bodyUpdatedAt || null,
          bodyUpdatedAt: metadata.bodyUpdatedAt || metadata.updatedAt || null, localSavedAt: metadata.localSavedAt || null,
          isFlagged: Boolean(metadata.flagged), deletedAt: metadata.deletedAt || (metadata.trashed ? metadata.updatedAt : null),
          sortOrder: Number(metadata.sortOrder || 0), source: metadata.source || undefined,
          explanations: Array.isArray(metadata.explanations) ? metadata.explanations : undefined,
          fontSettings: metadata.fontSettings || undefined
        };
        notes.push({ note, attachments: noteAssets });
      } catch (_) { skipped.push(path); }
    }
    return migrateBackup(manifest, { collections, notes, skipped });
  }

  function timestamp(value) { const time = Date.parse(value); return Number.isFinite(time) ? time : 0; }
  function importedWins(existing, incoming) { return !existing || timestamp(incoming?.updatedAt) > timestamp(existing?.updatedAt); }

  const api = { BACKUP_FORMAT, BACKUP_VERSION, buildPortableBackupFiles, importedWins, isPortableBackup, migrateBackup, parseManifest, parsePortableBackup };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusBackupBundleUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
