# C0 borrow-copy方式：一案だけの静的call graphと閉包判定

**総合PARTIAL / PROPOSED_CAPTURING_SCHEME=UNKNOWN / 安全な単一snapshot未成立。**
2026-11-05 JST。Issue [#420](https://github.com/tetsujisugimori-coder/memo/issues/420)。参照：[有限プロファイル](c0-finite-build-profile.md)、[既存監査](c0-entry-writer-ownership-audit.md)、[反例](c0-borrow-static-negatives.md)。
ここでの「設計関数」は**呼出し順の仮の名称**であり、既存のWebKit APIや実行済みhookではない。

## 1. 選ぶ一案と却下する近道
**案B+C単一化**：生成時に完全identity+generationを登録したWeakPtr locatorを用い、C0で同一origin threadの既存ownerが当該txを区間全体で保持できると証明された場合だけ短時間borrowし、E/F/TとIDをprimitive copyする。borrowの間に新規Ref増加、GC、JS、callback、event-loop pump、sync flush、新規lockは入れない。観測後の最終解放まで含める。既存のpublic predicateはTの正確な5状態を返さないので、新規private enum読取り手段（未実装）が必須。

- 一時strong Ref方式への自動置換はしない。Refが増えれば解放時のdestructor/競合が変わるため、今回の案の証拠として採用できない。
- ActiveDOMObject集合のweak copyを登録台帳と同一視しない。`ScriptDisallowedScope`は非main threadでscript禁止を設定しない。
- E/Fが一致したpacketでも、同じWorker/VM/tx世代と**無再入・全writer排他**の証拠がなければ同時cutではない。

## 2. 生成から失効、解決までの具体的候補（未実装）
|段階|固定ソースの入口/owner|一案が要求する追加設計と必須証明|現在|
|---|---|---|---|
|REG: 生成|[IDBDatabase.cpp L213–222](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBDatabase.cpp#L213-L222)→[IDBTransaction.cpp L84–111](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.cpp#L84-L111)|JS bindingの実返却wrapperとnative Ref txの1対1 join。run/worker/VM/object/connection/resource/iteration/process各世代を登録。generated bindingのcall pathが必要|UNKNOWN（binding生成物未取得）|
|INV: 失効|[IDBDatabase.cpp L422–445](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBDatabase.cpp#L422-L445)、[IDBTransaction.cpp L502–509](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.cpp#L502-L509)、destructor等|generation ledgerがfinished・map移動・destruction・context破棄・proxy入替・process再起動を区別。invalidateをどこでatomicに記録するか要設計。map不在だけで破棄とはしない|UNKNOWN（全出口未閉包）|
|RESOLVE: C0|[WorkerRunLoop.cpp L215–246](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerRunLoop.cpp#L215-L246)、[WeakPtr.h L130–142](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WTF/wtf/WeakPtr.h#L130-L142)|固定dedicated context/origin thread、指定generationを照合。weak.getはrawでrefを増やさない。台帳getの実装・失効並行性・ownerの固定が必要|UNKNOWN|
|BORROW: 区間所有|[IDBDatabase.h L129–142](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBDatabase.h#L129-L142)、[IDBConnectionProxy.cpp L363–435](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/client/IDBConnectionProxy.cpp#L363-L435)|同一対象を保持する既存の**strong owner**の所在、ownerが外れないこと、originと他threadの書換え禁止、無再入を区間全体で証明。必要なmapがすでにtake済みなら借用不可としてUNKNOWN|UNKNOWN（strong ownerの存在条件未閉包）|
|COPY: E/F/T|[VM.h L284–316](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VM.h#L284-L316)、[IDBTransaction.h L246–317](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.h#L246-L317)|plain native primitiveと完全identityを一つの直線区間にcopy。Tのprivate enumは既存public predicateでは区別不能。getter/packetは新設未実装、Fの不足を追加設定して補ってはならない|現行APIのみではFAIL、新規案はUNKNOWN|
|RELEASE: 解放|[JSLock.cpp L273–328](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/JSLock.cpp#L273-L328)、[ScriptExecutionContext.cpp L327–341](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/dom/ScriptExecutionContext.cpp#L327-L341)|borrowだけなら増やした強Refはないが、台帳・weakのdestroy、最後の既存ownerのderef、観測器record保存の確保・GC・destructorを別監査。解放後まで証明範囲を宣言|UNKNOWN|

**注意：REG/INV/RESOLVE/COPYの設計経路は既存ソースで実装済みではない。** 現状は設計が必要な位置を示したもので、source上の引用は一部の既存owner/write経路に限る。これを完全call graphと称しない。

## 3. 同一cutの禁止区間と監査の単位
候補となる順序は `join-known → context+owner check → weak resolve → owner pin verified → [E,F,T,I primitive copies] → borrow end → observational record enqueue`。
直線区間は角括弧のみではなく、weak resolutionとowner確認を含むborrow開始から終了までを対象にする。C0直前にlocatorの型/世代/生存を検証したというだけでは区間中生存を保証しない。
- `VMEntryScope`最外退出はentryScope=nullになった瞬間ではなくexit service完了/最外task復帰まで追う。
- `executionForbidden`は要求flagとは別。idle/module失敗でF=falseのとき、この案のE/F要件は不成立。無条件成立は**FAIL**。
- C0で外側runから`runCleanupTasks`へ進む順序は、当該shutdown taskに限り支持。**過去W1と別CleanupTask producerを全列挙するまで全W条件UNKNOWN**。
- C0でtransactionの`m_state`を読む仮APIができても、C1/C2受信・保存を真正C3完了とみなさない。backend producer/cutは別の観測面。

## 4. call graph閉包チェックリスト（未取得の証拠）
|母集団|最少確認すべき関数・field・producer|閉包不足の理由|
|---|---|---|
|全生成/失効 caller|IDBDatabase::transaction、JS binding生成・返却、IDBTransaction::finishAbortOrCommit/destructor、database mapのset/take/remove、context stop/destruction、proxy replace|対象WPE生成済みbindingと全caller未取得。登録台帳自体未設計|
|全T writer|IDBTransaction::transitionedToFinishing/activate/deactivate/finishAbortOrCommit、abort/commit/connectionClosedFromServer、operationCompleted、microtask checkpoint、native completion callback|同thread起動でもcallback・checkpoint・destructor再入がない証拠がない|
|全E/F writer/entry|VMEntryScope setUp/tearDown、exit listener、forbidExecution、termination trap、JSC entry / JIT / LLInt / Wasm / ShadowRealm / Inspector|対象WPEのfeature・生成物・全低層入口未固定|
|全CleanupTask producer|WorkerRunLoop::runCleanupTasks/performTask、WorkerOrWorkletThread::stop、WorkerGlobalScope::close、database teardownその他生成・投稿箇所|固定ソースの局所探索のみで全producerとpayload閉包はない|
|全owner/destructor|scope script/VM RefPtr、database/proxy/tx Ref maps、weak impl、Ref/deref、JSLock willReleaseLock、GC/finalizer|新規観測器と生成物がなく、解放時の呼出し連鎖/摂動を証明できない|
|対象build翻訳単位|feature flags、platform headers、CMake/cache、generated IDL/IPC、Playwright patch適用順、実binary digests|対象をソースprofileまで絞ったが実build manifestなし|

**判定：上記のいずれも全体PASSとはしない。** 全体closure=UNKNOWN、方式の条件付き成立性UNKNOWN。現行public APIのみで完全E/F/T/I/W/Sを得る方式はFAIL。登録やenum用APIを追加した場合の静的安全性は未判定であり、否定反例と単なる資料不足を分ける。

## 5. 次に閉じられる最小単位
生成済みJSIDBTransaction bindingとtransaction factory/return箇所を**対象WPE buildのdigest付き生成成果物**で固定するまで、REGの完全joinはUNKNOWN。REGを仮定してBORROWをPASSにしない。次にorigin-threadのowner保持・writer禁止を同じcall graphで立証する。borrow失敗を許す案なら、その場合はUNKNOWN packetを発行し過去stateを補間しない。

**最終**：C0の一案は設計として記述可能だが、有限対象buildの完全固定、全caller/writer/destructor/CleanupTask producerの静的閉包は未成立。実験・実装着手を承認しない。J2=UNKNOWN / U-C=UNKNOWN / conditionU=NOT_RUN / realExperiment=NOT_RUN / NOT_GRANTED/BLOCKED/HOLD維持。