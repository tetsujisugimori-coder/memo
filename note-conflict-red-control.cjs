"use strict";
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { evaluateSafety } = require("./note-conflict-acceptance.cjs");
const legacy = "8f35ca25001ffa031abfd304dd2a5e9a3d9197dd";
(async () => {
  const output = path.resolve(process.env.MEMO_SAVE_ARTIFACTS || path.join(os.tmpdir(), "memo-issue429/browser")), target = path.join(output, "legacy-control");
  await fs.mkdir(target, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "memo429-legacy-"));
  const source = path.join(temp, "app"); await fs.mkdir(source);
  const archive = path.join(temp, "legacy.tar");
  execFileSync("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", `--output=${archive}`, legacy], { cwd: __dirname });
  execFileSync("tar", ["-xf", archive, "-C", source]);
  const archivedFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", legacy], { cwd: __dirname, encoding: "utf8" }).trim().split("\n");
  // The label is accepted only after actual source bytes match the fixed commit.
  for (const file of archivedFiles.filter((file) => /\.(js|cjs|html|css)$/.test(file))) {
    const expected = execFileSync("git", ["show", `${legacy}:${file}`], { cwd: __dirname, maxBuffer: 20 * 1024 * 1024 });
    assert.deepEqual(await fs.readFile(path.join(source, file)), expected, `legacy archive bytes: ${file}`);
  }
  const files = ["app.js", "index.html", "note-conflict-store.js", "note-conflict-ui.js"];
  const hashes = async () => Object.fromEntries(await Promise.all(files.map(async (name) => [name, crypto.createHash("sha256").update(await fs.readFile(path.join(__dirname, name))).digest("hex")])));
  const before = await hashes();
  const run = spawnSync(process.execPath, [path.join(__dirname, "note-conflict.e2e.cjs")], { cwd: __dirname,
    env: { ...process.env, MEMO_SAVE_APP_ROOT: source, MEMO_SAVE_SOURCE_HEAD: legacy, MEMO_SAVE_ARTIFACTS: target,
      MEMO_SAVE_SMOKE: "1", MEMO_SAVE_SMOKE_WIDTH: "1280", MEMO_SAVE_BROWSERS: "chromium,webkit" }, encoding: "utf8", timeout: 180000 });
  await fs.writeFile(path.join(target, "run.log"), (run.stdout || "") + (run.stderr || ""));
  const summary = { kind: "LEGACY_RED_CONTROL_ONLY", legacyHead: legacy, runnerHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim(),
    sourceVerified: true, childExit: run.status, signal: run.signal, error: run.error?.message, status: "FAIL" };
  try {
    const report = JSON.parse(await fs.readFile(path.join(target, "results.json"), "utf8"));
    assert.equal(run.status, 1, "legacy failure must be a nonzero child exit, never a timeout/launch error");
    assert.equal(run.error, undefined);
    assert.equal(report.testedHead, legacy);
    assert.equal(report.cases.length, 2);
    for (const name of ["chromium", "webkit"]) {
      const result = report.cases.find((row) => row.browser === name);
      assert.ok(result && !result.error && result.evidence.execution.completed);
      const judged = evaluateSafety(result.evidence);
      assert.equal(judged.status, "FAIL");
      assert.equal(judged.lossDemonstrated, true, "actual irreversible edit loss remains mandatory");
      assert.equal(result.inputMode, "sequential", "same desktop reproduction schedule as the fixed product cases");
      const reopened = result.evidence.observations.reopened;
      assert.equal(reopened.length, 2);
      for (const state of reopened) {
        assert.equal(state.badgeState, "saved"); assert.equal(state.save.dirty, false);
        assert.equal(state.conflictUi.visible, false);
        assert.doesNotMatch(state.notice || "", /競合|未保存|保存失敗/);
        assert.equal(state.editor, state.stored.body);
        assert.ok(Object.values(result.evidence.spec.drafts).includes(state.stored.body));
      }
      assert.equal(reopened[0].stored.body, reopened[1].stored.body);
    }
    assert.deepEqual(await hashes(), before, "negative control must not mutate product source");
    summary.productUnchanged = true; summary.status = "PASS";
  } catch (error) { summary.reason = error.stack; }
  await fs.writeFile(path.join(output, "legacy-control-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== "PASS") process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
