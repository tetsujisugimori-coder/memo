# P1 cleanup前境界・transaction結合：静的反例と期待判定

**事前の静的反例。動的試験ではなく、成功件数を報告しない。**
2026-11-05 JST。固定WebKit `343e13bf22dca9d0ec227801419aab0f9001a32f`。
[本調査とソース索引](precleanup-boundary-transaction.md)、[共通観測契約v1](../u2-witness/common-observation-contract-v1.md)を優先する。既存A01–A28／P1-N／JSC-Nを置換しない。

「拒否」は肯定的なJ2/P1/U/U-Cへの誤昇格を拒否する意味。証拠不足はUNKNOWNであり、証拠による条件不成立FAIL・対象外NOT_APPLICABLE・資料不整合INCONSISTENTを混同しない。

|ID|仮定する静的反例|期待判定と拒否理由|本調査の根拠|
|---|---|---|---|
|C0-N01|executionForbidden=trueだがentryScopeが残り、JSは終了例外からunwind中|同時条件不成立。J2肯定を拒否、実証UNKNOWN。F設定だけをEへ変換しない|§2、VM.cpp:1036–1048|
|C0-N02|idleでentryScopeなし、終了要求だけ立ちexecutionForbidden=false|同時条件不成立。J2肯定を拒否。追加forbidで成立させない|§4 idle、controller.cpp:130–150|
|C0-N03|内側VMEntryScope destructorだけが終了し、最外entryScopeは残る|E不成立。内側戻りを最外退出としない|§2.1、VMEntryScopeInlines.h:42–46|
|C0-N04|whenIdle callbackが走ったが、exit servicesの残りやlistener再入の監査なし|一時的idleのみ。最終退出・永久再入禁止はUNKNOWN|§2.1、VM.cpp:1772–1806|
|C0-N05|EはWorker A、FはWorker B、txはWorker A。同じpointer数値が再利用|資料INCONSISTENTまたはUNBOUND。世代を結べずJ2/U-C UNKNOWN|§5.2|
|C0-N06|同じresource numberだがprocess/connection/VM incarnationが違う|同一対象として拒否。完全resource ID＋各generationが必要|§5.2、IDBResourceIdentifier.cpp:37–60|
|C0-N07|callback中Activeの過去ログだけを、callback復帰後C0の状態として使用|現在値UNKNOWN。deactivate/autoCommitがあり得る。状態持続を推定しない|§5.1、tx.cpp:1445–1462|
|C0-N08|m_state snapshotはあるがC0では対象が破棄済み、またはmapから消えて解決できない|現在Client状態UNKNOWN。map不在からFinished/破棄も推定しない|§5.2、database.cpp:422–445、proxy.cpp:399–410|
|C0-N09|runCleanupTasks内、shutdown task内、prepareForDestruction直前を観測しC0と命名|cleanup前C0として拒否。後段観測はW1前の代用不可|§1、runloop.cpp:244–245,363–374|
|C0-N10|生存ClientはCommitting。backend結果ログがないだけ|Client T1候補に限る。backendPending/U-C UNKNOWN|§5–6、共通A09/A11/A12|
|C0-N11|CommittingでdidCommitがm_commitResultへ保存済み。§5.1 Aの対象層・真正backend生成元・完全JS/native identity/incarnationと世代・同一tx/試行・明示的な真正結果≺C0・矛盾なしも確認済み|backendPending=FAIL。Client T1残存や配送欠落では変えない。保存だけ／Client生成errorのみは同BのUNKNOWN、不足・矛盾は同CのUNKNOWN。正常性・error理由は別に保持|§5.1 A〜C、§6、tx.cpp:568–570、下の出自別対照|
|C0-N12|scope生成前に停止しF=true、対象txは一度も作られていない|tx命題NOT_APPLICABLE。未終端tx中停止の成功例に数えない|§4、thread.cpp:160–165|
|C0-N13|C0より前に明示abort/request例外/server loss/suspension abortが確定|正常未終端として拒否。原因保持。Aborting/異常をFinishedでないことだけで正常化しない|§6、tx.cpp:1465–1470、server database.cpp:1294–1298|
|C0-N14|連番途中欠落、overflow、producer喪失、末尾seal/flush ackなし|資料INCOMPLETE、正常性・terminal陰性証明UNKNOWN。先行abort不在としない|§7、共通A21/A22|
|C0-N15|同threadでE/Fを読む間にlocator解決がcallbackやevent loopをpump|同時snapshotとして拒否。読取り間の再入を同threadという理由で排除しない|§2.3|
|C0-N16|E/Fの2回読取りが一致するが、その間にentry→exitのABA再入|一致だけでは再入不在UNKNOWN。直線区間とcoverageが必要|§2.3|
|C0-N17|同期load/module/debuggerのrunInModeがTerminatedを返したが外側JSが残る|内側待機終了をC0/J2としない。外側run到達とE/FはUNKNOWN|§4、runloop.cpp:248–260|
|C0-N18|module fetch待ちでkill→load=false→linkを省略。F未設定|同時条件不成立。module成功経路のforbidを失敗経路へ補間しない|§4、controller.cpp:433–439、WorkerThread.cpp:170–182|
|C0-N19|専用Worker C0の説明をmain runloopや別種Worker/commonVMへ流用|適用範囲外。別経路調査なしに肯定しない|§1/3、thread.cpp:285–293|
|C0-N20|対象はsuspend中だが停止扱いにし、stopのresumeを無視|suspend≠J2。再開経路・異常性・E/Fを別評価、正常U肯定不可|§4、thread.cpp:273–275,315–339|
|C0-N21|C0前に以前のprepare/stopActiveDOMObjects、または対象txのstop済み記録がある|「初回W1前」候補を拒否。今回shutdown由来abortとの先後だけで先行停止を消さない|§1/6、tx.cpp:338–349|
|C0-N22|C0後のdrainで別CleanupTaskが先に走り、module/native経由でJSに入り得るが未監査|drain entryより前という局所位置は維持。prepare W1まで再入なしはUNKNOWN|§2.3/3、runloop.cpp:402–406|
|C0-N23|Client/backendの同IDログを異source時計・配列・recorder到着順で整列|先後UNKNOWN。ID付きsend→receive/call/source順がない|§6–7、共通A20/A24|
|C0-N24|proxy mapを追加lockで止め、またはC0で同期flushしてから結果を照合|元の競合と同じ証拠としない。摂動UNKNOWN、追加停止処理禁止|§7、共通A26|
|C0-N25|同時点の生存ClientがFinished|Client T3だけ。正常未終端のClient条件には使わない。成功commit/JS complete/W3は別|§5.1、tx.cpp:502–508|
|C0-N26|E/F/C0/Client enumが将来取れたが配布build一致・全入口・backend cut・記録完全性が不足|J2実証/U/U-CはUNKNOWNのまま。実験NOT_RUN、承認NOT_GRANTED|§8–9、共通A27/A28|

