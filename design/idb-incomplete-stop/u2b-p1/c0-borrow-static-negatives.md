# C0単一borrow-copy方式：静的負対照

Issue [#420](https://github.com/tetsujisugimori-coder/memo/issues/420)。2026-11-05 JST。以下は**未実装の一案**を反証する条件表であり、動的試験・PASS件数ではない。既存C0-N01～26・CAP-N01～26を変更しない。

修正前固定HEAD `4bfa3e207a2b1c62f0c80143f951037e1c74a28c`へのユーザー提示の八兵衛P2-01を受け、map所有の離脱と対象の寿命終了を分離する。根拠はWebKit固定commit `343e13bf22dca9d0ec227801419aab0f9001a32f`のみ。事実・条件付き推論・未確認を区別し、実メモリ破壊や実停止の安全性を確認したとは報告しない。

|ID|静的入力・反証条件|期待判定|根拠・禁じる飛躍|
|---|---|---|---|
|BC-N01|Ubuntu24.04+WPE/headlessというmetadataだけでbinary/config/generated codeまで同一と扱う|BUILD_BINDING=UNKNOWN|[版対応](https://github.com/tetsujisugimori-coder/memo/blob/b64906439094b9f2bdfcc195fe7ec50895b5d2b4/design/idb-webkit-evidence/version-map.md) はhash/patch/flags不明|
|BC-N02|headlessのWPE経路から非headlessのGTK入口・featureも同一と結論する|PROFILE_CLOSURE=UNKNOWN|pw_run.shの探索変数は別だが汎用fallbackもある。実binary/featureの同定には別証拠が必要|
|BC-N03|生成されたJSIDBTransactionの実返却wrapperとnative txが結合されない|SAME_TX_IDENTITY=UNKNOWN|[IDBDatabase.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBDatabase.cpp#L213-L222)のnative生成だけでJS returnを証明しない|
|BC-N04|登録台帳のgenerationが欠け、別Worker/VMに同pointerを再利用|JOIN拒否、UNKNOWN|raw pointer値だけをidentityとしない|
|BC-N05|weak.getのrawを保持しmapからtake/remove。移譲先の有無・同一対象の保持区間・最後の解放/寿命終了・raw利用との明示因果を別途照合する|map離脱だけならRAW_BORROW=UNKNOWN。移譲があっても区間全体の保持/非再入未証明ならUNKNOWN。全ownerの最終解放と寿命終了≺raw利用が明示されたモデル入力に限り、そのborrowの寿命要件をFAIL。実事象の発生は未確認|[proxy L375–386](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/client/IDBConnectionProxy.cpp#L375-L386)はtake→別RefPtrの所有。raw自身がstrong化しない事実から、他のownerの消滅や利用時点を推定しない|
|BC-N06|対象txの既存strong ownerがC0で既にないとする証拠、又は所在/移譲先/保持期間が不足|BORROW=UNKNOWN。寿命終了とraw利用の先後が不明ならUNKNOWNのまま。BC-N05の十分条件が揃う個別モデル入力だけ寿命要件FAIL|map不在=破棄/Finishedとしない。生存・区間所有・非再入は別命題|
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

結論：BC-N09/10/12の**明示された不成立条件**と、BC-N01/03/05/06/16/20の**証拠未取得**は区別する。BC-N05の寿命要件FAILは上記十分条件に限定し、map離脱だけの旧FAILを撤回する。今回の一案全体はUNKNOWNであり、生存の確認だけで区間所有・非再入・実停止の安全性をPASSにしない。

## P2-01の原因と所有判定

[事実] `IDBConnectionProxy::didStartTransaction` L376–379はmapからtakeした対象をローカル`RefPtr<IDBTransaction>`へ移し、lockを抜けた後もL385のcallback呼出しまで保持する。`didCommitTransaction` L401–410、`didAbortTransaction` L426–435も同型。[WeakPtr::get L130–142](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WTF/wtf/WeakPtr.h#L130-L142)がstrongを増やさないことと、別RefPtrによる既存所有は両立する。[所有経路の詳細](c0-borrow-copy-closure.md#所有移譲と寿命終了の区別p2-01局所修正)を参照。

[原因] 旧BC-N05は「特定mapのownerが外れた」を「全ownerが解放された」に置換し、raw利用に対する寿命終了の因果も要求せず方式FAILにした。これはBC-N06のmap不在≠破棄、および本文の区間所有UNKNOWNとも不整合だった。

- **A：最後のownerの解放・対象の寿命終了が確認済み**。それだけではraw利用後/前を決めない。寿命終了≺raw利用まで明示された仮定入力だけ、そのborrowの寿命要件FAIL。先後不明ならUNKNOWN。実WebKitの当該利用が発生した証拠はない。
- **B：mapから別RefPtr/taskへ所有移譲**。同じ対象の生存を支持する局所事実。借用開始から最後の利用まで途切れない保持と、全writer/非再入等の別条件が未証明なら方式はUNKNOWN。移譲だけで安全性PASSにしない。
- **C：移譲先/期間/最後の解放/利用との因果が不足・矛盾**。不足・矛盾を保持してUNKNOWN。map不在やrawという型だけでFAILにしない。

## 6条件の静的新旧対照（実験ではない）

旧BC-N05の「weak raw＋先行map離脱→方式FAIL」を適用する文書規則モデルと、固定ソース/上記A〜Cの期待値を対照する。OWN-C01～06は既存BC 20 IDとは別表の6入力であり、動的試験数に加算しない。

|対照|入力・出自|修正前の規則を適用した判定|固定ソースから導く期待値／修正後|静的照合|
|---|---|---|---|---|
|OWN-C01|map take→別RefPtrを確認、C0の全借用区間/非再入は未証明（proxy L375–386）|旧N05は方式FAIL|UNKNOWN。所有移譲は局所生存の証拠で、区間保証は別|旧規則の過剰FAILをRED、修正規則は期待値と一致GREEN|
|OWN-C02|map離脱後、他ownerも全て解放・寿命終了≺raw利用を明示した仮定入力|旧N05は方式FAIL|そのモデルborrowの寿命要件FAIL。実事象/メモリ破壊は未確認|期待値を維持。実WebKitでの再現はNOT_RUN|
|OWN-C03|map takeで移譲あり、移譲先の保持終了点が不明|旧N05は方式FAIL|UNKNOWN。RefPtrが存在した一点から期間を補間しない|RED→GREEN（文書規則モデル）|
|OWN-C04|map take後も生存/区間保持は仮定上確認、非再入は未証明|旧N05は方式FAIL|UNKNOWN。寿命と実行区間の保証は別|RED→GREEN（文書規則モデル）|
|OWN-C05|map離脱はraw利用より前、最後のownerの解放/寿命終了とraw利用の順序は不明|旧N05は方式FAIL|UNKNOWN。寿命終了後の利用を発生済みとしない|RED→GREEN（文書規則モデル）|
|OWN-C06|headlessがWPE探索先を選ぶが、実directory条件・fallback・exec path/digestが不明|旧profileの実binary判定は既にUNKNOWNだが「WPEを選ぶ」との表現あり|EXECUTED_BINARY_BINDING=UNKNOWN、版同一性もUNKNOWN。探索先だけ固定|数値判定のREDは再現しない。探索とbinaryを同一視する記述を明確化|

ここでのRED/GREENはソース事実を前提にした**文書規則の静的矛盾/整合**で、製品judgeの失敗/成功や実UAFの再現ではない。旧規則は上記4入力で期待UNKNOWNをFAILにする。修正後6入力の期待値整合を自己照合した。BC-N01～N20は全行再評価し、N05/N06の条件とN02のWPE根拠を更新、他17行は内容を維持した。N02の期待判定はUNKNOWNのまま。非再入・全writer・build・実identity/cut・recorder・摂動は未証明のまま。

`J2=UNKNOWN / U-C=UNKNOWN / conditionU=NOT_RUN / realExperiment=NOT_RUN / executionAuthorization=NOT_GRANTED / startCondition=BLOCKED / productionWorker=HOLD`。
