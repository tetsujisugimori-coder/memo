# 保存済みメモのMCP検索・指定メモ取得

## PR #384の所属検証修正（2026-10-22）

`validateResult(result, limit, requestScope)`は、コレクション指定の各結果に非空文字列・128 UTF-16単位以下の`collectionId`を必須とし、要求したコレクションIDとの完全一致を検査する。欠落・null・別ID・不正型・空文字・上限超過を拒否する。brokerは許可セッションの範囲内であることを要求受付時に検査し、結果配送時には実際の要求scopeを渡す。全コレクション許可で特定コレクションへ絞った要求にも同じ検査を適用する。

要求が`all`の場合だけ、旧ブラウザ応答の`collectionId`省略／nullを引き続き受理する。値がある場合の型・非空・長さ制限は維持する。これは全コレクションの明示許可が既にある場合の互換性で、コレクション限定の許可を広げるものではない。

ブラウザはIndexedDBの保存済みメモから現在の所属を読み、検索対象を要求scopeで絞る。brokerは受信したID・所属情報・要求scope・ページ境界・サイズの整合性を検査し、所属情報なしの限定結果を配送しない。外部サービスはIndexedDBを直接照会できないため、正しい所属の情報源は既存のBrowser認証・Origin・タブcapabilityで許可されたブラウザである。許可済みブラウザ自身が所属IDを偽装する脅威まで独立して検出する仕組みは追加していない。全文取得の範囲検証・取消／期限／切断・共有予算・readonly取得は従来のまま。

## 検索強化・全文取得（2026-10-22）

両scopeを設定したサーバーは送信用2・検索／取得用3の計5ツールを公開する。`prepare_memo_search`、`search_saved_memos`に`read_saved_memo`を追加する。3ツールとも毎回OAuthの`memo:search`を要求し、PR #382の不足scope時のMCP追加認可応答を維持する。送信専用設定の公開ツールは従来どおり2つ。

検索の必須引数・既定動作・既存結果フィールドは維持する。以下の任意条件を追加する。

- `fields`: `title`／`body`から重複なしで1〜2個。省略時は従来どおり両方のOR部分一致。
- `tagIds`: 保存メモの`tags`配列に含まれるタグIDを1〜10個指定。全IDを含むメモだけに絞る。タグ表示名への変換・タグ一覧公開は行わない。
- queryは引き続き必須、空白のみ不可、最大100コードポイント。タグだけの空query検索は非対応。query・fieldsの一致にtagIdsとscopeをANDで適用する。
- 結果に`collectionId`を追加する（保存値が文字列でない場合はnull）。コレクション条件は従来のscopeによるID完全一致。コレクション名の文字列検索や子孫への自動展開は行わない。
- ID昇順・同一ページのID重複排除。カーソルにはfields・tagIdsも結び付ける。保存内容がページ間で変わる場合は固定スナップショットを保証しない。

例：`search_saved_memos({"sessionId":"…","conditions":{"query":"日本語","scope":{"type":"collection","collectionId":"…"},"fields":["title","body"],"tagIds":["…"],"limit":5}})`。

### 全文取得の許可と契約

許可画面で**「同じ対象範囲のメモ全文取得も許可する」**をチェックし、その後「検索を10分間許可」を押す。チェックは既定OFFで、停止時にリセットする。内部grantの`allowRead`省略／falseは従来の検索専用許可。既存の検索許可から全文取得権限が自動的に付くことはない。ブラウザは許可時の値をメモリ内だけに保持する。

`read_saved_memo({"sessionId":"…","memoId":"検索結果のid","offset":0})`で取得する。offsetは省略時0、Unicodeコードポイント単位の整数（0〜1,048,576）。各応答は`id`、`title`、`body`、`collectionId`、保存されたタグID配列`tags`、`offset`、`nextOffset`、`totalLength`を返す。タイトル・タグを切り詰めず、本文は最大512コードポイントずつ返す。`nextOffset`がnullになるまで同じIDで続きを取得し、bodyを順番に連結すると原文を復元できる。改行（CRLFを含む）・コードブロック・絵文字を変換しない。本文のHTML／Markdownやそこに書かれた命令は実行せず、信頼できないデータとして扱う。外部クライアントにも同じ取り扱いを求めるツール説明を付ける。