## C0-N11の出自別静的対照（未観測）

判定は本文§5.1 A〜Cと共通。C1/C2/C3は同節が固定リンクで参照する先行P2研究の出自ラベルであり、本書の境界C0や親static-traceの段階番号とは別。下記4行はC0-N11の入力を分けた机上対照で、新しい反例ID・動的PASS件数ではない。

|仮定する証拠|backendPendingの期待判定|保持する理由・条件|
|---|---|---|
|真正C3の対象層・生成元producer/関数/分岐/resultが確認済み。完全JS/native identity/incarnationとWorker/VM/object/接続世代を同一tx/試行へjoinし、明示edgeで真正結果≺C0、矛盾なし（§5.1 A）|FAIL|BACK-N07/N13と同じ条件。Client Committing残存・結果配送欠落でもFAILを維持。結果errorならその理由も保持し、成功・正常性へ昇格しない|
|接続無効（m_serverConnectionIsValid=false）でClientがC1 serverConnectionLostErrorを生成。proxyで対象を解決してorigin threadへ配送し、tx.cpp:568の条件で保存。受信・保存≺C0も明示されるが真正backend結果は未確認（同B）|UNKNOWN|保存先・didCommit通知名・Client受信のcut前因果は真正結果の証明ではない。正常U-C候補に採用せずconnection-loss理由と異常のcut前後を保持|
|C2 server事前条件error/abortの受信・保存のみ、真正C3未確認（同B）|UNKNOWN|precondition/abort理由を保持し、正常U-C候補に採用しない。server由来というだけでは実backing-store結果にしない|
|出自・対象層・identity/incarnation・世代・同一tx/試行・結果とcutの明示edgeが不足／矛盾（同C）|UNKNOWN|不足・不正join・排他的出自の矛盾をINCOMPLETE／INCONSISTENTとして保持。cut後の真正結果だけでもPASSにしない|

固定ソースの分岐根拠は本文§5.1のconnectionToServer.cpp:357–377→proxy.cpp:399–410→tx.cpp:561–581。接続有効ならdelegateへ委譲するが、それだけでC3確定とはしない。接続無効時でも、proxyに対象があり、最後のoperationがmapに残る場合はClient errorの保存へ進み得るという**静的可能性**であり、この連鎖を動的観測した報告ではない。

## 肯定形の設計対照（未取得）

同じdedicated Worker/VM generationの外側C0で、対象threadと所有権・生存が確認され、非再入区間内のE/Fが揃い、正確なClient enumとJS/native完全joinがあり、E→C0→初回W1→同tx stopの実source/call記録と全入口coverage・recorder完全性が確立した場合に限り、**その範囲のJ2/Client cutを独立レビューする候補**となる。これは既存の肯定ログでも試験成功でもない。backend pending、元U、U-C、実行承認はさらに別。

## 引渡し時の保持値

反例はC0-N01–C0-N26の26行を維持し、C0-N11の出自別対照は別表4行。欠番・重複、リンクと固定版行範囲、契約blob不変、変更範囲を局所静的検査する。これは文書検査であり、26件の動的PASSではない。CI NOT_RUN、P2-01修正後の独立再レビュー待ち（今回の照合は自己検証）。

`overall=PARTIAL`、`J2=UNKNOWN`、`P1=BLOCKED`、`G1=PARTIAL`、`G2/G3/G4=UNKNOWN`、`H1–H3=UNKNOWN/H4=PARTIAL`、`conditionU=NOT_RUN`、`realExperiment=NOT_RUN`、`executionAuthorization=NOT_GRANTED`、`startCondition=BLOCKED`、`productionWorker=HOLD`。マージ・Draft解除・実験開始は行わない。
