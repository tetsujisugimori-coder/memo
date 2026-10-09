# PR-1：未保存ダミーのブラウザ受信実証

> この文書の実装・試験記録は各PR当時のものです。現在の永続履歴、再起動復旧、上限運用、保証範囲は [再起動復旧仕様](received-preview-recovery.md) を参照してください。旧版のメモリ履歴は移行できません。
基準main: `bc3b7c638064ef5b1b3d2e649ccf04c48f8b3aae`（2026-10-08にfetch、一致）。実装SHAはこの文書を含むPRのheadを参照する。関連既存PRは #123（保存基盤）、#129（Codex保存）、#171（Clipper転送）、#116（Bridge）。開始時のopen PRは0件。元作業ツリーは未追跡`work/`のみで、専用worktree／`feat/unsaved-dummy-browser-preview`に分離した。

指定された引継ぎ・接続実証・技術調査の2026-10-08資料3点はリポジトリ／Documents配下で取得できなかった。読んだ資料として扱っていない。本依頼と基準コードを使用した。

## 実装した経路と制限

外部AI → Secure MCP Tunnel → 独自stdio MCP → 専用HTTP受信サービスのメモリキュー → 明示的な「受信を確認」 → 独立ダイアログ。担当による独立検証は実stdioプロセスからブラウザまで。2026-10-08 15:44〜15:46 JSTのChatGPT／Tunnelを含むローカル経路は、後述のユーザー実証として別に記録する。HTTP投入やローカルMCPの成功をChatGPT経由成功とは扱わない。

`submit_dummy_preview`だけを公開し、引数は`requestId`だけ。呼び出し側が小文字UUID v4を生成し、再送時は同じIDを保持する。アダプターとサービスの両方で形式を検証する。メモIDの生成・受け渡しはない。タイトル・本文・formatVersion=1・dummy=trueは`dummy-preview-queue.js`の固定fixtureから組み立てる。応答は「一時キューで受信・未保存」、requestId、固定title/body、state、saved=false。ブラウザ未接続でもqueuedであり、表示確認にはならない。

- 固定テキスト／Markdown1件。タイトルはUnicodeコードポイント200以内、本文UTF-8で64KiB以内。内部検証経路にもサイズ／未知フィールド検査がある。
- 保留はサーバー時刻で10分。取得は非破壊。期限切れは次の操作時に反映する。自動監視、WebSocket、SSE、表示通知APIはない。
- 同ID・同内容は同じ履歴を返し、拒否後や期限切れ後に復活しない。同ID・異内容は409。別IDの満杯拒否も履歴に残し、空きができても同IDの再送は`queue_full`のまま。
- 履歴は128件まで。追い出して二重投入を許すことを避け、上限では503で停止する。PR-1当時は再起動で全履歴を失っていた。現在は本文以外の履歴を永続化し、同内容再送で復元する（再起動復旧仕様参照）。
- 公開HTTP投入はrequestIdのみで、1KiB以内。任意本文、メモID、更新・削除、タグ、コレクション、画像、添付、Report、未知の項目を受け付けない。
- `queued`／`rejected`／`expired`／`queue_full`を区別する。ブラウザの「表示中」は検証とDOM反映後のローカル表示で、サーバーの表示済み記録ではない。

`app.js`、保存基盤、Import、ZIP、Clipper、Bridgeの実装は変更していない。受信スクリプトはnotes・editor・ドラフト・保存キュー・IndexedDBの能力を持たない。保存・承認ボタンはない。原文はtextContentで表示し、Markdown変換、HTML実行、リンク化、外部画像取得は行わない。

## 通信と秘密値

専用ポートは`8791`、待ち受けは`127.0.0.1`のみ。Bridgeの8787とは別プロセス／別トークン。ブラウザ用とローカルアダプター用も別の256-bit乱数トークンにする。

