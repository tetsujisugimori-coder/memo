# PR-4前半: OAuth導入準備・認証設定検出用

OAuth認証は未実装。新しいHTTP入口はProtected Resource Metadata (PRM)と401の案内だけを提供し、Bearerの有無・形式を問わず、initialize、pingを含む全MCP要求を401で拒否する。認証後のStreamable HTTPセッション／JSON-RPC処理はまだ提供しない。ツール一覧の成功やメモ受信を目標にしない。

stdio入口、8791の受信サービス、保存基盤、ブラウザ、既存ランチャーは変更しない。新入口はそれらのコードをimportせず、外向きHTTPも行わない。SDKは認証ゲートより後の処理がない今回には追加しない。

## 用語と確定状況

| 値 | 意味 | 今回の扱い |
| --- | --- | --- |
| `http://127.0.0.1:8792/mcp` | tunnel-clientからローカル入口への通信先 | 既存5500/8787/8791を避けた専用ポート。実装前の待受一覧で空きを確認、起動時のbind競合でも停止 |
| ChatGPT側のTunnel接続先 | OpenAIサービス側が使用する接続先 | 実接続では未確認。Tunnel名やIDから生成しない |
| PRMの`resource` | 保護対象を識別する完全なURI | 明示設定。初回ローカル検証は上のloopback URI。Auth0登録値の確定ではない |
| OAuth要求の`resource` | クライアントが認可／トークン要求に渡す対象 | ChatGPT実観測が必要。PRMとの一致を確認する |
| Auth0 API Identifier／トークンの`aud` | Auth0 APIを識別し、後半でトークンの対象を検証する値 | 未確定。PRMやTunnel URLとの一致を推測しない。Auth0への`audience`指定とRFC 8707の`resource`対応も後半で確認 |
| `resource_metadata` | 401からPRMを取得するためのURL | 設定resourceのorigin + `/.well-known/oauth-protected-resource/mcp`。Hostから生成しない |
| `authorization_servers[0]` | Auth0 issuer | 実開発テナントのHTTPS root URLを明示設定。末尾`/`を含む |
| `authorization_endpoint`／`token_endpoint` | ログイン先／トークン発行先 | Auth0の公開OIDCメタデータから取得。ローカルで発行・模倣しない |

Adapter token（stdio→受信）、ブラウザtoken（ブラウザ→受信）、Tunnel runtime API key（client→OpenAI）、OAuth token（将来の利用者認証）は別物。新入口にはどれも認証情報として受け入れる機能がない。

## 設定とローカル起動

前提はNode 22以上、Windows PowerShell 5.1。例のテナント名とscopeは仮の値。設定ファイルは秘密値を必要としない。実テナント設定はアクセス制限したリポジトリ外の作業場所へ保存する。キーやtokenを追加しない。

```powershell
# このPRの作業ツリーへ移動してから実行する。
$taskConfigPath = Read-Host 'Absolute path for your non-secret discovery config JSON outside the repository'
Copy-Item -LiteralPath ./mcp-http-discovery.config.example.json -Destination $taskConfigPath
notepad.exe $taskConfigPath
```

`authorization_servers`を実テナントissuerへ置換し、`scopes_supported`は検討中の最小scopeを明示する。例の`memo:submit`はAuth0へ登録済みという意味ではない。初回の`resource`はローカルで返す観測用値として維持する。HTTPS resourceを設定する場合もこの段階では`/mcp`パスだけを受け付ける。

設定不足、不正URL、URL内の資格情報・query・fragment、曖昧な正規化、scope内の空白や引用符、予約ポート、未知設定キーでは起動しない。issuerは1個のHTTPS root URLに限定する。この検査はAuth0テナントの実在や所有権の確認ではない。

```powershell
./start-mcp-http-discovery.ps1 -ConfigPath $taskConfigPath
```

