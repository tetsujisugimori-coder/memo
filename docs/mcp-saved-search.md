# 保存済みメモのMCP検索

## 対象と保存境界

この機能は、Memo-Nexusを開いているブラウザのIndexedDBに保存済みのタイトル・Markdown本文を検索する。メモの更新、削除、自動保存、全文取得ツールは追加しない。ローカルフォルダーのファイルも直接読まない。

全メモ検索は、子・孫コレクションを含むすべてのコレクションの保存済みメモを対象にします。コレクション指定検索は、指定先直下の保存済みメモのみを対象とし、子・孫コレクションは含みません。未保存ドラフト、ゴミ箱、添付データは、どちらの検索でも対象外です。

検索は既存の`getStoredNotes()`と`getAllCollections()`を使い、ブラウザ内で行う。`getAllNotes()`のドラフト重畳、移行、保存処理は呼ばない。検索のたびに保存済みデータを読むため、ページ間で利用者がメモを更新した場合に固定スナップショットは保証しない。

サービスは短い結果を返す間だけメモリで中継する。本文全体をMCPサーバーへ永続複製せず、受信履歴にも検索語・結果・許可情報を書かない。診断ログは既存の固定ラベルと件数だけを使用する。OSのメモリダンプ、ブラウザ拡張、ChatGPT側の会話・ツール履歴まで消去する機能ではない。

ブラウザを閉じる／再読込すると検索を継続できない。別端末、別プロファイル、別Originは別の保存領域であり、同じメモがあるとは扱わない。ページの初期起動に従来から存在する保存・移行と、検索操作の書き込み不変性は分けて確認する。

## 配送方式の比較

| 方式 | 評価 |
| --- | --- |
| 既存受信サービスへブラウザから短周期ポーリング | 採用。既存のloopback、Host・Origin、ブラウザ／adapter専用トークン、CORS検証を再利用できる。ブラウザが開いている必要がある。 |
| WebSocket／SSE | 継続接続、再接続、認証更新、複数タブの所有権管理が追加される。今回の短い検索には採用しない。 |
| メモをサーバーへ複製して検索 | 永続複製を避ける要件に合わない。 |
| Codex Bridge経由 | 会話実行用の別認証・プロセス経路。保存済みメモの検索権限として流用しない。 |

受信サービス8791は引き続きloopback専用で、Tunnelへ公開する対象は既存のOAuth付きMCP 8792だけとする。

## 設定と実ChatGPT接続での確認手順

1. 現行の受信・OAuthの設定を保全する。実設定・トークンはcheckout外に置き、ログやPRに貼らない。既存設定の`scopes_supported: ["memo:submit"]`では検索ツールを公開しない。
2. OAuth設定で`scopes_supported`を`["memo:submit", "memo:search"]`にする。issuer、resource／audience、allowedSubjectsは既存の検証済み値を維持する。Auth0側の対象APIにも独立した`memo:search`権限を設定し、利用者の認可・アクセストークンに明示的に付与する。既存`memo:submit`を検索許可と読み替えない。
3. 既存ランチャーで設定を再検証して起動する。ローカルmetadataと設定のscopesが一致することを確認する。必要ならChatGPTの接続を再認可する。ローカル起動完了を実OAuth／ChatGPT接続成功と表示しない。
4. ChatGPTでツール一覧を確認する。検索権限を持つトークンには`prepare_memo_search`と`search_saved_memos`が現れる。送信専用トークンでは検索ツールを公開せず、直接呼び出しても403にする。検索専用トークンで既存送信はできない。
5. `prepare_memo_search`を実行し、返った`sessionId`を会話内で保持する。`pairingCode`は2分の一度限りの連携コード。Memo-Nexusの「その他」メニュー内の「MCP検索許可」を開き、既存の受信サービス専用Browser tokenとコードを手動入力する。トークンの自動注入は行わない。
6. 「認証主体を確認」を押し、表示されるissuer／subが許可する自分のOAuthアカウント（設定のallowedSubjects）と一致することを確認する。主体が不明・不一致なら許可しない。「全メモ」は子・孫を含むすべてのコレクション、「コレクション指定」は指定先直下のみを許可することを確認して対象を選び、「検索を10分間許可」を押す。コード確認だけでは許可にならない。
7. ChatGPTから以下の引数で`search_saved_memos`を呼び、既知の日本語タイトル・本文を照合する。結果は`id`、`title`、`snippet`、ページ内`count`、`hasMore`、`nextCursor`。全体一致件数・全文は返さない。

```json
{
  "sessionId": "prepare_memo_searchで得たID",
  "conditions": {
    "query": "日本語キーワード",
    "scope": { "type": "all" },
    "limit": 5
  }
}
```

