#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "issue436c-local-windows.ps1"
$root = Join-Path $env:RUNNER_TEMP ("issue436c-preflight-" + [Guid]::NewGuid().ToString("N"))
& $script -OutputRoot $root
if ($LASTEXITCODE -ne 0) { throw "Preflight should finish with exit 0." }
$outcome = Get-Content -LiteralPath (Join-Path $root "outcome.json") -Raw | ConvertFrom-Json
$preflight = Get-Content -LiteralPath (Join-Path $root "preflight.json") -Raw | ConvertFrom-Json
if ($outcome.state -ne "PREFLIGHT_ONLY" -or $outcome.localMachineExecution -ne $false) {
    throw "Preflight incorrectly recorded a browser execution."
}
if ($preflight.executeRequested -ne $false) { throw "Preflight recorded -Execute=true unexpectedly." }
if (Test-Path -LiteralPath (Join-Path $root "isolated-repository")) { throw "Preflight cloned repository." }
if (Test-Path -LiteralPath (Join-Path $root "isolated-browsers")) { throw "Preflight installed browsers." }
if (-not (Test-Path -LiteralPath (Join-Path $root "issue436c-evidence.zip"))) { throw "Preflight evidence ZIP missing." }
$sha = Get-Content -LiteralPath (Join-Path $root "archive-sha256.json") -Raw | ConvertFrom-Json
if ($sha.sha256 -notmatch "^[0-9A-F]{64}$") { throw "Invalid SHA256." }
Write-Output "PASS: preflight does not clone, install or run browser."
$blockedRoot = Join-Path $env:RUNNER_TEMP ("issue436c-blocked-" + [Guid]::NewGuid().ToString("N"))
& $script -Execute -ExpectedKitHead invalid -OutputRoot $blockedRoot
if ($LASTEXITCODE -ne 2) { throw "Invalid pinned revision must fail closed with exit 2." }
$blocked = Get-Content -LiteralPath (Join-Path $blockedRoot "outcome.json") -Raw | ConvertFrom-Json
if ($blocked.state -ne "BLOCKED" -or $blocked.rootCause -ne "UNKNOWN") {
    throw "Invalid revision did not remain BLOCKED/UNKNOWN."
}
if (Test-Path -LiteralPath (Join-Path $blockedRoot "isolated-repository")) { throw "Blocked execution cloned repository." }
Write-Output "PASS: invalid revision blocked before any checkout or browser execution."