専用ターミナルを維持する。`127.0.0.1`のみで待ち受け、外部公開やポート開放を行わない。秘密値を含む親環境は子Nodeへ渡さず、OS必須変数だけを渡す。設定不備の生の値、要求本文、Authorization、Hostの入力値はログに書かない。端末のTranscriptやHTTP rawログを有効にしない。

別のPowerShellでローカル確認:

```powershell
curl.exe --noproxy '*' -sS -i http://127.0.0.1:8792/.well-known/oauth-protected-resource/mcp
curl.exe --noproxy '*' -sS -i http://127.0.0.1:8792/.well-known/oauth-protected-resource
curl.exe --noproxy '*' -sS -i -X POST http://127.0.0.1:8792/mcp
curl.exe --noproxy '*' -sS -i -X POST -H 'Authorization: Bearer deliberately-invalid-test-value' http://127.0.0.1:8792/mcp
```

最初の2つは同じJSONの200。後の2つは401と`WWW-Authenticate: Bearer resource_metadata="http://127.0.0.1:8792/.well-known/oauth-protected-resource/mcp", scope="memo:submit"`。scopeを変更した場合は設定値に従う。実tokenをcurl引数へ入れない。

Hostは実待受の`127.0.0.1:port`に限定。Originがあれば同じローカルoriginだけを許可。不正Host／Origin／転送ヘッダーは403、未知パス（query付きも含む）は404、未知メソッドは405。PRMはGETのみ。`/mcp`のGET/POST/DELETEは認証ゲートで401になる。SSEやセッション削除は未解禁。認可サーバーのwell-known、authorize、tokenのローカル実装はない。

## 既存実証からの切替と終了・復旧

1. 旧実証への新規送信を止め、必要な保存状態を確認する。旧受信サービス、ブラウザ、履歴ファイルは保持する。既存ユーザープロセスを自動停止しない。
2. ユーザー自身が旧Tunnelクライアントの専用ターミナルを特定し、そこでCtrl+Cで終了する。`Get-Process -Name 'tunnel-client*'`で確認する。プロセスの全コマンドラインや環境を出力しない。
3. HTTP入口だけを上の専用端末で起動してローカル確認する。
4. 別の専用端末で、既存の安全な手順でruntime keyと同じTunnel IDをプロセス環境へ用意する。キーをコマンドや設定JSONに直書きしない。新規キーを作成しない。
5. 手元のexeを確認して専用Tunnelランチャーを実行する。

```powershell
$taskTunnelPath = Read-Host 'Absolute path to your tunnel-client.exe'
& $taskTunnelPath --version
& $taskTunnelPath run --help
./start-mcp-http-discovery-tunnel.ps1 -TunnelClientPath $taskTunnelPath -ConfigPath $taskConfigPath
```

対応確認済みbuildは`0.0.16+5f99daabd4aa4a77049e6d81d54a0d8c18335397`。別buildは拒否する。`--mcp.server-url`でHTTP接続し、stdioコマンドを渡さない。このbuildに`--mcp.transport`はない。issuerのoriginだけを`--mcp.oauth-trusted-origin`に指定する。ローカルHTTPのPRMをTunnel側が取得できるよう`--harpoon.allow-plaintext-http`を明示し、health/adminも`127.0.0.1:0`。これは認証を省略する指定ではなく、新入口は全操作を拒否し続ける。

ランチャーは既知のtunnel-clientプロセスがあれば拒否する。同じWindowsセッション内ではTunnel ID単位のmutexでこのランチャーの同時起動も防ぐ。名前変更されたexe、別セッション・別端末のクライアントまで判定する保証はないため、同じIDを使うクライアントが他にないことをユーザーが確認する。既存クライアントを自動終了しない。

子Tunnelへ渡す環境はOS変数と既存runtime key／Tunnel IDだけ。親環境のstdioコマンド、追加Authorization、profile、危険なログ設定を引き継がない。raw HTTPを明示的に無効化する。企業proxy/mTLS等が必須の環境はこの最小ランチャーでは未対応として停止し、TLS検査を無効化して回避しない。runtime keyは子Nodeへ渡さない。

