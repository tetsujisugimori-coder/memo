# C0安全状態取得方式A〜Dの比較

**総合PARTIAL／選択B：現設計には重大な未解決事項があり、代替設計の検討が必要。採用候補は未決定。J2実証UNKNOWN。**
2026-11-05 JST。Issue [#418](https://github.com/tetsujisugimori-coder/memo/issues/418)、親#411／Draft #417。研究文書完成は実験許可ではない。

## 1. 固定対象と証拠区分

memo調査base＝#417固定HEAD `b39c861d3ec8f60298cad0d0525b1a92b9c53435`、先行PR base `d5334839e07224981ea21c9ecc51b7f14d28db83`。開始時GitHub値は一致。WebKit固定commit `343e13bf22dca9d0ec227801419aab0f9001a32f`。[共通契約v1](../u2-witness/common-observation-contract-v1.md)のblob `1a4b59272c13fb6b821a0c3853eed89e58a93967`を変更しない。

本書のS番号・path/関数/行範囲・blobの正本は[監査文書§8](c0-entry-writer-ownership-audit.md#8-固定ソース索引)。[入口22群・writer20群・所有権](c0-entry-writer-ownership-audit.md)と[今回26反例](c0-safe-capture-static-negatives.md)を同時に読む。既存26反例や先行研究の代替ではない。[事実]は直接コード、[推論]は明示前提つき、[設計]は未実装、[未確認]は証拠未取得を指す。

C0＝通常dedicated Workerの外側[WorkerRunLoop.cpp `run()` L244/245間](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerRunLoop.cpp#L215-L246)。Eは最後の最外実行区間/exit service復帰、Fは当該VMでの禁止＋入口coverage、Tは生存Client txの正確なenum、Iは同一incarnation、Wは指定W1前、Sは解決→取得→解放の非再入/寿命を要求する。単なるisEntered=false、停止要求、T1、後段cleanup観測は代用でない。

## 2. 方式比較

|方式|観測できる事実|必要条件・実装|非再入/所有/因果/摂動|成立しない具体例・未監査|判定|
|---|---|---|---|---|---|
|A C0で既存APIを直接読む|scopeのscript()、controller.vm()、VM.isEntered()/executionForbidden()、txの公開predicate。生存とthreadが既知なら個別値|C0に既存hookはない。正確な5状態getterと完全JS/native joinはない。script非null・実tx解決が必要|predicateの組合せはCommitting/Abortingを区別不可。globalScopeWrapper()はlazy init。isTerminatingExecution()はlock。API名だけで副作用なしとしない|CAP-N01/02/13/16/22。isActive=false,isFinished=false,isFinishedOrFinishing=trueの曖昧性、vmIfExistsのscript参照|**FAIL（現行APIだけで正確なE/F/T/I/W/Sを取得する方式として）**。E/Fの個別getterの存在は肯定|
|B 生成時identity登録＋弱locator|将来、作成時のJS返却native objectとWorker/VM/tx世代を結ぶlocator。C0で生存候補を解決|新規台帳・生成/失効/破棄記録、type/generationチェック、同thread解決。既存weak ActiveDOMObject集合は完全台帳ではない|WeakPtr.getはraw。既存ownerのborrow保証か一時Refを選び、取得中保護と解放の副作用を示す必要。数値pointer/resourceだけではI不可|CAP-N09–14/18/23。失効後raw使用、generation切替、proxy交替、map take。全登録点・失効点・全writer不明|**UNKNOWN／未実装**。weakを採用しただけで安全にはならない|
|C origin thread上の限定native packet|将来、解決済みの同じ生存対象のplain E/F/TとIDを直線区間でコピーする局所snapshot|新規の正確enum取得とpacket記録手段が必要。登録/解決は読取り区間前に完了。Fを新設して成立させない|下記P1–P8が全て立つなら局所cutの条件付き推論。解放・lock destructor・GC/他thread writerも含める。backend結果のcutは独立|CAP-N03/04/07/08/15/19/20/21。前後の同値でABAを排除不可。全entry/writer閉包と計測摂動は未証明|**UNKNOWN／検証対象の設計仮説**。採用・実装承認はしない|
|D 別境界|最外scope tearDown復帰、runCleanupTasks entry、prepare前、W2/W3など各自の局所事実|境界と命題を事前固定し別研究として比較。cleanup前と後を混同しない|最外scope終了はF/全入口/同時Tを保証しない。drain entryはW1前に位置しても間のCleanupTaskは別。W2/W3はtx消失し得る|CAP-N04–06/13/24。whenIdle callbackはexit service全体の復帰でない。後段から古いTを延長不可|**PARTIAL（位置比較）／採用候補未決定**。W2/W3は元C0命題の代替にはNOT_APPLICABLE|

方式AのFAILは、追加native実装の論理的不可能性を意味しない。B/Cは新規計測の設計案で、既存製品に実装された機能ではない。今回の許可は静的資料作成のみで、API/accessor/hook/locator/schema/lockの追加はしない。

## 3. 方式Cを単一cutと呼ぶための必要条件

|条件|反証可能な証拠要求|不足時の扱い|
|---|---|---|
|P1 対象固定|dedicated外側run、Worker/context/thread incarnation、script非null、VM生成世代と所有。既存run引数の保護が区間を覆う|別Worker/別realm/再利用pointerの結合拒否。S02/S03/S48/S55|
|P2 EとFの意味|最後の最外exit service復帰→task復帰→C0を同producerのcall/source順で結ぶ。既設定Fとその全入口への効力を示す|非enteredの単点、flagのみではJ2 UNKNOWN。idle/module F=falseはその候補の条件不成立。S06–S11|
|P3 生存T|作成時JS/native返却join、完全IDと世代、origin-thread解決、既存ownerがborrow区間を覆う証明。または一時Refの安全性/摂動評価|破棄済み・未結合ならUNKNOWN。作成前で対象がないと確定した場合のみNOT_APPLICABLE。S31–S42|
|P4 全writer排他|E/F/T/関連map/所有のwriter集合を対象buildで閉じる。owner thread以外のwriter有無と必要同期を説明|同thread/ThreadSafeRefCounted/オブジェクト用別lockを根拠にPASS不可|
|P5 直線読取り|callback、getter/toString、JS変換、確保、lazy init、checkpoint、pump、任意destructorを挟まない具体的call graph。参照解放まで含む|前後E/F/T一致だけではABA排除不可。Fがtrueでもnative writer/寿命は別。S16/S26/S32|
|P6 Wと継続禁止|過去W1/stop/別cleanupの有無、C0→当該drain→指定prepareを同世代で記録。C0からW1までの全入口も監査|appendAndKillは当該stop系列だけを支持。別CleanupTaskのJS再入可能性は全producer監査までUNKNOWN。S01/S02/S43|
|P7 recorder/因果|packetは同cutのコピーで、外部保存に対象ID/producerEpoch/sourceSeq/call/send/ackがある。drop/overflow/末尾seal/producer lossを保持|packet生成は保存完了でない。source時計/配列/到着順によるedge禁止。観測未実装なのでUNKNOWN|
|P8 摂動・解放|weak作成/Ref昇格/Ref解放/記録確保/lock取得と解放/GCが元の競合を変える範囲を明記。backendを止めるlockやC0同期flushを用いない|参照延命・追加lockで安定させた観測を元競合と等価にしない。S26/S41/S47、共通A26|

[推論] P1/P3/P4/P5で同一対象の生存と全writer非実行が区間全体に成立すれば、区間内のE/F/Tが不変で、コピー中の任意点を局所共通cutとできる。ただしP2/P6の実行停止・将来再入禁止、P7/P8、build対応を同時に立証しない限りJ2にはならない。現時点では前件を満たした記録/実装はない。

### 取得前後にAPI lockを足す案が未成立である理由

[事実] [JSLock.cpp `lock()` L88–114](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/JSLock.cpp#L88-L114)は同threadならlockCountを増やして再帰取得を許す。[`willReleaseLock()` L297–328](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/JSLock.cpp#L297-L328)はlock drop depth等の条件でdrainMicrotasksし、delayed released objectsを解放する。

[事実] ここで呼ぶ`VM::drainMicrotasks()`はS66 VM.cpp L1435–1464の**VM default queue**を対象とする。一方、通常WorkerはS04 controller L661–666→S34 context L383–397で別のWebCore EventLoop queueをglobalに設定する。txのdeactivateはS32 L107–109→S13 EventLoop L592–599でそのWebCore checkpoint taskに登録され、S12 L88–103で実行される。**pending WebCore checkpoint taskがあるだけでは、JSLock解放→T変更という直接edgeはない。** 独立レビューP2-01により初稿のこの推論を撤回した。

[推論] lockは同thread再入禁止ではなく、default queueの条件付きdrainやdelayed releaseという副作用は残る。ただし、具体的な対象Tへの影響はcaller/queue/deref経路を結ぶまでUNKNOWN（CAP-N21）。observerがWebCore EventLoop checkpointを**明示的に呼ぶ**別入力なら、F=false、非再帰、group有効、対応task残存等の条件下でdeactivate/autoCommitを起こし得る（CAP-N26）。この入力をlock解放だけの効果に読み替えない。**どちらも実observerで発生済みという報告ではない。**

[事実] weak候補走査に使う`ScriptExecutionContext::forEachActiveDOMObject()`のScriptDisallowedScopeは、[ScriptDisallowedScope.h L37–57](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/dom/ScriptDisallowedScope.h#L37-L57)では非main threadで何も設定しない。Worker上の再入禁止をこのscopeから導く方式B/Cの仮定はFAIL。ただし走査内のActiveDOMObject追加禁止と一時Refによる局所生存は別に評価し、この事実から実JS再入が起きたとは断定しない（CAP-N25）。

## 4. 境界Dの限定比較

|候補|得られる順序|根本的な不足|
|---|---|---|
|最外VMEntryScope destructorの復帰後|当該entryのexit services復帰|次のentry、F、同一txとのsnapshotなし。`entryScope=null`代入直後やwhenIdle通知より後でも、全体J2の証明でない|
|C0と同位置のdrain呼出し前|当該shutdown taskより前という局所位置|本研究のC0そのもの。idle/module F=falseを救済しない|
|runCleanupTasks entry|通常run終了後、個々のcleanup task前|drainが既に始まった境界。C0との同等性を自動仮定しない。過去cleanupと任意task再入も残る|
|shutdown task内prepare直前|当該prepareとの同thread順|先行CleanupTask/観測位置の変更がある。元のC0への遡及不可|
|W2/W3|破棄/退出の別命題|Tの生存取得が失われ得る。古いsnapshotを現在値にできず、cleanup前C0の代替として不適用|

## 5. 14軸の独立判定

PASSは対象命題への肯定的証拠がある場合のみ。PARTIALは監査できた局所部分、UNKNOWNは全体証拠不足、FAILは指定方式/条件の必要条件不成立に限定する。実行しないことはNOT_RUNで、UNKNOWN/FAILと別軸。

|軸|判定|根拠・未解決|
|---|---|---|
|ENTRY_COVERAGE|PARTIAL／全体UNKNOWN|22群のgate/scope/thread/前後を監査。全JIT/IDL/cleanup producer/port閉包なし|
|WRITER_COVERAGE|PARTIAL／全体UNKNOWN|20 field群、m_state局所直接writerは特定。全build/外部writer排除なし|
|OWNERSHIP_SAFETY|PARTIAL／capture全体UNKNOWN|既存run保護とRef chainは確認。weak解決→解放/実wrapper join未成立|
|OBJECT_LIFETIME|PARTIAL／対象tx at C0 UNKNOWN|通常run中scopeの既存保護。script/controller/tx存在は別条件|
|SAME_VM_IDENTITY|UNKNOWN|scope→controller→VMは静的に追えるが実generation/対象build記録なし。ShadowRealmとpointer再利用を排除不可|
|SAME_TRANSACTION_IDENTITY|UNKNOWN|resource伝搬はあるがJS/native/connection/backend process incarnationの実joinなし|
|NON_REENTRANT_CAPTURE|UNKNOWN|具体的observer call graphと全writer閉包なし。callback/lock解放/Ref解放を未証明|
|E_F_SNAPSHOT|UNKNOWN|個別getterはあるが同一cut未証明。idle/moduleの無条件成立案はFAIL、flag-before-unwindも反例|
|TRANSACTION_ENUM_CAPTURE|方式A FAIL／B,C UNKNOWN|private 5状態を公開predicateで区別できない。新規安全getter/packetは未実装|
|C0_BEFORE_W1|PARTIAL|当該stopのC0→drain→shutdown prepareは静的call/queue順で支持。過去W1なし・同incarnation実因果はUNKNOWN|
|BUILD_BINDING|UNKNOWN|固定上流と配布rev2336のbinary/patch/config対応を取得していない|
|RECORDER_COMPLETENESS|UNKNOWN|実producer/checkpoint/末尾seal/loss記録なし。記録処理/CI/実験はNOT_RUN|
|MEASUREMENT_PERTURBATION|UNKNOWN|Ref/weak登録/lock/確保/解放が競合へ与える影響未証明。実測は禁止のまま|
|J2_FEASIBILITY|PARTIAL（反証条件具体化）／実証UNKNOWN|無条件C0=Aは否定。B/Cの条件付き見込みは前件未成立で採用できない。C0の全面的不可能性も未証明|

## 6. 結論と次の最小工程

**選択B。** 理由は、正確Tの既存API不足、無条件E/F成立の反例、全entry/writer閉包欠如、weak解決から解放までの所有/非再入未証明である。「設計できそう」を根拠にAとしない。固定ソースだけでは実build/cut/recorderを判定できない点はCに相当する制約として併記するが、今回の設計課題の選択はB。

1. 対象build/port/feature/IDL生成物・JIT/LLInt/Wasm入口とsetter参照の有限な母集団を固定し、未監査のENT-09/12/13/15–21のcaller/callee閉包を作る。局所gate不在を迂回の証明にしない。
2. T/locatorについて「生成時登録→失効→origin-thread解決→既存owner下のborrow→primitive copy→解放」の具体的call graphを静的に一案だけ書く。新たなRefを選ぶ場合は自然寿命との差と最終deref経路を添える。製品実装はまだしない。
3. 全writerがその区間に入れない根拠、過去cleanupなし、C0→W1間の全CleanupTask producerを監査する。条件を満たせなければ当該案をFAILとして破棄する。
4. 独立レビュワーが26反例に加え別反例を使って反証する。P1/P2があればHOLD、局所修正しても固定修正HEADの再レビューまで閉鎖しない。

backendPendingは本書のE/F/T取得成功と独立。P2の真正C3出自・完全identity・明示C3≺C0・無矛盾ならFAIL、Client C1/C2保存のみならUNKNOWNを維持する。recorder/陰性証明不足からPASSにしない。

`J2=UNKNOWN / U-C=UNKNOWN / conditionU=NOT_RUN / realExperiment=NOT_RUN / executionAuthorization=NOT_GRANTED / startCondition=BLOCKED / productionWorker=HOLD`。CI NOT_RUN。実ブラウザ/Worker/IDB/1ms・hook/custom build・lock/同期flush実測・実メモ・OAuth/MCP/Tunnel操作なし。先行PR/契約変更、Draft解除、マージなし。