| API | 認証とOrigin | 内容 |
| --- | --- | --- |
| POST /dummy | アダプターBearer必須、Originヘッダー不可 | requestIdのみを固定fixtureへ変換 |
| GET /pending | ブラウザBearer必須、許可Origin必須 | 保留1件／null |
| POST /status | 同上 | requestIdの履歴取得 |
| POST /reject | 同上 | requestIdを拒否。再実行しても同じ結果 |

許可Originは`http://127.0.0.1:5500`と`https://tetsujisugimori-coder.github.io`の2つに固定。`/memo/`はOriginに含めない。同Originの他ページを区別する仕組みではなく、Bearerの所持が必要。Hostは実待受ポートの127.0.0.1だけ。クエリ、任意転送、リダイレクト、未知メソッド、未知ヘッダー、重複した重要ヘッダー、圧縮／chunked入力を拒否する。CORSは完全一致でワイルドカードなし。OPTIONSは本文取得権限を持たず、実操作は必ずBearer検査を通る。

HTTP: 120要求/分（認証失敗とOPTIONSも含む）、同時処理4、接続8、ヘッダー8KiB、入力1KiB、タイムアウト5秒。MCP stdinは4KiB、120メッセージ/分、HTTP送信先は固定127.0.0.1:8791でリダイレクトを追わない。ブラウザの通信は5秒、応答70,000byte上限。

ブラウザのトークンはクロージャ内メモリだけ。入力後にpassword欄を空にし、閉じる／Escape／pagehideで通信を中断し、トークン・プレビューを消去する。再表示には再入力が必要。閉じる操作はサーバーの拒否を行わない。401でもトークンを消去する。拒否失敗を完了と表示しない。

秘密値はURL、ログ、Git、HTML、公開JS、メモ、IndexedDB、localStorage、sessionStorageに保存しない。RuntimeキーやBridgeトークンを流用しない。チャットには提出しない。ローカルWindows起動ウィンドウでのみ確認し、手動コピーした場合は貼付後にクリップボードを消去する。OSのメモリ／クリップボード履歴からの完全な消去を保証するものではない。

## Windows：起動と終了

前提: Node 22以上、Windows PowerShell 5.1またはPowerShell 7。今回の起動統合検証は**Windows PowerShell 5.1.26100.9444**／Node v24.20.0／tunnel-client v0.0.16で実施。下のコードブロックはすべて**PowerShellへ直接入力するコマンド**であり、ファイル編集用コードではない。ランチャーの引用符組み立てをコピーして手動編集する必要はない。

3つのターミナルを用意し、いずれも次のPR作業フォルダーへ移動する。別のcheckoutを使用する場合は、そのフォルダーを指定する。

```powershell
Set-Location -LiteralPath 'C:\Users\tetsu\Documents\Codex\メモ帳\work\pr1-dummy-preview\work\pr1-meta-review'
```

既に自分の検証用プロセスが動いている場合は重複起動せず、どのターミナルが受信・配信・Tunnelを担当しているか確認する。他のプロセスを停止しない。

### ターミナルA：プレビュー受信ウィンドウ

```powershell
npm ci
.\start-dummy-preview.ps1
```

受信Nodeプロセスを非表示で起動し、ローカルウィンドウに2種類のtokenを保持する。**ウィンドウとターミナルAは検証中開いたままにする。** RuntimeキーやBridge tokenは流用しない。

- **Browser token**：Memo-Nexusの「受信を確認」ダイアログへ入力する。Tunnel起動には使わない。
- **Adapter token**：ターミナルCのランチャーの隠された入力へ入れる。ブラウザへは入れない。

必要な間だけRevealを有効にし、貼付後にクリップボードを消去する。token、APIキーをチャット・ログ・ファイルへ貼り付けない。OSのメモリ／クリップボード履歴から完全消去する保証はない。

### ターミナルB：ローカルHTTP配信

同じPRフォルダーで実行する:

```powershell
python -m http.server 5500 --bind 127.0.0.1
```

