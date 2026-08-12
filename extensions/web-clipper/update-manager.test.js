const test = require("node:test");
const assert = require("node:assert/strict");
const { compareSemanticVersions, decideDevelopmentUpdate } = require("./update-manager.js");

test("開発版更新はSemVerで0.10.0を0.3.0より新しいと判定する", () => {
  assert.equal(compareSemanticVersions("0.1.0", "0.3.0"), -1);
  assert.equal(compareSemanticVersions("0.3.0", "0.3.0"), 0);
  assert.equal(compareSemanticVersions("0.3.1", "0.3.0"), 1);
  assert.equal(compareSemanticVersions("0.10.0", "0.3.0"), 1);
});

test("開発サーバー側だけが新しい場合に一度だけreloadを選ぶ", () => {
  assert.equal(decideDevelopmentUpdate({ environment: "development", currentVersion: "0.3.0", latestVersion: "0.3.1" }).action, "reload");
  assert.equal(decideDevelopmentUpdate({ environment: "development", currentVersion: "0.3.1", latestVersion: "0.3.1" }).action, "continue");
});

test("同じ対象版へreload済みで版が変わらない場合は手動確認へ止める", () => {
  const decision = decideDevelopmentUpdate({
    environment: "development", currentVersion: "0.3.0", latestVersion: "0.3.1",
    previousAttempt: { targetVersion: "0.3.1", attemptedAt: "2026-08-12T00:00:00.000Z" }
  });
  assert.equal(decision.action, "manual");
});

test("新しい対象版なら過去のreload記録後も再び一度試せる", () => {
  const decision = decideDevelopmentUpdate({
    environment: "development", currentVersion: "0.3.0", latestVersion: "0.3.2",
    previousAttempt: { targetVersion: "0.3.1", attemptedAt: "2026-08-12T00:00:00.000Z" }
  });
  assert.equal(decision.action, "reload");
});

test("クリップ転送中は開発版reloadを延期する", () => {
  const decision = decideDevelopmentUpdate({ environment: "development", currentVersion: "0.3.0", latestVersion: "0.3.1", hasPendingTransfer: true });
  assert.equal(decision.action, "defer");
});

test("productionでは独自更新を行わずブラウザ管理とする", () => {
  const decision = decideDevelopmentUpdate({ environment: "production", currentVersion: "0.1.0", latestVersion: "9.0.0" });
  assert.deepEqual(decision, { action: "browser-managed", reason: "production" });
});
