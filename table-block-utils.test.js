"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { buildMemoExportBundle } = require("./attachment-utils.js");
const {
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
} = require("./table-block-utils.js");

class HtmlTableTestParser {
  parseFromString(html) {
    const tableMatch = String(html).match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) return { querySelector: () => null };
    const table = { querySelectorAll: () => rows };
    const rows = Array.from(tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((rowMatch) => ({
      closest: () => table,
      children: Array.from(rowMatch[1].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)).map((cellMatch) => {
        const attributes = cellMatch[2];
        return {
          tagName: cellMatch[1].toUpperCase(),
          getAttribute(name) {
            const match = attributes.match(new RegExp(`${name}=["']?(\\d+)`, "i"));
            return match ? match[1] : null;
          },
          cloneNode() {
            let content = cellMatch[3];
            const clone = {
              querySelectorAll(selector) {
                if (selector === "script, style, template") {
                  const matches = Array.from(content.matchAll(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi));
                  return matches.map((match) => ({ remove: () => { content = content.replace(match[0], ""); } }));
                }
                if (selector === "br") {
                  const matches = Array.from(content.matchAll(/<br\s*\/?\s*>/gi));
                  return matches.map((match) => ({ replaceWith: (value) => { content = content.replace(match[0], value); } }));
                }
                return [];
              },
              get textContent() {
                return content.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
              }
            };
            return clone;
          }
        };
      })
    }));
    return { querySelector: (selector) => selector === "table" ? table : null };
  }
}

function tableBlocks(markdown) {
  return splitTableBlocks(markdown).filter((segment) => segment.type === "table");
}

test("初期表は2列2行、先頭行見出し、空の説明と補足を持つ", () => {
  const table = createTableBlock("table-1");
  assert.equal(table.type, "table");
  assert.equal(table.id, "table-1");
  assert.equal(table.version, TABLE_BLOCK_VERSION);
  assert.equal(table.hasHeader, true);
  assert.equal(table.caption, "");
  assert.equal(table.note, "");
  assert.deepEqual(table.rows, [["", ""], ["", ""]]);
});

test("カーソル位置へ表を挿入し選択範囲を置換する", () => {
  const table = createTableBlock("inserted");
  const result = insertTableBlock("前XX後", 1, 3, table);
  assert.match(result.value, /^前\n<!-- memo-nexus:table-block:/);
  assert.match(result.value, / -->\n後$/);
  assert.equal(result.selectionStart, result.selectionEnd);
});

test("本文の先頭と末尾へ余計な空行を必須にせず挿入できる", () => {
  const table = createTableBlock("edge");
  assert.equal(tableBlocks(insertTableBlock("本文", 0, 0, table).value).length, 1);
  assert.equal(tableBlocks(insertTableBlock("本文", 2, 2, table).value).length, 1);
});

test("既存表マーカー内部のカーソル位置でも保存データを分断しない", () => {
  const existing = serializeTableBlock(createTableBlock("existing"));
  const result = insertTableBlock(`${existing}\n後`, 10, 10, createTableBlock("new"));
  assert.deepEqual(tableBlocks(result.value).map((block) => block.table.id), ["existing", "new"]);
});

test("直列化した構造化データを同じ内容へ復元する", () => {
  const source = normalizeTableBlock({
    id: "round-trip", caption: "説明", note: "出典", hasHeader: false,
    rows: [["A", "B"], ["1", "2"]], version: 1
  });
  assert.deepEqual(parseTableBlockLine(serializeTableBlock(source)), source);
});

test("空セル、空説明、空補足を保存後も維持する", () => {
  const table = createTableBlock("empty-values");
  const restored = parseTableBlockLine(serializeTableBlock(table));
  assert.deepEqual(restored.rows, [["", ""], ["", ""]]);
  assert.equal(restored.caption, "");
  assert.equal(restored.note, "");
});

test("日本語、改行、HTML風文字列をプレーンテキストのまま保持する", () => {
  const table = normalizeTableBlock({
    id: "unicode", rows: [["<script>alert(1)</script>", "日本語\n2行目"]]
  });
  const restored = parseTableBlockLine(serializeTableBlock(table));
  assert.equal(restored.rows[0][0], "<script>alert(1)</script>");
  assert.equal(restored.rows[0][1], "日本語\n2行目");
});

test("列数が不揃いな保存データを最大列数へ正規化する", () => {
  const table = normalizeTableBlock({ id: "uneven", rows: [["A"], ["B", "C", "D"]] });
  assert.deepEqual(table.rows, [["A", "", ""], ["B", "C", "D"]]);
});

