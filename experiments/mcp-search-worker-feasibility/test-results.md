# 検証結果

## 今回の修正と結果の読み方

P2-02では削除専用の2,000ms期限を追加した。deleteのsuccessのみをPASS、error／同期例外をFAIL、期限までsuccess未観測ならUNKNOWNとする。blocked単独では完了ではない。primaryの削除待機後に対照A、Aの削除待機後にBを開始し、全削除結果をJSONに保存する。T7の8,000ms期限は変更しない。削除待機の追加は後続実験や計測の順序・負荷を変える可能性があり、timeoutの消失も根本原因確定にはならない。

P3-03では実Workerから受け取った保留結果を、停止後に共通受信処理で再処理して拒否する。別session／workerId／generation／requestIdは各1項目ずつ制御注入し、同一要求の二重配送も拒否する。異なる架空結果n1/n2と配送先を独立した期待値で確認する。これは実受信済みmessageの遅延処理と制御注入であり、terminate後にWorkerから実messageが新たに到着することは未再現。物理的な遅着についてPASSとは判定しない。

新規単体試験13件（削除7、証拠6）は成功。ローカルのT5初回は編集時のfixture文字化けでFAILとなり、修正後の各エンジン1回ではT6・stage回帰を含むPoCが完走した。WebKitではprimary削除のblocked→successを観測。失敗JSONも保持し、過去のLinux失敗を相殺しない。最終コミットの結果はPoC CIの実checkout・hash・artifactとPR #390の最新報告を参照する。

判定語を統一する：PASS＝指定した限定条件のassertを通過、FAIL＝assert／期限失敗、PARTIAL＝実施したが保証範囲不足、HOLD＝安全な継続・採用判断を保留、NOT_RUN＝未到達、UNKNOWN＝観測できず事実を確定できない。UNKNOWNを成功や未実施と混同しない。

## 参照HEAD d2c4ad1の確定済みCI結果（現在の修正ソースとは別）

