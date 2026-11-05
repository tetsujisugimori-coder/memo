# C0安全capture監査の静的反例

**CAP-N01–CAP-N26の26行は机上の入力と期待判定。動的試験0、PASS件数ではない。**
2026-11-05 JST。Issue [#418](https://github.com/tetsujisugimori-coder/memo/issues/418)、親#411／#417。memo base `b39c861d3ec8f60298cad0d0525b1a92b9c53435`、先行#417 base `d5334839e07224981ea21c9ecc51b7f14d28db83`、WebKit固定commit `343e13bf22dca9d0ec227801419aab0f9001a32f`。

[共通観測契約v1](../u2-witness/common-observation-contract-v1.md) blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`を優先。[既存C0-N01–N26](precleanup-static-negatives.md)は変更・複製せず維持する。CAPのIDは今回のcapture/所有/閉包に関する別台帳。関連する既存反例を上書きしない。

S番号は[監査文書§8の固定path・関数・行範囲・blob索引](c0-entry-writer-ownership-audit.md#8-固定ソース索引)。[方式A〜Dと14判定軸](c0-safe-capture-design-comparison.md)と同じ条件を要求する。[事実]は分岐の存在、[推論]はその分岐と入力条件からの期待値、[未確認]は実行/全caller閉包の未取得。仮定したcallbackや再入が実C0 observerで観測済みとはしない。

## 1. 入力・期待判定・根拠・拒否する誤判定

Eの「true」は説明上、対象の最外実行終了候補を意味する。isEntered=falseだけで全frame不在を確定しない。条件不成立FAILと証拠不足UNKNOWNを分離する。例外・停止・server lossの理由はpending軸と別に残す。

|ID|入力となる前提|期待判定|固定ソースの事実と推論／未確認|拒否すべき誤判定|
|---|---|---|---|---|
|CAP-N01|idle、VM非entered、停止要求とqueue killのみ、F=falseでC0|E/F同時要件不成立。無条件snapshot案FAIL、実J2 UNKNOWN|S02 stop L280–309、S08初期false、S10 trapは遅延可。[推論]JSがtrapを処理しないidleではFを補完できない|停止要求/idleを再入禁止としてPASS|
|CAP-N02|module fetch待機中kill→runInMode=false→load失敗、link評価を省略、F=false|E/F要件不成立。無条件案FAIL、実J2 UNKNOWN|S04 L433–439とS44 L170–182、linkのforbidは通らない。[未確認]当該実行記録なし|module経路の別分岐のFを流用|
|CAP-N03|throwTerminationExceptionでF=trueだが最外frameはunwind中、entryScope残存|E要件不成立。F単独のJ2判定FAIL|S09 L1036–1048は設定時、S07はdestructorで最外解除。[推論]flagと退出完了を分離|F=trueから最外退出を確定|
|CAP-N04|tearDownSlowがentryScope=nullにした後、PopListenerがcallbackから再entryするという入力|NON_REENTRANT_CAPTURE UNKNOWN、単点非enteredではJ2不可|S06 L59–66→S09 L1784–1788。listener呼出しは[事実]、当該listenerの同VM再入は条件付き[推論]で実証なし|whenIdle/解除時点を永久停止ack|
|CAP-N05|当該stopより前に別CleanupTask/以前のprepare/stopが記録される|「初回W1前」の採用を拒否。先行W1確定なら当該W要件FAIL、単なる別cleanupだけなら初回W1はUNKNOWN|S01 L404–405で通常loopもcleanup実行可。S48 close L331–337は別cleanup producerで、これ自体をprepare済みとはしない|当該shutdown前という根拠で過去cleanup/W1を消す|
|CAP-N06|C0後drainの別CleanupTaskがnative callback/module経由の再入を起こし得るが、その本体は未監査|C0→当該drainの位置は保持。将来再入禁止/ENTRY_COVERAGE UNKNOWN|S01 L363–418はcleanupを通常gateなしでcall。[未確認]実JS到達・下層F gate。実在迂回を断定しない|queue kill/F flagだけで任意cleanupを無害化|
|CAP-N07|同threadでEとTを読む間、callback/property conversionを挟む|NON_REENTRANT_CAPTURE/E_F_SNAPSHOT UNKNOWN。単一cut採用拒否|S16 invokeCallback L111–139はproperty getとJS call。S20 request event L337–342。observerが呼ぶと仮定する反例|同threadという理由だけで値不変|
|CAP-N08|E前後は非entered、T前後はInactiveだが、中間にrequest eventがactivate→deactivate。autoCommit条件は満たさない|同値再読ではABA不在UNKNOWN。非再入snapshotとして拒否|S20 L337–342、S31 TransactionActivator L280–297、S32 L1445–1462,1534–1548。[推論]entryScopeもnull→entry→null可。F解除ABAは仮定しない|2回同値だから中間writerなし|
|CAP-N09|ordinary WeakPtr.getのrawだけを保存し、その後callbackが最後のownerを解放してからread|OBJECT_LIFETIME/OWNERSHIP_SAFETY UNKNOWN、raw使用案を受理しない|S42 get L130–142はstrong取得しない、S41 factory破棄でclear。[推論]rawは失効後に自動null化されない。IDB固有の最終owner経路は未証明|weak由来だからread中も生存保証|
|CAP-N10|生存確認→再入/別thread writer→破棄・再生成→同pointerを再解決。generation台帳なし|I不成立/未結合。SAME_VM/TRANSACTION_IDENTITY UNKNOWN|S02/S03生成・clear・破棄、S39数値生成はprocess世代でない。再利用は[仮定]で実観測なし|同pointerの生存確認を後の別世代へ延長|
|CAP-N11|Worker Aを破棄しWorker BのVM/objectへ同pointerが再利用され、E/FはB、TはAの過去値|不正join/INCONSISTENT理由保持、E/F/T/J2 UNKNOWN|S48 ctor/destructor L111–159、S03/S04所有。pointerだけはincarnation証拠にならない|別Worker同pointerを同VMとしてjoin|
|CAP-N12|resource番号は同じだがnative connection/backend process incarnationが別、JS/native対応なし|SAME_TRANSACTION_IDENTITY/backendPending UNKNOWN、join拒否|S39 L37–77はconnection＋resource、S59 L66–98、S60 L1870–1875。process再起動世代は別要求|同resource数値でbackend FAIL/PASS|
|CAP-N13|Tを読む前にtxが終端除去・破棄。過去snapshotとproxy map不在だけが残る|TRANSACTION_ENUM_CAPTURE at C0 UNKNOWN。明示的作成前停止だけNOT_APPLICABLE|S33 L422–445、S36 L399–410,590–598、S32 destructor L115–118。map不在は破棄/Finishedの代用でない|過去enumを現在へ延長／map不在=Finished|
|CAP-N14|observerがtx/VM/scopeの強RefをW1/W2以後まで保持して自然破棄を遅らせる|MEASUREMENT_PERTURBATION UNKNOWN。元競合と等価として採用しない|S02 destroy L199–224はscope.hasOneRefを前提。S04 destructor L95–105、S56 mapのRef。延命は[推論]として具体的差|強Refなら安全かつ無摂動と判定|
|CAP-N15|observerがproxy/VM/DBへ追加lockを入れ、または同期flush待ちでbackend進行順を固定|観測同等性UNKNOWN。今回の禁止方式として実施しない|S57 locksは別保護対象、S26 VM lock副作用。共通契約A26。[未確認]元競合との対応|lock追加で安定したから元のcutがPASS|
|CAP-N16|F=trueと一部event gateのみ確認し、Wasm/Inspector/native/derived realm入口は未監査|ENTRY_COVERAGE PARTIAL、全体UNKNOWN。J2へ昇格不可|S15、S24、S28/S29、S55。局所F検査なしは迂回実証とも言わない|flag値を全入口coverage PASSに変換|
|CAP-N17|Client Committingだが、真正C3の対象層/生成元・完全ID/世代・同一tx/試行・C3≺C0・無矛盾が揃う|backendPending FAIL。Client残存/配送欠落で覆さない。成功/正常性/errorは別保持|S62→S63 transaction->commit L1116からresult、S32 L568–570。P2 BACK-N07/N13と同じ条件|Committingや未配送からbackendPending PASS|
|CAP-N18|Client生成C1 serverConnectionLostErrorだけがdidCommitで保存。受信/保存≺C0でも真正C3未確認|backendPending UNKNOWN。connection-loss理由保持、正常U-C候補採用不可。C2のみも同じUNKNOWN|S38 L362–377→S36 L399–410→S32 L568–570。接続無効、対象map解決、last-operation残存が経路条件|m_commitResult/通知名/Client cut前受信を真正backend結果へ昇格|
|CAP-N19|真正C3とC0は別producerにありIDは合うが明示因果edgeなし。あるいは出自/identityが不足・矛盾|backendPending/J2/U-C UNKNOWN、INCOMPLETE/INCONSISTENT理由保持|S59/S60はIPCの静的伝搬のみで実edgeではない。P2 cut規則と共通A20/A24。clock/配列/到着順は禁止|同ID・近い時刻だけで結果≺C0と確定|
|CAP-N20|recorder連番途中欠落/overflow、producer再起動/喪失、末尾seal/checkpointなし|RECORDER_COMPLETENESS UNKNOWN、資料INCOMPLETE。矛盾があれば同時保持|共通A21/A22、監査§6。ソース上の分岐列挙は記録が届いた証拠ではない|未記録commit/abort/entryを非発生としてPASS|
|CAP-N21|C0 observerの最終JSLock解放でdefault queue drain/遅延解放の分岐に進む。対象Tへの別のcall chainは未確認|純粋性/非再入/寿命摂動はUNKNOWN。default queue内の実taskと遅延解放の影響を別途監査し、WebCore checkpoint残存だけでT変更を導かない|S26 L286–316→S66 VM::drainMicrotasks L1435–1464はdefault queue。通常WorkerのWebCore queue設定はS04 L661–666→S34 L383–397で別。F/delay/depth条件とqueue内容を区別|既存lockだから無作用／lock解放がIDB deactivateを自動実行するとする|
|CAP-N22|生存/ID lookupにglobalScopeWrapper()やJS変換を呼び、未初期化wrapperを生成|副作用なしの方式Aを拒否。MEASUREMENT_PERTURBATION UNKNOWN|S05 L73–76,116–120→S04 initScriptWithSubclass L627–671は構造体/Strong/proxy生成。S03 vmIfExists L95–98もscript null安全でない|getter/IfExistsという名前だけで無作用/null安全|
|CAP-N23|WorkerGlobalScopeのproxyがreplaceされ、既存txのdatabaseが保持する旧proxyと現在scopeのproxyを同じ接続としてjoin|I/connection join UNKNOWN、不正対応を保持|S48 L242–259のposted replace、S31 const Ref database、S56 const Ref proxy。実交替は未観測|同Workerの現在proxyを既存txのproxyと無条件同一視|
|CAP-N24|observerの確保/解放がGCやdelayed releaseを起こし、registry callbackはdeferred taskとして予約。C0後どの入口から処理されるか未監査|所有/寿命/非再入/将来禁止 UNKNOWN。GC即時の任意JS実行とは判定しない|S50 finalize L100–160→cleanup L165–174、S27 task/status gate、S51 native finalizer。S26 delayed releaseも別経路|GCが必ず即JSを実行すると断定／逆にGCだから一切再入なし|
|CAP-N25|dedicated WorkerでforEachActiveDOMObjectをweak解決に使い、ScriptDisallowedScopeが再入を止めると仮定する|この非再入保証の仮定はFAIL、capture全体はUNKNOWN。追加禁止assertや一時Refの効力は別評価|S34 L327–341→S64 ctor/destructor L40–57は非main threadならreturn。[事実]scopeはWorkerに禁止を設定しない。[未確認]当該走査からの実再入|scope名やコメントだけで全entry/全writerを排他したとする|
|CAP-N26|observerがE/T読取り間にWebCore EventLoop::performMicrotaskCheckpointを明示呼出し。F=false、checkpoint非実行中、group有効、対象txのdeactivate taskが残る|直線・非再入captureの条件不成立。この取得案を拒否、実snapshot/J2はUNKNOWN。deactivate後Tの変化/autoCommitは条件に応じ保持|S32 tx ctor L107–109→S13 EventLoop L592–599→S12 Microtasks L69–103→S32 L1455–1462,1534–1560。明示WebCore checkpointが入力でありCAP-N21のdefault queue drainと別|lock解放の効果と混同／checkpointを無作用のflushやreadと扱う|

## 2. 反証の閉じ方と受入条件

CAP-N01/02/03は固定コードの分岐から無条件成立案の必要条件不成立を指摘する。CAP-N04/06–16/19–24の多くは、observer未実装・呼出し閉包未取得という入力に対するUNKNOWNであり、実C0でのUAF/再入/JS迂回を発見済みと報告しない。弱参照の失効・pointer再利用は、その入力条件を満たしたときの推論である。

各反例を解消するには、対応する入口/writer/ownerの具体的閉包と対象build、同incarnationの実因果・完全性の肯定証拠を要求する。否定ログの不在、前後同値、同thread、lock所有、Client結果名、古いsnapshotは反証条件を満たさない。CAP-N17のFAILを解除するために配送欠落を使わず、CAP-N18のUNKNOWNをFAILにするためにClient受信のcut前因果を使わない。

初回HEAD `040478b5a95c2bd4912127d735b0f3e0ae16ec26`の独立P2-01により、CAP-N21のqueue混同を修正し、別入力CAP-N26を追加した。自己検査は26 IDの連番・重複なし、表の26行、根拠参照、リンク、既存26反例/契約無差分を確認する。独立レビューは別の固定HEADの反証結果としてPRへ記録し、自己検証と区別する。新規P1/P2はHOLD、修正後も独立再レビューまで閉鎖しない。

`J2=UNKNOWN / U-C=UNKNOWN / conditionU=NOT_RUN / realExperiment=NOT_RUN / executionAuthorization=NOT_GRANTED / startCondition=BLOCKED / productionWorker=HOLD`。CI/実験NOT_RUN。native hook/custom build、実ブラウザ/Worker/IDB/1ms、実メモ、OAuth/MCP/Tunnelサービス操作、lock/同期flush実測、Draft解除・マージは行わない。
