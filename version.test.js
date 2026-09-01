"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const readme = fs.readFileSync("README.md", "utf8");
const backup = fs.readFileSync("backup-bundle-utils.js", "utf8");
const tableBlocks = fs.readFileSync("table-block-utils.js", "utf8");
const codexRuntime = fs.readFileSync("codex-bridge-runtime.js", "utf8");
const extensionManifest = JSON.parse(fs.readFileSync("extensions/web-clipper/manifest.json", "utf8"));
const packageMetadata = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("現在のアプリ版とリリース名を0.5.0 Bridge Updateへ統一する", () => {
  assert.match(app, /const APP_VERSION = "0\.5\.0";/);
  assert.match(app, /const APP_LABEL = "Bridge Update";/);
  assert.match(app, /const APP_BUILD = "2026-08-19";/);
  assert.match(app, /Memo Nexus v\$\{APP_VERSION\} "\$\{APP_LABEL\}" \(\$\{APP_BUILD\}\)/);
  assert.match(app, /element\.textContent = `v\$\{APP_VERSION\} "\$\{APP_LABEL\}"`/);
  assert.match(app, /buildManifest\(\{ appVersion: APP_VERSION/);
  assert.equal((readme.match(/v0\.5\.0 "Bridge Update"/g) || []).length, 2);
});

test("全ローカルCSS・JavaScriptを0.5.0のキャッシュ識別子で読み込む", () => {
  const assetVersions = [...html.matchAll(/(?:href|src)="(?!https?:)([^"?]+)\?v=([^"]+)"/g)]
    .map((match) => ({ path: match[1], version: match[2] }));
  assert.equal(assetVersions.length, 46);
  assetVersions.forEach(({ path, version }) => {
    assert.match(version, /^0\.5\.0-\d+$/, `${path}のキャッシュ識別子`);
  });
  assert.match(html, /note-tombstone\.js\?v=0\.5\.0-2/);
  assert.match(html, /note-save-foundation\.js\?v=0\.5\.0-8/);
  assert.match(html, /typing-derived-ui-scheduler\.js\?v=0\.5\.0-4/);
  assert.match(html, /draft-mirror-scheduler\.js\?v=0\.5\.0-2/);
  assert.match(html, /term-link-utils\.js\?v=0\.5\.0-6/);
  assert.match(html, /memo-link-utils\.js\?v=0\.5\.0-3/);
  assert.match(html, /style\.css\?v=0\.5\.0-71/);
  assert.match(html, /logo-animation-utils\.js\?v=0\.5\.0-8/);
  assert.match(html, /editor-caret-animation-utils\.js\?v=0\.5\.0-2/);
  assert.match(html, /layout-resize-utils\.js\?v=0\.5\.0-2/);
  assert.match(html, /app\.js\?v=0\.5\.0-132/);
});

test("本体リリースと別管理の互換性バージョンを変更しない", () => {
  assert.match(app, /const DB_VERSION = 6;/);
  assert.match(backup, /const BACKUP_VERSION = 2;/);
  assert.match(tableBlocks, /const TABLE_BLOCK_VERSION = 1;/);
  assert.match(codexRuntime, /clientInfo: \{ name: "memo-nexus-codex-chat", version: "0\.1\.1" \}/);
  assert.equal(extensionManifest.manifest_version, 3);
  assert.equal(extensionManifest.version, "0.3.5");
  assert.equal(Object.hasOwn(packageMetadata, "version"), false);
});
