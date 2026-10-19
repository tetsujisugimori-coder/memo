# Windows PowerShell 5.1 + Windows Forms. No tokens in argv, URLs or console output.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'memo-nexus-launcher.ps1')
$taskMutex=New-Object Threading.Mutex($false,'Local\MemoNexusWindowsLauncher')
$taskLocked=$false
try { $taskLocked=$taskMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $taskLocked=$true }
if (-not $taskLocked) {
    [void][Windows.Forms.MessageBox]::Show('ランチャーは既に起動しています。既存の画面を確認してください。','Memo-Nexus')
    $taskMutex.Dispose(); return
}
$taskShared=[hashtable]::Synchronized(@{State='停止中'; Receiver='停止中'; OAuth='停止中'; Tunnel='停止中';
    Message='設定を確認して「MCPを起動」を押してください。'; Observation=''; BrowserToken='';
    Validation='未検証'; SettingStatus=@{OAuth='未設定'; Tunnel='未設定'; Id='未設定'; Key='未確認'; Url='未設定'};
    Settings=$null; Key=''; Remember=$false; Diagnostics=$false; Busy=$false; Command=''; Stop=$false; Exit=$false; Done=$false})
try { $taskShared.Settings=Read-LauncherSettings } catch { $taskShared.State='要対応'; $taskShared.Message=Get-LauncherMessage 'settings_invalid' }
if ($taskShared.Settings) { $taskShared.Busy=$true; $taskShared.Command='validate' }
$taskWorker=[PowerShell]::Create()
[void]$taskWorker.AddScript('param($file,$shared) . $file; Invoke-LauncherController $shared').AddArgument((Join-Path $PSScriptRoot 'memo-nexus-launcher.ps1')).AddArgument($taskShared)
$taskAsync=$taskWorker.BeginInvoke()
$taskForm=New-Object Windows.Forms.Form -Property @{Text='Memo-Nexus MCP ランチャー'; Width=800; Height=870; StartPosition='CenterScreen'; MinimumSize=(New-Object Drawing.Size(760,540)); AutoScroll=$true}
$taskForm.Font=New-Object Drawing.Font('Yu Gothic UI',10)
function Add-LauncherButton($Text,$Left,$Width) {
    $button=New-Object Windows.Forms.Button -Property @{Text=$Text; Left=$Left; Top=18; Width=$Width; Height=36}
    $taskForm.Controls.Add($button); return $button
}
$taskStart=Add-LauncherButton 'MCPを起動' 18 135
$taskStop=Add-LauncherButton '停止' 163 100
$taskOpen=Add-LauncherButton 'Memo-Nexusを開く' 273 200
$taskSettingsButton=Add-LauncherButton '設定' 483 100
$taskState=New-Object Windows.Forms.Label -Property @{Left=18; Top=75; Width=700; Height=32}
$taskComponents=New-Object Windows.Forms.Label -Property @{Left=18; Top=115; Width=700; Height=80}
$taskMessage=New-Object Windows.Forms.Label -Property @{Left=18; Top=205; Width=700; Height=80}
$taskDiagnostic=New-Object Windows.Forms.Label -Property @{Left=18; Top=292; Width=700; Height=65}
$taskTokenButton=New-Object Windows.Forms.Button -Property @{Text='Browser tokenをローカルで確認'; Left=18; Top=365; Width=320; Height=34}
$taskSettingsStatus=New-Object Windows.Forms.Label -Property @{Left=18; Top=410; Width=700; Height=115}
$taskGuide=New-Object Windows.Forms.Label -Property @{Left=18; Top=535; Width=700; Height=115}
$taskNext=New-Object Windows.Forms.Label -Property @{Left=18; Top=660; Width=700; Height=80}
$taskWarning=New-Object Windows.Forms.Label -Property @{Text='履歴：%LOCALAPPDATA%\Memo-Nexus\received-history。受信 → 未保存プレビュー → 人の確認 → 手動保存。再起動後は同じ原文の再送が必要になる場合があります。画面を閉じると配下サービスを停止します。'; Left=18; Top=750; Width=700; Height=65}
foreach ($control in @($taskState,$taskComponents,$taskMessage,$taskDiagnostic,$taskTokenButton,$taskSettingsStatus,$taskGuide,$taskNext,$taskWarning)) { $taskForm.Controls.Add($control) }
$script:taskLayoutBusy=$false
function Update-LauncherLabelWidths {
    if ($script:taskLayoutBusy) { return }
    $script:taskLayoutBusy=$true
    try {
        # Reserve both margins within the actual viewport, including when Windows
        # limits a scaled window to the desktop size. Keep the original width cap.
        $scale=$taskTokenButton.Height/34.0
        $width=[Math]::Max(1,[Math]::Min([int](700*$scale),$taskForm.ClientSize.Width-[int](36*$scale)))
        foreach ($label in @($taskState,$taskComponents,$taskMessage,$taskDiagnostic,$taskSettingsStatus,$taskGuide,$taskNext,$taskWarning)) {
            if ($label.Width -ne $width) { $label.Width=$width }
        }
    } finally { $script:taskLayoutBusy=$false }
}
$taskForm.Add_Layout({ Update-LauncherLabelWidths })
Update-LauncherLabelWidths

