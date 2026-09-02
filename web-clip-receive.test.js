const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const app = fs.readFileSync("app.js", "utf8");
const popup = fs.readFileSync("extensions/web-clipper/popup.js", "utf8");
const popupHtml = fs.readFileSync("extensions/web-clipper/popup.html", "utf8");
const clipPayload = fs.readFileSync("extensions/web-clipper/clip-payload.js", "utf8");
const config = fs.readFileSync("extensions/web-clipper/config.js", "utf8");
const manifest = fs.readFileSync("extensions/web-clipper/manifest.json", "utf8");
const readme = fs.readFileSync("extensions/web-clipper/README.md", "utf8");
const updateManager = fs.readFileSync("extensions/web-clipper/update-manager.js", "utf8");
const transferLifecycle = fs.readFileSync("extensions/web-clipper/transfer-lifecycle.js", "utf8");
const transferBridge = fs.readFileSync("extensions/web-clipper/transfer-bridge.js", "utf8");
const transferContent = fs.readFileSync("extensions/web-clipper/transfer-content.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");

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
  assert.match(popup, /const destination = config\.targets\[target\.value\];/);
  assert.match(config, /manifestUrl: "http:\/\/127\.0\.0\.1:5500\/extensions\/web-clipper\/manifest\.json"/);
  assert.match(popup, /cache: "no-store"/);
  assert.match(popup, /settings\?\.strategy !== "local-manifest"/);
  assert.doesNotMatch(popup, /requestUpdateCheck/);
  assert.match(updateManager, /environment !== "development"/);
});

