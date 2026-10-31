# Stage 5 PR #395 独立レビュー対応（P2/P3）

総合 **PARTIAL**、本番Worker **HOLD**、マージ推奨 **NO（再独立レビュー前）**。親 [#392](https://github.com/tetsujisugimori-coder/memo/issues/392)、Draft [#395](https://github.com/tetsujisugimori-coder/memo/pull/395)、依存Draft [#393](https://github.com/tetsujisugimori-coder/memo/pull/393)。実製品への統合・生成済み枠回収は行わない。

## 対象と観測条件

作業開始・push前確認の対象HEADは `7e77de239e4a6ee581bb11f60c7a54423b3f201d`、branch `investigate/mcp-worker-stage5`、base `investigate/mcp-worker-recovery`。#393は `06796f70f1a42b829ba6c4a2b7e962409aca20e6`。PRはDraft/MERGEABLE、既存追跡ファイルはclean。未追跡証拠と別worktreeの未コミット変更は保護した。10月31日の独立レビューはP2候補とP3を静的読取で提示し、今回独立した制御Promiseの故障注入で再現した。

要求60ms（許可逆行試験は許可50ms／要求80ms）、caller観測上限160ms、pending観測180ms、個別試験1500ms。遅延reserveは220ms、その他は観測後に明示解決／reject、永久未解決はそのまま保持。Nodeと隔離about:blankのChromium/WebKitで同じ19ケースを使用。合成台帳・Workerであり、実OS資源の測定ではない。試験用raceは観測を有限化するためだけで、実装の台帳所有権には使わない。

## RED → GREEN（観測事実）

各環境の基準REDは19件中17 FAIL / 2 PASS。最初の修正比較は各19/19。下記の追加競合修正を含む最終Windows版はNode/Chromium 19/19、WebKit **18/19**（応答実測202msで160ms上限を超過）。REDから最終まで `stage5-deadline-cases.cjs` は同一。REDでは永久reserve/running/unknown/releaseが160msの観測上限でもcaller未終了。終了しなかった観測をtimeout成功と数えていない。

|故障|RED|GREENで確認する境界|
|---|---|---|
|220ms reserve遅延|60ms期限に対しNode234.75ms、Chromium233.70ms、WebKit221ms応答|期限でcaller終了。遅延成功を1回だけ生成前返却。生成0、最終FAILED_CLOSED|
|reserve永久未解決|caller未終了|timeout、生成0、返却0、workPending=true、操作reserve/PENDING|
|running commit遅延／永久未解決|caller未終了|生成0でもrunning枠保持、返却0。応答不明のcommitを回収しない|
|unknown commit遅延／永久未解決|coreの結果後もcaller未終了|生成1、配送false、返却0。旧結果は期限後配送しない|
|release遅延／永久未解決|取消後もcaller未終了|取消応答を先に返し、release完了まで所有。二重返却なし|
|取消が期限前／後、session変更とreserve完了|旧実装に有限応答／追跡状態なし|caller完了、旧epoch生成0、遅延予約1回返却、拒否維持|
|期限前／後の台帳例外、満枠|初因の診断なし|初因ledger_reserve_failedまたはledger_reserve_deadlineを保持。容量で上書きしない|
|許可期限中に壁時計を20秒逆行|台帳待ちcaller未終了|単調時計上限でsession_expired。許可を延長しない|
|terminate例外＋満枠／許可切れ|capacity_unknown／session_expiredが初因を隠す|failed_closed、failureCause=worker_stop_unknown|
|正常な第二予約|既存PASS|最初timeout、次result、第三capacity_unknown。生成2、返却0、消費枠2を維持|

caller実測値、全台帳スロット、生成／返却数、途中／最終受付状態は [evidence/stage5-review/index.json](evidence/stage5-review/index.json) と対応JSON（gzip、生データSHA-256付き）を参照。最終の220ms reserve遅延ケースのcaller応答はNode60.21ms、Chromium60.40ms、WebKit70ms。Windows Node 24.20.0、Chromium 151.0.7922.34、WebKit 26.5。計測値はタイマーのスケジューラ遅延を含み、60msぴったりのリアルタイム応答を主張しない。各実行ソースのSHA-256を保存し、途中版と最終版を区別する。

## 最小修正と回帰

- `createSharedRecoveryModel`: caller timerとowned taskを分離。全awaitを追跡し、caller終了後も未完了操作を保持。遅延reserveのみ同一ID/owner/reservedで返却。running試行後はfactory未実行でも保持。最後のawait後にも期限・epoch・core配送資格を確認。
- `preflight/state`: sticky failureを容量・許可期限より優先。初因を独立表示。成功した結果やcaller応答をRELEASE_VERIFIEDとしない。
- `shared-ledger.js`: **変更なし**。既存のtransaction照合を再利用。ブラウザでowner不一致、旧ID、二重返却、running返却拒否を再確認。
- 既存試験の2件はP3の拒否理由を更新し初因assertを追加。非同期取消試験はcaller応答とdrainの観測を分け、返却のassertを保持。台帳mockは実APIのstatusを返す。実Worker試験は有限のdrain確認を追加し、生成2回／第三拒否のassertを維持。

対象Nodeは58/58（新規19、Stage5 14、model6、shutdown2、broker17）、skip/cancelled=0。追加境界は期限前に取消予約がdrainしても同requestIdを復活させないこと、最終commit中のsession変更でcoreの旧結果がcallerへ出ないこと、および以下の2タイマー順序。

実装途中にChromium実台帳の第二予約assertが1回FAIL（生証拠保存、失敗時の詳細stateは未取得）。同じ症状の原因候補として、core側のtimeoutが先に発火しunknown commitへ進み、wrapper期限timerが後に発火する順序を固定すると、`ledger_unknown_deadline`による誤った恒久拒否を再現した（12 PASS / 1 FAIL）。Worker timeout後のcleanupを結果commit待ちと区別し、未完了中は引き続き受付拒否、完了後だけ第二予約を許可する。core-first/wrapper-first両順序でGREEN、実台帳Chromiumも修正後GREEN。元のブラウザFAILとの原因同一性は詳細stateがないため断定しない。

最終WebKitの `reserve-late-duplicate-completion` はcaller timeout応答202ms、期限60ms、観測上限160msのためFAIL。操作中のFAILED_CLOSED、生成0、返却1、旧結果非配送は成立した。イベントループ／環境遅延は候補だが原因UNKNOWN。直前の同ケース成功で相殺せず、上限延長／成功待ち再試行なし。caller有限終了と、160ms以内に観測できたかを区別する。

Windowsブラウザは新規38件中37 PASS / 1 FAIL、既存Stage5 3シナリオ×2=6 PASS、shared-ledger 1スクリプト×2=2 PASS。開発途中の再確認は件数へ重複加算しない。WebKitの最終故障注入FAILで同shellの後続Stage5実台帳はNOT_RUNとなったため、修正したcleanup境界の検証として実台帳スクリプトだけを別に1回実行しPASS（故障注入の再試行ではない）。結果はindexに記録。Stage5実台帳では3タブ／2枠、reload、不正台帳、notes/metadata snapshot/hash一致、同保存接続の観測期間readwrite=0を確認。shared-ledgerは独立した容量1の競合／返却契約回帰であり、容量2試験の代用ではない。

## 既存CI失敗・影響範囲

基準HEADの [Stage5 41197231706](https://github.com/tetsujisugimori-coder/memo/actions/runs/41197231706) はboundary両engine成功、T7 WebKit失敗。原版primary iteration10 upgrade timeout、cleanup UNKNOWN、T8〜T12 NOT_RUN、物理解放UNKNOWNを維持。[旧Stage3 41197231670](https://github.com/tetsujisugimori-coder/memo/actions/runs/41197231670) はChromiumの異常注入でother_redacted／期待識別子欠落によりFAIL、後続NOT_RUN。新試験の成功で相殺しない。

限定読取では `stage5-t7.cjs` が読むsuite/worker等、`poll-compare.cjs` と `poll-outcomes.cjs` に本修正modelのimportはなく、それらのソースと既存原始証拠は不変更。従って今回の直接的なコード依存は見つからないが、CIのタイミング／環境の間接影響と根本原因はUNKNOWN。成功するまでの再実行、skip、pageerror無視、T7の8秒open／2秒cleanup延長はしない。push後に自動実行されるCIは1回分を確認し、実行HEAD/treeと結果をPRに記録する。正式main宛CIはこの依存PRではNOT_RUN。

## 保全と残条件

製品8ファイル、検索E2E、共有台帳、原版T7／poll分類コード、既存証拠の基準との差分／hashはindexに記録する。保存試験は架空DBだけ。実保存領域、実OAuth、8791/8792サービス、Tunnel、実ChatGPTには接続せず、停止・設定変更も行わない。実データそのもののhashはNOT_TESTED。

実Worker停止・OS/IDB完全解放、元T7原因、旧Stage3例外原因はUNKNOWN。永久未完了台帳操作を実際にcancelする機能、生成済み枠回収、外部rollback/消去検出、製品の共有owner・最終認可／配送所有権は未実装。caller有限終了と新規受付拒否のPoCが通ったことだけを本対応のPASSとする。

本番WorkerはHOLD。次の1工程は更新HEADへの独立レビュー（期限競合、late reserve所有権、running非回収、初因、CIのUNKNOWNを確認）。Draft解除・マージ・auto-mergeを行わない。
