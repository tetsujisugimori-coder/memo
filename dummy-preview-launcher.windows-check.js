"use strict";
// Explicit Windows integration check: actual PS 5.1 + actual tunnel-client, offline control plane.
// Never imports runtime credentials, uses the user's receiver, or calls submit_dummy_preview.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const artifacts = path.join(__dirname, "e2e-artifacts/dummy-preview/launcher");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function exists(file) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; } }
async function check() {
  assert.equal(process.platform, "win32", "Run this integration check on Windows");
  const binary = process.argv[2]; assert.ok(binary, "Usage: node dummy-preview-launcher.windows-check.js C:/path/to/tunnel-client.exe");
  const version = execFileSync(binary, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
  assert.match(version, /^0\.0\.16\+5f99daabd4aa4a77049e6d81d54a0d8c18335397/);
  await fs.mkdir(artifacts, { recursive: true });
  const root = await fs.mkdtemp(path.join(artifacts, "空白 日本語 'quote' "));
  const tunnel = path.join(root, "Tunnel 実行", "tunnel-client.exe");
  const node = path.join(root, "Node 実行", "node.exe");
  const adapterRoot = path.join(root, "MCP スクリプト");
  await fs.mkdir(path.dirname(tunnel)); await fs.mkdir(path.dirname(node)); await fs.mkdir(adapterRoot);
  await fs.copyFile(binary, tunnel); await fs.copyFile(process.execPath, node);
  for (const file of ["dummy-preview-mcp.js", "dummy-preview-queue.js", "dummy-preview-service.js"]) await fs.copyFile(path.join(__dirname, file), path.join(adapterRoot, file));
  const adapter = path.join(adapterRoot, "dummy-preview-mcp.js");
  // Test-only marker proves the executable/script actually ran; record method names, never request data.
  const probe = `const markerFs = require("node:fs");\nconst marker = { pid: process.pid, executable: process.execPath, script: process.argv[1], methods: [] };\nconst mark = () => markerFs.writeFileSync(process.env.TEST_START_MARKER, JSON.stringify(marker));\nmark(); let probeBuffer = ""; process.stdin.on("data", chunk => { probeBuffer += chunk.toString(); let end; while ((end = probeBuffer.indexOf("\\n")) >= 0) { const line = probeBuffer.slice(0,end); probeBuffer = probeBuffer.slice(end+1); try { marker.methods.push(JSON.parse(line).method); mark(); } catch {} } });\n`;
  await fs.writeFile(adapter, probe + await fs.readFile(adapter, "utf8"));
  const original = execFileSync("git", ["show", "a5d311b7592f72a2dbad630b20d4e13c21825325:start-dummy-preview-tunnel.ps1"], { cwd: __dirname, encoding: "utf8", windowsHide: true });
  const fixed = await fs.readFile(path.join(__dirname, "start-dummy-preview-tunnel.ps1"), "utf8");
  const driver = path.join(root, "driver.ps1");
  await fs.writeFile(driver, `$ErrorActionPreference = 'Stop'\nWrite-Output ('PS_VERSION:' + $PSVersionTable.PSVersion.ToString())\nfunction Read-Host { param([string]$Prompt,[switch]$AsSecureString) ConvertTo-SecureString $env:TEST_ADAPTER_TOKEN -AsPlainText -Force }\ntry { & $env:TEST_LAUNCHER -TunnelClientPath $env:TEST_TUNNEL } catch { Write-Output ('LAUNCH_ERROR:' + $_.Exception.Message) } finally { Write-Output ('TOKEN_CLEARED:' + (-not (Test-Path Env:MEMO_PREVIEW_ADAPTER_TOKEN))) }\n`);
  let commands = []; let responses = [];
  const control = http.createServer((req, res) => {
    const chunks = []; req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url.split("?")[0].endsWith("/poll")) res.end(JSON.stringify({ commands: commands.length ? [commands.shift()] : [] }));
      else { if (req.url.endsWith("/response")) responses.push(Buffer.concat(chunks).toString("utf8")); res.end("{}"); }
    });
  });
  await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve));
  const results = [];
  try {
    for (const scenario of [
      { name: "original-log-error", source: original, expected: /log level requires 'struct-text' or 'json' log format/ },
      { name: "original-command-error", source: original.replace(" --log.level warn", ""), expected: /start stdio command: exec: "C:Program"/ },
      { name: "fixed-program-files-node", source: fixed },
      { name: "fixed-japanese-space-quote-node", source: fixed, copiedNode: true }
    ]) {
      const launcher = path.join(adapterRoot, "start-dummy-preview-tunnel.ps1"); await fs.writeFile(launcher, scenario.source);
      const markerFile = path.join(root, scenario.name + ".json"); const pidFile = path.join(root, scenario.name + ".pid");
      const apiKey = randomBytes(32).toString("base64url"); const adapterToken = randomBytes(32).toString("base64url");
      // Whitelist OS variables only: no user configuration, keys, headers, proxy or active tunnel identity.
      const env = {}; for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PATHEXT", "Path"]) if (process.env[key]) env[key] = process.env[key];
      if (scenario.copiedNode) env.Path = path.dirname(node) + path.delimiter + (env.Path || "");
      Object.assign(env, { CONTROL_PLANE_API_KEY: apiKey, CONTROL_PLANE_TUNNEL_ID: "tunnel_" + "0".repeat(32), CONTROL_PLANE_BASE_URL: `http://127.0.0.1:${control.address().port}`,
        HEALTH_LISTEN_ADDR: "127.0.0.1:0", PID_FILE: pidFile, TEST_ADAPTER_TOKEN: adapterToken, TEST_LAUNCHER: launcher, TEST_TUNNEL: tunnel, TEST_START_MARKER: markerFile,
        // The fixed launcher's CLI must override even an inherited unsafe setting.
        LOG_HTTP_RAW_UNSAFE: scenario.expected ? "false" : "true" });
      const powershell = path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
      responses = [];
      commands = [
        { jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "offline-launch-check", version: "1" } } },
        { jsonrpc: "2.0", id: "list", method: "tools/list", params: {} }
      ].map((jsonrpc, index) => ({ request_id: "offline-" + index, shard_token: "offline-test", command_type: "jsonrpc", channel: "main", created_at: new Date().toISOString(), headers: {}, jsonrpc }));
      const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-File", driver], { cwd: root, env, windowsHide: true });
      let output = ""; let exited = false; child.stdout.on("data", chunk => { output += chunk.toString(); }); child.stderr.on("data", chunk => { output += chunk.toString(); });
      child.on("exit", () => { exited = true; }); let marker;
      try {
        for (let n = 0; n < 150 && !exited; n++) { marker = await exists(markerFile); if (marker?.methods.includes("tools/list") && responses.some(value => value.includes("submit_dummy_preview"))) break; await pause(100); }
        assert.match(output, /PS_VERSION:5\.1\./);
        if (scenario.expected) { assert.match(output, scenario.expected); assert.equal(marker, null); }
        else {
          assert.ok(marker, output); assert.ok(marker.methods.includes("initialize"), "actual MCP initialization was not observed");
          assert.ok(marker.methods.includes("notifications/initialized"), "initialized notification was not observed");
          assert.ok(marker.methods.includes("tools/list"), "tools/list was not observed");
          assert.ok(responses.some(value => value.includes("submit_dummy_preview")), "actual MCP tool listing did not return");
          assert.equal(path.normalize(marker.script), path.normalize(adapter));
          assert.equal(path.normalize(marker.executable), path.normalize(scenario.copiedNode ? node : process.execPath));
          assert.doesNotMatch(output, /log level requires|start stdio command: exec:/);
        }
      } finally {
        // Kill only processes created by this scenario, identified by its private marker/PID file.
        marker = await exists(markerFile);
        if (marker?.pid) { try { process.kill(marker.pid); } catch {} }
        for (let n = 0; n < 50 && !exited; n++) await pause(100);
        if (!exited) { try { process.kill(Number((await fs.readFile(pidFile, "utf8")).trim())); } catch {} }
        for (let n = 0; n < 20 && !exited; n++) await pause(100);
        if (!exited) child.kill();
        await fs.writeFile(path.join(root, scenario.name + ".log"), output.includes(apiKey) || output.includes(adapterToken) ? "Test output redacted: secret detected" : output);
      }
      assert.match(output, /TOKEN_CLEARED:True/);
      assert.ok(!output.includes(apiKey) && !output.includes(adapterToken), "a test secret appeared in process output");
      // Keep each first result, including expected pre-fix errors. Test keys are never written.
      await fs.writeFile(path.join(root, scenario.name + ".log"), output);
      results.push({ name: scenario.name, powershellVersion: output.match(/PS_VERSION:([^\r\n]+)/)[1], expectedFailure: !!scenario.expected, nodeStarted: !!marker, initialized: !!marker?.methods.includes("initialize"), toolsListed: responses.some(value => value.includes("submit_dummy_preview")), tokenCleared: true, secretsInOutput: false });
    }
  } finally {
    control.closeAllConnections(); await new Promise(resolve => control.close(resolve));
    // Remove only the executable copies created above; retain all first-run evidence.
    await fs.unlink(tunnel).catch(() => {}); await fs.unlink(node).catch(() => {});
  }
  const summary = { version, platform: process.platform, node: process.version, controlPlane: "isolated ephemeral loopback with generated test credentials", results,
    notVerified: ["real Secure MCP Tunnel independently rerun", "receiver GUI manual startup/close", "public Origin/LNA/OAuth/persistence"] };
  await fs.writeFile(path.join(root, "result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
check().catch(error => { console.error(error); process.exitCode = 1; });
