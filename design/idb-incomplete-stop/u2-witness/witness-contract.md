# U-2 観測witness・因果関係契約案

**設計案 v0.1。実ログ未取得、witnessの実在・完全性UNKNOWN。実行を許可する契約ではない。** 親`../contract.md`のR/U、identity、部分順序、UNKNOWN／FAIL分離を優先し、値・enumの変更が必要なら別レビューで明示する。

## 1. 成立させたい命題
`U(target, stopBoundary)` の必要条件：同一対象の**論理IDB transaction**が停止境界で`finished`へ達しておらず、正常な未終端状態（終了へ向かう途中を含むが、abort/異常の始動を正常としない）であることを、観測対象ビルドで識別できる独立記録と確かな因果edgeで立証する。

- `UNFINISHED_AT_STOP` は**断定するには**、対象の`begin`／状態遷移と、実停止境界をまたぐことを保証する観測切断面（witness cut）、cutまでのcommit/abort/abnormalの欠測を検出できる記録完全性が必要。単なる`terminal`の未観測は不可。
- callbackのHELD/CLAIMEDはJS側の操作事実であり、内部状態witnessではない。readonlyはWebKit実装の論理IDBとSQL/SQLiteのレイヤーを分離する。
- `R`はcomplete→complete_sent→complete_received→stopという親契約を維持。`R PASS/U FAIL`は誤りではない。
- `U`の観測評価（成立／不成立／UNKNOWN）と、実験自体の実施状態`conditionU=NOT_RUN`、実行承認`NOT_GRANTED`は別である。

## 2. 提案する独立証拠パケット（概念上。採用済schemaではない）
各パケットは`planId/runId/buildDigest/port/revision/processIncarnation/producerId/producerSeq/recordId`、モノトニックな記録世代（producer epoch）、`eventKind`、`layer`、`nativeConnectionId`、`nativeTransactionId`、JS側の完全identity（runId/dbName/workerId/connectionId/transactionId/iteration）を**結合根拠付きで**保持する。対応していないJS identityはnull + `UNBOUND`とし、同名・同時刻で埋めない。
- `buildBinding`：配布バイナリ本体hash、Playwright lock・browser revision、対象port、対応上流commit、patch/config/build flags、取得者・取得経路・署名/チェック結果。metadataだけなら`METADATA_ONLY`。
- `joinEdge`：発生元sourceの`producerSeq`または明示的ID付きsend→receive／native call→ackなど、実在する因果接続。`sourceMs`や配列位置、収集サーバーの受信順はedgeにしない。
- `transactionEvent`候補：`LOGICAL_IDB_CREATE`、`LOGICAL_IDB_BEGIN`、`COMMIT_INTENT`、`COMMIT_RESULT`、`ABORT_INTENT`、`ABORT_RESULT`、`SERVER_LOSS`、`SUSPENSION`、`DESTROY`。それぞれ発生layer、対象ID、前後関係、結果、観測の確からしさを要求。表示するenum名は設計用で、特定WebKitにそのイベント名が存在するとは主張しない。
- `stopEvent`候補：`STOP_REQUESTED`、`TERMINATE_CALLED`、`TERMINATE_RETURNED`、`SCRIPT_INTERRUPTED`、`CLEANUP_BEGUN`、`CONTEXT_DESTROYED`、`THREAD_EXITED`。どれをUの境界とするか**事前固定**し、他のイベントで代用しない。特にInspectorのworkerTerminated通知は固定#403資料では停止要求経路にあり、実停止のackにはできない。
- `recorderSeal`：producerごとの`expectedFirstSeq/lastSeq/highWaterAcknowledged`、drop/overflow/process-loss/error、flush ack、永続化hash・record count・batch ID、異常終了後に何を確定できるかを示す。tailは自己申告のlastSeqでは完備しない。
- `provenance`：元バイナリ/上流ソースのhash、取得者、ファイルhash、計測器自身の版とhash、取得・改変履歴。署名未確認の場合は`UNVERIFIED`を明示。

