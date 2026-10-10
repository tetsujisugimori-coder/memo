# Start from the PR worktree with Windows PowerShell 5.1 or PowerShell 7.
# Generates independent 256-bit tokens in process memory. Never prints them.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function New-PreviewToken {
    $taskBytes = New-Object byte[] 32
    $taskRng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $taskRng.GetBytes($taskBytes) } finally { $taskRng.Dispose() }
    return [Convert]::ToBase64String($taskBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}
$taskBrowserToken = New-PreviewToken
$taskAdapterToken = New-PreviewToken
$taskStart = New-Object Diagnostics.ProcessStartInfo
$taskStart.FileName = (Get-Command node -ErrorAction Stop).Source
$taskStart.Arguments = '"' + (Join-Path $PSScriptRoot 'dummy-preview-service.js') + '"'
$taskStart.WorkingDirectory = $PSScriptRoot
$taskStart.UseShellExecute = $false
$taskStart.CreateNoWindow = $true
$taskStart.EnvironmentVariables['MEMO_PREVIEW_BROWSER_TOKEN'] = $taskBrowserToken
$taskStart.EnvironmentVariables['MEMO_PREVIEW_ADAPTER_TOKEN'] = $taskAdapterToken
# The receiver does not need other AI credentials.
foreach ($taskName in @('OPENAI_API_KEY','OPENAI_ADMIN_KEY','CONTROL_PLANE_API_KEY','CODEX_BRIDGE_TOKEN')) { $taskStart.EnvironmentVariables.Remove($taskName) }
$taskProcess = [Diagnostics.Process]::Start($taskStart)
$taskForm = New-Object Windows.Forms.Form
$taskForm.Text = 'Memo-Nexus fixed dummy preview (unsaved)'
$taskForm.ClientSize = New-Object Drawing.Size(620,250)
$taskForm.StartPosition = 'CenterScreen'
$taskForm.Controls.Add((New-Object Windows.Forms.Label -Property @{Text='127.0.0.1:8791 only. Close to stop. Metadata persists; replay identical content after restart.'; Left=16; Top=16; Width=580; Height=24}))
$taskForm.Controls.Add((New-Object Windows.Forms.Label -Property @{Text='Browser token: enter ONLY in the preview dialog'; Left=16; Top=50; Width=580; Height=20}))
$taskBrowserBox = New-Object Windows.Forms.TextBox -Property @{Text=$taskBrowserToken; Left=16; Top=74; Width=580; ReadOnly=$true; UseSystemPasswordChar=$true}
$taskForm.Controls.Add($taskBrowserBox)
$taskForm.Controls.Add((New-Object Windows.Forms.Label -Property @{Text='Adapter token: enter ONLY in the tunnel launcher secure prompt'; Left=16; Top=110; Width=580; Height=20}))
$taskAdapterBox = New-Object Windows.Forms.TextBox -Property @{Text=$taskAdapterToken; Left=16; Top=134; Width=580; ReadOnly=$true; UseSystemPasswordChar=$true}
$taskForm.Controls.Add($taskAdapterBox)
$taskReveal = New-Object Windows.Forms.CheckBox -Property @{Text='Reveal tokens locally (never paste into chat or logs)'; Left=16; Top=174; Width=580; Height=24}
$taskReveal.Add_CheckedChanged({ $taskBrowserBox.UseSystemPasswordChar = -not $taskReveal.Checked; $taskAdapterBox.UseSystemPasswordChar = -not $taskReveal.Checked })
$taskForm.Controls.Add($taskReveal)
$taskForm.Controls.Add((New-Object Windows.Forms.Label -Property @{Text='Select and copy manually only when needed. Clear clipboard after pasting.'; Left=16; Top=210; Width=580; Height=24}))
$taskTimer = New-Object Windows.Forms.Timer -Property @{Interval=500}
$taskTimer.Add_Tick({ if ($taskProcess.HasExited) { $taskTimer.Stop(); [Windows.Forms.MessageBox]::Show('Receiver exited. Check port availability and Node installation. No token is logged.') | Out-Null; $taskForm.Close() } })
try { $taskTimer.Start(); $taskForm.ShowDialog() | Out-Null }
finally {
    $taskTimer.Stop(); $taskTimer.Dispose()
    if (-not $taskProcess.HasExited) { $taskProcess.Kill(); $taskProcess.WaitForExit() }
    $taskProcess.Dispose()
    $taskBrowserBox.Text=''; $taskAdapterBox.Text=''
    $taskBrowserToken=$null; $taskAdapterToken=$null
    $taskForm.Dispose()
}
