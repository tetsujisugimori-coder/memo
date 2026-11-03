# Stage U-2B P1：cleanup前のJ2実行停止確定点 静的経路調査
**Issue #411／固定WebKit一次ソース調査。実測0、J2実在証明UNKNOWN、P1開始BLOCKED、マージ推奨NO。**
2026-11-04 JST。
## 0. 境界・確定版
- 親観測契約：[Issue #409](https://github.com/tetsujisugimori-coder/memo/issues/409)／[PR #410](https://github.com/tetsujisugimori-coder/memo/pull/410)、固定HEAD `5ea6f42db5ff122259261a5f0f3d25f6d63ba990`、[契約原本](https://github.com/tetsujisugimori-coder/memo/blob/5ea6f42db5ff122259261a5f0f3d25f6d63ba990/design/idb-incomplete-stop/u2-witness/common-observation-contract-v1.md)、blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`。元のR/U、U-Cの意味・実行権限は不変更。
- 対象：[固定WebKit upstream](https://github.com/WebKit/WebKit/tree/343e13bf22dca9d0ec227801419aab0f9001a32f) `343e13bf22dca9d0ec227801419aab0f9001a32f`。Playwright 1.62.1のLinux WebKit rev2336の**実行バイナリと一致した証明ではない**。G1 PARTIAL/実体UNKNOWN。
- この文書の「確認」は固定ソースに見える制御フローだけ。「J2が存在する」「J2が実停止を示す」「J2→W1の因果順がある」という実行時のwitnessは未確認。
## 1. 固定コードで確認した経路（実ソースの関数／行／Git blob）
|段階|固定上流の場所・blob|実ソース上で直接確認したこと|認められない飛躍|
|---|---|---|---|
|公開停止→スレッドへ依頼|`Worker.cpp:174-182`、`WorkerMessagingProxy.cpp:475-488`|proxyは`workerThread->stop(nullptr)`を呼ぶ。Inspectorの`workerTerminated()`はこの呼出し系列上の通知|terminate返却／Inspector通知＝J2/W3|
|J1 termination schedule|`WorkerOrWorkletThread.cpp:258-312`、blob `e59b7654e98fce97b0f2cdc3a4263af2aaad3723`|stopは`scheduleExecutionTermination()`を呼び、dedicatedでは`postTaskAndTerminate`でcleanup taskを予約|停止要求＝実行が再開不能|
|J1内部|`WorkerOrWorkletScriptController.cpp:130-150`、blob `f6b85c26ad85301ed3446e11ee0ed57354a7fa70`|lockで`m_isTerminatingExecution=true`、必要ならVMへ`notifyNeedTermination()`|同期的なJS stack unwinding完了|
|J2候補：VM実行禁止|`WorkerOrWorkletScriptController.cpp:118-127,221-264`、同blob|同Worker context threadの`forbidExecution()`はVMの`setExecutionForbidden()`を呼ぶ。`evaluate()`等では終了例外/終了状態検査後に`forbidExecution()`|flagセット＝あらゆるコールスタックが終了し永遠に再開しない、とは未証明|
|起動前終了分岐|`WorkerOrWorkletThread.cpp:145-164`、同blob|runloop terminatedを確認してから`scheduleExecutionTermination`と`forbidExecution`を呼ぶコードがある|取引開始前のケースを「transaction未終端中に停止した」証拠に使うこと|
|実スレッドの通常進行|`WorkerOrWorkletThread.cpp:99-110,167-202`、同blob|初期evaluateの後にrunEventLoop、終了後にglobal scope破棄へ進む|runloopをkillした時点＝JS stack停止／W3|
|W1 cleanup|`WorkerOrWorkletThread.cpp:294-309`→`WorkerOrWorkletGlobalScope.cpp:63-80`、blob `34fca722076b507b774617280a52f0df524d1c85`|`prepareForDestruction()`が`stopActiveDOMObjects()`を呼ぶ|W1の前にJ2が必ず成立するという推論|
|transaction abort|`ScriptExecutionContext.cpp:456-471`、`IDBDatabase.cpp:317-330`→`IDBTransaction.cpp:331-352,227-273`、blob `c242991f3914b844643b228b11a4d24c84ff0a4d`|通常のActive/InactiveなIDB txはstop時に`abortInternal()`経路へ|cleanup後も正常未終端という推論|
|W2とW3|`WorkerOrWorkletThread.cpp:199-237`|scope破棄とthread cleanup／`detach()`は別手順|scope破棄/Thread::detach()呼出し＝実OS thread退出のack|
## 2. J2の成立を評価するための必要条件
- **定義**：同一Worker execution incarnationについて、現在実行中のJSが確実に終了し、同一incarnationで新規JSが再開できないことをnativeで観測したcut。**`setExecutionForbidden()`そのものも候補であって証明済みではない。**
- **同一性**：該当Worker/VMのprocessIncarnation・executionEpochと対象JS runId/workerId、Client txの完全identityを、発生元記録の独立IDで関連付けられること。
- **順序**：J2候補→W1の先後を、同一source保証または参照ID付きの因果edgeで確定すること。sourceMsやログの到着順は不可。cleanupがJ2先行より早い経路があれば、通常P1を成立としない。
- **entrypoint網羅性**：top-level classic script、module evaluate、イベントcallback、debugger task、起動前停止、suspension、script re-entryが同じJ2性質を守るかを未調査・UNKNOWNとして列挙。特定`evaluate()`だけの`forbidExecution()`で全経路の完了証明としない。
- **transaction状態**：ClientのActive/Inactiveとbackend未完了、実停止、J2/W1、abort intentの因果系列は別witness。J2だけの確認で元UをPASSにしない。
- **recording**：native recorderはsource別連番、process loss、overflow、cutに達したhigh-water、flushを独立証明。ログ不在＝イベント不発生としない。新規lockによる停止順操作は禁止。
## 3. 途中判断（静的）
|候補|静的評価|判断|
|---|---|---|
|`terminate()`戻り／Inspector通知|停止要求系列の証拠に限る|**J2として拒否**|
|`scheduleExecutionTermination()`／VM notify|J1は確認できる|**J2として拒否**|
|`forbidExecution()`／VM executionForbidden|JSC VM実行禁止設定の候補点は存在|**P1成立UNKNOWN**：対象実行の全終了、全entrypoint、W1との因果関係未証明|
|startup前の`forbidExecution()`|runloopが既にterminatedの特別経路|**U対象外**：対象transaction開始を示さない|
|runloop終了・context破棄|W1を経た後段cutがあり得る|**cleanup前J2の代用不可**|
**結論：固定ソースでJ2候補の場所は絞れたが、通常の対象IDB callbackに対して「J2確定がcleanup前」と保証するnative cutは未確立。P1は設計上BLOCKED、G3 UNKNOWN。** これは動的FAILでもWebKitバグ確定でもない。
## 4. 次の独立ソースレビューで閉鎖する最小課題
1. `WorkerOrWorkletScriptController`のVM executionForbidden/termination exceptionが、**実行中callback**と全JavaScript入口で成立するか、固定JSC/Workerソースを追って、単なる状態flagと実frameの終了を分離する。
2. 通常dedicated WorkerのJ2候補とcleanup W1の確定happens-beforeが存在するか、実行済みJS frame・runloop shutdownの仕様/ソース両方から反例を探す。
3. J2/W1/IDB abortの同一ID bindingとrecorder完全性を構築できるか。G1実バイナリ対応も独立ゲート。どれか不能ならP1をBLOCKEDに保ち、実験へ進めない。
4. 計測のために停止順序を変えるlockを提案しても、元の競合の証明として採用しない。
## 5. 実行・安全の固定
`overall=PARTIAL`／`P1=BLOCKED`／`J2=UNKNOWN`／`G1=PARTIAL`／`G2/G3/G4=UNKNOWN`／`H1-H3=UNKNOWN/H4=PARTIAL`／`conditionU=NOT_RUN`／`realExperiment=NOT_RUN`／`executionAuthorization=NOT_GRANTED`／`startCondition=BLOCKED`／`productionWorker=HOLD`。WebKit起動0、ブラウザ・Worker停止実験0、native hook/ビルド0、製品／旧証拠変更0、マージ推奨NO。