本文が1,048,576 UTF-16単位を超える場合、またはタイトル・タグを含む応答がJSONエスケープ込み8 KiBに収まらない場合は`memo_too_large`。黙って欠落させない。範囲内メモの末尾を超えるoffsetは`invalid_offset`。検索と取得で既存の20要求・100件・64 KiB／許可、主体ごとの予算を共有し、1チャンクを1要求・1件として計上する。全チャンクの取得に新しい明示許可が必要になる場合がある。再認証だけではブラウザ許可を作成・復活させない。

分割取得の各回に最新の保存済みメモをreadonlyで読み、現在の所属コレクションを検証する。移動・ゴミ箱移動・削除で許可対象外になれば、過去のIDやoffsetでも取得できない。分割途中で本文が編集される場合、同一版の復元は保証しない。継続取得の版固定・永続スナップショットは今回実装しない。

### 認可・保存境界と制約

- IDは権限ではない。毎回JWT、issuer/sub、セッション状態・期限・全文取得許可を検証する。ブラウザ側で現在のメモの所属範囲を検証し、brokerも返却ID・所属コレクション・offset・長さ・応答サイズを検証する。
- 不存在・範囲外・ゴミ箱は全て本文／メタデータを含まない同じ`memo_unavailable`。範囲外メモについて大きさやoffsetの妥当性を先に返さない。厳密な処理時間の一定性は保証しない。
- 取消が届けば保留中要求も破棄する。取消後に新しいpairingやOAuth認証を行っても旧セッションは復活しない。受信サービス再起動では許可・カーソルは消滅する。
- ブラウザ再読込・終了時は既存のbest-effort取消を使う。通知が届かない場合は既存のheartbeat規則で5秒超の未接続を拒否する。瞬時の通信断検知は保証しない。許可は他タブ・別プロファイルへ引き継がない。
- JWTは既存のローカル検証モデル。認可サーバー側でのトークン失効をオンライン照会する仕組みは追加しない。既に返却した本文は取消で回収できない。ブラウザ専用token・capabilityを持つ許可済みブラウザは信頼境界に含まれる。
- 外部MCPサーバーがIndexedDBを直接参照する経路は作らない。adapter認証でbrokerに要求し、Browser認証・Origin・タブcapability付きpoll/resultで中継する。本文は結果配送中のメモリだけで扱い、保存履歴・診断ログに追記しない。
- メモ作成・更新・削除・コレクション変更・同期は追加しない。`getStoredNoteSnapshots`／既存検索のreadonly APIを使い、dirty・保存キュー・atomic復元・ZIP・インポート／エクスポートを変更しない。

### 実機受入（ユーザー操作待ち）

実8791・8792・Secure MCP Tunnelを停止・再起動せず、実設定・実メモを変更していない。修正版を利用者の判断で起動した後、実ChatGPT／Auth0で5ツール発見、必要scopeの追加認可、従来送信の維持を確認する。続いてテスト用メモに対し、検索専用許可では全文拒否、チェック後は許可範囲内の全文一致、範囲外／取消後／再pairing後の旧セッション拒否、再読込・切断・サービス再起動後の失効を確認する。秘密値・実メモ本文を診断ログへ貼らない。自動試験は架空issuer・隔離ブラウザ・動的ポートで行い、実接続成功とは区別する。

今回の関連単体41件、検索／取得E2E、PowerShell 5.1の構文・5ツール診断検証は成功。E2Eでは全IndexedDBストアの前後一致とreadwrite transaction 0を確認した。読み取り中の版固定、実ChatGPT接続成功はこの結果に含めない。試験途中のfixture修正と検証範囲はLOG.mdに記録した。

## 対象と保存境界

