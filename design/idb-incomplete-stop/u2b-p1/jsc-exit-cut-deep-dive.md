# P1 第2段階：JSC実行終了・再開禁止とcleanup前cutの静的検証

**対象：Issue #411 / PR #413 HEAD `0edd1dd5f467f2dfb4a1b4f3df072048be23a97e` / 共通契約 #410 blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`。** 固定上流WebKit `343e13bf22dca9d0ec227801419aab0f9001a32f`。この文書は実験0、J2実証UNKNOWN、P1開始BLOCKEDの静的研究である。配布Playwright WebKit rev2336のバイナリ一致はUNKNOWN。

## 研究命題の再定義（親契約の緩和なし）
J2 = 対象Workerの**実行中だったJS frameが終了したこと**と**同じVM/Worker incarnationでの将来のJS再入が禁止されていること**を、両方肯定的に証明できるcut。J1 termination requestやVM内のフラグ単独、W1 cleanup開始、W2 context破棄はJ2の代用にならない。P1はさらにJ2が**IDB abortを誘発するW1 cleanupより前**であるという確定因果edgeを要する。

## 固定ソースのJSC経路と証明能力
|識別|固定上流ソースの直接事実|許容する評価／未解決|
|---|---|---|
|JSC-1|[WorkerOrWorkletScriptController.h L82–93](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletScriptController.h#L82-L93)、blob `5520518c093550d9cda64fecea10f9667496c56c`：終了要求は非同期。現在実行中のJS終了後には再入防止の追加処理が要るとコメント|J1からJ2への即時昇格不可|
|JSC-2|[VMTraps.h L63–101](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VMTraps.h#L63-L101)、blob `a97a515c1c644df2e8fac1f4e44e4b9c20e30c60`：NeedTerminationはcurrent JS stackの終了を要求するがVM全体の永久終了ではない。終了例外が未発火なら次のVM entryまで持ち越し得る|trap bitだけでは現在frameのunwind・永久禁止を確定しない|
|JSC-3|[VMTraps.cpp L438–505](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VMTraps.cpp#L438-L505)、blob `38bb3a0203dd539edb3fa5d8f949b2c1a6d760ce`：trapがdefer中なら処理先送り。NeedTermination処理時はtermination requestをセットして例外発生へ進む|trap処理の実行はJS frameのunwind完了とは別|
|JSC-4|[VMTraps.cpp L532–560](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VMTraps.cpp#L532-L560)：defer中の例外一時退避と再throw／次回trap処理の分岐|一回のtermination trap呼出しだけではcutを証明しない|
|JSC-5|[VM.h L306–316](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VM.h#L306-L316)、blob `1c0666dab39a69ba12695bfecd73ebfdfe81e391`：`executionForbidden`はVM flag、`forbidExecutionOnTermination()`は終了例外から復旧しない設定|再入禁止の候補だがフラグ単独では現在JS frameの終了済みを証明しない|
|JSC-6|[WorkerOrWorkletScriptController.cpp L78–90](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletScriptController.cpp#L78-L90)、blob `f6b85c26ad85301ed3446e11ee0ed57354a7fa70`：Worker対象で`ensureTerminationException()`・`forbidExecutionOnTermination()`を構成する経路|該当target VMへの設定の候補はある。対象dedicated Worker／buildに対する実装保証UNKNOWN|
|JSC-7|[VM.cpp L1036–1048](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/JavaScriptCore/runtime/VM.cpp#L1036-L1048)、blob `18fbdc29a5fee4e0a9439fdba55f88f08596a6f2`：termination exception設定時、`m_executionForbiddenOnTermination`なら即`setExecutionForbidden()`|**フラグの設定とstackの実unwind完了は別**。ここ単独でJ2は成立しない|
|JSC-8|[WorkerOrWorkletScriptController.cpp L221–264](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletScriptController.cpp#L221-L264)：script evaluate後にterminationまたはisTerminatingExecutionなら`forbidExecution()`、entry前は`isExecutionForbidden()`検査|**top-level evaluateの出口**の候補。IDBイベントcallback・module・debuggerを全てカバーした証明ではない|
|W1|[WorkerOrWorkletThread.cpp L258–312](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletThread.cpp#L258-L312)：`scheduleExecutionTermination()`と`postTaskAndTerminate()`（cleanup予約）は別呼出し|実行中frameを解消する経路とW1の前後が全ケースで一致するかUNKNOWN|
|W1-IDB|[WorkerOrWorkletGlobalScope.cpp L63–80](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/workers/WorkerOrWorkletGlobalScope.cpp#L63-L80)：`stopActiveDOMObjects()`経由でIDB stop/abortを進める|cleanup時のClient Active/Inactive→Aborting。J2がこれより前の実証が要る|

## 最も重要な独立反例（ソース上の可能性）
1. **例外の到達前**：NeedTerminationを通知したがtrapがdefer中、または現在のVM stackが先に退出したため次回VM entryで例外を投げる。J1のみでJ2とは言えない。
2. **flag-before-unwind**：`VM::throwTerminationException()`はexecutionForbiddenをセットし得るが、現在JS frameはまだunwind中。再入禁止フラグがtrueでもJ2の「実行済みframeが全部終了した」という半分が欠ける。
3. **entrypointの違い**：classic top-level evaluateのreturnを観測できても、既存のWorkerイベントcallback全体で同じJ2点が使われるとは自動的に言えない。module/debugger/wasmと停止時suspend経路は未監査。
4. **startup / worker main runloop**：script生成前に`forbidExecution()`されても対象transactionが存在しなければUの対象外。main runloop special pathをdedicated Workerの一般経路に混ぜない。

## 静的判定
**JSC terminationの状態遷移候補は追加で特定（PARTIAL）したが、J2の肯定的な実行終了点とJ2≺W1の確定edgeは依然UNKNOWN。P1実験開始BLOCKED。** この研究は固定上流ソースだけを扱い、配布実行バイナリ・WebKit/Worker/IndexedDB実測・JSC native instrumentation・物理thread終了を検証していない。

## 次工程の最小受入条件（実装前）
- current JS frameが解消済みであることをnativeに検証できる入口／出口と、同じVM incarnationの再入禁止を同時に立証する設計が必要。
- J2点、W1点、同一transactionのstop/abort intent点の間を、明示edgeとprocess/worker/tx identityで結ぶ。sourceMs差・到着順・二重ログの自己引用は不可。
- JSC/Workerの**対象版すべてのentrypoint coverage**と、recorder drop/overflow/producer loss/flushの独立証拠が未成立ならUNKNOWN。実装のためにlockを増やして元競合を変えてはならない。
- これがソース上可能と確認できる前に試験実行・カスタムビルドを許可しない。

**固定状態**：G1 PARTIAL、G2/G3/G4 UNKNOWN、J2 UNKNOWN、P1 BLOCKED、H1-H3 UNKNOWN/H4 PARTIAL、条件U/実験NOT_RUN、NOT_GRANTED/BLOCKED/HOLD、マージ推奨NO。2026-11-04 JST。
