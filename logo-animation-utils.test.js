const assert = require("node:assert/strict");
const test = require("node:test");
const { localDateKey, nextLogoAnimation, normalizeLogoAnimation, resolveLogoAnimation, stableDayIndex } = require("./logo-animation-utils.js");

test("ロゴアニメーション設定は日替わりへ安全に正規化する", () => {
  assert.equal(normalizeLogoAnimation("daily"), "daily");
  assert.equal(normalizeLogoAnimation("typewriter"), "typewriter");
  assert.equal(normalizeLogoAnimation("nexus"), "nexus");
  assert.equal(normalizeLogoAnimation("scan"), "scan");
  assert.equal(normalizeLogoAnimation("off"), "off");
  assert.equal(normalizeLogoAnimation("unknown"), "daily");
  assert.equal(normalizeLogoAnimation(null), "daily");
});

test("ロゴの操作順は固定で循環する", () => {
  assert.equal(nextLogoAnimation("typewriter"), "nexus");
  assert.equal(nextLogoAnimation("nexus"), "scan");
  assert.equal(nextLogoAnimation("scan"), "typewriter");
});

test("日替わりロゴはローカル日付から決定論的に選ばれる", () => {
  const date = new Date(2026, 7, 9, 12, 0, 0);
  assert.equal(localDateKey(date), "2026-08-09");
  assert.equal(resolveLogoAnimation("daily", date), resolveLogoAnimation("daily", new Date(2026, 7, 9, 23, 59, 0)));
  assert.ok(["typewriter", "nexus", "scan"].includes(resolveLogoAnimation("daily", date)));
  assert.equal(stableDayIndex(date), stableDayIndex(new Date(2026, 7, 9, 0, 1, 0)));
  assert.equal(resolveLogoAnimation("off", date), "off");
  assert.equal(resolveLogoAnimation("scan", date), "scan");
});
