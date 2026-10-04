(function initMarkdownFenceUtils(globalScope) {
  "use strict";
  // Preserve Geometry's column-based list continuation and relative indentation.
  function markdownLines(source) {
    const lines = [];
    const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
    let match;
    while ((match = pattern.exec(source)) && match[0] !== "") {
      const full = match[0];
      const lineEndingMatch = full.match(/\r\n$|\r$|\n$/);
      const lineEnding = lineEndingMatch ? lineEndingMatch[0] : "";
      lines.push({
        start: match.index,
        end: match.index + full.length,
        text: lineEnding ? full.slice(0, -lineEnding.length) : full,
        lineEnding
      });
    }
    return lines;
  }

  function leadingIndentColumns(text) {
    let column = 0;
    let index = 0;
    while (text[index] === " " || text[index] === "\t") {
      column = text[index] === "\t" ? column + (4 - (column % 4)) : column + 1;
      index += 1;
    }
    return { column, index };
  }

  function listItemIndent(text) {
    const match = text.match(/^( {0,3})([*+-]|\d{1,9}[.)])([ \t]+)/);
    if (!match) return null;
    const markerIndent = match[1].length;
    const markerEndColumn = markerIndent + match[2].length;
    let contentColumn = markerEndColumn;
    for (const character of match[3]) {
      contentColumn = character === "\t"
        ? contentColumn + (4 - (contentColumn % 4))
        : contentColumn + 1;
    }
    const padding = contentColumn - markerEndColumn;
    return {
      markerIndent,
      contentIndent: markerEndColumn + (padding <= 4 ? padding : 1)
    };
  }

  function isIndentedCodeLine(text, listContentIndent = 0) {
    const indent = leadingIndentColumns(text).column;
    return indent - listContentIndent >= 4;
  }

  function fenceStart(text, listContentIndent) {
    const indent = leadingIndentColumns(text);
    const relativeIndent = indent.column - listContentIndent;
    if (relativeIndent < 0 || relativeIndent > 3) return null;
    const match = text.slice(indent.index).match(/^(`{3,}|~{3,})/);
    if (!match || (match[1][0] === "`" && text.slice(indent.index + match[1].length).includes("`"))) return null;
    return {
      character: match[1][0],
      length: match[1].length,
      listContentIndent,
      info: text.slice(indent.index + match[1].length).trim()
    };
  }

  function closesFence(text, fence) {
    const indent = leadingIndentColumns(text);
    const relativeIndent = indent.column - fence.listContentIndent;
    if (relativeIndent < 0 || relativeIndent > 3) return false;
    const remaining = text.slice(indent.index);
    let length = 0;
    while (remaining[length] === fence.character) length += 1;
    return length >= fence.length && /^[ \t]*$/.test(remaining.slice(length));
  }


  function createFenceScanner() {
    let fence = null;
    const listContentIndents = [];
    return {
      read(text, start = 0) {
        if (fence) {
          const closing = closesFence(text, fence);
          const result = { code: true, closing, opening: null, indentedCode: false };
          if (closing) fence = null;
          return result;
        }
        const trimmed = text.trim();
        const indent = leadingIndentColumns(text).column;
        const listItem = listItemIndent(text);
        if (trimmed && listItem) {
          while (listContentIndents.length && listItem.markerIndent < listContentIndents[listContentIndents.length - 1]) listContentIndents.pop();
          listContentIndents.push(listItem.contentIndent);
        } else if (trimmed) {
          while (listContentIndents.length && indent < listContentIndents[listContentIndents.length - 1]) listContentIndents.pop();
        }
        const listContentIndent = listContentIndents.at(-1) || 0;
        const opening = fenceStart(text, listContentIndent);
        if (opening) fence = { ...opening, start };
        return { code: Boolean(opening), opening, closing: false, indentedCode: isIndentedCodeLine(text, listContentIndent) };
      },
      currentFence() { return fence; }
    };
  }
  function scanFencedLines(markdown) {
    const scanner = createFenceScanner();
    const source = String(markdown || "");
    const rawLines = markdownLines(source);
    // Keep the final empty line used by Preview; never rewrite document bytes.
    if (!source || /[\r\n]$/.test(source)) rawLines.push({ start: source.length, end: source.length, text: "", lineEnding: "" });
    const lines = rawLines.map(line => ({ ...line, ...scanner.read(line.text, line.start) }));
    return { lines, fence: scanner.currentFence() };
  }
  const api = { createFenceScanner, scanFencedLines };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusMarkdownFenceUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
