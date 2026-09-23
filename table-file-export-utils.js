(function initTableFileExportUtils(globalScope) {
  "use strict";

  const exportUtils = typeof module !== "undefined" && module.exports
    ? require("./export-utils.js")
    : globalScope.MemoNexusExportUtils;
  const { sanitizeWindowsName } = exportUtils;

  function tableFileExportName(title, tableIndex, extension) {
    const safeExtension = String(extension || "").toLowerCase();
    if (!/^(csv|tsv)$/.test(safeExtension)) throw new TypeError("書き出し形式が不正です。");
    const baseTitle = String(title == null ? "" : title).replace(/\.(?:csv|tsv)$/i, "");
    const baseName = sanitizeWindowsName(baseTitle, "無題のメモ", 110);
    const position = Math.max(0, Number.parseInt(tableIndex, 10) || 0) + 1;
    return `${baseName}-table-${position}.${safeExtension}`;
  }

  async function downloadTableFile(blob, fileName, doc = globalScope.document) {
    const view = doc && doc.defaultView;
    if (!blob || !view || !view.URL || typeof view.URL.createObjectURL !== "function") {
      throw new Error("ファイルを保存できませんでした。");
    }
    let url;
    let anchor;
    let started = false;
    try {
      url = view.URL.createObjectURL(blob);
      anchor = doc.createElement("a");
      anchor.download = fileName;
      anchor.href = url;
      anchor.hidden = true;
      anchor.setAttribute("aria-hidden", "true");
      doc.body.append(anchor);
      anchor.click();
      started = true;
    } finally {
      try {
        anchor?.remove();
        anchor?.removeAttribute("href");
        if (url) {
          // Let the activation task consume the URL before releasing it, including in WebKit.
          if (started && typeof view.MessageChannel === "function") {
            await new Promise((resolve) => {
              const channel = new view.MessageChannel();
              channel.port1.onmessage = () => {
                channel.port1.onmessage = null;
                channel.port1.close();
                channel.port2.close();
                resolve();
              };
              channel.port2.postMessage(null);
            });
          }
          view.URL.revokeObjectURL(url);
        }
      } catch (error) {
        if (!started) throw error;
      }
    }
  }

  const api = { downloadTableFile, tableFileExportName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusTableFileExportUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