function Show-LauncherSettings {
    $dialog=New-Object Windows.Forms.Form -Property @{Text='Memo-Nexus 初回設定'; Width=720; Height=550; StartPosition='CenterParent'; FormBorderStyle='FixedDialog'; MaximizeBox=$false; MinimizeBox=$false}
    $dialog.Font=$taskForm.Font
    $boxes=@{}; $settings=$taskShared.Settings
    $rows=@(@('configPath','OAuth設定（Git checkout外）'),@('tunnelPath','tunnel-client.exe（検証済み固定build）'),@('tunnelId','既存Tunnel ID'),@('memoUrl','既存Memo-Nexus URL（Originを維持）'),@('key','既存runtime key（非表示）'))
    $y=16
    foreach ($row in $rows) {
        $label=New-Object Windows.Forms.Label -Property @{Text=$row[1]; Left=16; Top=$y; Width=650; Height=22}
        $box=New-Object Windows.Forms.TextBox -Property @{Left=16; Top=($y+25); Width=570; Height=26}
        if ($row[0] -eq 'key') { $box.UseSystemPasswordChar=$true; $box.Text=$taskShared.Key }
        elseif ($settings) { $box.Text=[string]$settings.($row[0]) }
        if ($row[0] -in @('configPath','tunnelPath')) {
            $browse=New-Object Windows.Forms.Button -Property @{Text='選択'; Left=600; Top=($y+23); Width=80; Height=28; Tag=$box}
            $browse.Add_Click({
                $picker=New-Object Windows.Forms.OpenFileDialog
                try { if ($picker.ShowDialog($dialog) -eq 'OK') { $this.Tag.Text=$picker.FileName } } finally { $picker.Dispose() }
            }); $dialog.Controls.Add($browse)
        }
        $boxes[$row[0]]=$box; $dialog.Controls.Add($label); $dialog.Controls.Add($box); $y+=67
    }
    $remember=New-Object Windows.Forms.CheckBox -Property @{Text='runtime keyをDPAPI（現在ユーザー）で保持する'; Left=16; Top=355; Width=650; Height=26}
    if ($settings) { $remember.Checked=[bool]$settings.keyFile }
    $diagnostics=New-Object Windows.Forms.CheckBox -Property @{Text='安全な診断をONにする（通常OFF・次回起動から適用）'; Left=16; Top=385; Width=650; Height=26}
    if ($settings) { $diagnostics.Checked=[bool]$settings.diagnostics }
    $hint=New-Object Windows.Forms.Label -Property @{Text='保存時に検証します。保持済みkeyを使う場合は空欄で保存できます。復号できない場合は明示的に再入力してください。認証登録は作成・変更しません。'; Left=16; Top=419; Width=650; Height=45}
    $save=New-Object Windows.Forms.Button -Property @{Text='検証して保存'; Left=16; Top=470; Width=160; Height=30}
    $save.Add_Click({
        $taskShared.Settings=[pscustomobject]@{version=1; configPath=$boxes.configPath.Text; tunnelPath=$boxes.tunnelPath.Text;
            tunnelId=$boxes.tunnelId.Text; memoUrl=$boxes.memoUrl.Text; diagnostics=$diagnostics.Checked; keyFile=$(if ($settings) { $settings.keyFile } else { '' })}
        $taskShared.Key=$boxes.key.Text; $taskShared.Remember=$remember.Checked
        $taskShared.Busy=$true; $taskShared.Command='save'; $dialog.Close()
    })
    foreach ($control in @($remember,$diagnostics,$hint,$save)) { $dialog.Controls.Add($control) }
    try { [void]$dialog.ShowDialog($taskForm) } finally { $boxes.key.Text=''; $dialog.Dispose() }
}
$taskSettingsButton.Add_Click({ if (-not $taskShared.Busy) { Show-LauncherSettings } })
$taskStart.Add_Click({
    if ($taskShared.Busy -or $taskShared.State -in @('起動中','ローカル準備完了','停止処理中')) { return }
    $taskShared.Busy=$true; $taskShared.Message='起動前検査中です。'; $taskShared.Command='start'
})
$taskStop.Add_Click({ $taskShared.Stop=$true; $taskShared.Busy=$true })
$taskOpen.Add_Click({
    # Run URL validation and availability check off the UI thread in a short-lived runspace.
    if ($taskShared.Busy -or -not $taskShared.Settings) { return }
    $taskShared.Busy=$true; $taskShared.Command='open'
})
$taskTokenButton.Add_Click({
    if (-not $taskShared.BrowserToken) { return }
    $dialog=New-Object Windows.Forms.Form -Property @{Text='Browser token（ローカルのみ）'; Width=670; Height=220; StartPosition='CenterParent'}
    $label=New-Object Windows.Forms.Label -Property @{Text='既存の受信画面だけに入力してください。チャット・ログへ貼り付けないでください。'; Left=16; Top=16; Width=620; Height=42}
    $box=New-Object Windows.Forms.TextBox -Property @{Text=$taskShared.BrowserToken; ReadOnly=$true; UseSystemPasswordChar=$true; Left=16; Top=66; Width=620}
    $reveal=New-Object Windows.Forms.CheckBox -Property @{Text='この画面で表示する（選択して手動コピー）'; Left=16; Top=105; Width=620; Height=26}
    $reveal.Add_CheckedChanged({ $box.UseSystemPasswordChar=-not $reveal.Checked })
    foreach ($control in @($label,$box,$reveal)) { $dialog.Controls.Add($control) }
    try { [void]$dialog.ShowDialog($taskForm) } finally { $box.Text=''; $dialog.Dispose() }
})
$taskClosing=$false
$taskForm.Add_FormClosing({
    if (-not $taskShared.Done) { $_.Cancel=$true; $script:taskClosing=$true; $taskShared.Stop=$true; $taskShared.Busy=$true }
})
$taskTimer=New-Object Windows.Forms.Timer -Property @{Interval=200}
$taskTimer.Add_Tick({
    $guide=Get-LauncherGuide $taskShared
    $taskGuide.Text=$guide.Steps
    $taskNext.Text='次の操作：'+$guide.Next
    $status=$taskShared.SettingStatus
    $taskSettingsStatus.Text='保存済み設定（値は表示しません）'+"`r`nOAuth設定："+$status.OAuth+" ／ Tunnel実行ファイル："+$status.Tunnel+"`r`nTunnel ID："+$status.Id+"`r`nruntime key："+$status.Key+"`r`nMemo-Nexus URL："+$status.Url
    $taskState.Text='状態：'+$taskShared.State
    $taskComponents.Text='8791 受信サービス：'+$taskShared.Receiver+"`r`n8792 OAuth入口："+$taskShared.OAuth+"`r`nSecure MCP Tunnel："+$taskShared.Tunnel
    $taskMessage.Text=$taskShared.Message
    $taskDiagnostic.Text=$(if ($taskShared.Diagnostics) { '診断ON（今回の起動内の直近観測・配送／接続成功の証明ではありません）' + "`r`n" + $taskShared.Observation } else { '診断OFF。認証・initialize・tools/listは未観測です。' })
    $taskStart.Enabled=-not $taskShared.Busy -and $taskShared.State -notin @('起動中','ローカル準備完了','停止処理中')
    $taskSettingsButton.Enabled=-not $taskShared.Busy -and $taskShared.State -notin @('起動中','ローカル準備完了','停止処理中')
    $taskOpen.Enabled=-not $taskShared.Busy; $taskTokenButton.Enabled=[bool]$taskShared.BrowserToken
    if ($taskClosing -and $taskShared.State -eq '停止中' -and -not $taskShared.Busy) { $taskShared.Exit=$true }
    if ($taskShared.Done -and $taskClosing) { $taskForm.Close() }
})
try { $taskTimer.Start(); [void]$taskForm.ShowDialog() }
finally {
    $taskShared.Exit=$true
    # Normal close waits in the responsive UI for the controller's cleanup.
    if ($taskAsync.IsCompleted) { try { [void]$taskWorker.EndInvoke($taskAsync) } catch { } }
    $taskTimer.Stop(); $taskTimer.Dispose(); $taskForm.Dispose(); $taskWorker.Dispose()
    if ($taskLocked) { $taskMutex.ReleaseMutex() }; $taskMutex.Dispose()
}
