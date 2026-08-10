const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const app = fs.readFileSync("app.js", "utf8");
const popup = fs.readFileSync("extensions/web-clipper/popup.js", "utf8");
const config = fs.readFileSync("extensions/web-clipper/config.js", "utf8");

test("本体はフラグメントを消費して履歴からクリップpayloadを除去する", () => {
  assert.match(app, /function consumeWebClipFragment\(\)/);
  assert.match(app, /readWebClipFragment\(location\.hash\)/);
  assert.match(app, /history\.replaceState\(history\.state, "", `\$\{url\.pathname\}\$\{url\.search\}`\)/);
  assert.match(app, /クリップデータを読み取れませんでした。元のページからもう一度実行してください。/);
});

test("拡張は選択した接続先のURLへフラグメントpayloadで遷移する", () => {
  assert.match(popup, /MemoNexusClipPayload\.buildWebClipDestination\(destination, clip\)/);
  assert.doesNotMatch(popup, /receiver\.postMessage\(/);
  assert.match(config, /development: "http:\/\/localhost:5500\/"/);
  assert.match(config, /production: "https:\/\/tetsujisugimori-coder\.github\.io\/memo\/"/);
});
