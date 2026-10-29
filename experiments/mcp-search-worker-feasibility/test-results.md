# 検証結果

## 2026-10-29 P2／P3修正と限定診断

T6はBのテスト用ゲートを結果生成前に停止し、B結果・配送がないことを確認後、Aのterminate呼出しを記録し、Bを解放する。Aは架空session A・期待n1・配送先A、Bはsession B・n2・配送先Bで、workerIdとrequestIdも異なる。新規B結果と配送先、旧A結果の拒否を検査する。実OAuthや実認可の検証ではない。現行entryのworkerId・generation・requestIdの単独不一致と別sessionを個別に拒否する。

T1〜T12のstageとsnapshot／比較／T7 iteration・upgradeの境界を更新し、失敗時の `FAIL` と未到達の `NOT_RUN` を記録する。ローカルWindowsのChromium・WebKitで13のstage注入プローブとT6実行中の例外注入が期待する試験番号を返し、T7以降を未実施と記録した。これはローカル検証時のソースであり、最終HEADの結果はCI artifactとSHA-256で照合する。

対照A・Bは各1回、独立した架空DBで実行する。AはWorkerの明示close後、Bは未解決同期点でterminate後にversion 1→2のopenを要求する。ローカルWindowsの2エンジンでは両条件ともupgrade成功だったが、Worker接続の実際の終了とtransaction終端の確認はUNKNOWNだった。ログ記録でタイミングが変化し得る。非計測条件との比較は行っていない。旧中間HEADのLinux WebKit失敗の原因は引き続きUNKNOWN。