**HTTPサーバーとターミナルBを検証中開いたままにする。** 本番とは別の新規ブラウザプロファイルで`http://127.0.0.1:5500/`を開く。Edgeの例:

```powershell
$taskProfile = Join-Path $env:TEMP ('memo-pr1-edge-' + [guid]::NewGuid().ToString())
& 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' --user-data-dir="$taskProfile" --no-first-run 'http://127.0.0.1:5500/'
```

Chromeは`C:/Program Files/Google/Chrome/Application/chrome.exe`を使う。安全設定無効化フラグや許可Origin拡大は使用しない。390pxでは一覧オーバーレイを閉じ、執筆モードなら「完了」で抜け、既存メニューから「受信を確認」を開く。

### ターミナルC：既存認証情報とTunnel

**APIキーとTunnel IDは、Tunnelを起動するこの同じPowerShellで設定する。** ターミナルA/Bで設定してもCへは引き継がれない。既存の安全な方法で準備済みなら再設定不要。未設定なら既存Runtime APIキーをローカルの隠された入力で設定する（新規キーの発行・設定変更ではない）:

```powershell
$taskRuntimeKey = Read-Host 'Existing Runtime API key (hidden; never paste into chat)' -AsSecureString
$taskRuntimePtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskRuntimeKey)
try { $env:CONTROL_PLANE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskRuntimePtr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskRuntimePtr); $taskRuntimeKey.Dispose() }
$env:CONTROL_PLANE_TUNNEL_ID = Read-Host 'Existing Tunnel ID (local input)'
$taskTunnelPath = Read-Host 'Absolute path to tunnel-client.exe'
.\start-dummy-preview-tunnel.ps1 -TunnelClientPath $taskTunnelPath
```

Adapter tokenを求められたら、Aのウィンドウから**Adapter tokenだけ**を隠された入力へ入れる。秘密値をCLI引数へ直接書かない。**TunnelとターミナルCを検証中開いたままにする。** 同じTunnel IDの別クライアントを同時に起動しない。

### ChatGPTで送信し、ブラウザで別途表示を確認

1. サーバーのツールを変更した後は、ChatGPT側の接続で**「ツールの更新」**を行う。
2. **新しい会話**で`@Memo-Nexus MCP Test`を選び、`submit_dummy_preview`が利用可能であることを確認する。更新操作はWindows担当、ツール呼び出しと応答照合はAI担当が行う。
3. UUID v4のrequestIdを生成して固定ダミーを送る。同じ要求の再送には同IDを使う。`queued`／`saved: false`は**一時キュー受信までの成功**であり、ブラウザ表示を示さない。
4. Windows担当がブラウザの専用ダイアログへBrowser tokenを入力し、「受信を確認」を操作する。表示のrequestId・タイトル・日本語／改行／Markdown原文をAI担当のツール応答と照合する。今回の機能は固定ダミーの**未保存プレビューまで**で、保存は行わない。

終了はWindows担当がダイアログを閉じ、CのTunnelをCtrl+Cで終了し、Aの受信ウィンドウを閉じ、BのHTTPサーバーをCtrl+Cで終了する。Aは自身の受信プロセスだけを終了する。現在の仕様では本文だけが消え、識別・状態履歴は保持される。同ID・原文再送が必要（再起動復旧仕様参照）。CのAdapter tokenはランチャー終了時に消去される。Runtimeキーを手動入力したCは終了後に閉じるか、`Remove-Item Env:CONTROL_PLANE_API_KEY`でそのプロセス環境から除去する。

## Secure MCP Tunnel：独自アダプター

