# IndexedDB upgrade停止：独立接続ライフサイクル研究

Issue #396。既存#392/#393/#395、CI41244959121/41215047469を参照。基準commitは `f2168f194b326b0ce9ffb722e81aa47e42ce0d03`。本番Worker採用HOLD、マージ推奨NO、独立レビュー前の原因確定はしない。

## A 接続ライフサイクル対応表と静的調査

[事前登録計画と対応表](plan.md)、[全open検索結果](open-inventory.txt)。実行対象はmain fixture/snapshot/upgrade/late-openと各Workerのreadonly接続で、他の製品DB・台帳・旧診断入口を呼ばない。新規loopback originと新規contextのみを使う。

補足の製品側静的確認：`app.js/openDb`→`indexeddb-lifecycle.js/openManagedDatabase`が製品DBをopenし、アプリのdb参照で保持する。versionchange時はcallback後finallyでdatabase.closeする。これも正常閉鎖完了・物理解放を通知する設計ではない。ただし診断pageはapp.jsも製品lifecycleも読み込まず、製品DBへの因果を本研究から外挿しない。dummy-preview/web-clipper E2Eにもopenがあるが今回は実行しない。

旧診断はcontrols.jsのfixture open1/upgrade2とworker.js、diagnostic.jsのfixture/upgradeとdiagnostic-worker.jsが別DBを使用する。旧control close-modeはtransaction完了待ち、unresolved-modeは待機、旧diagnostic Aはtx complete後close/Bはrequest成功後busy gate/Cはcomplete後closeなしであり、今回のA〜Eとは名称/意味が異なる。shared-ledgerはopen1初期化とopen現在版→transaction処理のfinallyでclose（独自期限超過でもfinallyへ進み得る）、shutdown-browserは専用fixture open/read/complete後closeの別経路。これらを今回の実測に含めない。[製品・E2Eも含む補足open検索](evidence/expanded-open-inventory.txt)は静的参照のみ。

main fixtureは初期write transaction complete後にclose。snapshotはrequest成功後closeするがtransaction complete待ちではない。T7 Workerはreadonly request成功後の未解決await中にmainからterminateされ、通常のclose行へ到達しない。versionchange/例外ではcloseできるが、handler実行/通知配送が停止に先行したかは旧証拠ではUNKNOWN。upgrade成功接続は即close。open timeoutは要求取消ではなく、late successは既存handlerがcloseする。delete timeoutも要求取消ではない。

`close_called`は呼出し、`close_returned`は例外なし復帰。close pending flagや正常閉鎖完了を直接読んだ観測ではない。transaction complete/abortは個別観測、`connection_closed_abnormal_event`は異常閉鎖通知。内部資源解放は一律UNKNOWN。通常のclose event欠落を未閉鎖の証拠にしない。

## B 実験計画・実行版

WebKit A/B/C/D/E、Chromium A/Bを各1回、計7試行。上限8のうち残り1試行は未使用。条件、異常時停止、上限はplan.mdを参照。コマンド `node experiments/idb-upgrade-lifecycle/run.cjs`。静的検証 `node --test experiments/idb-upgrade-lifecycle/source.test.cjs` は5/5成功。ブラウザ試験ではない。

新規observer/source/controls/runと専用workflowを追加。原版suite/worker/cleanupは無変更。DはT7単独の既存start→unresolved→stop→upgradeを維持。Cはmainでreadonly request成功/close、EはWorkerのtransaction complete待ち/close/協調通知を加えるため、Dと同一条件ではない。計測sourceの逆変換で元source一致・構文成立を検査。

## C イベント時系列・証拠

各runId・dbName・owner・connectionId・requestId・iteration・versionをJSONで結合する。sourceMsはclockDomainが同じ場合だけ比較し、Worker/Node/mainの絶対値は減算しない。Workerイベントは追加messageによりmainへ集約するので、停止直前の未配送イベントは欠落し得る。観測による処理負荷と100ms heartbeatの影響はUNKNOWN。

