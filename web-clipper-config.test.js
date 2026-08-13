const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const config = fs.readFileSync("web-clipper-config.js", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("style.css", "utf8");

test("Web Clipperは登録済みの拡張originだけを許可する", () => {
  const origins = [...config.matchAll(/"(chrome-extension:\/\/[^\"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(origins, [
    "chrome-extension://lecpajkpnjnagbeokicilagdonkcimbo",
    "chrome-extension://opejammnohhbjflpbhmmdlknhjkhfhdp",
    "chrome-extension://aelacnladkiohkhbjhfbmeknbfgpcmlh",
    "chrome-extension://aelacnladkiohkhbjhfbmekpbfgpcmlh"
  ]);
  assert.equal(new Set(origins).size, origins.length);
  assert.equal(origins.filter((origin) => origin === "chrome-extension://lecpajkpnjnagbeokicilagdonkcimbo").length, 1);
  assert.doesNotMatch(config, /opejamnnohhbjflpbhnmdlknhjkfhfdp/);
  assert.doesNotMatch(config, /mhfbofiokmppgdliakminbgdgcmbhbac/);
  assert.doesNotMatch(config, /YOUR_(?:DEVELOPMENT|PRODUCTION)_EXTENSION_ID/);
  assert.ok(origins.every((origin) => /^chrome-extension:\/\/[a-p]{32}$/.test(origin)));
  assert.ok(app.includes("^chrome-extension:\\/\\/[a-p]{32}$"));
});

test("設定画面は許可ID一覧・復旧案内・接続状態・受信版を表示する", () => {
  assert.match(app, /const origins = allowedWebClipperOrigins\(\);/);
  assert.match(app, /許可済み拡張機能ID/);
  assert.match(app, /data-web-clipper-copy/);
  assert.match(app, /Edgeで拡張機能が見つからない場合/);
  assert.match(app, /Edge の拡張機能一覧を開きます。/);
  assert.match(app, /Memo-Nexus Web Clipper を有効化するか、「展開して読み込み」で再登録します。/);
  assert.match(app, /表示された拡張機能IDが、この画面の許可IDと一致するか確認します。/);
  assert.match(app, /最後に受信した送信元Origin/);
  assert.match(app, /まだ受信していません/);
  assert.match(app, /recordWebClipperReceipt\(event\.origin, event\.data\.clip\)/);
  assert.match(app, /拡張バージョン/);
  assert.match(config, /minimumCompatibleVersion: "0\.3\.0"/);
  assert.match(app, /古いWeb Clipperが動作しています。拡張機能を更新してください。/);
  assert.doesNotMatch(app, /Memo-Nexus独自の受信ID/);
});

test("Web Clipper設定はテーマ変数と狭幅レイアウトを使う", () => {
  assert.match(index, /id="webClipperSettingsDetails"/);
  assert.match(index, /<h2>データ管理<\/h2>[\s\S]*id="webClipperSettingsDetails"/);
  assert.doesNotMatch(index, /Chrome.*Edge|Edge.*Chrome/);
  assert.match(styles, /\.web-clipper-origin-row[\s\S]*minmax\(0, 1fr\)/);
  assert.match(styles, /\.web-clipper-origin-row code,[\s\S]*color: var\(--ink\)/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.web-clipper-origin-row/);
});
