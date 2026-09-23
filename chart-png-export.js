"use strict";
(function (scope) {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MAX_EDGE = 4096;
  const MAX_PIXELS = 16000000;
  const svgDownloads = new WeakMap();
  const DRAW_STYLES = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "opacity", "font-family", "font-size", "font-weight", "font-style", "font-variant-numeric", "letter-spacing", "text-anchor", "dominant-baseline", "paint-order", "visibility", "color"];

  function chartPngFilename(title) {
    let name = String(title ?? "").replace(/[\x00-\x1f\x7f-\x9f<>:"/\\|?*]/g, "_").trim().replace(/[ .]+$/g, "");
    name = name.replace(/(?:\.png)+$/ig, "").replace(/[ .]+$/g, "");
    name = Array.from(name).slice(0, 80).join("").replace(/[ .]+$/g, "").replace(/(?:\.png)+$/ig, "").replace(/[ .]+$/g, "");
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = "_" + Array.from(name).slice(0, 79).join("");
    return (name || "memo-nexus-chart") + ".png";
  }

  function chartPngDimensions(width, height) {
    if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error("画像の寸法が不正です");
    // Divide before multiplying, including for subnormal or MAX_VALUE inputs.
    const longest = Math.max(width, height);
    const ratioW = width / longest, ratioH = height / longest;
    const edge = Math.min(longest <= MAX_EDGE / 2 ? longest * 2 : MAX_EDGE,
      Math.sqrt(MAX_PIXELS / (ratioW * ratioH)));
    const outputWidth = Math.floor(edge * ratioW), outputHeight = Math.floor(edge * ratioH);
    if (outputWidth < 1 || outputHeight < 1) throw new Error("画像の寸法が小さすぎるか、縦横比が極端なため画像化できません");
    return { width: outputWidth, height: outputHeight, scale: edge / longest };
  }

  // measure is supplied by the browser's text metrics; no input or chart data is mutated.
  function chartPngTextLines(text, width, measure, maxLines = 3) {
    const lines = [""];
    for (const character of String(text).replace(/\s+/g, " ")) {
      const index = lines.length - 1;
      if (measure(lines[index] + character) <= width) { lines[index] += character; continue; }
      if (lines.length < maxLines) { lines.push(character); continue; }
      let last = Array.from(lines[index]);
      while (last.length && measure(last.join("") + "…") > width) last.pop();
      lines[index] = last.join("") + "…";
      break;
    }
    return lines;
  }

  function svgElement(doc, name, attributes = {}, text) {
    const element = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function chartPngTheme(card) {
    const view = card.ownerDocument.defaultView;
    const style = view.getComputedStyle(card);
    const axis = card.querySelector(".chart-block-axis");
    return { background: style.getPropertyValue("--section-bg").trim(),
      text: style.getPropertyValue("--ink").trim(),
      axis: axis ? view.getComputedStyle(axis).stroke : style.getPropertyValue("--muted").trim(),
      font: style.fontFamily };
  }

  function captureChartPng(card) {
    const source = card?.querySelector(".chart-block-scroll > svg");
    if (!source) throw new Error("画像化できるグラフがありません");
    const box = source.viewBox.baseVal;
    chartPngDimensions(box.width, box.height);
    const svg = source.cloneNode(true);
    const originals = [source, ...source.querySelectorAll("*")];
    const copies = [svg, ...svg.querySelectorAll("*")];
    const view = card.ownerDocument.defaultView;
    originals.forEach((original, index) => {
      const clone = copies[index], computed = view.getComputedStyle(original);
      clone.removeAttribute("style");
      DRAW_STYLES.forEach(property => clone.style.setProperty(property, computed.getPropertyValue(property)));
      for (const attribute of [...clone.attributes]) {
        if (/^(?:on|data-|aria-)/.test(attribute.name) || ["class", "id", "tabindex", "role"].includes(attribute.name)) clone.removeAttribute(attribute.name);
        else if (attribute.value.includes("var(")) clone.removeAttribute(attribute.name); // resolved style takes precedence
      }
    });
    svg.querySelectorAll("title, desc").forEach(element => element.remove());
    svg.setAttribute("width", box.width);
    svg.setAttribute("height", box.height);
    svg.setAttribute("overflow", "visible");
    return { svg, width: box.width, height: box.height, theme: chartPngTheme(card),
      title: card.querySelector(":scope > figcaption")?.textContent || "",
      legend: [...card.querySelectorAll(".chart-block-legend > li")].map(item => {
        const swatch = item.firstElementChild;
        const line = swatch.classList.contains("chart-block-line-legend-swatch");
        const style = view.getComputedStyle(swatch);
        return { text: item.lastElementChild.textContent, line, color: line ? style.color : style.backgroundColor };
      }),
      noticeColor: card.querySelector(":scope > .chart-block-series-notice") ? view.getComputedStyle(card.querySelector(":scope > .chart-block-series-notice")).color : null,
      notice: card.querySelector(":scope > .chart-block-series-notice")?.textContent || "" };
  }

  function composeChartPng(capture) {
    const { svg, width, height, theme, title, legend, notice } = capture;
    const doc = svg.ownerDocument;
    const measureCanvas = doc.createElement("canvas");
    try {
      const context = measureCanvas.getContext("2d");
      if (!context) throw new Error("画像作成用のCanvasを利用できません");
      const padding = 20, outputWidth = width + padding * 2;
      const output = svgElement(doc, "svg", { width: outputWidth });
      let y = padding;
      const addText = (text, x, fontSize, maxLines, weight = "400", color = theme.text) => {
        context.font = weight + " " + fontSize + "px " + theme.font;
        const lines = chartPngTextLines(text, outputWidth - padding - x, value => context.measureText(value).width, maxLines);
        lines.forEach((line, index) => output.append(svgElement(doc, "text", {
          x, y: y + fontSize + index * (fontSize + 6), fill: color,
          "font-family": theme.font, "font-size": fontSize, "font-weight": weight
        }, line)));
        return lines.length * (fontSize + 6);
      };
      y += addText(title, padding, 18, 3, "700") + 8;
      const plot = svg.cloneNode(true);
      plot.setAttribute("x", padding); plot.setAttribute("y", y);
      output.append(plot);
      y += height + 12;
      for (const entry of legend) {
        if (entry.line) {
          output.append(svgElement(doc, "line", { x1: padding, x2: padding + 20, y1: y + 8, y2: y + 8, stroke: entry.color, "stroke-width": 3 }));
          output.append(svgElement(doc, "circle", { cx: padding + 10, cy: y + 8, r: 3, fill: theme.background, stroke: entry.color, "stroke-width": 2 }));
        } else output.append(svgElement(doc, "circle", { cx: padding + 8, cy: y + 8, r: 6, fill: entry.color }));
        y += addText(entry.text, padding + 28, 12, 2) + 5;
      }
      if (notice) { y += 8; y += addText(notice, padding, 12, 3, "400", capture.noticeColor || theme.text); }
      const outputHeight = y + padding;
      const dimensions = chartPngDimensions(outputWidth, outputHeight);
      output.setAttribute("height", outputHeight);
      output.setAttribute("viewBox", "0 0 " + outputWidth + " " + outputHeight);
      output.prepend(svgElement(doc, "rect", { width: outputWidth, height: outputHeight, fill: theme.background }));
      return { svg: output, dimensions, background: theme.background };
    } finally { measureCanvas.width = 0; measureCanvas.height = 0; }
  }

  function validateChartPngBlob(blob) {
    if (!blob || blob.type !== "image/png" || blob.size < 33) throw pngError("invalid-png", "有効なPNG画像を生成できませんでした");
    return blob;
  }

  async function chartPngBlob(plan, signal) {
    const doc = plan.svg.ownerDocument, view = doc.defaultView;
    const { width, height } = plan.dimensions;
    if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= MAX_EDGE) || width * height > MAX_PIXELS) throw new Error("画像の寸法が不正です");
    const canvas = doc.createElement("canvas");
    let url, image;
    try {
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("画像作成用のCanvasを利用できません");
      const xml = new view.XMLSerializer().serializeToString(plan.svg);
      url = view.URL.createObjectURL(new view.Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
      image = new view.Image();
      // An in-flight SVG load must settle before revoking its URL. Cancelling
      // the resource itself makes WebKit report a failed resource request.
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("グラフ画像の読み込みに失敗しました"));
        image.src = url;
      });
      if (signal?.aborted) throw signal.reason;
      if (typeof image.decode === "function") {
        try { await pngWait(image.decode(), signal); } catch { throw new Error("グラフ画像のデコードに失敗しました"); }
      }
      // Paint an opaque base even if a future theme supplies an alpha color.
      context.fillStyle = "#fff"; context.fillRect(0, 0, width, height);
      context.fillStyle = plan.background; context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const blob = validateChartPngBlob(await pngWait(new Promise((resolve, reject) => {
        try { canvas.toBlob(resolve, "image/png"); } catch { reject(new Error("PNG画像への変換に失敗しました")); }
      }), signal));
      const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
      const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
      const sizes = new DataView(header.buffer, header.byteOffset, header.byteLength);
      if (!signature.every((byte, index) => header[index] === byte) || sizes.getUint32(16) !== width || sizes.getUint32(20) !== height) throw pngError("invalid-png", "有効なPNG画像を生成できませんでした");
      return blob;
    } finally {
      if (image) { image.onload = null; image.onerror = null; image.removeAttribute("src"); }
      if (url) view.URL.revokeObjectURL(url);
      canvas.width = 0; canvas.height = 0;
    }
  }

  async function downloadChartPng(blob, filename, doc) {
    validateChartPngBlob(blob);
    // Data URL avoids revoking a download Object URL before WebKit consumes it.
    const url = await new Promise((resolve, reject) => {
      const reader = new doc.defaultView.FileReader();
      const clean = () => { reader.onload = reader.onerror = reader.onabort = null; };
      reader.onload = () => { const result = reader.result; clean(); resolve(result); };
      reader.onerror = reader.onabort = () => { clean(); reject(new Error("PNGファイルを読み出せませんでした")); };
      try { reader.readAsDataURL(blob); } catch { clean(); reject(new Error("PNGファイルを読み出せませんでした")); }
    });
    const anchor = doc.createElement("a");
    try {
      anchor.download = filename; anchor.href = url; anchor.hidden = true;
      anchor.setAttribute("aria-hidden", "true");
      doc.body.append(anchor); anchor.click();
    } catch { throw new Error("PNG画像のダウンロードを開始できませんでした"); }
    finally { anchor.remove(); anchor.removeAttribute("href"); }
  }

  function pngError(code, message, cause) {
    const error = new Error(message, { cause });
    error.code = code;
    return error;
  }

  // Cancellation observes the original promise too, so late failures never escape.
  function pngWait(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => { signal.removeEventListener("abort", abort); callback(value); };
      const abort = () => finish(reject, signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
      if (signal.aborted) abort();
    });
  }

  function requireChartPngTarget(card, source) {
    if (!card.isConnected || !source || card.querySelector(".chart-block-scroll > svg") !== source) {
      throw pngError("target-changed", "対象のグラフが変更されています");
    }
  }

  async function generateChartPng(card, signal, source = card.querySelector(".chart-block-scroll > svg")) {
    if (signal?.aborted) throw signal.reason;
    requireChartPngTarget(card, source);
    await pngWait(card.ownerDocument.fonts.ready, signal);
    requireChartPngTarget(card, source);
    const blob = await chartPngBlob(composeChartPng(captureChartPng(card)), signal);
    requireChartPngTarget(card, source);
    return blob;
  }

  async function saveChartPng(card, title) {
    try {
      const blob = await generateChartPng(card);
      await downloadChartPng(blob, chartPngFilename(title), card.ownerDocument);
    } catch (error) {
      throw new Error("PNG画像を保存できませんでした: " + (/[ぁ-んァ-ヶ一-龠]/.test(error.message) ? error.message : "画像の生成に失敗しました。再試行してください"));
    }
  }

  function chartSvgFilename(title) {
    return chartPngFilename(title).replace(/\.png$/, ".svg");
  }

  async function validateChartSvgBlob(blob, view) {
    const invalid = () => new Error("安全で有効なSVG画像を確認できませんでした");
    if (!blob || !blob.size || !/^image\/svg\+xml(?:;charset=utf-8)?$/i.test(blob.type)) throw invalid();
    const xml = new view.TextDecoder("utf-8", { fatal: true }).decode(await blob.arrayBuffer());
    const parsed = new view.DOMParser().parseFromString(xml, "image/svg+xml");
    const root = parsed.documentElement;
    if (parsed.querySelector("parsererror") || !root || root.localName !== "svg" || root.namespaceURI !== SVG_NS
      || [...parsed.childNodes].some(node => node.nodeType === 7 || node.nodeType === 10)) throw invalid();
    const positive = value => /^\+?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value || "") && Number.isFinite(Number(value)) && Number(value) > 0;
    const boxParts = (root.getAttribute("viewBox") || "").trim().split(/\s*,\s*|\s+/);
    const box = boxParts.map(Number);
    if (!positive(root.getAttribute("width")) || !positive(root.getAttribute("height"))
      || box.length !== 4 || !boxParts.every(value => /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value))
      || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) throw invalid();
    // Closed vocabulary: the current renderer uses only vector geometry/text.
    // Reject future images, links, animation, CSS/resources rather than exporting dependencies.
    const elements = new Set(["svg", "g", "rect", "line", "polyline", "polygon", "path", "circle", "ellipse", "text", "tspan"]);
    const attributes = new Set(["xmlns", "width", "height", "viewBox", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "dx", "dy", "points", "d", "transform", "overflow", "preserveAspectRatio", "style", ...DRAW_STYLES]);
    const unsafe = /(?:NaN|[-+]?Infinity)\b|currentcolor|var\s*\(|url\s*\(|javascript\s*:|expression\s*\(|[\\@]/i;
    for (const element of [root, ...root.querySelectorAll("*")]) {
      if (element.namespaceURI !== SVG_NS || !elements.has(element.localName)) throw invalid();
      for (const attribute of element.attributes) {
        if (!attributes.has(attribute.name) || unsafe.test(attribute.value)
          || (attribute.namespaceURI && attribute.name !== "xmlns")) throw invalid();
        if (attribute.name === "xmlns" && attribute.value !== SVG_NS) throw invalid();
        if (["width", "height", "viewBox", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "dx", "dy", "points", "d", "transform", "style"].includes(attribute.name)
          && (attribute.value.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/ig) || []).some(value => !Number.isFinite(Number(value)))) throw invalid();
        if (attribute.name === "style") {
          for (const property of element.style) if (!DRAW_STYLES.includes(property)) throw invalid();
        }
      }
    }
    return blob;
  }

  async function generateChartSvg(card, source = card.querySelector(".chart-block-scroll > svg")) {
    requireChartPngTarget(card, source);
    const doc = card.ownerDocument, view = doc.defaultView;
    await doc.fonts.ready;
    requireChartPngTarget(card, source);
    const plan = composeChartPng(captureChartPng(card));
    // Match PNG's raster dimensions and opaque white backing, retaining its logical viewBox.
    plan.svg.setAttribute("width", plan.dimensions.width);
    plan.svg.setAttribute("height", plan.dimensions.height);
    plan.svg.prepend(svgElement(doc, "rect", { width: "100%", height: "100%", fill: "#fff" }));
    const xml = new view.XMLSerializer().serializeToString(plan.svg);
    const blob = await validateChartSvgBlob(new view.Blob([xml], { type: "image/svg+xml;charset=utf-8" }), view);
    requireChartPngTarget(card, source);
    return blob;
  }

  async function saveChartSvg(card, title) {
    const source = card.querySelector(".chart-block-scroll > svg");
    const blob = await generateChartSvg(card, source);
    await downloadChartSvg(blob, chartSvgFilename(title), card.ownerDocument, () => requireChartPngTarget(card, source));
  }

  async function downloadChartSvg(blob, filename, doc, beforeClick = () => {}) {
    const view = doc.defaultView;
    await validateChartSvgBlob(blob, view);
    // WebKit may coalesce two link navigations in the same task. Serialize only
    // activation/cleanup; each card still generates and reports independently.
    const previous = svgDownloads.get(doc);
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    svgDownloads.set(doc, pending);
    await previous;
    let url, anchor, started = false;
    try {
      url = view.URL.createObjectURL(blob);
      anchor = doc.createElement("a");
      anchor.download = filename; anchor.href = url; anchor.hidden = true;
      anchor.setAttribute("aria-hidden", "true");
      beforeClick();
      doc.body.append(anchor);
      anchor.click();
      started = true;
    } finally {
      try {
        // Link activation queues a navigation task. Keep both the link and its
        // Object URL alive through that task: WebKit can otherwise drop a
        // second, independently requested download before navigation starts.
        if (url && started) await new Promise(resolve => {
          const channel = new view.MessageChannel();
          channel.port1.onmessage = () => {
            channel.port1.onmessage = null; channel.port1.close(); channel.port2.close(); resolve();
          };
          channel.port2.postMessage(null);
        });
      } finally {
        try {
          anchor?.remove(); anchor?.removeAttribute("href");
        } finally {
          try { if (url) view.URL.revokeObjectURL(url); }
          finally {
            if (svgDownloads.get(doc) === pending) svgDownloads.delete(doc);
            release();
          }
        }
      }
    }
  }

  function chartPngCopyMessage(error) {
    const fallback = "『PNG画像として保存』を利用してください。";
    const code = error?.code, name = error?.cause?.name || error?.name;
    if (code === "insecure") return "安全な接続で開き直すか、" + fallback;
    if (code === "clipboard-unavailable") return "このブラウザではクリップボードへの書き込みを利用できません。" + fallback;
    if (code === "item-unavailable") return "このブラウザでは画像のクリップボードコピーを利用できません。" + fallback;
    if (code === "png-unsupported") return "このブラウザではPNG画像のコピーに対応していません。" + fallback;
    if (code === "target-changed") return "対象のグラフが変更されたためコピーを完了できませんでした。表示中のグラフで再試行するか、" + fallback;
    if (code === "invalid-png") return "作成したPNG画像を確認できなかったため、コピーしませんでした。もう一度試すか、" + fallback;
    if (code === "generation") return "グラフ画像を作成できなかったため、コピーしませんでした。もう一度試すか、" + fallback;
    if (name === "NotAllowedError") return "グラフ画像をコピーできませんでした。ブラウザのクリップボード権限を確認するか、" + fallback;
    if (name === "SecurityError") return "ブラウザのセキュリティ制限でコピーできませんでした。安全な接続とサイトの設定を確認するか、" + fallback;
    if (name === "DataError") return "ブラウザがPNG画像を受け取れませんでした。もう一度試すか、" + fallback;
    if (name === "AbortError") return "画像のコピーが中断されました。もう一度試すか、" + fallback;
    if (code === "item-construction") return "画像をクリップボードへ渡す準備ができませんでした。もう一度試すか、" + fallback;
    return "グラフ画像をコピーできませんでした。もう一度試すか、" + fallback;
  }

  async function copyChartPng(card) {
    const view = card.ownerDocument.defaultView;
    if (!view.isSecureContext) throw pngError("insecure");
    if (typeof view.navigator.clipboard?.write !== "function") throw pngError("clipboard-unavailable");
    if (typeof view.ClipboardItem !== "function") throw pngError("item-unavailable");
    if (typeof view.ClipboardItem.supports === "function" && view.ClipboardItem.supports("image/png") === false) throw pngError("png-unsupported");
    const source = card.querySelector(".chart-block-scroll > svg");
    const controller = new view.AbortController();
    // Schedule generation without awaiting it; an immediate write rejection can
    // cancel before starting an SVG resource request (including in WebKit).
    const blobPromise = Promise.resolve().then(() => generateChartPng(card, controller.signal, source)).catch(error => {
      throw typeof error?.code === "string" ? error : pngError("generation", "PNG生成失敗", error);
    });
    // Observe immediately, including constructor/write synchronous failures.
    blobPromise.catch(() => {});
    let phase = "item-construction";
    try {
      const item = new view.ClipboardItem({ "image/png": blobPromise });
      phase = "write-sync";
      // Do not await fonts, image load/decode or toBlob before starting write.
      const written = view.navigator.clipboard.write([item]);
      phase = "write-async";
      const writePromise = Promise.resolve(written).catch(error => {
        const failure = pngError("write-async", "画像コピー失敗", error);
        controller.abort(failure);
        throw failure;
      });
      await Promise.all([blobPromise, writePromise]);
      requireChartPngTarget(card, source);
    } catch (error) {
      controller.abort(error);
      await blobPromise.catch(() => {});
      throw typeof error?.code === "string" ? error : pngError(phase, "画像コピー失敗", error);
    }
  }
  const api = { downloadChartSvg, chartSvgFilename, validateChartSvgBlob, generateChartSvg, saveChartSvg, chartPngFilename, chartPngDimensions, chartPngTextLines, chartPngTheme, captureChartPng, composeChartPng, validateChartPngBlob, chartPngBlob, downloadChartPng, generateChartPng, saveChartPng, copyChartPng, chartPngCopyMessage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (scope) scope.MemoNexusChartPngExport = api;
})(typeof window !== "undefined" ? window : globalThis);