test("将来バージョンと未知メタデータを正規化後も維持する", () => {
  const table = normalizeTableBlock({ id: "future", version: 3, rows: [[""]], sourceApp: "future", options: { pinned: true } });
  assert.equal(table.version, 3);
  assert.equal(table.sourceApp, "future");
  assert.deepEqual(table.options, { pinned: true });
});

test("コードフェンス内の表マーカーとは衝突しない", () => {
  const marker = serializeTableBlock(createTableBlock("code"));
  const markdown = ["```markdown", marker, "```"].join("\n");
  assert.equal(tableBlocks(markdown).length, 0);
  assert.equal(splitTableBlocks(markdown)[0].text, markdown);
});

test("画像ブロック内の説明にある表マーカーとは衝突しない", () => {
  const marker = serializeTableBlock(createTableBlock("image-caption"));
  const markdown = ["<!-- memo-nexus:image-block -->", "![画像](attachment://id)", marker, "<!-- /memo-nexus:image-block -->"].join("\n");
  assert.equal(tableBlocks(markdown).length, 0);
});

test("1本文内の複数表を順序と固有IDを保って分割する", () => {
  const first = serializeTableBlock(createTableBlock("first"));
  const second = serializeTableBlock(createTableBlock("second"));
  const blocks = tableBlocks(`前\n${first}\n中\n${second}\n後`);
  assert.deepEqual(blocks.map((block) => block.table.id), ["first", "second"]);
});

test("セル編集は対象セルだけを変更する", () => {
  const table = createTableBlock("cell");
  const next = updateTableCell(table, 1, 1, "更新");
  assert.deepEqual(next.rows, [["", ""], ["", "更新"]]);
  assert.deepEqual(table.rows, [["", ""], ["", ""]]);
});

test("選択行の後ろへ同じ列数の行を追加する", () => {
  const next = addTableRow(createTableBlock("row-add"), 0);
  assert.equal(next.rows.length, 3);
  assert.deepEqual(next.rows[1], ["", ""]);
});

test("行削除後も残るデータを維持する", () => {
  const table = normalizeTableBlock({ id: "row-delete", rows: [["H"], ["A"], ["B"]] });
  assert.deepEqual(deleteTableRow(table, 1).rows, [["H"], ["B"]]);
});

test("最後の1行は削除しない", () => {
  const table = normalizeTableBlock({ id: "one-row", rows: [["keep"]] });
  assert.deepEqual(deleteTableRow(table, 0).rows, [["keep"]]);
});

test("選択列の後ろへ全行共通の列を追加する", () => {
  const table = normalizeTableBlock({ id: "column-add", rows: [["A", "B"], ["1", "2"]] });
  assert.deepEqual(addTableColumn(table, 0).rows, [["A", "", "B"], ["1", "", "2"]]);
});

test("列削除後も各行の対応データを維持する", () => {
  const table = normalizeTableBlock({ id: "column-delete", rows: [["A", "B"], ["1", "2"]] });
  assert.deepEqual(deleteTableColumn(table, 0).rows, [["B"], ["2"]]);
});

test("最後の1列は削除しない", () => {
  const table = normalizeTableBlock({ id: "one-column", rows: [["keep"], ["value"]] });
  assert.deepEqual(deleteTableColumn(table, 0).rows, [["keep"], ["value"]]);
});

test("列記号はZの次をAA、ABとして生成する", () => {
  assert.deepEqual([0, 25, 26, 27, 51, 52].map(tableColumnLabel), ["A", "Z", "AA", "AB", "AZ", "BA"]);
});

test("タブ区切りは空セルと文字列表現を保ち矩形へ正規化する", () => {
  const parsed = parseTabSeparatedTable("商品\tコード\t数量\nりんご\t00123\t2\nみかん\t\t5");
  assert.equal(parsed.format, "tab-separated");
  assert.deepEqual(parsed.rows, [
    ["商品", "コード", "数量"],
    ["りんご", "00123", "2"],
    ["みかん", "", "5"]
  ]);
  assert.equal(parseTabSeparatedTable("1行目\n2行目"), null);
  assert.deepEqual(parseTabSeparatedTable("A\tB").rows, [["A", "B"]]);
  assert.equal(detectPastedTable({ text: "価格は1,200円です。CSVではありません。" }), null);
});

test("タブ区切りの不揃いな行は不足セルを補い途中の空行を保つ", () => {
  const parsed = parseTabSeparatedTable("A\tB\tC\n1\t2\n\t\t\n3\t4\t5");
  assert.deepEqual(parsed.rows, [
    ["A", "B", "C"],
    ["1", "2", ""],
    ["", "", ""],
    ["3", "4", "5"]
  ]);
});

