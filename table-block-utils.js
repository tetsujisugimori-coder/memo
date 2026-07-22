(function initTableBlockUtils(globalScope) {
  "use strict";

  const TABLE_BLOCK_VERSION = 1;
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

  function normalizeTableBlock(value, fallbackId = "table") {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const sourceRows = Array.isArray(source.rows) && source.rows.length ? source.rows : [[""]];
    const columnCount = Math.max(1, ...sourceRows.map((row) => Array.isArray(row) ? row.length : 0));
    const rows = sourceRows.map((row) => {
      const cells = Array.isArray(row) ? row.slice(0, columnCount).map(normalizedCell) : [];
      while (cells.length < columnCount) cells.push("");
      return cells;
    });
    return {
      ...source,
      type: "table",
      id: normalizedCell(source.id).trim() || normalizedCell(fallbackId).trim() || "table",
      caption: normalizedCell(source.caption),
      note: normalizedCell(source.note),
      hasHeader: source.hasHeader !== false,
      version: Number.isInteger(source.version) && source.version > 0 ? source.version : TABLE_BLOCK_VERSION,
      rows
    };
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
    return next;
  }

  function deleteTableColumn(table, columnIndex) {
    const next = normalizeTableBlock(table, table && table.id);
    if (next.rows[0].length <= 1) return next;
    const index = Math.min(next.rows[0].length - 1, Math.max(0, Number(columnIndex) || 0));
    next.rows = next.rows.map((row) => row.filter((_, currentIndex) => currentIndex !== index));
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
    addTableColumn,
    addTableRow,
    createTableBlock,
    deleteTableColumn,
    deleteTableRow,
    insertTableBlock,
    moveTableCell,
    normalizeTableBlock,
    parseTableBlockLine,
    replaceTableBlock,
    serializeTableBlock,
    splitTableBlocks,
    tableColumnLabel,
    tableBlockPlainText,
    updateTableCell
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusTableBlockUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
