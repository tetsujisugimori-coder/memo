"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, execFileSync } = require("node:child_process");
const root = __dirname;
const output = path.join(process.env.STORAGE_GUIDE_ARTIFACTS || os.tmpdir(), "negative-controls");
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

(async () => {
  await fs.mkdir(output, { recursive: true });
  const html = await fs.readFile(path.join(root, "storage-guide.html"), "utf8");
  const css = await fs.readFile(path.join(root, "storage-guide.css"), "utf8");
  const results = { testedHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), startedAt: new Date().toISOString(), cases: [] };
  try {
    for (const fault of ["missing-link", "horizontal-overflow"]) {
      // Only static assets are copied; no profile, storage, git metadata or live server is reused.
      const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "memo-guide-negative-"));
      const artifacts = path.join(output, fault);
      try {
        await fs.mkdir(artifacts, { recursive: true });
        for (const entry of await fs.readdir(root, { withFileTypes: true })) {
          if (entry.isFile() && /\.(?:html|css|js)$/.test(entry.name)) await fs.copyFile(path.join(root, entry.name), path.join(fixture, entry.name));
        }
        if (fault === "missing-link") {
          assert.match(html, /<a href="#backup"[^>]*>[^<]*<\/a>/);
          await fs.writeFile(path.join(fixture, "storage-guide.html"), html.replace(/<a href="#backup"[^>]*>[^<]*<\/a>/, ""));
        } else {
          await fs.writeFile(path.join(fixture, "storage-guide.css"), css + "\nbody { min-width: 1600px !important; }\n");
        }
        const run = spawnSync(process.execPath, [path.join(root, "storage-guide.e2e.cjs")], {
          cwd: root,
          encoding: "utf8",
          timeout: 120000,
          env: { ...process.env, STORAGE_GUIDE_ARTIFACTS: artifacts, STORAGE_GUIDE_FIXTURE_ROOT: fixture },
        });
        await fs.writeFile(path.join(artifacts, "run.log"), (run.stdout || "") + (run.stderr || ""));
        // Timeout/startup failures are not valid evidence that the injected defect was detected.
        assert.equal(run.error, undefined, "negative-control child must execute normally");
        assert.equal(run.status, 1, "injected defect must exit nonzero");
        const report = JSON.parse(await fs.readFile(path.join(artifacts, "results.json"), "utf8"));
        assert.equal(report.testedHead, results.testedHead);
        assert.equal(report.status, "FAIL");
        const expected = fault === "missing-link" ? "guide anchor #backup missing" : "guide horizontal overflow";
        for (const browser of ["chromium", "webkit"]) {
          assert.ok(report.cases.some((entry) => entry.browser === browser && entry.status === "FAIL" && entry.error.includes(expected)), `${browser} must fail for the injected defect itself`);
        }
        results.cases.push({ fault, status: "PASS", expectedChildExit: 1, actualChildExit: run.status, detectedBy: ["chromium", "webkit"], error: expected });
      } finally {
        // The exact directory was created by mkdtemp above, under the system temp directory.
        assert.ok(fixture.startsWith(path.join(os.tmpdir(), "memo-guide-negative-")));
        await fs.rm(fixture, { recursive: true, force: true });
      }
    }
    assert.equal(digest(await fs.readFile(path.join(root, "storage-guide.html"))), digest(Buffer.from(html)));
    assert.equal(digest(await fs.readFile(path.join(root, "storage-guide.css"))), digest(Buffer.from(css)));
    results.productFilesUnchanged = true;
    results.status = "PASS";
  } catch (error) {
    results.status = "FAIL";
    results.error = error.stack;
    process.exitCode = 1;
  } finally {
    results.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
    console.log(JSON.stringify(results, null, 2));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
