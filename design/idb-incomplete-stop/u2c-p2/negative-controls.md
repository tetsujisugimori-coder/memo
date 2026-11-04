# Stage U-2C P2：U-C偽PASSの静的反例・受入基準
**実WebKit実行／実観測は0。期待値の事前固定であり、動的受入試験成功ではない。**
親`IDS-U2A-OBS-v1` blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`、WebKit上流`343e13bf22dca9d0ec227801419aab0f9001a32f`を固定。
|ID|入力・静的対照|将来の判定に求める分類|拒否する誤成功|
|---|---|---|---|
|P2-N01|Client `Committing`だけが観測される|Client T1の候補のみ、backend pending UNKNOWN、U-C UNKNOWN|T1をbackend pendingへ昇格|
|P2-N02|Client `Committing`とcommit intent、result未受信|backend pending UNKNOWN、U-C UNKNOWN|通知欠落を未結果へ昇格|
|P2-N03|server commit resultがcut前に確定、ClientはCommittingのまま|backend pending **FAIL**、U-C成立禁止|Client T1からpending PASS|
|P2-N04|`didCommit()`が`m_commitResult`を保存して早期return|Client T1残存可能、server結果既到達、U-C成立禁止|Client Finished未到達をserver未結果に読み替え|
|P2-N05|backend mapからIDが`take()`されたがbacking-store未応答|map不在でも結果UNKNOWN|map不在を完了扱い|
|P2-N06|mapに同IDが残るがClientはAborting|正常pendingへの採用禁止|map在籍＝正常継続|
|P2-N07|server connection lostからerror resultが生成|異常理由保持、正常U-C成立禁止|server errorを正常commit pending|
|P2-N08|suspension/forced-closeでabortが起動|正常U-C成立禁止／abnormalを独立分類|「Finishedでない」ことだけを正常条件|
|P2-N09|Client Finishedだけを観測|T3候補のみ、server成功・complete配送はUNKNOWN|Client Finished＝成功commit|
|P2-N10|server結果は確定、Workerのcomplete eventは未配送|backend pending FAIL、Client/JS通知は別軸|イベント未受信→backend pending|
|P2-N11|Worker completeイベントがmainで受信されstop前|親条件が満たされればR PASS/U FAIL。U-Cは独立判定|R PASSからU-Cの肯定を作る|
|P2-N12|W2 context破棄後にClient objectがなく、以前のCommitting snapshotのみ|W2 cutでのClient T1は因果と完全性がなければUNKNOWN|昔のsnapshotを現在状態へ延長|
|P2-N13|W3 thread exitを確認してもbackendのID対応が不明|U-C UNKNOWN、物理解放UNKNOWN|thread終了＝DB commit未完了|
|P2-N14|commit result producerの連番が連続だがcut到達が不明|資料整合でもbackend pending UNKNOWN|連番だけで終端未発生|
|P2-N15|result producerでoverflow/process loss/flush失敗|INCOMPLETE、U-C UNKNOWN|欠けた結果を非発生と扱う|
|P2-N16|native resource numberが同じで別process incarnation|ID join拒否、U-C UNKNOWN|資源番号だけで同一tx|
|P2-N17|sourceMsを入替え、明示因果edgeは同じ|U-Cの意味上の分類不変|時計でcutと結果を並べ替える|
|P2-N18|Client Committing→backend結果→Client callbackが逆順に配送される記録|生産元順序/ID edgeで判定、無根拠な配列位置は無視|collector到着順で因果を変更|
|P2-N19|commit結果とabort/異常結果が同一IDで矛盾、tailも不足|INCONSISTENT優先、欠測理由も保存、U-C UNKNOWN|片方だけ採用してPASS|
|P2-N20|U-C成立という独立証拠が仮に揃う|U-C研究の候補PASSのみ、既存U/実験NOT_RUN、HOLD|U-C→U PASSや実験開始の自動許可|
## 閉鎖条件（研究文書）
- P2の「関数コード上の経路」を明らかにすることと、「実在するbackend pending at cut」を証明することを切り分ける。
- Fixed sourceとGit blob、Client/native identity、同一cutの正しい因果edge、terminal/abnormal全経路、recorderのcover/high-water/flushについて事実と仮定を区別する。
- 20対照の期待値に矛盾・改変があれば新versionで独立レビューする。反例がソースから静的に構成できたことは実実験再現を意味しない。
- 今回の成果は`P2=PARTIAL/UC_RESEARCH=UNKNOWN`。実ブラウザ/Worker/IndexedDB/計測/ビルドはNOT_RUN、`NOT_GRANTED/BLOCKED/HOLD`維持。元条件U・結果schema/judge/Collectorは無変更。
