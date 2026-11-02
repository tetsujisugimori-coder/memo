"use strict";
const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const jst = () => new Date(Date.now() + 9 * 3600000).toISOString().replace("Z", "+09:00");
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
function git(...args) { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
async function metadata(files) {
  return { baselineCommit: "06796f70f1a42b829ba6c4a2b7e962409aca20e6", testedCommit: git("rev-parse", "HEAD"), testedTree: git("rev-parse", "HEAD^{tree}"),
    dirty: !!git("status", "--porcelain", "--untracked-files=no"), recordedAtJST: jst(), platform: process.platform, node: process.version,
    sourceHashes: Object.fromEntries(await Promise.all(files.map(async f => [f, hash(await fs.readFile(path.join(root, f)))]))) };
}
async function save(label, evidence) {
  const dir = path.join(root, "e2e-artifacts/stage5"); await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${label}-${crypto.randomUUID()}.json`);
  await fs.writeFile(file, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ file: path.relative(root, file), outcome: evidence.outcome })); return file;
}
module.exports = { metadata, save, hash, jst, root };
