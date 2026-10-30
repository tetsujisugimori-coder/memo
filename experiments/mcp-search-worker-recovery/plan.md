# Issue #391: T7 有限追加診断（実行前計画）

2026-10-30 JST。PR #390 の既存 A/B/C × 詳細・最小の6条件は再実行しない。既存 primary T7 FAIL と cleanup UNKNOWN を上書きしない。本番採用は HOLD。実メモ・実資格情報・本番DB・8791/8792/Tunnelは操作しない。

## 固定順序と差分

各エンジン Chromium / Linux WebKit で以下を各1回。成功するまで再試行しない。`WORKER_POC_BROWSER=chromium node experiments/mcp-search-worker-recovery/t7-run.cjs` と同じコマンドの `webkit` を使用する。

1. **original-primary**: 既存 `suite.js` の `runWorkerStudy()` を変更せず実行。T1〜T6 の先行操作、T7 の最大12反復、後続試験、既存削除観測を維持。正常終了でも内部状態の PARTIAL/HOLD があるため trial 自体も PARTIAL。CI終了コード0を本番採用PASSと扱わない。
2. **t7-only**: 別 `browser.launch()`、別 context、UUID付き架空DBで notes/metadata 2 store と既存同値fixtureを初期化。原版 `worker.js` の `unresolved` モードを1回使用し、境界message後terminate、version 1→2 upgrade、削除を観測。T1〜T6 と事前snapshot・T7反復を省くため、primaryと同等ではない。単発成功は前段処理・反復・snapshotのどれが原因かを特定しない。

第三の最小message条件は今回実施しない。既存A/B/Cの最小計測証拠を参照し、原版primaryについては未検証と残す。

## 上限と停止条件

open/Worker境界/fixture transaction 8秒、削除2秒は延長しない。browser launch 30秒、context/page/navigation各8秒、primary180秒、T7-only30秒、browser close2秒、partial取得0.5秒、server開始/終了各2秒。各項目に独立期限があり、合計は概ね340秒以内（外部実行環境・ファイルI/Oは別）。browser生成要求は最大2回。前browser closeが戻らない、又はlaunch未確認の場合、後続をNOT_RUNとして停止する。遅いlaunch戻りにはcloseを要求するが、解放成功を保証しない。

primary失敗でもbrowser closeが戻れば、独立起動のT7-onlyを予定どおり1回実行する。close戻りはOS/DB資源解放の証明ではない。timeoutとなった要求の後続イベントはlateとして観測し、成功に置換しない。T7-onlyでは期限後upgrade transactionをabortして遅延した試験操作の拡張を防ぐ（原版primaryは変更しない）。

## 証拠と判定

実HEAD/tree、原版HTML/JSとrunnerのSHA-256、エンジン版、OS、開始終了日時、各起動/終了要求、pageerror、元primary全文、T7-onlyのmain/workerイベント、cleanupを排他的UUID JSONとして `e2e-artifacts/mcp-worker-recovery/` に保存する。未コミット実行はHEADだけで同一ソースとしない。mainとWorkerの時計原点を比較しない。

T7-only PASS は当該fixtureのupgradeとdelete success観測のみ。transaction終端/接続終了は観測したときのみ更新し、それ以外UNKNOWN。primaryの試験別FAIL/PARTIAL/HOLD/NOT_RUNを保持する。未知の資源解放、実メモ検索、OAuth、実機iPhone、OS背景制御を成功扱いしない。

ブラウザ起動不能は環境制約でUNKNOWN。原因未特定でも追加診断を増やさず、安全側停止・上限付きsupervisorの独立成果へ進む。