`"scope": {"type": "all"}`は子・孫を含むすべてのコレクションを検索する。コレクション指定の`"scope": {"type": "collection", "collectionId": "対象ID"}`は指定先直下のみを検索し、その子・孫は含めない。IDは既存画面のコレクション情報・エクスポート等で確認する。検索許可をコレクションに限定した場合、全メモや別コレクションへの拡張は拒否する。

8. 複数結果がある場合、同じquery／scope／limitに`cursor: "返ったnextCursor"`を追加して次ページを取得する。cursorはセッションと条件に結び付き、一度使ったものは再利用できない。ページはメモIDの固定順。再検索も回数・容量の上限を消費する。
9. 画面の主体・対象範囲・期限・残量を確認する。「許可取消・停止」を押して以降の検索が`permission_revoked`になることを確認する。既にChatGPTへ返した結果は取り消せない。閉じる操作も許可停止を行う。ネットワーク障害で取消通知が届かない場合、ブラウザは即停止し、最後のheartbeatから5秒超で新規検索を`browser_disconnected`とする。
10. 期限切れ、ブラウザ停止、別タブ、別主体を確認する。検索前後で保存済みメモを照合し、既存の文章送信→未保存プレビュー→明示的な手動保存も確認する。実Auth0／ChatGPT接続、利用者の手動操作を含めた結果は自動試験と別に記録する。

自動的なChatGPT接続設定変更、Auth0テナント変更、サービス再起動や既存プロセス停止は、このPRの試験では行わない。

## 検索条件と上限

- `scope.type = all`は子・孫を含む全コレクション、`scope.type = collection`は指定コレクション直下のみ。未保存ドラフト、ゴミ箱、添付データは両方で対象外。コレクション限定の許可から全メモ・別コレクションへ範囲を拡張できない。
- 単一文字列の部分一致。日本語対応。大小文字を無視するが、かな／全半角／Unicode正規化、形態素解析は行わない。空白も文字列の一部で、複数語のAND／OR演算は行わない。
- queryは空白だけを拒否し、最大100 Unicodeコードポイント。正規表現・意味検索・並べ替え・再帰コレクション等の追加フィールドは`unsupported_conditions`等で拒否する。記号や`AND`をquery内に書くとそのままの文字列として扱う。
- limitは1〜10、既定5。タイトルは最大200、抜粋は最大160コードポイント。JSONエスケープを含むツール結果は8 KiB以下。収まる件数までページを短くする。HTTP JSON-RPCの外側の封筒・要求IDはこの8 KiBに含めない。
- 許可ごと10分、20要求、100件、64 KiB。OAuth主体ごと1時間60操作（連携コード準備も含む）、200件、256 KiB。処理中の最大件数・8 KiBを先に予約し、確定後に実件数・サイズへ精算する。そのため残量が少ないと実際には収まる要求も事前拒否する。
- 主体ごと未処理／有効セッションは4、サービス全体は32、主体予算は64まで。受信サービス既存の120要求／分・同時4要求も維持する。2秒ごとのポーリングも共有上限に含むため、多数タブの同時使用は制限に達し得る。
- 予算・許可・cursorはサービスメモリ内だけ。サービス再起動で許可は消え、予算もリセットされる。無制限の反復取得を永続的に阻止する仕組みとは扱わない。短い抜粋・回数制限だけで情報露出を完全に防ぐことはできない。

## 認証・要求の対応付け

OAuthの署名、issuer、audience、期限、allowedSubjects、ツール別scopeを毎回検証する。連携準備で得た主体はMCPサーバーから専用adapter認証で中継する。ツール引数から主体を指定させない。許可時にコードを消費し、別のランダムなタブ専用capabilityとOriginを結び付ける。capabilityは画面のメモリだけに保持し、別タブへ引き継がない。同じ主体でもセッションIDだけではブラウザのpoll・結果送信・取消はできない。

検索はセッションあたり1要求ずつ、サービス全体で同時に2要求まで待機する。受信サービスの同時処理枠をブラウザのpoll・取消用に残し、超過は`search_busy`にする。サーバー発行の要求IDに結果を照合し、違う要求ID、他セッション、遅延した結果、取消後の結果は拒否する。6秒で待機を打ち切り、結果・検索語を待機構造から外す。未使用cursorには条件のハッシュと最後のIDだけを保持する。

Browser token、adapter token、コード、capabilityは秘密として扱う。コードを受け取った相手が許可対象になるため、画面の主体確認を省略しない。この境界は同一Originの悪意あるスクリプト、ブラウザ拡張、端末管理者やadapter tokenの侵害への防御を保証しない。

