"use strict";
// Diagnostic runner for fixed product sources. No save/timer/BC/IDB writer replacement.
const fs = require("node:fs"), fsp = fs.promises, path = require("node:path");
const os = require("node:os"), crypto = require("node:crypto"), http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");
const FIXED = "478d8b3ea59b242e4ddd5cc82e12b44169223047";
const OLD = "8f35ca25001ffa031abfd304dd2a5e9a3d9197dd";
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");

// In-page observer only reads DOM/events. Deep mode adds synchronous stamps to
// served source; it adds no await and leaves the source checkout unchanged.
function pageObserver() {
  const mark = globalThis.__i436Mark = (event, data = {}) => console.debug("__I436__" + JSON.stringify({
    event, data, epoch: Date.now(), pageMs: performance.now(), timeOrigin: performance.timeOrigin,
  }));
  mark("document-created");
  for (const name of ["DOMContentLoaded", "load", "pageshow", "pagehide", "beforeunload", "unload"])
    addEventListener(name, (e) => mark(name, { persisted: e.persisted }));
  let last;
  const read = () => {
    const g = document.getElementById("appStartupGuard");
    const s = g && JSON.stringify({ hidden: g.hidden, busy: g.getAttribute("aria-busy"), text: g.textContent });
    if (s && s !== last) { last = s; mark("guard", JSON.parse(s)); }
  };
  new MutationObserver(read).observe(document, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["hidden", "aria-busy"] });
}

function instrument(file, source) {
  const stamp = (name) => `globalThis.__i436Mark(${JSON.stringify(name)});`;
  if (file === "app.js") {
    const begin = source.indexOf("async function init() {"), end = source.indexOf("\nfunction checkLocalStorageAvailable", begin);
    if (begin < 0 || end < 0) throw new Error("Unsupported init source: no instrumentation applied");
    let part = source.slice(begin, end).replace("async function init() {", "async function init() {" + stamp("T5:init:start"));
    const lines = ["db = await openDb();", "collections = await getAllCollections();", "await ensureInitialCollections();",
      "notes = await getAllNotes();", "await migrateLegacyNotesToUnclassified();", "const restoredDraftId = await restoreCurrentDraftMirror();",
      "await ensureStartupNotes();", "await initializeLocalFolderSaving();", "await synchronizeRegisteredTagsForNotes();"];
    for (const line of lines) {
      if (!part.includes(line)) throw new Error("Missing startup statement: " + line);
      part = part.split(line).join(stamp("await:start:" + line) + line + stamp("await:end:" + line));
    }
    source = source.slice(0, begin) + part + source.slice(end);
    source = source.replace("function hideStartupGuard() {", "function hideStartupGuard() {" + stamp("T9:hideGuard:called"));
  }
  if (file === "indexeddb-lifecycle.js") {
    const needle = "request = indexedDB.open(name, version);";
    if (!source.includes(needle)) throw new Error("Unsupported lifecycle source");
    source = source.replace(needle, stamp("T6:idb:open:start") + needle + `
      globalThis.__i436OpenRequest = request;
      globalThis.__i436Mark("T6:idb:request", {state: request.readyState, name, version});
      for (const kind of ["upgradeneeded", "blocked", "success", "error"]) request.addEventListener(kind, (event) => {
        globalThis.__i436Mark("T7:idb:" + kind, {state: request.readyState, oldVersion: event.oldVersion,
          newVersion: event.newVersion, error: request.readyState === "done" ? request.error?.name : null,
          stores: kind === "success" ? [...request.result.objectStoreNames] : null});
        if (kind === "upgradeneeded") for (const state of ["complete", "abort", "error"])
          request.transaction.addEventListener(state, () => globalThis.__i436Mark("upgrade-transaction:" + state));
      });`);
    source = source.replace("database.onversionchange = (event) => {", "database.onversionchange = (event) => {" + stamp("idb:versionchange"));
    source = source.replace("database.close();", stamp("idb:close:call") + "database.close();" + stamp("idb:close:return"));
  }
  return source;
}

