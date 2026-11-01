# F: transaction-complete-only — preregistered single trial

記録: 2026-11-01 JST。Issue #396 / Draft PR #397 の追加工程。基準HEAD `3734f82d117e09355cc721077ead626fa368e451`。独立ブランチ `investigate/idb-transaction-complete-only`、PR base は `investigate/idb-upgrade-lifecycle`。

## 制限と目的

前回CI 41299732744の7試行は保存証拠だけを使用する。今回Linux WebKit Fを1試行、合計8/8、追加リトライ0。新規browser/context、生成済み架空DB名、最大12反復、open 8000ms、cleanup 2000ms、trial 180000ms、context/browser終了各5000ms。既存の失敗は維持。本番Worker HOLD、マージ推奨NO。

F1: readonly transaction未完了でのterminateが関係する。F2: complete待ちだけでは不十分。F3: 内部処理・通知・タイミング等の別要因。いずれも未確定。12回成功なら待ちだけで進行する実例、timeoutなら待ちだけでは防げなかった実例。complete不観測は条件不成立/UNKNOWNでありupgrade失敗と分離する。

## 追加変更

既存D生成器・observerをそのまま読み込む。Dのmain suite生成物はバイト同一。Worker生成物だけに (1) transaction error観測の保持 (2) getAll成功/unresolved送信の記録 (3) T7 unresolved送信前の既存transactionDone待ちを加える。helperはcompleteとobserver terminalを確認し、abort/errorなら元のcatchに渡す。既存エラーハンドラー、versionchange handler、すべての元のclose呼出しは保持。協調終了close/ackは加えない。Dとの差分と生成ソースを保存する。

記録済みtransaction errorと待機中errorのどちらも失敗。completeが来ない場合は元のphase待ち8000msが上限。元のcatchでのcloseは残るが追加closeではない。mainのunresolved受信、stop、terminate、upgrade順序はDのまま。

## 証拠と判定

runId/DB/Worker/logical request/IDB request/connection/transaction/iteration/versionで結合する。Worker単調時計は同じclockDomainだけで比較し、main receipt sequenceは受信順序と因果関係だけに使用する。sourceMsの異時計間の差は計算しない。送信記録と受信記録は別。

原始JSONのprecleanupスナップショットを排他的に保存後、元のcleanupを1回だけ実行。保存失敗ならcleanupへ進まない。main/Worker JSON、生成D/F、差分、source SHA-256、実行HEAD/tree/dirty、Node/browser、CIログを保存。正常close完了と内部資源解放はUNKNOWN。受信されなかったWorkerイベントはNOT_OBSERVED、実際の発生有無はUNKNOWN。

Dと同じ100ms heartbeatとメッセージ観測を維持。F追加の送信2種/待ち記録とPromise/listener処理にも時間影響があり、過去のD/Eとの完全統制比較ではない。イベント上限超過/pageerrorは安全停止。context終了は解放証明ではない。

F専用runnerだけをworkflowから実行する。Linux以外とGitHub run_attempt>1を拒否。出力ディレクトリの排他的予約で同workspace再実行を拒否。workflowは専用ブランチのコード変更だけで起動し、証拠/report更新では起動しない。最初の実行push以降は診断コードをpushしない。旧7試行runnerはimportも実行もしない。異常は非zero終了、PASSに変換しない。実行上限はこの工程で消費し、追加ブラウザ試験は次工程の承認対象。

## 局所検証

`node --test experiments/idb-transaction-complete-only/source.test.cjs`

D/F逆変換・保存済みD生成物との一致・原版hash・既存19証拠hash・既存close/handler保持・complete/abort/error/missing観測・12回の因果順序判定・timeout/cleanup UNKNOWN/pageerror失敗・F専用runner/workflowをブラウザなしで確認する。

実行コマンド: `node experiments/idb-transaction-complete-only/run.cjs`。ローカルWindowsでは実行しない。専用GitHub Ubuntu workflowで1回だけ実行。
