(function initTimelineBlockUtils(globalScope) {
  "use strict";
  const { scanFencedLines } = typeof module !== "undefined" && module.exports
    ? require("./markdown-fence-utils.js") : globalScope.MemoNexusMarkdownFenceUtils;
  const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const text = (value) => typeof value === "string" ? value : "";
  function normalizeTimeline(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !validId(value.id)) return null;
    const seen = new Set();
    const items = (Array.isArray(value.items) ? value.items : []).filter((item) => {
      if (!item || !validId(item.id) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).map((item) => ({
      id: item.id, dateLabel: text(item.dateLabel), title: text(item.title), body: text(item.body),
      figureId: validId(item.figureId) ? item.figureId : "",
      citationIds: [...new Set((Array.isArray(item.citationIds) ? item.citationIds : []).filter(validId))]
    }));
    return { id: value.id, title: text(value.title), description: text(value.description), items };
  }
  function serializeTimelineBlock(value) {
    const timeline = normalizeTimeline(value);
    if (!timeline) throw new Error("TimelineのIDが不正です");
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, timeline }));
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return "<!-- memo-nexus:timeline-v1:" + hex + " -->";
  }
  function parseTimelineBlockLine(line) {
    const match = String(line || "").trim().match(/^<!-- memo-nexus:timeline-v1:([0-9a-f]+) -->$/i);
    if (!match || match[1].length % 2) return null;
    try {
      const bytes = Uint8Array.from(match[1].match(/../g), (pair) => Number.parseInt(pair, 16));
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return value?.version === 1 ? normalizeTimeline(value.timeline) : null;
    } catch (_) { return null; }
  }
  function splitTimelineBlocks(markdown) {
    const source = String(markdown || "").replace(/\r\n?/g, "\n");
    const segments = [];
    let offset = 0;
    let textStart = 0;
    const fencedLines = scanFencedLines(source).lines;
    let lineIndex = 0;
    for (const line of source.split("\n")) {
      if (!fencedLines[lineIndex++]?.code) {
        const timeline = parseTimelineBlockLine(line);
        if (timeline) {
          if (offset > textStart) segments.push({ type: "text", text: source.slice(textStart, offset), start: textStart, end: offset });
          const end = offset + line.length;
          segments.push({ type: "timeline", timeline, raw: line, start: offset, end });
          textStart = end;
        }
      }
      offset += line.length + 1;
    }
    if (textStart < source.length) segments.push({ type: "text", text: source.slice(textStart), start: textStart, end: source.length });
    return segments;
  }
  function replaceTimelineBlock(markdown, block, value) {
    const source = String(markdown || "").replace(/\r\n?/g, "\n");
    if (!block || source.slice(block.start, block.end) !== block.raw) throw new Error("Timelineが更新されました。開き直してください");
    return source.slice(0, block.start) + (value ? serializeTimelineBlock(value) : "") + source.slice(block.end);
  }
  const api = { normalizeTimeline, serializeTimelineBlock, parseTimelineBlockLine, splitTimelineBlocks, replaceTimelineBlock };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusTimelineBlockUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
