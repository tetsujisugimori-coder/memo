# 内部正常未終端証拠の取得可能性

**総合PARTIAL。B：現在の公開API＋共有marker方式では不足。A：内部計測候補は具体化できるが、証明手段としての成立はUNKNOWN。C：配布build・実停止境界の対応資料が不足。**
条件UはNOT_RUN、実行未承認・開始BLOCKED。本番Worker HOLD。
これは静的な経路確認であり、挙動の実測・安全性認定ではない。

下記参照はすべて [上流固定commit 343e13b…](https://github.com/WebKit/WebKit/tree/343e13bf22dca9d0ec227801419aab0f9001a32f)
の `inputs/wk-<file>.txt`。固定URLとhashは `inputs/source-index.json`、版対応の上限は
[version-map.md](version-map.md)。行は保存bytesの行番号。

## 確認した経路と推論の上限

|対象|ソースで直接確認した記述|導ける推論／導けないこと|
|---|---|---|
|アプリから内部ID|IDBTransactionInfo.cpp L42–50はclientTransactionでIDを作る。IDBResourceIdentifier.cpp L57–83はconnection identifier＋resource numberを保持・表示。IDBTransaction.cpp L84–111は同infoを保持しserver確立へ進む|内部対応IDの候補はある。アプリのplan/run/worker/connection/transaction/epoch/nonceとこの組の対応記録はない。IDL L36–58に内部ID公開属性はない|
|client/server ID|IDBConnectionProxy.cpp L388–435は同identifierでcommit/abort mapとorigin thread callbackを結ぶ。IDBConnectionToServer.cpp L347–409がdelegateへ渡す。IDBServer.cpp L83–97,186–198,400–410は同IDで内部transactionを検索する|論理IDの連続経路がある。アプリの任意txラベルとは同一視しない。WebKit transport/NetworkProcess/IPC・embedderの具体的経路全体は今回未監査|
|DB側処理|UniqueIDBDatabaseTransaction.cpp L84–155はabort/commitをdatabaseへ渡し、callbackで接続へ結果を返す。UniqueIDBDatabase.cpp L1211–1317はcommit時にinProgress mapからtakeしてbackingStoreへ、abort時もtakeして別処理。SQLiteIDBBackingStore.cpp L1083–1128はIDでtakeしてcommit/abort|map存在だけでは正常状態の証明でない。takeがbacking-store処理より前なので「map不在＝終端済み」も不可。正常開始・commit intent/result・abort intent/result・異常遷移を別記録する必要|
|readonly層|SQLiteIDBTransaction.cpp L56–95,130–158ではreadonly beginがSQLiteTransactionを作らず、commit/abortはresetして戻る|readonly内部IDB transactionとSQL transaction inProgressは異なる。SQLのinProgress=falseだけではU不成立とも成立とも言えない。候補witnessは論理IDB層・backing-store層を明記する|
|終端通知|UniqueIDBDatabaseConnection.cpp L146–178からdidCommit/didAbortを送り、proxyがorigin threadへ。IDBTransaction.cpp L548–609はcommit結果errorを区別しcomplete/abortをenqueue、context stoppedならenqueueしない|DB処理→応答→Worker callback→event配送は別。内部処理済みで通知未受信が可能という静的理由。complete未受信を正常未終端にできない|
|公開terminate|Worker.cpp L174–182→WorkerMessagingProxy.cpp L475–488。proxyはaskedToTerminateを立て、Inspector workerTerminatedを呼び、thread.stop(nullptr)|InspectorのworkerTerminatedはこの箇所では停止要求経路上の通知。実停止完了のackとして採用不可。terminate戻りも同様|
|停止とcleanup|WorkerOrWorkletThread.cpp L258–312はscript終了要求とcleanup taskを登録。WorkerRunLoop.cpp L363–389はqueue killとcleanup処理。WorkerOrWorkletGlobalScope.cpp L63–80→ScriptExecutionContext.cpp L456–471でActiveDOMObject停止へ|停止要求、JS実行中断、cleanup開始、context破棄、thread退出は別境界。WorkerOrWorkletThread.cpp L199–237のcontext破棄後callbackもDB側状態との同期を証明しない。実際のJSC中断命令点・OS thread停止とDB状態の共通観測点は未確立|
|停止時IDB|IDBDatabase.cpp L317–330は各active transaction.stop後close。IDBTransaction.cpp L331–352はlistener除去後、finished/finishing以外ならabortInternal。L1534–1561はautoCommitの状態・要求検査とscript禁止時の抑止|callback保持・HELD/CLAIMEDは内部abortを否定しない。停止cleanupによるabortを「停止前から正常未終端」と混同しない。close戻り・upgrade成功・cleanup成功から物理解放へ飛躍しない|
|その他異常|IDBTransaction.cpp L1465–1499はserver切断をabortへ。UniqueIDBDatabase.cpp L1294–1317はsuspension abort result、L1336–1362はclient close、L1533–1592はimmediate close/suspension経路。IDBServer.cpp L191–195は未登録IDならabort通知不能で戻る場合がある|abortイベント不在で異常なしと判断できない。server loss・破棄・記録欠落の区別も必要。全異常経路の網羅性は未証明|

## B：現在方式では不足

JSの要求追加受理はその呼出時点のAPI条件、request successは要求結果通知、callback保持と
共有markerはアプリ状態の候補にとどまる。DB側のcommit/abort/異常がmarkerに参加していない。
送信から受信、mainの停止要求から実停止までの競合区間を埋める独立証拠がない。
Worker内だけの計測は、queue破棄・listener除去・script中断・context破棄で最終記録やflushを失う。
「記録なし」は正常維持と異常・配送喪失を区別しない。旧F/Gの完了後停止はこの欠落を補わない。

#401のcomplete発生→send→main receiveはRの因果契約として維持する。
同じ証拠がR PASS/U FAILになり得る。異sourceの配列順・時計差を因果edgeにしない。
今回のチェッカーはイベントtraceを再判定せず、既存judgeを呼び出さない。

## A：内部計測候補と必要な最小変更（提案のみ）

|候補ID|必要な変更・対応ID・観測境界|未確認事項|
|---|---|---|
|ID-BIND|WebCore transaction生成でアプリ側plan/run/worker/connection/tx/epoch/nonceと内部connection/resource pairをネイティブ側で結ぶ。process incarnation・ID型・生成元も保存|公開APIで取得できる対応は今回見つからない。custom bindingか診断channelの設計が必要。resource number単独やDB名だけは不可|
|DB-LIFECYCLE|同IDで正常開始、各要求、commit/abort開始・結果、server切断、suspension、destructorをDB側の状態遷移として記録。map take前後とbacking-store resultを分ける|LOG(IndexedDB/IndexedDBOperations)等は候補。対象ビルドの有効化・出力完全性・全箇所ID付与・損失検出はUNKNOWN。既存ログだけで正常区間を証明したとは扱わない|
|STOP-BOUNDARY|停止要求IDとWorker context/thread IDを結び、実JS中断、cleanup開始、context破棄を別記録。Uが対象にする「実停止境界」を先に定義|thread退出はcleanup後になり得る。単一hookでは直前の正常状態を証明できない。DB状態が停止を挟む因果区間を、状態を変える同期なしで得られるかUNKNOWN|
|SURVIVING-RECORDER|Worker外のネイティブcollectorにsource別連番・ID参照・overflow/drop/process-loss・保存結果を持たせる。停止後も回収可能な有限bufferを設計|外部記録の到着順も発生順ではない。通知欠落、collector停止、未flushを正常状態に読み替えない。新しいIPC/共有traceの実装・検証が必要|

公開APIの追加だけで必要証拠を揃える経路は未確立。既存診断の有用性も未確認。
実際に進むなら **独自WebKitビルド＋ネイティブ内部計測の設計** が必要になる見込みであり、
上表のhook発見を証明手段成立としない。今回その変更、ビルド、起動は行わない。

計測はalloc/lock/IPC/I/Oで順序とタイミングを変える。提案段階では固定容量・イベント予算、
事前確保、同期flush/新しいblockを避ける設計、drop時UNKNOWNを要求する。ただしその設計でも
非摂動を保証できない。将来の計測あり記録を元T7の同じ条件へ一般化せず、別計画の対象とする。
因果edgeを作るためにDB処理をロックする案は対象状態自体を変えるので、今回Uの証明として採用しない。

## C：資料不足と有限終了

残る最小判断材料は、(1)2336実行実体のhashとbuild/patch/config対応、(2)対象portのIPCと
JSC中断境界の確認、(3)内部ID対応＋全異常/欠落を含むtrace設計が停止を挟む正常区間を
独立に保証できるかの設計レビュー。これらは未実施でUNKNOWN。別版で代用しない。

現在方式の不足を確定できたため、今回の静的調査はここで終了する。Uの実験に進む根拠はない。
内部計測の費用・摂動を許容できなければ、次の判断案は「停止・物理解放を検索再開の前提に
置く方式を続けるか、未解決処理を残したまま新規検索・認可の制御経路を分離するか」の比較。
#395の共有台帳・旧結果拒否・生成済み2枠非回収・安全停止は再実装しない。
代替方式の実装も今回行わない。