実際に確認したバイナリ: Downloadsの`tunnel-client-v0.0.16-windows-amd64.zip`内のexe。`--version`は`0.0.16+5f99daabd4aa4a77049e6d81d54a0d8c18335397`。`version`サブコマンドはunknown commandで失敗した。`run --help`／`help quickstart`で下記フラグを確認した。初期PR-1ではhelp確認までで、実トンネル起動は行わなかった。今回のWindows修正では隔離した模擬Control Planeで実クライアント起動を検証した（後述）。ユーザーのRuntimeキーの読み取りや既存Tunnel設定変更は行っていない。

独自stdioコマンドを起動する`--mcp.command`、同時要求を1にする`--mcp.max-concurrent-requests 1`、初期化通知を補う`--mcp.stdio-send-initialized-notification`を使う。内蔵echo／stubオプションと併用しない。同じTunnel IDのstdioクライアントを同時に複数起動しない。[OpenAI公式Tunnelガイド](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)、[クライアント仕様](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/docs/configuration.md)参照。

既存の安全に準備された`CONTROL_PLANE_API_KEY`と`CONTROL_PLANE_TUNNEL_ID`を持つ**別ターミナル**で、起動中のpreviewウィンドウのAdapter tokenを隠されたRead-Hostに入力する:

```powershell
./start-dummy-preview-tunnel.ps1 -TunnelClientPath 'C:/path/to/tunnel-client.exe'
```

このランチャーはAdapter tokenだけをプロセス環境に一時設定し、Nodeとアダプターの絶対パスを`/`へ統一し、tunnel-client用の単一引用符（パス内の単一引用符はエスケープ）で囲んで`--mcp.command`へ渡す。PATHに複数のNodeがある場合は最初のApplicationを選ぶ。終了時は環境変数を除去する。Runtimeキーは受信サービスに渡さず、既存キーの発行／保存／設定を行わない。secretをCLI引数、profile YAML、シェル履歴へ直接入力しない。ログは`--log.format struct-text --log.level warn`を組み合わせ、`--log.http-raw-unsafe=false`を明示する。Adapter token／Runtimeキーを引数へ渡さず、raw HTTPログの環境設定があっても無効化する。PowerShell TranscriptやHTTP本文デバッグを有効にしない。

ChatGPT側で承認済みの検証用Tunnel接続を使い、UUID v4のrequestIdを1つ生成して`submit_dummy_preview`を呼ぶ。同じ要求の再送では同ID。応答のrequestId・固定title/bodyを記録し、ブラウザの表示と完全一致を確認する。ブラウザ非接続時の応答は未表示のキュー受信として記録する。

MCP側OAuthは未実装・未解決。認証なしのMCP接続試験は固定ダミー専用に限定する。ローカルHTTP操作には認証が必要だが、それをMCP OAuthの代用とは扱わない。正式create_memoや保存経路には転用しない。

## 検証の再現

```powershell
npm test
$env:MEMO_NEXUS_E2E_CHANNEL = 'msedge'
npm run test:e2e:dummy-preview
$env:MEMO_NEXUS_E2E_CHANNEL = 'chrome'
npm run test:e2e:dummy-preview
```

CIは既存チェックを維持し、Chromiumで専用E2Eを追加する。`MEMO_NEXUS_E2E_CHANNEL`未設定ならPlaywright Chromiumを使う。必要なら`npx playwright install chromium`。E2Eは新規BrowserContextを使い、本番プロファイルを開かない。5500／8791が空いている状態で実行する。

初期起動後に既存メモ、削除済みメモ、コレクション、タグ、5byteのBlob添付、local-config、永久削除記録を用意して再起動・保存待ちを完了する。全IndexedDBストアのキー・値をソート可能なJSONとして記録し、Blob／ArrayBuffer／TypedArrayを全byteへ展開する。受信なしの再読み込み対照、受信操作後、再読み込み後を比較する。既存保存入口にthrowする監視を設定し、全受信操作で呼ばれないことを確認する。現在エディタの本文も比較する。

