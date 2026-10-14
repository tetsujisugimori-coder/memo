# PR-4後半: Auth0 OAuth認証付きHTTP MCP受信

Auth0のアクセストークンを検証し、許可した利用者の文章／複数メモ送信だけを既存受信サービスへ接続する。受信時には保存しない。未保存プレビューからユーザーが手動で保存・破棄する。既存メモの読み出し・編集・削除ツールは追加しない。既存メモの保存形式、コレクション、ブラウザUIは変更しない。

## 認証・認可と保存の境界

- `mcp-http-auth.js`: `jose`でRS256署名、固定issuer、API audience（文字列／配列）、exp、iat、任意nbf、subとscopeの型を検証する。時刻許容差は5秒。未来iatも拒否する。scopeは空白区切りで`memo:submit`と完全一致することが必要。
- 利用者は設定の`allowedSubjects`へAuth0の`user_id`／subを完全一致で登録する。未設定・空リストなら起動しない。同一テナントの別利用者、メールアドレスだけの認可、M2Mの`client-credentials`／`@clients`は許可しない。DCR Client IDとChatGPTアプリIDは認可主体に使わない。
- issuerの公開OIDCメタデータからJWKS URIを取得する。メタデータのissuer完全一致、JWKSのHTTPS・同一origin、redirect拒否、3秒タイムアウト、256 KiB上限を検査する。tokenのjku／x5uは取得先に使わない。TLS検証を維持する。
- JWKSは10分キャッシュ。未知kidは直近の成功取得から30秒後に再取得できる。並行取得はライブラリが共有し、失敗した外部取得も30秒抑制する。更新中・取得失敗・不明鍵は認証成功にしない。既存の有効なキャッシュ内鍵は期限内で利用する。
- `mcp-http-server.js`: HTTP要求ごとに認証・認可する。未認証・不正tokenは401とBearer案内。署名等が正しくてもscope不足・未許可subは403。認証エラーはHTTP応答、業務引数エラーはJSON-RPCエラーとして返す。
- 公式SDKのstateless Streamable HTTPを使用する。initialize、通知、ping、tools/list、tools/callをSDKが処理する。セッションIDは発行しない。セッションIDによる認証省略、SSE、再開、batchは提供しない。認証済みGET／DELETEは405。
- 公開ツールは`submit_text_preview`／`submit_notes_preview`のみ。既存stdioのツール名、スキーマ、検証、結果契約を再利用する。OAuth tokenは受信サービスへ送らず、HTTPサーバー内の既存Adapter tokenでloopbackへ送信する。
- 同じrequestIdを別主体が使っても混線しないよう、`issuer + sub + 元requestId`から受信用UUIDを決定的に導出する。HTTP入口再起動後も同じIDになる。受信履歴へsubや対応表を追加しない。MCP結果のrequestIdは送信元の値、ブラウザ／受信履歴のrequestIdは導出した値となる。各itemIdは既存受信サービスが発行する。HTTP／stdioで同じ元IDを使うことを同一要求とは扱わない。再送は同じ経路・主体・元ID・原文で行う。
- 受信キューの原文検査、重複防止、部分保存、再送、履歴、復旧を変更しない。HTTP送信は保存操作を呼ばない。受付不能・競合・受信サービス不通を成功と返さない。

要求・本文・Authorization・sub・cookie・認可codeはログへ出さない。入口の起動失敗は固定診断のみ。OAuth access token以外のID token（API audience／scope不一致、nonce付き）、Tunnel runtime key、Adapter token、ブラウザtokenは認証として受け入れない。

## 設定をリポジトリ外へ用意する

Node 22以上（WindowsシステムCAを使う場合は22.19以上推奨）、Windows PowerShell 5.1。`npm ci`でlockfileの依存を導入する。直接追加した依存は`@modelcontextprotocol/sdk 1.32.1`と`jose 6.2.12`。採用時点: 2026-10-14。OAuthサーバー、JWT暗号、Streamable HTTPを独自実装しない。