async function preload() {
  const dir = path.resolve(process.env.I436_OUTPUT), deep = process.env.I436_DEEP === "1";
  fs.mkdirSync(dir, { recursive: true });
  const timeline = path.join(dir, "timeline.jsonl"), start = performance.now();
  let sequence = 0, pageSequence = 0;
  const record = (event, data = {}) => fs.appendFileSync(timeline, JSON.stringify({
    sequence: sequence++, event, at: new Date().toISOString(), elapsedMs: performance.now() - start, ...data,
  }) + "\n");
  const bounded = async (promise, ms, label) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + " deadline")), ms); })]); }
    finally { clearTimeout(timer); }
  };
  async function state(page, reason) {
    try {
      const data = await bounded(page.evaluate(() => {
        const read = (code) => { try { return eval(code); } catch (e) { return { unavailable: e.name }; } };
        const guard = document.querySelector("#appStartupGuard"), editor = document.querySelector("#editor");
        const pending = globalThis.__i436OpenRequest;
        return { url: location.href, readyState: document.readyState, timeOrigin: performance.timeOrigin,
          navigation: performance.getEntriesByType("navigation").map(x => x.toJSON()),
          guard: guard && { hidden: guard.hidden, busy: guard.getAttribute("aria-busy"), text: guard.textContent },
          editor: editor && { readOnly: editor.readOnly, disabled: editor.disabled, value: editor.value },
          currentId: read("currentId"), notes: read("notes.length"),
          database: read("db && ({name:db.name,version:db.version,stores:[...db.objectStoreNames]})"),
          connectionClosedForUpgrade: read("dbConnectionClosedForUpgrade"),
          request: pending && { readyState: pending.readyState, error: pending.readyState === "done" ? pending.error?.name : null },
          saveState: read("noteSaveFoundation.getState(currentId)"),
        };
      }), 1500, "state");
      record("snapshot", { page: page.__i436, reason, data });
    } catch (e) { record("snapshot-error", { page: page.__i436, reason, error: e.stack }); }
  }
  const support = require("./note-conflict-test-support.cjs");
  if (deep) support.createServer = (root = process.env.MEMO_SAVE_APP_ROOT || __dirname) => http.createServer(async (req, res) => {
    try {
      const file = path.resolve(root, "." + new URL(req.url, "http://127.0.0.1").pathname);
      if (!file.startsWith(path.resolve(root) + path.sep)) return res.writeHead(403).end();
      const raw = await fsp.readFile(file), name = path.basename(file);
      const data = ["app.js", "indexeddb-lifecycle.js"].includes(name) ? Buffer.from(instrument(name, raw.toString("utf8"))) : raw;
      if (!data.equals(raw)) record("served-instrumentation", { file: name, sourceSha256: hash(raw), servedSha256: hash(data) });
      res.writeHead(200, { "Content-Type": ({ ".js": "application/javascript", ".html": "text/html; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream" }); res.end(data);
    } catch (e) { record("server-error", { url: req.url, error: e.message }); res.writeHead(404).end(); }
  });
  for (const name of ["openApp", "appReady"]) {
    const original = support[name];
    support[name] = async (page, ...args) => {
      record(name + ":start", { page: page.__i436 });
      try { const result = await original(page, ...args); record(name + ":end", { page: page.__i436 }); await state(page, name + ":complete"); return result; }
      catch (e) {
        record(name + ":error", { page: page.__i436, error: e.stack });
        await state(page, name + ":timeout-or-error");
        try { await bounded(page.screenshot({ path: path.join(dir, `timeout-${page.__i436}.png`), timeout: 2000 }), 2500, "screenshot"); }
        catch (shot) { record("screenshot-error", { error: shot.message }); }
        throw e;
      }
    };
  }
  const playwright = require("playwright");
  // Stage #436-B is strictly opt-in; the original runner and acceptance remain unchanged.
  if (process.env.I436B_TELEMETRY === "1") {
    require("./issue436b-telemetry.cjs").install({ support, playwright, dir });
  }
  for (const engine of ["chromium", "webkit"]) {
    const launch = playwright[engine].launch.bind(playwright[engine]);
    playwright[engine].launch = async (...args) => {
      record("T0:launch:start", { engine });
      const browser = await launch(...args); record("T0:launch:end", { engine, version: browser.version() });
      browser.on("disconnected", () => record("browser:disconnected", { engine }));
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...ctxArgs) => {
        record("T1:context:start", { contexts: browser.contexts().length });
        const context = await newContext(...ctxArgs); record("T1:context:end", { contexts: browser.contexts().length });
        await context.addInitScript(pageObserver);
        context.on("close", () => record("context:close"));
        const newPage = context.newPage.bind(context);
        context.newPage = async (...pageArgs) => {
          record("T2:page:start", { pages: context.pages().length });
          const page = await newPage(...pageArgs); page.__i436 = ++pageSequence;
          record("T2:page:end", { page: page.__i436, pages: context.pages().length });
          for (const event of ["domcontentloaded", "load", "close", "crash"]) page.on(event, () => record("page:" + event, { page: page.__i436 }));
          page.on("console", (msg) => {
            if (msg.text().startsWith("__I436__")) { try { record("page:mark", { page: page.__i436, mark: JSON.parse(msg.text().slice(8)) }); } catch (e) { record("decode-error", { error: e.message }); } }
            else record("page:console", { page: page.__i436, type: msg.type(), text: msg.text() });
          });
          page.on("pageerror", (e) => record("page:error", { page: page.__i436, error: e.stack }));
          page.on("requestfailed", (r) => record("request:failed", { page: page.__i436, url: r.url(), failure: r.failure() }));
          page.on("request", (r) => record("request:start", { page: page.__i436, url: r.url(), type: r.resourceType() }));
          page.on("requestfinished", (r) => record("request:end", { page: page.__i436, url: r.url() }));
          for (const method of ["goto", "reload", "close"]) {
            const original = page[method].bind(page);
            page[method] = async (...params) => {
              record(method + ":start", { page: page.__i436, params });
              try { const value = await original(...params); record(method + ":end", { page: page.__i436, pages: context.pages().length }); return value; }
              catch (e) { record(method + ":error", { page: page.__i436, error: e.stack }); throw e; }
            };
          }
          return page;
        };
        return context;
      };
      return browser;
    };
  }
  record("observer-installed", { deep, pid: process.pid, node: process.version, platform: process.platform, release: os.release(),
    freeMemory: os.freemem(), totalMemory: os.totalmem(), loadavg: os.loadavg() });
}

