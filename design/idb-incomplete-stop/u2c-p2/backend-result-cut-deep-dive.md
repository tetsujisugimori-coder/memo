# P2 第2段階：backend結果の発生元・停止境界cutとの因果関係の静的検証

**対象：Issue #412／PR #414固定HEAD `761d3d54611e65f0fd599c5c13eac458d41f1c9c`／共通契約v1 #410 blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`。** WebKit上流固定 `343e13bf22dca9d0ec227801419aab0f9001a32f`。U-Cは独立研究であり、既存Uには転用しない。実WebKit/Worker/IndexedDB実験0、配布rev2336の実体一致UNKNOWN。

## 問い
同一JS/native transaction、同一Worker incarnationに対して、**backing-storeが返すcommit結果の発生元**を区別し、事前に選んだstop cut（J2/W2/W3のうち一つ）までに**結果が確定した／未確定だった**ことを、独立した因果証拠で確認できるか。

## 固定コードで分かる発生元の違い
|経路ラベル（研究用、既存イベント名ではない）|固定ソース／Git blob|直接確認したこと|証明できないこと|
|---|---|---|---|
|C0 CLIENT_COMMIT_INTENT|[IDBTransaction.cpp L466–500](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.cpp#L466-L500)／`c242991f3914b844643b228b11a4d24c84ff0a4d`|ClientがCommittingへ移行し、proxyへcommitを投げる|backendがrequestを受理した、またはまだ未結果|
|C1 CONNECTION_FALLBACK_ERROR|[IDBConnectionToServer.cpp L353–377](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/client/IDBConnectionToServer.cpp#L353-L377)／`ff8937a8ec8ff396ecc1fa5a5333ccd1f01b298d`|server接続が無効なら`serverConnectionLostError`付きの`didCommitTransaction`を別経路で生成する|このerrorをbacking-storeのcommit結果と呼ぶこと|
|C2 SERVER_PRECONDITION_ERROR|[UniqueIDBDatabase.cpp L1211–1254](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabase.cpp#L1211-L1254)／`d9f96867ddc51df3acfc42a97ebbcfb2866de2eb`|space check、未処理失敗requestのabort、backing store closed、map entry欠落など、正常commit call前にerror/abortする分岐|Clientが`didCommit(error)`へ到達したことからbacking-store resultがあったと断定|
|C3 BACKING_STORE_COMMIT_RESULT|[UniqueIDBDatabase.cpp L1247–1259](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabase.cpp#L1247-L1259)→[SQLiteIDBBackingStore.cpp L1102–1128](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/SQLiteIDBBackingStore.cpp#L1102-L1128)／`45460fc38ea43f8c74e7b0831bc007c4b9cf6ef3`|map takeの後にbacking-store commitを呼び、そのresult/errorをcallbackへ渡す|map takeをcommit resultの確定点とみなすこと。SQL readonlyと論理IDBを同一視すること|
|C4 SERVER_RESULT_CALLBACK|[UniqueIDBDatabaseTransaction.cpp L139–157](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabaseTransaction.cpp#L139-L157)／`f0a7e795031983ce7a52b081664895acc896db1d`|weak transaction/connectionが生存する場合、結果を`connection->didCommitTransaction`へ転送する|弱参照が消えた後にも通知が必ず送達されること|
|C5 SERVER_TO_CLIENT_DELEGATE|[UniqueIDBDatabaseConnection.cpp L169–178](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabaseConnection.cpp#L169-L178)／`a4c3f55262a4ce293b881b9d267bf55f31de0353`→[IDBConnectionToClient.cpp L153–156](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/IDBConnectionToClient.cpp#L153-L156)／`383775aed9453ad42ce11f133fd84b5d53a0ae38`|transaction IDを渡し、delegateがある場合に`didCommitTransaction`を中継する|delegate不在・IPC後の配送を「発生しなかった」と断定|
|C6 CLIENT_CALLBACK|[IDBConnectionProxy.cpp L395–407](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/client/IDBConnectionProxy.cpp#L395-L407)→[IDBTransaction.cpp L561–581](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.cpp#L561-L581)|Clientが結果を受けるが、最後のrequest処理が残ると`m_commitResult`へ保存してCommittingのまま早期returnする|Client Committingをbackend未完了の陽性証拠とすること|

**固定ソース上の観察と限界：** C1/C2のようなbackendの正常commitを通らないerror応答も`didCommitTransaction`という名前を持つ。このため**イベント名やClient callback名だけでC3（本物のbacking-store結果）を認定するのは危険**。またC3に達した後、weak refやdelegate欠損でC6に届かない経路があり得る。通知の欠落をC3未発生と読み替えない。

## stop cutの「前」／「後」をどう証明するか
- **境界を事前固定：** U-C研究の`boundaryType`はJ2/W2/W3を一度に混在させない。特にW2/W3ではClient objectは破棄済みとなり得るため、古いClient T1 snapshotをそのcutの状態へ自動延長しない。
- **肯定的な結果証拠：** C3の生成元producerに関する`backendResultEventId`と`nativeConnection/resource/processIncarnation`、call/ack、error分類を付与し、同一生成元内の順序と確定edgeを保持。C3がcutより前と証明できれば`backendPendingAtCut=FAIL`。
- **未結果という陰性証明：** C3不在ではなく、**C3が発生していたら記録されたこと**を証明できることが必要。C3の全出口（正常結果・error・abort・suspension・process loss）と、producerがcutまで到達したことを明示的な双方向checkpoint/ackまたは独立した状態snapshotで保証しなければUNKNOWN。単に`lastSeq`や`flush`が存在することでは足りない。
- **cut後の結果証拠：** C3がcut後に確定したと因果証明できる場合でも、Client Committingがcut時に成立していたこと、C3より前の異常/abortがなかったこと、同一tx/revision/recorder完全性を別途要する。
- **独立性：** 受信側のイベントだけを発生元C3と偽装せず、producerの存在証拠とdeliveryの因果を分ける。異sourceの時計、配列順、collector到着順をedgeにしない。計測用の追加DB lockや同期flushが競合の順序を変える場合は研究対象との対応UNKNOWN。

## 静的反例（実動作の再現ではない）
1. **CLIENT_COMMITTING_WITH_RESULT**：C3が完了しC6で応答到達した後も`m_commitResult`の遅延処理でClient T1が残る。backend pending判定はFAILとなり得る。
2. **ERROR_NOT_FROM_BACKING_STORE**：server connection lostでC1からClient結果が生まれる。C6で受信した結果はC3の存在証拠にならない。
3. **MAP_TAKE_BEFORE_RESULT**：C3でserver mapからIDが消えたがbacking-store commitはまだ進行中。map不在をfinishedとしない。
4. **DELEGATE_DROP**：C3の結果があってもC4/C5の途中でcallbackが途切れる場合、Client未受信はC3未発生を意味しない。
5. **CUT_UNCONNECTED**：C3とJ2/W2/W3のログを取得しても、別producerの順序edgeがない場合はbackendPendingAtCut=UNKNOWN。
6. **ABORT_BEFORE_RESULT**：未処理request errorやserver loss/suspension由来のabortがC3の代わりに起きても「正常pending」と判定しない。

## 結論と次の静的ゲート
**C1（接続喪失由来）／C2（server事前条件由来）／C3（backing-storeの結果）を出自別に識別する必要性は固定コードから強く支持される。** 実際にこれらのイベントが同じcutへ因果結合できる記録手段はまだない。U-C研究実証UNKNOWN、元U/実験NOT_RUN。
次の実装前ゲート：①実対象binaryと固定ソースの対応G1、②JS/native ID join G2、③cutとC3 producerをつなぐhappens-before G3、④全結果・異常出口とlossを検出する外部recorder G4。いずれも未成立のままなら実験開始BLOCKED。

**保持**：H1〜H3 UNKNOWN/H4 PARTIAL、G1 PARTIAL、G2/G3/G4 UNKNOWN、`executionAuthorization=NOT_GRANTED`、`startCondition=BLOCKED`、`productionWorker=HOLD`、独立再レビュー待ち・マージ推奨NO。2026-11-04 JST。
