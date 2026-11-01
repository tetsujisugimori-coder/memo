# IndexedDB upgrade停止：独立接続ライフサイクル研究

Issue #396。既存#392/#393/#395、CI41244959121/41215047469を参照。基準commitは `f2168f194b326b0ce9ffb722e81aa47e42ce0d03`。本番Worker採用HOLD、マージ推奨NO、独立レビュー前の原因確定はしない。

## A 接続ライフサイクル対応表と静的調査

[事前登録計画と対応表](plan.md)、[全open検索結果](open-inventory.txt)。実行対象はmain fixture/snapshot/upgrade/late-openと各Workerのreadonly接続で、他の製品DB・台帳・旧診断入口を呼ばない。新規loopback originと新規contextのみを使う。

main fixtureは初期write transaction complete後にclose。snapshotはrequest成功後closeするがtransaction complete待ちではない。T7 Workerはreadonly request成功後の未解決await中にmainからterminateされ、通常のclose行へ到達しない。versionchange/例外ではcloseできるが、handler実行/通知配送が停止に先行したかは旧証拠ではUNKNOWN。upgrade成功接続は即close。open timeoutは要求取消ではなく、late successは既存handlerがcloseする。delete timeoutも要求取消ではない。

`close_called`は呼出し、`close_returned`は例外なし復帰。close pending flagや正常閉鎖完了を直接読んだ観測ではない。transaction complete/abortは個別観測、`connection_closed_abnormal_event`は異常閉鎖通知。内部資源解放は一律UNKNOWN。通常のclose event欠落を未閉鎖の証拠にしない。

## B 実験計画・実行版

WebKit A/B/C/D/E、Chromium A/Bを各1回、計7試行。上限8のうち残り1試行は未使用。条件、異常時停止、上限はplan.mdを参照。コマンド `node experiments/idb-upgrade-lifecycle/run.cjs`。静的検証 `node --test experiments/idb-upgrade-lifecycle/source.test.cjs` は5/5成功。ブラウザ試験ではない。

新規observer/source/controls/runと専用workflowを追加。原版suite/worker/cleanupは無変更。DはT7単独の既存start→unresolved→stop→upgradeを維持。Cはmainでreadonly request成功/close、EはWorkerのtransaction complete待ち/close/協調通知を加えるため、Dと同一条件ではない。計測sourceの逆変換で元source一致・構文成立を検査。

## C イベント時系列・証拠

各runId・dbName・owner・connectionId・requestId・iteration・versionをJSONで結合する。sourceMsはclockDomainが同じ場合だけ比較し、Worker/Node/mainの絶対値は減算しない。Workerイベントは追加messageによりmainへ集約するので、停止直前の未配送イベントは欠落し得る。観測による処理負荷と100ms heartbeatの影響はUNKNOWN。

既存handlerの上書きなし（addEventListener）。observerによる追加IDB操作なし。失敗時はNodeへのprecleanup JSON保存完了後に原版cleanupを1回だけ呼ぶ。保存が失敗した場合はdeleteを実行せず後続停止。closeまでの全証拠と生成source/差分/hashをartifactへ保存する。

## D 停止地点 / E 仮説対応 / F 比較結果

実測取得後に記載する。A〜GをOBSERVED/NOT_OBSERVED/UNKNOWN/NOT_APPLICABLEで分類する。NOT_OBSERVEDは観測窓の受信なし、UNKNOWNはWorker停止後の内部や公開APIで確認不能な状態。

旧証拠：CI41244959121、HEAD7b30786、runId0d4bd770-fdb2-431c-8444-73c3e55693c3、DB worker-poc-b61a85f0-8a98-44b4-93a6-9b6040827d20、iteration5、version5→6、8000ms timeout、cleanup UNKNOWN2000ms。原版primary CI41215047469はiteration8、version8→9、8001ms timeout、DB識別子未観測。旧証拠のgzip hashを確認し、異なるDB/条件を混同しない。

## G 残件 / H 安全性と本番判断

H1〜H3の区別は実測を待つ。陽性対照Bの接続保持/closeの直接因果を、そのままT7の原因に一般化しない。D/E比較は各1回の相関であり必要十分条件ではない。H3をWebKitバグと断定しない。

専用架空DB、実ユーザーDB/本番データ/実認証/8791/8792/Tunnelへアクセスなし。本番Worker統合なし、HOLD/マージ推奨NO、Draft維持。実装者の自己検証は独立レビューではない。
