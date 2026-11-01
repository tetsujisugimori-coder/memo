# G time-delay-only：第3段階の結果

記録日時：2026-11-01 23:31 JST。G実行記録：2026-11-01 23:28:25 JST。

1. **総合判定：PARTIAL。** Gの条件成立とupgradeはPASS、transaction状態との因果比較は **INCONCLUSIVE**。全12反復が事前分類 **A**（明示complete待ちなしで成功、停止前complete観測）に該当する。自然完了と時間経過の効果は分離できない。本番Worker **HOLD**、マージ推奨 **NO**、Draft維持。

2. **G条件成立：PASS。** Linux WebKit **26.5**、Node **v22.23.4**、新規browser/context、専用架空DB。runId `16060bc8-4b98-435c-a534-f276b70ae612`、DB `worker-poc-d941090b-4231-4752-9a72-20b40592915f`。実行HEAD `b08c0f8b73ec4184478669fb4ac5907be83dbb52`、tree `7ce3d9c7b33847cccad747ef3376890518b4e1b6`、tracked dirty=false。原版suite/Worker/cleanupとD生成器/observerは不変更。G suiteは保存済みDとバイト一致。T7 unresolved経路に固定タイマーを追加し、transactionDoneのawait・協調close・協調ackは追加していない。元の別modeに存在するtransactionDone待ちは原版のまま残るが、GのT7経路では実行しない。[D→G差分](evidence/D-to-G-worker.diff)。

