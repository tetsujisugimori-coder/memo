(function initExportUtils(globalScope) {
  "use strict";

  const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

  function sanitizeWindowsName(value, fallback = "untitled", maxLength = 80) {
    const original = String(value == null ? "" : value).trim();
    let safe = original
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, maxLength)
      .replace(/[. ]+$/g, "");

    if (!safe) safe = String(fallback || "untitled").trim() || "untitled";
    if (WINDOWS_RESERVED_NAME.test(safe)) safe = `_${safe}`;
    return safe.slice(0, maxLength).replace(/[. ]+$/g, "") || "untitled";
  }

  function uniqueFileName(fileName, usedNames) {
    const extensionIndex = fileName.lastIndexOf(".");
    const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
    const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
    let candidate = fileName;
    let suffix = 2;

    while (usedNames.has(candidate.toLocaleLowerCase())) {
      candidate = `${baseName} (${suffix})${extension}`;
      suffix += 1;
    }

    usedNames.add(candidate.toLocaleLowerCase());
    return candidate;
  }

  function uniqueDirectoryName(name, usedNames) {
    let candidate = name;
    let suffix = 2;
    while (usedNames.has(candidate.toLocaleLowerCase())) {
      candidate = `${name} (${suffix})`;
      suffix += 1;
    }
    usedNames.add(candidate.toLocaleLowerCase());
    return candidate;
  }

  function buildCollectionLocalPlan(collections, notes, rootCollectionId) {
    const collectionMap = new Map(collections.map((collection) => [collection.id, collection]));
    if (!collectionMap.has(rootCollectionId)) throw new Error("コレクションが存在しません");

    const relativePaths = new Map([[rootCollectionId, []]]);
    const directories = [];
    const visit = (parentId, ancestors) => {
      const usedDirectoryNames = new Set();
      collections
        .filter((collection) => collection.parentId === parentId && !collection.isSystem)
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
        .forEach((collection) => {
          if (ancestors.has(collection.id)) return;
          const safeName = uniqueDirectoryName(
            sanitizeWindowsName(collection.name, "無題のコレクション"),
            usedDirectoryNames
          );
          const path = [...(relativePaths.get(parentId) || []), safeName];
          relativePaths.set(collection.id, path);
          directories.push(path);
          visit(collection.id, new Set([...ancestors, collection.id]));
        });
    };
    visit(rootCollectionId, new Set([rootCollectionId]));

    const usedFilesByDirectory = new Map();
    const files = notes
      .filter((note) => !note.deletedAt && relativePaths.has(note.collectionId))
      .map((note) => {
        const directoryPath = relativePaths.get(note.collectionId);
        const directoryKey = directoryPath.join("/").toLocaleLowerCase();
        if (!usedFilesByDirectory.has(directoryKey)) usedFilesByDirectory.set(directoryKey, new Set());
        const baseName = sanitizeWindowsName(note.title, "無題のメモ");
        const name = uniqueFileName(`${baseName}.md`, usedFilesByDirectory.get(directoryKey));
        return {
          memoId: note.id,
          title: note.title || "無題のメモ",
          directoryPath: [...directoryPath],
          name,
          content: String(note.body == null ? "" : note.body)
        };
      });

    return { directories, files };
  }

  function supportsDirectoryPicker(scope = globalScope) {
    return Boolean(scope && typeof scope.showDirectoryPicker === "function");
  }

  function hasNameCollision(existingNames, requestedName) {
    const target = String(requestedName).toLocaleLowerCase();
    return [...existingNames].some((name) => String(name).toLocaleLowerCase() === target);
  }

  const api = {
    buildCollectionLocalPlan,
    hasNameCollision,
    sanitizeWindowsName,
    supportsDirectoryPicker,
    uniqueFileName
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusExportUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