test("Markdown表は区切り行を除き配置指定とエスケープ済みパイプを取得する", () => {
  const parsed = parseMarkdownTable("名前 | 説明 | 金額\n:--- | :---: | ---:\nりんご | 赤\\|青 | 300");
  assert.equal(parsed.format, "markdown");
  assert.deepEqual(parsed.alignments, ["left", "center", "right"]);
  assert.deepEqual(parsed.rows, [["名前", "説明", "金額"], ["りんご", "赤|青", "300"]]);
  assert.equal(parseMarkdownTable("通常文章 | 区切りだけ"), null);
});

test("Markdown表は先頭と末尾のパイプの有無を問わず見出しを取得する", () => {
  assert.deepEqual(parseMarkdownTable("| A | B |\n| --- | --- |\n| 1 | 2 |").rows, [["A", "B"], ["1", "2"]]);
  assert.deepEqual(parseMarkdownTable("A | B\n--- | ---\n1 | 2").rows, [["A", "B"], ["1", "2"]]);
});

test("HTML表はタグとscriptを残さずth、改行、結合セルを安全な文字列へ変換する", () => {
  const parsed = parseHtmlTable(
    "<table><thead><tr><th>名前</th><th>説明<script>throw 1</script></th></tr></thead><tbody><tr><td rowspan=\"2\">A<br>B</td><td>1</td></tr><tr><td>2</td></tr></tbody></table>",
    HtmlTableTestParser
  );
  assert.equal(parsed.format, "html");
  assert.equal(parsed.hasHeader, true);
  assert.equal(parsed.hasMergedCells, true);
  assert.deepEqual(parsed.rows, [["名前", "説明"], ["A\nB", "1"], ["", "2"]]);
  assert.doesNotMatch(parsed.rows.flat().join(" "), /script|throw/);
});

test("HTMLしかないクリップボードでは抽出済みセルをテキスト貼り付け用に保持する", () => {
  const parsed = detectPastedTable({ html: "<table><tr><td>A</td><td>B</td></tr></table>" }, HtmlTableTestParser);
  assert.equal(parsed.format, "html");
  assert.equal(parsed.plainText, "A\tB");
});

test("HTML解析不能時はMarkdown、タブ区切りの順へフォールバックする", () => {
  class BrokenParser { parseFromString() { throw new Error("broken"); } }
  const markdown = detectPastedTable({ html: "<table>", text: "A | B\n--- | ---\n1 | 2" }, BrokenParser);
  const tabs = detectPastedTable({ html: "<table>", text: "A\tB\n1\t2" }, BrokenParser);
  assert.equal(markdown.format, "markdown");
  assert.equal(tabs.format, "tab-separated");
});

test("貼り付けデータは末尾の空行・空列だけ除き途中の空行・空列と型を保つ", () => {
  assert.deepEqual(normalizePastedTableRows([
    ["00123", "", "TRUE", ""],
    ["", "", "", ""],
    ["1-2", "", "=SUM(A1:A2)", ""],
    ["", "", "", ""]
  ]), [
    ["00123", "", "TRUE"],
    ["", "", ""],
    ["1-2", "", "=SUM(A1:A2)"]
  ]);
});

test("表貼り付け上限は100行、30列、3000セルを切り捨てず判定する", () => {
  assert.deepEqual(TABLE_PASTE_LIMITS, { rows: 100, columns: 30, cells: 3000 });
  assert.equal(validatePastedTableSize(Array.from({ length: 100 }, () => Array(30).fill("x"))).allowed, true);
  const tooManyRows = validatePastedTableSize(Array.from({ length: 101 }, () => ["x"]));
  const tooManyColumns = validatePastedTableSize([Array(31).fill("x")]);
  assert.equal(tooManyRows.allowed, false);
  assert.equal(tooManyRows.rowCount, 101);
  assert.equal(tooManyColumns.allowed, false);
  assert.equal(tooManyColumns.columnCount, 31);
});

test("見出し行オン・オフを保存復元できる", () => {
  const table = normalizeTableBlock({ ...createTableBlock("header"), hasHeader: false });
  assert.equal(parseTableBlockLine(serializeTableBlock(table)).hasHeader, false);
});

test("Markdown由来の列配置は保存復元と列追加・削除に追従する", () => {
  const table = normalizeTableBlock({ id: "alignment", rows: [["A", "B"]], alignments: ["left", "right"] });
  assert.deepEqual(parseTableBlockLine(serializeTableBlock(table)).alignments, ["left", "right"]);
  const added = addTableColumn(table, 0);
  assert.deepEqual(added.alignments, ["left", null, "right"]);
  assert.deepEqual(deleteTableColumn(added, 1).alignments, ["left", "right"]);
});

