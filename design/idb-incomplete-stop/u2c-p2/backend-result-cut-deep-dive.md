# P2 第2段階：backend結果の発生元・停止境界cutとの因果関係の静的検証

**対象：Issue #412／PR #414固定HEAD `761d3d54611e65f0fd599c5c13eac458d41f1c9c`／共通契約v1 #410 blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`。** WebKit上流固定 `343e13bf22dca9d0ec227801419aab0f9001a32f`。U-Cは独立研究であり、既存Uには転用しない。実WebKit/Worker/IndexedDB実験0、配布rev2336の実体一致UNKNOWN。

## 問い
同一JS/native transaction、同一Worker incarnationに対して、**backing-storeが返すcommit結果の発生元**を区別し、事前に選んだstop cut（J2/W2/W3のうち一つ）までに**結果が確定した／未確定だった**ことを、独立した因果証拠で確認できるか。

## BACK-N07の修正対象と履歴

[独立レビュー5764860850](https://github.com/tetsujisugimori-coder/memo/pull/416#pullrequestreview-5764860850)の対象は`bf59f393e495ba500cf7dc074cc3f5701bbf4146`。
旧BACK-N07は「Client didCommit(error)に結果到達、最後のrequest処理が残る」に対して「backend pending FAIL候補」とした。
しかし同じ入力はC1/C2でも生じ、C3生成元とcutとの因果を含まない。この不足をFAILにしないため、N07を真正C3のcut前確定へ限定し、受信だけのC1/C2はN17/N18でUNKNOWNに固定する。
N13のFAILは維持し、N07と同じ十分条件へ揃える。これは判定契約の局所修正であり、実Collectorの誤判定を動的再現したという主張ではない。

## 固定コードで分かる発生元の違い
以下は本書専用の研究ラベル。WebKitの正式イベント名ではなく、親PR #414 static-trace.mdのC1〜C9という段階番号とも別定義である。文書間はラベル文字列だけで結合せず、固定path・関数・分岐で対応させる。

|経路ラベル（研究用、既存イベント名ではない）|固定ソース／Git blob|直接確認したこと|証明できないこと|
|---|---|---|---|
|C0 CLIENT_COMMIT_INTENT|[IDBTransaction.cpp L466–500](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.cpp#L466-L500)／`c242991f3914b844643b228b11a4d24c84ff0a4d`|ClientがCommittingへ移行し、proxyへcommitを投げる|backendがrequestを受理した、またはまだ未結果|
|C1 CONNECTION_FALLBACK_ERROR|[IDBConnectionToServer.cpp L353–377](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/client/IDBConnectionToServer.cpp#L353-L377)／`ff8937a8ec8ff396ecc1fa5a5333ccd1f01b298d`|server接続が無効なら`serverConnectionLostError`付きの`didCommitTransaction`を別経路で生成する|このerrorをbacking-storeのcommit結果と呼ぶこと|
|C2 SERVER_PRECONDITION_ERROR|[UniqueIDBDatabase.cpp L1211–1254](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabase.cpp#L1211-L1254)／`d9f96867ddc51df3acfc42a97ebbcfb2866de2eb`|space確認時のmanager不在／weak参照消失、未処理失敗requestのabort、backing store closed、map entry欠落など、実commit call前のerror/abort分岐。一部はcallbackなしreturn|Clientの`didCommit(error)`受信からC3が発生したこと、または正常pendingを断定|
|C3 BACKING_STORE_COMMIT_RESULT|[UniqueIDBDatabase.cpp L1247–1259](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabase.cpp#L1247-L1259)→[SQLiteIDBBackingStore.cpp L1102–1128](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/SQLiteIDBBackingStore.cpp#L1102-L1128)／`45460fc38ea43f8c74e7b0831bc007c4b9cf6ef3`|有効な対象でbacking-storeの`transaction->commit()`（L1116）が実行され、result/errorを返す分岐（L1128→Unique L1256–1258）。結果確定は成功と同義ではない|map take、関数entry、実commitを呼ばない早期returnをこのC3に昇格。readonly論理IDB結果を物理SQL commitと同一視|
|C4 SERVER_RESULT_CALLBACK|[UniqueIDBDatabaseTransaction.cpp L139–157](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabaseTransaction.cpp#L139-L157)／`f0a7e795031983ce7a52b081664895acc896db1d`|weak transaction/connectionが生存する場合、結果を`connection->didCommitTransaction`へ転送する|弱参照が消えた後にも通知が必ず送達されること|
|C5 SERVER_TO_CLIENT_DELEGATE|[UniqueIDBDatabaseConnection.cpp L169–178](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/UniqueIDBDatabaseConnection.cpp#L169-L178)／`a4c3f55262a4ce293b881b9d267bf55f31de0353`→[IDBConnectionToClient.cpp L153–156](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/IDBConnectionToClient.cpp#L153-L156)／`383775aed9453ad42ce11f133fd84b5d53a0ae38`|transaction IDを渡し、delegateがある場合に`didCommitTransaction`を中継する|delegate不在・IPC後の配送を「発生しなかった」と断定|
|C6 CLIENT_CALLBACK|[IDBConnectionProxy.cpp L399–411](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/client/IDBConnectionProxy.cpp#L399-L411)／`e6033c8d9e19e63790e66dac2586f6c62da3fa00`→[IDBTransaction.cpp L561–581, L1413–1434](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/IDBTransaction.cpp#L561-L581)|proxyは対象があればorigin threadへ渡す。Clientは最後のrequest処理が残ると`m_commitResult`へ保存してCommittingのまま早期returnし、後に再処理し得る|受信callback名だけでC1/C2/C3を判別、Client Committingをbackend未完了の陽性証拠とすること|

**固定ソース上の観察と限界：** C1/C2のようなbackendの正常commitを通らないerror応答も`didCommitTransaction`という名前を持つ。このため**イベント名やClient callback名だけでC3（本物のbacking-store結果）を認定するのは危険**。またC3に達した後、weak refやdelegate欠損でC6に届かない経路があり得る。通知の欠落をC3未発生と読み替えない。

**C3認定の追加境界：** SQLiteIDBBackingStore L1110–1113には、対象transactionが見つからず`transaction->commit()`を呼ばない早期errorもある。これはbacking-store内の事前条件エラーとして保持するが、本書の「実commit処理の結果C3」を証明しない（BACK-N24）。C2はserver側の研究分類名であり、この早期errorをWebKitの正式なC2イベントと呼ぶものではない。
従って単なる`commitTransaction()` entry/return名ではなく、対象・呼出し・分岐・結果の発生元を結ぶ必要がある。readonlyで物理SQL transactionが存在しなくても、論理backing-store commit処理の結果とは区別する。

## 出自を取り違えない判定規則（研究専用・未実装）

判定対象は同じnative transaction/resource・native connection・backend process incarnationと、JS完全identityおよびWorker incarnationとの結合で固定する。
cutは事前選択したJ2/W2/W3の確定観測とその対象incarnationであり、backend processとWorker processのID数値を単純比較するものではない。
`backendResultEventId`やcheckpoint/ack相関は将来の証拠候補であり、既存schemaへ実装済みのIDではない。

|確認された証拠|backendPendingAtCutの事前期待値|別途保持する事実／採用条件|
|---|---|---|
|真正C3生成元、同一対象、C3≺選択cutの明示edge、矛盾なし|FAIL|結果の成功/error、Client状態、C6配送は別。Client Committingが残ってもFAILを変えない（N07/N13）|
|C1/C2のerrorがC6へ到達しただけで、真正C3は未確認|UNKNOWN|異常理由を保持し、正常U-C候補へ採用しない。実commit完了／未完了のどちらも断定しない（N17/N18）|
|真正C3はあるがcutとの因果順序不明|UNKNOWN|出自の確認とcut前後の確認を区別（N08/N20）|
|選択cut≺真正C3のみ判明し、cut時の進行状態・先行終端/異常coverageが不足|UNKNOWN|後の結果は保持するが、正常pendingの証明には追加証拠を要求（N19）|
|identity未結合、生成元記録不明、または同一試行の排他的出自/結果に矛盾|UNKNOWN|join拒否／INCOMPLETE／INCONSISTENTを保持。矛盾優先で欠測理由も消さない（N12/N15/N21〜N24）|

C3 errorも実commit処理の結果として出自が立証されれば、cut前確定はbackend未結果を否定する。しかし成功commitや正常性の証明にはしない。
異常理由の判定とpendingの判定を分離し、異常の存在だけでpendingをFAILにしない。異常のcut前後が不明なら`abnormalBeforeCut`もUNKNOWNである。
これらは将来資料への条件付き静的期待値であり、現在の実観測はなくU-C実証UNKNOWNである。

## stop cutの「前」／「後」をどう証明するか
- **境界を事前固定：** U-C研究の`boundaryType`はJ2/W2/W3を一度に混在させない。特にW2/W3ではClient objectは破棄済みとなり得るため、古いClient T1 snapshotをそのcutの状態へ自動延長しない。
- **肯定的な結果証拠：** 真正C3の生成元producer・分岐・結果と`backendResultEventId`、`nativeConnection/resource/processIncarnation`、call/ack、error分類を結ぶ。概念例は「C3 result→同producer checkpoint→対応するsend/receiveまたはack→選択cut」の明示edge。実装/観測済みという意味ではない。同一対象、矛盾なし、C3≺cutを証明できる場合だけ`backendPendingAtCut=FAIL`。C4〜C6単独ではこの前提を満たさない。
- **未結果という陰性証明：** C3不在ではなく、**C3が発生していたら記録されたこと**を証明できることが必要。C3の全出口（正常結果・error・abort・suspension・process loss）と、producerがcutまで到達したことを明示的な双方向checkpoint/ackまたは独立した状態snapshotで保証しなければUNKNOWN。単に`lastSeq`や`flush`が存在することでは足りない。
- **cut後の結果証拠：** C3がcut後に確定したと因果証明できる場合でも、Client Committingがcut時に成立していたこと、C3より前の異常/abortがなかったこと、同一tx/revision/recorder完全性を別途要する。
- **独立性：** 受信側のイベントだけを発生元C3と偽装せず、producerの存在証拠とdeliveryの因果を分ける。異sourceの時計、配列順、collector到着順をedgeにしない。計測用の追加DB lockや同期flushが競合の順序を変える場合は研究対象との対応UNKNOWN。

## 静的反例（実動作の再現ではない）
1. **CLIENT_COMMITTING_WITH_RESULT**：同一対象の真正C3結果がcut前と因果確定し、C6で応答到達した後も`m_commitResult`の遅延処理でClient T1が残る。backend pendingはFAIL（N07/N13）。cut条件を欠けばUNKNOWN。
2. **ERROR_NOT_FROM_BACKING_STORE**：C1接続失効またはC2事前条件errorからClient結果が生まれるだけなら、C6はC3の存在証拠にならない。backend pendingはUNKNOWN、正常U-C候補としては採用しない（N17/N18）。
3. **MAP_TAKE_BEFORE_RESULT**：server mapからIDが消えたがbacking-store commitはまだ進行中でC3結果未確定。map不在をfinishedとしない。
4. **DELEGATE_DROP**：C3の結果があってもC4/C5の途中でcallbackが途切れる場合、Client未受信はC3未発生を意味しない。
5. **CUT_UNCONNECTED**：C3とJ2/W2/W3のログを取得しても、別producerの順序edgeがない場合はbackendPendingAtCut=UNKNOWN。
6. **ABORT_BEFORE_RESULT**：未処理request errorやserver loss/suspension由来のabortがC3の代わりに起きても「正常pending」と判定しない。

同一反例の旧新比較は[負の対照の静的新旧比較](backend-cut-negatives.md#同一反例による静的新旧比較)を参照。
N07はC6配送後にもT1が残る具体例、N13は配送・Client状態を不問とする一般形で、同じ真正C3≺cut証拠に対する結論はともにFAIL。
N17/N18はC3≺cutの前提を欠く別入力なのでUNKNOWNとし、N07/N13との期待値矛盾ではない。

## 自己静的照合と独立再レビューへの引継ぎ

固定上流の9ファイルをcontents APIから再取得し、Git blobを再計算した。表の8ファイルと、readonly確認用[SQLiteIDBTransaction.cpp L75–95](https://github.com/WebKit/WebKit/blob/343e13bf22dca9d0ec227801419aab0f9001a32f/Source/WebCore/Modules/indexeddb/server/SQLiteIDBTransaction.cpp#L75-L95)（blob `d3ef47f9bb5e2556e2efd3b6e891ee0604d011da`）で、変更前の固定path/blob対応と一致した。readonlyは論理commit処理の結果を返しても物理SQL commitを実行しない。配布WebKit rev2336の実バイナリ一致は未確認のまま。
BACK-N01〜N16のIDを残し、N17〜N24を追加する。自己静的照合は24件の期待値の整合、N07/N13の十分条件、C1/C2のUNKNOWN、欠測・矛盾理由の保持、リンク・番号・変更範囲を対象とする。実ブラウザでの再現・24件の動的試験成功ではない。
元のR/U、共通契約v1、親PR、P1研究、Collector/judge/schema、runner/workflow、WebKitソース、既存原始証拠は変更しない。
独立再レビューでは、単なる自己検証の追認ではなく、①C1 errorに誤ったC3ラベルを付ける、②別processの同じnative数値IDを再利用、③C3 errorとcutの順序を未結合にする、④backing-storeの早期returnをC3と偽装する、等の別反例でUNKNOWNが維持されるかを確認する。
今回の修正者による照合だけを独立レビューPASSとは呼ばず、**独立再レビュー未完了**として引き渡す。CIも実runがなければNOT_RUNと記録する。

## 結論と次の静的ゲート
**C1（接続喪失由来）／C2（server事前条件由来）／C3（backing-storeの結果）を出自別に識別する必要性は固定コードから強く支持される。** 実際にこれらのイベントが同じcutへ因果結合できる記録手段はまだない。U-C研究実証UNKNOWN、元U/実験NOT_RUN。
次の実装前ゲート：①実対象binaryと固定ソースの対応G1、②JS/native ID join G2、③cutとC3 producerをつなぐhappens-before G3、④全結果・異常出口とlossを検出する外部recorder G4。いずれも未成立のままなら実験開始BLOCKED。

**保持**：H1〜H3 UNKNOWN/H4 PARTIAL、G1 PARTIAL、G2/G3/G4 UNKNOWN、`executionAuthorization=NOT_GRANTED`、`startCondition=BLOCKED`、`productionWorker=HOLD`、独立再レビュー待ち・マージ推奨NO。2026-11-04 JST。
