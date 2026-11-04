# Stage U-2C P2：U-C研究用Client Committingとbackend結果の静的因果調査
**Issue #412／親共通観測契約 `IDS-U2A-OBS-v1`。U-Cは研究専用、既存Uのaliasではない。実験0／U-C実証UNKNOWN／マージ推奨NO。**
2026-11-04 JST。
## 0. 研究系譜とソース固定
- 親：Issue [#409](https://github.com/tetsujisugimori-coder/memo/issues/409)／[PR #410](https://github.com/tetsujisugimori-coder/memo/pull/410)固定HEAD `5ea6f42db5ff122259261a5f0f3d25f6d63ba990`、共通契約blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`。
- 固定上流：[WebKit `343e13bf22dca9d0ec227801419aab0f9001a32f`](https://github.com/WebKit/WebKit/tree/343e13bf22dca9d0ec227801419aab0f9001a32f)。これはPlaywright 1.62.1／Linux WebKit rev2336の**実行バイナリ／patch済みbuild**との一致を証明しない。G1 PARTIAL/実体UNKNOWN。
- 別研究P1/J2の成立・不成立をU-C判定へ転用しない。Committing専用研究であり、**U-C→既存U PASSは一切禁止**。
## 1. 固定上流の因果経路（確定できた制御フローと未観測点）
|段階|ソース範囲／固定Git blob|直接読める処理|この段階では証明不能なこと|
|---|---|---|---|
|C1 Client commit intent|`IDBTransaction.cpp:466-500`、blob `c242991f3914b844643b228b11a4d24c84ff0a4d`|`commitInternal()`が`Committing`へ遷移し`commitOnServer()`を発行する|backendが開始済み/まだ未完了|
|C2 client proxy送信|`IDBConnectionProxy.cpp:388-435`、blob `e6033c8d9e19e63790e66dac2586f6c62da3fa00`|同internal IDをcommitting mapへ、connection main threadへの呼出し、`didCommitTransaction`でorigin callback|IPC相手へ確実に配送されたこと、結果が成功したこと|
|C3 serverへの委譲|`IDBConnectionToServer.cpp:347-409`、blob `ff8937a8ec8ff396ecc1fa5a5333ccd1f01b298d`|delegateへの呼出しがあり、server invalidでは`serverConnectionLostError()`を応答する|「通知が来た」＝DB側の正常commit成功|
|C4 server txn callback|`UniqueIDBDatabaseTransaction.cpp:139-161`、blob `f0a7e795031983ce7a52b081664895acc896db1d`|`database->commitTransaction`へ依頼しcallback内で`connection->didCommitTransaction`へ送る候補|weak ref・connection消失時にも通知が必ず届くこと|
|C5 backing-store結果|`UniqueIDBDatabase.cpp:1211-1260`、blob `d9f96867ddc51df3acfc42a97ebbcfb2866de2eb`|invalid store/要求エラー・server errorの分岐、`m_inProgressTransactions.take`、`backingStore->commitTransaction()`、`callback(error)`の順|map不在＝正常commit終了、配布実行物で同じ経路|
|C6 response→origin callback|`IDBConnectionProxy.cpp:395-407`→`IDBTransaction.cpp:561-581`|server resultのクライアント到達を`didCommit(error)`で処理する（origin thread経由）|結果到達とClient Finishedが同時という推論|
|C7 **結果到達後のCommitting残留**|`IDBTransaction.cpp:561-581,1413-1434`|最後のrequest operationが未完了なら`didCommit`が`m_commitResult=error`で**return**し、後の`operationCompletedOnClient`で`didCommit`を再呼出しする|Client T1だけでbackend pendingを推論すること（反例成立）|
|C8 Finishedとイベント|`IDBTransaction.cpp:502-509,583-609`|`finishAbortOrCommit`はClient `Finished`へ遷移、正常時`fireOnComplete()`はイベントをenqueue、context stoppedならenqueueしない|Finished＝成功したserver commit／main complete受信|
|C9 異常遷移|`IDBTransaction.cpp:1465-1499`、`UniqueIDBDatabase.cpp:1262-1317,1533-1592`|server loss・abort・suspension・closeは独立経路を持つ|結果が無いことだけで正常なpendingとすること|
## 2. U-Cを成立と呼ぶための**未確認**の追加条件
研究用`ucAssessment`（実製品のJSON schema項目ではない）を概念上以下に分離する。
1. `clientCommittingAtCut`：同一Client Txが指定したJ2またはW2/W3 cutでCommittingだったこと。**状態snapshotをいつ採取したか**、Client txがW2時点で既に破棄されている可能性を考慮する。J2が未成立ならUNKNOWN。
2. `backendCommitResultAtCut`：同一native txのserver/backend結果イベントの正・負を、**結果を記録する全producerのcut到達・連番・flush・異常検知**を伴う証拠で結ぶ。結果未配送と結果未発生は別。
3. `backendPendingAtCut`：commitが同一IDでまだ未確定である**陽性の状態観測**、または完備した結果記録に基づく終端不存在の証明が必要。commit intentだけ・map在籍だけではUNKNOWN。
4. `abnormalBeforeCut`：server connection loss、abort intent/result、suspension、forced close等を独立確認。正常性を否定するものがあるなら正常pendingとして採用不可。記録coverage不明ならUNKNOWN。
5. `identityAndCausality`：JS `runId/dbName/workerId/connectionId/transactionId/iteration`からnative `processIncarnation/connection/resource`までの完全ID結合、call/ackまたはsend/receiveの明示因果edge。時計・配列順・collector到着順は禁止。
6. `buildAndRecorder`：G1実バイナリ、G2 join、G3 native cut、G4 recorder全producer high-water/flush/drop/overflow等が未成立なら**U-C研究の成立判定はUNKNOWN**。
## 3. 固定ソースから分かる実質的な反例
**反例 UC-COMMIT-REPLY-WAITING：** `IDBTransaction::commitInternal`がClient Committingへ移行→server/backing-storeは`commitTransaction`結果を返す→origin callback`didCommit(error)`が呼ばれても最後のrequestが未完了なら`m_commitResult`保存とreturn→Clientはまだ`Committing`。従って`Client Committing`を観測した時点で**backendが未結果と断定する判定器は偽PASS**になり得る。これはコードの分岐を組み合わせた静的反例で、WebKit rev2336実動作を再現した主張ではない。
**反例 UC-MAP-TAKE：** `UniqueIDBDatabase::commitTransaction`では`m_inProgressTransactions.take()`がbacking-store commit結果より先。map不在でもbackend処理は未完了の可能性がある。逆にmap在籍しているだけではbackend未着手／正常pendingは不明。
**反例 UC-ERROR-RETURNS：** proxy/forwarderでserver connection lost時に`didCommitTransaction`へerrorが戻り得る。result callbackやcomplete eventの欠落を正常pending扱いしない。
## 4. 研究の有限な結論
- Client → proxy → delegate → backend result → proxy → Client `didCommit`の関数・内部ID経路と、**Client T1がbackend結果以後に残るコード上の条件分岐**は確認した。
- **server/Workerでの実際の因果edgeは未計測**。Client Committingとbackend pendingが同一cutに共存することを証明できる方法は未成立。W2/W3後のClient objectの状態を直接読めるとは仮定しない。
- commit resultの全経路/異常/recordingの完全性は未知。G1配布バイナリ対応、G2 ID join、G3 cut、G4 recorderを独立に立証できなければU-CはUNKNOWN。既存UはNOT_RUNのまま。
- 次のP2独立レビューは「Client側Delayed didCommitを誤判定しない」「backend結果をcutへ結ぶ完備した証拠が必要」「U-C→U自動昇格禁止」の3項目を重点にし、資料の整合だけで実験を解禁しない。
## 5. 固定状態
`overall=PARTIAL`／`UC_RESEARCH=UNKNOWN`／`G1=PARTIAL`／`G2/G3/G4=UNKNOWN`／`H1-H3=UNKNOWN/H4=PARTIAL`／`conditionU=NOT_RUN`／`realExperiment=NOT_RUN`／`executionAuthorization=NOT_GRANTED`／`startCondition=BLOCKED`／`productionWorker=HOLD`。実ブラウザ・WebKit・Worker/IndexedDB起動0、native計測/ビルド0、製品/旧証拠変更0、マージ推奨NO。
