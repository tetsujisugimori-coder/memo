"use strict";
// Explicit Windows launcher integration. Never starts a real tunnel.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
async function check() {
  assert.equal(process.platform, "win32");
  const ps = path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
  for (const file of ["start-mcp-http-discovery.ps1", "start-mcp-http-discovery-tunnel.ps1"]) {
    execFileSync(ps, ["-NoProfile", "-NonInteractive", "-Command", "$taskTokens=$null; $taskErrors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:MEMO_TEST_PARSE_FILE,[ref]$taskTokens,[ref]$taskErrors); if($taskErrors.Count){exit 1}"], { windowsHide: true, env: { ...process.env, MEMO_TEST_PARSE_FILE: path.join(__dirname, file) } });
  }
  const holder = http.createServer(); holder.listen(0, "127.0.0.1"); await once(holder, "listening");
  const port = holder.address().port; await new Promise(resolve => holder.close(resolve));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memo HTTP 日本語 'quote' "));
  const config = path.join(dir, "config.json");
  const value = { port, resource: `http://127.0.0.1:${port}/mcp`, authorization_servers: ["https://tenant.invalid/"], scopes_supported: ["memo:submit"] };
  await fs.writeFile(config, JSON.stringify(value));
  const env = {};
  for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "Path", "PATHEXT"]) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { CONTROL_PLANE_API_KEY: "TEST_SECRET_RUNTIME", MEMO_PREVIEW_ADAPTER_TOKEN: "TEST_SECRET_ADAPTER", MEMO_PREVIEW_BROWSER_TOKEN: "TEST_SECRET_BROWSER", OAUTH_TOKEN: "TEST_SECRET_OAUTH" });
  const child = spawn(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "start-mcp-http-discovery.ps1"), "-ConfigPath", config], { env, windowsHide: true });
  let output = ""; let pid;
  child.stdout.on("data", x => { output += x; }); child.stderr.on("data", x => { output += x; });
  const closed = once(child, "close");
  async function request(target, method = "GET", body = "") {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: target, method, headers: { Authorization: "Bearer TEST_SECRET_OAUTH" }, agent: false }, res => {
        let text = ""; res.on("data", x => { text += x; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
      }); req.on("error", reject); req.end(body);
    });
  }
  try {
    for (let i = 0; i < 100; i++) {
      pid = Number(/Discovery child PID: (\d+)/.exec(output)?.[1]);
      if (pid && output.includes("MCP operations disabled")) break;
      if (child.exitCode !== null) throw new Error(output);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(pid && output.includes("MCP operations disabled"), output);
    assert.deepEqual(JSON.parse((await request("/.well-known/oauth-protected-resource/mcp")).text), { resource: value.resource, authorization_servers: value.authorization_servers, scopes_supported: value.scopes_supported });
    const refusal = await request("/mcp", "POST", '{"method":"tools/call","params":{"body":"PRIVATE_BODY"}}');
    assert.equal(refusal.status, 401); assert.match(refusal.headers["www-authenticate"], /resource_metadata=/);
    // Collision must refuse, while the original server remains alive.
    assert.throws(() => execFileSync(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "start-mcp-http-discovery.ps1"), "-ConfigPath", config], { env, windowsHide: true, stdio: "pipe" }));
    assert.equal((await request("/mcp")).status, 401);
    assert.doesNotMatch(output, /TEST_SECRET_|PRIVATE_BODY/);
    // Explicitly stop ONLY the child PID reported by our own isolated launcher.
    process.kill(pid); pid = null;
    await closed;
    assert.equal(child.exitCode, 1);
    assert.doesNotMatch(output, /TEST_SECRET_|PRIVATE_BODY/);
    await assert.rejects(request("/mcp"), /ECONNREFUSED/);
    console.log("Windows PS 5.1: syntax, real launch, Unicode/spaced config path, metadata, 401, collision, fixed logs, child-PID shutdown passed");
  } finally {
    if (pid) { try { process.kill(pid); } catch {} }
    if (child.exitCode === null) { child.kill(); await closed; }
    await fs.rm(dir, { recursive: true, force: true });
  }
}
check().catch(error => { console.error(error); process.exitCode = 1; });
