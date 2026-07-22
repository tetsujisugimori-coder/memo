(function initTableBlockUtils(globalScope) {
  "use strict";

  const TABLE_BLOCK_VERSION = 1;
  const TABLE_PASTE_LIMITS = Object.freeze({ rows: 100, columns: 30, cells: 3000 });
  const TABLE_BLOCK_PATTERN = /^\s*<!-- memo-nexus:table-block:([0-9a-f]+) -->\s*$/i;
  const IMAGE_BLOCK_START = "<!-- memo-nexus:image-block -->";
  const IMAGE_BLOCK_END = "<!-- /memo-nexus:image-block -->";

  function utf8ToHex(value) {
    return Array.from(new TextEncoder().encode(String(value)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function hexToUtf8(value) {
    const source = String(value || "");
    if (!source || source.length % 2 !== 0 || /[^0-9a-f]/i.test(source)) {
      throw new Error("表ブロックのデータ形式が不正です");
    }
    const bytes = new Uint8Array(source.length / 2);
    for (let index = 0; index < source.length; index += 2) {
      bytes[index / 2] = Number.parseInt(source.slice(index, index + 2), 16);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function normalizedCell(value) {
    return value == null ? "" : String(value).replace(/\r\n?/g, "\n");
  }

  function normalizePastedTableRows(value) {
    if (!Array.isArray(value)) return [];
    const rows = value.map((row) => Array.from(Array.isArray(row) ? row : [row], normalizedCell));
    while (rows.length && rows[rows.length - 1].every((cell) => cell === "")) rows.pop();
    if (!rows.length) return [];
    let columnCount = Math.max(0, ...rows.map((row) => row.length));
    while (columnCount > 0 && rows.every((row) => (row[columnCount - 1] || "") === "")) columnCount -= 1;
    if (!columnCount) return [];
    return rows.map((row) => Array.from({ length: columnCount }, (_, index) => normalizedCell(row[index])));
  }

  function parseTabSeparatedTable(text) {
    const source = normalizedCell(text).replace(/^\n+|\n+$/g, "");
    if (!source.includes("\t")) return null;
    const rows = normalizePastedTableRows(source.split("\n").map((line) => line.split("\t")));
    if (!rows.length) return null;
    return {
      format: "tab-separated",
      formatLabel: "スプレッドシート形式",
      rows,
      hasHeader: true,
      alignments: [],
      hasMergedCells: false
    };
  }

  function markdownLineHasTrailingPipe(line) {
    if (!line.endsWith("|")) return false;
    let slashCount = 0;
    for (let index = line.length - 2; index >= 0 && line[index] === "\\"; index -= 1) slashCount += 1;
    return slashCount % 2 === 0;
  }

  function splitMarkdownTableRow(line) {
    let source = normalizedCell(line).trim();
    if (source.startsWith("|")) source = source.slice(1);
    if (markdownLineHasTrailingPipe(source)) source = source.slice(0, -1);
    const cells = [];
    let cell = "";
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === "\\" && source[index + 1] === "|") {
        cell += "|";
        index += 1;
      } else if (character === "|") {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += character;
      }
    }
    cells.push(cell.trim());
    return cells;
  }

  function markdownAlignment(value) {
    const marker = String(value || "").trim();
    if (!/^:?-{3,}:?$/.test(marker)) return null;
    if (marker.startsWith(":") && marker.endsWith(":")) return "center";
    if (marker.endsWith(":")) return "right";
    if (marker.startsWith(":")) return "left";
    return null;
  }

  function parseMarkdownTable(text) {
    const lines = normalizedCell(text).replace(/^\n+|\n+$/g, "").split("\n").filter((line) => line.trim() !== "");
    if (lines.length < 2) return null;
    const header = splitMarkdownTableRow(lines[0]);
    const separator = splitMarkdownTableRow(lines[1]);
    if (header.length < 2 || separator.length !== header.length) return null;
    const alignments = separator.map(markdownAlignment);
    if (alignments.some((alignment, index) => alignment === null && !/^-{3,}$/.test(separator[index]))) return null;
    const dataRows = lines.slice(2).map(splitMarkdownTableRow);
    if (dataRows.some((row) => row.length !== header.length)) return null;
    const rows = normalizePastedTableRows([header, ...dataRows]);
    if (!rows.length) return null;
    return {
      format: "markdown",
      formatLabel: "Markdown表",
      rows,
      hasHeader: true,
      alignments,
      hasMergedCells: false
    };
  }

  function htmlCellText(cell) {
    const clone = cell.cloneNode(true);
    clone.querySelectorAll("script, style, template").forEach((node) => node.remove());
    clone.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
    return normalizedCell(clone.textContent).replace(/\u00a0/g, " ").trim();
  }

  function parseHtmlTable(html, Parser = globalScope && globalScope.DOMParser) {
    if (typeof Parser !== "function" || !/<table(?:\s|>)/i.test(String(html || ""))) return null;
    try {
      const documentNode = new Parser().parseFromString(String(html), "text/html");
      const table = documentNode && documentNode.querySelector("table");
      if (!table) return null;
      const sourceRows = Array.from(table.querySelectorAll("tr"))
        .filter((row) => !row.closest || row.closest("table") === table);
      if (!sourceRows.length) return null;
      const rows = [];
      let hasMergedCells = false;
      sourceRows.forEach((rowElement, rowIndex) => {
        if (!rows[rowIndex]) rows[rowIndex] = [];
        const cells = Array.from(rowElement.children || [])
          .filter((cell) => ["TH", "TD"].includes(String(cell.tagName || "").toUpperCase()));
        let columnIndex = 0;
        cells.forEach((cell) => {
          while (rows[rowIndex][columnIndex] !== undefined) columnIndex += 1;
          const rowSpan = Math.max(1, Number.parseInt(cell.getAttribute("rowspan"), 10) || 1);
          const columnSpan = Math.max(1, Number.parseInt(cell.getAttribute("colspan"), 10) || 1);
          if (rowSpan > 1 || columnSpan > 1) hasMergedCells = true;
          for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
            const targetRowIndex = rowIndex + rowOffset;
            if (!rows[targetRowIndex]) rows[targetRowIndex] = [];
            for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
              rows[targetRowIndex][columnIndex + columnOffset] = rowOffset === 0 && columnOffset === 0
                ? htmlCellText(cell)
                : "";
            }
          }
          columnIndex += columnSpan;
        });
      });
      const normalizedRows = normalizePastedTableRows(rows);
      if (!normalizedRows.length) return null;
      const firstRowCells = Array.from(sourceRows[0].children || [])
        .filter((cell) => ["TH", "TD"].includes(String(cell.tagName || "").toUpperCase()));
      return {
        format: "html",
        formatLabel: "HTML表",
        rows: normalizedRows,
        hasHeader: firstRowCells.some((cell) => String(cell.tagName || "").toUpperCase() === "TH"),
        alignments: [],
        hasMergedCells
      };
    } catch (error) {
      return null;
    }
  }

  function detectPastedTable({ html = "", text = "" } = {}, Parser) {
    const htmlTable = parseHtmlTable(html, Parser);
    if (htmlTable) return { ...htmlTable, plainText: normalizedCell(text) || htmlTable.rows.map((row) => row.join("\t")).join("\n") };
    const markdownTable = parseMarkdownTable(text);
    if (markdownTable) return { ...markdownTable, plainText: normalizedCell(text) };
    const tabSeparatedTable = parseTabSeparatedTable(text);
    if (tabSeparatedTable) return { ...tabSeparatedTable, plainText: normalizedCell(text) };
    return null;
  }

  function validatePastedTableSize(rows, limits = TABLE_PASTE_LIMITS) {
    const normalizedRows = normalizePastedTableRows(rows);
    const rowCount = normalizedRows.length;
    const columnCount = rowCount ? normalizedRows[0].length : 0;
    const cellCount = rowCount * columnCount;
    return {
      allowed: rowCount > 0
        && rowCount <= limits.rows
        && columnCount <= limits.columns
        && cellCount <= limits.cells,
      rowCount,
      columnCount,
      cellCount,
      limits
    };
  }

  function normalizeTableBlock(value, fallbackId = "table") {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const sourceRows = Array.isArray(source.rows) && source.rows.length ? source.rows : [[""]];
    const columnCount = Math.max(1, ...sourceRows.map((row) => Array.isArray(row) ? row.length : 0));
    const rows = sourceRows.map((row) => {
      const cells = Array.isArray(row) ? row.slice(0, columnCount).map(normalizedCell) : [];
      while (cells.length < columnCount) cells.push("");
      return cells;
    });
    const normalized = {
      ...source,
      type: "table",
      id: normalizedCell(source.id).trim() || normalizedCell(fallbackId).trim() || "table",
      caption: normalizedCell(source.caption),
      note: normalizedCell(source.note),
      hasHeader: source.hasHeader !== false,
      version: Number.isInteger(source.version) && source.version > 0 ? source.version : TABLE_BLOCK_VERSION,
      rows
    };
    if (Array.isArray(source.alignments)) {
      normalized.alignments = Array.from({ length: columnCount }, (_, index) => {
        const alignment = source.alignments[index];
        return ["left", "center", "right"].includes(alignment) ? alignment : null;
      });
    }
    return normalized;
  }

  function createTableBlock(id) {
    return normalizeTableBlock({
      type: "table",
      id,
      caption: "",
      note: "",
      hasHeader: true,
      version: TABLE_BLOCK_VERSION,
      rows: [["", ""], ["", ""]]
    }, id);
  }

  function serializeTableBlock(table) {
    const normalized = normalizeTableBlock(table, table && table.id);
    return `<!-- memo-nexus:table-block:${utf8ToHex(JSON.stringify(normalized))} -->`;
  }

  function parseTableBlockLine(line) {
    const match = String(line || "").match(TABLE_BLOCK_PATTERN);
    if (!match) return null;
    try {
      return normalizeTableBlock(JSON.parse(hexToUtf8(match[1])));
    } catch (error) {
      return null;
    }
  }

  function splitTableBlocks(markdown) {
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
    let inCodeFence = false;
    let inImageBlock = false;

    const pushText = (end) => {
      if (end > textStart) segments.push({ type: "text", text: source.slice(textStart, end), start: textStart, end });
    };

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (/^```/.test(trimmed)) {
        inCodeFence = !inCodeFence;
        return;
      }
      if (inCodeFence) return;
      if (trimmed === IMAGE_BLOCK_START) {
        inImageBlock = true;
        return;
      }
      if (trimmed === IMAGE_BLOCK_END) {
        inImageBlock = false;
        return;
      }
      if (inImageBlock) return;

      const table = parseTableBlockLine(line);
      if (!table) return;
      const start = offsets[index];
      const end = index < lines.length - 1 ? offsets[index] + line.length + 1 : source.length;
      pushText(start);
      segments.push({
        type: "table",
        table,
        start,
        end,
        raw: source.slice(start, end).replace(/\n$/, "")
      });
      textStart = end;
    });

    pushText(source.length);
    return segments.length ? segments : [{ type: "text", text: source, start: 0, end: source.length }];
  }

  function insertTableBlock(markdown, selectionStart, selectionEnd, table) {
    const source = String(markdown || "");
    const requestedStart = Math.min(source.length, Math.max(0, Number(selectionStart) || 0));
    const requestedEnd = Math.min(source.length, Math.max(requestedStart, Number(selectionEnd) || requestedStart));
    const existingBlocks = splitTableBlocks(source).filter((segment) => segment.type === "table");
    const safeBoundary = (position) => {
      const containingBlock = existingBlocks.find((block) => position > block.start && position < block.end);
      return containingBlock ? containingBlock.end : position;
    };
    const start = safeBoundary(requestedStart);
    const end = Math.max(start, safeBoundary(requestedEnd));
    const marker = serializeTableBlock(table);
    const prefix = start > 0 && source[start - 1] !== "\n" ? "\n" : "";
    const suffix = end < source.length && source[end] !== "\n" ? "\n" : "";
    const insertedText = `${prefix}${marker}${suffix}`;
    return {
      value: `${source.slice(0, start)}${insertedText}${source.slice(end)}`,
      selectionStart: start + insertedText.length,
      selectionEnd: start + insertedText.length,
      insertedText
    };
  }

  function replaceTableBlock(markdown, block, table) {
    const source = String(markdown || "");
    if (!block || block.type !== "table" || source.slice(block.start, block.start + block.raw.length) !== block.raw) {
      throw new Error("表ブロックが変更されたため更新できませんでした");
    }
    const replacement = table ? serializeTableBlock(table) : "";
    return `${source.slice(0, block.start)}${replacement}${source.slice(block.start + block.raw.length)}`;
  }

  function updateTableCell(table, rowIndex, columnIndex, value) {
    const next = normalizeTableBlock(table, table && table.id);
    if (!next.rows[rowIndex] || columnIndex < 0 || columnIndex >= next.rows[0].length) return next;
    next.rows = next.rows.map((row) => [...row]);
    next.rows[rowIndex][columnIndex] = normalizedCell(value);
    return next;
  }

  function addTableRow(table, afterIndex) {
    const next = normalizeTableBlock(table, table && table.id);
    const index = Math.min(next.rows.length, Math.max(0, Number(afterIndex) + 1 || 0));
    next.rows = next.rows.map((row) => [...row]);
    next.rows.splice(index, 0, Array(next.rows[0].length).fill(""));
    return next;
  }

  function deleteTableRow(table, rowIndex) {
    const next = normalizeTableBlock(table, table && table.id);
    if (next.rows.length <= 1) return next;
    const index = Math.min(next.rows.length - 1, Math.max(0, Number(rowIndex) || 0));
    next.rows = next.rows.filter((_, currentIndex) => currentIndex !== index).map((row) => [...row]);
    return next;
  }

  function addTableColumn(table, afterIndex) {
    const next = normalizeTableBlock(table, table && table.id);
    const index = Math.min(next.rows[0].length, Math.max(0, Number(afterIndex) + 1 || 0));
    next.rows = next.rows.map((row) => {
      const cells = [...row];
      cells.splice(index, 0, "");
      return cells;
    });
    if (Array.isArray(next.alignments)) next.alignments.splice(index, 0, null);
    return next;
  }

  function deleteTableColumn(table, columnIndex) {
    const next = normalizeTableBlock(table, table && table.id);
    if (next.rows[0].length <= 1) return next;
    const index = Math.min(next.rows[0].length - 1, Math.max(0, Number(columnIndex) || 0));
    next.rows = next.rows.map((row) => row.filter((_, currentIndex) => currentIndex !== index));
    if (Array.isArray(next.alignments)) next.alignments.splice(index, 1);
    return next;
  }

  function tableColumnLabel(columnIndex) {
    let value = Math.max(0, Number(columnIndex) || 0) + 1;
    let label = "";
    while (value > 0) {
      value -= 1;
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26);
    }
    return label;
  }

  function moveTableCell(table, rowIndex, columnIndex, backwards = false) {
    let next = normalizeTableBlock(table, table && table.id);
    const columnCount = next.rows[0].length;
    const lastIndex = next.rows.length * columnCount - 1;
    const currentIndex = Math.min(lastIndex, Math.max(0, rowIndex * columnCount + columnIndex));
    if (!backwards && currentIndex === lastIndex) {
      next = addTableRow(next, next.rows.length - 1);
      return { table: next, rowIndex: next.rows.length - 1, columnIndex: 0, rowAdded: true };
    }
    const targetIndex = backwards ? Math.max(0, currentIndex - 1) : Math.min(lastIndex, currentIndex + 1);
    return {
      table: next,
      rowIndex: Math.floor(targetIndex / columnCount),
      columnIndex: targetIndex % columnCount,
      rowAdded: false
    };
  }

  function tableBlockPlainText(markdown) {
    return splitTableBlocks(markdown).map((segment) => {
      if (segment.type === "text") return segment.text;
      const table = segment.table;
      return [table.caption, ...table.rows.flat(), table.note].filter(Boolean).join(" ");
    }).join("");
  }

  const api = {
    TABLE_BLOCK_VERSION,
    TABLE_PASTE_LIMITS,
    addTableColumn,
    addTableRow,
    createTableBlock,
    detectPastedTable,
    deleteTableColumn,
    deleteTableRow,
    insertTableBlock,
    moveTableCell,
    normalizeTableBlock,
    normalizePastedTableRows,
    parseHtmlTable,
    parseMarkdownTable,
    parseTableBlockLine,
    parseTabSeparatedTable,
    replaceTableBlock,
    serializeTableBlock,
    splitTableBlocks,
    tableColumnLabel,
    tableBlockPlainText,
    updateTableCell,
    validatePastedTableSize
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusTableBlockUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
