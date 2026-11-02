"use strict";
const fs = require("node:fs/promises"), path = require("node:path");
const { chromium, webkit } = require("playwright"), { bounded } = require("./context-harness.cjs");
const { metadata, save } = require("./stage5-evidence.cjs");
const engine = process.env.WORKER_POC_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engine)) throw new Error("unsupported engine");
(async () => {
  const names = ["recovery-model.cjs", "shared-ledger.js", "stage5-deadline-cases.cjs", "stage5-deadline-browser.cjs", "stage5-evidence.cjs"];
  const report = { ...await metadata(names.map(f => `experiments/mcp-search-worker-feasibility/${f}`)),
    baselineCommit: "7e77de239e4a6ee581bb11f60c7a54423b3f201d", engine, results: [], outcome: "FAIL",
    environment: "isolated about:blank; synthetic ledger and Worker; no application origin, storage, or network" };
  let browser;
  try {
    browser = await ({ chromium, webkit })[engine].launch({ headless: true, timeout: 30000 }); report.version = browser.version();
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    for (const file of ["recovery-model.cjs", "stage5-deadline-cases.cjs"]) {
      const source = await fs.readFile(path.join(__dirname, file), "utf8");
      await page.addScriptTag({ content: `{const module={exports:{}};${source}\nObject.assign(window,module.exports);}` });
    }
    const cases = await page.evaluate(() => deadlineCases);
    for (const spec of cases) report.results.push(await bounded(page.evaluate(s => runDeadlineCase({ createRecoveryModel, createSharedRecoveryModel }, s), spec), 1500, spec.name));
    report.pageerrors = errors;
    if (errors.length || report.results.some(r => r.violations.length)) process.exitCode = 1;
    else report.outcome = "PASS";
    await context.close();
  } catch (e) { report.error = e.message; process.exitCode = 1; }
  finally {
    if (browser) try { await bounded(browser.close(), 5000, "browser close"); } catch { report.browserClose = "UNKNOWN"; report.outcome = "FAIL"; process.exitCode = 1; }
    const phase = process.env.STAGE5_DEADLINE_PHASE === "red" ? "red" : "green";
    await save(`deadline-${engine}-${phase}`, report);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
