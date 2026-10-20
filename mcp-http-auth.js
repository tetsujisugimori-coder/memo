"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { validateToken } = require("./dummy-preview-service.js");
const CLOCK_TOLERANCE_SECONDS = 5;
const JWKS_COOLDOWN_MS = 30000;
const JWKS_CACHE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
function failure(code, status = 401) { return Object.assign(new Error(code), { code, status }); }
function explicitUrl(value, { issuer = false, localPort, metadata = false } = {}) {
  if (typeof value !== "string" || !/^[\x21-\x7e]+$/.test(value) || /["\\<>]/.test(value)) throw failure("invalid_configuration");
  let url; try { url = new URL(value); } catch { throw failure("invalid_configuration"); }
  if (url.href !== value || url.username || url.password || url.search || url.hash
    || !(url.protocol === "https:" || (localPort && url.protocol === "http:" && url.host === `127.0.0.1:${localPort}` && (metadata || url.pathname === "/mcp")))
    || (issuer && (url.protocol !== "https:" || url.pathname !== "/"))) throw failure("invalid_configuration");
  return url;
}
function validateConfig(input) {
  const keys = ["mode", "port", "resource", "audience", "resource_metadata", "authorization_servers", "scopes_supported", "allowedSubjects"];
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== keys.length
    || keys.some(key => !Object.hasOwn(input, key)) || input.mode !== "authenticated"
    || !Number.isInteger(input.port) || input.port < 1024 || input.port > 65535 || [5500, 8787, 8791].includes(input.port)
    || !Array.isArray(input.authorization_servers) || input.authorization_servers.length !== 1
    || !Array.isArray(input.scopes_supported) || ![1, 2].includes(input.scopes_supported.length) || input.scopes_supported[0] !== "memo:submit"
    || (input.scopes_supported.length === 2 && input.scopes_supported[1] !== "memo:search")
    || !Array.isArray(input.allowedSubjects) || input.allowedSubjects.length < 1 || input.allowedSubjects.length > 16
    || input.allowedSubjects.some(sub => typeof sub !== "string" || !/^[\x21-\x7e]{1,256}$/.test(sub) || sub.endsWith("@clients"))
    || new Set(input.allowedSubjects).size !== input.allowedSubjects.length) throw failure("invalid_configuration");
  explicitUrl(input.authorization_servers[0], { issuer: true });
  explicitUrl(input.resource, { localPort: input.port });
  explicitUrl(input.audience, { localPort: input.port });
  const metadata = explicitUrl(input.resource_metadata, { localPort: input.port, metadata: true });
  // A local metadata URL is permitted separately from the public OAuth resource.
  if (!["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(metadata.pathname)) throw failure("invalid_configuration");
  return Object.freeze({ ...input, authorization_servers: Object.freeze([...input.authorization_servers]),
    scopes_supported: Object.freeze([...input.scopes_supported]), allowedSubjects: Object.freeze([...input.allowedSubjects]) });
}
function loadConfig(file) {
  try {
    // Operational values must live outside any checkout (including worktrees).
    if (!path.isAbsolute(file)) throw failure("invalid_configuration");
    let directory = path.dirname(fs.realpathSync(file));
    while (true) {
      if (fs.existsSync(path.join(directory, ".git"))) throw failure("invalid_configuration");
      const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
    }
    return validateConfig(JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")));
  }
  catch { throw failure("invalid_configuration"); }
}
async function boundedJson(response, maxBytes = 256 * 1024) {
  if (response.status !== 200) throw failure("metadata_unavailable");
  const chunks = []; let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw failure("metadata_too_large");
      chunks.push(chunk);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw failure("metadata_unavailable"); }
}
async function createTokenVerifier(input, { fetchImpl = fetch, now = Date.now } = {}) {
  const config = validateConfig(input);
  const issuer = config.authorization_servers[0];
  const { createRemoteJWKSet, jwtVerify, customFetch } = await import("jose");
  let metadata;
  try { metadata = await boundedJson(await fetchImpl(issuer + ".well-known/openid-configuration", {
    redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: "application/json" }
  })); } catch { throw failure("issuer_metadata_unavailable"); }
  const jwksUrl = explicitUrl(metadata.jwks_uri);
  if (metadata.issuer !== issuer || jwksUrl.origin !== new URL(issuer).origin) throw failure("issuer_metadata_mismatch");
  let nextFetch = 0;
  const keys = createRemoteJWKSet(jwksUrl, { timeoutDuration: FETCH_TIMEOUT_MS, cooldownDuration: JWKS_COOLDOWN_MS,
    cacheMaxAge: JWKS_CACHE_MS, [customFetch]: async (url, options) => {
      // Also throttle failed fetches; jose's cooldown covers successful refreshes.
      if (now() < nextFetch) throw failure("jwks_cooldown");
      nextFetch = now() + JWKS_COOLDOWN_MS;
      const json = await boundedJson(await fetchImpl(url, { ...options, redirect: "error" }));
      return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
    } });
  return async (header, requiredScope = "memo:submit") => {
    if (typeof header !== "string" || header.length > 7000 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)) throw failure("invalid_token");
    let payload, protectedHeader;
    try {
      ({ payload, protectedHeader } = await jwtVerify(header.slice(7), keys, { algorithms: ["RS256"], issuer, audience: config.audience,
        requiredClaims: ["iss", "aud", "exp", "iat", "sub", "scope"], clockTolerance: CLOCK_TOLERANCE_SECONDS, currentDate: new Date(now()) }));
      if (typeof protectedHeader.kid !== "string" || !protectedHeader.kid || protectedHeader.kid.length > 256
        || typeof payload.sub !== "string" || !/^[\x21-\x7e]{1,256}$/.test(payload.sub)
        || !(typeof payload.aud === "string" || (Array.isArray(payload.aud) && payload.aud.length > 0 && payload.aud.every(aud => typeof aud === "string")))
        || !Number.isFinite(payload.exp) || !Number.isFinite(payload.iat) || payload.iat > now() / 1000 + CLOCK_TOLERANCE_SECONDS
        || payload.exp <= payload.iat || typeof payload.scope !== "string"
        || !/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(payload.scope)
        || Object.hasOwn(payload, "nonce")) throw failure("invalid_token");
    } catch { throw failure("invalid_token"); }
    if (payload.gty === "client-credentials" || payload.sub.endsWith("@clients") || !config.allowedSubjects.includes(payload.sub)) throw failure("subject_forbidden", 403);
    const scopes = payload.scope.split(" ").filter(scope => config.scopes_supported.includes(scope));
    if (requiredScope === null ? !scopes.length : !scopes.includes(requiredScope)) throw failure("insufficient_scope", 403);
    return Object.freeze({ issuer, sub: payload.sub, ...(requiredScope === null ? { scopes: Object.freeze(scopes) } : {}) });
  };
}
function receiverRequestId(principal, requestId) {
  // Stable across restart/config reload; keep the queue's existing UUID v4 contract.
  const bytes = createHash("sha256").update(JSON.stringify(["memo-http-oauth-v1", principal.issuer, principal.sub, requestId])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function requireAdapterToken(token) { try { return validateToken(token); } catch { throw failure("adapter_configuration_required"); } }
module.exports = { validateConfig, loadConfig, createTokenVerifier, receiverRequestId, requireAdapterToken,
  CLOCK_TOLERANCE_SECONDS, JWKS_COOLDOWN_MS, JWKS_CACHE_MS, FETCH_TIMEOUT_MS };
