(function initChartBlockUtils(globalScope) {
  "use strict";

  const CHART_BLOCK_VERSION = 1;
  const CHART_BLOCK_PATTERN = /^\s*<!-- memo-nexus:chart-block:([0-9a-f]+) -->\s*$/i;
  const DEFAULT_CHART_COLOR = "#4f46e5";
  const IMAGE_BLOCK_START = "<!-- memo-nexus:image-block -->";
  const IMAGE_BLOCK_END = "<!-- /memo-nexus:image-block -->";

  function utf8ToHex(value) {
    return Array.from(new TextEncoder().encode(String(value))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function hexToUtf8(value) {
    const source = String(value || "");
    if (!source || source.length % 2 !== 0 || /[^0-9a-f]/i.test(source)) throw new Error("グラフブロックのデータ形式が不正です");
    const bytes = new Uint8Array(source.length / 2);
    for (let index = 0; index < source.length; index += 2) bytes[index / 2] = Number.parseInt(source.slice(index, index + 2), 16);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function normalizedText(value) {
    return value == null ? "" : String(value).replace(/\r\n?/g, "\n");
  }

  function normalizedColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : DEFAULT_CHART_COLOR;
  }

  function nonNegativeFiniteNumber(value, fallback = 0) {
    if (value === "" || value == null) return fallback;
    const number = typeof value === "number" ? value : Number(String(value).trim());
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function normalizeChartItem(item, fallbackId, index, usedIds) {
    const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    const baseId = normalizedText(source.id).trim() || `${fallbackId}-item-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return {
      id,
      label: normalizedText(source.label).trim(),
      value: nonNegativeFiniteNumber(source.value)
    };
  }

  function normalizeChartBlock(value, fallbackId = "chart") {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const id = normalizedText(source.id).trim() || normalizedText(fallbackId).trim() || "chart";
    const sourceItems = Array.isArray(source.items) ? source.items.slice(0, 50) : [];
    const usedIds = new Set();
    const items = sourceItems.map((item, index) => normalizeChartItem(item, id, index, usedIds));
    const appearanceSource = source.appearance && typeof source.appearance === "object" && !Array.isArray(source.appearance)
      ? source.appearance : {};
    return {
      ...source,
      type: "chart",
      id,
      schemaVersion: Number.isInteger(source.schemaVersion) && source.schemaVersion > 0 ? source.schemaVersion : CHART_BLOCK_VERSION,
      chartType: source.chartType === "bar" ? "bar" : "bar",
      title: normalizedText(source.title).trim(),
      unit: normalizedText(source.unit).trim(),
      items,
      appearance: {
        ...appearanceSource,
        color: normalizedColor(appearanceSource.color),
        showValues: appearanceSource.showValues !== false,
        showLegend: false
      }
    };
  }

  function createChartBlock(id) {
    return normalizeChartBlock({
      type: "chart",
      id,
      schemaVersion: CHART_BLOCK_VERSION,
      chartType: "bar",
      title: "",
      unit: "",
      items: [{ id: `${id}-item-1`, label: "", value: 0 }],
      appearance: { color: DEFAULT_CHART_COLOR, showValues: true, showLegend: false }
    }, id);
  }

  function serializeChartBlock(chart) {
    return `<!-- memo-nexus:chart-block:${utf8ToHex(JSON.stringify(normalizeChartBlock(chart, chart && chart.id)))} -->`;
  }

  function parseChartBlockLine(line) {
    const match = String(line || "").match(CHART_BLOCK_PATTERN);
    if (!match) return null;
    try {
      return normalizeChartBlock(JSON.parse(hexToUtf8(match[1])));
    } catch (error) {
      return null;
    }
  }

  function splitChartBlocks(markdown) {
    const source = String(markdown || "").replace(/\r\n?/g, "\n");
    const lines = source.split("\n");
    const offsets = [];
    let offset = 0;
    lines.forEach((line, index) => { offsets.push(offset); offset += line.length + (index < lines.length - 1 ? 1 : 0); });
    const segments = [];
    let textStart = 0;
    let inCodeFence = false;
    let inImageBlock = false;
    const pushText = (end) => { if (end > textStart) segments.push({ type: "text", text: source.slice(textStart, end), start: textStart, end }); };
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (/^```/.test(trimmed)) { inCodeFence = !inCodeFence; return; }
      if (inCodeFence) return;
      if (trimmed === IMAGE_BLOCK_START) { inImageBlock = true; return; }
      if (trimmed === IMAGE_BLOCK_END) { inImageBlock = false; return; }
      if (inImageBlock) return;
      const chart = parseChartBlockLine(line);
      if (!chart) return;
      const start = offsets[index];
      const end = index < lines.length - 1 ? start + line.length + 1 : source.length;
      pushText(start);
      segments.push({ type: "chart", chart, start, end, raw: source.slice(start, end).replace(/\n$/, "") });
      textStart = end;
    });
    pushText(source.length);
    return segments.length ? segments : [{ type: "text", text: source, start: 0, end: source.length }];
  }

  function insertChartBlock(markdown, selectionStart, selectionEnd, chart) {
    const source = String(markdown || "");
    const requestedStart = Math.min(source.length, Math.max(0, Number(selectionStart) || 0));
    const requestedEnd = Math.min(source.length, Math.max(requestedStart, Number(selectionEnd) || requestedStart));
    const existing = splitChartBlocks(source).filter((segment) => segment.type === "chart");
    const boundary = (position) => existing.find((block) => position > block.start && position < block.end)?.end ?? position;
    const start = boundary(requestedStart);
    const end = Math.max(start, boundary(requestedEnd));
    const marker = serializeChartBlock(chart);
    const prefix = start > 0 && source[start - 1] !== "\n" ? "\n" : "";
    const suffix = end < source.length && source[end] !== "\n" ? "\n" : "";
    const insertedText = `${prefix}${marker}${suffix}`;
    return { value: `${source.slice(0, start)}${insertedText}${source.slice(end)}`, selectionStart: start + insertedText.length, selectionEnd: start + insertedText.length, insertedText };
  }

  function replaceChartBlock(markdown, block, chart) {
    const source = String(markdown || "");
    if (!block || block.type !== "chart" || source.slice(block.start, block.start + block.raw.length) !== block.raw) throw new Error("グラフブロックが変更されたため更新できませんでした");
    return `${source.slice(0, block.start)}${chart ? serializeChartBlock(chart) : ""}${source.slice(block.start + block.raw.length)}`;
  }

  function chartBlockPlainText(markdown) {
    return splitChartBlocks(markdown).map((segment) => segment.type === "text"
      ? segment.text
      : [segment.chart.title, segment.chart.unit, ...segment.chart.items.flatMap((item) => [item.label, String(item.value)])].filter(Boolean).join(" ")).join("");
  }

  const api = {
    CHART_BLOCK_VERSION,
    DEFAULT_CHART_COLOR,
    chartBlockPlainText,
    createChartBlock,
    insertChartBlock,
    nonNegativeFiniteNumber,
    normalizeChartBlock,
    parseChartBlockLine,
    replaceChartBlock,
    serializeChartBlock,
    splitChartBlocks
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusChartBlockUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