test("Tabは右隣、行末では次行先頭へ移動する", () => {
  const table = createTableBlock("tab");
  assert.deepEqual(moveTableCell(table, 0, 0), { table, rowIndex: 0, columnIndex: 1, rowAdded: false });
  assert.deepEqual(moveTableCell(table, 0, 1), { table, rowIndex: 1, columnIndex: 0, rowAdded: false });
});

test("Shift+Tabは左隣へ移動し先頭より前へ出ない", () => {
  const table = createTableBlock("shift-tab");
  assert.equal(moveTableCell(table, 1, 0, true).rowIndex, 0);
  assert.equal(moveTableCell(table, 1, 0, true).columnIndex, 1);
  assert.deepEqual(moveTableCell(table, 0, 0, true), { table, rowIndex: 0, columnIndex: 0, rowAdded: false });
});

test("最後のセルでTabを押すと行を追加し新しい先頭セルへ移動する", () => {
  const table = createTableBlock("tab-add");
  const result = moveTableCell(table, 1, 1);
  assert.equal(result.rowAdded, true);
  assert.equal(result.table.rows.length, 3);
  assert.deepEqual([result.rowIndex, result.columnIndex], [2, 0]);
});

test("表の差し替えは前後のMarkdownを変更しない", () => {
  const source = `前\n${serializeTableBlock(createTableBlock("replace"))}\n後`;
  const block = tableBlocks(source)[0];
  const next = updateTableCell(block.table, 0, 0, "見出し");
  const replaced = replaceTableBlock(source, block, next);
  assert.match(replaced, /^前\n/);
  assert.match(replaced, /\n後$/);
  assert.equal(tableBlocks(replaced)[0].table.rows[0][0], "見出し");
});

test("表全体の削除は対象マーカーだけを除去する", () => {
  const source = `前\n${serializeTableBlock(createTableBlock("delete"))}\n後`;
  const deleted = replaceTableBlock(source, tableBlocks(source)[0], null);
  assert.equal(tableBlocks(deleted).length, 0);
  assert.match(deleted, /前[\s\S]*後/);
});

test("保存・再読み込み・複製でもIDとデータを保持する", () => {
  const body = serializeTableBlock(normalizeTableBlock({ id: "stable-id", caption: "説明", rows: [["A", "B"]], note: "補足" }));
  const storedNote = JSON.parse(JSON.stringify({ id: "memo", body }));
  const duplicatedNote = { ...storedNote, id: "memo-copy" };
  [storedNote, duplicatedNote].forEach((note) => {
    const [block] = tableBlocks(note.body);
    assert.equal(block.table.id, "stable-id");
    assert.deepEqual(block.table.rows, [["A", "B"]]);
  });
});

test("Markdownエクスポートは表の構造化データを欠落させない", () => {
  const body = `説明\n${serializeTableBlock(createTableBlock("export"))}`;
  const bundle = buildMemoExportBundle({ markdownPath: "表.md", markdownContent: body, attachments: [] });
  assert.equal(bundle.files[0].content, body);
  assert.equal(tableBlocks(bundle.files[0].content)[0].table.id, "export");
});

test("不正な表マーカーは削除せず通常テキストとして残す", () => {
  const invalid = "<!-- memo-nexus:table-block:not-hex -->";
  assert.equal(parseTableBlockLine(invalid), null);
  assert.equal(splitTableBlocks(invalid)[0].text, invalid);
});

test("CRLF本文も表と前後テキストへ安全に分割する", () => {
  const marker = serializeTableBlock(createTableBlock("crlf"));
  const segments = splitTableBlocks(`前\r\n${marker}\r\n後`);
  assert.equal(segments.filter((segment) => segment.type === "table").length, 1);
  assert.match(segments.map((segment) => segment.text || "").join(""), /前[\s\S]*後/);
});

test("一覧用本文では内部マーカーを出さず表の説明・セル・補足を使う", () => {
  const marker = serializeTableBlock(normalizeTableBlock({ id: "plain", caption: "売上", rows: [["月", "金額"], ["7月", "100"]], note: "速報" }));
  const text = tableBlockPlainText(`前\n${marker}\n後`);
  assert.doesNotMatch(text, /memo-nexus:table-block/);
  assert.match(text, /売上 月 金額 7月 100 速報/);
});

test("カード描画は意味的tableとHTMLエスケープを使い編集UIを含めない", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const start = app.indexOf("function renderTableBlock(");
  const end = app.indexOf("\nfunction renderImageBlock(", start);
  const source = app.slice(start, end);
  assert.match(source, /<table aria-label=/);
  assert.match(source, /<thead>/);
  assert.match(source, /<tbody>/);
  assert.match(source, /escapeHtml\(cell\)/);
  assert.doesNotMatch(source, /input|button|contenteditable/);
});

