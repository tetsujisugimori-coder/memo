#Requires -Version 5.1
<#
Stage 436-C: Windows REAL-PC, isolated synthetic Playwright evidence only.
Read before execution. No elevated permissions, no app data, no process termination outside own test.
No GitHub artifact upload, deployment, or automatic cleanup of evidence.
Usage: powershell -NoProfile -File .\tools\issue436c-local-windows.ps1 -Execute -ExpectedKitHead <full40sha>
Omit -Execute for a read-only environment preflight.
#>
[CmdletBinding()]
param(
    [switch]$Execute,
    [Parameter()][string]$ExpectedKitHead = "",
    [Parameter()][string]$OutputRoot = "",
    [switch]$AllowLowMemory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoUrl = "https://github.com/tetsujisugimori-coder/memo.git"
$branch = "codex/issue-436c-local-windows-isolation-20261110"
$stageBBase = "0f030bc9e02f87f43e7121e9f029741dfd0c1f79"
$fixedSource = "478d8b3ea59b242e4ddd5cc82e12b44169223047"
$minimumFreeMemoryMB = 1536
$minimumFreeDiskMB = 2048
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $stamp = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssfffZ")
    $nonce = [Guid]::NewGuid().ToString("N").Substring(0, 8)
    $OutputRoot = Join-Path $env:TEMP ("memo-issue436c-" + $stamp + "-" + $nonce)
}
if (Test-Path -LiteralPath $OutputRoot) {
    throw "Refusing to reuse or overwrite an existing output directory: $OutputRoot"
}
$null = New-Item -ItemType Directory -Path $OutputRoot -Force
$OutputRoot = (Resolve-Path -LiteralPath $OutputRoot).Path
$preflightFile = Join-Path $OutputRoot "preflight.json"
$outcomeFile = Join-Path $OutputRoot "outcome.json"
$repoDir = Join-Path $OutputRoot "isolated-repository"
$evidenceDir = Join-Path $OutputRoot "evidence"
$runState = "PREFLIGHT_ONLY"
$failure = $null
$originalExit = $null
$refSha = $null
$originalDirectory = (Get-Location).Path
$previousBrowsers = [Environment]::GetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", "Process")
$previousOutput = [Environment]::GetEnvironmentVariable("I436B_OUTPUT", "Process")
$runStarted = [DateTime]::UtcNow.ToString("o")
function Check-Tool([string]$Name) {
    return [bool](Get-Command -Name $Name -ErrorAction SilentlyContinue)
}
function Invoke-Required([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ("Command failed with exit {0}: {1}" -f $LASTEXITCODE, $Command)
    }
}
function Export-CuratedEvidence {
    param([string]$Root, [string]$SourceDir)
    $curated = Join-Path $Root "evidence-curated"
    $null = New-Item -ItemType Directory -Path $curated -Force
    foreach ($top in @("preflight.json", "outcome.json", "npm-ci.log", "playwright-install.log")) {
        $from = Join-Path $Root $top
        if (Test-Path -LiteralPath $from) {
            Copy-Item -LiteralPath $from -Destination (Join-Path $curated $top)
        }
    }
    if (Test-Path -LiteralPath $SourceDir) {
        $sourcePrefix = [IO.Path]::GetFullPath($SourceDir).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        $allowedNames = @("summary.json", "results.json", "manifest.json", "stage436b-telemetry.json", "timeline.jsonl", "run.log")
        foreach ($file in (Get-ChildItem -LiteralPath $SourceDir -Recurse -File -ErrorAction Stop)) {
            $full = [IO.Path]::GetFullPath($file.FullName)
            if ($full.Contains([IO.Path]::DirectorySeparatorChar + "source" + [IO.Path]::DirectorySeparatorChar)) { continue }
            if ($file.Name -notin $allowedNames -and $file.Extension -notin @(".png", ".log")) { continue }
            $relative = $full.Substring($sourcePrefix.Length)
            $destination = Join-Path (Join-Path $curated "evidence") $relative
            $null = New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force
            Copy-Item -LiteralPath $full -Destination $destination
        }
    }
    $readme = @"
Issue436-C synthetic evidence only.
No local Memo-Nexus user data should be collected.
Inspect all files before uploading anywhere. Logs can contain the Windows username or temporary paths.
Product acceptance is determined by evidence/summary.json, not this wrapper's process exit.
Do not treat a missing trace or a failed command as PASS.
"@
    Set-Content -LiteralPath (Join-Path $curated "README-REVIEW-BEFORE-SHARING.txt") -Encoding UTF8 -Value $readme
    $zip = Join-Path $Root "issue436c-evidence.zip"
    Compress-Archive -Path (Join-Path $curated "*") -DestinationPath $zip -CompressionLevel Optimal
    $checksum = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    [pscustomobject]@{ zip = $zip; sha256 = $checksum; bytes = (Get-Item -LiteralPath $zip).Length } |
        ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $Root "archive-sha256.json") -Encoding UTF8
}
try {
    if ($env:OS -ne "Windows_NT") { throw "This test is permitted only on Windows." }
    if ($Execute -and $ExpectedKitHead -notmatch "^[0-9a-fA-F]{40}$") {
        throw "Execution requires -ExpectedKitHead with an exact 40-character commit SHA."
    }
    $tools = @{}
    foreach ($name in @("git", "node", "npm", "npx", "tar")) { $tools[$name] = Check-Tool $name }
    $availableMemoryMB = $null
    $memoryError = $null
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
        $availableMemoryMB = [math]::Round([double]$os.FreePhysicalMemory / 1024, 0)
    } catch { $memoryError = $_.Exception.Message }
    $freeDiskMB = $null
    try {
        $drive = New-Object System.IO.DriveInfo([IO.Path]::GetPathRoot($OutputRoot))
        $freeDiskMB = [math]::Round($drive.AvailableFreeSpace / 1MB, 0)
    } catch { $freeDiskMB = $null }
    $preflight = [ordered]@{
        schema = "issue436c-windows-local-preflight-v1"
        startedUTC = $runStarted
        kitRefExpected = $ExpectedKitHead
        branch = $branch
        fixedSource = $fixedSource
        platform = $env:OS
        powerShell = $PSVersionTable.PSVersion.ToString()
        toolsPresent = $tools
        availableMemoryMB = $availableMemoryMB
        memoryCounterError = $memoryError
        freeDiskMB = $freeDiskMB
        memoryThresholdMB = $minimumFreeMemoryMB
        diskThresholdMB = $minimumFreeDiskMB
        allowLowMemory = [bool]$AllowLowMemory
        executeRequested = [bool]$Execute
        programScope = "synthetic 127.0.0.1 temporary Playwright contexts"
        noExistingProcessTermination = $true
    }
    $preflight | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $preflightFile -Encoding UTF8
    if (-not $Execute) {
        Write-Output "PRECHECK_ONLY: no cloned repository, npm install, or browser test was executed."
    } else {
        foreach ($name in $tools.Keys) {
            if (-not $tools[$name]) { throw ("Required executable missing: " + $name) }
        }
        if ($null -eq $availableMemoryMB -and -not $AllowLowMemory) {
            throw "Memory metric UNKNOWN. No browser run unless -AllowLowMemory is explicitly specified."
        }
        if ($null -ne $availableMemoryMB -and $availableMemoryMB -lt $minimumFreeMemoryMB -and -not $AllowLowMemory) {
            throw ("Available memory below safety threshold ({0}MB). Do not close or kill other processes automatically. Use -AllowLowMemory only after reviewing risk." -f $availableMemoryMB)
        }
        if ($null -eq $freeDiskMB -or $freeDiskMB -lt $minimumFreeDiskMB) {
            throw "Disk free space unknown or below 2048 MB; browser execution blocked."
        }
        $runState = "PREPARING"
        Invoke-Required "git" @("clone", "--single-branch", "--branch", $branch, "--no-tags", "--", $repoUrl, $repoDir)
        $refSha = ((& git -C $repoDir rev-parse HEAD) | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $refSha -ne $ExpectedKitHead.ToLowerInvariant()) {
            throw "Cloned branch HEAD does not equal the supplied fixed kit HEAD. No test started."
        }
        Invoke-Required "git" @("-C", $repoDir, "merge-base", "--is-ancestor", $stageBBase, "HEAD")
        Invoke-Required "git" @("-C", $repoDir, "cat-file", "-e", ("{0}^{1}" -f $fixedSource, "{commit}"))
        $runState = "DEPENDENCIES"
        Set-Location -LiteralPath $repoDir
        $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $OutputRoot "isolated-browsers"
        & npm ci 2>&1 | Tee-Object -FilePath (Join-Path $OutputRoot "npm-ci.log")
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed: no product acceptance measured." }
        & npx playwright install webkit 2>&1 | Tee-Object -FilePath (Join-Path $OutputRoot "playwright-install.log")
        if ($LASTEXITCODE -ne 0) { throw "Playwright WebKit install failed." }
        $runState = "RUNNING"
        $env:I436B_OUTPUT = $evidenceDir
        & node issue436b-comparison.cjs webkit
        $originalExit = $LASTEXITCODE
        $runState = if ($originalExit -eq 0) { "DIAGNOSTIC_RUN_RECORDED" } else { "DIAGNOSTIC_PARTIAL" }
        # Even on exit 0, the product result is read from evidence/summary.json.
        $diff = (& git -C $repoDir status --porcelain --untracked-files=no | Out-String).Trim()
        if ($diff) { throw "Isolated checked-out tracked sources changed unexpectedly." }
    }
} catch {
    $failure = $_.Exception.Message
    $runState = if ($runState -eq "RUNNING") { "DIAGNOSTIC_PARTIAL" } else { "BLOCKED" }
    Write-Warning $failure
} finally {
    Set-Location -LiteralPath $originalDirectory
    [Environment]::SetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", $previousBrowsers, "Process")
    [Environment]::SetEnvironmentVariable("I436B_OUTPUT", $previousOutput, "Process")
    $outcome = [ordered]@{
        schema = "issue436c-local-outcome-v1"
        startedUTC = $runStarted
        finishedUTC = [DateTime]::UtcNow.ToString("o")
        stageBSourceHead = $stageBBase
        kitHead = $refSha
        state = $runState
        failure = $failure
        originalComparisonExit = $originalExit
        localMachineExecution = [bool]$Execute
        rootCause = "UNKNOWN"
        safetyHold = $true
        notes = "No result should be called PASS unless the original summary and raw acceptance support it."
    }
    $outcome | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outcomeFile -Encoding UTF8
    try { Export-CuratedEvidence -Root $OutputRoot -SourceDir $evidenceDir }
    catch { Write-Warning ("Failed to package evidence: " + $_.Exception.Message) }
    Write-Output ("Stage436C state: " + $runState)
    Write-Output ("Evidence directory: " + $OutputRoot)
    Write-Output ("Outcome: " + $outcomeFile)
}
if ($null -ne $failure) { exit 2 }
if ($runState -eq "DIAGNOSTIC_PARTIAL") { exit 1 }
exit 0
