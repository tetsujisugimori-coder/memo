# Stage U-2A 共通観測契約 v1（P1 / P2、U-C独立）

**契約ID：IDS-U2A-OBS-v1 / Issue #409 / 観測契約の静的固定版。**  
**この文書の MUST／MUST NOT は今後の計測設計と静的検査の判定基準であり、既存製品schemaや実行器に実装済みという主張ではない。**  
2026-11-04 JST。実行承認なし、実測0、独立再レビュー待ち、研究文書マージ推奨NO。

## 0. 適用範囲・不変の親契約

- 親：[#407](https://github.com/tetsujisugimori-coder/memo/issues/407)、[Draft PR #408](https://github.com/tetsujisugimori-coder/memo/pull/408)（固定HEAD `eda663732d1eb98fc4a207eb2698f11a7f373e31`）。
- 最優先の既存R/U：[観測契約v2](../contract.md)（#401が研究baseへマージされたcommit `a72e0657d07632926d2ace9bcd7836cfbc41ac13`）。本書による`conditionU`・`stopCondition`・`conditionR`の意味、JSON schema、判定器、runner、出力値の変更を禁止する。
- 未マージの調査：[PR #403](https://github.com/tetsujisugimori-coder/memo/pull/403)（固定HEAD `b64906439094b9f2bdfcc195fe7ec50895b5d2b4`）を**固定ソース取得の索引としてのみ**参照。対象WebKit配布バイナリとの同一性は未確立。
- 固定参照コード：WebKit上流commit [`343e13bf22dca9d0ec227801419aab0f9001a32f`](https://github.com/WebKit/WebKit/tree/343e13bf22dca9d0ec227801419aab0f9001a32f)。これは実行したLinux WebKit revision 2336のbinary/hash/patch/build flagsを保証しない。G1 = PARTIAL（metadataまで）/ 実体対応UNKNOWN。
- 本研究では**「JSの実行停止」「Workerの終了」「transactionがFinished」**を互いに独立した述語に分ける。同じ単語`stopped`や`completed`を共有しても相互の証拠に使わない。

## 1. 三つの観測軸（対象と証明する範囲を厳格に分離）

### J：JS実行停止 / JS-execution stop

|記号|観測する対象と意味|証明に使えないもの|
|---|---|---|
|J0 STOP_REQUESTED|mainからWorkerへ停止を要求した事実（main sourceSeq）|JSが停止したという結論|
|J1 TERMINATION_SCHEDULED|WebKitが`scheduleExecutionTermination()`を呼んだ事実|実行禁止が到達／実行中のJSが中断／将来のJSが再開不能|
|J2 EXECUTION_STOP_CONFIRMED **候補境界**|対象JS execution incarnationについて、計測対象版のネイティブ点が実際の実行終了・再開不能を**独立に証明**した場合に限る|API`terminate()`戻り、Inspector通知、タイマー停止、`forbidExecution()`要求だけ|

- **J2の成立する実装上の点は現在未特定**。J1からJ2への自動昇格は禁止する。停止が「瞬間」か「区間」かも確認が必要。P1はJ2を特定できるかの**静的調査**であり、J2が観測済みという意味ではない。
- 別のWorker incarnationで新しいscriptが動き始めても、古いJ2の対象と結合しない。
- P1で求める候補は **J2が実証された点** と対象transactionのabort開始／cleanup開始との間の確定因果関係である。「停止要求時刻が早い」という時計比較では不足。

### W：Worker lifecycle / Worker終了

|記号|観測する範囲|推論禁止|
|---|---|---|
|W0 STOP_REQUESTED|Worker停止要求を送った|J2、context破棄、thread退出|
|W1 CLEANUP_ENTERED|専用Workerのcleanup経路に入った|IDBが正常に残っている／完全終了|
|W2 CONTEXT_DESTROYED|指定WorkerGlobalScopeの実破棄をnative側で確認した|OS thread退出、DB connection解放、J2との同時性|
|W3 THREAD_EXIT_CONFIRMED|対象process/thread incarnationに関する、**実thread退出の観測として妥当性が独立確認できた**点|他processのDB処理・物理解放|

- `Worker::terminate()`→`WorkerMessagingProxy::terminateWorkerGlobalScope()`→`WorkerOrWorkletThread::stop(nullptr)`の静的経路では、Inspectorの`workerTerminated()`は終了完了ackでない。引数が`nullptr`であるため、`m_stoppedCallback`が常にアプリへ終了通知を返すとは扱えない。
- `WorkerOrWorkletThread::destroyWorkerGlobalScope()`ではcontext破棄とthread cleanupが別処理。W2とW3を同時とみなさない。公開APIだけではW2/W3の実観測は未成立。
- W1の`prepareForDestruction()`は`stopActiveDOMObjects()`を呼び、通常のActive/InactiveなIDB transactionには`abortInternal()`が始まる経路がある。**W2/W3後のDB map在籍を「正常未終端」として受理してはならない**。

### T：論理IndexedDB transaction状態 / Finished

**必ず層を明示する。** `CLIENT_WEB_CORE`での`IDBTransaction::m_state`は`Active / Inactive / Committing / Aborting / Finished`。`SERVER_LOGICAL_IDB`の要求処理・`BACKING_STORE`のcommit/abort結果、`JS_EVENT`のcomplete/abort配送は別観測である。

|記号|肯定的に確認できる内容|肯定してはならないこと|
|---|---|---|
|T0 CLIENT_ACTIVE/INACTIVE|クライアント側状態の対象時点における値|正常未終端が停止境界まで持続したこと|
|T1 CLIENT_COMMITTING|クライアントが`Committing`に遷移していた事実|DB内部commitが進行中であること、commit結果が未発生であること|
|T2 CLIENT_ABORTING|クライアント側がabortに向かう状態|正常未終端、abort result完了|
|T3 CLIENT_FINISHED|クライアント`m_state==Finished`（`finishAbortOrCommit()`に到達）|DB transaction結果の成功、JS complete eventの配送|
|T4 SERVER_COMMIT_RESULT / ABORT_RESULT|同一native ID・対象層の確定処理結果|クライアントT3、Worker W3、JS event受信|
|T5 COMPLETE_ENQUEUED / DISPATCHED / RECEIVED|それぞれenqueue／Worker内dispatch／main受信を個別に観測|別の段階への自動昇格|

- T1、T2、T3は`isFinishedOrFinishing()`の集合では**区別されない**が、契約上は必ず区別する。`IDBTransaction::stop()`はT0なら`abortInternal()`へ、T1/T2/T3なら追加abortを省く。T1でも既にSERVER_COMMIT_RESULTが先行し、配送待ちの可能性がある。
- `UniqueIDBDatabase::m_inProgressTransactions.take()`はbacking-store commit/abort処理より前に走り得る。map「存在」「不在」の両方ともT3/T4を証明しない。
- readonlyの`SQLiteIDBTransaction::begin()`は`SQLiteTransaction`を作らない経路がある。SQL `inProgress`はSERVER_LOGICAL_IDBの状態を証明しない。
- `request success` ≠ T3/T4/T5、`Worker complete`の未受信 ≠ T0/T1。sourceMsや異source配列順は証拠の因果edgeにしない。

## 2. 判定する命題と研究対象を別管理する

|対象|命題|現時点と他軸への含意|
|---|---|---|
|R（既存）|親#401の「対応completeをmainで停止要求前に受信して停止」の観測|**親の条件と判定器を変更しない**。R PASS / U FAILは正しい組合せ|
|U（既存）|実停止の対象境界で**正常未終端**を独立証明する|**NOT_RUN/UNKNOWN**。T1やJ1やW2だけではPASS不可|
|**U-C（新規・研究専用）**|対象JS Workerの指定した停止境界に対し、**クライアントがCommittingであった**ことと、同じnative transactionの**backend commit resultが未確定**であったことを、独立証拠で別々に判定できるか|研究上の独立命題であり、Uの別名でもサブ条件でもない。**U-Cが将来成立してもU PASSに自動変換しない**|

U-Cでは、観測単位を必ず分ける。
1. `clientCommittingAtCut`：T1のクライアント状態がJ2または明記したW境界に対応すること。両者の因果cutが未成立ならUNKNOWN。
2. `backendCommitPendingAtCut`：同native IDのbacking-store commit resultがcutまで未確定であること。**commit intentだけ、T1だけ、commit通知未受信だけではUNKNOWN**。結果producerの完全性とcut到達を確認する独立記録が必要。
3. `abnormalBeforeCut`：T2・サーバー切断・suspension・destruction等が正常性を否定するか。記録欠落ならUNKNOWN。
4. `boundaryType`：J2・W2・W3のどれを対象とした研究命題かを試験前に明記する。境界を混ぜた比較・事後切替は禁止。

**現時点のU-Cは必ず「研究判定UNKNOWN、実験NOT_RUN」。** 将来用の概念項目例：`ucResearch={scope:"RESEARCH_ONLY", assessment:"UNKNOWN", realExperiment:"NOT_RUN"}`。これは**実装済みJSONではなく説明例**であり、既存`result.schema.json`へ追加してはならない。

## 3. ID、時間、由来、記録完全性

- 必須のJS完全identity：`runId/dbName/workerId/connectionId/transactionId/iteration`。native側：`buildDigest/processIncarnation/producerEpoch/nativeConnectionId/nativeTransactionId`。名称・resource番号・dbNameが同じだけでは結合しない。
- 発生元内の順序：source/producer別の**同一世代内の連番**。異発生元間：ID付きsend→receiveや実際のcall→ackなど**確立済み因果edge**だけ。**時計値、異source配列順、recorder到着順は採用しない**。
- G1：WebKit rev2336とPlaywright 1.62.1のmetadataは上流コードと配布バイナリの一致証明でない。G2：nativeとJSの実ID joinは未確立。G3：J2とDB状態のcutも未確立。G4：各producerの最後までのevent記録・drop/overflow/process-loss・flushの独立確定も未確立。
- 未記録のcommit resultは、**起きなかったことの証拠ではない**。`highWater`や`flush ack`は、全commit/abort/abnormal経路を記録する対象coverageが証明されて初めて陰性証拠の候補となる。
- 資料status：`INVALID_SCHEMA > INCONSISTENT > INCOMPLETE > CONSISTENT`。矛盾と欠落は同時に保持。`CONSISTENT`は本契約の証明成立／実行承認／U PASSと無関係。
- 計測が新たなlockや同期flushを導入してstop/commitの競合を変えるなら、元の実験との対応はUNKNOWN。負の対照に記録し、先へ進まない。

## 4. U-CとP1の判定制約

**P1（cleanup前のJ2）**：`scheduleExecutionTermination()`時点をJ2としない。J2が明示的に確定し、J2→W1/T2の先後と同一transaction状態が**因果的に**証明できる候補がなければ`P1=BLOCKED`。P1の調査結果はU-Cに流用しない。

**P2（Committingを研究するU-C）**：
- `CLIENT_COMMITTING`だけのケース：`clientCommittingAtCut`はcut不足ならUNKNOWN、backendPendingはUNKNOWN。
- `SERVER_COMMIT_RESULT`がcut前：backendPendingは**不成立**。クライアントにT1が残っていても、通知待ちで説明できる。
- `CLIENT_ABORTING`、`ABORT_INTENT`、`SERVER_LOSS`等：正常commit継続の証拠として採用禁止。異常原因と記録完全性を独立評価。
- もしT1かつbackendPendingを**十分な独立証拠**で将来立証しても、これはU-C研究の成立候補にすぎず、元Uは旧契約のまま個別に検証する。

## 5. ゲート・状態の固定

本書での固定状態は次のとおり。論理的な契約確定 ≠ データ取得完了 ≠ 動的実験完了。

|軸|固定値|
|---|---|
|D0|研究文書の独立レビュー待ち（先行#408レビューはPARTIAL）|
|G1|PARTIAL（metadata）、binary/patch/build実体UNKNOWN|
|G2 / G3 / G4|UNKNOWN|
|J2 / W2 / W3 / T3 / T4（対象実行）|NOT_OBSERVED/UNKNOWN（今回は実行しない）|
|U-C|研究評価UNKNOWN、実験NOT_RUN|
|既存conditionU / realExperiment|NOT_RUN|
|executionAuthorization / startCondition / productionWorker|NOT_GRANTED / BLOCKED / HOLD|
|仮説|H1〜H3 UNKNOWN、H4 PARTIAL|
|PR #408と既存研究PR|Draft・未マージのまま、HEAD不変更|

**今回の固定は「語義・推論禁止・将来の判定規則」の固定のみ。実測の証明、既存製品APIの変更、実験の実行権限ではない。** 次のP1/P2専用Issue/PRは本ファイルの固定commit/blobを引用し、条件を改めたい場合はレビュー付きの契約v2を新たに起こすこと。

## 6. 具体的な固定一次ソースの参照

すべて固定WebKit上流commit `343e13bf22dca9d0ec227801419aab0f9001a32f`：
- [`IndexedDB.h`](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IndexedDB.h#L33-L41)：5つのclient transaction状態。
- [`IDBTransaction.h`](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.h#L310-L320)：`Committing`／`Aborting`／`Finished`のfinishing判定。
- [`IDBTransaction.cpp`](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.cpp#L331-L352)：`stop()`の分岐。[`finishAbortOrCommit()`](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.cpp#L502-L509)：T3。
- [`WorkerOrWorkletThread.cpp`](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletThread.cpp#L258-L312)：停止要求・cleanup。[`destroyWorkerGlobalScope()`](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletThread.cpp#L199-L237)：context破棄とcallbackの区別。
- [`WorkerOrWorkletGlobalScope.cpp`](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletGlobalScope.cpp#L63-L80)：W1からActiveDOMObject停止。
- [`UniqueIDBDatabase.cpp`](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabase.cpp#L1211-L1317)：server map takeとcommit/abort結果の順序。
- [`SQLiteIDBTransaction.cpp`](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/SQLiteIDBTransaction.cpp#L56-L95)：readonlyとSQL transactionの分離。