```powershell
$taskConfigPath = Read-Host 'Absolute path for OAuth config outside every Git checkout'
Copy-Item -LiteralPath ./mcp-http-oauth.config.example.json -Destination $taskConfigPath
notepad.exe $taskConfigPath
```

サンプルは明確な架空値。実テナント、利用者ID、実resourceはコミットしない。設定内に秘密値やtokenを追加しない。絶対パスで指定し、Git作業ツリー内の設定ファイルは認証付き入口が拒否する。

| 項目 | 入力する値・根拠 |
| --- | --- |
| `mode` | `authenticated`。準備用設定だけでは起動しない |
| `port` | 通常8792。loopbackのみ。5500／8787／8791は予約 |
| `resource` | ChatGPTのOAuth詳細画面で取得した保護対象の全文。今回の実観測ではHTTPSの`/v1/mcp/<tunnel_id>`で、末尾slashなし。IDから生成しない |
| `audience` | Auth0 API Identifierの全文。今回ユーザーは観測resource全文を登録済みと報告。実tokenのaud一致は実機確認が必要 |
| `resource_metadata` | サンプルの`http://127.0.0.1:8792/.well-known/oauth-protected-resource/mcp`。TunnelクライアントがローカルPRMを取得するための明示URL。実待受portに合わせる。HTTPSの明示PRM URLも設定可能 |
| `authorization_servers` | Auth0 issuerのHTTPS root URLを1件。末尾`/`を含む完全一致 |
| `scopes_supported` | `["memo:submit"]`のみ |
| `allowedSubjects` | 今回作成した利用者のAuth0 `user_id`を1件。メールアドレス、DCR Client ID、ChatGPTアプリIDではない |

ローカル通信先`http://127.0.0.1:<port>/mcp`、PRM resource、Auth0 audienceは別の設定／用途。Hostや転送ヘッダーから識別子を生成しない。末尾slash、パス、大小文字は正規化しない。準備用入口の`/mcp`限定検査は変更せず、認証付き設定ではHTTPSのpublic resourceの完全なパスを扱う。

利用者IDの取得: Auth0 Dashboardの **User Management → Users → 今回作成した利用者** を開き、詳細の **user_id**（通常`auth0|...`）をローカル設定の`allowedSubjects`へ入力する。チャットへの貼付や実tokenの共有は不要。Auth0登録を自動変更しない。IDの変更・許可リスト変更後はHTTP入口を再起動する。

## 切替・停止・復旧

既存ユーザープロセスは自動停止しない。実機確認前に未処理プレビュー・保存状態を確認し、既存履歴とブラウザ保存領域を保持する。

1. ユーザー自身が現在の準備用Tunnelの専用ターミナルを特定し、Ctrl+Cで終了する。次に準備用HTTP入口の端末をCtrl+Cで終了する。同じIDのTunnelを同時に起動しない。
2. 既存8791受信サービスを維持する。停止中なら従来の手順で同じ履歴ディレクトリ・同じ内部tokenを使って起動する。新規履歴へ勝手に切り替えない。HTTP入口は受信サービスを自動起動しない。
3. 別の専用PowerShellで、既存Adapter tokenを隠して入力し、認証付き入口を起動する。新しいtokenを発行しない。コマンドライン・設定JSON・Transcriptへ秘密値を書かない。

```powershell
$taskConfigPath = Read-Host 'Absolute path to OAuth config outside the repository'
$taskSecret = Read-Host 'Existing receiver Adapter token' -AsSecureString
$taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
try {
    $env:MEMO_PREVIEW_ADAPTER_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
    ./start-mcp-http-oauth.ps1 -ConfigPath $taskConfigPath
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)
    Remove-Item Env:MEMO_PREVIEW_ADAPTER_TOKEN -ErrorAction SilentlyContinue
    $taskSecret.Dispose()
}
```