終了時は新Tunnelの端末でCtrl+C、次にHTTP入口の端末でCtrl+C。それぞれ自分が起動した子だけをfinallyで停止する。別端末から終了する必要がある場合は、当該ランチャーが出した子PIDを同じ稼働中に確認して、その子だけを`Stop-Process -Id <確認した子PID>`で停止する。PIDの再利用や一括終了を避ける。Ctrl+Cの対話操作自体はユーザー実機で確認する。

復旧は新Tunnelが終了したことを確認してから既存`start-dummy-preview-tunnel.ps1`を従来の手順で実行する。同じ既存受信サービス／履歴／ブラウザを利用し、Adapter tokenを従来どおり隠して入力する。新HTTP用設定や仮scopeを旧stdioへ渡さない。ChatGPT側の接続変更をした場合はユーザーが元の設定へ戻す。履歴削除、鍵の再発行、プラグインの作成・削除は行わない。

## Tunnel経由とChatGPT側resourceの観測（ユーザーと手動）

ここはローカル検証とは別の実接続検証。Auth0アカウント/API/アプリ、ChatGPT接続設定の作成・変更をこのPRの自動処理で行わない。

1. 上記のHTTP入口へ同じ`Memo-Nexus Local MCP`のクライアントを切り替えた状態にする。ChatGPT側に既存接続がなければ、その事実を記録してここでユーザーと次の操作を相談する。
2. ブラウザの開発者ツールを開き、Networkで記録を開始してから、既存接続の認証設定の再検出をユーザーが実行する。既存UIの更新・再試行操作を利用する。管理画面に接続先URLが表示されることは前提にしない。
3. 認証検出に対応する要求を特定し、**応答JSONのPRM（`resource`、`authorization_servers`、`scopes_supported`）**、またはOAuth検出応答の同じ項目を確認する。検出経路の401／`WWW-Authenticate`／`resource_metadata`も取得できる場合は値を控える。ブラウザからloopbackへcurlした応答はTunnel経由の証拠にならない。
4. ChatGPTフロントエンドへ返るJSONにPRMが含まれなければ、取得済みとしない。利用可能な診断応答をユーザーと調べる。認可要求への遷移が行われた場合は、Networkの認可要求URLの**`resource`パラメーターだけ**をURLデコードして確認する。ログイン完了・token発行は行わなくてよい。PRM本文を確認できた事実と、認可要求の値を確認できた事実は別々に記録する。
5. 手動入力したissuer、client ID、scope、resource等は「手動入力」として別欄に残す。自動検出値の証拠にしない。トークン、cookie、Authorization、client secret、認可code、state、PKCE情報を含むHAR、画面全体、認可URL全体は共有しない。DevToolsで必要項目だけを抜き出す。401やローカルログの成功だけをChatGPT検出成功としない。
6. 自動検出後に`resource`が全文取得できない、検出操作がない、Auth0クライアント未作成で先へ進めない場合は「未確認」とする。次に必要なのは該当UIでの再検出とその検出応答JSONの確認であり、Tunnel IDからのURL生成や推測によるAuth0登録ではない。必要なら公開仕様と観測したエラーだけを使って次の調査を行う。

証跡は秘密値のない次の表で記録する。resourceの末尾パス、末尾slash、port、大小文字を省略しない。

| 項目 | 完全な値・根拠 |
| --- | --- |
| 観測日時・client build | 未確認 |
| ローカルPRM resource | 自分の設定JSONとcurlの200応答 |
| ローカル401 resource_metadata | curlの応答ヘッダー |
| Tunnel検出応答のresource | 未確認（応答の取得操作／項目名を記録） |
| ChatGPTへ提示されたPRM resource | 未確認（ブラウザ応答JSONの該当項目） |
| ChatGPT認可要求のresource | 未確認（当該パラメーターだけをデコード） |
| 自動検出issuer／scope | 未確認 |
| 手動入力した値 | 実操作時に別記 |
| Auth0登録候補と根拠 | 未確定。実ChatGPT値とAuth0 audience対応を確認後に検討 |

