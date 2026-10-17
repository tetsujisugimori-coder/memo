# Process controller; no Windows Forms dependency. Loaded in a dedicated runspace.
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
if (-not ('MemoNexusTcpOwner' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MemoNexusTcpOwner {
    [DllImport("iphlpapi.dll", SetLastError=true)]
    private static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int family, int tableClass, uint reserved);
    public static int LoopbackListener(int port) {
        int size=0;
        uint result=GetExtendedTcpTable(IntPtr.Zero,ref size,false,2,3,0);
        if(result!=122 || size<4) throw new InvalidOperationException("tcp_table");
        IntPtr buffer=Marshal.AllocHGlobal(size);
        try {
            if(GetExtendedTcpTable(buffer,ref size,false,2,3,0)!=0) throw new InvalidOperationException("tcp_table");
            int count=Marshal.ReadInt32(buffer), owner=-1;
            for(int i=0;i<count;i++) {
                IntPtr row=IntPtr.Add(buffer,4+i*24);
                if(Marshal.ReadInt32(row,4)==0x0100007f && Marshal.ReadByte(row,8)*256+Marshal.ReadByte(row,9)==port) {
                    if(owner!=-1) return -1;
                    owner=Marshal.ReadInt32(row,20);
                }
            }
            return owner;
        } finally { Marshal.FreeHGlobal(buffer); }
    }
}
'@
}

