const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const app = fs.readFileSync("app.js", "utf8");
const popup = fs.readFileSync("extensions/web-clipper/popup.js", "utf8");
const config = fs.readFileSync("extensions/web-clipper/config.js", "utf8");
const manifest = fs.readFileSync("extensions/web-clipper/manifest.json", "utf8");

test("本体はフラグメントを消費して履歴からクリップpayloadを除去する", () => {
  assert.match(app, /function consumeWebClipFragment\(\)/);
  assert.match(app, /readWebClipFragment\(location\.hash\)/);
  assert.match(app, /history\.replaceState\(history\.state, "", `\$\{url\.pathname\}\$\{url\.search\}`\)/);
  assert.match(app, /クリップデータを読み取れませんでした。元のページからもう一度実行してください。/);
});

test("拡張は選択した接続先のURLへフラグメントpayloadで遷移する", () => {
  assert.match(popup, /MemoNexusClipPayload\.buildWebClipDestination\(destination, clip\)/);
  assert.doesNotMatch(popup, /receiver\.postMessage\(/);
  assert.match(config, /development: "http:\/\/127\.0\.0\.1:5500\/"/);
  assert.doesNotMatch(config, /localhost:5500/);
  assert.match(manifest, /http:\/\/127\.0\.0\.1:5500\/\*/);
  assert.doesNotMatch(manifest, /localhost:5500/);
  assert.match(popup, /開発環境（127\.0\.0\.1:5500）/);
  assert.match(config, /production: "https:\/\/tetsujisugimori-coder\.github\.io\/memo\/"/);
});

test("拡張は長文と予期しない失敗を技術的な文言なしで案内する", () => {
  assert.match(popup, /選択範囲が長すぎてクリップできません。範囲を短くして再度お試しください。/);
  assert.match(popup, /クリップを開始できませんでした。もう一度お試しください。/);
  assert.match(popup, /console\.error\("Memo-Nexus Web Clipper could not open Memo-Nexus", cause\)/);
});
