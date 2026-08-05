const MemoNexusMarkdownEnhancements = (() => {
  function buildCalloutMarkdown(selection, type = "NOTE") {
    const safeType = ["NOTE", "TIP", "IMPORTANT", "WARNING"].includes(type) ? type : "NOTE";
    const text = String(selection || "").replace(/\r\n?/g, "\n");
    if (!text) return `> [!${safeType}]\n> `;
    return `> [!${safeType}]\n${text.split("\n").map((line) => `> ${line}`).join("\n")}`;
  }

  function checklistEntries(body) {
    const entries = [];
    let offset = 0;
    let inFence = false;
    String(body || "").replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
      if (/^```/.test(line.trim())) inFence = !inFence;
      if (!inFence) {
        const match = line.match(/^-\s+\[([ xX])\](?=\s)/);
        if (match) entries.push({ markerStart: offset + match.index + match[0].indexOf("["), checked: match[1].toLowerCase() === "x" });
      }
      offset += line.length + 1;
    });
    return entries;
  }

  function updateChecklistAt(body, markerStart, checked) {
    const text = String(body || "");
    if (!/^\[([ xX])\]/.test(text.slice(markerStart, markerStart + 3))) return text;
    return `${text.slice(0, markerStart)}[${checked ? "x" : " "}]${text.slice(markerStart + 3)}`;
  }

  function visibleTextSegments(body) {
    const segments = [];
    const source = String(body || "").replace(/\r\n?/g, "\n");
    let lineStart = 0;
    let inFence = false;
    source.split("\n").forEach((line) => {
      if (/^```/.test(line.trim())) { inFence = !inFence; lineStart += line.length + 1; return; }
      const prefix = inFence ? 0 : (line.match(/^(?:#{1,3}\s+|[-*]\s+|\d+\.\s+|>\s?)/)?.[0].length || 0);
      collectInlineSegments(line.slice(prefix), lineStart + prefix, segments);
      lineStart += line.length + 1;
    });
    return segments;
  }

  function collectInlineSegments(text, sourceStart, segments) {
    let index = 0;
    const pushPlain = (end) => {
      if (end > index) segments.push({ sourceStart: sourceStart + index, sourceEnd: sourceStart + end, text: text.slice(index, end) });
    };
    while (index < text.length) {
      const token = nextVisibleInlineToken(text, index);
      if (!token) { pushPlain(text.length); break; }
      pushPlain(token.start);
      segments.push({ sourceStart: sourceStart + token.contentStart, sourceEnd: sourceStart + token.contentEnd, text: token.content });
      index = token.end;
    }
  }

  function nextVisibleInlineToken(text, from) {
    const patterns = [
      { pattern: /!\[([^\]]*)\]\([^)]*\)/g, group: 1, contentOffset: 2 },
      { pattern: /\[([^\]]+)\]\([^)]*\)/g, group: 1, contentOffset: 1 },
      { pattern: /`([^`]+)`/g, group: 1, contentOffset: 1 },
      { pattern: /\*\*([^*]+)\*\*/g, group: 1, contentOffset: 2 },
      { pattern: /~~([^~]+)~~/g, group: 1, contentOffset: 2 },
      { pattern: /(?<!\*)\*([^*]+)\*(?!\*)/g, group: 1, contentOffset: 1 },
      { pattern: /(?<![\p{L}\p{N}])_([^_]+)_(?![\p{L}\p{N}])/gu, group: 1, contentOffset: 1 }
    ];
    const matches = patterns.map(({ pattern, group, contentOffset }) => {
      pattern.lastIndex = from;
      const match = pattern.exec(text);
      return match ? { start: match.index, end: pattern.lastIndex, content: match[group], contentStart: match.index + contentOffset, contentEnd: match.index + contentOffset + match[group].length } : null;
    }).filter(Boolean);
    return matches.sort((a, b) => a.start - b.start || a.end - b.end)[0] || null;
  }

  function visibleTargetOrdinal(body, target, start, end) {
    if (!target || start < 0 || end !== start + target.length) return -1;
    let ordinal = 0;
    for (const segment of visibleTextSegments(body)) {
      let offset = segment.text.indexOf(target);
      while (offset !== -1) {
        const sourceMatchStart = segment.sourceStart + offset;
        if (sourceMatchStart === start && sourceMatchStart + target.length === end) return ordinal;
        ordinal += 1;
        offset = segment.text.indexOf(target, offset + target.length);
      }
    }
    return -1;
  }

  function resolveExplanationTarget(body, explanation) {
    const text = String(body || "");
    const target = String(explanation?.target || "");
    const start = Number(explanation?.start);
    const end = Number(explanation?.end);
    if (!target) return { start: -1, end: -1, matched: false };
    if (Number.isInteger(start) && Number.isInteger(end) && text.slice(start, end) === target) return { start, end, matched: true };
    const candidates = [];
    for (let cursor = text.indexOf(target); cursor !== -1; cursor = text.indexOf(target, cursor + target.length)) candidates.push(cursor);
    if (candidates.length === 1) return { start: candidates[0], end: candidates[0] + target.length, matched: true };
    const before = String(explanation?.before || "");
    const after = String(explanation?.after || "");
    const contextual = candidates.filter((candidate) => (
      (!before || text.slice(Math.max(0, candidate - before.length), candidate) === before)
      && (!after || text.slice(candidate + target.length, candidate + target.length + after.length) === after)
    ));
    if (contextual.length === 1) return { start: contextual[0], end: contextual[0] + target.length, matched: true };
    return { start: -1, end: -1, matched: false };
  }

  function shouldPersistCollapsedState(previous, next, userInitiated) {
    return userInitiated === true && previous !== next;
  }

  return { buildCalloutMarkdown, checklistEntries, updateChecklistAt, visibleTextSegments, visibleTargetOrdinal, resolveExplanationTarget, shouldPersistCollapsedState };
})();

if (typeof window !== "undefined") window.MemoNexusMarkdownEnhancements = MemoNexusMarkdownEnhancements;
if (typeof module !== "undefined") module.exports = MemoNexusMarkdownEnhancements;
