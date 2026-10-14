# OAuth discovery only. No receiver or tunnel is started here.
param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$taskConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$taskNode = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$taskInfo = New-Object System.Diagnostics.ProcessStartInfo
$taskInfo.FileName = $taskNode
$taskInfo.Arguments = '"' + (Join-Path $PSScriptRoot 'mcp-http-discovery.js') + '" "' + $taskConfig + '"'
$taskInfo.UseShellExecute = $false
$taskInfo.CreateNoWindow = $true
$taskInfo.RedirectStandardOutput = $true
$taskInfo.RedirectStandardError = $true
# Do not pass runtime keys, preview tokens, OAuth tokens or proxy credentials to Node.
$taskInfo.EnvironmentVariables.Clear()
foreach ($taskName in @('SystemRoot','WINDIR','TEMP','TMP','Path','PATHEXT')) {
    $taskValue = [Environment]::GetEnvironmentVariable($taskName)
    if ($null -ne $taskValue) { $taskInfo.EnvironmentVariables[$taskName] = $taskValue }
}
$taskChild = New-Object System.Diagnostics.Process
$taskChild.StartInfo = $taskInfo
$taskStarted = $false
try {
    [void]$taskChild.Start()
    $taskStarted = $true
    Write-Output ('Discovery child PID: ' + $taskChild.Id + '; stop with Ctrl+C in this terminal')
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
    if ($taskChild.ExitCode -ne 0) { throw 'Discovery process failed; inspect the fixed diagnostic above.' }
} finally {
    # This object identifies ONLY the child created by this invocation.
    if ($taskStarted -and -not $taskChild.HasExited) { $taskChild.Kill(); $taskChild.WaitForExit() }
    $taskChild.Dispose()
}
