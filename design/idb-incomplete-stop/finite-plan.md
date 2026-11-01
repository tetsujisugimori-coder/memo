# 次工程用有限計画案 IDS-U1-20261102-DRAFT

**未承認・今回実行しない。今回のブラウザ許可数0。旧計画の枠は転用しない。** 次工程実行は本Issue/PRの独立レビューとは別に、具体的な実装・証拠境界・環境を提示して明示承認を得る。現時点はstopConditionの独立証明未確立につきBLOCKED_PENDING_REVIEW。

## 条件・目的

新しい人工条件Sで、callback保持／transaction終端の証拠とupgradeの関係を観測可能か調べる計画案。2条件、各1試行、各1反復、最大2試行、retry0。順序R→U。RもF/Gの再実行ではなく、同一の追加readonly要求・共有ゲート・隔離条件を持つ新対照。

- R：同じ2要求と有限共有ゲートを作り、mainが明示release、Worker completeを受信して停止。追加db.closeなし。
- U：同じ2要求・ゲートでclaim後に停止境界を記録する案。独立の未終端証明が確立していなければUはNOT_RUN。callback保持の狭い問いへ変更する場合も別の計画改訂・承認が必要。

### 条件別の判定とupgrade観測前提

|項目|R：完了通知受信後の停止|U：正常未終端の停止|
|---|---|---|
|記録の妥当性|validTrace PASSを要求。FAILなら記録不正、R/UはUNKNOWN|同左|
|観測条件の成立名|conditionR。対象complete→complete_sent→complete_receivedの参照、同一main連番の受信→stop→terminate呼出/戻り、対象要求・send/receive対応、異常なし|conditionU。正常未終端を停止境界まで裏付ける独立witnessと完全な対応、異常なし。stopConditionはこのUだけの互換alias|
|完了後停止の同じ証拠|conditionR PASS|conditionU FAIL・COMPLETED_BEFORE_STOP。Rの失敗とは扱わない|
|Worker completeだけ／対応受信なし|UNKNOWN|UNKNOWN。未完了の証明にしない|
|対応受信が停止要求後|conditionR FAIL・RECEIVED_AFTER_STOP|UNKNOWN。内部完了の発生時点を遡って確定しない|
|将来upgradeを観測する必要条件|別途の実行承認、全体前提、同一2要求/ゲートrelease等のR操作契約、validTrace PASS、conditionR PASS。U判定は参照しない|別途の実行承認、全体前提、U操作契約、validTrace PASS、conditionU PASS。公開記録では独立証明不足のためNOT_RUN|

この表のconditionRは「完了後停止という観測」の述語であり、fixture・ゲート・環境・予算・保存経路を含む試行全体の安全性証明ではない。これら全体前提も実装レビューで確認する必要がある。純粋判定器は実行承認やupgrade起動を行わない。Rが成立しても本計画の開始条件BLOCKED・将来実験未承認は解除されない。

RのconditionRが不成立/UNKNOWN、Rのupgrade失敗、cleanupUNKNOWN、終了UNKNOWNならUはNOT_RUN。RのconditionU FAILは予定どおりであり、この中止条件には含めない。UのconditionU不成立・UNKNOWN・異常・timeoutで終了し、繰り返さない。D/E/F/G・1ms調整・成功までの再試行は禁止。1反復に縮小する理由は、再現率調査の前に証明境界の可否を検証するため。旧12反復を引き継がない。

## 上限（実装前に固定）

