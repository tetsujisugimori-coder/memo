# Stage 5 検証記録

総合 **PARTIAL**、本番Worker **HOLD**、マージ推奨 **NO**。状態遷移・再利用禁止・統合条件は [stage5-contract.md](stage5-contract.md)。実装担当者の試験であり独立レビュー完了ではない。

## 開始時確認

2026-10-31 JST。GitHub #393 HEAD `06796f70f1a42b829ba6c4a2b7e962409aca20e6`、tree `b4e75a686963813edf3ca87dd20e589890f6a63c`、Draft/MERGEABLEを再取得。Issue #392、PRコメント・正式レビュー・inline comments（なし）、Stage 3/4記録を確認。既存 `mcp-worker-recovery` worktreeはHEAD `597c1d4`、memo-search.e2e.js変更と未追跡台帳・診断ファイルがあり、そのまま保護。新worktree/branch `investigate/mcp-worker-stage5` を最新remote HEADから作成した。#388は `4fe3ea824b476d2ad6ef3c37fc14b6617be249ee` / Draft / CONFLICTING、#390はMERGED。

開始時の#393正式CI [41193665449](https://github.com/tetsujisugimori-coder/memo/actions/runs/41193665449) は成功（Inspector診断のみSKIPPED）。専用Stage 3 CI [41193665444](https://github.com/tetsujisugimori-coder/memo/actions/runs/41193665444)も両engine成功。一方、既存PoC [41193665493](https://github.com/tetsujisugimori-coder/memo/actions/runs/41193665493) とT7単独 [41193665418](https://github.com/tetsujisugimori-coder/memo/actions/runs/41193665418) はWebKit失敗を保持。primary T7 iteration1、standalone iteration11、upgrade timeoutとcleanup UNKNOWN。前段階の成功を本Stageの証拠に流用しない。

## 今回の変更

- 既存recovery modelに生成中／停止中の受付境界、世代、重複要求、取消済みsession IDの墓標、許可の単調時計上限、停止後と最終台帳commit後の配送直前再検査を追加。
- 同モデルと既存共有台帳をつなぐ研究用入口。生成前予約とrunning commit、予約待ち期限、取消競合、生成済み枠をunknownのまま保持。台帳障害・terminate例外は受付拒否。
- 空identity、不正capacityも台帳不正として拒否。正常終了、terminate、ack、reload、再起動で生成済み枠を返さない。
- 研究用Workerブラウザ試験、有限T7比較、専用Linux CI、証拠メタデータを追加。元T7/suite/workerは不変更。
- 検索E2Eの保持poll routeを処理完了まで登録し、後続pollはfallback、完了後に明示解除。保持routeの例外もassertし、pageerrorの最終ゼロ検査は維持。製品コードは変更しない。

## Windowsで今回観測したこと

Node v24.20.0、Playwright 1.62.1、Chromium 151.0.7922.34、WebKit 26.5。ローカルは基準HEAD上のdirty実装で実行し、JSONにtestedCommit/tree/dirtyと実ソースSHA-256を記録。コミットSHAだけで最終成果と同一とはしない。

|対象|Chromium|WebKit|
|---|---|---|
|Stage 5 Worker境界3シナリオ|PASS|PASS|
|永久未解決Worker内entered観測、timeout|1枠保持|1枠保持|
|別sessionで第二予約の合成全文応答|PASS|PASS|
|第三要求・reload後の新規生成|拒否、追加生成0|同左|
|3タブ同時要求、容量2|2生成・1拒否|同左|
|6種類の欠損／不正／旧schema台帳|全部拒否、生成0|同左|
|既存共有台帳ブラウザ回帰|PASS|PASS|
|既存専用persistent profile再起動|running/reserved保持、生成0、profile削除|同左|
|既存Worker協調ack|旧世代拒否・正しいack受理・重複拒否、返却なし|同左|
|合成visibility通知|枠保持。実OS背景停止はNOT_TESTED|同左|
|物理Worker／IDB／OS解放|UNKNOWN|UNKNOWN|

最終の対象Node試験 **53/53、skip/cancelled 0**。Stage5 10件、旧model6件、shutdown2件、poll判定3件、cleanup/diagnostic15件、既存broker17件。全Nodeテストの全面実行はローカルではしない。

### RED / GREENと故障注入

基準modelに対する新試験8件はPASS 0、assert等のFAIL 6、期限によるcancelled 2。最初の無期限待ちを検知して手動終了した記録も保持し、各試験1500msの上限を設けた有限REDを別保存。未解決や起動失敗を期待した合格に変換しない。修正後はその8件と非同期commit中の期限切れ・予約中期限切れの2件、既存回帰がGREEN。