`e2e-artifacts/dummy-preview/`にbaseline／after／control-before／result JSON、390px画像、失敗を残す。Gitでは生成物を除外し、CIは失敗時も全成果物を14日保持する。確定したWindowsの全ストアsnapshot・要約・画像と初回失敗ログは`docs/dummy-preview-review/`に記録する。再実行は初回ログを上書きせず別名で保存した。

### 成功と制約（2026-10-08）

- 単体テスト全1804件成功。固定fixture／UTF-8境界／未知項目／冪等性／満杯拒否履歴／期限／拒否／128件上限／Host／Origin／CORS／別トークン／未知ヘッダー／rate limit／保存能力の非接続を含む。
- Windows Edge 154.0.4258.62、Chrome 154.0.8037.99、Node v24.20.0、Origin `http://127.0.0.1:5500`で実stdio MCP→HTTPキュー→取得・原文表示が成功。再取得、閉じると再入力・再表示、拒否失敗と再試行、期限切れ、認証失敗、実サービス停止、不正応答も確認。390px横あふれなし、Enter／Tab／Escape／フォーカス復帰、ARIA状態通知構造を確認。
- HTML風fixtureはテキストで、script/img/a要素は0、実行マーカー未発火、fixtureのURLへの通信0。トークン保存なし。
- **受信操作直後は全6ストア・キー・値・添付byteが完全一致、新規メモ0件。**
- **再読み込み後の完全一致は成立しない。** 受信なし対照でも既存`pagehide`→`saveCurrentDraftMirror`→`restoreCurrentDraftMirror`が現在メモの`bodyUpdatedAt`・`updatedAt`・`revision`を進める。受信後再読み込みは同じ3項目のみ（revision +1、時刻単調増加）で、他の全キー・値・byteは一致。これは既存挙動であり今回修正していない。厳密な完全不変条件は未達として扱う。

初回と再試行: 全単体1804件中1803件成功／1件失敗（asset数62固定）。追加2資産を規約の0.5.0識別子に合わせ、検証値64へ更新して全件成功。Edge初回と最初の再試行は受信前対照の3メタデータ更新で失敗。原因をソースで確認し、対照比較として分離した。390px入口試験は既存一覧オーバーレイ／執筆モードの通常終了操作を追加。閉じると入口メニューが閉じてフォーカスできない実装問題を専用UI内で修正した。Chrome初回は標準Pragma／Cache-Controlヘッダー拒否で失敗し、許可した。次の再試行は非同期closeイベントの即時assertで失敗し、イベント完了待ちに修正して成功。失敗を無視した除外や安全設定無効化はない。

## PR #352：標準MCPメタデータ修正（2026-10-08）

更新開始時の公開HEADは`d8ba7c2f203d07ad3e9b7de72b36a87ce171e784`で、レビュー対象から変更なし。再fetchしたorigin/mainも冒頭の基準SHAと同じ。元worktreeは変更せず、別worktree／`fix/dummy-preview-standard-meta`でこの修正を行い、既存PRブランチへpushする。新規Issue・PRは作成しない。

修正前、正しい`submit_dummy_preview`の`params`に`_meta: { progressToken: "test" }`を追加すると、通常要求は成功する一方、追加した要求は`-32602: Only a dummy requestId (UUID v4) is accepted`になった。旧HEADのハンドラーを使った再現応答を[before-fix.json](dummy-preview-review/meta/before-fix.json)に保持した。ChatGPT／Tunnelが実際にこの情報を付けるか、実接続で失敗するかは未確認。

