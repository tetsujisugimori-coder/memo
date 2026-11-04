# P2 第2段階：backend発生元とcutの負の対照（事前期待値・実験0）

親契約：#410 HEAD `5ea6f42db5ff122259261a5f0f3d25f6d63ba990`、blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`。[backend発生元調査](backend-result-cut-deep-dive.md)。研究用U-Cは元Uと別軸。

## 今回の修正と判定前提

固定旧HEAD `bf59f393e495ba500cf7dc074cc3f5701bbf4146`のBACK-N07は、Client `didCommit(error)`受信だけを入力にして「backend pending FAIL候補」としていた。
[独立レビュー5764860850](https://github.com/tetsujisugimori-coder/memo/pull/416#pullrequestreview-5764860850)のC1反例では、この入力から真正C3もcutとの先後も確定しないためUNKNOWNでなければならない。
旧IDを削除・再番号付けせず、BACK-N07を真正C3のcut前確定に限定し、受信だけのC1/C2をBACK-N17/N18として追加する。
BACK-N13はFAILの期待値を維持し、同じ十分条件を明示する。他の既存15行（N07以外）の結論を都合よく変更しない。

以下のC1〜C6は本調査の研究用出自ラベルであり、WebKit既存イベント名や親PR #414の段階番号と同一視しない。
`backendPendingAtCut`は研究専用の未実装の概念判定であり、既存Collector/schemaの新フィールドではない。

- **真正C3**：[C3の生成元と分岐](backend-result-cut-deep-dive.md#固定コードで分かる発生元の違い)が識別され、実backing-storeの論理commit処理のresult/errorが確定した証拠。C1/C2、map take、関数entry、C4〜C6のcallback名だけでは代用しない。
- **同一対象**：C3のnative transaction/resource、native connection、backend process incarnationが対象の台帳と一致し、JS完全identity・Worker incarnationへ明示的に結合される。別processの同じ数値IDは結合しない。backend processとWorker processのincarnationを数値が同じだから同一とする意味ではない。
- **cut**：J2/W2/W3から事前に選んだ一つの実停止境界と対象incarnationを固定する。同producer内の順序とID付きのsend/receive・call/ack等の明示edgeでC3とcutを比較する。Client受信時刻、異source時計、配列・到着順を根拠にしない。
- **資料と判定**：矛盾やidentity未結合の資料から部分的なFAIL/PASSを採用しない。資料INCONSISTENTではbackend/U-CともUNKNOWN、欠測理由も保持する。C3によるFAILには真正C3とcut前関係の立証が必要で、受信だけ・先後不明の本反例ではUNKNOWN。backend未結果の肯定には、親契約の独立した状態観測／完全性証拠を別途要する。記録不足は結果の発生・非発生いずれの証明でもない。
- **正常性は別軸**：C1/C2のerror/abortを正常U-C候補として採用しない。異常の出自・理由とcut前後を別途保持し、cut前の異常か不明ならその軸もUNKNOWNとする。異常だからbackendPendingAtCutも自動FAIL、としない。

|ID|反例／対照|期待する分類|誤判定として拒否|
|---|---|---|---|
|BACK-N01|Client Committingだがbacking-storeの結果は未確認|Client T1のみ確認、backend pending UNKNOWN|T1だけでpending PASS|
|BACK-N02|server connection失効が生んだdidCommitTransaction(error)|正常C3の結果証拠ではない、異常経路|名前だけでbacking-store resultに分類|
|BACK-N03|未処理request errorでabort/error callbackに分岐|正常commit pending不可、異常理由保持|error callbackを正常commit進行中|
|BACK-N04|server map take後、backing-store commit関数は未完了|map不在、C3結果UNKNOWN|map takeを結果確定に昇格|
|BACK-N05|backing-store C3が終わったがweak transactionが消失|C3発生とClient配送を別判定|Client未受信からC3未発生|
|BACK-N06|C3が結果を出したがdelegate不在でC6へ届かない|C3発生事実保持、配送UNKNOWN|結果未配達を未結果とする|
|BACK-N07|同じ完全native identity・process incarnationの真正C3 result/error生成元が確認済みで、明示edgeによりC3≺選択cutが確定。C6へも届くが最後のrequest処理が残りClient Committingが残存。資料に矛盾なし|backendPendingAtCut=FAIL、U-C成立不可。C3 errorなら異常理由も保持。Client T1残存は別事実|Client T1でpendingをPASSに上書き／C6だけを真正C3とする|
|BACK-N08|C3と停止cutを別producerで観測し、因果edgeなし|先後UNKNOWN、U-C UNKNOWN|時計差・受信順で先後を捏造|
|BACK-N09|C3 producerの連番は連続だがcutまで到達していない|欠測の否定不可、U-C UNKNOWN|連番完全＝結果非発生|
|BACK-N10|C3 producerでoverflow/process loss、flush ackなし|資料INCOMPLETE、U-C UNKNOWN|ログ消失を陰性証拠に|
|BACK-N11|以前のClient Committing snapshotだけありW2/W3時点ではobjectなし|cut時のClient状態UNKNOWN|古いsnapshotを現在へ延長|
|BACK-N12|同じresource numberでも別native process incarnation|同一性不成立、U-C UNKNOWN|resource番号で無関係tx join|
|BACK-N13|BACK-N07と同じ真正C3生成元・完全native identity・process incarnation・矛盾なしの条件でC3≺選択cutを明示edgeで確定。C6配送／Client T1は不問|backendPendingAtCut=FAIL、U-C成立不可。BACK-N07と同じ証拠には同じ結論|C3出自／cut結合の省略、結果未受信から未発生、Client Committingで上書きPASS|
|BACK-N14|C3結果なし・cut以後の完備性証拠なし|U-C UNKNOWN|「なかった」という陰性証明|
|BACK-N15|同ID commit結果とabort結果の資料矛盾＋欠測|INCONSISTENT優先、欠測も保持、U-C UNKNOWN|片方採用／欠測非表示|
|BACK-N16|研究用U-Cを将来PASSできても元UはNOT_RUN|U-Cのみ限定評価、既存U NOT_RUN、HOLD|U-C→U PASS、実験の無承認起動|

### 追加：出自別・cut別の独立した反例

以下は新しい事前期待値であり、旧N01〜N16の実行結果や保存済み証拠を置き換えない。

|ID|入力条件|期待する分類|誤判定として拒否|
|---|---|---|---|
|BACK-N17|C1 CONNECTION_FALLBACK_ERROR由来のC6 error受信のみ。C3生成元証拠なし。最後のrequestが残りClient Committing。C1 errorのcut前後は別途記録|backendPendingAtCut=UNKNOWN。正常U-C候補には採用不可。connection-loss理由を保持、異常のcut前後不明もUNKNOWN|error受信→実commit完了FAIL／未完了PASSのいずれも禁止|
|BACK-N18|C2 SERVER_PRECONDITION_ERROR由来のC6 error受信のみ。未処理request失敗→abort、backing store closed等でC3生成元証拠なし|backendPendingAtCut=UNKNOWN。正常U-C候補には採用不可。precondition/abort理由を保持|server callbackの存在→C3結果確定／正常pending|
|BACK-N19|真正C3と完全native identityは確認でき、選択cut≺C3が因果確定。ただしcutでのcommit進行状態、先行結果・異常のcoverage、Client T1持続が未確認|backendPendingAtCut=UNKNOWN、U-C UNKNOWN。cut後のC3発生事実は保持|後の結果だけでcut時の正常pendingをPASS／cut前結果と誤ってFAIL|
|BACK-N20|真正C3の出自は確認できるが、C3と選択cutの明示edgeなし。C6は受信済み、Client T1もある|backendPendingAtCut=UNKNOWN、先後UNKNOWN。BACK-N08と整合|C6到達やClient T1、時計差・配列順でC3≺cutを補完|
|BACK-N21|resourceとbackend process incarnationの数値は合うがnative connectionまたはJS/native対応が別対象。C3をcut前と結ぶ記録がある|対象へのjoin拒否、backendPendingAtCut=UNKNOWN、U-C UNKNOWN。不正joinを矛盾理由として保持。別process incarnationはN12|native resourceの部分一致で対象のbackend FAIL/PASSを確定|
|BACK-N22|C6にC3由来とのラベルだけがあり、生成元記録が欠落、producer loss/flush失敗で裏付け不能。C3とcutの結合も未立証|資料INCOMPLETE、backendPendingAtCut=UNKNOWN、U-C UNKNOWN。loss/flush理由保持|受信側ラベルで真正C3を捏造／欠測から非発生|
|BACK-N23|同一native identity・同一commit試行について「C1のみでbackendへ委譲なし」と「真正C3正常結果がcut前」の排他的出自を同時主張し、記録も欠落|資料INCONSISTENT優先、欠測と両出自の理由を保持。backendPendingAtCut=UNKNOWN、U-C UNKNOWN|C3だけ選んでFAIL／異常だけ消してPASS。異常と正常が別時点に共存するだけの資料とは区別|
|BACK-N24|SQLiteIDBBackingStore::commitTransaction entry/早期error returnだけを確認。m_transactions.takeで対象なし、transaction->commit未実行。C3の実commit結果生成は未確認|backendPendingAtCut=UNKNOWN、正常U-C候補には採用不可。backing-store内の事前条件errorとして保持|backing-store関数名やreturnだけを実commit処理の結果に昇格|

## 同一反例による静的新旧比較

|固定入力（修正前後で同一）|旧bf59f39の読み取り／問題|修正後の事前期待値|
|---|---|---|
|C1 errorがC6へ届きClient T1残存。真正C3なし、cutとの結合なし|旧N07の入力を満たし「backend pending FAIL候補」を導き得る。C1をC3と取り違える反例|N17：backendPendingAtCut=UNKNOWN、正常候補採用不可、connection-loss理由保持|
|C2 errorがC6へ届きClient T1残存。真正C3なし|旧N07はC1/C2/C3の出自条件を要求しなかった|N18：backendPendingAtCut=UNKNOWN、正常候補採用不可、precondition/abort理由保持|
|真正C3生成元＋同じ完全native identity/incarnation＋C3≺cut＋矛盾なし。Client T1残存|旧N13のFAILは妥当。旧N07は同じ結論に必要な根拠が省略されていた|N07とN13ともbackendPendingAtCut=FAIL。C6配送の有無で変えない|

これは静的な期待値の不一致を解消する机上比較であり、動的RED→GREEN試験ではない。
旧文言・レビュー・固定HEADは上に残し、独立再レビューには別の出自／identity／cut反例による反証を求める。

## 静的受入
BACK-N01〜N24は24件の静的反例であり、動的テスト成功件数ではない。既存N01〜N16のIDを維持した。
最低検討項目の対応：C1のみ=N17、C2のみ=N18、C3 cut前=N07/N13、C3 cut後=N19、先後UNKNOWN=N08/N20、Client T1残存=N07/N17、Client配送欠落=N05/N06、ID/incarnation不一致=N12/N21、producer欠落/flush失敗=N10/N22、出自/正常異常の矛盾=N15/N23。
サーバー生成元・結果値・送信・受信・cutを独立に識別し、G1配布物実体・G2 ID join・G3停止cut・G4結果producer完全性が未成立なら、U-Cを肯定しない。
自己静的照合と独立再レビューは別工程。独立再レビュー未完了、U-C実証UNKNOWN、総合PARTIAL、マージ推奨NO。
`G1=PARTIAL`、`G2/G3/G4=UNKNOWN`、`conditionU=NOT_RUN`、`realExperiment=NOT_RUN`、`executionAuthorization=NOT_GRANTED`、`startCondition=BLOCKED`、`productionWorker=HOLD`を維持。WebKit実験0。2026-11-04 JST。
