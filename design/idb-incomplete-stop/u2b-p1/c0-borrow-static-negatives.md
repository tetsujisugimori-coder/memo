# C0単一borrow-copy方式：静的負対照

Issue [#420](https://github.com/tetsujisugimori-coder/memo/issues/420)。2026-11-05 JST。以下は**未実装の一案**を反証する条件表であり、動的試験・PASS件数ではない。既存C0-N01～26・CAP-N01～26を変更しない。

|ID|静的入力・反証条件|期待判定|根拠・禁じる飛躍|
|---|---|---|---|
|BC-N01|Ubuntu24.04+WPE/headlessというmetadataだけでbinary/config/generated codeまで同一と扱う|BUILD_BINDING=UNKNOWN|[版対応](https://github.com/tetsujisugimori-coder/memo/blob/b64906439094b9f2bdfcc195fe7ec50895b5d2b4/design/idb-webkit-evidence/version-map.md) はhash/patch/flags不明|
|BC-N02|headlessのWPE経路から非headlessのGTK入口・featureも同一と結論する|PROFILE_CLOSURE=UNKNOWN|pw_run.shは両経路で別Build folderを使用|
|BC-N03|生成されたJSIDBTransactionの実返却wrapperとnative txが結合されない|SAME_TX_IDENTITY=UNKNOWN|[IDBDatabase.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBDatabase.cpp#L213-L222)のnative生成だけでJS returnを証明しない|
|BC-N04|登録台帳のgenerationが欠け、別Worker/VMに同pointerを再利用|JOIN拒否、UNKNOWN|raw pointer値だけをidentityとしない|
|BC-N05|weak.getのrawを保持し、ownerが先にtake/removeされる|RAW_BORROW案FAIL、当該実例の有無UNKNOWN|[WeakPtr.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WTF/wtf/WeakPtr.h#L130-L142)はstrong化しない|
|BC-N06|対象txの既存strong ownerがC0で既にない、又は所在を証明できない|BORROW=UNKNOWN（生存不成立が実証された個別入力はFAIL）|map不在=破棄/Finishedとしない|
|BC-N07|C0で借用前にWeakPtr/RefPtr変換がcallback・GC・destructorを実行|NON_REENTRANT_CAPTURE=UNKNOWN|borrowの読取り区間前も危険区間|
|BC-N08|確認中のcheckpointでActive→Inactive→Active等の状態復帰|同値再読による証明FAIL|ABAによりE/Tの単一cut不成立。F解除を捏造しない|
|BC-N09|正確なTとしてpublic predicates `isActive`/`isFinished`/`isFinishedOrFinishing`のみ使用|TRANSACTION_ENUM_CAPTURE=FAIL|Committing/Abortingが同じpredicate結果|
|BC-N10|worker idle/module失敗でF=false、Eのみ取得|無条件J2候補=FAIL、実J2=UNKNOWN|既存CAP-N01/02の必要条件不成立|
|BC-N11|F=trueだけで過去最外frame/unwind完了と判断|E=UNKNOWN|termination flagと最外scope復帰は別|
|BC-N12|JSLockの最終unlock→VM default queue処理をWebCore IDB checkpointだと断定|誤edgeをFAIL|[VM.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VM.cpp#L1435-L1464)とWebCore queueは別|
|BC-N13|observerがWebCore checkpointを明示実行する|直線区間として拒否、T変化は条件次第|[Microtasks.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/dom/Microtasks.cpp#L69-L103)経路|
|BC-N14|一時強Refを追加してtxの自然解放を遅延させ、無摂動と宣言|MEASUREMENT_PERTURBATION=UNKNOWN|新規ownerの寿命は元と等価でない|
|BC-N15|C0後のCleanupTask producer/payloadを未列挙|ENTRY_COVERAGE/W=UNKNOWN|停止要求のqueue killだけでcleanup全体は閉じない|
|BC-N16|全translation unit/IDL/IPC/JITのmanifestがなくgrepで一致しないだけ|WRITER_COVERAGE=UNKNOWN|検索範囲外を「writerなし」としない|
|BC-N17|同じnative resource numberだがbackend process/connection generationが違う|JOIN拒否、backendPending=UNKNOWN|先行C1/C2/C3規則を保持|
|BC-N18|単一packetの取得成功だけでbackend commit未完了・U-C成立とする|U-C=UNKNOWN|C3 producer独立の結果とC0の因果cutが必要|
|BC-N19|レコードの末尾喪失やproducer lossがあるのに異常/commit不在と判定|RECORDER_COMPLETENESS=UNKNOWN|absence of log ≠ absence of event|
|BC-N20|所有・非再入・全writerが成立する一案を提出したが、実build hashと生成物が欠ける|局所設計PARTIAL／実J2 UNKNOWN|対象buildとの結合なしに証明を拡張しない|

結論：BC-N05/09/10/12のような**明示された不成立条件**と、BC-N01/03/06/16/20のような**証拠未取得**は区別する。今回の一案全体はまだUNKNOWNであり、局所FAILを理由にすべての将来native方式を不可能とも、未知を根拠にPASSとも扱わない。

`J2=UNKNOWN / U-C=UNKNOWN / conditionU=NOT_RUN / realExperiment=NOT_RUN / executionAuthorization=NOT_GRANTED / startCondition=BLOCKED / productionWorker=HOLD`。