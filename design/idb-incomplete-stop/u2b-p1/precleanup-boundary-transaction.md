# P1追補：cleanup前の同一VM停止候補とClient transaction状態の結合

**総合PARTIAL。候補点の具体化のみ。J2実証UNKNOWN、P1開始BLOCKED、研究文書マージ推奨NO。**
2026-11-05 JST（調査開始時のGitHub読取は2026-11-04 UTC）。実験・native hook・カスタムbuildはNOT_RUN。

## 0. 固定対象、積み上げ、保全

- 対象：[Issue #411](https://github.com/tetsujisugimori-coder/memo/issues/411)。[PR #415追補レビュー](https://github.com/tetsujisugimori-coder/memo/pull/415#pullrequestreview-5774076246)の「外側runのcleanup直前」と同一tx結合を掘り下げる。
- 開始時GitHub main：`438cf201abe83a53e8cb8e7ed160c4d6dbe147ba`、tree `9109b893ce208155c2d7a12e1ab55ecc810ab06d`。下表の4 PRはすべてOpen/Draft/未マージ。#415は前回指定HEADと一致し、追加commitなし。レビュー本文とIssueコメントも確認した。

|PR|HEAD|base branch / 開始時base SHA|
|---|---|---|
|[#408](https://github.com/tetsujisugimori-coder/memo/pull/408)|`eda663732d1eb98fc4a207eb2698f11a7f373e31`|`investigate/idb-time-delay-only` / `a72e0657d07632926d2ace9bcd7836cfbc41ac13`|
|[#410](https://github.com/tetsujisugimori-coder/memo/pull/410)|`5ea6f42db5ff122259261a5f0f3d25f6d63ba990`|`design/idb-u2-witness-static-20261103` / `eda663732d1eb98fc4a207eb2698f11a7f373e31`|
|[#413](https://github.com/tetsujisugimori-coder/memo/pull/413)|`0edd1dd5f467f2dfb4a1b4f3df072048be23a97e`|`design/idb-u2a-common-observation-contract` / `5ea6f42db5ff122259261a5f0f3d25f6d63ba990`|
|[#415](https://github.com/tetsujisugimori-coder/memo/pull/415)|`d5334839e07224981ea21c9ecc51b7f14d28db83`|`research/u2b-p1-j2-static-20261104` / `0edd1dd5f467f2dfb4a1b4f3df072048be23a97e`|

今回のbaseは#415のbranch `research/u2b-p1-jsc-cut-20261104`、固定HEAD `d5334839e07224981ea21c9ecc51b7f14d28db83`（tree `164de0f745c9ca79c5ac88ad4ddecf07505f46d3`）。mainはこのHEADの祖先（33 commits差）。mainへ直接出すと未統合の契約・先行研究を今回の差分に含めるため、#408→#410→#413→#415→本研究という積み上げにする。先行PRのHEAD/base/reviewは変更しない。base branchが後日動けばレビュー時にこの固定SHAとの差を再確認する。

[AGENTS.md](https://github.com/tetsujisugimori-coder/memo/blob/d5334839e07224981ea21c9ecc51b7f14d28db83/AGENTS.md)を確認し、編集前に追加2ファイルと理由を提示した。ユーザーが指定したMarkdown成果の追加だけを行う。製品関数の変更なし。checkout内に追加AGENTS.md／`.agents/skills`／SKILL.mdはなかった。既存ローカル候補ディレクトリはgit checkoutと確認できなかったため、その状態・全worktree一覧を確認済みとはしない。既存ディレクトリへ書込み・checkout・stash・cleanを行わず、作業領域内の新規cloneを使用した。新規cloneは本研究branchの1 worktree、開始時clean。

最優先の[共通観測契約v1](https://github.com/tetsujisugimori-coder/memo/blob/5ea6f42db5ff122259261a5f0f3d25f6d63ba990/design/idb-incomplete-stop/u2-witness/common-observation-contract-v1.md)（blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`）と[静的受入A01–A28](https://github.com/tetsujisugimori-coder/memo/blob/5ea6f42db5ff122259261a5f0f3d25f6d63ba990/design/idb-incomplete-stop/u2-witness/common-observation-acceptance-v1.md)、既存R/Uを変更しない。以下のC0/E/F等は本書の説明用記号であり、新schema・新契約ではない。

固定一次ソースはWebKit **`343e13bf22dca9d0ec227801419aab0f9001a32f`のみ**。リンクのL番号はこの版のソース行。配布Playwright WebKit rev2336のbinary/patch/configとの一致は未立証。**[事実]＝固定ソースの直接記述、[推論]＝明示した前提つきの静的帰結、[設計]＝未実装の観測案、[未確認]＝実行時・未監査の事項**と区別する。

## 1. 第一候補C0とW1の厳密な位置

**C0：[WorkerRunLoop.cpp L244とL245の間](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerRunLoop.cpp#L215-L246)**。`WorkerDedicatedRunLoop::run()`の外側do/whileが`MessageQueueTerminated`で終わり、`runCleanupTasks(context)`を呼ぶ直前。既存hookや既存ackはない。L363以降のdrain内部、L404のCleanupTask実行内、`prepareForDestruction()`直前はC0ではない。

|主張|根拠・区分|限界|
|---|---|---|
|外側runは初期評価後に呼ばれる|[事実] `WorkerOrWorkletThread.cpp:176–184`は初期評価→`runEventLoop()`、同:106–110は保護されたglobal scopeをrunへ渡す|評価前停止を、既にtxが作られた停止と混ぜない|
|killを返したrunInModeは通常taskを呼ばず戻る|[事実] `WorkerRunLoop.cpp:309–325,336–360`。CFの後段timerもTerminated時は処理しない|同関数のGLib/Windows処理は待機より前。C0より前に何も実行しなかったという意味ではない|
|stopで予約するshutdown cleanup taskはC0の後|[事実] `WorkerOrWorkletThread.cpp:296–309`→`WorkerRunLoop.cpp:387–390`→`MessageQueue.h:101–107`は同一queue lock内でappend＋kill。`MessageQueue.h:139–162`はkilledならtaskを取り出さずTerminated。[推論] そのshutdown taskは通常runInModeで取り出されず、C0後のdrainから実行される|既に取り出されて実行中の別task・別原因の停止を排除する証拠ではない|
|C0は契約W1より前の候補|[推論] 通常dedicated外側runで、当該shutdown cleanup系列が初回W1なら、C0→drain entry→shutdown task→`prepareForDestruction()`という同一スレッド順。契約A04のprepare開始より前、さらにdrain entryより前|全lifecycleで「初めてのcleanup」だという無条件主張はしない。通常ループでも既存CleanupTaskは実行可能（同:402–406）。以前のW1や別cleanupがないことを対象incarnationの経路で確かめる必要がある|
|C0でVMがまだ生存し得る|[事実] `runEventLoop()`はscopeを保護。scopeはscript controllerを所有（`WorkerOrWorkletGlobalScope.cpp:46–51`）、controllerはRefPtr VMを所有（`.h:127`）。shutdown taskはprepare後に別CleanupTaskでclearScriptを予約（thread.cpp:303–306）|scope生存だけではscript非nullを保証しない。C0で`script()`を確認し、同じcontroller/VM世代へ結ぶ。`vmIfExists()`も同.cpp:95–98ではscriptを直接参照するので、名前だけでnull安全としない|

W1は共通契約のCLEANUP_ENTEREDのまま。今回のC0は**当該shutdown drainより前**という位置を固定する。過去にprepare/stopActiveDOMObjects済みなら「W1前」判定を拒否する。main runloopでは`stop()`自身がprepare/clearScriptを呼ぶ（thread.cpp:285–293）ためC0の系列は存在しない。他種Workerに同じrunloop実装が使われても今回の結論を一般化しない。

## 2. 最外退出Eと禁止Fを別々に読む

### 2.1 最外VM実行区間の終了

- [事実] [VMEntryScopeInlines.h:33–47](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VMEntryScopeInlines.h#L33-L47)：entryScope不在時だけ最外scopeを設定し、自身が登録されたscopeのdestructorだけがtearDownSlowへ進む。内側scope終了は最外scopeを消さない。
- [事実] [VMEntryScope.cpp:59–66](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VMEntryScope.cpp#L59-L66)：`entryScope=nullptr`の**後**でexit serviceを実行。[VM.h:284](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VM.h#L284)の`isEntered()`はこのポインタのbool値。
- [事実] [VM.cpp:960–968](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VM.cpp#L960-L968)：whenIdleはentryScopeなしなら同期callback、ありならPopListeners登録。[同:1772–1806](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VM.cpp#L1772-L1806)：deactivation/watchdog、PopListeners、termination requestクリア判定、scratch buffer掃除の順。
- [推論] `entryScope=nullptr`代入時やwhenIdle callbackの時点は、exit service全体の復帰後とは異なる。listenerが再入する可能性も別監査。**whenIdle通知を最終退出・永久停止のackにしない。** C0で対象VMの`!isEntered()`を再確認し、必要なら最後の最外exit service復帰→現在task復帰→外側runのC0というcall/source順を記録する設計がより限定的である。
- [未確認] このscope機構を使う入口集合の外にも実行がないこと、Wasm/native/port固有入口・他スレッド利用までの網羅は未立証。`!isEntered()`を任意buildの全CPU/JS/native frame不在の証明に拡張しない。

### 2.2 将来の再入禁止

- [事実] [controller.cpp:78–90,118–150](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletScriptController.cpp#L78-L150)：対象Worker VMにforbidExecutionOnTerminationを設定。forbidExecution/isExecutionForbiddenはcontext threadをassertしVM flagへ対応。scheduleは別lock下の要求flagとnotifyNeedTerminationであり、禁止flagの同時設定ではない。
- [事実] [VM.h:306–316,1329–1330](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VM.h#L306-L316)の2 flagは別。`executionForbidden`は初期false。[VM.cpp:1036–1048](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VM.cpp#L1036-L1048)はtermination exception設定時に禁止flagを立てるため、まだunwind中でもtrueになり得る。
- [事実] [VMTraps.h:63–103](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VMTraps.h#L63-L103)、[VMTraps.cpp:438–506,532–558](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VMTraps.cpp#L438-L506)：現在stack終了要求はVM永久停止ではなく、trapはdefer・次回entryまで持越し得る。新しいforbid呼出しを足して候補を成立させない。

### 2.3 C0の一つの観測境界として必要な条件（未実装）

[設計] 対象WorkerのC0で、**既に**設定されたFとE、および生存中の同一txを一つのnative packetへコピーする。別スレッドからplain flag/entryScopeを無同期に読まない。以下の全条件を事前に満たせない場合はUNKNOWN。

1. `WorkerDedicatedRunLoop`の外側run、同じcontext/Worker generation、現在のthreadが対象thread。`runInMode`/drainのthread assert（runloop.cpp:265,366）、scopeの`isContextThread()`（scope.cpp:133–135）とoriginThreadを結ぶ。ASSERTは設計の根拠であり、release実行で検査済みの証拠ではない。
2. contextに当該controllerとVMが生存し、そのVM世代の所有関係を維持する。pointer値単独をIDにしない。JS wrapperを初期化する`globalScopeWrapper()`（controller.h:73–76）は観測に呼ばない。
3. native primitiveの読み取りとして`!vm.isEntered()`と`vm.executionForbidden()`を取得。E/Fの片方だけ、異なるpacket/異なる時点からの寄せ集めは拒否。最後の最外退出witnessとの結合がないなら「C0時の非entered」という局所事実だけに限る。
4. 2読取りとtx読取りの間にcallback、runloop pump、await、JS変換、lazy init、microtask checkpoint、arbitrary destructor/GC/finalizerを挟まない。別スレッドがVMにentry可能でないこと・対象fieldを書き換えないことの所有権監査も必要。**同じthreadというだけでは再入や外部利用を排除できない。** VM API lockを新規取得して辻褄を合わせない。調査したforbid設定経路に解除はないが、全writer/全port網羅は未証明。
5. txの安全な解決・生存確認を先に行い、直線的なprimitive読取り区間に副作用を持ち込まない。所有・再入なしが成立すれば区間中のClient値は不変なので共通cutとして扱えるという条件付き推論。原子的な複数field snapshot APIが既にあるという主張ではない。末尾でE/Fを再読して一致してもABA再入の不在証明にはならない。
6. C0→最初のshutdown drain entryの間は固定ソースでは直接callだけ。観測処理自身が再入しないことが必要。drain entryをW1とする読みでも先行可能。ただし契約A04のprepare開始までにはdrain内の別CleanupTaskが先に走り得る。そこまでの再入禁止は§3の**全入口coverage**、過去W1なし、同世代連続記録を別に要求する。

**結論：同時状態を読む設計は条件付きで具体化できるが、現時点でJ2を肯定する実証済みcutはない。** C0の不在・E/F不一致・所有権不明ならUNKNOWN/BLOCKED。観測地点をcleanup内へ後退させて成功扱いにしない。

## 3. 入口監査の範囲

|経路|今回固定ソースで確認した範囲|退出／C0からW1までの禁止の評価|
|---|---|---|
|通常task|`WorkerRunLoop.cpp:402–418`：closing/script不在/termination要求なら通常taskを省略。termination exception後はforbid|主要dispatch gateの直接事実。CleanupTaskは別分岐で無条件実行。すべてのCleanupTask内容は未監査|
|event callback|`JSEventListener.cpp:133–139`はcontext禁止を検査。`WorkerOrWorkletGlobalScope.cpp:115–118`はscript不在またはcontroller禁止へ対応|該当event listener入口は確認。全native callbackの代表ではない|
|microtask|`MicrotaskQueueInlines.h:75–110`は禁止時clear、otherwise scopeを作ってdrain|入口でのgateを確認。進行中checkpointの終了はEが別に必要。すべてのdispatcher実装は未監査|
|classic初期評価|`controller.cpp:221–264`は入口禁止、復帰後termination検出でforbid|このevaluateの復帰は根拠。callback/module全部の復帰には流用しない|
|module loading/link|`controller.cpp:318–439,442–458,494–499`は一部入口の禁止とnested待機、link復帰後forbidを持つ|loadがkillでfalseを返す経路はforbidを必ず通るとは言えない|
|module resume / Wasm module|`controller.cpp:289–315`のevaluateModuleはmoduleRecord.evaluateを呼ぶ。Wasm分岐もある。この関数自体には禁止検査が見当たらない|呼出し元・下層の全gateは未監査。直接call経路を網羅した禁止とはしない|
|debugger|`WorkerDebugger.cpp:79–93`、thread.cpp:86–99、runloop.cpp:248–251でnested debugger待機がkillにより戻る。startup待機後ならthread.cpp:168–173でforbid|paused JSの外側scopeが残る場合、debugger待機終了自体はEではない。Inspector評価／console注入／JSC debugger全入口は未確認|
|JSC/native呼出し|`CallData.cpp:58–80`→`Interpreter.cpp:1235–1270`、`Completion.cpp:134–150`→同:995–1026、construct:1331–1366、module:1649–1669|VMEntryScopeを作る箇所を確認。ただしここで検査する`disallowVMEntryCount`は`executionForbidden`と別。flag一つをJSC全入口の一律拒否と誤認しない。下層trap/JIT/host戻り全体の監査なしに実際の迂回可能性も断定しない|
|Wasm/native再入・port task|Wasm→JS、JS→Wasm→host→JS、非同期compile/deferred work、GC/finalizer、GLib/CF/Windows native source、signalによる経路の全coverageは未取得|UNKNOWN。実行しなかったとの陰性証明なし|
|除外対象|WorkerMainRunLoop、main commonVM、Service/Shared Worker、worklet、別port/build|本研究の通常専用Workerの根拠を移植しない。別Workerの実行は同一incarnationのJ2対象ではない|

## 4. 停止経路ごとの条件と不成立

いずれも**静的経路分類**で、実行件数ではない。E/FがC0にあるかは観測未実施。Fを満たすためのコード追加・同期処理は禁止。

|停止状況|C0への道筋とE/Fの見込み（推論）|採用制限|
|---|---|---|
|通常callback実行中|terminationが実際に処理されF設定→最外scope/exit services復帰→task復帰→外側run kill→C0ならEとFの候補|trapをまだ処理しないまま戻る経路もある。Fを要求し、全入口・join・記録を別途満たすまではJ2 UNKNOWN|
|初期classic評価中|evaluateの復帰時にもtermination要求を見てforbid→runEventLoop→C0|停止要求がevaluate末尾の検査後ならidle経路になり得る。初期評価中というラベルだけでF確定不可|
|評価前・scope生成前|thread.cpp:160–165で既存terminatedを見ればschedule＋forbid、評価入口はreturn→外側run|対象txが存在しないならU/P1のtx結合はNOT_APPLICABLE。OOMによるscope作成失敗はC0自体なし|
|idle待機中|schedule＋queue kill→runInModeがTerminated→C0。VMTrapsが未処理ならFは初期falseのままでもよい|**E=trueに相当する非enteredでもF=falseが可能**。普通taskは要求flagで省けても今回の同時条件は未成立。新規forbidを挿して埋めない|
|同期resource読込み|`WorkerThreadableLoader.cpp:73–87`のnested runInModeはfalseで抜けcancel。外側JS/nativeの復帰・unwind後に外側runがC0へ|nested waitから戻った点はcleanup前cutではない。外側VMEntryScopeが残り得る。全native cancel再入は未監査|
|module graph待機|controller.cpp:433–439はrunInMode falseでload失敗。`WorkerThread.cpp:170–182`はsuccess時だけlinkを呼ぶ→初期評価復帰→外側run|停止がJS非実行のfetch待ちであればforbidを通らずF=falseが可能。module待機終了をJ2にしない|
|debugger startup待機|thread.cpp:168–173は待機終了後terminatedならforbid→評価→run|評価前ならtx不在。途中debugger task由来txは同一ID・実生存を独立確認。通常callback pauseとは分ける|
|debugger pause中|debugger.cpp:79–93→runInDebuggerMode復帰→paused外側処理復帰→外側run|内側待機終了で外側JSが消える保証はない。再開後にtrapを処理したか・F/Eは別|
|suspend/resume|thread.cpp:273–275でstopはresume。315–339のsemaphore待機はresume後scope.resume→task復帰→外側run|suspendはJ2ではなく、resumeが既存にある。F設定は必須とは言えず、suspension先行は正常性を別評価|
|Worker自身のclose|`WorkerGlobalScope.cpp:322–337`はclosingとCleanupTaskによる親への通知。後に親stop|close自体はF設定でも最外退出でもない。親stop到達と過去cleanup/先行abortを分ける|
|main runloop / 途中でcontroller喪失|外側dedicated C0と異なる／script null|本C0として拒否。後段W2/W3やnullをE/Fの代用にしない|

## 5. 同じtransactionをC0で読む範囲

### 5.1 5状態と現在値への到達

[事実] `IDBTransaction.h:249`にprivate `m_state`、[IndexedDB.h:33–41](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IndexedDB.h#L33-L41)に5状態。`isActive()`、`isFinished()`、`isFinishedOrFinishing()`だけではCommittingとAbortingを区別できない（tx.h:147–149,306–317）。C0から既存public getterだけで完全な5状態snapshotが得られるとは言えない。

[設計] 将来のnative観測では、対象の生存中の実txをorigin thread上で解決し、同一snapshot区間でm_stateの**正確なenum値**とID、`m_isStopped`、必要な異常情報を副作用なしで読む手段が必要。今回はaccessor/hookを追加しない。ThreadSafeRefCountedはm_stateの他thread読取り許可ではない。tx.cpp:93,118,1586–1588はorigin thread accessをassertする。

[事実] `IDBActiveDOMObject.h:35–58`はoriginThreadを作成時のThreadとして保持。`IDBConnectionProxy.cpp:399–410`はmain側でcommitting mapからtakeし、[IDBActiveDOMObjectInlines.h:34–47](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBActiveDOMObjectInlines.h#L34-L47)は対象origin threadで直接実行、そうでなければcontextへtaskをpostする。このlockはcontext参照のためでありm_state全体のreader lockではない。

[推論] 検査したClient遷移はorigin threadに配送されるため、C0でevent loopをpumpせず対象を安全に解決できれば同じスレッド上のClient状態を読める候補はある。backendやmainのproxy mapは並行して変化し得る。**mapをlockしてもC0のbackend cutにはならない。** 全writer・所有権の証明が未完成なら同時性UNKNOWN。

|C0のClient値|意味・限界|
|---|---|
|Active / Inactive|同一の生存中Client txのその時点の値に限る。request callbackのunwindやmicrotask checkpointでactivate/deactivate/autoCommitされる（tx.cpp:107–109,1445–1462）。以前のcallback内状態を延長しない。先行異常不在・backend未終端は別|
|Committing|Client T1候補に限る。tx.cpp:561–581は**didCommitが既に呼ばれても**未完了requestがあれば`m_commitResult`に結果を保存してreturn。backend完了だけでなくClient内に結果到着済みでもCommittingが残り得る|
|Aborting|正常未終端として受理しない。m_isStopped falseでも別原因abortはあり得る|
|Finished|Client T3のみ。成功commit・backend結果・complete配信・物理解放は自動確定しない|
|不在／破棄／ID未結合|そのcutのClient状態UNKNOWN。作成前停止で対象txがなかったと確定できる場合だけNOT_APPLICABLE。過去snapshotを補間・延長しない|

### 5.2 ID結合表と生存期間

以下は必要なjoin設計であり、既存Collectorに取得済みのfieldではない。**G2は全体としてUNKNOWN**。

|対象・必要ID|具体的な結合元（固定ソース）|生存・安全な解決／未成立点|
|---|---|---|
|JS完全identity|契約の`runId/dbName/workerId/connectionId/transactionId/iteration`|db名・アプリラベル・時刻だけでnative対象へ結ばない。対象JS objectとnative返却objectを結ぶ記録は未取得|
|Worker/context/thread incarnation|thread.cpp:106–110のrun引数とscope、scope.cpp:46–51,133–135の生成thread UID・controller所有。context identifierと作成/破棄を対応|thread UIDやcontext ID単体にプロセス再起動・再利用保証を仮定しない。process incarnation＋worker creation generationとjoin記録が必要|
|VM incarnation|scope→controller→RefPtr VM（controller.cpp:78–90,.h:127）、C0でscript非nullかつ当該VM|pointer再利用を拒否する作成generation、所有開始/clearScript/破棄の記録が必要。全寿命の証拠未取得|
|native Client tx / object generation|`IDBDatabase.cpp:213–222`がInfo生成→tx生成→同Info IDでmap→同txを返却。`IDBTransaction.cpp:84–89`がm_infoへコピー、tx.h:99がinfo getter|JS bindingの返却wrapperとこのobjectを結ぶ発生元記録が必要。生成されたbindingコード・実行のjoinは未監査。raw pointerは補助に限る|
|native tx resource ID|`shared/IDBTransactionInfo.cpp:42–50`→`IDBResourceIdentifier.cpp:37–60`。proxy serverConnectionIdentifierとclient resource number（atomicで2ずつ増分）の組。h:45はIDBConnectionIdentifierをProcessIdentifierのaliasとする|resource数だけ、またはnumeric process IDだけでは世代を識別しない。restart/wrap/reuseの独立generationを必要とする。既存IDをアプリtransactionIdと同一視しない|
|database connection / transport connection|database.cpp:67–75のresultData.databaseConnectionIdentifier＋context登録、database.h:91。proxy.h:121はserverConnectionIdentifier。proxy.cpp:363–371はdatabaseConnectionIdentifier＋transaction.infoをmainへ渡す|database connection IDとresource ID内のconnection IDは別型・別意味。省略・混同しない。client/server双方のprocess incarnation・IPC channel世代が必要|
|proxy→server tx|proxy.cpp:388–435で同resource IDをcommit/abort送信・返信検索に使う。connectionToServer.cpp:348–364,388–395がdelegateへ渡す。server/UniqueIDBDatabaseTransaction.cpp:41–60は受けたinfoを保持|静的ID伝搬の一部は具体化。実portのIPC serializer/send→receiveとserver connection生成全体は未結合。P2側の独立証拠が必要|

**C0の実オブジェクト解決案の限界**：databaseのactive/committing/aborting mapはprivate（database.h:137–139）で、終端で除去される（database.cpp:422–445）。proxy mapもpending/committing/abortingという運搬管理であり、結果処理の前にtakeされる（proxy.cpp:374–435）。map不在＝破棄でもFinishedでもない。map在籍＝状態値でもない。

別案としてcontextのActiveDOMObject集合は弱参照で、`forEachActiveDOMObject()`（context.cpp:327–341）はweak copy→生存対象への一時RefPtrという既存走査を持つ。これは名前照合よりよい**生存中の候補探索**だが、JS/native joinやm_stateアクセスを自動提供しない。走査はScriptDisallowedScopeとvector確保・Ref操作を伴うため、C0の2field読取り間に無条件に挟めない。現在のC0はこの走査を呼んでおらず、新しい観測による摂動の評価が必要。

[設計] 将来は生成時に結合したorigin-thread限定の弱locator＋object generationを使い、C0で生存対象を安全に解決する方式を検討する。先に強参照を持ち続けて自然破棄を防ぐ方法は元の寿命を変える。一時参照もreleaseによる副作用と摂動を別評価し、観測完了後W1までの境界を壊さない。解決不能ならUNKNOWN、過去値で穴埋めしない。既存の停止処理を追加して安定させない。

## 6. 因果関係：C0からW1とClient abort、backendとの切分け

通常dedicated stop由来の、同一incarnationについての**条件付き静的call chain**：

`最外scope/exit services復帰(E)` → `実行task復帰` → `外側runのTerminated復帰` → **`C0でE/F/生存tx現在値を記録`** → `runCleanupTasks entry` → `shutdown CleanupTask` → **`prepareForDestruction entry (W1/A04)`** → `stopActiveDOMObjects` → `IDBTransaction::stop`（または`IDBDatabase::stop`→同tx stop）→ 必要なら `abortInternal` → `Aborting` → abort operation予約。

- [事実] scope.cpp:63–80→context.cpp:456–471→tx.cpp:331–352、database.cpp:317–330、tx.cpp:227–273という呼出し。stopはm_isStoppedで二重停止を省き、Committing/Aborting/Finishedなら追加abortしない。ActiveDOMObjectの順序は不定（tx.cpp:336–337）。database先行でも同txへ結ぶ。**W1→全txのabort開始**という無条件edgeはない。
- [設計] EとC0にはVM generation、W1とstopにはcontext/Worker generation、stopとabortには同tx resource ID＋object generation、同producer epochのsourceSeqとparent call recordを付す。stopが既にm_isStoppedならその先行stop記録へ結ぶ。Fの設定記録も同VMから参照し、C0の値と混ぜない。関数の文字上の並びだけで実発生ログを作らない。
- [推論] 同thread上で実際にこのcall chainが記録されれば、**このcleanupが誘発するClient abort**よりC0が前だと言える。C0前の別原因abort（明示abort、request例外、server loss、suspension、以前のstop）は排除しない。tx.cpp:1465–1470などの別経路も異常coverageに含める。m_stateやm_isStoppedだけで過去の正常性を保証しない。
- [事実] [UniqueIDBDatabase.cpp:1211–1317](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabase.cpp#L1211-L1317)はmap take→backing store commit/abort→callback。suspensionによる既存abort結果を返す経路もある。server map状態は結果の代用にならない。
- [未確認] C0と別processのbackend commit/abortは、ID一致だけでは先後不明。source clock、異source配列、recorder到着順は禁止。backend結果がC0前と確定すればbackend pendingは不成立。C0後に結果通知が到着しただけではbackend処理がC0後だったとは言えない。

P1側で具体化できたのは「C0におけるE/F＋生存Client tx現在値」とcleanup由来Client停止の局所系列の**設計**まで。P2/U-C側では同native IDのSERVER_LOGICAL_IDB/BACKING_STORE結果、異常経路、C0を跨ぐ因果cutと完全性を独立に必要とする。Client CommittingだけならbackendPendingもU-CもUNKNOWN。これらが将来揃っても**既存Uに自動昇格しない**。

## 7. 記録完全性と観測による変化

|必要条件|足りない場合の扱い|
|---|---|
|build/port/hashと計測器版、process/producer/Worker/VM/txの生成・終端、sourceSeq、明示parent/send/receive IDを保存|同名・pointer・時計・到着順による補間禁止。資料矛盾はINCONSISTENT、欠測はINCOMPLETE。J2/U-C UNKNOWN|
|E/F/C0/W1/stop/abort各producerの経路coverageと、観測cutまで記録が届いた独立checkpoint|連番が連続でも記録対象外のterminalを否定できない。C0しかないpacketではE/W1の実観測まで主張しない|
|drop・overflow・producer再起動/喪失・error・未完packetを保存。切詰め検出、record count/hash、durable保存確認|producerが消えて末尾sealがないとき、最後のseqを完全な末尾とみなさない。未観測abort/commitを不発生にしない|
|producerごとのhigh-water/flush ackがどのcutまでを覆うかを因果IDで示す。backend producerにも独立な到達範囲|flush成功は観測coverageの証明ではない。process喪失でflush不能ならUNKNOWNを保持|
|計測処理の再入なし、割込み、確保/GC、Ref増減、追加IPC/lock/同期flushが競合に与える影響を記録|新lockでDBを止めてcutを作らない。C0で同期flushやjoin待ちをするとbackendが進み元の競合が変わり得る。非同期bufferでもdropと摂動は残る。非摂動性はUNKNOWN|

## 8. 今回新しく具体化できた点と実装前の最小残件

1. **C0の場所と先行範囲**：固定L244/245間。appendAndKillの同一lockとkilled優先returnから、stop由来の当該shutdown taskがC0後のdrainで実行される静的根拠を追加した。既存CleanupTaskすべてがC0後、という主張にはしない。
2. **whenIdleの早さ**：entryScope解除→PopListeners→termination request処理等という順を分離し、idle通知そのものを最終退出にしない。内側待機終了と外側C0も分離した。
3. **肯定しない具体的経路**：idle停止・module fetch待ち停止にはFを必ず設定する出口がなく、非enteredでも同時条件を満たさない可能性を具体化した。条件成立のためのforbid追加は行わない。
4. **Client snapshot取得の実装上の穴**：5状態はprivateで公開predicateでは識別不能。origin thread配送、弱いActiveDOMObject集合、database/proxy mapの寿命とtakeを区別し、C0に生存対象がなければ過去値を延長しない設計を明示した。
5. **Committing反例の強化**：tx.cpp:568–570でbackend結果がClientへ既着でもCommittingが続き得る。単なる通知遅延だけに限らないことを追加した。

次工程の実装前に必要な最小証拠は、(a)配布build一致、(b)対象dedicated Worker/VMの所有権・全入口/全writerとC0→W1の再入禁止監査、(c)副作用を追加せず現在txの正確なenumを安全に読める設計、(d)JS wrapper/native作成返却・process/connection/transaction世代の明示join、(e)E/F/C0/W1/Client stopを覆う同producer因果、(f)backendとの独立cut、(g)drop・末尾喪失・coverageと計測摂動の証拠。**現在はこれらを揃えた実装案の受入には至らない。追加静的レビューを要し、実験開始はBLOCKED。**

[静的負の対照](precleanup-static-negatives.md)は期待判定であって動的試験ではない。独立レビュー重点はC0≺W1の限定、idle/module経路、scopeなしと全実行不在の違い、弱locatorの寿命、同一packetの非再入条件、backendの独立性。独立レビュー結果は未取得。

## 9. 固定する判定と未実施

`overall=PARTIAL` / `J2=UNKNOWN` / `P1=BLOCKED` / `G1=PARTIAL(metadata), binaryBinding=UNKNOWN` / `G2/G3/G4=UNKNOWN` / `H1–H3=UNKNOWN, H4=PARTIAL` / `U-C=UNKNOWN, experiment=NOT_RUN` / `conditionU=NOT_RUN` / `realExperiment=NOT_RUN` / **`executionAuthorization=NOT_GRANTED` / `startCondition=BLOCKED` / `productionWorker=HOLD`**。

実ブラウザ・Worker・IndexedDB・1ms再実験・native hook・WebKitカスタムbuild・実メモ・OAuth・MCPサービス・Tunnel操作は実施していない。GitHubの文書読取・提出だけを行う。製品/judge/Collector/schema/runner/workflow/旧証拠/既存契約を変更しない。CIはNOT_RUN、マージ・Draft解除・実験開始なし。

## 10. 固定一次ソース索引（取得bytesからGit blobを再計算）

行範囲の正本は上記固定commit。下表の全pathは固定リンクであり、追従するmainは使用しない。上流ソースの写しは提出物に含めない。

|固定版path|Git blob|行数|
|---|---|---|
|[Source/JavaScriptCore/interpreter/Interpreter.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/interpreter/Interpreter.cpp)|eb822966926c557e919b69475a9622df5075f2ab|1805|
|[Source/JavaScriptCore/runtime/CallData.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/CallData.cpp)|ecec37eb025b0f7a5d64978972f511c53b156629|101|
|[Source/JavaScriptCore/runtime/Completion.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/Completion.cpp)|4f3fbe1e0b0e84549d6c3cf36f7619f8e5a0b9ca|371|
|[Source/JavaScriptCore/runtime/MicrotaskQueueInlines.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/MicrotaskQueueInlines.h)|f7537435d0904713818ceaad891dadc4e823b17a|114|
|[Source/JavaScriptCore/runtime/VM.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VM.cpp)|18fbdc29a5fee4e0a9439fdba55f88f08596a6f2|2085|
|[Source/JavaScriptCore/runtime/VM.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VM.h)|1c0666dab39a69ba12695bfecd73ebfdfe81e391|1423|
|[Source/JavaScriptCore/runtime/VMEntryScope.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VMEntryScope.cpp)|8f7382d7055f78187d77d1c8700c5f40c12dbf59|69|
|[Source/JavaScriptCore/runtime/VMEntryScope.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VMEntryScope.h)|7ebf0d684e69bef51a73015a66f49221f7b3f056|54|
|[Source/JavaScriptCore/runtime/VMEntryScopeInlines.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VMEntryScopeInlines.h)|67956911972b3ff9cb6a85df030fa1e725106c30|49|
|[Source/JavaScriptCore/runtime/VMTraps.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VMTraps.cpp)|38bb3a0203dd539edb3fa5d8f949b2c1a6d760ce|576|
|[Source/JavaScriptCore/runtime/VMTraps.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VMTraps.h)|a97a515c1c644df2e8fac1f4e44e4b9c20e30c60|360|
|[Source/WebCore/bindings/js/JSEventListener.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/bindings/js/JSEventListener.cpp)|0edad36db23e27569e6f7ad4c2890dcd1ab0f2c2|314|
|[Source/WebCore/bindings/js/JSExecState.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/bindings/js/JSExecState.cpp)|2391c8f253f9c423b0304d40ae36b5e7a04903d3|68|
|[Source/WebCore/bindings/js/JSExecState.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/bindings/js/JSExecState.h)|87e29a7f7f5937a2a9b0f988c7a0eab01ab25ffa|218|
|[Source/WebCore/bindings/js/JSIDBTransactionCustom.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/bindings/js/JSIDBTransactionCustom.cpp)|fbd85950e05e82a1a76b1d7c39e22adef03a63b9|43|
|[Source/WebCore/dom/ActiveDOMObject.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/dom/ActiveDOMObject.cpp)|3646ed3b12293033fc333ca24902184ab19a2dbd|210|
|[Source/WebCore/dom/ScriptExecutionContext.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/dom/ScriptExecutionContext.cpp)|f9c2bcc2286fd53862b9c23e2e8a97e62984a0ad|1105|
|[Source/WebCore/dom/ScriptExecutionContext.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/dom/ScriptExecutionContext.h)|54a91a88ebe70f3cd718774559e9505d096f74f2|489|
|[Source/WebCore/dom/ScriptExecutionContextInlines.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/dom/ScriptExecutionContextInlines.h)|5caf9a14a3a22397c18f874efd888442118a90b3|112|
|[Source/WebCore/inspector/WorkerDebugger.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/inspector/WorkerDebugger.cpp)|712ac2f56eab3f3f192c91d150ee36c25ea0092b|102|
|[Source/WebCore/loader/WorkerThreadableLoader.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/loader/WorkerThreadableLoader.cpp)|fbaf3c034ee568df346f867fce293bcd37395970|311|
|[Source/WebCore/Modules/indexeddb/client/IDBConnectionProxy.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/client/IDBConnectionProxy.cpp)|e6033c8d9e19e63790e66dac2586f6c62da3fa00|701|
|[Source/WebCore/Modules/indexeddb/client/IDBConnectionProxy.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/client/IDBConnectionProxy.h)|72dd47934736d9eb545df2723a350108aa50229b|195|
|[Source/WebCore/Modules/indexeddb/client/IDBConnectionToServer.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/client/IDBConnectionToServer.cpp)|ff8937a8ec8ff396ecc1fa5a5333ccd1f01b298d|536|
|[Source/WebCore/Modules/indexeddb/IDBActiveDOMObject.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBActiveDOMObject.h)|418c80b25c1e1add4ff172aa4df30b9daad992f0|61|
|[Source/WebCore/Modules/indexeddb/IDBActiveDOMObjectInlines.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBActiveDOMObjectInlines.h)|8d3b81756c856710ad82fe0cc665f548718d9293|63|
|[Source/WebCore/Modules/indexeddb/IDBDatabase.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBDatabase.cpp)|07a389ee5fab42c3d3b70ae468e3b9186860019f|508|
|[Source/WebCore/Modules/indexeddb/IDBDatabase.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBDatabase.h)|d15fdcb8a50d63cf7eaac1b9679bfeb94fa5e6ae|147|
|[Source/WebCore/Modules/indexeddb/IDBTransaction.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.cpp)|c242991f3914b844643b228b11a4d24c84ff0a4d|1592|
|[Source/WebCore/Modules/indexeddb/IDBTransaction.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.h)|6783ba3dff28229405a674cd993f178ab3e5b1e2|322|
|[Source/WebCore/Modules/indexeddb/IndexedDB.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IndexedDB.h)|a24ed6da035bc5e746553d48122c3b2062193c87|107|
|[Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabase.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabase.cpp)|d9f96867ddc51df3acfc42a97ebbcfb2866de2eb|1665|
|[Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabaseTransaction.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabaseTransaction.cpp)|f0a7e795031983ce7a52b081664895acc896db1d|649|
|[Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabaseTransaction.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabaseTransaction.h)|8254574aefb5652ada54332c7cf85db228b1210c|124|
|[Source/WebCore/Modules/indexeddb/shared/IDBResourceIdentifier.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/shared/IDBResourceIdentifier.cpp)|2e697e2a7fc40486de818de1a7dbe602e7bc7dac|86|
|[Source/WebCore/Modules/indexeddb/shared/IDBResourceIdentifier.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/shared/IDBResourceIdentifier.h)|2de0bc2dcc28cc9ce9bdf17336a534a96bdd5179|124|
|[Source/WebCore/Modules/indexeddb/shared/IDBTransactionInfo.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/shared/IDBTransactionInfo.cpp)|a95ae35b02789a962a35bbfda287c0ab801c1c62|123|
|[Source/WebCore/Modules/indexeddb/shared/IDBTransactionInfo.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/shared/IDBTransactionInfo.h)|ec44dc77b9ec8a62f1de928906710434cf8ed389|97|
|[Source/WebCore/workers/WorkerGlobalScope.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerGlobalScope.cpp)|bd5b5caed529d419002c9a8ebdd28efa1e060455|777|
|[Source/WebCore/workers/WorkerOrWorkletGlobalScope.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletGlobalScope.cpp)|34fca722076b507b774617280a52f0df524d1c85|170|
|[Source/WebCore/workers/WorkerOrWorkletGlobalScope.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletGlobalScope.h)|c3cb811cf09870318d9abfd1bbf6c46285898a4d|133|
|[Source/WebCore/workers/WorkerOrWorkletScriptController.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletScriptController.cpp)|f6b85c26ad85301ed3446e11ee0ed57354a7fa70|704|
|[Source/WebCore/workers/WorkerOrWorkletScriptController.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletScriptController.h)|5520518c093550d9cda64fecea10f9667496c56c|135|
|[Source/WebCore/workers/WorkerOrWorkletThread.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletThread.cpp)|e59b7654e98fce97b0f2cdc3a4263af2aaad3723|363|
|[Source/WebCore/workers/WorkerOrWorkletThread.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletThread.h)|85ed458f2263e3005dcc59a1d84d6343fd515143|118|
|[Source/WebCore/workers/WorkerRunLoop.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerRunLoop.cpp)|d26e82a341fbe39fa9b0c425d0277bb9ded8ea0f|480|
|[Source/WebCore/workers/WorkerRunLoop.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerRunLoop.h)|babe8f93db3e7b2ed050cc9f2d3edfec9b2507ab|161|
|[Source/WebCore/workers/WorkerThread.cpp](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerThread.cpp)|e05499958dc2350a283e36df865746bbe0e0caf2|207|
|[Source/WTF/wtf/MessageQueue.h](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WTF/wtf/MessageQueue.h)|1854f9856e0dee9c5de8df14d148b8a398f21bc4|248|

## 11. 今回の局所検査と再確認方法

新規Markdown2件について、C0-N01–N26の26行に欠番・重複なし、リンク75件（固定WebKitリンク63件）のpathと固定版行範囲、相対リンクの実在を確認。共通契約v1 blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`と契約ディレクトリ無差分を照合。`git diff --cached --check`は終了0、staged差分はこの2件の追加だけ。これはローカルの文書整合検査であり、WebKit・J2・IDBの動的試験成功ではない。提出HEAD・tree・GitHub読戻し結果はDraft PR本文の提出記録を参照する。

再確認では、まずPR #415の固定HEADをbaseとして`git diff --name-status d5334839e07224981ea21c9ecc51b7f14d28db83...<提出HEAD>`と`git diff --check`を確認する。共通契約は`git rev-parse <提出HEAD>:design/idb-incomplete-stop/u2-witness/common-observation-contract-v1.md`でblobを照合する。固定上流raw bytesは索引のGit blob（`blob <byte数> NUL <bytes>`のSHA-1）に一致するか確認し、C0・exit service・idle/module停止・tx結果保留分岐を該当行で再読する。実験やrunnerを実行する手順ではない。
