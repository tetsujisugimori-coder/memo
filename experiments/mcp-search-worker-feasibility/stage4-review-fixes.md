# #393 Stage 3レビュー指摘対応

判定 PARTIAL。局所診断の改善と安全側保持の確認であり、本番統合・本番Worker採用はHOLD。基準remote `ddee81fd50d23e6b49d105e2e57167ce1db61b1f`、tree `8502a25b531ba2885a67bdeaf25e8d836b65ae60`。main `438cf201abe83a53e8cb8e7ed160c4d6dbe147ba` とのmerge-baseは `714b1c63b8be3f0be35d2b1933865bb448343a12`。基準local `c56be04b293e1c516566d2961ba17454349aa494` は同じtree、親commitは別SHAだが親treeも一致。API作成によるauthor／committer表記・親SHAの差があり、SHAだけで内容差としない。既存作業と証拠は変更せず別cloneで作業。

## P2-1：RED→GREEN

旧分岐の `!routeError && !fulfilled` を用いた独立反例は、`other_redacted` が存在すると例外を出さず、拒否を期待するassertが失敗（RED）。新しい `poll-outcomes.cjs` の3単体試験は全成功。immediate／heldは配送200、heldは単調時計で少なくとも249ms、abortはAbortErrorとabort_requested・requestfailed、session切替は旧応答破棄、page/contextは閉鎖イベントと非配送、duplicateは `already_handled` を要件とする。abortと閉鎖中のroute例外はtarget_closedだけを許容し、成功後に例外が出た組合せは許容しない。

Windows Chromium 151.0.7922.34／WebKit 26.5の限定比較は各1回、全7シナリオ成功。即時／保持は200、abortはAbortError、切替は旧結果破棄、閉鎖時はpage_closed、二重fulfillはalready_handled。heldのroute開始から終了までChromium約286ms／WebKit約292ms。新規JSON `evidence/stage4-poll-*.json` にJST時刻、baselineCommit、実際のtestedCommit・tree、dirty状態とソースhash、engine・version・platform・シナリオ・結果を記録。ローカル結果は変更中のc56be04上であり、dirty=trueを明示する。前段の証拠は上書きしない。

実ブラウザの異常注入は各engineで6ケース：予期しないabort側例外、違うduplicate分類、abort不成立、旧結果配送、page閉鎖証拠欠落、context閉鎖証拠欠落。各ケースの非zeroと専用識別子を確認。別の想定外route例外注入も両engineで非zeroと識別子を確認。CIは終了コードだけではなく該当識別子を検査し、起動失敗を期待した失敗に数えない。

## P2-2：実検索E2Eの安全な分類

Windows WebKitで架空issuer・架空メモ・隔離サービスの既存検索E2Eを1回実行し、poll pageerrorを再現してFAIL。`evidence/stage4-search-webkit.json` はrequest ID 33について、requestfailed `connection` が74815.35ms、fulfill開始75347.24ms、fulfill失敗75352.42msで `Error / already_handled`。pageerrorは74814.75ms、page closeは100253.66ms。その順序はこの実行での観測に限る。前回は別の順序を記録しており、近接だけで原因を断定しない。例外名は許可リスト、理由は固定分類、それ以外はother_redacted。ヘッダー・token・Cookie・メモ本文・例外原文は保存しない。WebKit内部の拒否理由と因果はUNKNOWN。製品の検索・認可・保存は変更していない。

## P3と回帰

一時profileは今回の `mkdtemp` が作成したディレクトリのみ、実pathを確認して成功時・通常の失敗時に削除。失敗時に `WORKER_POC_KEEP_FAILED_PROFILE=1` を明示した場合のみ保持し、場所と容量を記録する。削除失敗も記録し非zero。過去のprofileやユーザープロファイルは削除しない。Windows両engineで成功時削除と、注入した試験失敗後の削除および非zeroを各1回確認。

単体28/28（新規判定3、終了2、旧モデル6、broker17）、skip 0。Windows Chromium／WebKitの共有台帳・Worker ack・同一profile再起動の既存回帰は各1回成功。終了通知・terminateだけでは枠を返さず、物理解放はUNKNOWN。生成前予約以外の回収は実装しない。実broker要求の重複配送、配送直前の取消・期限・認可、旧session遮断、#388の未解決Promiseと外部終了証明は別工程。

基準HEADの専用Linux診断は成功、既存PoC WebKitはT7 upgrade timeout／cleanup UNKNOWN、正式CIのChart WebKitは操作timeoutで失敗。前HEADのWindows launcher timeoutも別事象。変更領域との因果は未確認であり、既知の失敗として上書きせず追跡する。最終HEADのCIはGitHubの実行結果を別途参照する。