一次資料は[MCP基本仕様のGeneral fields](https://modelcontextprotocol.io/specification/2025-06-18/basic#general-fields)、[Tools仕様](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)、[2025-06-18 TypeScriptスキーマ](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/2025-06-18/schema/2025-06-18/schema.ts)、[生成JSONスキーマ](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/2025-06-18/schema/2025-06-18/schema.json)。`CallToolRequest`が継承する`Request.params._meta`はオブジェクトで、任意の`progressToken`は文字列または数値、その他のメタデータ値は未知型として定義される。基本仕様のキー構文も検証し、予約prefixの値を独自に限定しない。progress通知の送信は必須ではなく、今回追加しない。

変更は`dummy-preview-mcp.js`のメタデータ検証と`createMcpHandler`、専用単体テスト、専用E2E、検証文書だけ。`params`はname／argumentsと任意_metaだけで、他の外側項目を一括許可しない。汎用スキーマではargumentsは任意だが、このツールの必須requestId契約によりargumentsは必須。ツール引数は引き続きUUID v4のrequestIdのみ。メタデータは検証後に参照せず、HTTP送信は`{ requestId }`のみ。fixture、キュー、認証、Host／Origin、期限、保存処理は変更していない。

以下はメタデータ修正HEAD `a5d311b7592f72a2dbad630b20d4e13c21825325` 時点の検証履歴。Windowsランチャーの追加検証は次節に記載する。

修正後のローカル検証結果:

- 全単体1806件成功（初回成功、メタデータキーの改行境界を追加した後の最終実行も成功）。標準progressToken文字列／数値、空オブジェクト、progressTokenなしの追加情報、予約prefix・空の名前・入れ子の値を受け付ける。不正_meta型／progressToken型／キー構文、未知引数・任意本文・既存メモID・更新削除・非UUID・別ツール名・未知paramsを拒否。再送、満杯拒否、拒否後・期限切れ後の非復活も成功。
- 全追跡JavaScript232ファイルの`node --check`、Windowsランチャー2本のPowerShell Parser、`git diff --check`成功。ランチャーは構文検証のみで、手動GUI起動・終了は今回も未実施。
- Windows／Node v24.20.0、隔離Edge 154.0.4258.62／Chrome 154.0.8037.99、Origin `http://127.0.0.1:5500`の専用E2Eが各初回で成功。実Node stdio子プロセスで_metaなし要求とprogressToken／追加情報付き再送を別々に送信し、同requestId・固定title・日本語／改行／Markdown原文を照合。HTTP投入2件はいずれもrequestIdのみ、キューの単一レコードは完全一致。ブラウザ再取得・閉じる・拒否・期限・異常通信等の従来検証も維持。
- 保存入口呼び出し0。受信操作直後の全6 IndexedDBストアのキー・値・添付byte不変、現在本文不変、新規メモ0件。再読み込みでは受信なし対照と同じbodyUpdatedAt／updatedAt／revisionの既存更新を確認した。厳密な再読み込み後全値不変は未達のまま。
- 今回の修正後検証に失敗・失敗後再実行はない。修正前の期待された失敗と、前回PR-1の初回失敗ログは保持。Windowsの今回の全ストアsnapshot・要約は`docs/dummy-preview-review/meta/`に保存。最終公開HEADのCI結果はPR説明の最終HEAD検証欄へ記録する。

## Windowsランチャー修正とユーザー実証（2026-10-08）

更新開始時の公開HEADは`a5d311b7592f72a2dbad630b20d4e13c21825325`で、前回レビュー対象から変更なし。AGENTS.md・PR差分・作業ツリーを確認した。ローカルのユーザー編集（warn削除、`node`と`/`パスの回避策、BOM・末尾空行）を読み、元バイトをignored artifactsに保持して正式修正へ取り込んだ。新規PRは作成せず既存#352を更新する。

### 修正理由

- ログ形式未指定のまま`--log.level warn`を渡すと、v0.0.16は`log level requires 'struct-text' or 'json' log format`で停止する。手元の削除策で解消したことを確認し、正式修正では対応形式struct-textを明示してwarnを維持した。raw HTTPログは明示的にfalseにし、秘密を引数へ渡さない。
- PowerShell 5.1のネイティブ引数処理とtunnel-clientのshell形式解析を区別する。二重引用符と通常のWindows `\` パスを渡した元方式は`exec: "C:Program"`で失敗した。正式修正は`node`というPATH名への置換だけで済ませず、選択したNodeの絶対パスとスクリプトの絶対パスを`/`形式の単一引用符付きトークンにする。空白・日本語・パス内単一引用符に対応する。

根拠: [PowerShell 5.1のネイティブ引数仕様](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing?view=powershell-5.1#passing-arguments-to-native-commands)、[tunnel-client固定SHAのparseCommandArgv／ログ設定](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/runtimeconfig/config.go)、[stdio起動のexec.Command](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/mcpclient/stdio_command.go)。Windowsパスの文字列をなぞるテストではなく実プロセスの起動を確認した。

### 担当による独立検証

`dummy-preview-launcher.windows-check.js`を追加。Windows PowerShell 5.1.26100.9444、Node v24.20.0、実tunnel-client `0.0.16+5f99daabd4aa4a77049e6d81d54a0d8c18335397`で実行した。生成したテスト認証と一時loopback Control Plane／healthポートだけを使い、実キー・ユーザーのTunnel IDを取り込まない。ユーザーの5500／8791／Tunnelプロセスを停止・変更しない。`submit_dummy_preview`は呼ばず、受信キューへ投入しない。

- 旧HEADのログ設定失敗と、warnだけ削除した旧引用符方式の`C:Program`失敗をそれぞれ再現。
- 修正後は標準Program FilesのNodeと、空白・日本語・単一引用符を含む場所へコピーしたNode／MCP／tunnel-clientの両ケースで実起動成功。実行されたexe／scriptのパスを照合し、initialize、notifications/initialized、tools/listを観測、固定ダミーツールの一覧応答を模擬Control Planeまで受信した。
- 検証終了時は検証専用MCP子プロセスを停止し、Tunnel終了とランチャーのfinallyを確認する。positiveケースのログ末尾のexited unsuccessfullyはこの意図された停止の結果で、起動失敗ではない。手動GUI／Ctrl+C操作の検証ではない。
- ランチャー終了時のAdapter token消去を確認。テストAPIキー・Adapter tokenのプロセス出力への露出0。unsafe rawログをtrueとして継承させても、修正版のCLIで無効化した。実際の認証情報を使ったログ検証ではない。
- 初回検証は模擬Control Planeが空の要求一覧だけを返し、Node起動は成功したが初期化を観測できず失敗。要求を返す検証へ修正した。再試行1はNodeがPATHに複数ある際のGet-Command複数結果で失敗し、最初のApplication選択で原因を修正。再試行2で全ケース成功。初回・再試行の結果は`docs/dummy-preview-review/launcher/`へ保持し、成功だけで原因解消と扱っていない。
- 全単体1806件成功、全JavaScript構文とPowerShell Parser、diff --checkを確認。最終HEADの既存CI全ジョブはPRチェック／説明で確定結果を記録する。保存、Bridge、Clipper、Import／ZIPの実装は変更していない。

再現コマンド（Windows、PRフォルダーのPowerShellへ入力）:

```powershell
$taskTunnelPath = Read-Host 'Absolute path to tunnel-client.exe (0.0.16)'
node dummy-preview-launcher.windows-check.js $taskTunnelPath
```

生成物は`e2e-artifacts/dummy-preview/launcher/`に新規の検証フォルダーごと保持する。検証は指定バージョン以外を拒否する。UNC／ネットワーク共有・長いパス・PowerShell 7の実起動は今回の独立検証対象外。通常のローカルドライブの空白・日本語・単一引用符は実証済み。受信GUIランチャーの手動起動・閉じる操作は担当による独立検証では未実施（従来のParser検証と区別）。

### ユーザーによる実Tunnel実証

**ユーザー報告による確認**: 2026-10-08、日本時間15:44〜15:46頃、手元回避策を使って`ChatGPT → Secure MCP Tunnel → ローカルMCP → 一時キュー → ブラウザ表示`を確認した。担当が独立して実Tunnelへ再送した結果ではない。

- requestId: `9e1c7452-2af8-4a8c-b8ae-315679d029f3`
- ツール応答: `state: queued`、`saved: false`、title `Memo-Nexus 受信実証（固定ダミー・未保存）`
- `http://127.0.0.1:5500/`の画面: 「固定ダミーを表示しました。未保存。」「ブラウザ表示中／一時キュー受信」。送信と同じrequestId・タイトル・日本語本文をユーザーが確認した。

この報告で確認できたのはローカル表示まで。公開Origin、LNA実権限の許可／拒否、OAuth、永続保存、既存保存データの完全不変を成功扱いしない。ユーザー実証時の全IndexedDB store／添付byte比較や厳密なMarkdown全byte照合は報告されていない。全値不変の独立検証結果は前節のローカルE2Eの条件に限定する。

## 未実施条件と次操作

このPRはローカル受信実証。ChatGPTからローカル表示までのユーザー実証は上記のとおりだが、担当による実Tunnel再検証と公開Originの統合実証は未完了。OAuth、正式保存、既存メモの保存・更新・削除、任意メモの生成、create_memoは未実装。

1. **ユーザー実証は完了。次に正式修正版でローカル経路を再確認する。** Windows担当は隔離Edge／Chromeを準備し、専用サービス、ローカル5500配信、上記Tunnelランチャーを起動する。既存の承認済み検証接続を使用し、秘密値をチャットやログへ出さない。ブラウザで専用tokenを入力し、AI担当の送信後に「受信を確認」を操作して画面を確認する。AI担当はUUID v4を生成して実際のChatGPTツール`submit_dummy_preview`を呼び、返答のrequestId・固定title/body・queued／未保存を記録する。Windows担当はキュー返答と画面の同requestId・固定原文を照合する。再送は同ID。HTTPやローカルstdio試験でChatGPT成功を代用しない。終了はWindows担当がブラウザを閉じ、TunnelをCtrl+C、受信起動ウィンドウと配信を終了する。
2. **公開方法が決まり、今回のUIが実Originで利用可能になった後に接続確認する。** 公開・マージはこの作業では行わない。Windows担当は新規隔離プロファイルで`https://tetsujisugimori-coder.github.io/memo/`を開き、通常起動・保存待ち後に検証データと全ストア基準を準備し、専用サービスを起動する。実際のローカルネットワーク権限の許可／拒否を別プロファイルで操作し、CORS、HTTPS→loopback／混在コンテンツ、ブラウザ版・画面結果を記録する。AI担当は必要に応じて同じ固定ダミーを実Tunnelツールで送信し、Windows担当とrequestId・本文を照合する。localhost配信の成功を公開Origin成功として扱わない。
3. PNA応答だけでLNAを保証しない。[Chrome公式説明](https://developer.chrome.com/blog/local-network-access)／[Edge公式説明](https://learn.microsoft.com/en-us/deployedge/ms-edge-local-network-access)を参照し、対象154の実挙動を確認する。今回のaccessdeniedはPlaywright通信遮断による代替で、実権限拒否ではない。ブラウザ安全設定の無効化、ポリシー追加、許可Origin拡大で試験を通さない。
4. 受信GUIランチャーの手動起動・終了、スクリーンリーダーの実読み上げ、既存Clipper拡張・Bridge runtimeの実操作回帰はWindows担当の残作業。Tunnelランチャーは上記の実PS 5.1起動を確認したが、ユーザーの実Tunnelでの再送は動作中の検証と競合させないため独立再実行しなかった。既存保存挙動の変更やOAuth／正式保存の追加は今回行わない。

mainのbranch protection取得は404（Branch not protected）、ruleset一覧は空。必須設定は存在せず、既存CI全jobと追加jobの結果をPRで確認する。PR作成後のGitHub CI結果はPRチェック欄を参照。公開、マージ、設定変更、自動マージは行わない。