子NodeにはOS変数、Adapter tokenと`NODE_USE_SYSTEM_CA=1`のみを渡す。Windowsの信頼済みCAを利用し、TLS検証を無効化しない。NODE_OPTIONS、runtime key、ブラウザtoken、OAuth token、proxy資格情報は引き継がない。起動ログにはportと固定の状態だけを出す。

4. PRMと未認証401をローカル確認する。これは実OAuthトークン検証の成功ではない。

```powershell
curl.exe --noproxy '*' -sS -i http://127.0.0.1:8792/.well-known/oauth-protected-resource/mcp
curl.exe --noproxy '*' -sS -i -X POST http://127.0.0.1:8792/mcp
```

5. 別端末で既存runtime key／Tunnel IDを従来の安全な手順でプロセス環境へ設定し、同じ実buildを使用する。

```powershell
$taskTunnelPath = Read-Host 'Absolute path to tunnel-client.exe'
$taskConfigPath = Read-Host 'Absolute path to the same OAuth config'
./start-mcp-http-discovery-tunnel.ps1 -TunnelClientPath $taskTunnelPath -ConfigPath $taskConfigPath -Authenticated
```

認証付き設定は`-Authenticated`を明示しないと拒否する。準備用設定へ同switchを付けても拒否する。Tunnel起動前はPRMの明示設定との一致と未認証401を確認する。既存のプロセスガード、ID別mutex、固定build、最小子環境、raw HTTPログ無効を維持する。

終了は、自分が起動した新Tunnelの端末でCtrl+C、次に認証付きHTTP入口の端末でCtrl+C。ランチャーは自分の子のみをfinallyで終了する。受信サービス／ブラウザ／履歴は保持する。

準備用へ戻す場合は両方の終了を確認し、以前のリポジトリ外discovery設定で`start-mcp-http-discovery.ps1`、`start-mcp-http-discovery-tunnel.ps1`（`-Authenticated`なし）を起動する。旧stdioへ戻す場合は従来の`start-dummy-preview-tunnel.ps1`を使う。HTTPで送った要求の再送はHTTPへ戻して同じ許可sub・元requestId・原文で行う。stdioへの再送では別IDになる。履歴削除、ブラウザ保存領域削除、Auth0／ChatGPT登録の変更、キーの再発行は不要。

## 検証した事実と未確認

実装元mainは`49c9a2ec6176935141e0cf3b3e1c2b0db2dd5e49`。PR #361はマージ済みで、参考HEADはそのPRのHEAD。未追跡work、他の作業ツリー、既存プロセス、実履歴・実ブラウザ保存領域は保持した。

- 単体: 実RSA署名でissuer／aud文字列・配列／scope／許可subを検証。不正署名・alg・issuer・aud・exp・未来nbf／iat・claim欠落／型不正・ID token／内部tokenを拒否。scope部分一致と未許可subは403。JWKSの失敗、3秒timeout、キャッシュ、ローテーション、未知kidと30秒抑制、メタデータ信頼境界を確認。拒否・未知kid・JWKS失敗時の受信HTTP要求数／キュー投入数は0。
- Windows Node v24.20.0の全単体1,840件成功（今回の認証／SDK連携8群を含む）。公式SDK HTTPクライアントによる接続・一覧・送信も成功。`git diff --check`成功。PRのCI結果はPR上で別途確認する。
- HTTP: SDKのinitialize、通知202、ping、2ツール一覧、文章・複数メモ、引数拒否、本文上限、Host／Origin／転送ヘッダー検査、JSON／protocolエラー、セッション拒否、受信不通時のisErrorを確認。同一元requestIdの別主体は別受信IDとなり、既存内容・結果へ流入しない。
- ブラウザ: 架空issuerと鍵、一時履歴、新規保存領域だけを使用。OAuth HTTPから文章・複数メモが未保存表示に届き、手動保存・破棄、再送、HTTP／受信再起動後の原文復旧を確認。既存メモ保持、受信だけではIndexedDB変更0。履歴に本文・token・subを記録しない。
- 既存回帰: stdio dummy／文章／複数メモ、保存失敗、同時操作、実プロセス再起動とブラウザ復旧E2Eが成功。既存のstdio契約と保存基盤は維持。
- Windows: PS 5.1構文、準備用の実起動・競合・停止、認証付きランチャーの空許可リストでの起動拒否・固定診断・秘密値非出力を確認。
- 実Tunnel binary: `0.0.16+5f99daabd4aa4a77049e6d81d54a0d8c18335397`を模擬Control Planeへ接続。Bearer転送、ローカルHost、転送ヘッダーなし、initialize／一覧／文章／複数メモ、未認証401、public resource全文の保持、warnログの秘密値／本文非出力を確認。実OpenAIサービス側の書換えを実証したものではない。