test("拡張は選択なしをリンクのみに切り替えず、分類済みの取得結果を案内する", () => {
  assert.match(popupHtml, /clip-result\.js/);
  assert.match(popup, /clipResult\.issueError/);
  assert.match(popup, /clipResult\.buildClipResult/);
  assert.match(popup, /partialSaveAvailable: false/);
  assert.match(popup, /code: "access_denied"/);
  assert.match(popup, /code: "html_parse_failed"/);
  assert.match(popup, /code: content\?\.metadata\?\.description \|\| content\?\.metadata\?\.articleBody \? "metadata_only" : "article_not_found"/);
  assert.match(popup, /選択部分をクリップするには、ページ上で文章を選択してください。/);
  assert.match(popup, /clipMode\.value = "selection"/);
  assert.doesNotMatch(popup, /clipMode\.value = hasSelection \? "selection" : "link"/);
  assert.match(popup, /sourceSelection: base\.selection/);
  assert.match(popup, /console\.info\("Memo-Nexus Web Clipper could not open Memo-Nexus"/);
});

test("4方式はポップアップで取得してから確認画面へ渡す", () => {
  assert.match(popupHtml, /value="selection"/);
  assert.match(popupHtml, /value="page"/);
  assert.match(popupHtml, /value="link"/);
  assert.match(popupHtml, /value="memo"/);
  assert.match(popupHtml, /クリップ方式/);
  assert.match(popup, /ページ本文を取得しています…/);
  assert.match(popup, /MemoNexusPageExtractor\.extractPageContent\(\)/);
  assert.match(popup, /fetchImagesInServiceWorker\(content\.images\)/);
  assert.match(popup, /modeStatus\.textContent = finalized\.result\.notice/);
  assert.ok(popup.indexOf("fetchImagesInServiceWorker(content.images)") < popup.indexOf("window.open(MemoNexusClipPayload.buildWebClipDestination"));
  assert.match(popup, /mode === "link" \|\| mode === "memo"/);
  assert.match(popup, /selection: finalized\.content, metadata: finalized\.metadata, clipResult: finalized\.result, images: \[\]/);
  assert.match(clipPayload, /clip-transfer=\$\{encodeURIComponent\(options\.transferId\)\}/);
  assert.match(popup, /chrome\.storage\.local\.set/);
  assert.doesNotMatch(popup, /receiver\.postMessage\(/);
  assert.match(app, /clipMode: clip\.clipMode/);
  assert.match(app, /clip-transfer/);
  assert.match(manifest, /"storage"/);
  assert.match(manifest, /transfer-content\.js/);
});

test("拡張はmanifest由来の診断情報と保存済み接続先を全方式へ付与する", () => {
  assert.match(manifest, /"version": "0\.3\.8"/);
  assert.match(popupHtml, /拡張機能バージョン:/);
  assert.match(popup, /const currentExtensionManifest = chrome\.runtime\.getManifest\(\);/);
  assert.match(popup, /extensionVersion\.textContent = currentExtensionManifest\.version/);
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

test("ポップアップの方式一覧とREADMEの展開読み込み更新手順は現在版と一致する", () => {
  const manifestVersion = manifest.match(/"version": "([^"]+)"/)?.[1];
  assert.ok(manifestVersion);
  assert.match(popupHtml, /選択部分/);
  assert.match(popupHtml, /ページ全文（本文・画像を取得してから確認画面を開く）/);
  assert.match(popupHtml, /リンクのみ/);
  assert.match(popupHtml, /メモ付き/);
  assert.ok(readme.includes(`現在の展開読み込み版はローカル開発版\`${manifestVersion}\``));
  assert.match(readme, /GitHubでPRをマージしても、PC内へ展開読み込みした拡張機能は自動では更新されません。/);
  assert.match(readme, /edge:\/\/extensions/);
  assert.ok(readme.includes(`\`${manifestVersion}\`より古ければ、そのカードの「再読み込み」を押します。`));
  assert.match(readme, /現在のMemo-Nexusリポジトリの`extensions\/web-clipper`フォルダを「展開して読み込み」で登録し直します。/);
  assert.match(readme, /設定 → データ管理 → Web Clipper/);
});

test("拡張から受信したクリップ方式は確認画面で変更せず、再取得は拡張へ戻るよう案内する", () => {
  const index = fs.readFileSync("index.html", "utf8");
  assert.match(app, /webClipMode\.disabled = Boolean\(clip\)/);
  assert.match(app, /webClipModeLockedNote\.hidden = !clip/);
  assert.match(index, /クリップ方式は拡張機能で確定済みです。本文や画像を別の方式で取得するには、拡張機能へ戻ってください。/);
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
  assert.match(manifest, /"transfer-lifecycle\.js", "transfer-bridge\.js", "transfer-content\.js"/);
  assert.match(popup, /inspectTransferEntries\(stored\)/);
  assert.match(popup, /chrome\.storage\.local\.remove\(inspection\.invalidKeys\)/);
  assert.match(popup, /if \(transferKey\) await chrome\.storage\.local\.remove\(transferKey\)/);
});

test("ページ全文転送は明示的な受信準備、ID一致ACK、再試行、session再開を使う", () => {
  assert.match(transferLifecycle, /TRANSFER_SESSION_STORAGE_KEY/);
  assert.match(transferLifecycle, /validateTransferRecord/);
  assert.match(transferBridge, /CONTENT_READY/);
  assert.match(transferBridge, /RECEIVER_READY/);
  assert.match(transferBridge, /ACK_CONFIRMED/);
  assert.match(transferBridge, /message\.transferId !== transferId/);
  assert.match(transferBridge, /await remove\(key\)/);
  assert.match(transferContent, /sessionStorage\.getItem/);
  assert.match(app, /postWebClipReceiverReady/);
  assert.match(app, /completedWebClipTransferIds/);
  assert.match(app, /resolveTransferPayload\(message\)/);
  assert.match(app, /scheduleWebClipTransferAckTimeout\(\)/);
});

test("新旧転送payloadを区別し、旧方式は更新推奨のまま保存可能にする", () => {
  assert.match(transferLifecycle, /function validateTransferClip/);
  assert.match(transferLifecycle, /function resolveTransferPayload/);
  assert.match(transferLifecycle, /extension_update_required/);
  assert.match(transferBridge, /clip: record\.clip/);
  assert.match(transferBridge, /message\.type === TYPES\.CONTENT_READY/);
  assert.match(app, /resolveTransferPayload\(message\)/);
  assert.match(app, /transferProtocol: "legacy"/);
  assert.match(app, /旧転送方式/);
});

test("転送失敗画面は再受信、診断コピー、リンクのみの代替案内と保存ロックを備える", () => {
  assert.match(index, /id="retryWebClipTransferBtn"[^>]*>もう一度受信する/);
  assert.match(index, /id="copyWebClipTransferDiagnosticsBtn"[^>]*>診断情報をコピー/);
  assert.match(app, /元のページから再実行するか、拡張機能で「リンクのみ」を選んで保存してください/);
  assert.match(app, /webClipTransferBlocksSave\(\)/);
  assert.match(app, /content_script_missing/);
  assert.match(app, /record_missing/);
  assert.match(app, /transfer_expired/);
  assert.match(app, /ack_timeout/);
});

test("開発版更新は転送中を避け、同一対象版の連続reloadを止める", () => {
  assert.match(popup, /hasPendingClipTransfer\(\)/);
  assert.match(popup, /chrome\.runtime\.reload\(\)/);
  assert.match(popup, /Edgeが別の拡張機能フォルダを読み込んでいる可能性があります/);
  assert.match(updateManager, /previousAttempt\?\.targetVersion === latestVersion/);
  assert.match(updateManager, /action: "manual", reason: "reload-did-not-update"/);
  assert.match(updateManager, /hasPendingTransfer/);
});
