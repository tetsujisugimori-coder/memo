"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
const layoutE2e = fs.readFileSync(path.join(root, "mobile-layout.e2e.js"), "utf8");
const writingE2e = fs.readFileSync(path.join(root, "mobile-writing-mode.e2e.js"), "utf8");

test("Playwrightをlockfile付きdevDependencyとして固定する", () => {
  assert.equal(packageJson.devDependencies.playwright, "1.62.1");
  assert.equal(packageLock.packages[""].devDependencies.playwright, "1.62.1");
  assert.ok(packageLock.packages["node_modules/playwright"]);
});

test("npmスクリプトは2本のモバイルE2Eを個別・一括実行できる", () => {
  assert.equal(packageJson.scripts["test:e2e:mobile:layout"], "node mobile-layout.e2e.js");
  assert.equal(packageJson.scripts["test:e2e:mobile:writing"], "node mobile-writing-mode.e2e.js");
  assert.match(packageJson.scripts["test:e2e:mobile"], /test:e2e:mobile:layout.*test:e2e:mobile:writing/);
});

test("CIはnpm ci後にChromiumとWebKitで両モバイルE2Eを実行する", () => {
  assert.match(workflow, /name:\s*Mobile E2E \(\$\{\{ matrix\.browser \}\}\)/);
  assert.match(workflow, /browser:\s*[\s\S]*?- chromium[\s\S]*?- webkit/);
  assert.match(workflow, /run:\s*npm ci/);
  assert.match(workflow, /npx playwright install --with-deps \$\{\{ matrix\.browser \}\}/);
  assert.match(workflow, /MEMO_NEXUS_E2E_BROWSER:\s*\$\{\{ matrix\.browser \}\}/);
  assert.match(workflow, /run:\s*npm run test:e2e:mobile/);
});

test("2本のE2Eは同じブラウザ環境変数を使い通常管理ブラウザを優先する", () => {
  for (const source of [layoutE2e, writingE2e]) {
    assert.match(source, /process\.env\.MEMO_NEXUS_E2E_BROWSER \|\| "chromium"/);
    assert.match(source, /return await browserType\.launch\(\{ headless: true \}\)/);
    assert.match(source, /if \(browserName !== "chromium"\) throw error/);
  }
});

test("通常モバイル表示は320x667の短いiPhone相当も検証する", () => {
  assert.match(layoutE2e, /assertMobileLayout\(mobilePage, 320,[\s\S]*?height:\s*667/);
});
