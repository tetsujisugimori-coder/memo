const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const config = fs.readFileSync("web-clipper-config.js", "utf8");
const app = fs.readFileSync("app.js", "utf8");

test("Web Clipperは登録済みのEdgeと正しいChrome拡張originだけを許可する", () => {
  const origins = [...config.matchAll(/"(chrome-extension:\/\/[^\"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(origins, [
    "chrome-extension://opejammnohhbjflpbhmmdlknhjkhfhdp",
    "chrome-extension://aelacnladkiohkhbjhfbmeknbfgpcmlh"
  ]);
  assert.doesNotMatch(config, /mhfbofiokmppgdliakminbgdgcmbhbac/);
  assert.doesNotMatch(config, /YOUR_(?:DEVELOPMENT|PRODUCTION)_EXTENSION_ID/);
  assert.ok(origins.every((origin) => /^chrome-extension:\/\/[a-p]{32}$/.test(origin)));
  assert.ok(app.includes("^chrome-extension:\\/\\/[a-p]{32}$"));
});
