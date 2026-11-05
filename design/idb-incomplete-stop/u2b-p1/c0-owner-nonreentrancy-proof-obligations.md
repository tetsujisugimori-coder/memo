# C0単一borrow-copy：所有区間・非再入の証明条件

**OWNER_INTERVAL=UNKNOWN / NON_REENTRANCY=UNKNOWN / 安全captureは未成立。**
Issue [#422](https://github.com/tetsujisugimori-coder/memo/issues/422)。[#421単一案](c0-borrow-copy-closure.md)をそのまま継承する。新規strong Ref、lock、同期flush、別境界への乗換えで不足を補わない。関数/hook/台帳/accessorは実装しない。

## 単一案の区間と証明対象

生成 → JS/native完全identity登録 → 論理失効/世代失効 → origin-thread weak解決 → borrow開始 → E/F/T/ID copy → 最終raw利用 → borrow終了 → record/locator解放、という**設計上の順序**を使う。REG/INV/COPYは未実装。論理失効はmap離脱・Finished・destructionを別理由で記録し、失効後のlocatorは再利用しない。実際の最終deref/destructionの時点はこの設計順に仮定せず、証明すべき対象である。

区間は「weakからrawを得て初めて利用する時点」より遅く開始してはならない。最後のfield readだけでなく、ID比較、log組立て、callback capture、scope guard/destructor等による最後の対象利用までを含む。borrow終了後の対象再利用は不可。weak解決・owner照合が生存性を必要とする場合はそれ以前から既存保護を要求し、確認処理自体で安全性を循環論証しない。

同一世代の対象xと区間[b,u]について、各既存ownerの保持区間を列挙し、その和が[b,u]の全点を覆うこと、所有移譲で無所有の隙間がないこと、利用がそのownerの生存期間内に因果的に置かれることを要求する。単一ownerで覆う必要はない。参照が「どこかにある」一点、map在籍、refCount一点の読取りはこの証明ではない。thread-safe refcountはplain fieldの同期を保証しない。

## 固定ソースのowner候補と局所保証

以下はWebKit `343e13bf22dca9d0ec227801419aab0f9001a32f`の直接事実。S番号は[既存索引](c0-entry-writer-ownership-audit.md#8-固定ソース索引)。型/開始/終了の局所事実はCONFIRMED、C0借用区間との結合は全行UNKNOWN。全ownerを列挙済みという意味ではない。

|対象owner・型|所有開始・移譲|終了・destructor/final derefとthread|borrowへの限界|
|---|---|---|---|
|run引数保護 / scopeのRef|S02 L106–110、protect(globalScope())をrun callへ渡す。thread自身もm_globalScope RefPtrを持つ|protect temporaryはrun call復帰まで。scopeの別owner/破棄はS02 destroy系で別に追う|C0がそのcall内ならscopeの局所保持を支持。script非null、VM/tx生存を自動証明しない。main runloopへ一般化しない|
|scopeのunique_ptr controller、controllerのRefPtr VM|S03/S04。scope constructorでscript作成、controller ctorでVMをmove。txとは独立|clearScriptでcontroller破棄。controller destructorはJSLock、wrapper clear、m_vm=null。最後のVM参照かは別|scope生存だけではcontroller保持区間を閉じない。全clearScript caller、同VMの他thread/realmを監査要|
|factory/returnのRef<IDBTransaction>|S33 L213–222→S32 create/ctor。txはconst Ref<IDBDatabase>、databaseはconst Ref<proxy>|返却Refのmove/破棄はcaller、JS wrapper/GCの保持は生成binding依存。tx destructor S32 L115–118とそのmember破棄を追う必要|native factoryと実JS返却joinがない。tx→databaseの向きをdatabase→tx保持と取り違えない|
|database tx maps / HashMap<ID, Ref<tx>>、versionchange RefPtr|S56 L136–140、S33 transaction/didStart。willCommitはactive.take→local RefPtr→committing.set。willAbortはactive/committing.take→aborting.set|S33 L422–445 terminalでversionchange=null、3 map remove。origin規律のASSERTあり。RefPtr/Refのderefは他owner残存なら最終解放でない|map移動中もlocal RefPtrで保持する局所chain。どのmapがC0で対象を覆うか、全remove callerとcallback排他は未証明|
|proxy tx maps / HashMap<ID, Ref<tx>>|S57 L182–184、S36 establish/commit/abortでset。didStart/Commit/Abortがlock下take→local RefPtr|local RefPtrはlockを抜けた後もperformCallbackOnOriginThread呼出し中保持し、scope終了でderef。forgetTransaction.removeも別出口|map lockはmap保護で、C0のplain Tやbackendのlockではない。takeから最後の全owner解放を導けない|
|origin配送の既存task / callee RefPtr capture|S37 L34–47、同originは直接call。別threadはcontextがある場合post。ScriptExecutionContextInlines L53–58→CrossThreadTask L90–97でcallee RefPtr capture|直接callはlocal ownerのcall区間内。post taskのcaptureは所有するFunction/taskの破棄で解放。実行終了とcapture破棄を同義にしない。cancel/drop/contextなしも分ける|post成立≠配送≠C0まで残存。どのtaskがqueueに所有され、いつ破棄されるかの因果が必要|
|生成時checkpoint closure / protectedThis=Ref{*this}|[S32 L97–111](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.cpp#L97-L111)で通常tx生成時にclosureを作り登録へ渡す。S13 L592–599がWebCore queueへ格納する経路|group停止等で登録拒否ならargument/closure破棄。登録後もcheckpoint実行だけでなくqueue移動・clear・task/function破棄の保持終了を追う。native deactivateはorigin|この既存Refもowner候補。checkpoint未処理やclosure生成の一点だけではC0全区間の保持を証明しない。処理するとT writerにもなる|
|JS wrapper / pending activity / operation・request等|S31、S61 custom visitor、S32 operation/request/queueの参照が関連|GC native保持、request→tx、operation callback、timer/cancellationと最終derefの全chainは未閉包|上記map/localだけを全ownerとしない。custom visitorだけでwrapper全寿命を証明せず、未取得生成物を要求|
|WeakPtr locator / weak impl|S41 lazy初期化、revoke/destructionでweak失効。S42 get L130–142はraw返却|weak失効後もコピー済みraw自体はnull化しない。weak impl保持とtx保持は別|weak.getは強参照を獲得しない。普通WeakPtrとThreadSafeWeakPtrの昇格を混ぜない。台帳登録・世代失効は未設計|

移譲の一次根拠：[HashMap::take L566–576](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WTF/wtf/HashMap.h#L566-L576) → [HashTraits<Ref> L258–262](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WTF/wtf/HashTraits.h#L258-L262) → [RefPtr(Ref&&) L169–174](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WTF/wtf/RefPtr.h#L169-L174)。move/leakRefは所有移譲。source側Refの破棄を対象の最終解放としない。

OWNER_INTERVAL=PASSの候補に必要なのは、同じxの生成/登録から失効・weak解決・[b,u]・解放までを、具体的callerと対象buildの生成物に結んだ所有interval台帳。全release・cancel・exception/unwind・別thread経路のうち[b,u]へ入れるものを閉じ、各raw useと保持終了の先後を示す。owner証明だけでNON_REENTRANCYをPASSにしない。全owner最終解放かつ寿命終了≺raw利用が明示されたモデル入力なら、そのborrowの寿命要件FAIL。先後・owner所在不足はUNKNOWN。

## 非再入・writer閉包：証拠を要求する単位

監査区間は解決/owner確認を含むborrow開始から最終利用まで。記録・weak/guard破棄・既存ownerの最終deref等、区間後の副作用も別途摂動として監査する。前後E/F/T再読一致では途中のABA不在を証明しない。同一VMのF true→falseのwriterが見つかったとは主張しない。

|経路群・caller/writerの境界|既知の直接事実／排除に必要な証拠|現在|
|---|---|---|
|最外JS/native退出、VMEntryScope、exit listener|S06はentryScope=nullの**後**にexit services。全whenIdle/listener登録元・destructorまで復帰し、その後task→C0というcall chainが必要|解除の局所事実CONFIRMED、全E UNKNOWN|
|JS呼出し・IDL/native callback・property conversion|S16 invokeCallbackのproperty get/call、S20 request event→TransactionActivator。実observer全calleeにJS conversion/callback/lazy initがないことと、外部native callerの非介入を証明|全入口UNKNOWN。局所F gateなしだけで迂回成功としない|
|nested loop、timer、module、debugger/Inspector、native port callback|ENT-05/08–12/20/22、S01/S22/S23。observerがpumpしないこと、外側frame復帰、port/runloop callbackと停止の先後を追う|同threadの直呼び・nested loopは可能性として残る。実observerで発生済みではない|
|JSLock再帰・最終unlock|S26 L88–114は同thread再帰可、L273–328は最終unlockで条件付きdrain/遅延解放。lock保持は同thread再入禁止でない|再帰/分岐はCONFIRMED。全calleeの影響UNKNOWN。追加lockで救済しない|
|VM default microtask queue|S66 L1435–1464。delay/F/queue条件、finalizeSynchronousJSExecutionも監査。F=trueでclearしても破棄副作用を別評価|全対象Tへの因果UNKNOWN。WebCore checkpoint taskとの直接edgeを作らない|
|WebCore EventLoop checkpoint queue|controller L661–666→context L383–397の別queue。S32 ctor→S13 registration→S12 L69–103→deactivate/autoCommit|明示checkpoint＋F=false＋非再帰＋group有効/非suspend＋対象task残存等の前件でnative writerが動く静的推論。lock解放だけでは導けない|
|GC/finalizer/destructor/allocator|S50 registryはdeferred cleanup scheduling、S51 native callback、S26遅延解放。全alloc/free、weak/finalizer、task capture破棄とref/deref callee閉包が必要|GC即時の任意JS実行とは断定しない。全寿命/再入UNKNOWN|
|Worker CleanupTask・scope/controller破棄|S01 cleanup taskは通常task gateを通らない。S02 prepare→末尾clearScript、S48 close等。全producer/payload、過去W1、C0→W1間を区別|当該shutdownの順序だけCONDITIONAL。全cleanup/過去W1なしUNKNOWN|
|別thread writer・所有解放|WRT-01–20を起点にVM E/F、T m_state、owner maps、context/proxy/identityを対象buildの全writerへ展開。m_state等のorigin ASSERTとruntime保証は別|全translation unit/生成物/同期・実call規律未取得。refcountのatomic性や別field用lockで排除しない|
|JIT/LLInt/Wasm/ShadowRealm/Inspector等の低層入口|ENT-09/12–16/19/21、生成stub/assembly、direct/virtual/function pointer callerを含む。無効機能はB4/B5のresolved config・link manifestでのみ除外|対象build不明なので未監査経路を構成上除外したものは0。Fだけで全gate成立としない|

NON_REENTRANCY=PASSの候補には、B3–B7で閉じた母集団について、具体的observerの直線call graphと全entry/writer/callback/destructorの到達可能性を照合し、[b,u]中に到達しない根拠を各経路に割り当てる。native field writer不実行はJS禁止と別に要求する。未解決のindirect call、生成callback、別thread writerが1つでもあれば全体UNKNOWN。observer自体が未実装の今は全calleeの列挙もできず、有限な証明課題の定義にとどまる。仮に局所非再入が成立しても、C0後の全入口実行禁止FやJ2を自動証明しない。

## 既存反例との照合：今回の証拠で否定できる主張

新しい動的試験ID/成功件数は作らない。C0-N/CAP-N/BC-N/OWN-Cは既存の[静的反例](c0-borrow-static-negatives.md)を参照する。各入力は机上条件であり、実C0で成立を確認したものはない。固定ソースに直接ある分岐と、仮定した発生を分ける。

|既存対照|入力条件／固定一次根拠|否定される主張・期待判定|
|---|---|---|
|OWN-C06 / BC-N01/02|headless、WPE探索directoryとcheckout条件が不成立、汎用MiniBrowserが存在する仮定。pw_run L41→43→48|WPE探索設定→実WPE同定は不可。port/BUILD_BINDING UNKNOWN。実fallback使用は未確認|
|BC-N03/20|binary metadataはあるがgenerated bindingが別build又は未取得。S33 factoryだけではjoinできない|明示的digest/provenance不一致なら**その同一性主張FAIL**。未取得ならUNKNOWN。実不一致を検出したとはしない|
|OWN-C01/03 / BC-N05|proxy take→local RefPtrは固定S36で直接確認。C0保持終了点不明|map離脱→最終解放という推論を拒否。borrow全体UNKNOWN。移譲を生存FAILにも期間PASSにも使わない|
|OWN-C02/05 / BC-N06|全owner寿命終了≺raw利用を明示したモデル／最後の解放と利用の先後不明のモデル|前者の寿命要件だけFAIL、後者UNKNOWN。実UAF発生は未確認|
|C0-N15 / CAP-N07 / BC-N07|borrow中にcallback/property conversionが呼ばれる仮定、S16/S20|純粋な直線copyの主張を拒否。対象writer/再入が未結合なら全安全性UNKNOWN。明示的にJS再入を前提とするモデルならその非再入条件FAIL|
|CAP-N01/02 / BC-N10|idle又はmodule待機killでE候補、F=false。S02/S04/S44|無条件E/F成立の案はFAIL、実J2 UNKNOWN。E候補を全最外退出の実証とはしない|
|CAP-N21/26 / BC-N12/13|同thread最終unlock、又は明示WebCore checkpointを挟む別入力。S26/S66とS12/S13|default queue→WebCore Tの自動edgeはFAIL。明示checkpointは必要条件下のwriter候補、T不変を仮定不可。実発生は未確認|
|CAP-N24 / BC-N14|同threadのdestructor/GC/Ref解放がborrow内又は記録時に入る仮定。S26/S50/S51|同thread→無副作用という保証不可。具体的caller/writer未結合ならUNKNOWN、GC即JSという断定も不可|
|C0-N16 / CAP-N08 / BC-N08|E/Tが往復して再読値一致、S06/S20/S31/S32|同値再読でABAなしを証明する規則FAIL。F解除を捏造しない。実ABAは未観測|
|CAP-N10–12/23 / BC-N04/17|pointer/resource再利用、異VM/tx世代又はproxy交替を同一視する仮定。S39/S48|不正joinを拒否、I/backendPending UNKNOWN。別世代と明示された入力のsame-identity主張はFAIL|
|C0-N21 / CAP-N05 / BC-N15|C0より前に同対象prepare=W1開始が明示、又は単なる別CleanupTaskがある入力。S01/S02/S48|先行W1確定なら初回W1前条件FAIL。別cleanupだけならW1到達はUNKNOWN。実対象の過去履歴は未取得|
|CAP-N25|WorkerのScriptDisallowedScopeだけで再入禁止とする入力。S64 L40–57は非mainでreturn|この保証の仮定FAIL、全capture UNKNOWN。実再入したことの証明ではない|

## 次の最小工程と停止条件

1. [build計画](c0-build-identity-evidence-plan.md)の元builder/native保存証拠を照会する。取得不能なら実build UNKNOWNを保持し、source限定補題と明記する。
2. 同一buildの生成済みwrapper返却箇所から一つのtx生成を追い、generation登録/失効候補を全出口へ結ぶ。台帳APIが未設計ならjoin UNKNOWN。
3. 一つの既存owner連鎖を選んで全release/transfer/cancel callerと[b,u]の先後を証明する。他ownerを排除する必要はないが、選んだ保持chain自体を仮定で補わない。具体的observerがないうちは局所補題以上へ進めない。
4. その区間を起動し得る全entry/writer/destructorを対象build母集団で閉じる。未知入口が残ればUNKNOWN、必要条件を否定する明示経路が揃った場合のみ当該案/条件FAIL。別方式へ無断変更しない。

実行で不足を埋める工程は含まない。実browser/Worker/IndexedDB停止、1ms、native hook、custom build、追加lock/同期flush、製品変更は実施しない。研究文書品質がPASSでも実験・製品実装許可にはならない。

`J2=UNKNOWN / U-C=UNKNOWN / conditionU=NOT_RUN / realExperiment=NOT_RUN / executionAuthorization=NOT_GRANTED / startCondition=BLOCKED / productionWorker=HOLD`。

2026年11月5日 JST