| 状態 | 応答 |
| --- | --- |
| 未認証・不正／期限切れOAuth token | HTTP 401 `invalid_token` |
| scope不足・主体allowlist違反 | HTTP 403 `insufficient_scope`／`subject_forbidden` |
| 検索許可前／サービス再起動後 | `permission_required` |
| 別OAuth主体 | `subject_mismatch` |
| 許可範囲外 | `scope_forbidden` |
| 許可期限切れ／取消済み | `permission_expired`／`permission_revoked` |
| 最終heartbeatから5秒超 | `browser_disconnected` |
| heartbeatはあるが6秒以内に結果なし | `search_timeout` |
| MCPから受信サービスへの通信失敗 | `receiver_unavailable` |
| ブラウザの通信失敗 | 画面に通信失敗を表示して停止 |
| 保存接続・コレクション喪失 | `storage_unavailable`／`collection_unavailable` |
| 要求・情報量の上限 | `search_budget_exhausted`、共有HTTP制限は`rate_limit` |

ブラウザ切断と物理ネットワーク切断の原因を確実に区別できるとは扱わない。`browser_disconnected`はheartbeatが途絶えた状態を表す。

## 検証記録（2026-10-20）

開始時のmain／origin/mainは`1240d10e89dcf7e6125e6f1030de4025ca0606ef`。PR #377はマージ済み。AGENTS.md、既存OAuth／MCP、永続受信、IndexedDB、Codex Bridge、ランチャーのmetadata一致検査を確認した。専用worktreeとブランチで作業し、元mainの未追跡work/、実履歴・実メモ・既存プロセスを保持した。

- `node --test memo-search.test.js`：8件成功。日本語、長文、1万件の候補、JSONエスケープ込みサイズ、コレクション・ゴミ箱、主体／Origin／capability、要求ID、cursor、取消・期限・停止・タイムアウト、累積予算と同時予約、実RS256／SDK HTTP、ログ非露出。
- 保存・受信・IndexedDB・Bridge設定を含む関連単体130件、OAuth／discovery／Bridgeの44件が成功（一部重複）。追加した予算境界の1件を含め、最終差分の`npm.cmd test`は全1,856件成功、失敗・skip 0。
- `node memo-search.e2e.js`：隔離Chromium、実IndexedDB、架空issuerのRS256、実MCP／受信HTTPを接続。1,000件、日本語・長文、タイトル／本文、コレクション／子／ゴミ箱、複数ページ、許可済み2タブの同時検索・片方だけの取消、別プロファイル、取消と遅延応答の競合、サービス側／ブラウザ側の期限、取消未達のブラウザ停止、通信失敗時の停止表示、保存接続・コレクション喪失の区別を確認。検索前後で全IndexedDBストア一致、readwrite transaction 0、ページ例外0。
- 初回ブラウザ試験は新規fetchのReferer指定漏れによる`invalid_header`で失敗。既存受信UIと同じ`credentials: omit`／`referrerPolicy: no-referrer`を追加後に成功。受信側の制限は緩めていない。
- 既存`node mcp-http-oauth.e2e.js`：OAuth HTTP→隔離永続受信→未保存プレビュー→明示保存／破棄、複数送信、再起動・再送、既存メモ保持が成功。sandbox内の初回は`history_permissions`で拒否。通常Windows権限の隔離試験で成功し、実サービスや実履歴は操作していない。
- 新規E2Eを既存Linux／Windows CIに追加。試験artifactは`e2e-artifacts/memo-search/`に保存してgit対象外にする。スクリーンショットは合成データと架空主体のみ。実資格情報・検索結果本文をartifactに記録しない。
- 全単体の初回は1,855件中1,847件成功、sandbox内の履歴権限7件とアセット数固定1件が失敗。キャッシュ識別子更新後の一括実行は1,856件中1,839件成功、旧app.js番号を固定した17件が失敗。番号だけを追従させ、該当ファイル351件が成功した後の最終一括実行は上記の全1,856件成功。失敗した実行を成功として数えない。PowerShellのnpm.ps1は実行ポリシーで起動できなかったためnpm.cmdを使い、OSの実行ポリシーは変更していない。

差分は本人によるレビューを実施。主体とタブ・要求IDの対応付け、scope分離、readonly API、応答サイズ、予算の同時予約、取消・期限と遅延応答、秘密値のログ／永続履歴非記録を確認した。同時待機を2件に制限してbrowser通信枠を残し、ブラウザ自身が期限を検出したときも許可中表示を残さないよう修正した。キャッシュ追従以外の既存テスト期待値や認証・保存の安全条件は緩めていない。独立した第三者レビューとは区別する。

