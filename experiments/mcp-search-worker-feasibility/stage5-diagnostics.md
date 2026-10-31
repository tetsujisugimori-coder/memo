# Stage 5 残存FAILの限定診断

初期判定・本番判断: **総合PARTIAL / 本番Worker HOLD / マージ推奨NO**。
基準 `62a9287870375900066ba24b917ccf26561540e1`、tree `584bbfe881b4728d950ae4f45dbc2f55deafd7c7`。
親Issue #392、Draft #395、依存Draft #393。2026-11-01 JSTの開始時点もremote/localとも基準HEAD、Draft/MERGEABLE、追跡差分なし。既存未追跡証拠と別worktree変更を保護。

## 実行前に固定した計画

|診断|条件と回数|上限|
|---|---|---|
|A Windows期限|Node/Chromium/WebKitを順に実行。各4試行: original → instrumented → instrumented → original。各試行は既存reserve-delayedを前置し、reserve-late-duplicate-completionを実行。新規contextで独立。追加負荷／busy loopなし|要求60ms、観測160ms、試行全体3秒、launch30秒、close5秒、trace256件|
|B Windows入口確認|Chromium/WebKit各1回 observed-primary|原版T7最大12反復、open8秒、delete2秒、primary180秒|
|B Linux本比較|各engineでoriginal-primary → observed-primary → observed-completeを各1回。既存5条件の反復はしない|各条件新規browser/context。原版T7最大12反復、open8秒、delete2秒、primary180秒、close5秒、CI15分|
|既存回帰|Node58件、Windowsの既存期限19件/engineとStage5実台帳3シナリオ/engineを各1回|既存assert・上限不変更|

original-primaryはsuite/worker/cleanupの配信ソースそのまま。observed-primaryはIDB呼出しとイベントを追加観測する診断コピー。observed-completeはそれに「T7 unresolved通知前に既存transactionDoneのcompleteを待つ」だけを追加。明示closeは追加しない。全条件で本来のcleanupを実行し、cleanup UNKNOWNをPASSに変えない。別名DBによる回復プローブや台帳消去は追加しない。

T7は旧studyの管理参照上限2・最大12反復をそのまま使用し、生成済み枠の回収可能性の証明には使わない。共有recovery modelの生成予算2は別契約で不変更。A対象ケースのWorker生成は0が期待値。原版・新規計測とも実ユーザーDBやサービスへ接続しない。

