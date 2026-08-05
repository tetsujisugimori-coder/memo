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

  function targetOccurrenceOrdinal(body, target, start) {
    if (!target || start < 0) return -1;
    let ordinal = 0;
    let cursor = body.indexOf(target);
    while (cursor !== -1 && cursor < start) {
      ordinal += 1;
      cursor = body.indexOf(target, cursor + target.length);
    }
    return cursor === start ? ordinal : -1;
  }

  return { buildCalloutMarkdown, checklistEntries, updateChecklistAt, targetOccurrenceOrdinal };
})();

if (typeof window !== "undefined") window.MemoNexusMarkdownEnhancements = MemoNexusMarkdownEnhancements;
if (typeof module !== "undefined") module.exports = MemoNexusMarkdownEnhancements;
