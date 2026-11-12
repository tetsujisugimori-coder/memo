# 回収・記録の境界（レビュー 5867717428）

共通の collection.cjs はプロセスを起動せず signal を送らない。controller は child の exit と close、stdout/stderr の書込み先 close、送信済み IPC の callback を待つ。読取り・書込みエラーと IPC callback エラーは失敗に追加する。child close は IPC と stdio の終了の証拠としてのみ扱い、出力先の close は別に待つ。送信途中の例外や欠測は期限まで残り、期限切れは collection_timeout と UNKNOWN。close 自体は書込み成功や fsync を示さない。最初の記録は controller-finish、以後の新しい失敗は controller-amendment として追記する。集約は全行の失敗の和集合であり、後の正常イベントで FAIL を消さない。追記失敗は stderr と終了コードに表し、同じ経路への再帰記録はしない。記録失敗時はファイルだけで完全な結果を復元できない。

停止 cleanup は同期のみで、thenable は cleanup_async_unsupported として失敗する。completed は呼出しからの復帰のみ。観測終了後の事象は保証できない。同期 filesystem が停止した場合、同じイベントループの timer はその停止を制限できない。PID 競合・再親化・未捕捉子孫は未解決である。

ダミーは同じ collection と stop を使い、1 child、IPC callback、exit/close と期限を実行する。ダミーは stream を使わず、stream エラーは合成試験で模擬する。ダミーの child は自動終了し、異常時は IPC を切断する。identity の ABSENT は /proc の ENOENT のみであり、exit・identity・不在・子孫残存は別証拠。未捕捉子孫は UNKNOWN。共有部分の結果は controller 全体や実原票の回収・保管の証明ではない。