既存handlerの上書きなし（addEventListener）。observerによる追加IDB操作なし。失敗時はNodeへのprecleanup JSON保存完了後に原版cleanupを1回だけ呼ぶ。保存が失敗した場合はdeleteを実行せず後続停止。closeまでの全証拠と生成source/差分/hashをartifactへ保存する。

## D 停止地点 / E 仮説対応 / F 比較結果

**総合判定 PARTIAL。原因個別判定 H1 UNKNOWN / H2 UNKNOWN（関連を示す相関あり）/ H3 UNKNOWN / H4 PARTIAL（観測不足による区別不能を実証）**。完了条件4に該当する。研究手順と対照成立を確認できたが、T7の単一根本原因は確定しない。T7/専用CIはFAILを維持する。

### 実行版と範囲

[CI41299732744](https://github.com/tetsujisugimori-coder/memo/actions/runs/41299732744)、job124828001118、[artifact13081135264](https://github.com/tetsujisugimori-coder/memo/actions/runs/41299732744/artifacts/13081135264)。実行HEAD `53445474028601131136e2bc540ee48aee83cd7a`、tree `0a9f3bf1d88c035a33ed46efbda4e79207aa378e`、clean、Linux、Node v22.23.4。WebKit26.5 / Chromium151.0.7922.34。専用push CIのみ起動。新規Draft PR #397は#393ブランチ宛、#395は関連研究でコード依存なし。

7条件を各1回、7/8試行実行。計画7条件のNOT_RUNは0、未使用枠1、同一条件再試行0。C/Eは各12反復、Dは2反復目で失敗し3〜12はNOT_RUN。全試行でprecleanup保存成立、pageerror0、overflowなし、context/browser close RETURNED（資源解放UNKNOWN）。大規模検索E2E・保存テストは実施しない。CIの局所検証は5/5成功、実験ステップはDの既存型失敗を保持して非zero。

|環境/条件|runId|専用DB識別子|upgrade結果|cleanup|
|---|---|---|---|---|
|WebKit A|931b521f-c38c-4999-ac06-6018ec702f16|idb-lifecycle-0f99b403-d16a-4096-bcdb-28a7cc781c0f|version1→2成功、1ms|PASS|
|WebKit B|3bd31398-ab83-40f7-9d1a-eb04f78fd899|idb-lifecycle-c86d6cfb-12b0-44ca-9c29-5ab510be9ed4|旧接続close後、同じmain/r2成功|PASS|
|WebKit C|c93acf92-b955-428f-99e6-cd6cf5671dd2|worker-poc-3eccaf66-deb9-45f1-ad7d-85a62e850276|12反復成功、各0〜1ms、T7 PARTIAL|PASS|
|WebKit D|eec76e89-5f10-45d0-8830-8dcb3ddf2110|worker-poc-d12d5caa-4a7d-4223-81c0-0a6cd77a1f74|1成功3ms、**2でversion2→3 timeout8000ms**、T7 FAIL|**UNKNOWN**、2000ms設定/2001ms実測|
|WebKit E|e22b6648-7957-44f7-bb08-a902f835d763|worker-poc-8de8fd09-68f4-436d-8c65-0297dd6436cf|complete→close→協調通知を12回受信、12upgrade成功、T7 PARTIAL|PASS|
|Chromium A|df55a748-0e2a-43a3-ac40-0a939ad07a29|idb-lifecycle-23e63935-534b-4c9d-a374-84dff5efdc50|version1→2成功、約0.5ms|PASS|
|Chromium B|f5aa38f8-7bf9-4bae-b48c-3917c827efaf|idb-lifecycle-8a35223f-f119-42cf-a50a-1a31b339b2ed|旧接続close後、同じmain/r2成功|PASS|

### 接続と停止地点

[全65接続の対応表](evidence/connections.md)、[全30upgradeの段階表](evidence/stages.md)、[機械可読分析](evidence/analysis.json)。表中の生成・最終イベント時刻は各ownerのsourceMsで、最後の接続ID付き受信であり実際の最終利用/解放時刻ではない。Worker getAll成功はowner/元requestIdで別に対応付ける。

失敗Dのmain接続：c1 fixtureはwrite complete33ms→close戻り33ms、c2 snapshotはclose戻り34ms→readonly complete35ms、c3 iteration1 upgradeはcomplete/close戻り52ms。**把握したmain接続ではclose呼出し・transaction completeが全て観測された**。しかし正常閉鎖完了は直接観測できない。

Dのworker-1/c1はversion1、worker-2/c1はversion2、readonly getAll成功とunresolvedを受信。両Workerのtransaction complete/abort、close_called/returned、versionchangeはNOT_OBSERVED、実際の終了状態はUNKNOWN。停止後に生成されたイベント、生成済みだが未配送のmessageが失われた可能性を分離できない。

失敗要求 `main/r4` はmain clock60ms、受信seq52に発行し、8060ms、seq130でtimeout。主な段階：

|段階|分類|根拠と限界|
|---|---|---|
|A open要求発行|OBSERVED|main/r4、version3、seq52。内部処理受付/進行は別|
|B 既存接続へのversionchange|NOT_OBSERVED|main/Worker受信なし。Worker側実行自体はUNKNOWN|
|C 旧接続のclose要求|main3接続 OBSERVED / Worker2接続 NOT_OBSERVED|閉鎖状態は全てUNKNOWN|
|D blocked|NOT_OBSERVED|main/r4の観測窓に通知なし。残留なしとは推論しない|
|E upgradeneeded|NOT_OBSERVED|公開APIでupgrade transactionを取得できず|
|F upgrade transaction終端|UNKNOWN|transactionが公開されないため内部の開始/完了を区別できない|
|G open success/error|NOT_OBSERVED|8000ms内の終端通知なし|

同じmain時計で待機中にheartbeatを**77回**（108〜7989ms）観測した。mainのタイマー処理は進行していたがIDB内部正常の証明ではない。待機中のWorker応答はNOT_OBSERVEDで、停止要求後の無応答から物理停止を推定しない。Workerなし条件のWorker停止/応答はNOT_APPLICABLE。

失敗時seq130までの証拠をNodeへ保存した後、既存cleanupを1回開始（main8101ms、seq132）。追加open/回復操作はなし。cleanup末尾はmain10101ms、seq152でUNKNOWN。2000ms設定のelapsed実測2001msはdeadline延長ではない。

### 対照と仮説

|仮説|判定|支持する観測|反証・不足|
|---|---|---|---|
|H1 接続残留がT7停止原因|UNKNOWN|Bは両engineで特定旧接続がversionchange/blockedを生じ、close後に同一要求が進行。対照内の直接介入証拠|T7で残留接続を特定してclose→同一要求再開した証拠はない。Bの因果をT7に一般化不可|
|H2 Worker/transaction終了経路の関与|UNKNOWN、優先調査候補|Dは失敗、complete待ち+close+協調通知を加えたEとWorkerなしCは12成功|Dの未完了そのものは観測できず、Dの成功iteration1でも終端/close未受信。Eは複数条件とタイミングが変わり各1試行。終了不完全が必要十分とはいえない|
|H3 終了条件以降のIDB内部/通知停滞|UNKNOWN|Dはmainのclose/tx complete成立後、open発行→upgradeneeded未受信の区間で停滞。main heartbeat継続|Worker終了条件はUNKNOWN、Eでは停止しなかった。全終了条件成立後の停止を示しておらずH3の強い支持条件未達。WebKitバグ確定不可|
|H4 その他/複合/観測不足|PARTIAL（区別不能の範囲を特定）|公開APIの正常close完了非公開、terminate後のWorker通信欠落、各条件1回の計測/時間差を記録|H4自体を単一の原因名として扱わない|

BのWebKit時系列はseq7 upgrade main/r2→seq8 c1 versionchange→seq9 blocked→seq10/11 c1 close呼出/戻り→seq14 upgradeneeded→seq15 upgrade tx complete→seq16同一r2成功。全てmain23ms内なので0msを即時解放とは解釈しない。Chromiumも同順序で、versionchange25.0→blocked25.1→close25.3→upgradeneeded25.7→complete/success26.0ms。両対照で機構が成立したが、T7のblocked欠落による除外診断はしない。

Cはmain realmでread/closeするためDからWorker終了だけを数学的に1変数除去した試験ではない。Eはcomplete待ちとcloseと追加messageを同時変更した。Dの失敗/Eの成功は終了経路と失敗の**相関**で、close単独・transaction単独・終了待ち時間の因果を分離していない。Eの12回は同一試行の反復で、独立12試行ではない。

### 証拠保全と限界

`evidence/index.json`に19原始ファイルの展開後SHA-256/gzip SHA-256、12実行sourceのGit blobとのhash一致、生成6sourceのhash一致を記録。results、7precleanup、生成suite/Workerと差分、job log、CI metadataを圧縮保存。JSONはartifact内容を無変更圧縮、job log/CIテキストはPowerShell UTF8 BOM/host改行を含む保存後hash。全gzip可読・前工程の保存hash一致・原版source差分なしを確認。context-harnessは実行時hash採取対象外だがclean checkoutのcommit/treeで参照版を確定できる。

生成sourceの計測差分はmain/Workerのイベント受信、iteration/runId連携、追加listener、失敗証拠保存、100ms heartbeat。原版timeout8000ms/cleanup2000ms、T7 DのDB操作順序は不変更。計測はWorker message数、listener実行順、スケジュール、cleanup開始時刻を変える可能性がある。特に保存awaitは失敗後/cleanup前のみに入る。未計測Dの同時比較や8番目の追加実験は行っていない。

旧証拠：CI41244959121、HEAD7b30786、runId0d4bd770-fdb2-431c-8444-73c3e55693c3、DB worker-poc-b61a85f0-8a98-44b4-93a6-9b6040827d20、iteration5、version5→6、8000ms timeout、cleanup UNKNOWN2000ms。原版primary CI41215047469はiteration8、version8→9、8001ms timeout、DB識別子未観測。旧証拠のgzip hashを確認し、異なるDB/条件を混同しない。

## G 残件 / H 安全性と本番判断

最有力と断定できる単一原因はない。次の調査候補はH1/H2のWorker接続・transaction終了境界だが、H3は除外できない。次の最小工程は本HEADの独立レビューで、(1)D成功iteration1と失敗iteration2の同じ終端欠落、(2)Eの複数変更と計測影響、(3)正常close非公開とWorker配送消失、(4)Bの直接因果の適用範囲、を確認すること。

追加ブラウザ試行は今回0回。レビュー後の別工程なら、transaction完了待ちのみを追加し明示closeしない条件を1試行に事前登録する案が最小候補。既存D/Eと比較しても計測/スケジュール差は残るため、その成功だけで原因確定はしない。現在の8試行上限を勝手に増やさず、本工程は7試行で終了する。

専用架空DB、実ユーザーDB/本番データ/実認証/8791/8792/Tunnelへアクセスなし。本番Worker統合なし、HOLD/マージ推奨NO、Draft維持。実装者の自己検証は独立レビューではない。

差分要約：新規研究folder（observer/source/controls/runner、局所検証、計画/報告/静的検索表/証拠）と専用workflowのみ。既存suite/Worker/cleanup、製品の検索/認可/保存、過去証拠と他worktreeの作業は不変更。

記録日時：2026-11-01 20:02 JST。
