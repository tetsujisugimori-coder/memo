# Stage 5 停止・復旧契約（研究専用・本番HOLD）

親Issue #392、依存Draft #393。基準 `06796f70f1a42b829ba6c4a2b7e962409aca20e6` / tree `b4e75a686963813edf3ca87dd20e589890f6a63c`。Stage 3・4の記録と過去の失敗は変更しない。既存worktreeには未コミット変更があるため `investigate/mcp-worker-stage5` で分離する。本番検索・認可・保存へのWorker統合は行わない。

## 状態は独立した3軸

論理配送の可否、停止の観測、資源再利用の可否を一つの成功フラグにしない。`recovery-model.cjs` のhistoryは停止要求・terminate戻り・結果配送の記録、`shutdown-protocol.cjs` は協調ackの別プロトコル、`shared-ledger.js` は永続生成予算である。ackプロトコルを製品またはrecovery modelへ接続したとの主張はしない。

|遷移|必要な証拠|許される操作|拒否する操作|
|---|---|---|---|
|未予約 → RESERVED|同一partitionのIDB readwrite transaction complete。capacity内の一意予約ID・owner|生成前取消、台帳検査|予約前のWorker生成、予約失敗時の生成|
|RESERVED → RUNNING|running書込みのcommit後にfactory呼出し。生成例外でも枠は消費|期限・identityを持つ要求の実行|生成済み枠返却|
|RUNNING → CANCEL_REQUESTED|取消、旧sessionの置換。配送資格を先に無効化|terminate要求|旧結果の配送、取消済みgrant IDの再設定|
|RUNNING → TIMED_OUT|要求の単調時計期限、または許可の壁時計／単調時計期限の到来|callerへエラー、terminate要求|期限延長、遅延結果による復活|
|RUNNING／CANCEL_REQUESTED／TIMED_OUT → TERMINATE_REQUESTED|ハンドラー無効化とterminate呼出しの記録|戻り／例外の観測|停止中の再入開始、枠返却|
|協調stop_requested → STOP_ACKNOWLEDGED|現行ID・generation・未受理・期限内のack、IDB close呼出しの申告|ack記録、枠保持|ackを物理解放とみなすこと、重複・旧世代・期限後ack|
|TERMINATE_REQUESTED → RELEASE_UNKNOWN|terminate戻りまたは例外。実終了／IDB・OS解放の直接証拠なし|生成予算の保持、結果の論理遮断|枠回収、terminate戻りだけによる再利用|
|STOP_ACKNOWLEDGED → RELEASE_UNKNOWN（資源軸）|ackはWorker内で実行されており、終了後の外部証明ではない|停止応答の事実と資源UNKNOWNを併記|STOP_ACKNOWLEDGED＝RELEASE_VERIFIED|
|RESERVED → RELEASE_VERIFIED（生成前予約のみ）|同一owner・ID・reservedをtransactionで確認し削除、commit|未生成予約の再取得|running/unknown返却、旧IDで別予約の返却|
|生成済み → RELEASE_VERIFIED|**未定義／到達不能**。対象Worker・全接続・OS資源の解放と、台帳所有権を検証する外部証明が必要|将来の独立設計・レビュー|本Stageでの遷移や回収API|
|資源UNKNOWN → FAILED_CLOSED（受付軸）|生成予算2枠消費、台帳障害、生成／terminate例外|エラー返却、証拠保持|新規生成、session/reload/再起動を理由とする予算復元|

`RELEASE_VERIFIED`を生成前予約に使う場合は「Workerは一度も生成していない予約の解放」と限定する。物理Worker解放を確認した状態ではない。現行台帳のreserved/running/invalidated/stop_requested/unknownと、論理要求の状態を混同しない。

## 上限と復旧条件

### PR #395 独立レビュー後の期限・非同期所有権の補足

レビュー対象 `7e77de239e4a6ee581bb11f60c7a54423b3f201d` は台帳await中のcaller有限終了を満たさなかった。以下はその修正契約であり、過去の「予約待ちも要求期限に含める」という記述だけでは保証できなかった境界を補う。結果・生証拠は [stage5-review-fixes.md](stage5-review-fixes.md) を参照。