3. **固定時間：1ms。** Fの同一Worker時計の元データは以下。中央値1msを切り上げ、最小1/最大100の規則で1msを採用。算定commit `8308413ebbe039dbe49e06e9678b920f11df5d56`、決定日時2026-11-01 23:23 JST。[Issue上の事前登録](https://github.com/tetsujisugimori-coder/memo/issues/396#issuecomment-6559233564)はG実行前。[完全なID・元データ・hash](delay-decision.json)、[再計算コード](derive-delay.cjs)。

|iteration|F getAll ms|F unresolved ms|F経過ms|Gタイマー実測ms|G getAll→送信ms|
|---|---|---|---|---|---|
|1|7|8|1|1|2|
|2|5|5|0|1|2|
|3|4|5|1|1|1|
|4|4|4|0|1|1|
|5|4|5|1|2|2|
|6|4|5|1|1|1|
|7|5|6|1|1|1|
|8|4|4|0|1|2|
|9|4|5|1|1|1|
|10|4|5|1|1|1|
|11|4|5|1|1|1|
|12|4|5|1|1|2|

Fは0〜1ms、GのgetAll→送信は1〜2ms。両中央値は1ms、中央値同士の差は0msだが、分布・個別値は異なる。Gタイマー実測もi5では2msだった。設定値を実測値と混同しない。3件の0msは実時間ゼロを意味しない。整数ms記録の厳密な時計分解能/sub-ms値はUNKNOWNだが、9件で非ゼロ差、中央値も1msでありms単位候補を算定可能と判断した。生の異時計時刻は引かず、各領域内で算出した経過時間を比較している。[経過時間比較JSON](evidence/duration-comparison.json)。

4. **実行上限：PASS。** 新独立計画 **1/1試行、retry0、未使用0**。既存8試行の再実行0、結果不変更。Gは最大12反復、open8000ms、cleanup2000ms、試行180000ms（page評価には準備経過時間と終了用予算を差し引く）、context/browser close各5000msを維持。GitHub履歴ガードで唯一のrun `41316288566` / attempt1を確認後に実行した。[履歴スナップショット](evidence/github-history.json.gz)。別run/checkoutをローカル予約だけで防げるとは主張しない。GitHub全workflow履歴・直列化・attempt・排他予約と運用で管理し、権限ある利用者によるworkflow改変までは完全防止を保証しない。証拠commitは対象コードを変更せず再実行しない。

5. **transaction complete観測：12/12。** getAll成功→delay開始→transaction complete→delay終了→unresolved送信を全Workerで観測。各WorkerのsourceSeqは5→6→7→8→9。元のtransaction_complete通知もmainに12回届き、全てstop前。abort/errorはNOT_OBSERVED。completeを待機終了の条件には使っていない。全反復の時計・送受信・停止・IDは[transaction表](evidence/transactions.md)と[原始Workerイベント](evidence/worker-events.json.gz)。

6. **unresolved送信時の認識状態：全12回complete。** Gの送信メタデータにWorker自身が把握した終端状態を保存した。これは事後にmain受信順から推測した値ではない。UNKNOWN/abort/errorも別値で扱う実装と局所試験を備え、状態によるタイマー延長・待ち直しはない。今回は待機中に自然完了したため、未完了状態で停止した対照は得られていない。

7. **Worker停止・close：観測範囲の順序PASS、物理解放UNKNOWN。** 全12回でmain unresolved受信→stop→terminate呼出→戻り→upgrade要求を観測。main停止時の受信済み知識はcomplete。公開APIでその瞬間の内部transaction状態や資源解放を別途確認したわけではない。Worker close_called/close_returned/versionchange/異常closeはNOT_OBSERVED。元のversionchange handler内closeとcatch内closeは保持。terminate後に配送されなかったイベントの有無、正常接続閉鎖、接続残留、物理解放はいずれもUNKNOWN。context.close/browser.closeはRETURNED。[26接続の記録](evidence/connections.json)。

8. **version upgrade：PASS。** iteration1〜12、version1→2〜12→13でopen/upgradeneeded/upgrade transaction complete/open successを観測。main時計のopen→successは0〜1ms。timeout・open error・blockedはNOT_OBSERVED。原始precleanup証拠を保存後、元のcleanupを1回実行して **PASS（記録0ms）**。追加open/delete/回復試験なし。346イベント、pageerror0、overflow=false。元suiteの資源未測定に関するPARTIAL表記は保持し、今回のupgrade限定PASSと区別する。[upgrade表](evidence/upgrades.md)。

9. **D/F/G比較：過去の独立試行との比較。** Dは完了待ち/追加遅延なしでi1成功、i2 version2→3 timeout8000ms、cleanupUNKNOWN。Fはcomplete待ちで12成功、Gは固定時間待ちで12成功。全てWebKit26.5/Node v22.23.4だが同一CIプロセス・負荷・スケジュールではない。Dの通知payload.workerMsのrequest_success→unresolved参考差は0,0msだが、専用getAll/送信イベントがないためF/Gと同一指標とは扱わない。Dの送信時・停止時のtransaction状態はUNKNOWN。D/Fの原始JSONから再計算し、試行は繰り返していない。[全項目比較表](evidence/comparison.md)、[ID・HEAD/tree・各反復の比較JSON](evidence/D-F-G-comparison.json)。原版primaryの失敗DB識別子は依然未観測、GのDBは失敗DBではない。

10. **因果比較：INCONCLUSIVE。** G1は「明示awaitなしで進行する実例」という限定的主張で **SUPPORTED**。時間待ちだけが原因だという一般化はしない。G2は **INCONCLUSIVE**。Gの成功は明示awaitが今回の成功に必須でなかったことを示すが、全反復で自然complete後に停止しており、完了そのものの役割を除外できない。G3は **INCONCLUSIVE**。複合影響は排除できないが実証もしていない。事前分類Aのみ12件、B/C/D/Eに該当する実例は今回得ていない。

|仮説|今回の支持・反対材料|判定と限界|
|---|---|---|
|G1 時間待ちでも進行|1ms設定、awaitなしで12成功|SUPPORTED（単一試行の実例のみ）|
|G2 完了確認が関係|F/Gとも停止前complete、Gも成功|INCONCLUSIVE。自然完了の効果と分離不能|
|G3 複合要因|異なるCI、タイマー/メッセージ/計測の差が残る|INCONCLUSIVE。複合原因の直接証拠なし|

11. **H1〜H4：H1 UNKNOWN、H2 UNKNOWN、H3 UNKNOWN、H4 PARTIAL。** Dの失敗時の未解放接続/transaction未完了を直接確認できていない。Gはcomplete後に成功したため、complete後にも停止するケースの証拠は追加されなかった。blocked不在やterminate戻りでH1/H2を否定せず、WebKitバグとも断定しない。H4 PARTIALは観測不足が残るという意味で、複合原因の確定ではない。

12. **残るUNKNOWNと計測限界。** 正常接続閉鎖/物理解放、terminate後の未配送イベント、実際の停止瞬間の内部状態、D失敗原因、再現率、タイマーとtransaction自然完了の寄与。Gの追加ログ/終端snapshot/error監視/Promise/タイマーと100ms heartbeatにもタイミング影響がある。通常suiteはDと同じだが、G runnerにはabort/error観測時の安全停止ガードも加わる（今回は作動なし）。unexpected anomalyでは部分証拠を保存して有限teardownし、安全な通常cleanupに至れない場合をUNKNOWN/NOT_RUNとして扱う。tracked dirty=falseは全untracked一覧の採取ではない。CI artifactを生のまま保存し、テキストAPI応答のBOM/改行変換はindexに記録した。

13. **次の最小工程：独立レビュー。** 事前登録1msの算定、Gがcompleteを制御条件にしていないこと、送信時snapshotと停止時知識の区別、分類A/INCONCLUSIVE、別runをまたぐ上限ガードの範囲を確認する。現計画の枠は消費済み。追加ブラウザ試行や待機時間変更は行わない。未完了時停止との比較が必要なら、観測可能性を先に静的に検討し、新しい承認済み有限計画へ分離する。本番統合・マージへ進まない。

14. **GitHub・証拠・品質。** [Issue #396](https://github.com/tetsujisugimori-coder/memo/issues/396)、[Draft PR #399](https://github.com/tetsujisugimori-coder/memo/pull/399)（base: #398の `investigate/idb-transaction-complete-only`）、[基準PR #398](https://github.com/tetsujisugimori-coder/memo/pull/398)、[G CI SUCCESS](https://github.com/tetsujisugimori-coder/memo/actions/runs/41316288566)、[F CI](https://github.com/tetsujisugimori-coder/memo/actions/runs/41303212794)。#398→#397→#393の依存を維持し、既存PRの証拠・本文を上書きしない。#398レビューと事前登録コメントも証拠として保存。

実行コマンド `node experiments/idb-time-delay-only/run.cjs`。局所試験 `node --test experiments/idb-time-delay-only/source.test.cjs` は7件PASS。変更はG専用の算定・固定遅延・生成器・判定・履歴ガード・runner・試験・workflow・計画・報告・証拠のみ。元の製品検索/認可/保存は不変更、実ユーザーDB・実認証・8791/8792・Secure MCP Tunnelへの操作なし。既存未コミット作業と未追跡証拠は保護。

Artifact **13087243261**、GitHub archive digest `sha256:844d959103f22742dfd32140ff99a4bfdb3821cf0ec50d6db22c5ce5eb43157b`。[原始JSON](evidence/results.json.gz)、[precleanup](evidence/16060bc8-4b98-435c-a534-f276b70ae612-precleanup.json.gz)、[mainイベント](evidence/main-events.json.gz)、[CIログ](evidence/job.log.gz)、[source/生成物hash索引](evidence/index.json)、[SHA256SUMS](evidence/SHA256SUMS.txt)。実行ソース18件は実行HEADのGit内容と一致。D生成物は前回保存物とバイト一致。前工程19件・F20件の保存証拠もhash一致。

再計算はリポジトリrootで `node experiments/idb-time-delay-only/evidence/recompute.mjs <新規出力ディレクトリ>`。ブラウザなしで原始D/F/Gから算定・分類・対応表・比較を再生成し、実行時analysisとの一致を検証する。出力は排他的作成で既存証拠を上書きしない。全派生物の再計算一致を確認済み。算定だけは `node experiments/idb-time-delay-only/derive-delay.cjs`。

**本番Worker HOLD／マージ推奨NO／Draft維持。マージ・auto-mergeなし。**
