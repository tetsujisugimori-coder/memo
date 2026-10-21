"use strict";
// Real PS 5.1 controller and real persistent receiver; mock OAuth/Tunnel only.
// Copied sources use private dynamic ports. Live 8791/8792/Tunnel are untouched.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { execFileSync, spawn } = require("node:child_process");
const { once } = require("node:events");
const ps = path.join(process.env.SystemRoot || "", "System32/WindowsPowerShell/v1.0/powershell.exe");
const bom = "\uFEFF";
async function freePort() {
  const server = net.createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function main() {
  assert.equal(process.platform, "win32");
  const external = await fs.mkdtemp(path.join(os.tmpdir(), "memo launcher 日本語 'quote' "));
  const artifacts = path.join(__dirname, "e2e-artifacts/launcher"); await fs.mkdir(artifacts, { recursive: true });
  const runArtifacts = path.join(artifacts, "run-" + path.basename(external).replace(/[^a-zA-Z0-9]/g, ""));
  await fs.mkdir(runArtifacts);
  const root = path.join(external, "空白 日本語 'quote'"); await fs.mkdir(root);
  await fs.symlink(path.join(__dirname, "node_modules"), path.join(root, "node_modules"), "junction");
  const receiverPort = await freePort(), oauthPort = await freePort();
  for (const file of ["memo-nexus-launcher-check.js", "mcp-http-auth.js", "dummy-preview-service.js", "dummy-preview-queue.js", "dummy-preview-history.js", "memo-search-broker.js", "memo-search.js"]) {
    await fs.copyFile(path.join(__dirname, file), path.join(root, file));
  }
  let helper = await fs.readFile(path.join(root, "memo-nexus-launcher-check.js"), "utf8");
  helper = helper.replaceAll("8791", String(receiverPort)).replaceAll("8792", String(oauthPort));
  helper = helper.replace('let server;', `let server;
    const fixture = require("node:fs").readFileSync(require("node:path").join(__dirname,"scenario.txt"),"utf8");
    if (fixture === role + "_exit") process.exit(1);
    if (fixture === role + "_timeout") { setInterval(() => {},1000); return; }
    if (role !== "validate") require("node:fs").writeFileSync(require("node:path").join(__dirname,role+".env.json"), JSON.stringify({
      names: Object.keys(process.env), adapter: require("node:crypto").createHash("sha256").update(process.env.MEMO_PREVIEW_ADAPTER_TOKEN || "").digest("hex") }));`);
  await fs.writeFile(path.join(root, "memo-nexus-launcher-check.js"), helper);
  await fs.writeFile(path.join(root, "mcp-http-server.js"), `
    const http = require('node:http');
    exports.createAuthenticatedServer = async (config) => http.createServer((req,res) => {
      if(req.url.startsWith('/.well-known/')) { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({resource:config.resource,authorization_servers:config.authorization_servers,scopes_supported:config.scopes_supported})); }
      else { res.writeHead(401,{'WWW-Authenticate':'Bearer resource_metadata="'+config.resource_metadata+'"'}); res.end('{}'); }
    });
  `);
  await fs.writeFile(path.join(root, "fixture-health.js"), `
    const fs=require('node:fs'), path=require('node:path'), http=require('node:http');
    const scenario=fs.readFileSync(path.join(__dirname,'scenario.txt'),'utf8');
    if(scenario==='tunnel_exit') process.exit(1);
    fs.writeFileSync(path.join(__dirname,'tunnel.env.json'),JSON.stringify(Object.keys(process.env)));
    const endpoint=process.argv[process.argv.indexOf('--health.listen-addr')+1];
    http.createServer((req,res)=>{res.writeHead(scenario==='tunnel_timeout'?503:200);res.end();})
      .listen(Number(endpoint.split(':')[1]),'127.0.0.1',()=>console.log('fixture_health_ready'));
  `);
  let controller = await fs.readFile(path.join(__dirname, "memo-nexus-launcher.ps1"), "utf8");
  controller = controller.replaceAll("8791", String(receiverPort)).replaceAll("8792", String(oauthPort));
  // Test-only isolation: production always checks all tunnel-client processes.
  controller += `\nfunction Get-Process { param($Name,$ErrorAction) if (([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'scenario.txt'))) -eq 'tunnel_conflict') { [pscustomobject]@{Id=1} } }\n`;
  controller = controller.replace('[int]$TimeoutSeconds=25', '[int]$TimeoutSeconds=5').replace('} 35', '} 8');
  controller = controller.replace("try { if (& $Probe) { return } } catch { }", "try { if (& $Probe) { return } } catch { $Shared.TestProbe=$_.Exception.Message }");
  controller = controller.replace('$code=$_.Exception.Message', '$code=$_.Exception.Message; $Shared.TestFailure=$_.ScriptStackTrace');
  controller = controller.replace("if ([MemoNexusTcpOwner]::LoopbackListener($healthPort) -ne $tunnel.Process.Id)", "$Shared.TestProbe='owner='+[MemoNexusTcpOwner]::LoopbackListener($healthPort)+' child='+$tunnel.Process.Id+' port='+$healthPort; if ([MemoNexusTcpOwner]::LoopbackListener($healthPort) -ne $tunnel.Process.Id)");
  await fs.writeFile(path.join(root, "memo-nexus-launcher.ps1"), bom + controller.replace(/^\uFEFF/, ""));
  const configPath = path.join(external, "OAuth 設定.json");
  const config = { mode: "authenticated", port: oauthPort, resource: "https://resource.example.invalid/mcp",
    audience: "https://api.example.invalid/", resource_metadata: `http://127.0.0.1:${oauthPort}/.well-known/oauth-protected-resource/mcp`,
    authorization_servers: ["https://issuer.example.invalid/"], scopes_supported: ["memo:submit"], allowedSubjects: ["auth0|fixture"] };
  await fs.writeFile(configPath, JSON.stringify(config));
  // No generated/copied EXE. Norton protection stays enabled; never restore or exclude a fixture.
  await fs.writeFile(path.join(root, "fixture-client-info.js"), `
    const fs=require('node:fs'),path=require('node:path');
    const scenario=fs.readFileSync(path.join(__dirname,'scenario.txt'),'utf8');
    if(process.argv[2]==='--version') console.log(scenario==='binary_version'?'unverified-build':'0.0.16+5f99daabd4aa4a77049e6d81d54a0d8c18335397');
    else console.log(scenario==='binary_options'?'--mcp.server-url':'--mcp.server-url --mcp.oauth-trusted-origin --log.http-raw-unsafe --health.listen-addr');
  `);
  await fs.writeFile(path.join(root, "scenario.txt"), "normal");
  const driver = path.join(root, "driver.ps1");
  await fs.writeFile(driver, bom + `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'memo-nexus-launcher.ps1')
function Assert($value,$message) { if (-not $value) { throw $message } }
Assert ($PSVersionTable.PSVersion.Major -eq 5) 'requires PS5.1'
$env:LOCALAPPDATA=$env:MEMO_TEST_EXTERNAL
$settings=[pscustomobject]@{version=1; configPath=(Join-Path $env:MEMO_TEST_EXTERNAL 'OAuth 設定.json'); tunnelPath=$env:MEMO_TEST_NODE; tunnelId='tunnel_fixture'; memoUrl='http://127.0.0.1:5500/'; diagnostics=$false; keyFile=''}
$key='TEST_SECRET_RUNTIME_'+(New-LauncherToken)
Save-LauncherSettings $settings $key $true
$saved=Read-LauncherSettings
Assert ((Read-LauncherKey $saved) -ceq $key) 'DPAPI roundtrip'
Assert (-not ([IO.File]::ReadAllText((Join-Path (Get-LauncherDirectory) 'settings.json')).Contains($key))) 'plaintext key'
$encrypted=[IO.File]::ReadAllBytes((Join-Path (Get-LauncherDirectory) $saved.keyFile))
Assert (-not ([Text.Encoding]::UTF8.GetString($encrypted).Contains($key))) 'encrypted file'
[IO.File]::WriteAllText((Join-Path (Get-LauncherDirectory) $saved.keyFile),'corrupt')
$refused=$false; try { Read-LauncherKey $saved | Out-Null } catch { $refused=$true }; Assert $refused 'corrupt DPAPI must refuse'
Save-LauncherSettings $settings $key $true
Save-LauncherSettings $settings $key $false
Assert (-not (Read-LauncherSettings).keyFile) 'session only key preference'
$savedAcl=(New-Object IO.DirectoryInfo((Get-LauncherDirectory))).GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
$mySid=[Security.Principal.WindowsIdentity]::GetCurrent().User
foreach($rule in $savedAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) { Assert ($rule.IdentityReference -eq $mySid) 'private directory ACL' }
Write-Output 'PASS DPAPI current-user, separate settings, corrupt refusal'
$diagnosticShared=@{Diagnostics=$true; Observation=''}; $diagnosticChild=@{Role='OAuth'; Bearer=@{}}
Update-LauncherObservation '{"diagnostic":"memo_http_oauth","event":"request_received","sequence":1,"bearerPresent":false}' $diagnosticChild $diagnosticShared
Update-LauncherObservation '{"diagnostic":"memo_http_oauth","event":"authentication","sequence":1,"status":"rejected"}' $diagnosticChild $diagnosticShared
Assert (-not $diagnosticShared.Observation) 'startup 401 is not a connection failure'
foreach($line in @('{"diagnostic":"memo_http_oauth","event":"tools_prepared","toolCount":2,"expectedTools":true}', '{"diagnostic":"memo_http_oauth","event":"protocol_result","stage":"tools_list","status":200,"success":false,"toolCount":2,"expectedTools":true}', '{"diagnostic":"memo_http_oauth","event":"protocol_result","stage":"tools_list","status":500,"success":true,"toolCount":2,"expectedTools":true}')) { Update-LauncherObservation $line $diagnosticChild $diagnosticShared }
Assert (-not $diagnosticShared.Observation) 'prepared/HTTP200 are not tool detection'
Update-LauncherObservation '{"diagnostic":"memo_http_oauth","event":"protocol_result","stage":"tools_list","status":200,"success":true,"toolCount":2,"submitToolCount":2,"searchToolCount":0,"unsafe":"TEST_SECRET_DIAGNOSTIC"}' $diagnosticChild $diagnosticShared
Assert ([bool]$diagnosticShared.Observation -and -not $diagnosticShared.Observation.Contains('TEST_SECRET')) 'fixed observed tools summary'
Assert ($diagnosticShared.Observation.Contains('送信用2ツール')) 'submit tools summary'
Update-LauncherObservation '{"diagnostic":"memo_http_oauth","event":"protocol_result","stage":"tools_list","status":200,"success":true,"toolCount":2,"submitToolCount":0,"searchToolCount":2}' $diagnosticChild $diagnosticShared
Assert ($diagnosticShared.Observation.Contains('検索用2ツール')) 'search tools summary'
Update-LauncherObservation '{"diagnostic":"memo_http_oauth","event":"protocol_result","stage":"tools_list","status":200,"success":true,"toolCount":4,"submitToolCount":2,"searchToolCount":2}' $diagnosticChild $diagnosticShared
Assert ($diagnosticShared.Observation.Contains('全4ツール') -and $diagnosticShared.Observation.Contains('未確認')) 'all tools are not actual ChatGPT success'
Update-LauncherObservation '{"diagnostic":"memo_http_oauth","event":"request_received","sequence":2,"bearerPresent":true}' $diagnosticChild $diagnosticShared
Update-LauncherObservation '{"diagnostic":"memo_http_oauth","event":"authentication","sequence":2,"status":"rejected"}' $diagnosticChild $diagnosticShared
Assert ($diagnosticShared.Observation.Contains('認証拒否')) 'authentication refusal'
Update-LauncherObservation '{"diagnostic":"memo_http_oauth","event":"response","sequence":2,"status":403,"classification":"insufficient_scope"}' $diagnosticChild $diagnosticShared
Assert ($diagnosticShared.Observation.Contains('scope不足')) 'step-up refusal'
Update-LauncherObservation '{"diagnostic":"memo_http_oauth","event":"tool_authorization","status":"rejected","classification":"insufficient_scope"}' $diagnosticChild $diagnosticShared
Assert ($diagnosticShared.Observation.Contains('tools/callのscope不足')) 'tool-level refusal'
Update-LauncherObservation '{"diagnostic":"memo_http_oauth","event":"authorization_challenge","status":200,"classification":"insufficient_scope","unsafe":"TEST_SECRET_CHALLENGE"}' $diagnosticChild $diagnosticShared
Assert ($diagnosticShared.Observation.Contains('MCPエラー結果') -and $diagnosticShared.Observation.Contains('未確認') -and -not $diagnosticShared.Observation.Contains('TEST_SECRET')) 'challenge is not OAuth UI or connection success'
$diagnosticShared.Diagnostics=$false; $diagnosticShared.Observation=''
Update-LauncherObservation '{"diagnostic":"memo_http_oauth","event":"authentication","status":"accepted"}' $diagnosticChild $diagnosticShared
Assert (-not $diagnosticShared.Observation) 'diagnostics OFF'
Write-Output 'PASS diagnostic semantics, startup 401, fixed safe text, OFF'
$guideShared=@{State='停止中'; Settings=$null; Validation='未検証'; Message=''; Observation=''; Key=$key; BrowserToken='TEST_SECRET_BROWSER'}
Assert ((Get-LauncherGuide $guideShared).Next.Contains('初回設定')) 'guide initial settings'
$guideShared.Settings=$settings
Assert ((Get-LauncherGuide $guideShared).Next.Contains('検証が必要')) 'guide loaded settings require validation'
$guideShared.Validation='検証中'
Assert ((Get-LauncherGuide $guideShared).Next.Contains('検証中')) 'guide validating'
$guideShared.Validation='要確認'
Assert ((Get-LauncherGuide $guideShared).Next.Contains('検証失敗')) 'guide validation failure'
$guideShared.Validation='検証済み'
Assert ((Get-LauncherGuide $guideShared).Next.Contains('MCPを起動')) 'guide validated stopped'
foreach($state in @('起動中','ローカル準備完了','停止処理中','要対応','停止中')) {
  $guideShared.State=$state; $guideShared.Message=Get-LauncherMessage 'port_conflict'
  $guideShared.Observation='TEST_SECRET_RAW_DIAGNOSTIC'
  $guide=Get-LauncherGuide $guideShared
  Assert ($guide.Steps.Contains('3 ChatGPT接続確認：ユーザーによる確認が必要') -and $guide.Steps.Contains('4 Memo-Nexus受信・手動保存：ユーザーによる確認が必要')) 'unobserved stages never succeed'
  Assert (-not (($guide.Steps+$guide.Next).Contains($key)) -and -not (($guide.Steps+$guide.Next).Contains('TEST_SECRET'))) 'guide never renders settings secrets or raw observations'
  if($state -eq 'ローカル準備完了') { Assert ($guide.Next.Contains('Browser token') -and $guide.Next.Contains('手動保存')) 'ready guide next actions' }
  if($state -eq '要対応') { Assert ($guide.Next -ceq $guideShared.Message) 'existing error cause and action retained' }
}
Write-Output 'PASS guide states, manual confirmation, secrets excluded'
$guideShared.State='要対応'; $guideShared.Settings=$null
Assert ((Get-LauncherGuide $guideShared).Steps.Contains('1 設定確認：要対応')) 'invalid saved settings must not suggest initial setup'
$historySnapshot=''
$sessionScenarios=@('session_off','session_reopen','session_on','session_update','session_save_failed')
function Wait-FixtureCommand($s) {
  $deadline=[DateTime]::UtcNow.AddSeconds(45)
  while($s.Busy -and -not $s.Done -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
  Assert (-not $s.Busy -and -not $s.Done) 'session controller command must complete'
}
foreach ($scenario in @($sessionScenarios)+@('validate_saved','validate_key_failed','validate_missing_key','normal','receiver_exit','receiver_timeout','oauth_exit','oauth_timeout','tunnel_exit','tunnel_timeout','unexpected_exit','health_owner_mismatch','history_corrupt','port_conflict','tunnel_conflict','history_override','binary_version','binary_options')) {
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'scenario.txt'),$scenario)
  if($scenario -eq 'history_override') { $env:MEMO_PREVIEW_HISTORY_DIR=Join-Path $env:LOCALAPPDATA 'different-history' } else { Remove-Item Env:MEMO_PREVIEW_HISTORY_DIR -ErrorAction SilentlyContinue }
  $history=Join-Path $env:LOCALAPPDATA 'Memo-Nexus\\received-history'
  if ($scenario -eq 'history_corrupt') { [IO.File]::WriteAllText((Join-Path $history 'history.json'),'corrupt') }
  $shared=[hashtable]::Synchronized(@{State='停止中'; Receiver='停止中'; OAuth='停止中'; Tunnel='停止中'; Message=''; Observation=''; BrowserToken=''; Settings=$settings; Key=$key; Remember=$false; Diagnostics=$false; Busy=$true; Command='start'; Stop=$false; Exit=$false; Done=$false; TestProbe=''; TestFailure=''; TestStep=''; FixtureRoot=$PSScriptRoot; Foreign=$null; TestChildren=(New-Object Collections.ArrayList); TestStops=(New-Object Collections.ArrayList)})
  if($scenario -in $sessionScenarios) {
    if($scenario -ne 'session_reopen') { Save-LauncherSettings $settings $key $true }
    $shared.Settings=Read-LauncherSettings; $shared.Key=''; $expectedKey=$key
    $beforeSettings=[IO.File]::ReadAllText((Join-Path (Get-LauncherDirectory) 'settings.json'))
    $oldKeyFile=$shared.Settings.keyFile
    if($scenario -ne 'session_reopen') { Assert ([bool]$oldKeyFile -and (Read-LauncherKey $shared.Settings) -ceq $key) 'fresh session reads protected key'; $shared.Command='save' }
    $shared.Remember=$scenario -in @('session_on','session_update','session_save_failed')
    if($scenario -eq 'session_update') { $expectedKey='TEST_SECRET_UPDATED_'+(New-LauncherToken); $shared.Key=$expectedKey }
  }
  $settingsLock=$null
  if($scenario -like 'validate_*') {
    Save-LauncherSettings $settings $key ($scenario -ne 'validate_missing_key')
    $shared.Settings=Read-LauncherSettings; $shared.Key=''; $shared.Command='validate'
    if($scenario -eq 'validate_key_failed') { [IO.File]::WriteAllText((Join-Path (Get-LauncherDirectory) $shared.Settings.keyFile),'corrupt') }
    $validationBefore=[IO.File]::ReadAllBytes((Join-Path (Get-LauncherDirectory) 'settings.json'))
  }
  if($scenario -eq 'session_save_failed') { $settingsLock=[IO.File]::Open((Join-Path (Get-LauncherDirectory) 'settings.json'),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read) }
  $holder=$null
  if ($scenario -eq 'port_conflict') { $holder=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,${receiverPort}); $holder.Start() }
  $worker=[PowerShell]::Create()
  [void]$worker.AddScript({ param($file,$s)
    . $file
    $script:originalStart=(Get-Item function:New-LauncherProcess).ScriptBlock
    function New-LauncherProcess($Executable,$Arguments,$Environment,$Role) {
      $s.TestStep=$Role
      if($Role -eq 'Check') { $s.TestStep=$(if($Arguments[0] -eq '--version'){'version_check'}elseif($Arguments[0] -eq 'run'){'help_check'}else{'config_check'}) }
      if ($Role -eq 'Check' -and ($Arguments[0] -eq '--version' -or ($Arguments[0] -eq 'run' -and $Arguments[1] -eq '--help'))) {
        $Arguments=@((Join-Path $s.FixtureRoot 'fixture-client-info.js'))+$Arguments
      }
      if ($Role -eq 'Tunnel') {
        $Executable=$env:MEMO_TEST_NODE
        if([IO.File]::ReadAllText((Join-Path $s.FixtureRoot 'scenario.txt')) -eq 'health_owner_mismatch') {
          $s.Foreign=& $script:originalStart $Executable (@((Join-Path $s.FixtureRoot 'fixture-health.js'))+$Arguments) @{} 'Foreign'
          $Arguments=@('-e','setInterval(()=>{},1000)')
        } else { $Arguments=@((Join-Path $s.FixtureRoot 'fixture-health.js'))+$Arguments }
      }
      $child=& $script:originalStart $Executable $Arguments $Environment $Role
      if ($Role -in @('Receiver','OAuth','Tunnel')) {
        $child.TestProcess=[Diagnostics.Process]::GetProcessById($child.Process.Id); $testHandle=$child.TestProcess.Handle
        [void]$s.TestChildren.Add($child)
      }
      return $child
    }
    $script:originalStop=(Get-Item function:Stop-LauncherChildren).ScriptBlock
    function Stop-LauncherChildren($Children,$Shared) {
      for($i=$Children.Count-1; $i -ge 0; $i--) { [void]$s.TestStops.Add($Children[$i].Role) }
      & $script:originalStop $Children $Shared
    }
    Invoke-LauncherController $s
  }).AddArgument((Join-Path $PSScriptRoot 'memo-nexus-launcher.ps1')).AddArgument($shared)
  $async=$worker.BeginInvoke()
  try {
    $deadline=[DateTime]::UtcNow.AddSeconds(45)
    while ($shared.Busy -and -not $shared.Done -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    Assert (-not $shared.Busy) ('controller timeout '+$scenario+' state='+$shared.State+' receiver='+$shared.Receiver+' oauth='+$shared.OAuth+' tunnel='+$shared.Tunnel+' '+$shared.Message)
    if($scenario -like 'validate_*') {
      Assert ($shared.TestChildren.Count -eq 0 -and -not $shared.BrowserToken -and -not $shared.Key) 'validation does not start services, generate tokens or retain decrypted key'
      Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path (Get-LauncherDirectory) 'settings.json'))) -ceq [Convert]::ToBase64String($validationBefore)) 'validation never saves or resets settings'
      if($scenario -eq 'validate_saved') {
        Assert ($shared.Validation -eq '検証済み' -and $shared.State -eq '停止中') 'saved settings validation succeeds'
        Assert ($shared.SettingStatus.OAuth -eq '検証済み' -and $shared.SettingStatus.Tunnel -eq '固定build検証済み' -and $shared.SettingStatus.Id -eq '形式検証済み' -and $shared.SettingStatus.Key.Contains('利用可能') -and $shared.SettingStatus.Url.Contains('未確認')) 'all five settings summaries'
      } else {
        Assert ($shared.Validation -eq '要確認' -and $shared.State -eq '要対応') 'validation failure visible'
        if($scenario -eq 'validate_key_failed') { Assert ($shared.SettingStatus.Key.Contains('復号失敗')) 'decryption failure guidance' }
      }
    } elseif($scenario -in $sessionScenarios) {
      if($scenario -eq 'session_reopen') {
        Assert (-not $shared.Settings.keyFile -and -not $shared.Key) 'new session must not inherit unremembered key'
        Assert ($shared.State -eq '要対応' -and $shared.TestChildren.Count -eq 0) 'new session requires explicit key input'
      } elseif($scenario -eq 'session_save_failed') {
        Assert ($shared.State -eq '要対応' -and -not $shared.Key) 'failed save must not promote decrypted key or report success'
        Assert ($shared.Validation -eq '要確認' -and -not $shared.SettingStatus.OAuth.Contains('検証済み')) 'failed commit cannot label candidate as saved settings'
        Assert ([IO.File]::ReadAllText((Join-Path (Get-LauncherDirectory) 'settings.json')) -ceq $beforeSettings) 'failed save keeps committed settings'
        Assert ((Read-LauncherKey (Read-LauncherSettings)) -ceq $key) 'failed save preserves previous protected key'
      } else {
        Assert ($shared.State -eq '停止中') 'controller settings save succeeds'
        Assert ($shared.Key -ceq $expectedKey) 'controller save must retain the effective session key'
        $committed=Read-LauncherSettings
        Assert ([bool]$committed.keyFile -eq $shared.Remember) 'disk retention preference is independent of session key'
        if($shared.Remember) { Assert ((Read-LauncherKey $committed) -ceq $expectedKey) 'remembered key reuse/update' }
        Assert (Test-Path -LiteralPath (Join-Path (Get-LauncherDirectory) $oldKeyFile)) 'old encrypted key is retained'
        $cycles=$(if($scenario -eq 'session_off'){2}else{1})
        for($cycle=0;$cycle -lt $cycles;$cycle++) {
          $shared.Busy=$true; $shared.Command='start'; Wait-FixtureCommand $shared
          Assert ($shared.State -eq 'ローカル準備完了') 'session key supports start/restart'
          $tunnelChild=$shared.TestChildren[$shared.TestChildren.Count-1]
          Assert ($tunnelChild.Process.StartInfo.EnvironmentVariables['CONTROL_PLANE_API_KEY'] -ceq $expectedKey) 'session key reaches the tunnel environment'
          foreach($child in @($shared.TestChildren.ToArray())) { Assert (-not $child.Process.StartInfo.Arguments.Contains($expectedKey)) 'runtime key must not appear in argv or URL' }
          $shared.Busy=$true; $shared.Stop=$true; Wait-FixtureCommand $shared
          Assert ($shared.State -eq '停止中' -and $shared.Key -ceq $expectedKey) 'stop preserves current session key'
        }
        # No plaintext keys in settings, prior settings, encrypted files or fixture artifacts.
        foreach($file in @((Get-ChildItem -LiteralPath (Get-LauncherDirectory) -File)) + @((Get-ChildItem -LiteralPath $PSScriptRoot -File))) {
          $text=[Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($file.FullName))
          Assert (-not $text.Contains($key) -and -not $text.Contains($expectedKey)) 'fixture artifacts must not contain plaintext runtime keys'
        }
      }
    } elseif ($scenario -in @('normal','unexpected_exit')) {
      Assert ($shared.State -eq 'ローカル準備完了') ('readiness '+$scenario+' '+$shared.Message+' '+$shared.TestProbe+' step='+$shared.TestStep+' '+$shared.TestFailure)
      Assert ($shared.TestChildren.Count -eq 3) 'ordered start count'
      Assert (($shared.TestChildren.Role -join ',') -eq 'Receiver,OAuth,Tunnel') 'start order'
      if ($scenario -eq 'normal') {
        # Duplicate commands cannot replace or stop this run's children.
        $shared.Busy=$true; $shared.Command='start'
        $deadline=[DateTime]::UtcNow.AddSeconds(5)
        while($shared.Busy -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
        Assert ($shared.TestChildren.Count -eq 3 -and $shared.State -eq 'ローカル準備完了') 'duplicate start must preserve current run'
        $request=[Net.HttpWebRequest]::Create('http://127.0.0.1:${receiverPort}/dummy'); $request.Proxy=$null; $request.Method='POST'; $request.ContentType='application/json'; $request.Timeout=2000; $request.ServicePoint.Expect100Continue=$false
        $request.Headers['Authorization']='Bearer '+$shared.TestChildren[0].Process.StartInfo.EnvironmentVariables['MEMO_PREVIEW_ADAPTER_TOKEN']
        $payload=[Text.Encoding]::UTF8.GetBytes(('{"requestId":"'+[Guid]::NewGuid().ToString()+'"}')); $request.ContentLength=$payload.Length
        $stream=$request.GetRequestStream(); $stream.Write($payload,0,$payload.Length); $stream.Dispose()
        $response=$request.GetResponse(); Assert ([int]$response.StatusCode -eq 200) 'fixture receipt'; $response.Close()
        $historySnapshot=[IO.File]::ReadAllText((Join-Path $history 'history.json'))
      } else { Assert ([IO.File]::ReadAllText((Join-Path $history 'history.json')) -ceq $historySnapshot) 'same history after restart' }
      $receiverEnv=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'receiver.env.json') | ConvertFrom-Json
      $oauthEnv=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'oauth.env.json') | ConvertFrom-Json
      Assert ($receiverEnv.adapter -ceq $oauthEnv.adapter) 'adapter sharing'
      Assert ('CONTROL_PLANE_API_KEY' -notin $receiverEnv.names -and 'CONTROL_PLANE_API_KEY' -notin $oauthEnv.names) 'runtime key isolation'
      Assert ('MEMO_PREVIEW_BROWSER_TOKEN' -notin $oauthEnv.names -and 'NODE_OPTIONS' -notin $oauthEnv.names) 'browser token isolation'
      $tunnelEnv=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'tunnel.env.json') | ConvertFrom-Json
      Assert ('MEMO_PREVIEW_ADAPTER_TOKEN' -notin $tunnelEnv -and 'MEMO_PREVIEW_BROWSER_TOKEN' -notin $tunnelEnv -and 'CONTROL_PLANE_API_KEY' -in $tunnelEnv) 'tunnel child environment'
      if ($scenario -eq 'unexpected_exit') {
        $shared.TestChildren[1].Process.Kill()
        $deadline=[DateTime]::UtcNow.AddSeconds(12)
        while($shared.State -ne '要対応' -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
        Assert ($shared.State -eq '要対応') 'unexpected exit detection'
      } else {
        $shared.Stop=$true; $shared.Busy=$true
        $deadline=[DateTime]::UtcNow.AddSeconds(12)
        while($shared.Busy -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
        Assert ($shared.State -eq '停止中') 'normal stop'
      }
      Assert (($shared.TestStops -join ',') -eq 'Tunnel,OAuth,Receiver') 'reverse stop'
      Assert (Test-Path -LiteralPath (Join-Path $history 'history.json')) 'history retained'
      Assert ([IO.File]::ReadAllText((Join-Path $history 'history.json')) -ceq $historySnapshot) 'stop preserves durable receipt'
    } else {
      Assert ($shared.State -eq '要対応') ('failure state '+$scenario)
      Assert (-not $shared.BrowserToken) 'failed startup token cleared'
      if ($scenario -in @('port_conflict','tunnel_conflict','history_override')) { Assert ($shared.TestChildren.Count -eq 0) 'foreign service/history must not be adopted' }
      if ($holder) { Assert $holder.Server.IsBound 'foreign listener preserved' }
      if ($scenario -eq 'health_owner_mismatch') { Assert ($null -ne $shared.Foreign -and -not $shared.Foreign.Process.HasExited) 'foreign health process preserved'; Assert ($shared.TestChildren.Count -eq 3) 'mismatch tested after all stages started' }
    }
    foreach($child in @($shared.TestChildren.ToArray())) {
      Assert ($child.TestProcess.HasExited) ('leftover child '+$child.Role)
      $child.TestProcess.Dispose()
    }
    Write-Output ('PASS '+$scenario)
  } finally {
    $shared.Exit=$true
    if($settingsLock) { $settingsLock.Dispose() }
    if ($holder) { $holder.Stop() }
    if ($shared.Foreign) { if(-not $shared.Foreign.Process.HasExited){$shared.Foreign.Process.Kill();[void]$shared.Foreign.Process.WaitForExit(2000)}; $shared.Foreign.Process.Dispose() }
    if ($async.AsyncWaitHandle.WaitOne(10000)) { [void]$worker.EndInvoke($async) } else { throw 'worker cleanup timeout' }
    $worker.Dispose()
    if($scenario -in $sessionScenarios) { Assert (-not $shared.Key) 'controller exit clears session key' }
  }
}
Write-Output 'PASS all isolated controller checks'
`);
  const env = {};
  for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "Path", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, { MEMO_TEST_EXTERNAL: external, MEMO_TEST_NODE: process.execPath, MEMO_TEST_ARTIFACTS: runArtifacts, CONTROL_PLANE_API_KEY: "TEST_SECRET_INHERITED_RUNTIME",
    MEMO_PREVIEW_BROWSER_TOKEN: "TEST_SECRET_INHERITED_BROWSER", NODE_OPTIONS: "--trace-warnings" });
  const child = spawn(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", driver], { env, windowsHide: true });
  let output = ""; child.stdout.on("data", x => { output += x; process.stdout.write(x); }); child.stderr.on("data", x => { output += x; });
  const timer = setTimeout(() => child.kill(), 180000);
  const [code] = await once(child, "close"); clearTimeout(timer);
  await fs.writeFile(path.join(runArtifacts, "controller.log"), output);
  assert.doesNotMatch(output, /TEST_SECRET_/);
  assert.equal(code, 0, output);
  assert.match(output, /PASS all isolated controller checks/);
  // Execute the actual layout, rendering and button handlers without a controller.
  // Scale() checks are synthetic; they do not change Windows display DPI.
  const uiSource = await fs.readFile(path.join(__dirname, "start-memo-nexus.ps1"), "utf8");
  const layout = uiSource.slice(uiSource.indexOf("$taskForm=New-Object"), uiSource.indexOf("function Show-LauncherSettings"));
  const render = uiSource.slice(uiSource.indexOf("$guide=Get-LauncherGuide"), uiSource.indexOf("$taskStart.Enabled="));
  const handlers = uiSource.slice(uiSource.indexOf("$taskStart.Add_Click({"), uiSource.indexOf("$taskTokenButton.Add_Click({"));
  const scrollDriver = path.join(root, "scroll-layout.ps1");
  await fs.writeFile(scrollDriver, bom + `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'memo-nexus-launcher.ps1')
function Assert($value,$message) { if(-not $value) { throw $message } }
function Assert-Reachable($control) {
    $taskForm.ScrollControlIntoView($control)
    [Windows.Forms.Application]::DoEvents()
    $rect=$taskForm.RectangleToClient($control.RectangleToScreen($control.ClientRectangle))
    Assert ($rect.Top -ge 0 -and $rect.Bottom -le $taskForm.ClientSize.Height) 'control not vertically reachable'
    Assert ($rect.Left -ge 0 -and $rect.Right -le $taskForm.ClientSize.Width) ('control not horizontally readable: scale='+$factor+' case='+$case[0]+' actual='+$taskForm.Size+' client='+$taskForm.ClientSize+' control='+$rect+' maxTrack='+[Windows.Forms.SystemInformation]::MaxWindowTrackSize)
}
$records=New-Object Collections.ArrayList
$cases=@(
    @('unset','停止中','未検証',''), @('loaded','停止中','未検証',''),
    @('validating','停止中','検証中',''), @('invalid','要対応','要確認','settings_invalid'),
    @('validated','停止中','検証済み',''), @('starting','起動中','検証済み',''),
    @('ready','ローカル準備完了','検証済み',''), @('stopping','停止処理中','検証済み',''),
    @('history','要対応','検証済み','history_override'), @('key','要対応','要確認','key_unavailable'),
    @('stop-failed','要対応','検証済み','stop_failed'))
foreach($condition in @(@(1.0,$false),@(1.25,$false),@(1.5,$false),@(1.5,$true))) {
    $factor=$condition[0]; $limited=$condition[1]
${layout}
    try {
${handlers}
        if($factor -ne 1) {
            $taskForm.AutoScaleMode='None'
            $taskForm.Scale((New-Object Drawing.SizeF($factor,$factor)))
            $taskForm.Font=New-Object Drawing.Font('Yu Gothic UI',(10*$factor))
        }
        if($limited) { $taskForm.MaximumSize=New-Object Drawing.Size(1040,788) }
        $taskForm.Show(); [Windows.Forms.Application]::DoEvents()
        $graphics=$taskForm.CreateGraphics()
        try { $dpi=$graphics.DpiX } finally { $graphics.Dispose() }
        foreach($size in @(@(800,870),@(760,540),@(1000,900),@(760,540))) {
            $taskForm.Size=New-Object Drawing.Size(([int]($size[0]*$factor)),([int]($size[1]*$factor)))
            foreach($case in $cases) {
                $taskShared=@{State=$case[1]; Validation=$case[2]; Settings=[pscustomobject]@{configPath='TEST_SECRET_SETTING'; memoUrl='TEST_SECRET_URL'};
                    Key='TEST_SECRET_KEY'; BrowserToken='TEST_SECRET_TOKEN'; Busy=$false; Command=''; Stop=$false;
                    Receiver='ローカル準備完了'; OAuth='ローカル準備完了'; Tunnel='ローカル準備完了';
                    Message=$(if($case[3]) { Get-LauncherMessage $case[3] } else { '設定・Node依存・Tunnel buildを検査しています。' }); Diagnostics=$true;
                    Observation='想定2ツールの一覧応答生成を観測。ChatGPT側の表示を確認してください';
                    SettingStatus=@{OAuth='要確認（検証・保存未完了）'; Tunnel='要確認（検証・保存未完了）'; Id='要確認（検証・保存未完了）'; Key='復号失敗・明示再入力が必要'; Url='要確認（検証・保存未完了）'}}
                if($case[0] -eq 'unset') { $taskShared.Settings=$null }
                if($case[0] -in @('validated','ready')) { $taskShared.SettingStatus=@{OAuth='検証済み'; Tunnel='固定build検証済み'; Id='形式検証済み'; Key='利用可能（認証成功は未確認）'; Url='検証済み（配信・保存は未確認）'} }
${render}
                $taskForm.AutoScrollPosition=New-Object Drawing.Point(0,0)
                $taskForm.PerformLayout(); [Windows.Forms.Application]::DoEvents()
                $before=$taskForm.AutoScrollPosition.Y
                $warningBottom=$taskWarning.Bottom
                if($warningBottom -gt $taskForm.ClientSize.Height) {
                    Assert $taskForm.VerticalScroll.Visible 'overflow must expose vertical scrollbar'
                    Assert ($taskForm.VerticalScroll.Maximum -ge $warningBottom-1) 'scroll range must include warning'
                }
                Assert-Reachable $taskWarning
                $after=$taskForm.AutoScrollPosition.Y
                if($warningBottom -gt $taskForm.ClientSize.Height) { Assert ($after -lt $before) 'scroll position must actually move' }
                [void]$records.Add([pscustomobject]@{scale=$factor; synthetic=($factor -ne 1); limited=$limited; deviceDpi=$dpi; logicalWidth=$size[0]; logicalHeight=$size[1]; width=$taskForm.Width; height=$taskForm.Height; case=$case[0]; scrollMaximum=$taskForm.VerticalScroll.Maximum; beforeY=$before; afterY=$after; warningReached=$true})
                $controls=@($taskStart,$taskStop,$taskOpen,$taskSettingsButton,$taskState,$taskComponents,$taskMessage,$taskDiagnostic,$taskTokenButton,$taskSettingsStatus,$taskGuide,$taskNext,$taskWarning)
                foreach($control in $controls) {
                    Assert-Reachable $control
                    Assert (-not $control.Text.Contains('TEST_SECRET')) 'settings values must not reach presentation'
                    $measure=[Windows.Forms.TextRenderer]::MeasureText($control.Text,$control.Font,(New-Object Drawing.Size($control.Width,10000)),[Windows.Forms.TextFormatFlags]::WordBreak)
                    Assert ($measure.Height -le $control.Height) ('text clipped in '+$case[0])
                }
                for($i=0;$i -lt $controls.Count;$i++) {
                    for($j=$i+1;$j -lt $controls.Count;$j++) { Assert (-not $controls[$i].Bounds.IntersectsWith($controls[$j].Bounds)) 'controls overlap' }
                }
                if($case[0] -in @('unset','ready','invalid') -and $size[0] -ne 1000) {
                    Assert-Reachable $taskWarning
                    $image=New-Object Drawing.Bitmap($taskForm.Width,$taskForm.Height)
                    try { $taskForm.DrawToBitmap($image,$taskForm.ClientRectangle); $image.Save((Join-Path $env:MEMO_TEST_ARTIFACTS ('scroll-'+$factor+'-limited-'+$limited+'-'+$size[0]+'-'+$case[0]+'.png'))) } finally { $image.Dispose() }
                }
            }
            # Actual handlers queue commands only: no worker can launch services/browser.
            $taskShared.State='停止中'; $taskShared.Busy=$false; $taskShared.Command=''
            Assert-Reachable $taskStart; $taskStart.PerformClick()
            Assert ($taskShared.Command -eq 'start' -and $taskShared.Busy) 'start after scroll'
            $taskShared.Busy=$false; $taskShared.Stop=$false
            Assert-Reachable $taskStop; $taskStop.PerformClick()
            Assert ($taskShared.Stop -and $taskShared.Busy) 'stop after scroll'
            $taskShared.Busy=$false; $taskShared.Settings=[pscustomobject]@{}; $taskShared.Command=''
            Assert-Reachable $taskOpen; $taskOpen.PerformClick()
            Assert ($taskShared.Command -eq 'open' -and $taskShared.Busy) 'open command after scroll'
            Assert-Reachable $taskSettingsButton
            Assert $taskSettingsButton.Enabled 'settings remains reachable after scroll'
        }
        Write-Output ('PASS Forms scroll scale '+$factor+' limited='+$limited)
    } finally { $taskForm.Close(); $taskForm.Dispose() }
}
$records | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $env:MEMO_TEST_ARTIFACTS 'scroll-matrix.json') -Encoding UTF8
Write-Output ('PASS Forms scroll matrix: '+$records.Count+' cases; native DPI='+$dpi+'; 125/150 percent are synthetic Scale tests')
`);
  const scrollOutput = execFileSync(ps, ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scrollDriver], { env, windowsHide: true, timeout: 90000, encoding: "utf8" });
  assert.doesNotMatch(scrollOutput, /TEST_SECRET/);
  assert.match(scrollOutput, /PASS Forms scroll matrix: 176 cases/);
  await fs.writeFile(path.join(runArtifacts, "scroll.log"), scrollOutput); console.log(scrollOutput.trim());
  let gui = await fs.readFile(path.join(__dirname, "start-memo-nexus.ps1"), "utf8");
  gui = gui.replace("$ErrorActionPreference='Stop'", "$ErrorActionPreference='Stop'\n$env:LOCALAPPDATA=Join-Path $env:MEMO_TEST_EXTERNAL 'gui-isolated'");
  gui = gui.replace("Local\\MemoNexusWindowsLauncher", "Local\\MemoNexusWindowsLauncherFixture-" + path.basename(external).replace(/[^a-zA-Z0-9]/g, ""));
  gui = gui.replace("[void][Windows.Forms.MessageBox]::Show('ランチャーは既に起動しています。既存の画面を確認してください。','Memo-Nexus')", "Write-Output 'PASS GUI duplicate refused'");
  gui = gui.replace("try { $taskTimer.Start();", `
$script:taskUiStage=0
$script:taskUiError=''
$taskUiTestTimer=New-Object Windows.Forms.Timer -Property @{Interval=250}
$taskUiTestTimer.Add_Tick({
    try {
    if(-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'gui-release'))) { return }
    switch($script:taskUiStage) {
        0 {
            if(-not $taskGuide.Text) { return }
            foreach($state in @('停止中','起動中','ローカル準備完了','停止処理中','要対応')) {
                $sample=@{State=$state; Settings=@{}; Validation='検証済み'; Message=(Get-LauncherMessage 'history_corrupt')}
                $sampleGuide=Get-LauncherGuide $sample
                $taskGuide.Text=$sampleGuide.Steps; $taskNext.Text='次の操作：'+$sampleGuide.Next
                foreach($control in @($taskGuide,$taskNext)) {
                    $size=[Windows.Forms.TextRenderer]::MeasureText($control.Text,$control.Font,(New-Object Drawing.Size($control.Width,1000)),[Windows.Forms.TextFormatFlags]::WordBreak)
                    if($size.Height -gt $control.Height) { throw 'state guide text exceeds label' }
                }
            }
            foreach($control in @($taskSettingsStatus,$taskGuide,$taskNext,$taskWarning)) {
                $size=[Windows.Forms.TextRenderer]::MeasureText($control.Text,$control.Font,(New-Object Drawing.Size($control.Width,1000)),[Windows.Forms.TextFormatFlags]::WordBreak)
                if($size.Height -gt $control.Height) { throw 'guide text exceeds label' }
            }
            $image=New-Object Drawing.Bitmap($taskForm.Width,$taskForm.Height)
            try { $taskForm.DrawToBitmap($image,$taskForm.ClientRectangle); $image.Save((Join-Path $env:MEMO_TEST_ARTIFACTS 'guide.png')) } finally { $image.Dispose() }
            $taskForm.Size=New-Object Drawing.Size(760,540)
            $taskForm.ScrollControlIntoView($taskWarning)
            if($taskForm.AutoScrollPosition.Y -ge 0) { throw 'GUI must scroll before settings click' }
            $taskForm.ScrollControlIntoView($taskSettingsButton)
            $script:taskUiStage=1; [Console]::WriteLine('GUI stage 1: settings after scroll'); $taskSettingsButton.PerformClick()
        }
        1 {
            $dialogs=@([Windows.Forms.Application]::OpenForms | Where-Object { $_.Text -eq 'Memo-Nexus 初回設定' })
            if($dialogs.Count -eq 1) { $dialogs[0].Close(); $script:taskUiStage=2; [Console]::WriteLine('GUI stage 2: settings closed') }
        }
        2 { $script:taskUiStage=3; [Console]::WriteLine('GUI stage 3: start'); $taskStart.PerformClick() }
        3 { if(-not $taskShared.Busy -and $taskShared.State -eq '要対応') { $script:taskUiStage=4; $taskStop.PerformClick() } }
        4 { if(-not $taskShared.Busy -and $taskShared.State -eq '停止中') { $script:taskUiStage=5; $taskForm.Close() } }
    }
    } catch {
        $script:taskUiError='GUI stage '+$script:taskUiStage+': '+$_.Exception.Message
        [Console]::WriteLine($script:taskUiError)
        $taskUiTestTimer.Stop(); $taskForm.Close()
    }
})
$taskUiTestTimer.Start()
Write-Output 'GUI_READY'
try { $taskTimer.Start();`);
  gui += `\n$taskUiTestTimer.Stop(); $taskUiTestTimer.Dispose(); if($script:taskUiError) { throw $script:taskUiError }; if($script:taskUiStage -ne 5 -or -not $taskShared.Done) { throw 'GUI event smoke failed at stage '+$script:taskUiStage }; Write-Output 'PASS real PS5.1 Forms event loop, settings, rejected start, stop, close'\n`;
  await fs.writeFile(path.join(root, "gui.ps1"), bom + gui.replace(/^\uFEFF/, ""));
  const guiChild = spawn(ps, ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", path.join(root, "gui.ps1")], { env, windowsHide: true });
  let guiOutput = "", guiReady;
  const ready = new Promise(resolve => { guiReady = resolve; });
  guiChild.stdout.on("data", x => { guiOutput += x; if(guiOutput.includes("GUI_READY")) guiReady(); }); guiChild.stderr.on("data", x => { guiOutput += x; });
  const guiTimeout = setTimeout(() => guiChild.kill(), 30000);
  const guiClosed = once(guiChild, "close");
  await Promise.race([ready, guiClosed.then(() => { throw Error(guiOutput || "GUI did not become ready"); })]);
  const duplicate = execFileSync(ps, ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "gui.ps1")], { env, windowsHide: true, timeout: 10000, encoding: "utf8" });
  assert.match(duplicate, /PASS GUI duplicate refused/); console.log(duplicate.trim());
  await fs.writeFile(path.join(root, "gui-release"), "release");
  const [guiCode] = await guiClosed; clearTimeout(guiTimeout);
  assert.equal(guiCode, 0, guiOutput);
  assert.match(guiOutput, /PASS real PS5.1 Forms/); console.log(guiOutput.trim());
}
main().catch(error => { console.error(error); process.exitCode = 1; });
