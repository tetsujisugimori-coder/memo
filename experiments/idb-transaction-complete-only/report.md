# F：transaction-complete-only 結果

記録日時: 2026-11-01 20:49 JST。実行記録: 2026-11-01 20:45:10 JST。

1. **総合判定：PARTIAL。** Fの実験条件成立と12反復のupgradeはPASS。原因の確定はUNKNOWN。追加の協調closeを入れずtransaction完了待ちを加えた条件で進行する実例を得た。本番Worker **HOLD**、マージ推奨 **NO**。既知の原版T7およびDのFAILを維持する。

2. **Fの成立判定：PASS。** 実行HEAD `6b25f7ecf1d3b290958556708fee9899f188c5f2`、tree `af4e504157e334bdc62d0082f614e7489b3a8435`、tracked dirty=false、Linux WebKit **26.5**、Node **v22.23.4**。runId `61b757bd-6b5f-4fdf-aab8-574c511aea93`、DB `worker-poc-877ab5bc-0794-4ccf-97da-5c6664645508`。生成したDのsuite/Workerは前回CI保存物とバイト一致し、FのsuiteはDとバイト一致。Workerだけに完了待ちと関連計測を追加した。[差分](evidence/D-to-F-worker.diff)、[生成差分JSON](evidence/changes-F.json.gz)。

3. **回数上限：PASS。** 今回1試行、前回7＋今回1＝**8/8**、追加リトライ0、未使用枠0。新規browser/context、架空DB1個。12反復、open 8000ms、cleanup 2000ms、trial 180000ms、context/browser close各5000ms。D/Eは原始JSONを再利用し、ブラウザ再実行なし。今回のCI attempt=1、F以外のworkflowは起動していない。局所試験8件PASS。証拠コミットではworkflowの対象コードを変更しない。

4. **transaction完了：PASS。** 12個のreadonly getAll成功、wait開始/終了、transaction completeを各12回観測。abort/errorはNOT_OBSERVED。各WorkerのsourceSeqは getAll=5→wait開始=6→complete=7→wait終了=8→unresolved送信=9。mainにも従来のtransaction_complete通知が12回届き、全て停止要求より前だった。各iterationの完全なIDと送受信・停止順序は[transaction対応表](evidence/transactions.md)に記載。送信と受信を別記録にし、異なる時計領域の時刻は引き算していない。

5. **Worker停止・close：観測範囲でPASS、資源解放UNKNOWN。** 全12回でmainのunresolved受信→stop→terminate呼出→terminate戻り→upgrade要求を観測。Worker側のclose_called/close_returned/versionchange/異常closeイベントはNOT_OBSERVED。既存versionchange handlerとエラー処理内のcloseは生成ソースに残るが、今回その実行を受信ログから確認できない。協調終了時の明示closeとcooperative_ackは追加していない。terminate戻りは終了完了通知ではなく、停止後に届かないWorkerイベントもあり得る。正常接続閉鎖・物理解放・実際の接続残留はいずれもUNKNOWN。[26接続の対応表](evidence/connections.md)、[接続・27 transaction JSON](evidence/connections.json)。

6. **version upgrade：PASS。** iteration 1〜12、version 1→2〜12→13で、open要求・upgradeneeded・upgrade transaction complete・open successを各12回観測。main時計の要求→successは各0〜1ms（時計分解能内の測定値であり瞬時完了とは解釈しない）。timeout/error/blockedはNOT_OBSERVED。cleanupは証拠保存後に元の契約で1回だけ実行し、**PASS、1ms**。context.close/browser.closeはRETURNED。346イベント、pageerror=0、overflow=false、heartbeat受信2回。[upgrade時系列](evidence/upgrades.md)。

7. **D/E/F比較：PARTIAL（異なる過去試行との比較）。** D/Eは実行HEAD `53445474028601131136e2bc540ee48aee83cd7a`、tree `0a9f3bf1d88c035a33ed46efbda4e79207aa378e`、dirty=false、Linux WebKit26.5、Node v22.23.4。Fと同じバージョン表示でも独立CI実行であり、同じプロセス・負荷・内部スケジュールではない。[ID・時系列付き比較JSON](evidence/D-E-F-comparison.json)。

|項目|D（保存証拠）|E（保存証拠）|F（今回）|
|---|---|---|---|
|transaction complete待ち|なし|あり|あり|
|Worker complete観測 / main通知受信|0 / 0（実際の完了はUNKNOWN）|12 / 12|12 / 12|
|停止要求|unresolved受信後|complete・close・協調記録・unresolved後|complete・unresolved後|
|追加の協調close / ack|なし / なし|あり / あり|なし / なし|
|Worker close呼出 / 戻り観測|0 / 0|12 / 12|0 / 0|
|versionchange / blocked観測|0 / 0|0 / 0|0 / 0|
|upgrade|i1成功、i2 2→3 timeout8000ms|12回成功|12回成功|
|残り反復|i3〜12 NOT_RUN|なし|なし|
|cleanup|UNKNOWN、2000ms上限（測定2001ms）|PASS|PASS、1ms|
|物理解放|UNKNOWN|UNKNOWN|UNKNOWN|

DのrunId `eec76e89-5f10-45d0-8830-8dcb3ddf2110` / DB `worker-poc-d12d5caa-4a7d-4223-81c0-0a6cd77a1f74`。