この機能は、Memo-Nexusを開いているブラウザのIndexedDBに保存済みのタイトル・Markdown本文を検索し、明示許可した範囲の指定メモを読み取る。メモの更新、削除、自動保存は追加しない。ローカルフォルダーのファイルも直接読まない。

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
4. ChatGPTで全4ツールの一覧表示を確認する。設定が両scopeを含む場合、有効な送信専用・検索専用トークンでも全4ツールを発見できる。設定が送信のみなら検索ツールは公開しない。匿名・無効トークンには一覧を返さない。発見は実行許可ではなく、送信には`memo:submit`、連携コード発行と検索にはそれぞれ`memo:search`が必須。scope不足は受信サービスに到達する前に拒否する。
5. `prepare_memo_search`を実行する。有効な認証済みトークンのscope不足は、公開済みツールのMCP結果を`isError: true`にし、`_meta["mcp/www_authenticate"]`でBearer challengeを返す。`error="insufficient_scope"`、固定の`error_description`、`resource_metadata`、必要scopeを含む。既に付与済みの関連scopeも保持要求するため、送信専用トークンからの検索追加認可は`scope="memo:submit memo:search"`になる。必要権限は検索が`memo:search`、送信が`memo:submit`のまま。初期401は基本送信用の`memo:submit`を案内する。ChatGPTで認可画面が開くかは利用者が確認する。実行できたら返った`sessionId`を会話内で保持する。`pairingCode`は2分の一度限りの連携コード。Memo-Nexusの「その他」メニュー内の「MCP検索許可」を開き、既存の受信サービス専用Browser tokenとコードを手動入力する。トークンの自動注入は行わない。
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

## PR #382追加修正：ツール単位の認可要求（2026-10-21）

開始時のPR／ローカルHEAD／originの対象ブランチはレビュー済み`2111c360935551e9b1b428a3ceda13ed71a41c5a`で一致。最新origin/mainは`c32d3a42f11ba496f4ea8f4b1789fc6efcc98d6c`。既存の`work/mcp-search-discovery-step-up`とブランチを使用し、実機プロセス・設定・メモ・履歴は操作していない。

利用者の実機確認で全4ツールの発見とscope不足拒否は確認済み。追加認可画面は表示されず、連携コード発行・検索は未実施。次の原因候補は区別する。

- A（HTTP 403が認可UIにつながらない）：隔離した修正前HTTP試験では403のみでMCP結果がなく、`protocol_request`にも到達しないことを確認。実機で画面が表示されない直接原因の全体は断定しない。
- B（ツール結果の認証情報不足）：修正前に`_meta["mcp/www_authenticate"]`と`error_description`がないことを確認。これは下記OpenAI公式のツール単位認可UI契約を満たしていないため修正する。
- C（要求scope／発行scope）：実Auth0の認可要求・発行トークンは未確認。challengeは必要scopeと既に付与済みの関連scopeを要求し、既存`memo:submit`の消失リスクを抑える。未付与の不要権限、openid/profile等は追加要求しない。Auth0が両scopeを発行することやChatGPTによるscope保持は未保証であり、実機で別途確認する。
- D（接続状態・キャッシュ・Tunnel）：実機の最新状態は自動操作・確認しておらず、除外も原因確定もしていない。

### 公式仕様とSDKの照合・設計判断