|要求／台帳の状態|caller・受付|所有権と許される後続処理|
|---|---|---|
|reserve/running/unknown/release待ち、期限内|caller待機。別要求はbusy|単一のowned taskが台帳操作を所有。stateに操作名・PENDING/SETTLED/REJECTED・owner・台帳名・要求ID・epochを表示|
|台帳操作待ちで期限到来|callerはtimeoutまたはsession_expiredで終了。FAILED_CLOSED|taskは保持。ledger操作期限を初因として保持し、新規要求を拒否。操作が後に完了しても同モデルは自動復帰しない|
|取消／session変更、台帳処理未完了|callerを終了。未完了中はFAILED_CLOSED|旧taskのepochは失効。要求期限の監視は継続。期限前に安全にdrainし、障害がなければ新しいgrantで受付可|
|期限後／取消後にreserve成功|旧callerへ結果配送しない|runningを一度も試していない場合に限り、同じID・owner・reservedを実台帳transactionで照合して1回返却する。返却待ちも所有し、例外／不明応答はfail closed|
|running遷移の要求後（応答不明を含む）|期限・取消なら生成しない|commitが既に成立している可能性があるので返却禁止。running応答確認後はunknown遷移のみ許す。生成0でも枠を保持|
|Worker要求の通常timeout、unknown書込み中|caller終了。書込み未完了中はFAILED_CLOSED|書込みが完了して初因がなければ第二予約可。第一枠はunknownのまま。完了しなければ受付拒否を維持|
|永久未解決の台帳Promise|caller終了、workPending=true、操作PENDING、FAILED_CLOSED|期限応答を物理解放や台帳処理の取消とみなさない。未完了Promiseを捨てるraceは使わない|

`state().request`の`callerSettled`、`responseStatus`、`deadlineExpired`、`cancelRequested`、`ledgerOperation`、`runningAttempted`、`workPending`は別情報。Worker停止要求／terminate結果／物理解放UNKNOWNは既存historyに残す。`coreResolved=true`でも最終検査前なら`delivered=false`。生成前予約の返却はWorker物理解放ではない。

要求期限は開始前からの単調時計。許可期限は設定時に壁時計から単調時計の上限を固定し、両方で判定する。壁時計逆行で延長しない。JavaScriptイベントループが実行可能であることを前提とし、プロセス停止・同期無限ループ・OS suspension中の実時間応答は保証しない。タイマーが遅延しても最後のawait後の期限／epoch検査で結果を拒否する。

既存coreのfailureを容量・許可期限より優先し、`failureCause`に最初の原因を残す。生成／terminate例外と満枠が重なる後続要求は`failed_closed`へ変更（従来は`capacity_unknown`）。障害のない通常満枠は引き続き`capacity_unknown`。取消済みの生成前要求IDも同モデルで再使用禁止。共有wrapperは明示要求IDを最大64件保持し、超過はfail closed。履歴やIDを捨てて再受付しない。

caller応答後、所有taskのdrain確認なしに次を開始しない。通常の第二予約は、台帳処理完了・sticky failureなし・未失効grant・期限内・重複しない要求ID・未消費枠の予約成功が条件。取消／session変更後は別grant IDが必要。上限2は不変更。新モデル作成、別owner、ストレージ消去でこの拒否を回避する製品設計は依然HOLD。

研究モデルの上限は2。`createSharedRecoveryModel`は既存モデルの前に共有台帳予約を置く。予約中も同インスタンスで開始を直列化し、取消／session変更／期限をcommitの前後で再検査する。予約待ちも要求期限に含める。runningに入った後はfactory未実行でも安全側に保持する。結果を得てもunknownへの台帳commitを待ち、その後でsession・generation・取消・許可期限・要求期限を再確認してcallerへ返す。

最初の未解決要求で1枠を消費した場合、別の予約済み枠による1回の合成検索は可能。これは古いWorkerの再利用でも停止証明でもない。論理的に旧結果を拒否できること、生成上限を守れることだけを示す。2枠後は停止。terminate例外は残枠があっても同モデルでFAILED_CLOSEDとなる。モデル再作成を許す製品owner設計は未実装であり、本番でこのモデルだけを使って復旧してはならない。

取消・期限切れ・置換済みのsession IDは同モデルで再利用禁止。新規許可は別IDが必要。履歴は最大64セッションでfail closed、古いIDを捨てて復活させない。結果のrequestIdとgenerationを照合し、一度取り込んだハンドラーからの二重結果を拒否する。要求IDの重複受付も拒否する。ただしbrokerが同じ要求を何度poll配送するかは別の契約である。

共有予算の成立範囲は同一origin／同一IDB partition／同一ledger名・capacityを使う協調的参加者。reload・所有タブ消滅・同じ専用persistent profileでのブラウザ再起動で枠を自動消去しない。古いrunning/reservedに時間ベースの回収を行わない。欠落・旧schema・capacity不一致・不正state・空identity・重複ID・IDB例外は拒否する。**整形式の古い台帳全体への外部ロールバック、ストレージ消去、別profile、非協調コード、OS全体の上限はこの台帳では検出／制御できない**。それらまで安全とする本番統合はHOLD。fixture作成APIは試験準備専用であり実装入口から呼ばない。

## 有限検証計画

