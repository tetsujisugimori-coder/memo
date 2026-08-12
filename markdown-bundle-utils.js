(function initMarkdownBundleUtils(globalScope) {
  "use strict";

  const MAX_IMPORT_ZIP_BYTES = 100 * 1024 * 1024;
  const IMAGE_MIME_BY_EXTENSION = new Map([
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
    ["gif", "image/gif"]
  ]);

  function readU16(view, offset) { return view.getUint16(offset, true); }
  function readU32(view, offset) { return view.getUint32(offset, true); }
  function safeZipPath(value) {
    const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
      throw new Error("ZIP内に安全でないパスがあります");
    }
    return normalized;
  }

  function parseStoredZipEntries(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    if (!bytes.length || bytes.length > MAX_IMPORT_ZIP_BYTES) throw new Error("ZIPは100MB以下にしてください");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const entries = [];
    let offset = 0;
    while (offset + 4 <= bytes.length) {
      const signature = readU32(view, offset);
      if (signature === 0x02014b50 || signature === 0x06054b50) break;
      if (signature !== 0x04034b50 || offset + 30 > bytes.length) throw new Error("Memo-Nexus形式のZIPとして読み取れません");
      const flags = readU16(view, offset + 6);
      const method = readU16(view, offset + 8);
      const compressedSize = readU32(view, offset + 18);
      const uncompressedSize = readU32(view, offset + 22);
      const nameLength = readU16(view, offset + 26);
      const extraLength = readU16(view, offset + 28);
      if (flags & 0x0001) throw new Error("暗号化ZIPには対応していません");
      if (flags & 0x0008) throw new Error("データ記述子付きZIPには対応していません");
      if (method !== 0 || compressedSize !== uncompressedSize) throw new Error("Memo-Nexusが出力した無圧縮ZIPを選択してください");
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > bytes.length) throw new Error("ZIPが途中で切れています");
      const name = safeZipPath(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)));
      if (!name.endsWith("/")) entries.push({ name, data: bytes.slice(dataStart, dataEnd) });
      offset = dataEnd;
    }
    if (!entries.length) throw new Error("ZIP内にファイルがありません");
    return entries;
  }

  function imageMimeType(fileName) {
    const extension = String(fileName || "").toLowerCase().match(/\.([^.]+)$/)?.[1] || "";
    return IMAGE_MIME_BY_EXTENSION.get(extension) || "";
  }

  function buildMarkdownBundleImport(entries, idFactory = () => `import-${Math.random().toString(36).slice(2)}`) {
    const files = new Map((Array.isArray(entries) ? entries : []).map((entry) => [safeZipPath(entry.name), entry]));
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const notes = [];
    for (const [markdownPath, markdownEntry] of files) {
      if (!/\.md$/i.test(markdownPath)) continue;
      const directory = markdownPath.includes("/") ? markdownPath.slice(0, markdownPath.lastIndexOf("/")) : "";
      const attachments = [];
      const idsByPath = new Map();
      const source = decoder.decode(markdownEntry.data);
      const body = source.replace(/!\[((?:\\.|[^\]\\\n])*)\]\(<attachments\/([^>\r\n]+)>\)/g, (match, alt, relativeName) => {
        const attachmentPath = [directory, "attachments", relativeName].filter(Boolean).join("/");
        const entry = files.get(attachmentPath);
        const mimeType = imageMimeType(relativeName);
        if (!entry || !mimeType) return match;
        let id = idsByPath.get(attachmentPath);
        if (!id) {
          id = idFactory();
          idsByPath.set(attachmentPath, id);
          attachments.push({ id, fileName: relativeName, mimeType, data: entry.data });
        }
        return `![${alt}](attachment://${id})`;
      });
      const fileName = markdownPath.split("/").pop() || "Webクリップ.md";
      notes.push({ title: fileName.replace(/\.md$/i, "") || "Webクリップ", body, attachments });
    }
    if (!notes.length) throw new Error("ZIP内にMarkdownファイルがありません");
    return notes;
  }

  const api = { MAX_IMPORT_ZIP_BYTES, buildMarkdownBundleImport, imageMimeType, parseStoredZipEntries };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusMarkdownBundleUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
