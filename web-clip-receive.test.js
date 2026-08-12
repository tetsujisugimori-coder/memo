const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const app = fs.readFileSync("app.js", "utf8");
const popup = fs.readFileSync("extensions/web-clipper/popup.js", "utf8");
const popupHtml = fs.readFileSync("extensions/web-clipper/popup.html", "utf8");
const clipPayload = fs.readFileSync("extensions/web-clipper/clip-payload.js", "utf8");
const config = fs.readFileSync("extensions/web-clipper/config.js", "utf8");
const manifest = fs.readFileSync("extensions/web-clipper/manifest.json", "utf8");
const updateManager = fs.readFileSync("extensions/web-clipper/update-manager.js", "utf8");

test("本体はフラグメントを消費して履歴からクリップpayloadを除去する", () => {
  assert.match(app, /function consumeWebClipFragment\(\)/);
  assert.match(app, /readWebClipFragment\(location\.hash\)/);
  assert.match(app, /history\.replaceState\(history\.state, "", `\$\{url\.pathname\}\$\{url\.search\}`\)/);
  assert.match(app, /クリップデータを読み取れませんでした。元のページからもう一度実行してください。/);
});

test("本体は起動判定後にweb-clipだけを成功・失敗にかかわらず消費する", () => {
  assert.match(app, /const webClipLaunchRequested = new URLSearchParams\(location\.search\)\.has\("web-clip"\)/);
  assert.match(app, /if \(webClipLaunchRequested \|\| webClipFragment\.present\)/);
  assert.match(app, /finally \{[\s\S]*if \(webClipLaunchRequested\) consumeWebClipLaunchMarker\(\)/);
  assert.match(app, /history\.replaceState\(history\.state, "", webClipUrlWithoutLaunchMarker\(location\.href\)\)/);
});

test("拡張は選択した接続先のURLへフラグメントpayloadで遷移する", () => {
  assert.match(popup, /MemoNexusClipPayload\.buildWebClipDestination\(destination, payload\.clip/);
  assert.match(popup, /if \(payload\.transfer\)/);
  assert.match(config, /development: "http:\/\/127\.0\.0\.1:5500\/"/);
  assert.doesNotMatch(config, /localhost:5500/);
  assert.match(manifest, /"http:\/\/\*\/\*"/);
  assert.match(manifest, /"https:\/\/\*\/\*"/);
  assert.match(manifest, /"matches": \["http:\/\/localhost\/\*", "http:\/\/127\.0\.0\.1\/\*"/);
  assert.doesNotMatch(manifest, /localhost:5500/);
  assert.match(popup, /開発環境（127\.0\.0\.1:5500）/);
  assert.match(config, /production: "https:\/\/tetsujisugimori-coder\.github\.io\/memo\/"/);
  assert.match(config, /manifestUrl: "http:\/\/127\.0\.0\.1:5500\/extensions\/web-clipper\/manifest\.json"/);
  assert.match(popup, /cache: "no-store"/);
  assert.match(popup, /settings\?\.strategy !== "local-manifest"/);
  assert.doesNotMatch(popup, /requestUpdateCheck/);
  assert.match(updateManager, /environment !== "development"/);
});

test("拡張は長文と予期しない失敗を技術的な文言なしで案内する", () => {
  assert.match(popup, /選択範囲が長すぎてクリップできません。範囲を短くして再度お試しください。/);
  assert.match(popup, /クリップを開始できませんでした。もう一度お試しください。/);
  assert.match(popup, /ページ本文を取得できませんでした。選択部分またはリンクのみでお試しください。/);
  assert.match(popup, /page-injection-failed/);
  assert.match(popup, /page-content-empty/);
  assert.match(popup, /page-markdown-empty/);
  assert.match(popup, /console\.error\("Memo-Nexus Web Clipper could not open Memo-Nexus", cause\)/);
});

test("4方式とページ全文の小さいフラグメント受け渡しを維持する", () => {
  assert.match(popupHtml, /value="selection"/);
  assert.match(popupHtml, /value="page"/);
  assert.match(popupHtml, /value="link"/);
  assert.match(popupHtml, /value="memo"/);
  assert.match(popup, /clipMode\.value = hasSelection \? "selection" : "link"/);
  assert.match(clipPayload, /clip-transfer=\$\{encodeURIComponent\(options\.transferId\)\}/);
  assert.match(popup, /chrome\.storage\.local\.set/);
  assert.doesNotMatch(popup, /receiver\.postMessage\(/);
  assert.match(app, /clipMode: clip\.clipMode/);
  assert.match(app, /clip-transfer/);
  assert.match(manifest, /"storage"/);
  assert.match(manifest, /transfer-content\.js/);
});

test("拡張はmanifest由来の診断情報と保存済み接続先を全方式へ付与する", () => {
  assert.match(manifest, /"version": "0\.3\.2"/);
  assert.match(popup, /extensionVersion: manifest\.version/);
  assert.match(popup, /manifestVersion: manifest\.manifest_version/);
  assert.match(popup, /browserFamily: browserFamily\(\)/);
  assert.match(popup, /targetEnvironment: target\.value/);
  assert.match(popup, /distributionChannel: config\.distributionChannel/);
  assert.match(popup, /const base = \{ \.\.\.clip, \.\.\.extensionDiagnostics\(\), clipMode: mode/);
  assert.match(popup, /chrome\.storage\.local\.get\(key\)/);
  assert.match(popup, /chrome\.storage\.local\.set\(\{ \[config\.storage\.targetKey\]: target\.value \}\)/);
  assert.match(app, /pendingWebClipDiagnostics = \{/);
  assert.match(app, /\.\.\.pendingWebClipDiagnostics/);
});

test("接続先と配布方式を分離し、現在版をローカル展開として扱う", () => {
  assert.match(config, /distributionChannel: "unpacked-development"/);
  assert.match(config, /"unpacked-development": \{ label: "ローカル開発版", defaultTarget: "development" \}/);
  assert.match(config, /"edge-store": \{ label: "Edgeアドオン版", defaultTarget: "production" \}/);
  assert.match(popup, /config\.updates\[config\.distributionChannel\]\?\.\[target\.value\]/);
  assert.match(popup, /接続先: \$\{targetLabel\}／\$\{updateLabel\}/);
  assert.doesNotMatch(popup, /本番環境・Edge自動更新/);
});

test("転送レコードをTTLで清掃し、open失敗時は今回のキーだけ削除する", () => {
  assert.match(popupHtml, /transfer-lifecycle\.js/);
  assert.match(manifest, /"transfer-lifecycle\.js", "transfer-content\.js"/);
  assert.match(popup, /inspectTransferEntries\(stored\)/);
  assert.match(popup, /chrome\.storage\.local\.remove\(inspection\.invalidKeys\)/);
  assert.match(popup, /if \(transferKey\) await chrome\.storage\.local\.remove\(transferKey\)/);
});

test("開発版更新は転送中を避け、同一対象版の連続reloadを止める", () => {
  assert.match(popup, /hasPendingClipTransfer\(\)/);
  assert.match(popup, /chrome\.runtime\.reload\(\)/);
  assert.match(popup, /Edgeが別の拡張機能フォルダを読み込んでいる可能性があります/);
  assert.match(updateManager, /previousAttempt\?\.targetVersion === latestVersion/);
  assert.match(updateManager, /action: "manual", reason: "reload-did-not-update"/);
  assert.match(updateManager, /hasPendingTransfer/);
});