EのrunId `e22b6648-7957-44f7-bb08-a902f835d763` / DB `worker-poc-8de8fd09-68f4-436d-8c65-0297dd6436cf`。

Fでは停止を再現していないので、FのDBを「失敗DB」と呼ばない。原版primaryのiteration8 timeoutのDB識別子は依然未観測。#395関連の識別子取得実験（CI41244959121）の失敗DB `worker-poc-b61a85f0-8a98-44b4-93a6-9b6040827d20` とも別物。

8. **H1〜H4への影響。** H1 接続残留=UNKNOWN、H2 Worker/transaction終了経路=UNKNOWN、H3 WebKit内部処理/通知停滞=UNKNOWN、H4 その他/複合/観測不足=PARTIAL（観測不足が残るという判定で、複合原因を実証した意味ではない）。F1はD/Fの差と整合する相関を得たが、Dの未完了を実測したわけではなくUNKNOWN。F2は今回のF停止を観測していないため支持する失敗例なし、一般的な必要条件としてはUNKNOWN。F3は追加待ち・観測・実行タイミングの影響を分離できずUNKNOWN。Dは成功したi1でもcomplete未観測だったため、「未観測なら必ず停止」という推論もできない。

9. **新たな事実。** 追加の協調closeなしのFで、readonly transaction completeを通知前に確認し、12回のupgradeが進行した。Eの成功に含まれた明示close/協調ackを今回追加せずに成功した実例である。ただし、明示closeが一般に不要、transaction未完了が根本原因、不具合解消、本番安全性、WebKitバグのいずれも証明しない。

10. **UNKNOWNと計測限界。** 正常close完了、ブラウザ内部の接続/transaction/資源状態、terminate後の未受信イベント、versionchange handler内closeの実際の有無、D失敗時のtransaction実状態、再現率、待機と時間経過の寄与。DとFのmain生成ソースおよび100ms heartbeatは同じだが、Fの追加ログ/Promise/error listenerもスケジュールへ影響し得る。Worker計測イベントはmainへのメッセージ配送を経る。対照Bのversionchange→blocked→close→同一要求成功という前回の事実は保持するが、FでblockedがないことからH1を否定しない。CIのdirty=falseはtrackedファイル対象で、untracked一覧はNOT_OBSERVED（生成した証拠ファイルはGit管理外）。

11. **次の最小工程。** この8試行の原始ログとD→F差分を独立レビューし、まず今回の条件成立と因果推論の限界を確認する。追加ブラウザ試験は本工程では実施しない。次工程が承認された場合だけ、transaction状態と単なる待ち時間を分離する対照を新しい有限計画として検討する。現段階では修正採用・本番Worker統合に進まない。

12. **GitHub・証拠・品質。** [Issue #396](https://github.com/tetsujisugimori-coder/memo/issues/396)、[依存元Draft PR #397](https://github.com/tetsujisugimori-coder/memo/pull/397)、[今回Draft PR #398](https://github.com/tetsujisugimori-coder/memo/pull/398)、[F CI 41303212794 SUCCESS](https://github.com/tetsujisugimori-coder/memo/actions/runs/41303212794)、[前回CI 41299732744 FAIL](https://github.com/tetsujisugimori-coder/memo/actions/runs/41299732744)。#398のbaseは `investigate/idb-upgrade-lifecycle`、前工程を経由して#393に依存し、#395は関連証拠の参照のみ。新規Issueは作成せず#396に計画・結果を追記する。

実行コマンドは `node experiments/idb-transaction-complete-only/run.cjs`。局所検証は `node --test experiments/idb-transaction-complete-only/source.test.cjs`。ブラウザ試行はLinux CIだけ。追加変更ファイルはF専用の `source.cjs` (`buildF`)、`wait.cjs` (`waitForTransactionComplete`)、`analyze.cjs` (`analyze`)、`run.cjs`、`source.test.cjs`、専用workflow、計画・本報告・evidenceのみ。元のsuite/Worker/cleanup、前工程ソース、製品処理は不変更。F失敗・条件UNKNOWN・cleanup UNKNOWN・pageerrorをCI成功にしない局所試験もPASS。

CI artifact **13081834516**。GitHub報告のarchive digest: `sha256:de0f64bc47d20a447bd0eb45cb92bbbc412dbed9f948346e2b8bb7681ebff8d9`。取得ファイルは[SHA256SUMS](evidence/SHA256SUMS.txt)で検証し、[index.json](evidence/index.json)に圧縮/原始SHA-256、実行ソース15件のGit一致、生成D/F hashを保存。原始[results.json.gz](evidence/results.json.gz)、[precleanup JSON](evidence/61b757bd-6b5f-4fdf-aab8-574c511aea93-precleanup.json.gz)、[Workerイベント](evidence/worker-events.json.gz)、[mainイベント](evidence/main-events.json.gz)、[CIログ](evidence/job.log.gz)を同梱。原始結果の判定をオフラインで再計算し一致を確認。前工程19件の保存証拠もhash一致を確認した。

独立レビューの論点は、Fが単一の動作条件追加になっているか、complete確認と通知順が十分か、受信不能イベントの扱い、D/Fを因果証明と誤読していないか、追加試験の必要性と有限上限。マージ・auto-mergeは行わない。本番Worker **HOLD**を維持する。
