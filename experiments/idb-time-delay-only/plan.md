# G: time-delay-only — independent preregistration

決定日時：2026-11-01 23:23 JST。基準PR #398 / HEAD `105d80a467e96aa7038052f501c4a1776a6e69bb` / tree `f879982c6b83ae1ee464b91bfaa5544dd8c6649c`。remote一致を確認。#398の2026-11-01独立レビュー（COMMENTED、PARTIAL/HOLD/NO）を確認。既存8試行と独立した新計画で、上限1試行、追加retry0。

## 固定時間の決定

F原始JSONの各Worker内 getAll_success→unresolved_send は **[1,0,1,0,1,1,1,0,1,1,1,1] ms**。中央値 **1ms**、ceil=1、範囲[1,100]で **1ms採用**。12件のID/時計/元時刻/hashは `delay-decision.json`。`node experiments/idb-time-delay-only/derive-delay.cjs` で独立再計算できる。

記録時刻は整数msで、0msの3件は実時間ゼロやsub-ms値を示さない。9件で非ゼロ差が観測され、中央値も1msであり、要求されたms単位候補を算定可能と判断する。厳密な時計分解能と丸め誤差はUNKNOWN。測れない中央値を推定したものではない。Gの実測値とFの実測値は別々に報告し、同一待ち時間と扱わない。算定commitはこの計画・算定JSONを最初に含むcommitとしてGitHub登録時に完全SHAを明記する。

## 操作条件と安全性

D生成器/observerと元のsuite/Worker/cleanupを再利用。G suiteはDと同一。WorkerのT7 unresolved経路だけに `setTimeout(1)` の固定待機を追加。transactionDoneのawaitは追加せず、complete/UNKNOWNで待ち方や停止判断を変えない。transaction状態は送信メタデータにのみ記録。abort/errorは異常記録として正常PASSを禁止し安全停止する。元のversionchange handler、catch、close、main terminate/upgrade順序を維持。追加協調close/ackなし。

getAll成功、delay開始/終了、complete/abort/error、unresolved送信時のWorker認識状態（complete/abort/error/UNKNOWN）、main受信、stop/terminate/open結果を保存。状態不明は未完了の証明ではない。main停止時点の物理的transaction状態は公開APIから確認できず、最後に受信した知識と区別する。Worker/main/Node間の時計は引かない。

Linux WebKit **26.5**、新規browser/context、専用架空DB、最大12反復、open8000ms、cleanup2000ms、trial180000ms、context/browser close各5000ms。版が違えばDB試験をNOT_RUNとして停止し再実行しない。正常失敗/upgrade timeout/条件不成立/観測異常を別記録。通常経路は原始証拠を排他的保存後に既存cleanupを1回だけ実行。観測異常で安全な通常経路を維持できない場合は部分証拠を保存し有限teardown、cleanupを推測せずNOT_RUN/UNKNOWNとする。追加open/delete/復旧なし。

## 上限の管理

先に算定commitをpushしIssue #396へ登録、その後に専用workflowの実装をpushして1回だけ実行する。workflowはGブランチの専用コードだけが対象。実行前にGitHub APIで当該workflowの全run履歴を調べ、現在runのみ1件かつattempt=1であることを確認。別のrunが存在すれば保守的に拒否。runnerでもGitHub履歴ガードの保存結果・run ID・SHAと排他的予約を照合する。concurrencyは同一G計画で直列化、cancel-in-progress=false。既存D/E/F runnerは実行しない。

権限ある利用者がworkflow/branchを作り替える場合まで完全に防げる保証はない。運用上、追加runを起動せず、GitHub履歴とIssue記録で消費枠を確認する。結果提出後は証拠/reportだけをcommitし、コードを再pushしない。新規workflow_dispatchや再実行は行わない。今回の1試行を消費後、遅延の変更や追加実行は禁止。

## 事前判定

G条件成立とupgrade結果を別判定。全12回upgrade成功かつcleanupPASS・異常なしのみCI成功。abort/errorや反復未完了、cleanupUNKNOWNはCI失敗。completeを観測できなくてもGの時間待ち条件は成立し得るが、因果比較はUNKNOWN。

A: 成功かつ停止前complete→明示awaitなし成功の実例、時間/自然完了の分離はINCONCLUSIVE。B/C: 停止時の未完了が信頼できる場合のみ適用し、UNKNOWNから推定しない。D: timeoutかつcomplete観測→完了だけで説明できない停止候補。E: 終端UNKNOWN→因果比較UNKNOWN。abort/errorその他は別分類。G1〜G3は単一試行から一般化しない。H1〜H3 UNKNOWN、H4 PARTIALを出発点とする。

## 提出物とレビュー

算定・D→G差分・原始JSON・送受信イベント・transaction対応表・upgrade時系列・D/F/G比較・SHA-256・実行HEAD/tree/dirty・Node/WebKit版・CIログを保存。局所静的/疑似イベント試験のみ実行し、ブラウザは専用G CI1回。計測による追加メッセージ/タイマー/Promiseの影響を明記する。既存証拠と未コミット作業は保護。本番Worker **HOLD**、マージ推奨 **NO**、Draft維持。新Draftは#398のブランチをbaseとする。
