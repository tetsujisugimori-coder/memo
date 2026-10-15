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
- 初回Windows CIでは新規OAuth E2Eの空一時履歴が送信前に`history_locked`で起動できなかった。テスト準備のみ、初回の空ディレクトリに限り最大8候補を試す。受信後と再起動では履歴を替えず、認証・永続化失敗を再試行条件にしない。業務側の履歴ロックは変更しない。
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

## PR-4: 任意の安全な要求診断

目的は `Authentication succeeded, action discovery failed` の失敗境界を実測すること。認証条件・HTTP応答・ツール・保存処理は変更しない。新しいHTTPエンドポイントや永続ログは追加しない。通常はOFFで、既存の固定起動ログだけが出る。

専用端末の既存起動コマンドへ `-Diagnostics` を付ける。

```powershell
./start-mcp-http-oauth.ps1 -ConfigPath $taskConfigPath -Diagnostics
```

既存Adapter tokenを安全に入力する手順は上記と同じ。ランチャーは子環境をクリアし、明示指定時だけ `MEMO_MCP_HTTP_DIAGNOSTICS=1` を渡す。親環境に同名フラグがあっても、switchなしの起動はOFF。Nodeを直接起動する場合だけこの固定環境変数でONにできる。既存OS変数・Adapter token・システムCA以外の資格情報は引き継がない。

診断行は起動端末の標準出力へJSONで出す。`diagnostic=memo_http_oauth`、UTC ISO 8601 `timestamp`、起動ごとの一時連番 `sequence` を共通フィールドとする。連番は要求到着順であり、再起動でリセットされる。MCP ID・利用者・本文・tokenから生成しない。

| event | 観測する事実 |
| --- | --- |
| `request_received` | HTTP到達。pathは`mcp`／`metadata`／`other`、methodは`GET`／`POST`／`DELETE`／`other`だけ。`bearerPresent`はBearer方式ヘッダーの有無で、tokenの有効性を意味しない |
| `headers_accepted` | 既存Host／Origin／重複・転送ヘッダー検査の通過 |
| `route_accepted` | MCPパスと入口で許可されたメソッドの検査通過。認証後のPOST専用制限はそのまま |
| `authentication` | 検証のaccepted／rejected、拒否時の401／403と固定分類 |
| `protocol_request` | 認証後に解析したクライアント要求。stageは`initialize`／`tools_list`／`mcp_other`だけ。任意のメソッド文字列は出さない |
| `tools_prepared` | 内部ツール定義生成。件数と想定2ツールの存在。**クライアントのtools/list成功証拠ではない** |
| `protocol_result` | SDK応答のHTTP status、固定分類、success。tools/listの実応答では`toolCount`と`expectedTools`も記録 |
| `protocol_failure` | SDK準備・処理等の例外を固定`mcp_unavailable`／500で記録 |
| `response` | 応答書き出し完了時の最終HTTP status、分類、stage。クライアント受信完了の証拠ではない |
| `response_aborted` | 書き出し完了前に接続が閉じた。固定`connection_closed`。HTTP完了ステータスを断定しない |
| `http_parse_failure` | Nodeの固定HPE系コードによるHTTP解析失敗。固定`http_parse_error`。statusなし。パス・認証状態は未確認 |
| `client_error` | HPE系以外のclientError。既知の通信コードは`connection_closed`、未分類コードは`transport_error`。statusなし。構文不正と断定しない |
| `response_attempt` | clientError後の既存400送信試行。`attemptedStatus=400`だけを記録し、確定`status`は出さない |

処理前半のstageは`headers`／`routing`／`authentication`／`body`。本文解析は認証成功後だけ行う。initialize／tools/listの成功は `protocol_result.success=true` で確認する。HTTP 200でもJSON-RPC errorがあれば失敗。initializeとtools/listは別HTTP要求なので連番も異なり、同じ利用者・セッションと断定するための識別子ではない。観測時間帯とユーザー操作を照合する。