test("行列見出しはbuttonとaria-pressedを使いデータセルとは分離する", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const start = app.indexOf("function createTableEditor(");
  const end = app.indexOf("\nfunction renderTableBlockEditors(", start);
  const source = app.slice(start, end);
  assert.match(source, /tableAxisSelector\("column"/);
  assert.match(source, /tableAxisSelector\("row"/);
  assert.match(app, /button\.setAttribute\("aria-pressed", String\(selected\)\)/);
  assert.match(app, /`\$\{label\}行目を選択`.*`\$\{label\}列を選択`/s);
  assert.match(source, /tableElement\.append\(tableHead, tableBody\)/);
});

test("行列選択は表IDごとに保持し同じ見出しの再押下で解除する", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const start = app.indexOf("function handleTableAxisSelection(");
  const end = app.indexOf("\nfunction closeTableAxisDeleteDialog(", start);
  const source = app.slice(start, end);
  assert.match(app, /const tableAxisSelections = new Map\(\)/);
  assert.match(source, /current\?\.type === type && current\.index === index/);
  assert.match(source, /tableAxisSelections\.delete\(tableId\)/);
  assert.match(source, /tableAxisSelections\.set\(tableId, \{ type, index \}\)/);
  assert.match(source, /renderTableBlockEditors\(\);\s*focusTableAxisHeader\(tableId, type, index\)/);
});

test("未選択の行列削除は末尾へフォールバックせず案内する", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const start = app.indexOf("function handleTableEditorAction(");
  const end = app.indexOf("\nfunction ", start + 10);
  const source = app.slice(start, end);
  assert.equal((source.match(/confirm\(/g) || []).length, 1);
  assert.match(source, /case "delete-table":[\s\S]*confirm\("この表ブロックを削除しますか？"\)/);
  assert.match(source, /case "delete-row":[\s\S]*削除する行を選択してください/);
  assert.match(source, /case "delete-column":[\s\S]*削除する列を選択してください/);
  assert.doesNotMatch(source, /activeTableCell[\s\S]*rows\.length - 1/);
});

test("追加は選択位置の直後または末尾とし選択解除後に新しい先頭セルへフォーカスする", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const start = app.indexOf("function handleTableEditorAction(");
  const end = app.indexOf("\nfunction ", start + 10);
  const source = app.slice(start, end);
  assert.match(source, /selection\?\.type === "row" \? selection\.index : next\.rows\.length - 1/);
  assert.match(source, /selection\?\.type === "column" \? selection\.index : next\.rows\[0\]\.length - 1/);
  assert.match(source, /focusCell = \{ rowIndex: Math\.min\(afterIndex \+ 1, next\.rows\.length - 1\), columnIndex: 0 \}/);
  assert.match(source, /focusCell = \{ rowIndex: 0, columnIndex: Math\.min\(afterIndex \+ 1, next\.rows\[0\]\.length - 1\) \}/);
  assert.match(source, /if \(focusCell\) tableAxisSelections\.delete\(tableId\)/);
  assert.match(source, /focusTableCell\(tableId, focusCell\.rowIndex, focusCell\.columnIndex\)/);
  assert.doesNotMatch(source, /tableAxisSelections\.set\(tableId, focusSelection\)/);
});

test("セルフォーカスは再描画後に対象表IDと座標で一意に特定する", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const start = app.indexOf("function focusTableCell(");
  const end = app.indexOf("\nfunction insertTableAtSelection(", start);
  const source = app.slice(start, end);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /data-table-id="\$\{CSS\.escape\(tableId\)\}"/);
  assert.match(source, /data-row-index="\$\{rowIndex\}"/);
  assert.match(source, /data-column-index="\$\{columnIndex\}"/);
  assert.match(source, /input\.focus\(\)/);
});

test("行列削除は日本語dialogで確認し削除後に近い見出しを選択する", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /id="tableAxisDeleteDialog"[\s\S]*id="cancelTableAxisDeleteBtn"[^>]*>キャンセル<[\s\S]*id="confirmTableAxisDeleteBtn"[^>]*>削除</);
  assert.match(app, /tableAxisDeleteMessage\.textContent = `\$\{label\}を削除しますか？`/);
  assert.match(app, /const nextIndex = Math\.min\(pending\.index, count - 2\)/);
  assert.match(app, /表には最低1行必要なため削除できません/);
  assert.match(app, /表には最低1列必要なため削除できません/);
});
