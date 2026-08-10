const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const config = fs.readFileSync("web-clipper-config.js", "utf8");
const app = fs.readFileSync("app.js", "utf8");

test("Web Clipperは登録済みのEdgeとChrome拡張originだけを許可する", () => {
  assert.match(config, /chrome-extension:\/\/opejammnohhbjflpbhmmdlknhjkhfhdp/);
  assert.match(config, /chrome-extension:\/\/mhfbofiokmppgdliakminbgdgcmbhbac/);
  assert.doesNotMatch(config, /YOUR_(?:DEVELOPMENT|PRODUCTION)_EXTENSION_ID/);
  assert.ok(app.includes("^chrome-extension:\\/\\/[a-p]{32}$"));
});
