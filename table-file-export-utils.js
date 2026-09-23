(function initTableFileExportUtils(globalScope) {
  "use strict";

  const exportUtils = typeof module !== "undefined" && module.exports
    ? require("./export-utils.js")
    : globalScope.MemoNexusExportUtils;
  const { sanitizeWindowsName } = exportUtils;

  function delimitedFileExportName(title, kind, index, extension) {
    const safeExtension = String(extension || "").toLowerCase();
    if (!/^(csv|tsv)$/.test(safeExtension)) throw new TypeError("書き出し形式が不正です。");
    if (!/^(table|chart)$/.test(kind)) throw new TypeError("書き出し対象が不正です。");
    const baseTitle = String(title == null ? "" : title).replace(/\.(?:csv|tsv)$/i, "");
    const baseName = sanitizeWindowsName(baseTitle, "無題のメモ", 110);
    const position = Math.max(0, Number.parseInt(index, 10) || 0) + 1;
    return `${baseName}-${kind}-${position}.${safeExtension}`;
  }

  function tableFileExportName(title, tableIndex, extension) {
    return delimitedFileExportName(title, "table", tableIndex, extension);
  }

  function chartFileExportName(title, chartIndex, extension) {
    return delimitedFileExportName(title, "chart", chartIndex, extension);
  }

  let pendingDelivery = null;
  async function downloadDelimitedFile(blob, fileName, doc = globalScope.document) {
    const view = doc && doc.defaultView;
    if (!blob || !view || !view.URL || typeof view.URL.createObjectURL !== "function") {
      throw new Error("ファイルを保存できませんでした。");
    }
    // WebKit may accept only the last of two anchors activated in the same task.
    // Keep each request's URL alive through its own delivery task before starting the next.
    const previousDelivery = pendingDelivery;
    let completeDelivery;
    const currentDelivery = new Promise((resolve) => { completeDelivery = resolve; });
    pendingDelivery = currentDelivery;
    try {
      if (previousDelivery) await previousDelivery;
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
          try {
            // Keep both the link and URL alive until WebKit consumes the navigation task.
            if (url && started && typeof view.MessageChannel === "function") {
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
          } finally {
            try {
              anchor?.remove();
              anchor?.removeAttribute("href");
            } finally {
              if (url) view.URL.revokeObjectURL(url);
            }
          }
        } catch (error) {
          if (!started) throw error;
        }
      }
    } finally {
      completeDelivery();
      if (pendingDelivery === currentDelivery) pendingDelivery = null;
    }
  }

  const downloadTableFile = downloadDelimitedFile;
  const api = { chartFileExportName, delimitedFileExportName, downloadDelimitedFile, downloadTableFile, tableFileExportName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusTableFileExportUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