## 3. 因果関係とcutの設計
1. 同じproducer内の継続番号が重複・欠番・巻戻りなく保存された時に限ってsource内順序を採用。再起動は新しいprocessIncarnation/epochとする。
2. 異producer間は**IDを伴う確定edgeだけ**を採用する。ログの結合順、monotonic時計の数字、壁時計のオフセット、collector受信順を因果として扱わない。
3. native transactionのbegin→terminal transitionと実停止境界の比較には、**止めることで状態を変えない**cutが成立するかを先にレビューする。独立な2プロセスのログだけでcutが作れない場合はUNKNOWN。計測のためにDBをロックして状態を止める方式は、元の競合を変更するので本研究の証明として採用しない。
4. 「stop以前にterminal結果がない」証明にはterminalを収録し得た全producerと異常経路のカバレッジ、停止cutを包含するhigh-water/flush、消失の否定材料が必要。ログがないだけならUNKNOWN。
5. 停止後にinternal abort/cleanupが始まった場合は、正常未終端だった区間とstop時刻の順序が独立に確立するか判定し、abort不在の推測をしない。停止前にabort intentや異常を観測していたら正常UのPASSは禁止。
6. `COMMIT_INTENT`と`COMMIT_RESULT`、`ABORT_INTENT`と`ABORT_RESULT`、map takeとbacking-store処理、readonly論理transactionとSQLのbegin/commitは別の記録。intentしかない時点でterminalがないとしても「正常」と呼ばない。
7. read success・Worker completeのJS通知とDB処理完了、terminate戻りと実停止/物理解放は別の境界。物理解放は独立証拠なしのままUNKNOWN。

## 4. 判定条件（将来の独立判定器に要求。今回は実装しない）
|段階|成立条件|拒否または判定保留|
|---|---|---|
|資料妥当性|必須ID、schema、source、版、hash、型が有効|不正なら`INVALID_SCHEMA`|
|資料の一貫性|同じIDの重複帰属・端点矛盾・違うビルド混入なし|矛盾なら`INCONSISTENT`、理由保持|
|証拠の完備性|必要producerの記録・stop cut・high-water/flush/overflowなど全て検証済み|欠測なら`INCOMPLETE`、UはUNKNOWN|
|Rの観測|親契約の完全complete chainがmain停止要求前|R PASS/U FAIL（Uの実験状態はNOT_RUN）|
|正常未終端の証明|同一論理tx／同一ビルド／同一process incarnationのBEGIN・stop cut・正常区間・終端/異常の完全性を**確定edge**で証明|片方だけ/worker markerだけ/完了通知欠落ならU UNKNOWN|
|異常／終端|commit/abort/異常の実境界がstop前に確定|正常未終端PASS禁止。確定terminalならU FAIL、異常ならABNORMAL|
|実験承認|独立のレビュー・予算・環境・実行許可・中止/teardown条件|この文書では全てNOT_GRANTED/BLOCKED|

形式不正 > 矛盾 > 不足 > 整合の順で資料statusを判定し、**矛盾と不足の理由を両方保存**する。`CONSISTENT`は書類内の整合のみで、内部witnessの取得・U PASS・安全な実行の認定ではない。

## 5. 残る技術的未決定
- 配布Playwright WebKit revision 2336の*実際のバイナリ*と上流/patch/configの対応が、提供元のメタデータだけを越えて独立立証できるかはUNKNOWN。
- stop cutはどのネイティブ点で取り、内部DB側terminalと同期せずに正しい因果順序を保証できるかはUNKNOWN。ここが解決しなければ設計から実装に進めない。
- recorderがWorker停止・Network/DB process喪失やoverflow下でも完全な終端イベントを記録することは未確認。tailの無観測を陰性証明にしない。
- 計測自身の割込み、IPC、lock、メモリ確保、flushが競合を変更する影響を定量化できるか未検証。非摂動性を宣言しない。