診断コードのpushで限定workflowを1回実行。Linux証拠の保存追記では診断ソースを変更せず、再診断を要求しない。初回はpull_requestで起動したが、そのpath判定はPR全体の差分を見るため、証拠追記でも再起動する。固定回数を守るため、専用workflowだけを対象branchへの診断4ソース変更pushに限定した（[GitHub仕様](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#git-diff-comparisons)）。既存workflowは不変更で、コード提出時と証拠提出時の各結果を区別して報告する。初回FAILを消さず、成功待ち再実行はしない。

## 既存証拠から確定していること

Windows WebKitの202ms記録は原始gzipのSHA-256を照合済み。request.deadline=566、responseAt=708（同一ブラウザ単調時計）なので、settleCaller内の応答時刻記録自体が142ms遅い。テストのPromise観測だけが遅れたという説明では足りない。ただし旧証拠にはtimer登録／callback開始がなく、callback遅延とcallback内部の遅延は分類不能。

Linux run41200491122のprimaryはopen開始127ms→timeout8127ms、delete開始8128ms→timeout10128ms（同一main時計）。Worker transaction終端と接続解放は停止時UNKNOWN。complete-close条件ではtransaction_completeを受信してもupgrade失敗。別名DBの成功は失敗DBの解放証明ではない。過去のiteration10、単独T7失敗も保持する。

## 観測と判定の意味

Aは既存model/casesのメモリ上のコピーに、受付・deadline設定・timer登録/予定時刻/callback開始・settleCaller・resolve呼出し/戻り・caller側Promise reaction・テスト側観測・台帳操作開始/完了・owned終了を追加する。原本は不変更。resolver呼出しはPromise内部状態の直接観測ではなく、reactionと別イベントにする。Node/controllerとブラウザの絶対時計を減算しない。各realmの経過時間とtrialIdによる順序を保存する。

Bのobserverはnative IDB APIに追加listenerを登録するだけで、abort/close/delete/retry/データ読取/書込みを起動しない。close等は元fixtureが要求した呼出しをそのまま通す。DB名、realm/Worker ID、request/connection/transaction IDを記録する。元suiteの停止要求/terminate戻りと診断側のbrowser/context close開始/戻りを併記する。原版controlにDB名が出ない場合はUNOBSERVEDとし、計測版とのDB同一性を推定しない。

Worker診断messageは専用タグで元suiteの結果配送から分離する。停止前に送ったmessageでも受信前にterminateで失われ得る。未受信イベントはUNOBSERVEDであり、発火しなかったことの証明ではない。close正常戻り・context/browser close正常戻りは物理解放UNKNOWN。

計測は追加performance.now、配列記録、listener、Worker messageを伴い、停止やIDBのタイミングを変え得る。原版と計測版の結果の差自体を保存し、成功差から原因解消を主張しない。元suiteは失敗でT8〜T12がNOT_RUNならそのまま保持する。

仮説A(期限): timer dispatch / callback→resolve / resolve→testを別区間で示す。T7仮説: transaction競合、接続未解放、closeと解放の差、通知遅延はそれぞれSUPPORTED/CONTRADICTED/UNKNOWNを限定した命題に対して記録する。event未観測を原因確定に使わない。

already_absentの正常返却証明との混同は別P3候補として保持し、今回台帳設計は変更しない。本番配送所有権・最終認可・OS資源・台帳消失/rollbackは引き続きHOLD。

## 結果

限定診断の実施・記録はPASS、**総合PARTIAL、本番Worker HOLD、マージNO**。因果は未確定。新規証拠は [Windows index](evidence/stage5-diagnostics/windows-index.json)、[Linux・回帰index](evidence/stage5-diagnostics/linux-index.json)。JSON/logはgzip、生データとgzipのSHA-256を併記し、元のrawもローカルで保持。原始証拠の上書きなし。

### A：Windows期限（固定4試行、202ms未再現）

|環境|original 1|instrumented 2|instrumented 3|original 4|計測版timer遅延 / callback→resolve / resolve→test|
|---|---:|---:|---:|---:|---|
|Node 24.20.0|61.798ms|62.248ms|62.977ms|62.185ms|2.123 / 0.055 / 0.059ms、2.806 / 0.073 / 0.073ms|
|Windows Chromium 151.0.7922.34|64.9ms|67.5ms|74.3ms|62.9ms|7.4 / 0 / 0ms、14.3 / 0 / 0ms|
|Windows WebKit 26.5|62ms|61ms|61ms|62ms|1 / 0 / 0ms、1 / 0 / 0ms|

0msは各時計の分解能内という意味。Node/ブラウザの絶対時刻を減算していない。各realm内の差と、controllerのinvoke→returned経過時間は別欄に保存。全対象試行でtimeout、Worker生成0、生成前予約返却1、旧結果配送なし、最終FAILED_CLOSED。台帳操作pending→settled、owned終了を時系列で確認した。

原版と計測版の両方が160ms未満だったが、4試行だけで202msの原因解消は言えない。今回の順次実行・新規context・前置ケースという条件以外のOS負荷や背景状態は操作／計測していない。既存202msのFAILと、そのときの応答記録自体が142ms遅い事実を保持する。

|仮説|今回の分類|根拠・限界|
|---|---|---|
|A timer callback開始が遅れた|202ms事象の原因はUNKNOWN。今回の1〜14.3ms遅延区間はSUPPORTED|新規traceでは予定時刻とcallback開始を観測。旧202msにはcallback時刻がない|
|B callback後、caller解決までが遅れた|旧事象はUNKNOWN|新規traceでは最大約0.073ms。未再現の旧事象には外挿しない|
|C callerは期限内に解決し、テスト観測だけが遅れた|旧事象の単独説明としてCONTRADICTED|旧responseAtがdeadlineより142ms遅い。Node通信・観測の追加遅延の有無はUNKNOWN|

### B：Linux T7（固定3条件×2engine）

診断run [41215047469](https://github.com/tetsujisugimori-coder/memo/actions/runs/41215047469)。PR HEAD `ab0ada7ced033bfd04e16613e7be7551ec6acc07`、CI実checkout `30510b2c12cd01ca9212e71937548d923987b94b`、両者tree `ac8af7385d7eabbc16c20515440f876f5e8d3d3a` 一致、clean。最終証拠追記後も診断4ソースは同一。Windowsの実行は基準HEADの上に新規未追跡診断ソースを置いたものなので、metadata.dirty=falseだけで「診断が基準commitに存在した」と読まないこと。各source hashで実行内容を特定する。

|条件|Linux Chromium|Linux WebKit|
|---|---|---|
|original-primary|12反復完了、T7 PARTIAL、cleanup PASS|**iteration8 upgrade timeout**、8001ms、blocked未観測、cleanup UNKNOWN(2000ms)、T8〜T12 NOT_RUN|
|observed-primary|12反復、T7 PARTIAL、cleanup PASS|12反復、T7 PARTIAL、cleanup PASS(delete blocked→success)|
|observed-complete|12反復、T7 PARTIAL、cleanup PASS|12反復、T7 PARTIAL、cleanup PASS(delete blocked→success)|

WebKit原版の成功iteration1〜7も停止時transaction終端はUNKNOWN。iteration8はmain timeline seq271 open_start→seq272 open_timeout_or_errorであり、その間のupgradeneeded/blocked/success/errorは未観測。open要求後に上記イベントを受信しないまま期限へ達したことまでを観測した。DB内部の状態や待ち理由は不明。cleanupでもsuccess/error/blockedが来ずUNKNOWN。停止・browser/context closeは正常に戻ったが、物理解放は全条件UNKNOWN。

計測primaryのT7全12回もtransaction終端はUNKNOWNのままupgrade成功（0〜1ms）。complete待ち版は全12回transaction_completeを確認してから停止し成功（0〜1ms）。従って「終端未観測なら常にupgrade失敗」はCONTRADICTED。一方、待ち追加なしの計測primaryも成功しているので、complete待ちを解決策として推奨できない。

計測版ではDB名・connection/request/transaction IDを保存（WebKit各350/363イベント）。失敗した原版controlは元sourceがDB名・connection IDを出さないため**UNOBSERVED**。成功した計測版の別DB IDを、失敗DBの解放や原因へ結び付けない。計測によるイベント数・順序・タイミングの変化、条件順固定、各1回という制限があり、原版FAIL→計測版PARTIALの差は因果証明ではない。

|T7仮説|分類|理由|
|---|---|---|
|A transaction完了とupgradeの競合が根因|UNKNOWN|未観測の成功例があり、過去にはcomplete-closeでも失敗。単独原因とは断定不可|
|B Worker DB接続の未解放が根因|UNKNOWN|停止後のWorker内部接続を直接観測できない。未受信messageは解放有無の証明ではない|
|C close戻りと実解放の時間差が根因|UNKNOWN|close呼出し／戻りは記録したが物理解放を測っていない。close戻りだけで安全認定できないという制限は維持|
|D WebKitの通知／スケジューリング遅延が根因|UNKNOWN|原版のcallback不在は観測したが内部原因不明。計測条件での成功だけでは証明不可|
|E 上記のどれとも断定できない|SUPPORTED（現時点の判定）|失敗条件での接続・transaction・通知の完全な因果列が不足|

Windows入口確認は各1条件、350件超のIDBイベント収集とcontext/browser close戻りを確認。Linux各engine3条件と混同しない。正常suiteは29 Worker生成・終了要求、管理参照の最大同時2。これは旧T7の固定fixtureの値であり、生成済み枠を回収できる証拠ではない。失敗したLinux原版WebKitは生成16・終了要求16で後続NOT_RUN。

### 回帰・保全・CI

今回のローカル回帰はNode58/58、既存期限19/19×2、Stage5実台帳3/3×2。診断A対象12試行＋前置12実行、Windows T7入口2条件、Linux T7比較6条件は別計数。対象外の全テスト追加実行はしていない。

保護対象23 source（製品・認可・保存・model・台帳・既存試験・原版T7等）の正規化SHA-256一致、既存証拠72ファイルのGit blob一致を確認。モデル、共有台帳、原版T7、既存assert/timeoutへのdiffなし。実台帳回帰の架空notes/metadata snapshot/hashは両engineで一致、readwrite=0。観測T7のreadwriteはmainのfixture初期化1回、Workerは0。失敗した原版T7のT8保存比較はNOT_RUNであり、不変PASSにしていない。実ユーザー保存のhashはNOT_TESTED、実OAuth/サービス/Tunnel/ChatGPTは未使用。

初回提出HEADの既存CI: [Stage5 41215047404](https://github.com/tetsujisugimori-coder/memo/actions/runs/41215047404) はboundary両engine成功・T7 WebKit失敗。[旧Stage3 41215047403](https://github.com/tetsujisugimori-coder/memo/actions/runs/41215047403) 成功。[単独T7 41215047549](https://github.com/tetsujisugimori-coder/memo/actions/runs/41215047549) はWebKit iteration6 upgrade timeout/cleanup UNKNOWNで失敗。[旧PoC 41215047431](https://github.com/tetsujisugimori-coder/memo/actions/runs/41215047431) はWebKit control-Bのupgrade timeout/cleanup UNKNOWNで失敗（そのrunのprimary自体は完了）。成功を別条件のFAILの相殺に使わない。証拠追記後の最終CIと最終HEADはPRコメントに追記する。

次の1工程は本診断の独立レビュー。原版と計測版の差、失敗時のDB identity未観測、時計分解能、Worker message喪失の限界を審査し、次の最小計測を決める。本番の配送所有権・最終認可・共有owner・台帳消失対策・資源解放証明が不足しており、本番統合はHOLD。