[CI #40852560234](https://github.com/tetsujisugimori-coder/memo/actions/runs/40852560234)の実checkoutは `ac21059de9589bbc3a62cbd94be5bce15394b50c`。PR HEAD `d2c4ad154583173bbfe37d9223c31950de7adda7` とtree `6d7bbb5ecdcc53035b836cf1d9af807119ffe114` が一致し、保存JSONの実行ソース5件のSHA-256もそのHEADのblobと一致した。Node v22.23.4、Chromium 151.0.7922.34、WebKit 26.5、Linux。

| 試験 | d2c4ad1 Chromium | d2c4ad1 WebKit |
|---|---|---|
| T1〜T6 | PASS | PASS |
| T7 | PARTIAL | FAIL：9回目、version 9→10、8秒timeout |
| T8 | PASS | NOT_RUN |
| T9 | PARTIAL | NOT_RUN |
| T10 | PASS | NOT_RUN |
| T11 | PARTIAL | NOT_RUN |
| T12 | HOLD | NOT_RUN |

このCIのJSONは `evidence/d2c4ad1-ci/` にartifactから無変更で保存し、`evidence-index.json` にrun、artifact、checkout、tree、環境、hashを対応付けた。[Chromium artifact 12888250719](https://github.com/tetsujisugimori-coder/memo/actions/runs/40852560234/artifacts/12888250719)、[WebKit artifact 12887263146](https://github.com/tetsujisugimori-coder/memo/actions/runs/40852560234/artifacts/12887263146)。以下の過去Windows結果とは区別する。

## 過去のP2／P3修正と限定診断（bb91413／79d5b76）

T6はBのテスト用ゲートを結果生成前に停止し、B結果・配送がないことを確認後、Aのterminate呼出しを記録し、Bを解放する。Aは架空session A・期待n1・配送先A、Bはsession B・n2・配送先Bで、workerIdとrequestIdも異なる。新規B結果と配送先、旧A結果の拒否を検査する。実OAuthや実認可の検証ではない。現行entryのworkerId・generation・requestIdの単独不一致と別sessionを個別に拒否する。

T1〜T12のstageとsnapshot／比較／T7 iteration・upgradeの境界を更新し、失敗時の `FAIL` と未到達の `NOT_RUN` を記録する。ローカルWindowsのChromium・WebKitで13のstage注入プローブとT6実行中の例外注入が期待する試験番号を返し、T7以降を未実施と記録した。これはローカル検証時のソースであり、最終HEADの結果はCI artifactとSHA-256で照合する。

対照A・Bは各1回、独立した架空DBで実行する。AはWorkerの明示close後、Bは未解決同期点でterminate後にversion 1→2のopenを要求する。ローカルWindowsの2エンジンでは両条件ともupgrade成功だったが、Worker接続の実際の終了とtransaction終端の確認はUNKNOWNだった。ログ記録でタイミングが変化し得る。非計測条件との比較は行っていない。旧中間HEADのLinux WebKit失敗の原因は引き続きUNKNOWN。

計測HEAD `bb914138330a51be179464ecdf3bb41269dda5ae` の[Linux WebKit失敗run #40851321011](https://github.com/tetsujisugimori-coder/memo/actions/runs/40851321011)、job 123371223054、artifact 12887605745では、T7の1〜9回のupgrade成功後、10回目のreadonly request成功・未解決同期点・terminate戻り・version 10→11 open開始を観測。その後8秒間、blocked／upgradeneeded／success／errorは未観測でtimeoutした。transaction終端と接続終了はUNKNOWN。T8〜T12はNOT_RUN。T6のゲートとstage注入は成功した。

同runの対照AはWorkerのclose呼出し後にblockedと8秒timeout、対照Bはupgrade成功だった。ただしこの時のAはtransaction完了を待たずにterminateしており、通常終了と比較する対照として不十分だった。Aだけをtransaction complete後にcloseするよう修正した。期限は8秒のまま、各条件1回で再検証する。この差は原因確定や前回失敗の無効化を意味しない。

修正HEAD `79d5b76727fe99d5dff137ef89a55cd7f6e72cb6` の[CI #40851676069](https://github.com/tetsujisugimori-coder/memo/actions/runs/40851676069)では、Chromium成功、WebKit job 123372417886はT7の3回目でversion 3→4 open開始後に8秒timeoutし、blocked／upgradeneeded／success／errorは未観測。1・2回目は成功。修正後の対照A・Bは両ブラウザで各1回upgrade成功、Aはtransaction completeを観測、BはUNKNOWN、両方のWorker接続終了はUNKNOWN。T6と13件のstage注入・実T6注入は成功。WebKitのT8〜T12はNOT_RUN。[WebKit失敗artifact](https://github.com/tetsujisugimori-coder/memo/actions/runs/40851676069/artifacts/12888020339)を保持する。明示的なWorker ready・旧識別子拒否の観測を追加し、最終HEAD結果はPR・CI artifactに記録する。

同一時系列にはmain受信順の連番とmain時刻、Worker発生時刻を別々に記録する。要求version・旧version、openイベント、transaction・接続・Workerメッセージ、terminate呼出しを記録するが、観測されなかった内部イベントや実際の資源解放を推測しない。各出力は一意名で、失敗した実行を成功した実行で上書きしない。

## 過去のWindows成功結果（ffe10a4版、最新結果ではない）

以下は **PARTIAL** と判定した過去実行。Windows上のPlaywright Chromium 151.0.7922.34、Playwright WebKit 26.5、架空データ、独立した一時IndexedDB、動的HTTPポート。実アプリ・実認可・実メモ・8791／8792／Tunnelは使っていない。`results-chromium.json` と `results-webkit.json` は過去ソース4件のhashを含む保存証拠で、今回変更していない。実checkoutは当時のJSONにないためUNKNOWN。d2c4ad1や現在の修正版の成功証拠ではない。数値は各1回の局所実行で統計的な性能評価ではない。

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

各過去実行の管理対象Workerは29生成・29回終了API呼出し、最大2、終了時の管理Map 0。これは実スレッドやメモリ解放の計測ではない。単発の生成から結果までChromium約21.3ms、WebKit約18ms、`terminate()`呼出しは計時分解能上0ms。これは終了完了時刻や接続解放の所要時間を示さない。

途中の初回並列実行ではWindows WebKitで `IndexedDB open blocked` が8秒で失敗し、失敗位置の詳細は取得できなかった。診断追加後の単独実行と最終ソースの実行では通過したが、初回失敗を成功に含めず、原因は未確定とする。OS負荷や接続解放が原因だったとは断定できない。失敗時に未採用・HOLDとする本番設計が必要。

中間HEAD `2a608f9` のLinux CIではWebKitが2回失敗し、8秒のDB open待ちがそれぞれT7の1回目とT9の読取中停止後に発生した。Chromiumは成功。失敗を消したり制限時間を延長したりせず、次のHEADでは `blocked` イベントの有無と完了済み結果を失敗時JSONに記録する。イベント有無や遅延が接続・トランザクションのどの内部状態を示すかは断定しない。
