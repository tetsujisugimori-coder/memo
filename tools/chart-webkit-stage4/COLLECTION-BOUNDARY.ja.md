# 回収・記録の境界（レビュー 5867717428）

## レビュー 5875046378 対応（2026-11-13）

controllerは起動冒頭の単調時計を基準に、停止要求17秒、回収19秒、追記観測19.5秒、外側20秒を共有する。起動・入力・preflushは17秒まで、cleanupとchild exit/close・読み取り側/書込み側stream close・IPC callbackは19秒までを目標とする。初回確定が早い場合も新規失敗の追記観測は19.5秒まで。期限以降の観測は欠落を埋めず、collection_timeoutとUNKNOWNを残す。19.5秒の終了処理は最終記録を試みて非ゼロ終了する。同期I/O・走査の停止、Node起動前後の遅延、記録自体の所要時間は制限できず、有界性は未証明、実験BLOCKED。残り0.5秒は保証された実行時間ではない。

safetyのfail、childExit、signalResult、preflushRequested、preflushResultは単一の失敗追加関数を通る。新規理由だけを通知し、controller-finishを変更せずcontroller-amendmentに追記する。書込み中の新規失敗はキューで後続追記する。初回記録失敗はinitial_write_failed、追記失敗はamendment_write_failedと共通result_write_failedを保持し、その出力先への結果記録を停止する。controllerはstderrと非ゼロ終了に接続する。原票の完全性・永続化を保証しない。19.5秒以降とprocess終了後のイベント完全性はUNKNOWN。

controllerの起動・root照合・子孫走査・残存確認・signal直前照合はidentity.cjsを使用する。ABSENTはENOENTのみ、READ_ERROR/PARSE_ERRORは失敗かつ不確実な残存として保持する。child exitと/proc観測は別フィールド。PID/開始時刻不一致や識別不能対象へsignalしない。旧process-tree.cjsは未変更。走査前の再親化、未捕捉子孫、照合からsignal送信までの競合はUNKNOWN。LinuxダミーはNOT_TESTED。

詳細な合成証拠、既存2 FAIL、原ログSHA-256はdocs/chart-webkit-infinity/stage4/REVIEW-5875046378.ja.mdを参照。

共通の collection.cjs はプロセスを起動せず signal を送らない。controller は child の exit と close、stdout/stderr の書込み先 close、送信済み IPC の callback を待つ。読取り・書込みエラーと IPC callback エラーは失敗に追加する。child close は IPC と stdio の終了の証拠としてのみ扱い、出力先の close は別に待つ。送信途中の例外や欠測は期限まで残り、期限切れは collection_timeout と UNKNOWN。close 自体は書込み成功や fsync を示さない。最初の記録は controller-finish、以後の新しい失敗は controller-amendment として追記する。集約は全行の失敗の和集合であり、後の正常イベントで FAIL を消さない。追記失敗は stderr と終了コードに表し、同じ経路への再帰記録はしない。記録失敗時はファイルだけで完全な結果を復元できない。

停止 cleanup は同期のみで、thenable は cleanup_async_unsupported として失敗する。completed は呼出しからの復帰のみ。観測終了後の事象は保証できない。同期 filesystem が停止した場合、同じイベントループの timer はその停止を制限できない。PID 競合・再親化・未捕捉子孫は未解決である。

ダミーは同じ collection と stop を使い、1 child、IPC callback、exit/close と期限を実行する。ダミーは stream を使わず、stream エラーは合成試験で模擬する。ダミーの child は自動終了し、異常時は IPC を切断する。identity の ABSENT は /proc の ENOENT のみであり、exit・identity・不在・子孫残存は別証拠。未捕捉子孫は UNKNOWN。共有部分の結果は controller 全体や実原票の回収・保管の証明ではない。