function New-LauncherToken {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}
function Get-LauncherDirectory { Join-Path $env:LOCALAPPDATA 'Memo-Nexus\launcher' }
function Read-LauncherSettings {
    $file = Join-Path (Get-LauncherDirectory) 'settings.json'
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    try {
        $settings = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($settings.version -ne 1 -or $settings.keyFile -notmatch '^(key-[a-f0-9]{32}\.dpapi)?$') { throw 'settings' }
        return $settings
    } catch { throw 'settings_invalid' }
}
function Read-LauncherKey($Settings) {
    if (-not $Settings.keyFile) { return '' }
    try {
        $bytes = [IO.File]::ReadAllBytes((Join-Path (Get-LauncherDirectory) $Settings.keyFile))
        $plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        try { return [Text.Encoding]::UTF8.GetString($plain) } finally { [Array]::Clear($plain,0,$plain.Length) }
    } catch { throw 'key_unavailable' }
}
function Save-LauncherSettings($Settings, [string]$Key, [bool]$Remember) {
    $directory = Get-LauncherDirectory
    [void][IO.Directory]::CreateDirectory($directory)
    $directoryInfo=New-Object IO.DirectoryInfo($directory)
    $acl = $directoryInfo.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($existing in $acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier])) { [void]$acl.RemoveAccessRuleSpecific($existing) }
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule); $directoryInfo.SetAccessControl($acl)
    $keyFile = ''
    if ($Remember) {
        $keyFile = 'key-' + [Guid]::NewGuid().ToString('N') + '.dpapi'
        $plain = [Text.Encoding]::UTF8.GetBytes($Key)
        try { $protected = [Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser) }
        finally { [Array]::Clear($plain,0,$plain.Length) }
        [IO.File]::WriteAllBytes((Join-Path $directory $keyFile),$protected)
    }
    # Commit settings last. A failed write never replaces the previous key reference.
    $value = @{version=1; configPath=$Settings.configPath; tunnelPath=$Settings.tunnelPath; tunnelId=$Settings.tunnelId;
        memoUrl=$Settings.memoUrl; diagnostics=[bool]$Settings.diagnostics; keyFile=$keyFile}
    $target = Join-Path $directory 'settings.json'
    $temporary = Join-Path $directory ('settings-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($temporary,($value | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $target) { [IO.File]::Replace($temporary,$target,(Join-Path $directory 'settings.previous.json')) }
    else { [IO.File]::Move($temporary,$target) }
}
function New-LauncherProcess([string]$Executable, [string[]]$Arguments, [hashtable]$Environment, [string]$Role) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    # Every argument is an explicit Windows argv item, including paths with spaces and apostrophes.
    $info.Arguments = (($Arguments | ForEach-Object {
        if ($_ -match '[\r\n\x00]') { throw 'invalid_argument' }
        '"' + ([regex]::Replace([regex]::Replace($_,'(\\*)"','$1$1\"'),'(\\+)$','$1$1')) + '"'
    }) -join ' ')
    $info.WorkingDirectory = $PSScriptRoot
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.RedirectStandardInput=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $info.EnvironmentVariables.Clear()
    foreach ($name in @('SystemRoot','WINDIR','TEMP','TMP','Path','PATHEXT')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $info.EnvironmentVariables[$name]=$value }
    }
    foreach ($name in $Environment.Keys) { $info.EnvironmentVariables[$name]=[string]$Environment[$name] }
    $process = New-Object Diagnostics.Process
    $process.StartInfo=$info
    [void]$process.Start()
    # Retain the kernel handle now: never reacquire a process by a persisted PID.
    $handle = $process.Handle
    @{Process=$process; Handle=$handle; Role=$Role; Out=$process.StandardOutput.ReadLineAsync(); Err=$process.StandardError.ReadLineAsync(); Last=''; Bearer=@{}}
}
function Update-LauncherObservation([string]$Line,$Child,$Shared) {
    if (-not $Shared.Diagnostics -or $Child.Role -ne 'OAuth') { return }
    try {
        $event=$Line | ConvertFrom-Json
        if ($event.diagnostic -ne 'memo_http_oauth') { return }
        if ($event.event -eq 'request_received') {
            if ($Child.Bearer.Count -ge 256) { $Child.Bearer.Clear() }
            $Child.Bearer[$event.sequence]=($event.bearerPresent -eq $true)
        }
        $summary=''
        if ($event.event -eq 'authentication' -and $event.status -eq 'accepted') { $summary='認証の受理を観測' }
        elseif ($event.event -eq 'authentication' -and $event.status -eq 'rejected' -and $Child.Bearer[$event.sequence]) {
            $summary='Bearer付き要求の認証拒否を観測。OAuth設定と利用者・scopeを確認してください'
        } elseif ($event.event -eq 'protocol_result' -and $event.success -eq $true -and $event.status -eq 200) {
            if ($event.stage -eq 'initialize') { $summary='initializeの応答生成を観測' }
            elseif ($event.stage -eq 'tools_list' -and $event.toolCount -eq 2 -and $event.expectedTools -eq $true) {
                $summary='想定2ツールの一覧応答生成を観測。ChatGPT側の表示を確認してください'
            }
        }
        if ($summary) { $Shared.Observation=[DateTime]::Now.ToString('HH:mm:ss') + ' ' + $summary }
        if ($event.event -in @('response','response_aborted')) { $Child.Bearer.Remove($event.sequence) }
    } catch { }
}
function Receive-LauncherOutput($Child, $Shared) {
    foreach ($stream in @('Out','Err')) {
        for ($n=0; $n -lt 40 -and $null -ne $Child[$stream] -and $Child[$stream].IsCompleted; $n++) {
            $line = $Child[$stream].GetAwaiter().GetResult()
            if ($null -eq $line) { $Child[$stream]=$null; break }
            if ($line -in @('history_corrupt','history_locked','history_permissions','history_write_failed','history_full','history_capacity')) { $Child.Last=$line }
            # Only fixed summaries from this run; no raw child text reaches the UI or disk.
            Update-LauncherObservation $line $Child $Shared
            if ($stream -eq 'Out') { $Child.Out=$Child.Process.StandardOutput.ReadLineAsync() }
            else { $Child.Err=$Child.Process.StandardError.ReadLineAsync() }
        }
    }
}
function Stop-LauncherChildren($Children,$Shared) {
    $Shared.State='停止処理中'
    $failed=$false
    for ($index=$Children.Count-1; $index -ge 0; $index--) {
        $child=$Children[$index]; $p=$child.Process
        try {
            if (-not $p.HasExited) {
                if ($child.Role -ne 'Tunnel') { try { $p.StandardInput.WriteLine('stop'); $p.StandardInput.Close() } catch { } }
                else { $p.Kill() }
                if (-not $p.WaitForExit(3000)) { $p.Kill(); if (-not $p.WaitForExit(2000)) { throw 'stop_timeout' } }
            }
            $Shared[$child.Role]='停止中'; $p.Dispose(); $Children.RemoveAt($index)
        } catch { $failed=$true; $Shared[$child.Role]='要対応' }
    }
    if ($failed) { throw 'stop_failed' }
    $Shared.BrowserToken=''; $Shared.Observation=''; $Shared.State='停止中'
}
function Invoke-LauncherRequest([string]$Url,[hashtable]$Headers=@{}) {
    $request=[Net.HttpWebRequest]::Create($Url)
    $request.Proxy=$null; $request.AllowAutoRedirect=$false; $request.Timeout=1500; $request.ReadWriteTimeout=1500
    foreach ($name in $Headers.Keys) { $request.Headers[$name]=$Headers[$name] }
    $response=$null
    try {
        try { $response=$request.GetResponse() }
        catch [Net.WebException] { if ($_.Exception.Response) { $response=$_.Exception.Response } else { throw 'probe_unavailable' } }
        $reader=New-Object IO.StreamReader($response.GetResponseStream())
        try { $text=$reader.ReadToEnd(); if ($text.Length -gt 262144) { throw 'probe_size' } }
        finally { $reader.Dispose() }
        @{Status=[int]$response.StatusCode; Text=$text; Authenticate=[string]$response.Headers['WWW-Authenticate']}
    } finally { if ($response) { $response.Close() } }
}
function Test-LauncherPort([int]$Port) {
    # Includes wildcard and IPv6 listeners; never stop or adopt them.
    @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object { $_.Port -eq $Port }).Count -gt 0
}
function Wait-LauncherReady($Child,$Shared,[scriptblock]$Probe,[int]$TimeoutSeconds=25) {
    $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        Receive-LauncherOutput $Child $Shared
        if ($Shared.Stop -or $Shared.Exit) { throw 'cancelled' }
        if ($Child.Process.HasExited) { if ($Child.Last) { throw $Child.Last }; throw 'child_exited' }
        try { if (& $Probe) { return } } catch { }
        Start-Sleep -Milliseconds 150
    }
    throw 'readiness_timeout'
}
function Invoke-LauncherCapture($Node,[string[]]$Arguments) {
    $child=New-LauncherProcess $Node $Arguments @{} 'Check'
    $deadline=[DateTime]::UtcNow.AddSeconds(12); $output=''
    try {
        while (-not $child.Process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
            foreach ($stream in @('Out','Err')) {
                if ($null -ne $child[$stream] -and $child[$stream].IsCompleted) {
                    $line=$child[$stream].GetAwaiter().GetResult()
                    if ($null -eq $line) { $child[$stream]=$null }
                    else {
                        if ($output.Length -lt 65536) { $output += $line + "`n" }
                        if ($stream -eq 'Out') { $child.Out=$child.Process.StandardOutput.ReadLineAsync() } else { $child.Err=$child.Process.StandardError.ReadLineAsync() }
                    }
                }
            }
            Start-Sleep -Milliseconds 30
        }
        if (-not $child.Process.HasExited) { throw 'validation_timeout' }
        # --version/help output may still be buffered after process exit.
        foreach ($stream in @('Out','Err')) {
            if ($null -ne $child[$stream]) { $output += $child[$stream].GetAwaiter().GetResult() }
        }
        $output += $child.Process.StandardOutput.ReadToEnd() + $child.Process.StandardError.ReadToEnd()
        if ($child.Process.ExitCode -ne 0) { throw 'validation_failed' }
        return $output
    } finally { if (-not $child.Process.HasExited) { $child.Process.Kill(); [void]$child.Process.WaitForExit(2000) }; $child.Process.Dispose() }
}
function Test-LauncherSettings($Settings,[string]$Key) {
    if (-not $Settings -or [string]::IsNullOrWhiteSpace($Key) -or $Key -match '[\r\n\x00]' -or $Settings.tunnelId -notmatch '^tunnel_[a-zA-Z0-9_-]+$') { throw 'settings_invalid' }
    $node=(Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    [void](Invoke-LauncherCapture $node @((Join-Path $PSScriptRoot 'memo-nexus-launcher-check.js'),'validate',$Settings.configPath,$Settings.memoUrl))
    $binary=(Resolve-Path -LiteralPath $Settings.tunnelPath).Path
    if ([IO.Path]::GetExtension($binary) -ine '.exe') { throw 'binary_invalid' }
    $version=Invoke-LauncherCapture $binary @('--version')
    if ($version -notmatch '^0\.0\.16\+5f99daabd4aa4a77049e6d81d54a0d8c18335397\b') { throw 'binary_version' }
    $help=Invoke-LauncherCapture $binary @('run','--help')
    foreach ($flag in @('--mcp.server-url','--mcp.oauth-trusted-origin','--log.http-raw-unsafe','--health.listen-addr')) {
        if (-not $help.Contains($flag)) { throw 'binary_options' }
    }
    return $node
}
function Get-LauncherMessage([string]$Code) {
    switch ($Code) {
        'port_conflict' { '8791または8792が使用中です。手動起動元を確認してください。既存プロセスは停止しません。' }
        'tunnel_conflict' { '既存Tunnelがあります。起動元と用途を確認してください。停止・引継ぎは行いません。' }
        'history_override' { '別の受信履歴ディレクトリが環境に指定されています。履歴を切り替えず起動を中止しました。この初回版では従来の起動方法を継続してください。' }
        'key_unavailable' { 'runtime keyを復号できません。設定から明示的に再入力してください。設定は保持しました。' }
        'cancelled' { '起動を中止しました。今回起動したプロセスだけを停止しました。' }
        'readiness_timeout' { '準備確認が時間内に完了しません。設定・通信・実行ファイルを確認してください。' }
        'child_exited' { '子プロセスが終了しました。設定・通信・依存関係を確認してください。自動再起動はしません。' }
        'stop_failed' { '停止を確認できません。再度「停止」を押してください。画面終了は保留しています。' }
        'static_unavailable' { '設定済みのローカル静的配信サーバーを確認してください。ランチャーから開発サーバーは起動しません。' }
        { $_ -in @('history_corrupt','history_locked','history_permissions','history_write_failed','history_full','history_capacity') } { '受信履歴を利用できません。別の受信サービス・履歴のロック／破損／容量／権限を確認してください。履歴を削除・変更せず停止しました。' }
        default { '設定または起動前検査に問題があります。Node 22以上・npm ci・リポジトリ外OAuth設定・固定build・入力内容を設定画面で確認してください。設定は初期化しません。' }
    }
}
function Invoke-LauncherController($Shared) {
    $children=New-Object Collections.ArrayList
    $tunnelMutex=$null; $locked=$false
    try {
        while (-not $Shared.Exit) {
            if ($Shared.Stop) {
                try { Stop-LauncherChildren $children $Shared }
                catch { $Shared.State='要対応'; $Shared.Message=Get-LauncherMessage 'stop_failed'; $Shared.Stop=$false; $Shared.Busy=$false; continue }
                if ($locked) { $tunnelMutex.ReleaseMutex(); $locked=$false; $tunnelMutex.Dispose(); $tunnelMutex=$null }
                $Shared.Stop=$false; $Shared.Busy=$false
                $Shared.Message='停止しました。未保存本文は再送が必要になる場合があります。履歴・ブラウザ保存領域は保持しています。'
            }
            if ($Shared.Command) {
                $command=$Shared.Command; $Shared.Command=''
                if ($command -eq 'start' -and $children.Count -gt 0) {
                    $Shared.Message='今回のプロセスが残っています。起動の重複は行いません。必要なら「停止」を押してください。'
                    $Shared.Busy=$false; continue
                }
                try {
                    $settings=$Shared.Settings; $key=$Shared.Key
                    if ($command -eq 'open') {
                        $node=(Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
                        [void](Invoke-LauncherCapture $node @((Join-Path $PSScriptRoot 'memo-nexus-launcher-check.js'),'validate',$settings.configPath,$settings.memoUrl))
                        if (([Uri]$settings.memoUrl).IsLoopback) {
                            if ((Invoke-LauncherRequest $settings.memoUrl).Status -ne 200) { throw 'static_unavailable' }
                        }
                        [void][Diagnostics.Process]::Start($settings.memoUrl)
                        $Shared.Message='設定済みURLを開きました。受信画面で確認後、手動で保存してください。'
                        continue
                    }
                    if (-not $key) { $key=Read-LauncherKey $settings }
                    if ($command -eq 'start') { $Shared.State='起動中' }
                    $Shared.Message='設定・Node依存・Tunnel buildを検査しています。'
                    $node=Test-LauncherSettings $settings $key
                    if ($command -eq 'save') {
                        Save-LauncherSettings $settings $key $Shared.Remember
                        $Shared.Settings=Read-LauncherSettings
                        $Shared.Key=$key
                        $Shared.State='停止中'; $Shared.Message='設定を検証して保存しました。登録・認証方式は変更していません。'
                    } elseif ($command -eq 'start') {
                        $Shared.State='起動中'; $Shared.Observation=''; $Shared.Diagnostics=[bool]$settings.diagnostics
                        if ($env:MEMO_PREVIEW_HISTORY_DIR) { throw 'history_override' }
                        if ((Test-LauncherPort 8791) -or (Test-LauncherPort 8792)) { throw 'port_conflict' }
                        if (Get-Process -Name @('tunnel-client*',[IO.Path]::GetFileNameWithoutExtension($settings.tunnelPath)) -ErrorAction SilentlyContinue) { throw 'tunnel_conflict' }
                        $hash=[Security.Cryptography.SHA256]::Create()
                        try { $id=[BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($settings.tunnelId))).Replace('-','') } finally { $hash.Dispose() }
                        if ($tunnelMutex) { $tunnelMutex.Dispose() }
                        $tunnelMutex=New-Object Threading.Mutex($false,('Local\MemoNexusHttpTunnel-'+$id))
                        try { $locked=$tunnelMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked=$true }
                        if (-not $locked) { throw 'tunnel_conflict' }
                        $adapter=New-LauncherToken; $Shared.BrowserToken=New-LauncherToken
                        $helper=Join-Path $PSScriptRoot 'memo-nexus-launcher-check.js'
                        $receiverEnv=@{MEMO_PREVIEW_ADAPTER_TOKEN=$adapter; MEMO_PREVIEW_BROWSER_TOKEN=$Shared.BrowserToken; LOCALAPPDATA=$env:LOCALAPPDATA}
                        $receiver=New-LauncherProcess $node @($helper,'receiver') $receiverEnv 'Receiver'; [void]$children.Add($receiver)
                        $Shared.Receiver='起動中'
                        $Shared.Message='8791受信サービスと既存履歴の準備を確認しています。'
                        Wait-LauncherReady $receiver $Shared {
                            $probe=Invoke-LauncherRequest 'http://127.0.0.1:8791/pending' @{Origin='http://127.0.0.1:5500'; Authorization=('Bearer '+$Shared.BrowserToken)}
                            $probe.Status -eq 200
                        }
                        $Shared.Receiver='ローカル準備完了'
                        $oauthEnv=@{MEMO_PREVIEW_ADAPTER_TOKEN=$adapter; NODE_USE_SYSTEM_CA='1'}
                        if ($settings.diagnostics) { $oauthEnv.MEMO_MCP_HTTP_DIAGNOSTICS='1' }
                        $oauth=New-LauncherProcess $node @($helper,'oauth',$settings.configPath) $oauthEnv 'OAuth'; [void]$children.Add($oauth)
                        $Shared.OAuth='起動中'
                        $Shared.Message='8792のmetadata一致と未認証401を確認しています。'
                        $config=Get-Content -LiteralPath $settings.configPath -Raw -Encoding UTF8 | ConvertFrom-Json
                        Wait-LauncherReady $oauth $Shared {
                            $metadata=Invoke-LauncherRequest 'http://127.0.0.1:8792/.well-known/oauth-protected-resource/mcp'
                            if ($metadata.Status -ne 200) { return $false }
                            $value=$metadata.Text | ConvertFrom-Json
                            if ($value.resource -cne $config.resource -or ($value.authorization_servers -join ' ') -cne ($config.authorization_servers -join ' ') -or ($value.scopes_supported -join ' ') -cne ($config.scopes_supported -join ' ')) { return $false }
                            $unauthorized=Invoke-LauncherRequest 'http://127.0.0.1:8792/mcp'
                            $unauthorized.Status -eq 401 -and $unauthorized.Authenticate.Contains('resource_metadata=')
                        }
                        $Shared.OAuth='ローカル準備完了'
                        $listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
                        $listener.Start(); $healthPort=$listener.LocalEndpoint.Port; $listener.Stop()
                        $origin=([Uri]$config.authorization_servers[0]).GetLeftPart([UriPartial]::Authority)
                        $args=@('run','--mcp.server-url','http://127.0.0.1:8792/mcp','--mcp.oauth-trusted-origin',$origin,'--harpoon.allow-plaintext-http',
                            '--health.listen-addr',('127.0.0.1:'+$healthPort),'--mcp.max-concurrent-requests','1','--log.format','struct-text','--log.level','warn','--log.http-raw-unsafe=false')
                        $tunnel=New-LauncherProcess $settings.tunnelPath $args @{CONTROL_PLANE_API_KEY=$key; CONTROL_PLANE_TUNNEL_ID=$settings.tunnelId} 'Tunnel'; [void]$children.Add($tunnel)
                        $Shared.Tunnel='起動中'
                        $Shared.Message='Tunnelの所有プロセスとローカルreadyzを確認しています。'
                        Wait-LauncherReady $tunnel $Shared {
                            if ([MemoNexusTcpOwner]::LoopbackListener($healthPort) -ne $tunnel.Process.Id) { return $false }
                            (Invoke-LauncherRequest ('http://127.0.0.1:'+$healthPort+'/readyz')).Status -eq 200
                        } 35
                        $Shared.Tunnel='ローカル準備完了'; $Shared.State='ローカル準備完了'
                        $Shared.Message='ローカル準備完了。ChatGPT接続・保存成功を意味しません。必要ならBrowser tokenを既存の受信画面へ入力してください。'
                    }
                } catch {
                    $code=$_.Exception.Message
                    if ($command -eq 'start') {
                        try { Stop-LauncherChildren $children $Shared } catch { $code='stop_failed' }
                    }
                    if ($locked -and $children.Count -eq 0) { $tunnelMutex.ReleaseMutex(); $locked=$false }
                    if ($command -ne 'open') { $Shared.State='要対応' }
                    $Shared.Message=Get-LauncherMessage $code
                } finally { $key=$null; $adapter=$null; $Shared.Busy=$false }
            }
            foreach ($child in @($children.ToArray())) {
                Receive-LauncherOutput $child $Shared
                if ($child.Process.HasExited) {
                    try { Stop-LauncherChildren $children $Shared }
                    catch { $Shared.State='要対応'; $Shared.Message=Get-LauncherMessage 'stop_failed'; break }
                    if ($locked) { $tunnelMutex.ReleaseMutex(); $locked=$false }
                    $Shared.State='要対応'; $Shared.Message=Get-LauncherMessage 'child_exited'; break
                }
            }
            Start-Sleep -Milliseconds 120
        }
    } catch { $Shared.State='要対応'; $Shared.Message=Get-LauncherMessage 'stop_failed' }
    finally {
        try { Stop-LauncherChildren $children $Shared } catch { $Shared.Message=Get-LauncherMessage 'stop_failed' }
        if ($locked) { $tunnelMutex.ReleaseMutex() }
        if ($tunnelMutex) { $tunnelMutex.Dispose() }
        $Shared.Key=''; $Shared.Done=$true
    }
}