計測HEAD `bb914138330a51be179464ecdf3bb41269dda5ae` の[Linux WebKit失敗run #40851321011](https://github.com/tetsujisugimori-coder/memo/actions/runs/40851321011)、job 123371223054、artifact 12887605745では、T7の1〜9回のupgrade成功後、10回目のreadonly request成功・未解決同期点・terminate戻り・version 10→11 open開始を観測。その後8秒間、blocked／upgradeneeded／success／errorは未観測でtimeoutした。transaction終端と接続終了はUNKNOWN。T8〜T12はNOT_RUN。T6のゲートとstage注入は成功した。

同runの対照AはWorkerのclose呼出し後にblockedと8秒timeout、対照Bはupgrade成功だった。ただしこの時のAはtransaction完了を待たずにterminateしており、通常終了と比較する対照として不十分だった。Aだけをtransaction complete後にcloseするよう修正した。期限は8秒のまま、各条件1回で再検証する。この差は原因確定や前回失敗の無効化を意味しない。

修正HEAD `79d5b76727fe99d5dff137ef89a55cd7f6e72cb6` の[CI #40851676069](https://github.com/tetsujisugimori-coder/memo/actions/runs/40851676069)では、Chromium成功、WebKit job 123372417886はT7の3回目でversion 3→4 open開始後に8秒timeoutし、blocked／upgradeneeded／success／errorは未観測。1・2回目は成功。修正後の対照A・Bは両ブラウザで各1回upgrade成功、Aはtransaction completeを観測、BはUNKNOWN、両方のWorker接続終了はUNKNOWN。T6と13件のstage注入・実T6注入は成功。WebKitのT8〜T12はNOT_RUN。[WebKit失敗artifact](https://github.com/tetsujisugimori-coder/memo/actions/runs/40851676069/artifacts/12888020339)を保持する。明示的なWorker ready・旧識別子拒否の観測を追加し、最終HEAD結果はPR・CI artifactに記録する。

同一時系列にはmain受信順の連番とmain時刻、Worker発生時刻を別々に記録する。要求version・旧version、openイベント、transaction・接続・Workerメッセージ、terminate呼出しを記録するが、観測されなかった内部イベントや実際の資源解放を推測しない。各出力は一意名で、失敗した実行を成功した実行で上書きしない。

判定は **PARTIAL**。実測はWindows上のPlaywright Chromium 151.0.7922.34、Playwright WebKit 26.5、架空データ、独立した一時IndexedDB、動的HTTPポート。実アプリ・実認可・実メモ・8791／8792／Tunnelは使っていない。`results-chromium.json` と `results-webkit.json` にソース4ファイルのSHA-256を保存し、対象ソースを特定できる。数値は各1回の局所実行で統計的な性能評価ではない。

実行： `node experiments/mcp-search-worker-feasibility/run.cjs`。WebKitは環境変数 `WORKER_POC_BROWSER=webkit` を指定する。DBは毎回ランダム名で作り、fixture作成だけreadwrite、その後のWorker検索はreadonly。fixtureの2ストア全内容を前後比較する。

| 試験 | Chromium / WebKit | 証拠と限界 |
|---|---|---|
| T1 | PASS / PASS | Worker内のreadonly読取で架空検索と全文を生成。実アプリの正規化・scope実装との同等性は未試験。 |
| T2 | PASS / PASS | Workerから未解決Promiseに入った同期点を受け、結果がまだないことを確認。 |
| T3 | PASS / PASS | T2のPromiseを解決せず`terminate()`が戻り、後続動作に進む。Promise自体の解決・GCは未測定。 |
| T4 | PASS / PASS | 終了後、別Workerで同じテストDBの読取に成功。 |
| T5 | PASS / PASS | 旧Workerが結果を生成した同期点の後に停止し、旧識別子による採用を拒否。 |
| T6 | PARTIAL / PARTIAL | Aの停止後もBのPoC結果が届く。実OAuth・capability・認可状態と配送経路は実装せず未検証。 |
| T7 | PARTIAL / PARTIAL | 12回の生成・未解決・停止の各回後にDB upgrade成功。管理上の最大同時数2、最終管理数0。実メモリ・OSスレッド数・GC・無期限の反復は未測定。 |
| T8 | PASS / PASS | fixture初期化後の全2ストア内容が一致。PoC Workerで29回のreadonly、readwrite 0回。fixture生成時のreadwriteは別。実DBは未検証。 |
| T9 | PARTIAL / PARTIAL | readonlyの要求登録直後、読取成功コールバック中、結果生成の途中で実行を止め、新Workerの読取とupgrade成功。別トランザクションとの実ロック競合待ち、内部の接続解放時刻は未検証。 |
| T10 | PASS / PASS | 実Workerが送った結果をメイン側で保留し、停止・新世代開始後に旧識別子を照合して拒否。OS内部でのmessage配送順序の全組合せは未網羅。 |
| T11 | PARTIAL | 両エンジンで上記を実行。WebKit自動試験はiPhone Safari実機ではない。 |
| T12 | HOLD / HOLD | terminate失敗を注入した場合は受理権限無効化と同セッション枠の再利用拒否を確認。実ブラウザの終了失敗・実資源解放不能は未再現。 |

各最終実行の管理対象Workerは29生成・29回終了API呼出し、最大2、終了時の管理Map 0。これは実スレッドやメモリ解放の計測ではない。単発の生成から結果までChromium約21.3ms、WebKit約18ms、`terminate()`呼出しは計時分解能上0ms。これは終了完了時刻や接続解放の所要時間を示さない。

途中の初回並列実行ではWindows WebKitで `IndexedDB open blocked` が8秒で失敗し、失敗位置の詳細は取得できなかった。診断追加後の単独実行と最終ソースの実行では通過したが、初回失敗を成功に含めず、原因は未確定とする。OS負荷や接続解放が原因だったとは断定できない。失敗時に未採用・HOLDとする本番設計が必要。

中間HEAD `2a608f9` のLinux CIではWebKitが2回失敗し、8秒のDB open待ちがそれぞれT7の1回目とT9の読取中停止後に発生した。Chromiumは成功。失敗を消したり制限時間を延長したりせず、次のHEADでは `blocked` イベントの有無と完了済み結果を失敗時JSONに記録する。イベント有無や遅延が接続・トランザクションのどの内部状態を示すかは断定しない。
