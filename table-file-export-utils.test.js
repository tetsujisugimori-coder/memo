"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { chartFileExportName, downloadDelimitedFile, downloadTableFile, tableFileExportName } = require("./table-file-export-utils.js");

function downloadEnvironment({ clickError = false } = {}) {
  const events = [];
  const urls = new Set();
  class MessageChannel {
    constructor() {
      this.port1 = { close: () => events.push("port1-close"), onmessage: null };
      this.port2 = { close: () => events.push("port2-close"), postMessage: () => queueMicrotask(() => this.port1.onmessage()) };
    }
  }
  const anchor = {
    setAttribute: () => {},
    removeAttribute: () => events.push("remove-href"),
    remove: () => events.push("remove"),
    click: () => { events.push("click"); if (clickError) throw new Error("download"); }
  };
  const doc = {
    defaultView: {
      MessageChannel,
      URL: {
        createObjectURL: () => { urls.add("blob:test"); events.push("create"); return "blob:test"; },
        revokeObjectURL: (url) => { urls.delete(url); events.push("revoke"); }
      }
    },
    createElement: () => anchor,
    body: { append: () => events.push("append") }
  };
  return { anchor, doc, events, urls };
}

test("表ファイル名はWindowsで安全なタイトル、表番号、拡張子を使う", () => {
  assert.equal(tableFileExportName("売上:集計.csv", 0, "csv"), "売上_集計-table-1.csv");
  assert.equal(tableFileExportName("CON", 1, "tsv"), "_CON-table-2.tsv");
  assert.equal(tableFileExportName("", 0, "csv"), "無題のメモ-table-1.csv");
  assert.match(tableFileExportName("x".repeat(200), 0, "csv"), /^x{110}-table-1\.csv$/);
  assert.throws(() => tableFileExportName("x", 0, "xlsx"), /書き出し形式/);
});

test("グラフファイル名も同じWindows安全規則とグラフ番号を使う", () => {
  assert.equal(chartFileExportName("売上:集計.tsv", 1, "csv"), "売上_集計-chart-2.csv");
  assert.equal(chartFileExportName("NUL", 0, "tsv"), "_NUL-chart-1.tsv");
  assert.equal(chartFileExportName("", 0, "csv"), "無題のメモ-chart-1.csv");
});

test("表ファイルのダウンロードは一時要素とObject URLを解放する", async () => {
  const environment = downloadEnvironment();
  await downloadTableFile({ size: 1 }, "表.csv", environment.doc);
  assert.deepEqual(environment.events, ["create", "append", "click", "remove", "remove-href", "port1-close", "port2-close", "revoke"]);
  assert.deepEqual([...environment.urls], []);
  assert.equal(environment.anchor.download, "表.csv");
});

test("表ファイルのダウンロード失敗時も一時要素とObject URLを解放する", async () => {
  const environment = downloadEnvironment({ clickError: true });
  await assert.rejects(downloadTableFile({ size: 1 }, "表.csv", environment.doc), /download/);
  assert.deepEqual(environment.events, ["create", "append", "click", "remove", "remove-href", "revoke"]);
  assert.deepEqual([...environment.urls], []);
});

test("独立したグラフ保存要求はそれぞれのURLを解放する", async () => {
  const first = downloadEnvironment();
  const second = downloadEnvironment();
  await Promise.all([
    downloadDelimitedFile({ size: 1 }, "一つ目.csv", first.doc),
    downloadDelimitedFile({ size: 1 }, "二つ目.tsv", second.doc)
  ]);
  assert.deepEqual([...first.urls], []);
  assert.deepEqual([...second.urls], []);
  assert.equal(first.anchor.download, "一つ目.csv");
  assert.equal(second.anchor.download, "二つ目.tsv");
});
