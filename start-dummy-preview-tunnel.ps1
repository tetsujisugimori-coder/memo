# Run in a separate terminal with the EXISTING runtime key and tunnel ID already
# provisioned securely. This script does not create keys or modify tunnel settings.
param([Parameter(Mandatory=$true)][string]$TunnelClientPath)
$ErrorActionPreference = 'Stop'
if (-not $env:CONTROL_PLANE_API_KEY -or -not $env:CONTROL_PLANE_TUNNEL_ID) { throw 'Existing CONTROL_PLANE_API_KEY and CONTROL_PLANE_TUNNEL_ID are required; never paste secrets into chat.' }
if ($env:MEMO_PREVIEW_ADAPTER_TOKEN) { throw 'Use a fresh terminal without a preview adapter token.' }
$taskSecure = Read-Host 'Adapter token from the local preview window (hidden)' -AsSecureString
$taskPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecure)
try { $env:MEMO_PREVIEW_ADAPTER_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPtr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPtr); $taskSecure.Dispose() }
try {
    if ($env:MEMO_PREVIEW_ADAPTER_TOKEN -notmatch '^[A-Za-z0-9_-]{43,128}$') { throw 'Invalid adapter token format' }
    $taskNode = (Get-Command node -ErrorAction Stop).Source
    $taskAdapter = Join-Path $PSScriptRoot 'dummy-preview-mcp.js'
    $taskCommand = '"' + $taskNode + '" "' + $taskAdapter + '"'
    & $TunnelClientPath run --mcp.command $taskCommand --mcp.max-concurrent-requests 1 --mcp.stdio-send-initialized-notification --log.level warn
    if ($LASTEXITCODE -ne 0) { throw 'Tunnel client exited unsuccessfully; keep the first error for review without exposing secrets.' }
}
finally { Remove-Item Env:MEMO_PREVIEW_ADAPTER_TOKEN -ErrorAction SilentlyContinue }