故障注入は永久Promise、遅延旧ハンドラー、旧session/世代、重複requestId、取消前後、配送直前期限、壁時計逆行、terminate例外、予約待ち取消、台帳例外と破損。実Workerでは生成数・entered通知・caller応答を確認するが、停止後の物理Promise消滅は観測できない。合成brokerタイムアウト後にmainの旧pollがpendingのまま、という別観測を同一の停止成功に数えない。既存shutdownの無応答・期限後ack試験とcleanup/診断のUNKNOWN非PASS試験も維持。

### T7（各条件各engine1回、各最大12反復）

|条件|Windows Chromium|Windows WebKit|
|---|---|---|
|原版primary|T7 PARTIAL、cleanup PASS|同左|
|T7計測message削減|T7 PARTIAL、cleanup PASS|同左|
|transaction complete後・closeなし|T7 PARTIAL、cleanup PASS|同左|
|transaction complete後・明示closeあり|T7 PARTIAL、cleanup PASS|同左|
|人工的にcomplete前で固定|T7 PARTIAL、cleanup PASS|iteration1 upgrade timeout、blocked未観測、cleanup UNKNOWN、T8〜T12 NOT_RUN|

全成功側も物理解放を測定していないのでPARTIAL。WebKit人工ゲートの失敗は原版の根本原因と同一視しない。別名DBの同context／別context followupはWindowsの全条件でopen/delete成功。失敗した元DBの解放を示さない。旧8秒open・2秒cleanup条件は維持。

### Windows WebKit検索E2E

変更前の新規診断はFAIL。保持POST poll ID33について、fixture HTTP200=69061.57ms、pageerror=71576.84ms、requestfailed(connection)=71577.19ms、fulfill開始=71905.60ms、fulfill失敗(Error/already_handled)=71909.96ms、page閉鎖開始=97653.88ms。保持route開始・fulfill開始ともpageClosed=false。ページ閉鎖だけではこの失敗を説明できない。例外原文、token、headers、本文を時系列に書かない。

一回限りrouteを保持中に解除する構造を、1件だけclaimして登録を保持する構造へ変更した比較はGREEN。pageerror=0、最終全store snapshot/hash一致・readwrite=0、既存検索/全文/取消/範囲のassertも成功。インストール済みPlaywrightの`_onRoute`は`willExpire()`で配列から除去してからhandlerをawaitしており、保持中に他のroute操作が起きる条件への関与が候補。**テストハーネスのroute寿命変更が成功に関連したという観測**と、**WebKit内部の具体的なCORS拒否原因はUNKNOWN**を分ける。実検索アルゴリズムの修正とは報告しない。有限待機を追加した最終E2EコードでもWindows Chromium/WebKit各1回GREEN。WebKitはRED1回、修正比較GREEN1回、最終GREEN1回。Chromiumは最終GREEN1回。削除・skip・pageerror無視はない。

## Linux CI（実装コミット5b756ea）と最終差分