- Node: 既存モデル6件・終了protocol2件に、配送直前期限、取消ID再設定、停止中再入、時計逆行、世代／要求重複、terminate例外、非同期予約取消、台帳障害、最終commit中期限、予約期限の境界を追加。旧broker・cleanup・診断判定も対象を限定して実行。
- 実Workerブラウザ: 永久未解決をWorker内で通知して確認、合成brokerタイムアウト後の旧main poll残留は別に観測。第二予約の応答、2枠後拒否、3タブ競争、reload、合成visibility通知、不正台帳、架空notes/metadata snapshot/hash。通常は各engine1回、実装変更・失敗を検証する必要がある場合のみ追加。
- 既存のshared-ledger／ledger-restart／shutdownブラウザ試験を再利用。再起動試験の専用profileは既存の安全なcleanupを使う。正常終了後の枠再利用は試さず返却禁止を確認。
- T7: `stage5-t7.cjs`の固定5条件を各engine各1回、各primary最大12反復。元suite、8秒open timeout、2秒delete timeoutは不変更。primary各180秒、起動30秒、close5秒、独立DB followup11秒、CI22分。起動またはcloseの不明時は後続NOT_RUN。成功まで再試行しない。

|T7条件|基準との差分|解釈の制限|
|---|---|---|
|primary|元worker/suiteそのまま、新規browser/context|今回の原版観測。過去失敗を相殺しない|
|minimal|T7のWorker進捗messageだけをunresolved/errorに削減。T1〜T6とsuite不変更|transaction終端の観測量も減るためUNKNOWNを保持|
|complete-no-close|T7 unresolved通知前にtransactionDoneのcompleteを待つ|原版の停止タイミングとは異なる|
|complete-close|complete-no-closeに明示db.close呼出しだけ追加|close呼出しは実解放確認ではない|
|before-complete-gate|T7 request成功callback内でunresolvedを通知しbusy loop|人工ゲートでcomplete前を固定。原版と非同等。成功・失敗を原版の原因証明に転用しない|

各条件のcleanup後、別名の架空DB open/deleteを同じcontext、次いで別context・同じbrowserで一度ずつ試す。別contextは別プロセスの保証ではなく、別DB成功から失敗DBの解放は推定しない。5条件はそれぞれ新規browser。OS上の実解放は全条件UNKNOWN。元primary失敗時のT8〜T12 NOT_RUNとcleanup UNKNOWNをそのまま格納する。変更したWorker文字列はハッシュと変換コードで再現でき、原版ソースを上書きしない。

## 製品への統合条件（コード読取に基づく、未実装）

基準#393は#388を取り込んでいない。#388 `4fe3ea8` はmainと競合中。heartbeat変更・期限・実pollの契約は別途レビューが必要。

|項目|現行コード／今回の証拠|統合前に必要な追加証拠|
|---|---|---|
|principal|broker `principalKey` / search / delivery、架空issuerの既存E2E|Worker経由でもissuer/subから配送先まで不変。別principal注入拒否|
|Origin・capability|broker control/browserで検証。PoCに実資格情報なし|予約ownerと認可主体の結び付け、Workerからの資格情報漏洩防止|
|sessionId・世代|UI pollはawait後にsession/epochを確認。研究モデルは世代を追加|実poll／Worker／broker／最終配送の一貫した識別子と旧session遮断|
|requestId・二重配送|broker resultはpending ID一致。pollはpendingを繰り返し返せる。モデルでは重複拒否|実要求の配送所有権／claimまたは同等の実行一意性、応答を失った再試行|
|scope・allowRead|brokerとUIで範囲・read権限、saved-searchのreadonly処理|Worker要求受付・読取・結果確定直前での同一scope/allowRead再照合|
|許可期限・取消|モデルでは時計2種と最終commit後の再検査。取消ID再使用禁止|実broker送信直前の原子的取消・期限判定とブラウザ結果送信境界の試験|
|要求タイムアウト|モデルは永久未解決でもcallerを有限終了。資源UNKNOWN|実6秒broker timeout後の旧poll残留の隔離、残予算なしの明示拒否|
|保存|本番保存・検索・認証コードの差分0。専用profileで全store snapshot/hash|統合版で実コードを通るreadonlyと全store不変、ZIP・collection回帰|
|資源と再開|2枠生成予算、ackと解放を分離|共有ownerの失効・新タブによる回避防止、ストレージ消去／rollback時の拒否、外部解放証明|

連携コード120秒、検索許可600秒、要求タイムアウト6000ms、heartbeat5000msは別概念。今回いずれも製品の値を変えない。PoCの短い注入期限は同一契約の代替値として本番に移植しない。

実ブラウザで観測できるのはmessage、transactionイベント、close呼出し、upgrade/delete応答、browser/context closeの戻りまで。実Worker終了時刻・未解決Promiseの内部廃棄・IDB接続の完全解放・OSスレッド/メモリはUNKNOWN。停止後の応答がないことだけで実処理停止をPASSにしない。

判定: PoC機能固有PASSと本番採用は別。総合PARTIAL、本番Worker HOLD、マージ推奨NO。最終実行結果・CI・HEAD対応は `stage5-results.md` とDraft PRを参照。次工程は独立レビューでこの安全境界と残存HOLDを審査すること。