async function main() {
  const args = process.argv.slice(2), engine = args[0] || "webkit", variant = args[1] || "fixed", deep = args[2] === "deep";
  if (!["chromium", "webkit"].includes(engine) || !["fixed", "old", "integration"].includes(variant)) throw new Error("usage: node issue436-startup-diagnostic.cjs chromium|webkit fixed|old|integration [deep|none]");
  const dir = path.resolve(process.env.I436_OUTPUT || `e2e-artifacts/issue436/${process.platform}-${variant}-${engine}-${deep ? "deep" : "passive"}`);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(path.join(dir, "manifest.json"))) throw new Error("Evidence directory already used; choose a new I436_OUTPUT");
  const head = variant === "integration" ? "e41d72d00ea5e799acc70aaef4d78defa402e796" : variant === "fixed" ? FIXED : OLD, root = path.join(dir, "source"); fs.mkdirSync(root);
  const tar = path.join(dir, "source.tar");
  execFileSync("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", `--output=${tar}`, head], { cwd: __dirname });
  execFileSync("tar", ["-xf", tar, "-C", root]);
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", head], { cwd: __dirname, encoding: "utf8" }).trim().split("\n");
  const sourceHashes = {};
  for (const file of files.filter(x => /\.(js|cjs|html|css)$/.test(x))) {
    const actual = fs.readFileSync(path.join(root, file)), expected = execFileSync("git", ["show", `${head}:${file}`], { cwd: __dirname, maxBuffer: 24 * 1024 * 1024 });
    if (!actual.equals(expected)) throw new Error("Source byte mismatch " + file);
    sourceHashes[file] = hash(actual);
  }
  const manifest = { sourceHead: head, sourceVerified: true, sourceHashes, engine, variant, deep, observation: args[2] === "none" ? "none" : deep ? "deep" : "passive",
    runnerHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim(),
    diagnosticSha256: hash(fs.readFileSync(__filename)), node: process.version, playwright: require("playwright/package.json").version,
    platform: process.platform, release: os.release(), startedAt: new Date().toISOString(), freeMemory: os.freemem(),
    test: "unchanged note-conflict.e2e.cjs SMOKE 1280 AB; all original assertions retained", deadlineMs: 150000,
    safety: { "J2/U-C": "UNKNOWN", conditionU: "NOT_RUN", executionAuthorization: "NOT_GRANTED", startCondition: "BLOCKED", productionWorker: "HOLD" } };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  const child = spawn(process.execPath, [...(args[2] === "none" ? [] : ["--require", __filename]), path.join(__dirname, "note-conflict.e2e.cjs")], {
    cwd: __dirname, env: { ...process.env, I436_CHILD: "1", I436_DEEP: deep ? "1" : "0", I436_OUTPUT: dir,
      MEMO_SAVE_APP_ROOT: root, MEMO_SAVE_SOURCE_HEAD: head, MEMO_SAVE_ARTIFACTS: dir,
      MEMO_SAVE_BROWSERS: engine, MEMO_SAVE_SMOKE: "1", MEMO_SAVE_SMOKE_WIDTH: "1280" }, windowsHide: true,
  });
  const log = fs.createWriteStream(path.join(dir, "run.log"));
  child.stdout.on("data", x => { log.write(x); process.stdout.write(x); }); child.stderr.on("data", x => { log.write(x); process.stderr.write(x); });
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    // Only this runner's own child tree. No preexisting processes are stopped.
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    else child.kill("SIGKILL");
  }, manifest.deadlineMs);
  const exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
  clearTimeout(timer); await new Promise(resolve => log.end(resolve));
  Object.assign(manifest, { finishedAt: new Date().toISOString(), exit, expired, freeMemoryAfter: os.freemem() });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ output: dir, ...exit, expired }));
  // Old RED is expected to fail product acceptance. This wrapper never labels it PASS.
  process.exitCode = expired ? 124 : exit.code ?? 1;
}
if (process.env.I436_CHILD === "1") preload().catch(e => { console.error(e); process.exitCode = 1; });
else if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { instrument };