[Stage 5 run 41196807578](https://github.com/tetsujisugimori-coder/memo/actions/runs/41196807578)：boundary両engine成功、T7 Chromium成功、WebKit失敗。PR HEAD `5b756ea580e041252cc6d967dc9793acb32fd67a`、実checkoutはPR merge commit `a5997916fa36de10e53d547707fff1b8bf33c25a`、tree `1600ced6c621f8ea2eb73d8c6d8c068920d7863a`、clean。PR HEADのtreeと一致する。Node境界35件/engine、Stage5ブラウザ3シナリオ/engine、再起動/engineを実施。初回CIは検索E2Eを含まず、最終workflowで対象E2Eだけを追加した。

|T7条件|Linux Chromium|Linux WebKit|
|---|---|---|
|原版primary|PARTIAL、cleanup PASS|iteration1でupgrade timeout、cleanup UNKNOWN、T8〜T12 NOT_RUN|
|計測削減|PARTIAL、cleanup PASS|PARTIAL、cleanup PASS|
|complete後・closeなし|PARTIAL、cleanup PASS|PARTIAL、cleanup PASS|
|complete後・closeあり|PARTIAL、cleanup PASS|PARTIAL、cleanup PASS|
|人工complete前ゲート|PARTIAL、cleanup PASS|PARTIAL、cleanup PASS|

別名DBの同context/別context followupは全10条件で成功。これにより「一つのDBの失敗後も、同contextの別DBはこの実行では処理できた」と限定できる。closeなしの成功があるため明示close欠如だけでは失敗を説明できず、人工complete前ゲートのLinux成功もあるためcomplete前停止だけを十分原因とは言えない。計測削減成功はタイミング差の候補を残すが、順序固定・各1回で因果はUNKNOWN。新規browser/contextでも原版が失敗するためprocess分離だけで回復を保証できない。

同HEADの旧Stage3診断 [41196807487](https://github.com/tetsujisugimori-coder/memo/actions/runs/41196807487) と旧PoC [41196807490](https://github.com/tetsujisugimori-coder/memo/actions/runs/41196807490) は成功。一方、旧T7単独 [41196807549](https://github.com/tetsujisugimori-coder/memo/actions/runs/41196807549) はWebKit iteration12でupgrade timeout、cleanup UNKNOWN。成功した別runで失敗を相殺しない。正式CI workflowはmain宛PRのみが対象のため、#393をbaseとする#395では**NOT_RUN**。基準#393の正式CI成功を#395の成功とは書かない。

最終追記では、共有モデル内部の結果解決（coreResolved）と台帳commit後のcaller配送（delivered）も区別した。最終commit中に期限が切れたときdelivered=falseを試験。対象Node53件、Windows境界3シナリオ/engineを再確認し成功。T7実行ソースとE2Eコードはこの追記で不変更。最終CIはLinux検索E2E追加を含め1回だけ実行し、その実行HEAD・結果をPRへ追記する。失敗したT7の成功待ち再実行は行わない。

## 証拠の場所と件数

[evidence/stage5/windows-index.json](evidence/stage5/windows-index.json) はWindowsの生JSON/ログとraw SHA-256、製品8ファイルの基準／変更後SHA-256一致を記録（ソース比較はCRLFをLFへ正規化）。T7の大きいJSONはgzipで保存し、raw hashをindexに記録。原版の過去証拠は不変更。[linux-5b756ea-index.json](evidence/stage5/linux-5b756ea-index.json) は初回Linuxの実checkout・状態・失敗・cleanup/followupをまとめる。最終delivery-state回帰ログと追加browser JSONも同ディレクトリに保存。

Windows最終受入の数え方は、Node53件、ブラウザ境界/既存回帰12シナリオ（Stage5 3＋共有台帳1＋再起動1＋ack1、各engine）、T7比較10条件、検索E2E最終2実行。開発中のREDや中間再確認はこれらに加算せず別の証拠として保持する。ackは協調停止準備の観測、実処理停止はUNKNOWN。永久Promiseとbroker旧pollは別の合成経路であり、実製品の復旧成功には数えない。

## 保存・認証の不変

専用ephemeral listener、架空issuer、架空メモ、独立context/profileだけを使用。8791/8792はテスト内の論理URLをephemeral portへrouteするだけで、実サービスの停止・再起動・実トークン取得・Tunnel/ChatGPT接続を行わない。製品検索・broker・UI・認可・保存・ZIP・コレクションのコード差分は0。架空notes/metadataのsnapshotとSHA-256、検索E2E全store snapshotとhash一致を記録。REDだったWebKit E2Eでも保存hashは前後 `b10d482bae61308d20f52ca2cac854a13513b1ba33aa0e0a8379cb9bc1bbc571`、readwrite=0だった。実ユーザーデータ自体は読取・検査していない。

## A〜Iの評価と残件

|条件|評価|
|---|---|
|A 生成上限|PASS（同origin/partition・協調台帳の2枠）。外部rollback/消去/別profileはHOLD|
|B 旧結果の非混入|PoC PASS。本番Worker経路はNOT_IMPLEMENTED|
|C 期限・取消の非復活|PoC PASS。実配送先までの統合はHOLD|
|D ackと資源解放の区別|PASS（契約・既存protocol回帰）|
|E 解放不明の安全停止|PoC PASS。枠回収禁止、2枠後拒否|
|F 保存領域不変更|製品差分0・隔離fixture不変PASS。実保存領域には未接続|
|G エンジン比較|Windows/Linuxの差と実行SHAを記録済み。最終CIはPR追記|
|H WebKit T7|根本原因／物理解放UNKNOWN。失敗・NOT_RUNを維持|
|I 統合残条件|文書化済み、実証不足のためHOLD|

UNKNOWN: 実処理停止・OS資源、T7原因、WebKit内部route拒否機構。NOT_TESTED: 実ChatGPT、実OAuth、実OSの背景制限、iPhone Safari、整形式台帳rollback。HOLD: 製品Worker採用、生成済み枠回収、自動復旧。次の1工程は最終HEADへの独立レビュー。必要な最小追加証拠は契約表に示した実配送所有権・最終認可・共有ownerの失効／ストレージ消失時の拒否であり、まだ製品統合を推奨しない。
