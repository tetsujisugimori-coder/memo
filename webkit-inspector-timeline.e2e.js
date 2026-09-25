"use strict";

const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

const outputPath = path.join(__dirname, "e2e-artifacts", "webkit-inspector-timeline.jsonl");
const records = [];

function record(stage, fields = {}) {
  const entry = { diagnostic: "webkit-inspector-timeline", stage, at: new Date().toISOString(), ...fields };
  records.push(entry);
  console.log(`[WEBKIT_INSPECTOR_TIMELINE] ${JSON.stringify(entry)}`);
}

async function main() {
  let server;
  let browser;
  let result = "C";
  const version = require("playwright/package.json").version;
  record("environment", {
    platform: process.platform,
    node: process.version,
    playwright: version,
    webkitExecutable: playwright.webkit.executablePath(),
    webkitBuild: playwright.webkit.name(),
    note: "The probe inspects Playwright's BrowserServer child process spawnargs (implementation detail) to distinguish its WebKit Inspector pipe from the public Playwright BrowserServer WebSocket.",
    publicApi: false,
    internalApi: true
  });

  try {
    server = await playwright.webkit.launchServer({ headless: true });
    const launchArgs = server.process().spawnargs.slice(1);
    const inspectorPipe = launchArgs.includes("--inspector-pipe");
    const remoteDebuggingArgs = launchArgs.filter((argument) => argument.startsWith("--remote-debugging-"));
    record("playwright_transport", {
      success: true,
      launchArgs,
      inspectorPipe,
      remoteDebuggingArgs,
      browserServerEndpoint: server.wsEndpoint(),
      browserServerEndpointType: "Playwright protocol WebSocket, not Inspector remote target"
    });
    browser = await playwright.webkit.connect(server.wsEndpoint());
    record("playwright_browser", { success: true, version: browser.version() });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>Inspector Timeline probe</title><div id='target'>before</div>");
    await page.locator("#target").evaluate((element) => { element.textContent = "after"; });
    record("page_operation", { success: true, title: await page.title(), text: await page.locator("#target").textContent() });

    record("inspector_target", {
      success: false,
      error: inspectorPipe && remoteDebuggingArgs.length === 0
        ? "Playwright started WebKit with --inspector-pipe and no remote-debugging endpoint; its BrowserServer WebSocket speaks Playwright protocol and is not an Inspector target. The Inspector pipe is not exposed as an attachable target by Playwright's API."
        : "No separate WebKit Inspector remote target was exposed by the Playwright-launched process.",
      classification: "C"
    });
    record("inspector_session", { success: false, error: "Not attempted: no Inspector target was obtained.", classification: "C" });
    record("timeline_start", { success: false, error: "Not attempted: no Inspector session was established.", classification: "C" });
    record("timeline_event", { success: false, eventCount: 0, error: "Not attempted: Timeline recording could not be started.", classification: "C" });
    record("result", {
      classification: result,
      conclusion: "In this Playwright/WebKit runtime no Inspector remote target/session was obtainable through the exposed connection route; this does not establish that WebKit generally lacks Timeline support.",
      next: "Do not add page probes. Revisit only if a supported or deliberately instrumented Inspector transport becomes available."
    });
  } catch (error) {
    record("playwright_browser", { success: false, error: String(error), classification: "C" });
    record("result", { classification: result, conclusion: "The Playwright WebKit browser did not launch, so Inspector access was not evaluated." });
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  }
}

main().catch((error) => {
  record("fatal", { error: String(error), classification: "C" });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  process.exitCode = 1;
});
