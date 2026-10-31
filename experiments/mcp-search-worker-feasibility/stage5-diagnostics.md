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

診断コードのpushで限定workflowを1回実行。Linux証拠の保存追記では診断ソースを変更せず、再診断を要求しない。既存workflowは従来のpath条件で起動するため、コード提出時と証拠提出時の各結果を区別して報告する。成功待ち再実行はしない。

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

実行後に新規証拠indexと結果を追記する。診断の実施判定と、underlying試験のFAIL/PARTIALを分離する。
