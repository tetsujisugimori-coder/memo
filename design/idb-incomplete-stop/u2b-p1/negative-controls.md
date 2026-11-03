# Stage U-2B P1：J2の偽PASS拒否・静的受入
**実行前に固定する机上反例。動的試験ではない。** 親契約blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`、対象上流`343e13bf22dca9d0ec227801419aab0f9001a32f`。
|ID|対象事象・対照|判定期待（静的）|誤昇格の禁止|
|---|---|---|---|
|P1-N01|mainで`terminate()`が返っただけ|J0観測候補、J2 UNKNOWN|実停止ack扱い|
|P1-N02|Inspector`workerTerminated`が通知された|停止要求系列、J2 UNKNOWN|thread終了とみなす|
|P1-N03|mutex後に`m_isTerminatingExecution=true`|J1、J2 UNKNOWN|flagのみで中断済み|
|P1-N04|VM`notifyNeedTermination()`を呼んだ|J1、J2 UNKNOWN|VM通知を全JS frame終了へ昇格|
|P1-N05|classic scriptの`evaluate()`で終了例外後`forbidExecution()`|当該入口では実行禁止候補。対象callbackのJ2 UNKNOWN|単一入口を全JS入口へ一般化|
|P1-N06|script起動前にrunloop終了を検出・実行禁止設定|対象IDB transactionがまだ未生成ならU観測の対象外|通常停止中の未終端証明|
|P1-N07|`postTaskAndTerminate`は呼ばれたがcleanup task未実行|W1 UNKNOWN、J2 UNKNOWN|queue登録をcleanup開始や実停止と扱う|
|P1-N08|W1 cleanupに入り`stopActiveDOMObjects()`でClientがAbortingへ|正常未終端候補を拒否、J2先行は不明|W1の後からJ2/W1間の正常性を捏造|
|P1-N09|runloop終了後`WorkerGlobalScope`が破棄された|W2候補、W3/J2の先後はUNKNOWN|context破棄＝cleanup前J2|
|P1-N10|`Thread::detach()`呼出しのログのみ|実thread exit W3 UNKNOWN|detach呼出しをthread退出確定とする|
|P1-N11|J2/W1の両ログが別sourceで、確定edgeなし|J2≺W1の順序UNKNOWN|sourceMs比較／到着順で順序決定|
|P1-N12|process incarnation再利用・producer連番欠落|ID結合拒否/INCOMPLETE、J2 UNKNOWN|数字一致で再結合|
|P1-N13|J2候補を収録したログのflush失敗|資料INCOMPLETE、J2 UNKNOWN|ログ未着を非発生と扱う|
|P1-N14|J2候補の導入で新DB lockを追加|元競合への一般化UNKNOWN|計測が作った静止区間を元仕様とみなす|
|P1-N15|J2候補がW1より前でもDBの正常状態と同一IDで結合できない|P1研究は未証明／U UNKNOWN|J2だけでU PASS|
|P1-N16|J2候補なし、しかしupgrade成功|J2 UNKNOWN、U UNKNOWN|後段結果から実停止を逆算|
## 判定契約
- `J2 VERIFIED`は**未実装の将来判定名**。この文書での期待値の検査ができても「J2実証」を意味しない。
- `P1=BLOCKED`を解消するには、正常な対象transactionがあるdedicated Workerで実JS終了と再開不能を裏付ける**実行時のネイティブ点**、その点からW1/IDB abortへ至る因果edge、対象版・ID/recorder完全性が必要。
- 順序・結果の対照に矛盾があれば`INCONSISTENT`、欠落なら`INCOMPLETE/UNKNOWN`。異sourceの時計、配列順、状態flagだけでは成功させない。
- 現段階では16行すべて**事前期待値の作成のみ**。自動判定器・実browser試験・WebKitビルド・Worker実験は0、`NOT_GRANTED/BLOCKED/HOLD`維持。
