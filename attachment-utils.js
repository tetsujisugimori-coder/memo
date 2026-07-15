(function initAttachmentUtils(globalScope) {
  "use strict";

  const exportUtils = typeof module !== "undefined" && module.exports
    ? require("./export-utils.js")
    : globalScope.MemoNexusExportUtils;
  const { sanitizeWindowsName } = exportUtils;
  const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;
  const IMAGE_TYPES = new Map([
    ["image/jpeg", new Set(["jpg", "jpeg"])],
    ["image/png", new Set(["png"])],
    ["image/webp", new Set(["webp"])]
  ]);

  function fileExtension(fileName) {
    const match = String(fileName || "").toLocaleLowerCase().match(/\.([^.]+)$/);
    return match ? match[1] : "";
  }

  function classifyAttachment(file) {
    const mimeType = String(file && file.type || "").toLocaleLowerCase();
    const extension = fileExtension(file && file.name);
    if (!file || !Number.isFinite(file.size) || file.size <= 0) {
      throw new Error("空のファイルは添付できません");
    }
    if (IMAGE_TYPES.has(mimeType) && IMAGE_TYPES.get(mimeType).has(extension)) return "image";
    if (mimeType === "application/pdf" && extension === "pdf") return "pdf";
    throw new Error(`「${file.name || "名称不明"}」は対応していない形式です。JPEG、PNG、WebP、PDFを選択してください`);
  }

  function attachmentCapacity(existingBytes, additionalBytes, limit = MAX_ATTACHMENT_TOTAL_BYTES) {
    const current = Math.max(0, Number(existingBytes) || 0);
    const additional = Math.max(0, Number(additionalBytes) || 0);
    const total = current + additional;
    return {
      current,
      additional,
      total,
      limit,
      exceededBy: Math.max(0, total - limit),
      allowed: total <= limit
    };
  }

  function formatAttachmentBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function uniqueAttachmentFileName(fileName, usedNames) {
    const extensionIndex = fileName.lastIndexOf(".");
    const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
    const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
    let candidate = fileName;
    let suffix = 2;
    while (usedNames.has(candidate.toLocaleLowerCase())) {
      candidate = `${baseName}_${suffix}${extension}`;
      suffix += 1;
    }
    usedNames.add(candidate.toLocaleLowerCase());
    return candidate;
  }

  function escapeMarkdownLabel(value) {
    return String(value).replace(/([\\\[\]])/g, "\\$1");
  }

  function appendAttachmentReferences(markdown, exportedAttachments) {
    if (!exportedAttachments.length) return String(markdown || "");
    const lines = ["## 添付ファイル", ""];
    exportedAttachments.forEach(({ attachment, fileName }) => {
      const label = escapeMarkdownLabel(fileName);
      const target = `<attachments/${fileName}>`;
      lines.push(attachment.kind === "image" ? `![${label}](${target})` : `- [${label}](${target})`);
    });
    return `${String(markdown || "").replace(/\s*$/, "")}\n\n${lines.join("\n")}\n`;
  }

  function buildMemoExportBundle({ markdownPath, markdownContent, attachments, reservedDirectoryPaths = [] }) {
    const sourceAttachments = Array.isArray(attachments) ? attachments : [];
    if (!sourceAttachments.length) {
      return { folderPath: null, files: [{ name: markdownPath, content: markdownContent }] };
    }

    const parts = String(markdownPath).split("/").filter(Boolean);
    const markdownName = parts.pop() || "無題のメモ.md";
    const extensionIndex = markdownName.lastIndexOf(".");
    const requestedFolder = sanitizeWindowsName(
      extensionIndex > 0 ? markdownName.slice(0, extensionIndex) : markdownName,
      "無題のメモ"
    );
    const parentPath = parts.join("/");
    const reserved = new Set([...reservedDirectoryPaths].map((path) => String(path).toLocaleLowerCase()));
    let folderName = requestedFolder;
    let suffix = 2;
    let folderPath = [parentPath, folderName].filter(Boolean).join("/");
    while (reserved.has(folderPath.toLocaleLowerCase())) {
      folderName = `${requestedFolder} (${suffix})`;
      suffix += 1;
      folderPath = [parentPath, folderName].filter(Boolean).join("/");
    }

    const usedAttachmentNames = new Set();
    const exportedAttachments = sourceAttachments.map((attachment, index) => {
      const fallback = attachment.kind === "pdf" ? `document_${index + 1}.pdf` : `image_${index + 1}`;
      const safeName = sanitizeWindowsName(attachment.fileName, fallback, 140);
      return { attachment, fileName: uniqueAttachmentFileName(safeName, usedAttachmentNames) };
    });
    const exportedMarkdown = appendAttachmentReferences(markdownContent, exportedAttachments);
    const files = [{
      name: `${folderPath}/${folderName}.md`,
      content: exportedMarkdown
    }];
    exportedAttachments.forEach(({ attachment, fileName }) => {
      files.push({
        name: `${folderPath}/attachments/${fileName}`,
        content: attachment.blob,
        updatedAt: attachment.createdAt
      });
    });
    return { folderPath, files };
  }

  const api = {
    MAX_ATTACHMENT_TOTAL_BYTES,
    attachmentCapacity,
    buildMemoExportBundle,
    classifyAttachment,
    fileExtension,
    formatAttachmentBytes,
    uniqueAttachmentFileName
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusAttachmentUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
