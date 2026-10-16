"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validate } = require("./memo-nexus-launcher-check.js");
test("launcher accepts only explicit authenticated config and existing browser origins without URL secrets", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "memo-launcher-config-"));
  const file = path.join(directory, "config.json");
  const config = { mode: "authenticated", port: 8792, resource: "https://resource.example.invalid/mcp",
    audience: "https://api.example.invalid/", resource_metadata: "http://127.0.0.1:8792/.well-known/oauth-protected-resource/mcp",
    authorization_servers: ["https://issuer.example.invalid/"], scopes_supported: ["memo:submit"], allowedSubjects: ["auth0|fixture"] };
  try {
    fs.writeFileSync(file, JSON.stringify(config));
    for (const url of ["http://127.0.0.1:5500/", "http://127.0.0.1:5500/index.html", "https://tetsujisugimori-coder.github.io/memo/"]) {
      assert.equal(validate(file, url).resource, config.resource);
    }
    for (const url of ["http://localhost:5500/", "http://127.0.0.1:5501/", "https://attacker.invalid/", "file:///C:/memo/index.html",
      "http://user:secret@127.0.0.1:5500/", "http://127.0.0.1:5500/?token=secret", "http://127.0.0.1:5500/#secret", "http://127.0.0.1:5500/unexpected"]) {
      assert.throws(() => validate(file, url));
    }
    for (const invalid of [{ ...config, mode: "discovery" }, { ...config, port: 8793 }, { ...config, allowedSubjects: [] }]) {
      fs.writeFileSync(file, JSON.stringify(invalid)); assert.throws(() => validate(file, "http://127.0.0.1:5500/"));
    }
    assert.throws(() => validate(path.join(__dirname, "mcp-http-oauth.config.example.json"), "http://127.0.0.1:5500/"));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
