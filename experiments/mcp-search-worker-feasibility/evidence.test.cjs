"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const read = name => fs.readFileSync(path.join(__dirname, name), "utf8").replace(/\r\n/g, "\n");
const json = name => JSON.parse(read(name));
const immutable = {
  "results-chromium.json": "2acac827acc17036b7aca97ffed04809d49b77ae8b6564ac1f9dd7b81da8ad97",
  "results-webkit.json": "7bd56e671f387b695833eaee56875ee5ddff40a5e98b66727ae419367296bf5b",
  "evidence/d2c4ad1-ci/results-chromium.json": "732f159bf0a3579eafeaf31c00f99532f542e8a22cb6cb146012cebd369d55f2",
  "evidence/d2c4ad1-ci/results-webkit.json": "cd24f871d5cdeda94a5084a88f84fa0b70badef7500f2a87068c076222da81e1"
};
for (const [file, expected] of Object.entries(immutable)) test("historical evidence remains unchanged: " + file, () => {
  assert.equal(crypto.createHash("sha256").update(read(file)).digest("hex"), expected);
});
test("d2c4ad1 CI states preserve the WebKit failure and NOT_RUN tests", () => {
  const chromium = json("evidence/d2c4ad1-ci/results-chromium.json"), webkit = json("evidence/d2c4ad1-ci/results-webkit.json");
  assert.deepEqual(chromium.states, { T1:"PASS",T2:"PASS",T3:"PASS",T4:"PASS",T5:"PASS",T6:"PASS",T7:"PARTIAL",T8:"PASS",T9:"PARTIAL",T10:"PASS",T11:"PARTIAL",T12:"HOLD" });
  assert.deepEqual(webkit.states, { T1:"PASS",T2:"PASS",T3:"PASS",T4:"PASS",T5:"PASS",T6:"PASS",T7:"FAIL",T8:"NOT_RUN",T9:"NOT_RUN",T10:"NOT_RUN",T11:"NOT_RUN",T12:"NOT_RUN" });
  assert.equal(webkit.failure, "T7 iteration 9.upgrade: IndexedDB open timeout; blocked event: false");
});
test("historical checkout, environment and runtime source identities agree", () => {
  const c = json("evidence/d2c4ad1-ci/results-chromium.json"), w = json("evidence/d2c4ad1-ci/results-webkit.json");
  assert.equal(c.gitHead, "ac21059de9589bbc3a62cbd94be5bce15394b50c"); assert.equal(w.gitHead, c.gitHead);
  assert.equal(w.nodeVersion, "v22.23.4"); assert.equal(c.nodeVersion, w.nodeVersion);
  assert.equal(w.browserVersion, "26.5"); assert.equal(c.browserVersion, "151.0.7922.34");
  assert.deepEqual(c.sourceHashes, w.sourceHashes);
  assert.equal(w.sourceHashes["suite.js"], "7ce8bb4b96f68bde92e7bfa3ef6ddbcfebd343bba6d01c0f3e2c9b5e16d4a3f2");
});
