# Run manually after stopping the old client in its own terminal.
param([Parameter(Mandatory=$true)][string]$TunnelClientPath,
      [Parameter(Mandatory=$true)][string]$ConfigPath,
      [switch]$Authenticated)
$ErrorActionPreference = 'Stop'
$taskBinary = (Resolve-Path -LiteralPath $TunnelClientPath).Path
try { $taskConfig = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json }
catch { throw 'Unable to read discovery configuration JSON' }
if ($Authenticated) {
    if ($taskConfig.mode -cne 'authenticated' -or -not $taskConfig.allowedSubjects -or -not $taskConfig.audience -or -not $taskConfig.resource_metadata) { throw 'Explicit authenticated configuration required' }
} elseif ($taskConfig.mode) { throw 'Authenticated configuration requires -Authenticated; do not silently change mode' }
if ($taskConfig.port -isnot [int] -and $taskConfig.port -isnot [long]) { throw 'Invalid local port' }
if ($taskConfig.port -lt 1024 -or $taskConfig.port -gt 65535 -or $taskConfig.port -in @(5500,8787,8791)) { throw 'Invalid local port' }
if (-not $env:CONTROL_PLANE_API_KEY -or -not $env:CONTROL_PLANE_TUNNEL_ID) { throw 'Existing runtime key and tunnel ID required in process environment' }
# Conservative guard: never start while ANY known tunnel-client process exists.
if (Get-Process -Name 'tunnel-client*' -ErrorAction SilentlyContinue) { throw 'A tunnel-client is already running; inspect it manually and stop the intended client in its own terminal first' }
$taskHasher = [Security.Cryptography.SHA256]::Create()
try { $taskLockId = [BitConverter]::ToString($taskHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($env:CONTROL_PLANE_TUNNEL_ID))).Replace('-','') }
finally { $taskHasher.Dispose() }
$taskMutex = New-Object Threading.Mutex($false, ('Local\MemoNexusHttpTunnel-' + $taskLockId))
$taskLocked = $false
try {
try { $taskLocked = $taskMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $taskLocked = $true }
if (-not $taskLocked) { throw 'This Tunnel ID already has a launcher running' }
$taskVersion = & $taskBinary --version 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $taskVersion -notmatch '^0\.0\.16\+5f99daabd4aa4a77049e6d81d54a0d8c18335397\b') { throw 'This launcher requires the verified tunnel-client 0.0.16 build; review help and retest before upgrading' }
if ($Authenticated) { Write-Output 'Verified tunnel-client 0.0.16; authenticated receive only; manual browser save required' }
else { Write-Output 'Verified tunnel-client 0.0.16; OAuth discovery only; all MCP operations disabled' }
$taskHelp = & $taskBinary run --help 2>&1 | Out-String
foreach ($taskFlag in @('--mcp.server-url','--mcp.oauth-trusted-origin','--log.http-raw-unsafe')) {
    if (-not $taskHelp.Contains($taskFlag)) { throw 'Required HTTP options unavailable; do not fall back to stdio or no-auth' }
}
$taskUrl = 'http://127.0.0.1:' + $taskConfig.port + '/mcp'
$taskIssuer = [Uri]($taskConfig.authorization_servers | Select-Object -First 1)
if ($taskIssuer.Scheme -ne 'https' -or $taskIssuer.AbsolutePath -ne '/' -or $taskIssuer.Query -or $taskIssuer.Fragment -or $taskIssuer.UserInfo -or $taskIssuer.AbsoluteUri -notmatch '^https://[A-Za-z0-9.-]+(:[0-9]+)?/$') { throw 'Invalid explicit issuer' }
$taskTrustedOrigin = $taskIssuer.GetLeftPart([UriPartial]::Authority)
# Require matching metadata and an unauthenticated 401 before starting the tunnel.
$taskProbe = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $taskConfig.port + '/.well-known/oauth-protected-resource/mcp') -MaximumRedirection 0
$taskMetadata = $taskProbe.Content | ConvertFrom-Json
if ($taskMetadata.resource -cne $taskConfig.resource -or
    ($taskMetadata.authorization_servers -join ' ') -cne ($taskConfig.authorization_servers -join ' ') -or
    ($taskMetadata.scopes_supported -join ' ') -cne ($taskConfig.scopes_supported -join ' ')) { throw 'Local metadata does not match explicit configuration' }
try { Invoke-WebRequest -UseBasicParsing -Uri $taskUrl -MaximumRedirection 0 | Out-Null; throw 'Expected discovery-only HTTP 401' }
catch {
    if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 401 -or
        -not $_.Exception.Response.Headers['WWW-Authenticate'].Contains('resource_metadata=')) { throw 'Expected discovery-only HTTP 401 with resource_metadata' }
}
$taskInfo = New-Object System.Diagnostics.ProcessStartInfo
$taskInfo.FileName = $taskBinary
$taskInfo.Arguments = 'run --mcp.server-url ' + $taskUrl + ' --mcp.oauth-trusted-origin ' + $taskTrustedOrigin + ' --harpoon.allow-plaintext-http --health.listen-addr 127.0.0.1:0 --mcp.max-concurrent-requests 1 --log.format struct-text --log.level warn --log.http-raw-unsafe=false'
$taskInfo.UseShellExecute = $false
$taskInfo.CreateNoWindow = $true
$taskInfo.RedirectStandardOutput = $true
$taskInfo.RedirectStandardError = $true
# Ignore inherited MCP commands, static headers, unsafe logging and profile overrides.
$taskInfo.EnvironmentVariables.Clear()
foreach ($taskName in @('SystemRoot','WINDIR','TEMP','TMP','Path','PATHEXT','CONTROL_PLANE_API_KEY','CONTROL_PLANE_TUNNEL_ID')) {
    $taskValue = [Environment]::GetEnvironmentVariable($taskName)
    if ($null -ne $taskValue) { $taskInfo.EnvironmentVariables[$taskName] = $taskValue }
}
$taskChild = New-Object System.Diagnostics.Process
$taskChild.StartInfo = $taskInfo
$taskStarted = $false
try {
    [void]$taskChild.Start()
    $taskStarted = $true
    Write-Output ('Tunnel child PID: ' + $taskChild.Id + '; stop with Ctrl+C in this terminal')
    $taskOut = $taskChild.StandardOutput.ReadLineAsync()
    $taskErr = $taskChild.StandardError.ReadLineAsync()
    while ($null -ne $taskOut -or $null -ne $taskErr -or -not $taskChild.HasExited) {
        if ($null -ne $taskOut -and $taskOut.IsCompleted) {
            if ($null -eq $taskOut.Result) { $taskOut = $null }
            else { Write-Output $taskOut.Result; $taskOut = $taskChild.StandardOutput.ReadLineAsync() }
        }
        if ($null -ne $taskErr -and $taskErr.IsCompleted) {
            if ($null -eq $taskErr.Result) { $taskErr = $null }
            else { Write-Output $taskErr.Result; $taskErr = $taskChild.StandardError.ReadLineAsync() }
        }
        Start-Sleep -Milliseconds 100
    }
    if ($taskChild.ExitCode -ne 0) { throw 'Tunnel exited unsuccessfully; do not expose keys or raw HTTP logs' }
} finally {
    if ($taskStarted -and -not $taskChild.HasExited) { $taskChild.Kill(); $taskChild.WaitForExit() }
    $taskChild.Dispose()
}
} finally {
    if ($taskLocked) { $taskMutex.ReleaseMutex() }
    $taskMutex.Dispose()
}