|資源/期限|上限|理由|
|---|---|---|
|browser/context/Worker/DB|各試行で新規browser1/context1/Worker1/架空DB1|他試行との接続共有なし、実ユーザーDBなし|
|fixture|notes最大32件、1件JSON最大1KiB、全体UTF8最大64KiB、store1|内部負荷を大きくして未完了を作る方法は採らない|
|fixture操作|open v1 1回、setup readwrite tx1、put最大32|専用架空DB初期化だけ。元製品保存に接続しない|
|対象readonly|tx1、getAll(count32)1回＋固定key get1回、合計2要求|無限チェーンなし。追加要求はそのsuccess callback内の1回のみ|
|open|fixture1＋Worker1＋upgrade v2 1＝最大3要求、各8000ms|旧上限維持。遅いsuccessによる再要求なし|
|shared memory/ゲート|64B、epoch1、claim1、release1、同期wait1回・500ms指定|busy loop/再waitなし。500msは配送監査の期限案で、未完了判定の根拠や成功率調整値ではない|
|main受信/claim|500ms監視、延長なし|timeoutは不成立。Atomicsの実復帰にはpadding/遅延があり得るのでNode側期限も併用|
|ログ|最大512events/1MiB/試行、行最大4KiB、レコード本文なし|上限超過で停止、黙った切捨てでPASSにしない|
|CPU/プロセス|busy loop0、同期wait1、専用診断プロセス1|CPUの厳密な使用率上限は公開API保証なし。専用プロセスの有限外側終了と計測を必要条件にする|
|試行|開始から180000ms、保存・teardown用20000ms以上予約|旧上限維持。保存5000＋cleanup2000＋context5000＋browser5000＝17000msに余裕を設け、内側残予算を減らす。期限延長なし|
|証拠保存|1回のスナップショット5000ms期限、SHA-256確認|失敗後の試行継続/削除なし|
|cleanup|deleteDatabase1回、2000ms|旧上限維持。UNKNOWN保持|
|context/browser close|各5000ms|旧上限維持。両RETURNEDでも物理解放UNKNOWN|

CPU監視やタイマーまで停止した場合、専用診断子プロセスだけを有限watchdogで終了する経路を別途実装レビューする。既存サービス・任意PID・共有ブラウザを終了しない。硬い実時間終了保証をJSタイマーだけに求めない。外側監視が用意できなければ実行しない。

## 停止と保存の順序

1. 実行前に計画ID/条件/試行予算、環境・source hash・判定版をGitHubへ登録。新規browser/context/DB以外を使わない。
2. 対象ゲート前のID/fixture情報、Worker/mainの有界ログを収集。main stop直前にファイルI/Oを挟まない（新たな競合を増やさない）。stop/call/return/post-call共有snapshotは同期でローカルringへ記録。
3. 記録不正/異常、または**選択した条件**の不成立/UNKNOWNなら後続upgradeをNOT_RUN、追加request禁止。RではconditionR PASS、UではconditionU PASSに加え、上表の実行承認・全体前提・操作契約を満たす場合だけ予定した1回のupgradeを観測する案。RのconditionU FAILを中止理由にしない。Uの独立witness不足ならU NOT_RUN。timeoutを研究結果FAILとして保持し回復操作しない。今回は両条件とも未承認・NOT_RUN。
4. 一切のcleanup前に、失敗を含む原始ログ・ID・状態・source SHAをNodeへコピーして排他的新規ファイルへ保存しhash照合。保存失敗ならdeleteを呼ばない。可能な部分証拠と保存エラーを外側へ残す。
5. 保存成功後だけ既存cleanup契約のdelete1回。期限後は取消・再delete・追加openを試さずUNKNOWNのまま。元のlate-open close処理がある場合は別記録し変更しない。
6. context/browserを有限終了。安全なcleanupへ進めない異常ではcleanup NOT_RUN/UNKNOWN、部分証拠を保持してteardown。内部停止確認なしのslot再利用なし。後続条件はNOT_RUN。

## 実行前の必須固定・不成立条件

Linux OS/container digest、Node/Playwright lockとbrowser build revision・SHA、WebKit26.5へのソース対応、launch flags、CPU/メモリ制約、secure origin、COOP/COEP全レスポンス、main/Worker crossOriginIsolated、SAB/Atomics利用可否・agent cluster、ゲートの終了割込みと内部abortの契約を固定する。環境preflightも将来2試行予算内に含め、別の隠れたbrowser試行を作らない。今回は全て静的な必要条件で未実測。

生成Worker/main/observer/判定器/ゲートschema/全fixtureのSHA、基準commit/tree/dirty、証拠保存方式、normal/abnormal終了をレビューしてから固定。対応不明・異なる版・計測漏れ・手続き中例外・CPU/ログ/データ上限超過なら停止。SAB非対応をbusy loopへ切り替えるfallbackはない。

## 意図しない起動の防止

今回はrunner/workflow/依存追加0。将来も実験をpush/PRに結び付けない手動運用をレビューし、GitHubの計画ID別永久ledgerとrun履歴・attemptで消費を予約する。別checkoutのローカル排他だけでは不足。新run/再run/別workflowによる重複も拒否し、権限者による改変を完全防止できない限界を明記する。将来の証拠commitは実行対象外。計画承認前にworkflow_dispatchもしない。