2026-10-14のユーザー実機報告では、Auth0 RS256 APIと`memo:submit`、DCR、ログイン、認可code交換の成功記録、ChatGPTの同じOAuthプラグイン登録と完全なresource取得を確認済み。これらはユーザー報告であり、今回の自動検証で実テナント設定を再確認したとは扱わない。

**実Auth0 tokenの署名／aud／scope／subと、同じOAuthプラグインからの最終一連操作は未確認。** 赤いバナーの内容、実テナントの最終アクセス方針保存状態、OpenAIサービス側のPRM／resource_metadata書換え、対話Ctrl+Cも未確認。通常CIは外部Auth0を必須条件にしない。

## ユーザーと行う最小限の最終実証

1. 今回のAuth0利用者のuser_idを取得してリポジトリ外設定へ入力し、resource／audienceを実画面・API Identifierから全文転記する。許可設定を推測しない。
2. 上の手順で既存受信サービスを保持して準備用HTTP／Tunnelを切り替える。ChatGPTでは既存の **Memo-Nexus OAuth Dev** を使う。旧認証なし登録を取り違えない。
3. 同じOAuthプラグインで認証付き2ツール一覧を取得する。Auth0のアプリ別ユーザー委任で`memo:submit`が保存されていることを必要に応じて確認する。M2Mを許可しない。
4. テストと明示した文章を1件送信し、ブラウザで「未保存」を確認する。意図した保存先で手動保存し、保存後の再送で重複がないことを確認する。
5. テスト複数メモを送信し、未保存表示から1件を手動保存・別1件を破棄する。結果とブラウザの各item状態を照合する。

401はトークン不在・検証失敗、403はscope／利用者不許可。MCPのisErrorは受信不通・競合・容量など。実tokenをcurl引数、HAR、チャットへ貼らない。接続失敗時は固定状態コードと上記境界を確認する。認証なしへ自動フォールバックしない。

## 公式仕様・採用根拠（2026-10-14確認）

- [MCP Authorization 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)、[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [公式TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[採用SDKのnpm公開情報](https://registry.npmjs.org/@modelcontextprotocol/sdk/1.32.1)
- [jose](https://github.com/panva/jose)、[Remote JWKSのキャッシュと未知kid](https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md)
- [Auth0のアクセストークン検証](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens)
- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)、[固定buildのヘッダー転送](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/mcpclient/internal/roundtripper.go)
- [ChatGPTのツール別OAuth宣言](https://developers.openai.com/plugins/build/auth): 2ツールとも`securitySchemes`で`oauth2`／`memo:submit`を宣言し、互換用`_meta`にも同じ値を載せる。サーバー側のHTTP認証ゲートは常に検証する。

公式SDKでMCP、joseでJWT／JWKSを扱い、アプリ側は認可境界と既存受信への接続に限定する。ローカル模擬試験、ユーザー報告、実機で未確認の項目を混同しない。
