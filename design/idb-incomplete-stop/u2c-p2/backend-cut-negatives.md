# P2 第2段階：backend発生元とcutの負の対照（事前期待値・実験0）

親契約：#410 HEAD `5ea6f42db5ff122259261a5f0f3d25f6d63ba990`、blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`。[backend発生元調査](backend-result-cut-deep-dive.md)。研究用U-Cは元Uと別軸。
|ID|反例／対照|期待する分類|誤判定として拒否|
|---|---|---|---|
|BACK-N01|Client Committingだがbacking-storeの結果は未確認|Client T1のみ確認、backend pending UNKNOWN|T1だけでpending PASS|
|BACK-N02|server connection失効が生んだdidCommitTransaction(error)|正常C3の結果証拠ではない、異常経路|名前だけでbacking-store resultに分類|
|BACK-N03|未処理request errorでabort/error callbackに分岐|正常commit pending不可、異常理由保持|error callbackを正常commit進行中|
|BACK-N04|server map take後、backing-store commit関数は未完了|map不在、C3結果UNKNOWN|map takeを結果確定に昇格|
|BACK-N05|backing-store C3が終わったがweak transactionが消失|C3発生とClient配送を別判定|Client未受信からC3未発生|
|BACK-N06|C3が結果を出したがdelegate不在でC6へ届かない|C3発生事実保持、配送UNKNOWN|結果未配達を未結果とする|
|BACK-N07|Client didCommit(error)に結果到達、最後のrequest処理が残る|ClientはCommittingに留まり得る、backend pending FAIL候補|Client T1をC3未完了へ昇格|
|BACK-N08|C3と停止cutを別producerで観測し、因果edgeなし|先後UNKNOWN、U-C UNKNOWN|時計差・受信順で先後を捏造|
|BACK-N09|C3 producerの連番は連続だがcutまで到達していない|欠測の否定不可、U-C UNKNOWN|連番完全＝結果非発生|
|BACK-N10|C3 producerでoverflow/process loss、flush ackなし|資料INCOMPLETE、U-C UNKNOWN|ログ消失を陰性証拠に|
|BACK-N11|以前のClient Committing snapshotだけありW2/W3時点ではobjectなし|cut時のClient状態UNKNOWN|古いsnapshotを現在へ延長|
|BACK-N12|同じresource numberでも別native process incarnation|同一性不成立、U-C UNKNOWN|resource番号で無関係tx join|
|BACK-N13|C3をcut前に確実に観測し同一IDと確定|backend pending at cut FAIL、U-C成立不可|Client Committingで上書きPASS|
|BACK-N14|C3結果なし・cut以後の完備性証拠なし|U-C UNKNOWN|「なかった」という陰性証明|
|BACK-N15|同ID commit結果とabort結果の資料矛盾＋欠測|INCONSISTENT優先、欠測も保持、U-C UNKNOWN|片方採用／欠測非表示|
|BACK-N16|研究用U-Cを将来PASSできても元UはNOT_RUN|U-Cのみ限定評価、既存U NOT_RUN、HOLD|U-C→U PASS、実験の無承認起動|
## 静的受入
この16件は動的テストではなく、偽PASSの帰結を予め決める机上反例。サーバー生成元・結果値・送信・受信・cutの各段階を独立に識別し、cross-source因果edgeを欠く場合はUNKNOWNとする。G1配布物実体・G2 ID join・G3停止cut・G4結果producer完全性が未成立なら、U-Cを肯定しない。WebKit実験0、NOT_GRANTED/BLOCKED/HOLD維持。