**現時点でAuth0へ登録できる確定候補はない。** ローカルURIは観測用であり、実クライアント→模擬Control Planeの値をAuth0 API識別子に流用しない。実観測で異なるresourceが得られた場合は両方と観測箇所を記録し、どの値がAuth0のaudienceとなるか後半で設計する。設定resourceを変更する場合も、手動で根拠を確認し、HTTP入口とクライアントを停止して再起動する。自動書換え／再設定はしない。

## 検証結果と残作業

実装元main: `2a27dfcd66f1abbc4bc4dc1bd1489188f97dddc6`。#353／#356／#358を含む。作業前にfetchし、既存変更・履歴・サービスを保持。OAuth重複実装なし。既存の未追跡workツリーを変更しない。

- 新規単体5群: パス付き／root PRM、401からの案内、異常設定、Host/Origin/転送ヘッダー、未知パス・メソッド、全操作拒否、外向き通信0・既存受信リクエスト0・キュー投入0、固定診断とポート競合を検証。
- 全単体1,832件成功（Windows Node v24.20.0）。初回の制限環境では既存履歴ACL試験7件が`history_permissions`、通常ユーザー権限で同じ全試験が成功。ACL処理の実装変更は行わない。
- 既存E2E: dummy-preview、received-preview、received-concurrency、received-notes、received-recovery（実サービスとUI）が成功。隔離ブラウザ／履歴のみを使用。
- `node mcp-http-discovery.windows-check.js`: PS 5.1構文、実起動、日本語・空白・引用符入り設定パス、メタデータ、Bearer付き401、ポート競合で元サービス維持、固定ログ、子PID終了と待受消失を確認。CIのWindowsジョブにも追加。
- `node mcp-http-discovery.tunnel-check.js <実exe> <openssl.exe>`: 既存ZIPの実buildを使用し、生成したテストキー、loopback模擬Control Plane、ローカルHTTPSのASメタデータfixtureだけで実行。fixtureにログイン／token発行機能はない。実Auth0／実Tunnel／ChatGPTには接続しない。
- その実測では設定resource／client応答resourceがともに`http://127.0.0.1:56377/mcp`（一時ポート）で一致し、クライアント側の書換えは観測されなかった。`/mcp`の401とパス付きPRMの200も確認。一方、模擬ASの自己署名証明書は`--ca-bundle`を渡してもこのWindows buildで拒否され、AS検出成功ではない。PRM応答は200のため、それだけでOAuth検出全体の成功を判断しない。公開Auth0証明書の検証結果は未確認。TLS検証を緩めない。
- 実接続、Auth0の公開メタデータ、ChatGPTの検出resourceと認可要求、実トークンのaud、対話Ctrl+Cは未確認。CI結果と模擬クライアント観測値はPRの最終検証欄を参照。

PR-4後半: 実ChatGPT resourceの根拠付き確定、Auth0 API Identifier/audienceとscopeの設計、ユーザーによるAPI／OAuthクライアント登録、PKCEと公開メタデータの互換性確認、issuer/aud/署名/期限/scope等のトークン検証、認証後のMCPプロトコル処理、許可業務の限定接続、エラーと回帰試験。これらが完了するまでHTTP業務操作を解禁しない。

## 公式仕様（参照日: 2026-10-14）

- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [MCP Authorization 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [RFC 9728: Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728.html)
- [tunnel-client: 手元build固定のconfiguration](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/docs/configuration.md)／[OAuth discovery実装](https://github.com/openai/tunnel-client/tree/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/oauth)
- [Auth0 API Settings](https://auth0.com/docs/get-started/apis/api-settings)／[Auth0 OIDC Discovery](https://auth0.com/docs/get-started/applications/configure-applications-with-oidc-discovery)

公開masterの説明と手元buildの実測を同一扱いしない。トンネルサービス側の書換えはこのローカル実行だけでは確認できない。
