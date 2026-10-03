(function initAttachmentUtils(globalScope) {
  "use strict";

  const exportUtils = typeof module !== "undefined" && module.exports
    ? require("./export-utils.js")
    : globalScope.MemoNexusExportUtils;
  const figureUtils = typeof module !== "undefined" && module.exports
    ? require("./figure-metadata-utils.js")
    : globalScope.MemoNexusFigureMetadataUtils;
  const { sanitizeWindowsName } = exportUtils;
  const { parseFigureMetadata, serializeFigureMetadata } = figureUtils;
  const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;
  const IMAGE_BLOCK_START = "<!-- memo-nexus:image-block -->";
  const IMAGE_BLOCK_CAPTION = "<!-- memo-nexus:image-caption -->";
  const IMAGE_BLOCK_END = "<!-- /memo-nexus:image-block -->";
  const IMAGE_BLOCK_SIZES = new Set(["small", "medium", "large"]);
  const IMAGE_BLOCK_ALIGNMENTS = new Set(["left", "center", "right"]);
  const IMAGE_BLOCK_ALIGNMENT_PATTERN = /^<!--\s*memo-nexus:image-align:([^\s>]+)\s*-->$/;
  const IMAGE_TYPES = new Map([
    ["image/jpeg", new Set(["jpg", "jpeg"])],
    ["image/png", new Set(["png"])],
    ["image/webp", new Set(["webp"])],
    ["image/gif", new Set(["gif"])]
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
    throw new Error(`「${file.name || "名称不明"}」は対応していない形式です。JPEG、PNG、WebP、GIF、PDFを選択してください`);
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

  function createKeyedSerialQueue() {
    const tails = new Map();
    return function enqueue(key, task) {
      const previous = tails.get(key) || Promise.resolve();
      const run = previous.then(() => task());
      const tail = run.then(() => undefined, () => undefined);
      tails.set(key, tail);
      tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return run;
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

  function resolveImportedAttachmentId({
    knownId,
    existingAttachment,
    targetMemoId,
    occupiedIds = [],
    createId
  } = {}) {
    const normalizedKnownId = String(knownId || "");
    const normalizedTargetMemoId = String(targetMemoId || "");
    if (
      normalizedKnownId &&
      normalizedTargetMemoId &&
      existingAttachment &&
      String(existingAttachment.id || "") === normalizedKnownId &&
      String(existingAttachment.memoId || "") === normalizedTargetMemoId
    ) return normalizedKnownId;
    if (typeof createId !== "function") throw new Error("新しい添付IDを生成できません");
    const occupied = new Set([...occupiedIds].map(String));
    if (normalizedKnownId) occupied.add(normalizedKnownId);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const generated = String(createId() || "");
      if (generated && !occupied.has(generated)) return generated;
    }
    throw new Error("重複しない添付IDを生成できません");
  }

  function escapeMarkdownLabel(value) {
    return String(value).replace(/([\\\[\]])/g, "\\$1");
  }

  function unescapeMarkdownLabel(value) {
    return String(value).replace(/\\([\\\[\]])/g, "$1");
  }

  function attachmentReferencePattern() {
    return /!\[((?:\\.|[^\]\\\n])*)\]\(attachment:\/\/([A-Za-z0-9-]+)\)/g;
  }

  function attachmentMarkdownReference(attachment) {
    const id = String(attachment && attachment.id || "").trim();
    if (!id || !/^[A-Za-z0-9-]+$/.test(id)) throw new Error("画像参照IDが不正です");
    const plainLabel = String(attachment.fileName || "画像").replace(/[\r\n]+/g, " ").trim() || "画像";
    const label = escapeMarkdownLabel(plainLabel);
    return `![${label}](attachment://${id})`;
  }

  function remapImportedAttachmentReferences(markdown, assets = []) {
    const replacements = new Map((Array.isArray(assets) ? assets : [])
      .filter((asset) => asset?.sourceId && asset?.id && asset.sourceId !== asset.id)
      .map((asset) => [String(asset.sourceId), String(asset.id)]));
    if (!replacements.size) return String(markdown || "");
    return String(markdown || "").replace(attachmentReferencePattern(), (match, escapedAlt, id) => {
      const replacementId = replacements.get(id);
      return replacementId ? `![${escapedAlt}](attachment://${replacementId})` : match;
    });
  }

  function normalizeImageBlockSize(value) {
    return IMAGE_BLOCK_SIZES.has(value) ? value : "medium";
  }

  function normalizeImageBlockAlignment(value) {
    return IMAGE_BLOCK_ALIGNMENTS.has(value) ? value : "center";
  }

  function parseImageBlockAlignment(line) {
    const match = String(line || "").trim().match(IMAGE_BLOCK_ALIGNMENT_PATTERN);
    return match ? normalizeImageBlockAlignment(match[1]) : null;
  }

  function parseImageReferenceLine(line) {
    const source = String(line || "");
    const reference = findAttachmentReference(source, 0);
    if (!reference || source.slice(0, reference.start).trim() || source.slice(reference.end).trim()) return null;
    return { id: reference.id, alt: reference.alt };
  }

  // Comparison is part of the image block. Labels travel with each image.
  function serializeImageComparisonLabel(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, label: value }));
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `<!-- memo-nexus:image-label:${hex} -->`;
  }

  function parseImageComparisonLabel(line) {
    const match = String(line || "").trim().match(/^<!-- memo-nexus:image-label:([0-9a-f]+) -->$/i);
    if (!match || match[1].length % 2) return null;
    try {
      const bytes = Uint8Array.from(match[1].match(/../g), (pair) => Number.parseInt(pair, 16));
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return value?.version === 1 && typeof value.label === "string" ? value.label : null;
    } catch (_) { return null; }
  }

  function serializeImageBlock(images, caption = "", alignment = "center", displayMode = "normal", figureId = "") {
    const normalizedImages = (Array.isArray(images) ? images : [])
      .filter((image) => image && image.id)
      .slice(0, 2)
      .map((image) => ({ id: String(image.id), fileName: image.alt || image.fileName || "画像", figureMetadata: image.figureMetadata, comparisonLabel: image.comparisonLabel }));
    if (!normalizedImages.length) return "";
    const normalizedAlignment = normalizeImageBlockAlignment(alignment);
    const lines = [IMAGE_BLOCK_START];
    if (typeof figureId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(figureId)) lines.push(`<!-- memo-nexus:figure-id:${figureId} -->`);
    if (displayMode === "comparison" && normalizedImages.length === 2) lines.push("<!-- memo-nexus:image-mode:comparison -->");
    if (normalizedAlignment !== "center") lines.push(`<!-- memo-nexus:image-align:${normalizedAlignment} -->`);
    normalizedImages.forEach((image) => {
      lines.push(attachmentMarkdownReference(image));
      const marker = serializeFigureMetadata(image.figureMetadata);
      if (marker) lines.push(marker);
      const labelMarker = serializeImageComparisonLabel(image.comparisonLabel);
      if (labelMarker) lines.push(labelMarker);
    });
    const normalizedCaption = String(caption || "").replace(/\r\n?/g, "\n").trim();
    if (normalizedCaption) lines.push("", IMAGE_BLOCK_CAPTION, normalizedCaption);
    lines.push(IMAGE_BLOCK_END);
    return lines.join("\n");
  }

  function splitImageBlocks(markdown) {
    const source = String(markdown || "").replace(/\r\n?/g, "\n");
    const lines = source.split("\n");
    const offsets = [];
    let offset = 0;
    lines.forEach((line, index) => {
      offsets.push(offset);
      offset += line.length + (index < lines.length - 1 ? 1 : 0);
    });
    const segments = [];
    let textStart = 0;
    let index = 0;
    let inCodeFence = false;

    const pushText = (end) => {
      if (end > textStart) segments.push({ type: "text", text: source.slice(textStart, end), start: textStart, end });
    };
    const pushImage = (startLine, endLine, images, caption, explicit, alignment = "center", displayMode = "normal", figureId = "") => {
      const start = offsets[startLine];
      const end = endLine < lines.length - 1 ? offsets[endLine] + lines[endLine].length + 1 : source.length;
      pushText(start);
      segments.push({
        type: "image",
        start,
        end,
        raw: source.slice(start, end).replace(/\n$/, ""),
        images,
        ...(figureId ? { figureId } : {}),
        caption,
        explicit,
        alignment: normalizeImageBlockAlignment(alignment),
        displayMode: displayMode === "comparison" && images.length === 2 ? "comparison" : "normal"
      });
      textStart = end;
    };

    while (index < lines.length) {
      if (/^```/.test(lines[index].trim())) {
        inCodeFence = !inCodeFence;
        index += 1;
        continue;
      }
      if (inCodeFence) {
        index += 1;
        continue;
      }
      if (lines[index].trim() === IMAGE_BLOCK_START) {
        let endLine = index + 1;
        while (endLine < lines.length && lines[endLine].trim() !== IMAGE_BLOCK_END) endLine += 1;
        if (endLine < lines.length) {
          const content = lines.slice(index + 1, endLine);
          const captionIndex = content.findIndex((line) => line.trim() === IMAGE_BLOCK_CAPTION);
          const blockLines = captionIndex === -1 ? content : content.slice(0, captionIndex);
          const alignmentLines = blockLines.filter((line) => parseImageBlockAlignment(line) !== null);
          const modeLines = blockLines.filter((line) => /^<!--\s*memo-nexus:image-mode:/.test(line.trim()));
          const figureIdLines = blockLines.filter((line) => /^<!-- memo-nexus:figure-id:/.test(line.trim()));
          const figureIdMatch = figureIdLines.length === 1 && figureIdLines[0].trim().match(/^<!-- memo-nexus:figure-id:([A-Za-z0-9_-]{1,128}) -->$/);
          const figureId = figureIdMatch ? figureIdMatch[1] : "";
          const imageLines = blockLines.filter((line) => parseImageBlockAlignment(line) === null && !modeLines.includes(line) && !figureIdLines.includes(line));
          const images = [];
          let valid = true;
          imageLines.filter((line) => line.trim()).forEach((line) => {
            const image = parseImageReferenceLine(line);
            if (image) { images.push(image); return; }
            // Invalid or future comparison settings must not break image references.
            if (/^<!--\s*memo-nexus:image-label:/.test(line.trim())) {
              const label = parseImageComparisonLabel(line);
              if (label !== null && images.length) images[images.length - 1].comparisonLabel = label;
              return;
            }
            const metadata = parseFigureMetadata(line);
            if (metadata && images.length && !images[images.length - 1].figureMetadata) {
              images[images.length - 1].figureMetadata = metadata;
            } else valid = false;
          });
          if (valid && images.length >= 1 && images.length <= 2) {
            const caption = captionIndex === -1 ? "" : content.slice(captionIndex + 1).join("\n").trim();
            const alignment = alignmentLines.length === 1 ? parseImageBlockAlignment(alignmentLines[0]) : "center";
            const displayMode = modeLines.length === 1 && modeLines[0].trim() === "<!-- memo-nexus:image-mode:comparison -->" ? "comparison" : "normal";
            pushImage(index, endLine, images, caption, true, alignment, displayMode, figureId);
            index = endLine + 1;
            continue;
          }
        }
      }

      const firstImage = parseImageReferenceLine(lines[index]);
      if (firstImage) {
        pushImage(index, index, [firstImage], "", false);
        index += 1;
        continue;
      }
      index += 1;
    }

    pushText(source.length);
    return segments;
  }

  // A copied block has no reliable "original" identity. Retire every occurrence
  // of a conflicting ID, leaving Timeline references unresolved until reselection.
  // Removing just one occurrence would silently redirect references on deletion.
  function removeDuplicateFigureIds(markdown) {
    const original = String(markdown || "");
    if (!original.includes("memo-nexus:figure-id:")) return { body: original, removals: [] };
    const source = original.replace(/\r\n?/g, "\n");
    const blocks = splitImageBlocks(source).filter((block) => block.type === "image" && block.figureId);
    const counts = new Map();
    blocks.forEach((block) => counts.set(block.figureId, (counts.get(block.figureId) || 0) + 1));
    const removals = [];
    blocks.filter((block) => counts.get(block.figureId) > 1).forEach((block) => {
      const marker = /^[ \t]*<!-- memo-nexus:figure-id:[A-Za-z0-9_-]{1,128} -->[ \t]*\n/gm.exec(block.raw);
      if (marker) removals.push({ start: block.start + marker.index, end: block.start + marker.index + marker[0].length });
    });
    let body = source;
    for (const removal of [...removals].reverse()) body = body.slice(0, removal.start) + body.slice(removal.end);
    return { body: removals.length ? body : original, removals };
  }

  async function saveAttachmentAdditionWithRollback({ attachments, validate, save, apply, rollback }) {
    const additions = Array.isArray(attachments) ? attachments : [];
    validate();
    await save(additions);
    try {
      validate();
      await apply(additions);
      return additions;
    } catch (error) {
      try {
        await rollback(additions);
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }
  }

  async function prepareAttachmentItems({ files, noteId, prepare, assertActive, onProgress = () => {} }) {
    if (typeof prepare !== "function") throw new Error("prepare is required");
    if (typeof assertActive !== "function") throw new Error("assertActive is required");
    const sourceFiles = Array.from(files || []);
    const prepared = [];
    assertActive(noteId);
    for (let index = 0; index < sourceFiles.length; index += 1) {
      assertActive(noteId);
      onProgress(sourceFiles[index], index, sourceFiles.length);
      const item = await prepare(sourceFiles[index], index);
      assertActive(noteId);
      prepared.push(item);
    }
    return prepared;
  }

  function replaceImageBlock(markdown, block, images, caption = "", alignment = block && block.alignment, displayMode = block && block.displayMode, figureId = block && block.figureId) {
    const source = String(markdown || "").replace(/\r\n?/g, "\n");
    if (!block || source.slice(block.start, block.end).replace(/\n$/, "") !== block.raw) {
      throw new Error("画像ブロックが更新されたため操作できません。もう一度お試しください");
    }
    const replacement = serializeImageBlock(images, caption, alignment, displayMode, figureId);
    const prefix = replacement && block.start > 0 && source[block.start - 1] !== "\n" ? "\n" : "";
    const suffix = replacement && block.end < source.length && source[block.end] !== "\n" ? "\n" : "";
    return `${source.slice(0, block.start)}${prefix}${replacement}${suffix}${source.slice(block.end)}`;
  }

  function escapeCaptionHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function safeCaptionHref(value) {
    const href = String(value || "").trim();
    return /^(https?:\/\/|mailto:|#)/i.test(href) ? href : "";
  }

  function renderImageCaptionInline(text) {
    const source = String(text || "");
    const patterns = [
      { type: "code", pattern: /`([^`\n]+)`/ },
      { type: "bold", pattern: /\*\*([^*\n]+)\*\*/ },
      { type: "italic", pattern: /\*([^*\n]+)\*/ },
      { type: "link", pattern: /(^|[^!])\[([^\]\n]+)\]\(([^)\s]+)\)/ }
    ];
    let html = "";
    let index = 0;
    while (index < source.length) {
      const matches = patterns.map(({ type, pattern }) => {
        const match = pattern.exec(source.slice(index));
        return match ? { type, match, start: index + match.index, end: index + match.index + match[0].length } : null;
      }).filter(Boolean).sort((a, b) => a.start - b.start || a.end - b.end);
      const token = matches[0];
      if (!token) {
        html += escapeCaptionHtml(source.slice(index));
        break;
      }
      html += escapeCaptionHtml(source.slice(index, token.start));
      if (token.type === "code") html += `<code class="inline-code">${escapeCaptionHtml(token.match[1])}</code>`;
      if (token.type === "bold") html += `<strong>${renderImageCaptionInline(token.match[1])}</strong>`;
      if (token.type === "italic") html += `<em>${renderImageCaptionInline(token.match[1])}</em>`;
      if (token.type === "link") {
        const prefix = token.match[1];
        const label = token.match[2];
        const href = safeCaptionHref(token.match[3]);
        html += escapeCaptionHtml(prefix);
        html += href
          ? `<a href="${escapeCaptionHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeCaptionHtml(label)}</a>`
          : escapeCaptionHtml(`[${label}](${token.match[3]})`);
      }
      index = token.end;
    }
    return html;
  }

  function renderImageCaptionMarkdown(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    let index = 0;
    while (index < lines.length) {
      if (!lines[index].trim()) {
        index += 1;
        continue;
      }
      if (/^\s*-\s+/.test(lines[index])) {
        const items = [];
        while (index < lines.length && /^\s*-\s+/.test(lines[index])) {
          items.push(`<li>${renderImageCaptionInline(lines[index].replace(/^\s*-\s+/, ""))}</li>`);
          index += 1;
        }
        html.push(`<ul>${items.join("")}</ul>`);
        continue;
      }
      const paragraph = [];
      while (index < lines.length && lines[index].trim() && !/^\s*-\s+/.test(lines[index])) {
        paragraph.push(renderImageCaptionInline(lines[index]));
        index += 1;
      }
      html.push(`<p>${paragraph.join("<br>")}</p>`);
    }
    return html.join("");
  }

  function insertAttachmentReferences(markdown, selectionStart, selectionEnd, attachments) {
    const source = String(markdown || "");
    const requestedStart = Math.min(source.length, Math.max(0, Number(selectionStart) || 0));
    const requestedEnd = Math.min(source.length, Math.max(requestedStart, Number(selectionEnd) || requestedStart));
    const start = safeAttachmentReferenceBoundary(source, requestedStart);
    const end = safeAttachmentReferenceBoundary(source, Math.max(start, requestedEnd));
    const images = (Array.isArray(attachments) ? attachments : [])
      .filter((attachment) => attachment && attachment.kind === "image");
    const imageBlocks = [];
    for (let index = 0; index < images.length; index += 2) {
      imageBlocks.push(serializeImageBlock(images.slice(index, index + 2)));
    }
    const references = imageBlocks.join("\n\n");
    const prefix = references && start > 0 && source[start - 1] !== "\n" ? "\n" : "";
    const suffix = references && end < source.length && source[end] !== "\n" ? "\n" : "";
    const insertedText = `${prefix}${references}${suffix}`;
    return {
      value: `${source.slice(0, start)}${insertedText}${source.slice(end)}`,
      selectionStart: start + insertedText.length,
      selectionEnd: start + insertedText.length,
      insertedText
    };
  }

  function safeAttachmentReferenceBoundary(markdown, position) {
    let fromIndex = 0;
    let reference;
    while ((reference = findAttachmentReference(markdown, fromIndex))) {
      if (position > reference.start && position < reference.end) return reference.end;
      if (reference.start >= position) break;
      fromIndex = reference.end;
    }
    return position;
  }

  function findAttachmentReference(markdown, fromIndex = 0) {
    const pattern = attachmentReferencePattern();
    pattern.lastIndex = Math.max(0, Number(fromIndex) || 0);
    const match = pattern.exec(String(markdown || ""));
    if (!match) return null;
    return {
      start: match.index,
      end: pattern.lastIndex,
      alt: unescapeMarkdownLabel(match[1]),
      id: match[2]
    };
  }

  function extractAttachmentReferenceIds(markdown) {
    const ids = new Set();
    let fromIndex = 0;
    let reference;
    while ((reference = findAttachmentReference(markdown, fromIndex))) {
      ids.add(reference.id);
      fromIndex = reference.end;
    }
    return ids;
  }

  function replaceAttachmentReferencesForExport(markdown, exportedAttachments) {
    const fileNamesById = new Map(exportedAttachments
      .filter(({ attachment }) => attachment && attachment.id)
      .map(({ attachment, fileName }) => [attachment.id, fileName]));
    return String(markdown || "").replace(attachmentReferencePattern(), (match, escapedAlt, id) => {
      const fileName = fileNamesById.get(id);
      return fileName ? `![${escapedAlt}](<attachments/${fileName}>)` : match;
    });
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
    const referencedIds = extractAttachmentReferenceIds(markdownContent);
    const markdownWithExportPaths = replaceAttachmentReferencesForExport(markdownContent, exportedAttachments);
    const exportedMarkdown = appendAttachmentReferences(
      markdownWithExportPaths,
      exportedAttachments.filter(({ attachment }) => !referencedIds.has(attachment.id))
    );
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
    attachmentMarkdownReference,
    buildMemoExportBundle,
    classifyAttachment,
    createKeyedSerialQueue,
    extractAttachmentReferenceIds,
    fileExtension,
    findAttachmentReference,
    formatAttachmentBytes,
    insertAttachmentReferences,
    normalizeImageBlockAlignment,
    normalizeImageBlockSize,
    prepareAttachmentItems,
    renderImageCaptionMarkdown,
    remapImportedAttachmentReferences,
    resolveImportedAttachmentId,
    replaceImageBlock,
    removeDuplicateFigureIds,
    saveAttachmentAdditionWithRollback,
    serializeImageBlock,
    splitImageBlocks,
    uniqueAttachmentFileName
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusAttachmentUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