### 公開CIで見つかった隔離fixtureの依存追従（追加修正）

最初の公開HEAD `8e09879`の[CI run 39412425169 / attempt 1](https://github.com/tetsujisugimori-coder/memo/actions/runs/39412425169/attempts/1)は12ジョブ成功、Windows 1ジョブ失敗、任意診断1件skip。Linuxの新規検索E2Eと既存受信・OAuth回帰、Linux／Windowsの全単体1,856件は成功したが、Windowsは既存discovery試験の起動待ち45秒でtimeoutした。該当discovery試験・起動PS・本体は今回変更なしで、原因は未確定。同じ試験はローカル実PS5.1で成功した。

失敗WindowsジョブIDだけを1回再実行した[attempt 2](https://github.com/tetsujisugimori-coder/memo/actions/runs/39412425169/attempts/2)は、全単体とdiscoveryが成功した後、ランチャー試験の`session key supports start/restart`で失敗した。後続のWindows受信・OAuth・検索E2Eはskipで、検索成功とは扱わない。

追加した受信サービスの検索依存を、`memo-nexus-launcher.windows-check.js`の`main`内の隔離フォルダー作成でコピーしていなかった。既存5ファイルだけの小さなfixtureで`MODULE_NOT_FOUND`を再現し、`memo-search-broker.js`／`memo-search.js`の追加コピーで受信サービスを生成できることを確認した。今回の追加差分はコピー対象2ファイルの追従だけで、ランチャー本体、試験timeout、期待値、認証・保存の安全条件は変更しない。

ローカルのランチャー回帰初回はworktree直下のnode_modulesが未用意で設定検証に失敗した。既存のインストール済み依存へのjunctionを専用worktreeに用意した。依存パッケージや実設定は変更せず、fixtureの外部モジュール解決を満たして検証する。

追従後の`node memo-nexus-launcher.windows-check.js`は実PS5.1で成功。隔離23シナリオ、Formsの176ケース（通常／125%合成／150%合成／150%合成＋寸法制限）、別GUI二重起動拒否、スクロール後の設定ダイアログ、未設定起動拒否、停止・終了イベントを確認した。JavaScript構文・`git diff --check`も成功。検索本体は最初の公開HEADから変更せず、追加commitではこのfixtureと検証記録だけを変更する。

### PR #379の検索範囲説明のレビュー修正（2026-10-20）

レビュー指定HEAD／PR HEAD／originのPRブランチは`5a035db971ca2c61c93731984b12e9ba4a3e2283`で一致し、最新origin/mainは`1240d10e89dcf7e6125e6f1030de4025ca0606ef`。指定HEADの公開CI run 39414711538は成功済みであることを確認した。既存worktreeを保持し、別worktreeで作業した。

許可画面、MCPツール説明、保存境界・操作手順・検索条件を、全メモは子・孫を含む全コレクション、コレクション指定は指定先直下だけ、という実装どおりの仕様に統一した。検索関数の曖昧なコメントも修正したが、検索条件式・アルゴリズム・入力schema・OAuth／scope／主体照合・トークン／capability・許可時間／取得上限・保存処理は変更していない。

- 関連単体36件成功：`memo-search.test.js`、`mcp-http-oauth.test.js`、`received-preview.test.js`、`received-notes-preview.test.js`。画面・仕様書の説明を検証する1件を追加し、既存HTTPテストで実際のMCPツール説明も確認した。既存の許可範囲テストに子・別コレクション指定の拒否を補い、元の期待値を維持した。
- 既存`memo-search.e2e.js`成功。全メモで子コレクション内の結果、指定先直下のみ、ゴミ箱除外、ドラフトを重畳するreaderの不使用、検索前後の全ストア一致・readwrite transaction 0を既存の検証で確認した。同じ動作テストは追加していない。
- 修正後の許可画面の描画を確認。JavaScript構文検査と`git diff --check`成功。本人による差分レビューで実行処理・安全条件の不変と、各説明の整合を確認した。
- 無関係なChart／Report／PDFの長時間E2Eと、変更していないランチャーの長時間回帰はローカルで再実行しない。今回の公開HEADのCI結果はPR本文に別途記録し、旧HEADの成功とは区別する。

無関係なChart／Report／PDF長時間E2Eはローカルで反復しない。実Auth0／ChatGPT接続、実Secure MCP Tunnel、人による操作・目視、OS再起動後の受入は未実施。自動試験成功を実接続成功とは扱わず、上記の利用者向け手順で別途確認する。自動マージは行わない。