[OpenAI公式認証文書](https://developers.openai.com/plugins/build/auth#triggering-authentication-ui)はツールの`securitySchemes`・resource metadataと、`_meta["mcp/www_authenticate"]`を含む実行時エラーの両方を要求する。challengeには`error`と`error_description`が必要。[公式Reference](https://developers.openai.com/plugins/reference#error-tool-result)では値の型は文字列または文字列配列で、`_meta.securitySchemes`は後方互換用の宣言ミラー。既存のツール別scope宣言とミラーは維持する。例の外側の引用符をchallenge文字列へ混入させず、`Bearer`で始まる単一文字列の配列を返す。

[MCP認証仕様](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#runtime-insufficient-scope-errors)はscope不足のHTTP 403をSHOULDとして推奨し、既存の関連scopeと追加scopeの併記も推奨する。今回、OpenAIのツール単位認可契約を満たすため、有効なJWT認証を通過した公開済みツールのscope不足に限り、HTTP 200で配送するMCPエラー結果へ変更する。HTTP 200は結果の配送であり、ツール実行成功ではない。`isError: true`で拒否し、引数の業務検証・送信処理・連携コード発行・検索処理より先に必ずreturnする。HTTP認証境界の匿名／無効JWTは401、許可外主体／有効な対応scopeを一つも持たないトークンは403、無効化した検索の拒否も維持する。未知ツールに新しい認可経路を与えない。

使用中SDKはpackage-lock・インストール済みとも`@modelcontextprotocol/sdk` 1.32.1。ローカルの`CallToolResultSchema`は`ResultSchema`由来の`_meta`を保持し、`isError`を扱う。低水準`Server.setRequestHandler(CallToolRequestSchema, ...)`で返す契約を使用し、SDK交換や独自JSON-RPC送信には変更しない。変更前の独立したSDKシリアライズ試験、変更後の実HTTP応答のschema parse、公式`Client`／`StreamableHTTPClientTransport`でメタ情報が保持されることを確認する。

### 安全診断と検証

既存の一覧成功・全4ツール・HTTP認証拒否の診断に、固定イベント`tool_authorization`（scope拒否）と`authorization_challenge`（SDKから返ったMCP認可要求）を追加する。`tools_call`段階の`protocol_result.success`は`isError`時にfalse、分類は`insufficient_scope`になる。本文・challengeそのもの・トークン・主体・検索語・コードはログに出さない。ランチャーの「認可要求を含むMCPエラー結果の生成」は認可画面表示・実接続成功を意味しない。

追加修正の自動検証結果：

- 関連単体38件成功（OAuth HTTP、検索、ランチャー設定、単一・複数メモ受信）。既存の発見・scope分離試験を補強し、4ツールのscope拒否、challengeのerror／説明／resource metadata／保持scope、SDKのschemaと実クライアントでのメタ情報保持、受信到達0、無効・期限切れ・署名不正・許可外主体のHTTP拒否、秘密値非露出を確認。
- 検索E2E成功。実IndexedDBの全ストア一致・readwrite transaction 0、許可範囲・許可前拒否・取消・期限切れを既存試験で確認。
- OAuth受信E2E、受信復旧E2Eと復旧UI回帰成功。一時履歴・動的ポート・隔離Chromiumを用い、通常Windows権限で実行。既存メモ保持、未保存プレビュー、明示保存／破棄、再送・復旧の経路を確認。
- Windowsランチャー回帰成功。実PS5.1の固定診断、診断OFF、controller、Forms 176ケースを確認。実機プロセスは操作していない。
- JavaScript構文263ファイル、PowerShell構文、差分チェック成功。専用lintコマンド／設定はリポジトリにない。無関係なChart／Report／PDF長時間E2Eはローカルで実行していない。最終HEADの公開CIはPRに別途記録する。

追加差分を自己レビューし、有効な認証済み主体のみがツールscope判定に到達すること、scope不足時に業務処理へ進む経路がないこと、固定診断に本文・主体・challengeが出ないこと、検索・保存・履歴・プロセス管理の本体差分がないことを確認した。第三者レビューや実ChatGPTの認可UI受入とは区別する。

実機受入は引き続き未完了。利用者の明示操作で修正ブランチを起動後、4ツール表示、検索呼び出し時の認可画面、追加認可後も送信可能なこと、連携コード発行、ブラウザのissuer/sub・範囲確認と明示許可、テスト用メモ検索、範囲外・取消後の拒否、保存不変を確認する。画面が開かなければ、固定診断でMCP認可要求生成まで確認できたかをまず区別し、利用者管理下で公開resource metadataへの到達、認可要求のscopeと付与有無を確認する。トークン・主体・コード・検索本文を共有ログに貼らない。実機操作は自動実行しない。Draftを維持し、マージしない。

## 初回のツール発見・OAuth追加認可修正記録（2026-10-21、2111c36時点）

基準main／取得後origin/mainは`c32d3a42f11ba496f4ea8f4b1789fc6efcc98d6c`で一致。専用の新規ブランチで作業し、既存worktree・未追跡work/・実設定・実サービス・保存済みメモ・受信履歴は操作していない。

原因の確定範囲：

- A：修正前の架空RS256 issuer・空きポートで実HTTPの`tools/list`を確認。両scope設定でも送信専用トークンは送信用2、検索専用は検索用2、両scopeは全4だった。`createProtocolServer()`のトークンscopeによる登録制限を再現した。
- B：Aが検索ツールの発見と追加認可の入口を妨げる可能性はある。実ChatGPTがこの理由で追加認可に進まなかったか、自動的に追加認可を開始するかは未実証。
- C：両scopeトークンで全4を返す経路は修正前にも存在する。実接続のサーバー応答が4だったか、クライアント定義・キャッシュが原因かは未確定。従来の「想定2ツール」表示は総数2と送信2種の存在を示すが、実トークンのscope値自体を確認した記録ではない。
- D：実アクセストークンのscope、接続先、Auth0への認可要求・追加認可応答は未確認。管理設定・接続設定は自動変更していない。RBACの変更も行わない。

[MCP認証仕様 2025-11-25（Runtime Insufficient Scope Errors／Step-Up Authorization Flow）](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#runtime-insufficient-scope-errors)に合わせ、実行時403のchallengeに対象操作の最小scopeと`resource_metadata`を指定する。Bearer方式・JWT署名・issuer・audience・exp・allowedSubjectsの検証は変更しない。ツールの`securitySchemes`と`_meta.securitySchemes`は従来どおり必要scopeを宣言する。

安全診断には`toolCount`、`submitToolCount`、`searchToolCount`の件数を追加する。固定ラベルと既存の真偽値以外の要求内容は記録しない。ランチャーは送信用2・検索用2・全4の一覧応答生成、Bearer認証拒否、scope不足の拒否を区別する。観測のない状態は従来どおり通信・実接続未確認として扱う。応答生成はChatGPT側表示や実検索成功を意味しない。検索専用2の表示にも対応するが、新サーバーの両scope設定はトークンによらず全4を返す。

ブラウザ許可の設計は変更しない。連携コード発行、Memo-Nexusでのissuer/sub照合、対象範囲選択、利用者の明示許可、10分の期限、取消・期限切れの拒否は引き続き必要。OAuth scopeだけでは検索できない。

### 自動検証と自己レビュー

- 関連単体38件成功：`mcp-http-oauth.test.js`、`memo-search.test.js`、`memo-nexus-launcher.test.js`、`received-preview.test.js`、`received-notes-preview.test.js`。検索HTTP試験を補強後、`memo-search.test.js`の9件も再実行して成功。設定別・トークン別の一覧、4ツールの不足scope拒否、必要scopeだけのchallenge、認証前の一覧拒否、受信到達0、両scopeでの送信2種・連携コード発行・許可後検索を確認。
- `memo-search.e2e.js`成功：隔離Chromium・架空issuer・実HTTP／IndexedDB。既存の許可範囲、取消・期限切れ、全ストア一致、readwrite transaction 0を維持。
- `mcp-http-oauth.e2e.js`成功：隔離永続受信、未保存プレビュー、明示保存／破棄、再起動・再送、既存メモ保持。sandbox内の初回は`history_permissions`で拒否され、通常Windows権限で再実行して成功。権限検査は変更していない。
- `memo-nexus-launcher.windows-check.js`成功：実PS5.1の診断分類・秘密情報非表示・診断OFF、隔離controller、Forms 176ケース、二重起動拒否、イベント処理。sandbox内の初回は起動経路で失敗し、通常Windows権限で成功した。実8791／8792／Tunnelは操作していない。
- JavaScript構文検査（追跡263ファイル）、PowerShell構文検査、`git diff --check`成功。専用lint設定・lintコマンドはリポジトリにないため、新たなlint依存は追加しない。
- 両scope試験の追加中、テスト側が複数メモのsavePlanを親レコードで参照し、続いてitemIdなしで破棄して失敗した。既存のメモ単位契約にfixtureを合わせて修正し、9件成功を確認した。受信・保存の本体契約を変更していない。

差分の自己レビューで、一覧の設定依存と実行時scope拒否の分離、scope宣言、対象操作だけのchallenge、固定診断、ブラウザ許可と保存処理の不変を確認した。検索アルゴリズム・IndexedDB・検索結果・ページ送り・上限・許可時間・履歴・Tunnel・プロセス管理の変更はない。無関係なChart／Report／PDFの長時間E2Eはローカルで実行しない。公開CIの最終HEADの結果はPRに記録する。

### 実機受入（利用者実施・未完了）

Draft PRの自動試験と実接続受入を分ける。実機受入が完了するまで手動マージしない。

1. 利用者の管理下で修正を含むmainからMCPを起動する。
2. ChatGPTのOAuth Dev接続を更新・再認可する。
3. 全4ツールの一覧表示を確認する。
4. `prepare_memo_search`を実行し、必要なら`memo:search`を追加認可する。
5. Memo-Nexusでissuer/subと検索対象を確認し、明示許可する。
6. テスト用の保存済みメモを検索する。
7. 許可範囲外の検索が拒否されることを確認する。
8. 許可取消後の検索拒否を確認する。
9. 保存済みメモが変化していないことを確認する。

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