分類は固定許可リスト。既存エラーは `duplicate_header`、`invalid_host`、`invalid_origin`、`invalid_forwarding_header`、`rate_limit`、`method_not_allowed`、`not_found`、`invalid_token`、`subject_forbidden`、`insufficient_scope`、`sessions_not_supported`、`input_too_large_or_encoded`、`json_required`、`input_too_large`、`mcp_unavailable`。JSON-RPC数値コードは `parse_error`、`invalid_request`、`method_not_found`、`invalid_params`、`internal_error`へ対応し、未登録コードは`protocol_error`。その他は`none`、`http_rejected`、`connection_closed`、`http_parse_error`、`transport_error`だけ。SDKの汎用-32000は`protocol_error`とし、任意のerror messageは利用しない。401の署名・期限・aud等を細分化しない。

clientErrorの解析判定はNode提供codeが`HPE_`＋英大文字／アンダースコアの場合だけ。`ECONNRESET`、`EPIPE`、`ETIMEDOUT`、`ERR_STREAM_PREMATURE_CLOSE`、`ERR_SOCKET_CLOSED`は通信エラーとして`connection_closed`へ分類し、それ以外は`transport_error`。codeの文字列自体や例外本文は出さない。通信エラー分類だけでは応答完了を意味しない。

clientErrorでも既存の`socket.writable`判定と`socket.end`による400送信は維持する。書込み可能なら`response_attempt`を記録し、socketの`finish`で初めて`response.status=400`を記録する。`finish`前の`close`は`response_aborted`としstatusを出さない。書込み不能なら試行も完了も記録しない。clientError連番は通常要求とは独立し、同じ要求との対応を断定しない。`finish`はローカル書き出し完了であり、クライアント受信・Tunnel配送の完了証拠ではない（[Node.js clientError](https://nodejs.org/api/http.html#event-clienterror)、[Writable finish](https://nodejs.org/api/stream.html#event-finish)）。

Authorization値、各種token・鍵・code・Cookie、sub・メール、HTTP/MCP ID、メモ本文・タイトル・引数、JWT内容・ハッシュ・断片、HTTPの生本文、任意の例外message／stackは出力しない。追加ログは固定ラベル、真偽値、件数、HTTP status、日時、一時連番だけ。診断writerの例外もHTTP処理へ伝播させない。

### 実機で一度行う観測と安全な復旧

1. 既存8791、履歴、ブラウザ保存領域は保持する。**稼働中8792を自動停止しない。ユーザーが8792を起動した端末でCtrl+Cし、終了を確認する。** このPRの作業ツリーから、同じリポジトリ外設定・同じAdapter tokenで上の診断ON起動を行う。mainの旧ランチャーではswitchを利用できない。
2. 既存Tunnelは同じID・設定のまま維持する。再起動が必要な場合だけ、ユーザーが元の端末で停止し、従来のAuthenticated起動を行う。同じIDのTunnelを二重起動しない。Auth0／ChatGPT登録・アクセス条件を変更しない。
3. 操作開始・終了時刻をUTCで控える（`[DateTime]::UtcNow.ToString('o')`）。起動プローブのBearerなし401を先に記録し、ログイン後の要求と区別する。
4. ChatGPTの既存 **Memo-Nexus OAuth Dev** で接続・ツール検出を一度試す。必要なログイン／認可をユーザーが行う。ログイン成功・赤い警告の有無・表示ツール件数を控える。資格情報・HAR・生HTTPログを採取しない。
5. 当該時間帯の診断行を連番で照合する。必要な共有情報は診断JSON行とChatGPTの結果だけ。tools/list成功かつ`toolCount=2`・`expectedTools=true`ならChatGPTの表示も確認する。検出成功前にメモ送信・保存を実証済みと扱わない。
6. 終了はユーザーが診断8792の端末でCtrl+Cする。ランチャーのfinallyは自分の子だけを終了する。同じ設定・tokenで `-Diagnostics` を外して再起動すればOFFに戻る。8791・履歴・保存領域・認証設定・キーの変更は不要。

| 観測 | 判断と次の確認 |
| --- | --- |
| 操作時間帯にHTTP到達ログなし、またはBearerなしのみ | 認証付き要求の8792到達は未確認。Tunnelの転送・配送状態を調べる。これだけで「tokenが送信されていない」と断定しない |
| `bearerPresent=true`、authentication rejected 401 | Bearer方式の要求は届いたが既存認証検証で拒否。署名／期限／aud等の具体的理由はこのログでは未特定 |
| authentication rejected 403 | `subject_forbidden`／`insufficient_scope`で拒否。headers段階の403と区別する |
| authentication accepted、initialize失敗 | 初期化境界。statusと固定分類を確認する |
| initialize成功、tools_list失敗 | 一覧取得境界。ただし別要求を同じ主体のものと連番だけで断定しない |
| tools_list成功、2ツール、ChatGPT表示0 | ローカル応答生成は成功。Tunnel配送とChatGPT側公開の確認を続ける。応答生成だけで配送成功を断定しない |
| 上記に加えてChatGPT表示2ツール | 認証付き検出成功。メモ保存の実証は別途行う |

TunnelのHTTP接続で `unknown/not_observed` はsame-child証拠未取得の場合があり、単独で通信失敗を示さない。特定できなければ観測事実と不足証拠を残す。PowerShell 7の既知ヘッダー互換性問題は今回未変更で、必要なら別Issueとする。

### PR-4検証記録

基準mainは`4037296`（PR #363マージ済み）。既存work・未追跡ファイルを保持し、専用worktree／branchで実装。2026-10-15の着手時に既存8791／8792・Tunnelの稼働、既存8792 Metadata 200・BearerなしPOST 401、Tunnel `/readyz` 200を確認した。既存プロセスは停止・再起動していない。

- 成功: OAuth／discovery単体16件。OFF時ログ0、ON到達・結果、Bearerなし／不正token 401、未許可利用者／scope不足403、initialize／2ツール一覧、SDKの200＋JSON-RPCエラー／406、内部例外500、HTTPパーサー400、writer例外、秘密情報非出力、ON/OFFのHTTP本文・認証結果・主要ヘッダー一致。
- 成功: Windows PS 5.1ランチャー構文と既存実起動・競合・子PID終了。隔離fixtureで診断switch ON／OFF、親フラグ非継承、Adapter token／CA保持、runtime／browser／OAuth／NODE_OPTIONS非継承を検証。対話Ctrl+Cは自動試験していない。
- 成功: 既存OAuthブラウザ統合試験。模擬issuer・RSA鍵・一時履歴・隔離ブラウザで受信、手動保存／破棄、再起動／再送、既存メモ保持を確認。最初のsandbox実行は`history_permissions`で失敗し、同じ試験を通常Windows権限で再実行して成功。認証条件や期待値を緩めていない。
- 成功: 既存dummy／文章／複数メモの単体19件（stdio契約と受信仕様を含む）。`git diff --check`成功。変更は診断・ランチャーswitch・対応テスト・文書の5ファイルだけ。
- 未実施: 実Auth0アクセストークンによる認証付きinitialize／tools/listとChatGPT表示。稼働中8792のユーザーによる切り替えとChatGPT操作が必要。原因A〜Fの特定はまだしていない。実環境のOAuth／Control Plane／Response Delivery詳細状態は今回再観測していない。
- 未実施: 実Tunnel binary再試験、無関係なChart／Report長時間E2E。既存CIは変更しない。

### P2/P3レビュー修正の検証

基準HEADは`ffc25d58a4a9336eeb4a67eccbb824bfbab4e6c1`。変更はclientErrorの診断、直接関連テスト、本書の3ファイルだけ。`socket.writable`と400を書き込む既存処理はそのままで、認証・MCP・受信・保存処理は変更していない。

- 成功: 変更箇所3試験を先に実行し、次にOAuth／discovery関連18試験が成功。実ソケットの構文不正400についてON/OFFの生応答一致と、分類→試行→finishによる完了の順序を確認。
- 成功: 固定コードを注入する決定的試験で、HPE系、ECONNRESET等5コード、未知／欠落コードを、書込不能・完了前切断・完了に分けて確認。完了前にstatusが出ず、writer例外でも既存socket.endの引数・回数が変わらない。例外本文・rawPacket・任意codeの出力なし。
- 成功: 模擬JWKS応答を待機させた実HTTP接続をクライアントから切断し、実ServerResponseのcloseがfinishより先に発生したこと、`response_aborted`にstatusがないこと、OFFログ0を確認。
- 未確認: 実OSのECONNRESETコード発生そのものは再現していない（分類はコード注入で検証）。実Auth0／ChatGPT、実Tunnel配送、対話Ctrl+Cは今回未実施。以前の模擬ブラウザE2E成功記録を今回の再実行や実環境成功と扱わない。
- CIは既存構成のまま更新HEADの結果をPRで確認する。無関係な長時間E2Eをローカル追加実行しない。
