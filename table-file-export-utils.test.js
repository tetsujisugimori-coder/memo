"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { chartFileExportName, downloadDelimitedFile, downloadTableFile, tableFileExportName } = require("./table-file-export-utils.js");

function downloadEnvironment({ clickError = false, holdDelivery = false, onClick = () => {} } = {}) {
  const events = [];
  const urls = new Set();
  const deliveries = [];
  class MessageChannel {
    constructor() {
      this.port1 = { close: () => events.push("port1-close"), onmessage: null };
      this.port2 = { close: () => events.push("port2-close"), postMessage: () => {
        const deliver = () => this.port1.onmessage();
        if (holdDelivery) deliveries.push(deliver);
        else queueMicrotask(deliver);
      } };
    }
  }
  const anchor = {
    setAttribute: () => {},
    removeAttribute: () => events.push("remove-href"),
    remove: () => events.push("remove"),
    click: () => { events.push("click"); onClick(); if (clickError) throw new Error("download"); }
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
  return { anchor, deliveries, doc, events, urls };
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
  assert.deepEqual(environment.events, ["create", "append", "click", "port1-close", "port2-close", "remove", "remove-href", "revoke"]);
  assert.deepEqual([...environment.urls], []);
  assert.equal(environment.anchor.download, "表.csv");
});

test("表ファイルのダウンロード失敗時も一時要素とObject URLを解放する", async () => {
  const environment = downloadEnvironment({ clickError: true });
  await assert.rejects(downloadTableFile({ size: 1 }, "表.csv", environment.doc), /download/);
  assert.deepEqual(environment.events, ["create", "append", "click", "remove", "remove-href", "revoke"]);
  assert.deepEqual([...environment.urls], []);
});

test("配送開始後の解放例外は完了したダウンロードを失敗扱いにしない", async () => {
  const environment = downloadEnvironment();
  const revoke = environment.doc.defaultView.URL.revokeObjectURL;
  environment.doc.defaultView.URL.revokeObjectURL = (url) => {
    revoke(url);
    throw new Error("cleanup");
  };
  await downloadTableFile({ size: 1 }, "表.csv", environment.doc);
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

test("ほぼ同時の2件は最初の配送完了まで次のリンクを起動しない", async () => {
  const clicks = [];
  const first = downloadEnvironment({ holdDelivery: true, onClick: () => clicks.push("first") });
  const second = downloadEnvironment({ onClick: () => clicks.push("second") });
  const firstRequest = downloadDelimitedFile({ size: 1 }, "一つ目.csv", first.doc);
  const secondRequest = downloadDelimitedFile({ size: 1 }, "二つ目.tsv", second.doc);
  assert.deepEqual(clicks, ["first"]);
  assert.deepEqual(first.events, ["create", "append", "click"], "link and URL remain until the delivery task completes");
  assert.equal(first.urls.size, 1);
  assert.deepEqual(second.events, [], "second request waits without creating an Object URL");
  first.deliveries.shift()();
  await Promise.all([firstRequest, secondRequest]);
  assert.deepEqual(clicks, ["first", "second"]);
  assert.deepEqual([...first.urls, ...second.urls], []);
});

test("先行する保存が失敗しても後続の保存は開始できる", async () => {
  const first = downloadEnvironment({ clickError: true });
  const second = downloadEnvironment();
  const firstRequest = downloadDelimitedFile({ size: 1 }, "失敗.csv", first.doc);
  const secondRequest = downloadDelimitedFile({ size: 1 }, "次.tsv", second.doc);
  await assert.rejects(firstRequest, /download/);
  await secondRequest;
  assert.equal(second.events.includes("click"), true);
  assert.deepEqual([...first.urls, ...second.urls], []);
});
