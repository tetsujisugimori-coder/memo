"use strict";

const { createHash, timingSafeEqual } = require("node:crypto");

const MIN_BRIDGE_TOKEN_LENGTH = 32;
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
  "https://tetsujisugimori-coder.github.io"
]);

function parseAllowedOriginList(value, variableName = "CODEX_BRIDGE_ALLOWED_ORIGINS") {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${variableName}には空でないOrigin一覧を指定してください。`);
  }
  const entries = value.split(",");
  if (entries.some((entry) => !entry.trim())) {
    throw new Error(`${variableName}に空の要素を含めることはできません。`);
  }
  return entries.map((entry) => {
    const source = entry.trim();
    let parsed;
    try {
      parsed = new URL(source);
    } catch {
      throw new Error(`${variableName}に有効なhttp/https Originを指定してください。`);
    }
    if (!/^https?:$/.test(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
      || parsed.origin === "null") {
      throw new Error(`${variableName}にはパスや認証情報を含まないhttp/https Originだけを指定してください。`);
    }
    return parsed.origin;
  });
}

function loadAllowedOrigins(env = process.env) {
  const origins = new Set(DEFAULT_ALLOWED_ORIGINS);
  const configured = env.CODEX_BRIDGE_ALLOWED_ORIGINS;
  const legacy = env.CODEX_BRIDGE_ORIGINS;
  if (configured !== undefined) {
    for (const origin of parseAllowedOriginList(configured, "CODEX_BRIDGE_ALLOWED_ORIGINS")) origins.add(origin);
  }
  if (legacy !== undefined) {
    for (const origin of parseAllowedOriginList(legacy, "CODEX_BRIDGE_ORIGINS")) origins.add(origin);
  }
  return origins;
}

function isPlaceholderToken(token) {
  const normalized = token.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ["changeme", "replaceme", "yourtoken", "defaulttoken", "sampletoken", "exampletoken"]
    .some((placeholder) => normalized.includes(placeholder));
}

function validateConfiguredToken(value) {
  const token = typeof value === "string" ? value : "";
  if (token.length < MIN_BRIDGE_TOKEN_LENGTH || token.trim() !== token || /\s/.test(token) || isPlaceholderToken(token)) {
    throw new Error(`CODEX_BRIDGE_TOKENには空白を含まない${MIN_BRIDGE_TOKEN_LENGTH}文字以上のランダムな値を指定してください。`);
  }
  return token;
}

function parseBearerToken(headerValue) {
  if (typeof headerValue !== "string") return "";
  const match = /^Bearer ([^\s]+)$/i.exec(headerValue);
  return match ? match[1] : "";
}

function digestToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest();
}

function tokensMatch(candidate, expected) {
  if (!candidate || !expected) return false;
  return timingSafeEqual(digestToken(candidate), digestToken(expected));
}

function authorizeHeader(headerValue, expectedToken) {
  return tokensMatch(parseBearerToken(headerValue), expectedToken);
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  MIN_BRIDGE_TOKEN_LENGTH,
  authorizeHeader,
  loadAllowedOrigins,
  parseAllowedOriginList,
  parseBearerToken,
  tokensMatch,
  validateConfiguredToken
};
