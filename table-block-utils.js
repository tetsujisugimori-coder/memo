(function initTableBlockUtils(globalScope) {
  "use strict";

  const TABLE_BLOCK_VERSION = 1;
  const TABLE_PASTE_LIMITS = Object.freeze({ rows: 100, columns: 30, cells: 3000, tables: 10 });
  const TABLE_FILE_IMPORT_LIMITS = Object.freeze({ ...TABLE_PASTE_LIMITS, bytes: 5 * 1024 * 1024 });
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

  function tableFileImportError(message) {
    const error = new Error(message);
    error.name = "TableFileImportError";
    return error;
  }

  // This deliberately does not use normalizePastedTableRows(): a file can explicitly
  // contain trailing empty columns that must survive import unchanged.
  function validateTableFileRows(rows, limits = TABLE_PASTE_LIMITS) {
    if (!Array.isArray(rows) || !rows.length) throw tableFileImportError("実データがありません。");
    const columnCount = Array.isArray(rows[0]) ? rows[0].length : 0;
    if (!columnCount) throw tableFileImportError("実データがありません。");
    rows.forEach((row, index) => {
      if (!Array.isArray(row) || row.length !== columnCount) {
        throw tableFileImportError(`${index + 1}行目の列数が他の行と一致しません。`);
      }
    });
    const rowCount = rows.length;
    const cellCount = rowCount * columnCount;
    if (rowCount > limits.rows) throw tableFileImportError(`行数が上限の${limits.rows}行を超えています。`);
    if (columnCount > limits.columns) throw tableFileImportError(`列数が上限の${limits.columns}列を超えています。`);
    if (cellCount > limits.cells) throw tableFileImportError(`セル数が上限の${limits.cells}セルを超えています。`);
    if (!rows.some((row) => row.some((cell) => cell !== ""))) throw tableFileImportError("実データがありません。");
    return { allowed: true, rowCount, columnCount, cellCount, limits };
  }

  function parseDelimitedTable(text, delimiter, limits = TABLE_PASTE_LIMITS) {
    const separator = String(delimiter || "");
    if (separator.length !== 1) throw new TypeError("区切り文字は1文字で指定してください。");
    const original = String(text == null ? "" : text);
    if (original.includes("\0")) throw tableFileImportError("NUL文字を含むファイルは読み込めません。");
    let source = original.charCodeAt(0) === 0xfeff ? original.slice(1) : original;
    if (!source.length) throw tableFileImportError("ファイルが空です。");

    const rows = [];
    let row = [];
    let field = "";
    let state = "field";
    let line = 1;
    let column = 1;
    const finishField = () => { row.push(field); field = ""; column += 1; };
    const finishRow = () => { finishField(); rows.push(row); row = []; column = 1; line += 1; };

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      const lineBreakLength = character === "\r" && source[index + 1] === "\n" ? 2 : 1;
      const isLineBreak = character === "\n" || character === "\r";
      if (state === "quoted") {
        if (character === '"') {
          if (source[index + 1] === '"') { field += '"'; index += 1; }
          else state = "after-quote";
        } else if (isLineBreak) {
          field += "\n";
          if (lineBreakLength === 2) index += 1;
          line += 1;
          column = 1;
        } else field += character;
        continue;
      }
      if (state === "after-quote") {
        if (character === separator) { finishField(); state = "field"; continue; }
        if (isLineBreak) {
          finishRow();
          if (lineBreakLength === 2) index += 1;
          state = "field";
          continue;
        }
        throw tableFileImportError(`${line}行${column}列目：閉じ引用符の後に不正な文字があります。`);
      }
      if (character === separator) { finishField(); continue; }
      if (isLineBreak) {
        finishRow();
        if (lineBreakLength === 2) index += 1;
        continue;
      }
      if (character === '"') {
        if (field.length) throw tableFileImportError(`${line}行${column}列目：引用符はセルの先頭でのみ使用できます。`);
        state = "quoted";
        continue;
      }
      field += character;
    }
    if (state === "quoted") throw tableFileImportError(`${line}行${column}列目：引用符が閉じられていません。`);
    if (!source.endsWith("\n") && !source.endsWith("\r")) {
      finishField();
      rows.push(row);
    }
    return { rows, ...validateTableFileRows(rows, limits) };
  }

  function parseCsvTable(text, limits = TABLE_PASTE_LIMITS) {
    return parseDelimitedTable(text, ",", limits);
  }

  function parseTsvTable(text, limits = TABLE_PASTE_LIMITS) {
    return parseDelimitedTable(text, "\t", limits);
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
      if (character === "\\" && ["|", "\\"].includes(source[index + 1])) {
        cell += source[index + 1];
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
    clone.querySelectorAll("script, style, template, noscript").forEach((node) => node.remove());
    clone.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
    return normalizedCell(clone.textContent).replace(/\u00a0/g, " ").trim();
  }

  function parseHtmlTableElement(table) {
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
  }

  function parseHtmlTable(html, Parser = globalScope && globalScope.DOMParser) {
    if (typeof Parser !== "function" || !/<table(?:\s|>)/i.test(String(html || ""))) return null;
    try {
      return parseHtmlTableElement(new Parser().parseFromString(String(html), "text/html").querySelector("table"));
    } catch (error) {
      return null;
    }
  }

  const HTML_TEXT_EXCLUDED = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "HEAD", "IFRAME", "OBJECT", "EMBED"]);
  const HTML_TEXT_BLOCKS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "UL", "OL", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE", "NAV", "BLOCKQUOTE", "PRE", "DL", "DT", "DD", "HR", "TR", "TABLE"]);

  function cleanHtmlText(text) {
    return normalizedCell(text).replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // Walk detached nodes only. Never insert clipboard elements into the live DOM.
  function htmlPlainText(node) {
    if (node.nodeType === 3) return node.textContent || "";
    if (node.nodeType === 8 || HTML_TEXT_EXCLUDED.has(node.tagName)) return "";
    if (node.tagName === "BR") return "\n";
    const text = Array.from(node.childNodes || []).map(htmlPlainText).join("");
    if (["TD", "TH"].includes(node.tagName)) return text + "\t";
    return HTML_TEXT_BLOCKS.has(node.tagName) ? "\n" + text + "\n" : text;
  }

  function parseHtmlTableContent(html, Parser = globalScope && globalScope.DOMParser) {
    if (typeof Parser !== "function" || !/<table(?:\s|>)/i.test(String(html || ""))) return null;
    let documentNode;
    try {
      documentNode = new Parser().parseFromString(String(html), "text/html");
    } catch (error) {
      return null; // A parser failure permits Markdown/TSV detection.
    }
    const segments = [];
    let text = "";
    const flushText = () => {
      const value = cleanHtmlText(text);
      if (value) segments.push({ type: "text", text: value });
      text = "";
    };
    const visit = (node) => {
      if (node.nodeType === 3) { text += node.textContent || ""; return; }
      if (node.nodeType === 8 || HTML_TEXT_EXCLUDED.has(node.tagName)) return;
      if (node.tagName === "TABLE") {
        flushText();
        let table = null;
        try { table = parseHtmlTableElement(node); } catch (error) { /* Refuse the entire conversion below. */ }
        segments.push({ type: "table", table, plainText: table ? table.rows.map(row => row.join("\t")).join("\n") : cleanHtmlText(htmlPlainText(node)) });
        return; // Nested tables belong to the outer cell, never to the surrounding text.
      }
      if (node.tagName === "BR") { text += "\n"; return; }
      const block = HTML_TEXT_BLOCKS.has(node.tagName);
      if (block) text += "\n";
      Array.from(node.childNodes || []).forEach(visit);
      if (block) text += "\n";
    };
    visit(documentNode.body || documentNode);
    flushText();
    const tables = segments.filter(segment => segment.type === "table");
    if (!tables.length) return null;
    const plainText = segments.map(segment => segment.type === "text" ? segment.text : segment.plainText).join("\n\n");
    const parseFailed = tables.some(segment => !segment.table);
    if (!parseFailed && segments.length === 1) return { ...tables[0].table, plainText };
    return { format: "html-mixed", formatLabel: "文章とHTML表", segments, plainText, parseFailed };
  }

  function validateMixedTablePaste(detected, limits = TABLE_PASTE_LIMITS) {
    const tables = detected.segments.filter(segment => segment.type === "table");
    const sizes = tables.map(segment => validatePastedTableSize(segment.table?.rows, limits));
    const cellCount = sizes.reduce((sum, size) => sum + size.cellCount, 0);
    return { allowed: !detected.parseFailed && tables.length > 0 && tables.length <= limits.tables
      && sizes.every(size => size.allowed) && cellCount <= limits.cells,
      tableCount: tables.length, textCount: detected.segments.filter(segment => segment.type === "text").length,
      cellCount, sizes, limits };
  }

  function serializeMixedTablePaste(detected, createId, headers = []) {
    if (!validateMixedTablePaste(detected).allowed) throw new Error("文章と表を変換できません。テキストとして貼り付けてください。");
    const ids = new Set();
    let tableIndex = 0;
    return detected.segments.map(segment => {
      if (segment.type === "text") return segment.text;
      const id = createId();
      if (!id || ids.has(id)) throw new Error("表IDを作成できませんでした。");
      ids.add(id);
      const table = normalizeTableBlock({ ...createTableBlock(id), rows: segment.table.rows,
        hasHeader: headers[tableIndex++] ?? segment.table.hasHeader, alignments: segment.table.alignments }, id);
      return serializeTableBlock(table);
    }).join("\n\n");
  }

  function detectPastedTable({ html = "", text = "" } = {}, Parser) {
    const htmlTable = parseHtmlTableContent(html, Parser);
    if (htmlTable) return { ...htmlTable, plainText: normalizedCell(text) || htmlTable.plainText };
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
    return insertTablePasteContent(markdown, selectionStart, selectionEnd, serializeTableBlock(table));
  }

  function insertTablePasteContent(markdown, selectionStart, selectionEnd, marker) {
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

  function tableRowsForCopy(rows) {
    const sourceRows = Array.isArray(rows) && rows.length ? rows : [[""]];
    const columnCount = Math.max(1, ...sourceRows.map((row) => Array.isArray(row) ? row.length : 0));
    return sourceRows.map((row) => Array.from(
      { length: columnCount },
      (_, columnIndex) => normalizedCell(Array.isArray(row) ? row[columnIndex] : "")
    ));
  }

  function tableRowsToTabSeparated(rows) {
    return tableRowsForCopy(rows).map((row) => row.join("\t")).join("\n");
  }

  function serializeDelimitedTable(rows, delimiter) {
    const separator = String(delimiter || "");
    if (separator.length !== 1) throw new TypeError("区切り文字は1文字で指定してください。");
    const escapeCell = (value) => {
      const cell = normalizedCell(value);
      const requiresQuotes = cell.includes(separator)
        || cell.includes('"')
        || cell.includes("\r")
        || cell.includes("\n")
        || cell.trim() !== cell;
      const escaped = cell.replace(/"/g, '""');
      return requiresQuotes ? `"${escaped}"` : escaped;
    };
    return tableRowsForCopy(rows).map((row) => row.map(escapeCell).join(separator)).join("\r\n");
  }

  function serializeTableFile(rows, delimiter, limits = TABLE_FILE_IMPORT_LIMITS) {
    const sourceRows = tableRowsForCopy(rows);
    validateTableFileRows(sourceRows, limits);
    if (sourceRows.some((row) => row.some((cell) => cell.includes("\0")))) {
      throw tableFileImportError("NUL文字を含む表は書き出せません。");
    }
    const text = `\ufeff${serializeDelimitedTable(sourceRows, delimiter)}`;
    const byteLength = new TextEncoder().encode(text).byteLength;
    if (byteLength > limits.bytes) {
      throw tableFileImportError(`ファイルサイズが上限の${Math.floor(limits.bytes / (1024 * 1024))}MiBを超えています。`);
    }
    return { text, rows: sourceRows, byteLength };
  }

  function copyColumnAlignment(table, columnIndex) {
    const alignment = Array.isArray(table.alignments) ? table.alignments[columnIndex] : null;
    return ["left", "center", "right"].includes(alignment) ? alignment : null;
  }

  function escapeTableHtmlCell(value) {
    return normalizedCell(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/\n/g, "<br>");
  }

  function tableBlockToHtml(tableValue) {
    const table = normalizeTableBlock(tableValue, tableValue && tableValue.id);
    const rows = tableRowsForCopy(table.rows);
    const renderRows = (sourceRows, cellTag) => sourceRows.map((row) => [
      "    <tr>",
      ...row.map((cell, columnIndex) => {
        const alignment = copyColumnAlignment(table, columnIndex);
        const style = alignment ? ` style="text-align: ${alignment}"` : "";
        return `      <${cellTag}${style}>${escapeTableHtmlCell(cell)}</${cellTag}>`;
      }),
      "    </tr>"
    ].join("\n")).join("\n");
    const lines = ["<table>"];
    if (table.hasHeader) {
      lines.push("  <thead>", renderRows(rows.slice(0, 1), "th"), "  </thead>");
    }
    lines.push("  <tbody>");
    const bodyRows = table.hasHeader ? rows.slice(1) : rows;
    if (bodyRows.length) lines.push(renderRows(bodyRows, "td"));
    lines.push("  </tbody>", "</table>");
    return lines.join("\n");
  }

  function escapeMarkdownTableCell(value) {
    return normalizedCell(value)
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, " ");
  }

  function markdownAlignmentMarker(alignment) {
    if (alignment === "left") return ":---";
    if (alignment === "center") return ":---:";
    if (alignment === "right") return "---:";
    return "---";
  }

  function markdownTableRow(row) {
    return `| ${row.map(escapeMarkdownTableCell).join(" | ")} |`;
  }

  function tableBlockToMarkdown(tableValue) {
    const table = normalizeTableBlock(tableValue, tableValue && tableValue.id);
    const rows = tableRowsForCopy(table.rows);
    const columnCount = rows[0].length;
    const header = table.hasHeader
      ? rows[0]
      : Array.from({ length: columnCount }, (_, index) => tableColumnLabel(index));
    const bodyRows = table.hasHeader ? rows.slice(1) : rows;
    return [
      markdownTableRow(header),
      markdownTableRow(Array.from(
        { length: columnCount },
        (_, index) => markdownAlignmentMarker(copyColumnAlignment(table, index))
      )),
      ...bodyRows.map(markdownTableRow)
    ].join("\n");
  }

  async function writeTextToClipboard(text, options = {}) {
    const clipboard = options.clipboard || (globalScope && globalScope.navigator && globalScope.navigator.clipboard);
    let clipboardError = null;
    if (clipboard && typeof clipboard.writeText === "function") {
      try {
        await clipboard.writeText(String(text));
        return { mode: "text", text: String(text) };
      } catch (error) {
        clipboardError = error;
      }
    }
    if (typeof options.fallbackCopyText === "function") {
      await options.fallbackCopyText(String(text));
      return { mode: "fallback", text: String(text) };
    }
    throw clipboardError || new Error("クリップボードへコピーできませんでした");
  }

  async function writeTableToClipboard(table, options = {}) {
    const plainText = tableRowsToTabSeparated(table && table.rows);
    const htmlText = tableBlockToHtml(table);
    const clipboard = options.clipboard || (globalScope && globalScope.navigator && globalScope.navigator.clipboard);
    const ClipboardItemCtor = options.ClipboardItem || (globalScope && globalScope.ClipboardItem);
    const BlobCtor = options.Blob || (globalScope && globalScope.Blob);
    if (
      clipboard
      && typeof clipboard.write === "function"
      && typeof ClipboardItemCtor === "function"
      && typeof BlobCtor === "function"
    ) {
      try {
        const item = new ClipboardItemCtor({
          "text/plain": new BlobCtor([plainText], { type: "text/plain" }),
          "text/html": new BlobCtor([htmlText], { type: "text/html" })
        });
        await clipboard.write([item]);
        return { mode: "rich", plainText, htmlText };
      } catch (error) {
        if (typeof options.onRichCopyError === "function") options.onRichCopyError(error);
      }
    }
    const result = await writeTextToClipboard(plainText, {
      clipboard,
      fallbackCopyText: options.fallbackCopyText
    });
    return { mode: result.mode, plainText, htmlText };
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
    TABLE_FILE_IMPORT_LIMITS,
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
    parseHtmlTableElement,
    parseHtmlTableContent,
    validateMixedTablePaste,
    serializeMixedTablePaste,
    insertTablePasteContent,
    parseMarkdownTable,
    parseDelimitedTable,
    parseCsvTable,
    parseTsvTable,
    parseTableBlockLine,
    parseTabSeparatedTable,
    replaceTableBlock,
    serializeTableBlock,
    splitTableBlocks,
    tableColumnLabel,
    tableBlockPlainText,
    tableBlockToHtml,
    tableBlockToMarkdown,
    serializeDelimitedTable,
    serializeTableFile,
    updateTableCell,
    validatePastedTableSize,
    validateTableFileRows,
    tableRowsToTabSeparated,
    tableRowsForCopy,
    writeTableToClipboard,
    writeTextToClipboard
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusTableBlockUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
