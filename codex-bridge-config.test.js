"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_ALLOWED_ORIGINS,
  MIN_BRIDGE_TOKEN_LENGTH,
  authorizeHeader,
  loadAllowedOrigins,
  parseAllowedOriginList,
  parseBearerToken,
  tokensMatch,
  validateConfiguredToken
} = require("./codex-bridge-config.js");
const { generateBridgeToken } = require("./codex-bridge-token.js");

const PUBLIC_ORIGIN = "https://tetsujisugimori-coder.github.io";
const VALID_TOKEN = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";

test("既定Originはローカル開発と公開版だけを完全一致で許可する", () => {
  const origins = loadAllowedOrigins({});
  assert.deepEqual(Array.from(origins), DEFAULT_ALLOWED_ORIGINS);
  assert.equal(origins.has("http://127.0.0.1:8765"), true);
  assert.equal(origins.has("http://localhost:8765"), true);
  assert.equal(origins.has(PUBLIC_ORIGIN), true);
  assert.equal(origins.has(`${PUBLIC_ORIGIN}/memo/`), false);
  assert.equal(origins.has("https://evil-tetsujisugimori-coder.github.io"), false);
  assert.equal(origins.has("https://tetsujisugimori-coder.github.io.evil.example"), false);
  assert.equal(origins.has("null"), false);
});

test("追加Originは正規化し空要素・不正URL・パスを拒否する", () => {
  const origins = loadAllowedOrigins({ CODEX_BRIDGE_ALLOWED_ORIGINS: "https://example.com/,http://127.0.0.1:9000" });
  assert.equal(origins.has("https://example.com"), true);
  assert.equal(origins.has("http://127.0.0.1:9000"), true);
  assert.throws(() => parseAllowedOriginList("https://example.com,,http://localhost:8765"), /空の要素/);
  assert.throws(() => parseAllowedOriginList("https://example.com/memo/"), /パス/);
  assert.throws(() => parseAllowedOriginList("ftp://example.com"), /http\/https/);
  assert.throws(() => parseAllowedOriginList("null"), /有効なhttp\/https/);
});

test("接続トークンは十分な長さと形式を要求しBearerを安全に比較する", () => {
  assert.equal(MIN_BRIDGE_TOKEN_LENGTH, 32);
  assert.throws(() => validateConfiguredToken(), /CODEX_BRIDGE_TOKEN/);
  assert.throws(() => validateConfiguredToken("short"), /32文字以上/);
  assert.throws(() => validateConfiguredToken("change-me-change-me-change-me-change-me"), /ランダム/);
  assert.equal(validateConfiguredToken(VALID_TOKEN), VALID_TOKEN);
  assert.equal(parseBearerToken(`Bearer ${VALID_TOKEN}`), VALID_TOKEN);
  assert.equal(parseBearerToken(`Basic ${VALID_TOKEN}`), "");
  assert.equal(parseBearerToken(`Bearer ${VALID_TOKEN} extra`), "");
  assert.equal(tokensMatch(VALID_TOKEN, VALID_TOKEN), true);
  assert.equal(tokensMatch("different-length-token", VALID_TOKEN), false);
  assert.equal(authorizeHeader(`Bearer ${VALID_TOKEN}`, VALID_TOKEN), true);
  assert.equal(authorizeHeader(undefined, VALID_TOKEN), false);
});

test("補助コマンド用tokenはGitへ保存せず安全な長さで生成する", () => {
  const first = generateBridgeToken();
  const second = generateBridgeToken();
  assert.ok(first.length >= MIN_BRIDGE_TOKEN_LENGTH);
  assert.match(first, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second);
  assert.equal(validateConfiguredToken(first), first);
});
