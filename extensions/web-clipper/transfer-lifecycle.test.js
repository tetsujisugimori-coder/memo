const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TRANSFER_TTL_MS,
  inspectTransferEntries,
  isActiveTransferRecord,
  resolveTransferPayload,
  validateTransferClip,
  validateTransferRecord,
  transferStorageKey
} = require("./transfer-lifecycle.js");
const { decideDevelopmentUpdate } = require("./update-manager.js");

const now = Date.parse("2026-08-12T12:00:00.000Z");
const validClip = {
  title: "転送中", url: "https://example.com/article", host: "example.com",
  selection: "本文", capturedAt: "2026-08-12T11:59:00.000Z"
};

test("作成から10分以内の正常な転送だけを有効とする", () => {
  assert.equal(isActiveTransferRecord({ clip: validClip, createdAt: now - TRANSFER_TTL_MS + 1 }, now), true);
  assert.equal(isActiveTransferRecord({ clip: validClip, createdAt: now - TRANSFER_TTL_MS - 1 }, now), false);
});

test("期限切れ・createdAt欠落・不正clipを清掃対象へ分離する", () => {
  const activeKey = transferStorageKey("11111111-1111-1111-1111-111111111111");
  const expiredKey = transferStorageKey("22222222-2222-2222-2222-222222222222");
  const missingDateKey = transferStorageKey("33333333-3333-3333-3333-333333333333");
  const brokenKey = transferStorageKey("44444444-4444-4444-4444-444444444444");
  const result = inspectTransferEntries({
    [activeKey]: { clip: validClip, createdAt: now - 1000 },
    [expiredKey]: { clip: validClip, createdAt: now - TRANSFER_TTL_MS - 1 },
    [missingDateKey]: { clip: validClip },
    [brokenKey]: { clip: null, createdAt: now },
    unrelated: { createdAt: 0 }
  }, now);
  assert.deepEqual(result.activeKeys, [activeKey]);
  assert.deepEqual(result.invalidKeys, [expiredKey, missingDateKey, brokenKey]);
  assert.equal(result.hasActiveTransfer, true);
});

test("無効値だけなら更新を妨げず、無関係キーは清掃しない", () => {
  const expiredKey = transferStorageKey("55555555-5555-5555-5555-555555555555");
  assert.deepEqual(inspectTransferEntries({
    [expiredKey]: { clip: validClip, createdAt: now - TRANSFER_TTL_MS - 1 },
    memoNexusClipperTargetEnvironment: "development"
  }, now), { activeKeys: [], invalidKeys: [expiredKey], hasActiveTransfer: false });
});

test("清掃後に有効な転送がなければ新版reload判定へ進める", () => {
  const expiredKey = transferStorageKey("66666666-6666-6666-6666-666666666666");
  const inspection = inspectTransferEntries({
    [expiredKey]: { clip: validClip, createdAt: now - TRANSFER_TTL_MS - 1 }
  }, now);
  assert.equal(decideDevelopmentUpdate({
    environment: "development", distributionChannel: "unpacked-development",
    currentVersion: "0.3.1", latestVersion: "0.3.2",
    hasPendingTransfer: inspection.hasActiveTransfer
  }).action, "reload");
});

test("転送レコードの検証失敗項目を安全なエラーコードで返す", () => {
  assert.deepEqual(validateTransferRecord(undefined, now), { ok: false, code: "record_missing" });
  assert.equal(validateTransferRecord({ clip: validClip }, now).code, "created_at_missing");
  assert.equal(validateTransferRecord({ clip: { ...validClip, title: "" }, createdAt: now }, now).code, "title_invalid");
  assert.equal(validateTransferRecord({ clip: { ...validClip, url: "file:///secret" }, createdAt: now }, now).code, "url_invalid");
  assert.equal(validateTransferRecord({ clip: { ...validClip, host: "" }, createdAt: now }, now).code, "host_invalid");
  assert.equal(validateTransferRecord({ clip: { ...validClip, selection: null }, createdAt: now }, now).code, "selection_invalid");
  assert.equal(validateTransferRecord({ clip: { ...validClip, capturedAt: "invalid" }, createdAt: now }, now).code, "captured_at_invalid");
  assert.equal(validateTransferRecord({ clip: validClip, createdAt: now - TRANSFER_TTL_MS - 1 }, now).code, "transfer_expired");
  assert.deepEqual(validateTransferRecord({ clip: validClip, createdAt: now }, now), { ok: true, code: "ok" });
});

test("旧payloadのclipも新形式と同じ基準で検証し、createdAtを要求しない", () => {
  assert.deepEqual(validateTransferClip(validClip), { ok: true, code: "ok" });
  assert.equal(validateTransferClip({ ...validClip, title: "" }).code, "title_invalid");
  assert.equal(validateTransferClip({ ...validClip, url: "file:///secret" }).code, "url_invalid");
  assert.equal(validateTransferClip({ ...validClip, url: "https://" }).code, "url_invalid");
  assert.equal(validateTransferClip({ ...validClip, host: "" }).code, "host_invalid");
  assert.equal(validateTransferClip({ ...validClip, selection: null }).code, "selection_invalid");
  assert.equal(validateTransferClip({ ...validClip, capturedAt: "invalid" }).code, "captured_at_invalid");
});

test("新旧payloadを区別し、未知形式は拡張更新が必要なエラーにする", () => {
  assert.deepEqual(resolveTransferPayload({ record: { clip: validClip, createdAt: now }, clip: { ...validClip, title: "互換フィールド" } }, now), {
    ok: true, code: "ok", protocol: "current", clip: validClip
  });
  assert.deepEqual(resolveTransferPayload({ clip: validClip }, now), {
    ok: true, code: "ok", protocol: "legacy", clip: validClip
  });
  assert.deepEqual(resolveTransferPayload({}, now), {
    ok: false, code: "extension_update_required", protocol: "unknown", clip: null
  });
  assert.deepEqual(resolveTransferPayload({ clip: { ...validClip, url: "javascript:alert(1)" } }, now), {
    ok: false, code: "url_invalid", protocol: "legacy", clip: null
  });
});
