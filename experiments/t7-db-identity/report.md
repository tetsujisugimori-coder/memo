# T7失敗DB識別子の最小観測（Issue #392 / Draft PR #393）

本番Worker採用 HOLD、マージ推奨 NO。原因修正・本番統合は対象外。

## 原版失敗証拠

原版失敗DB識別子：**未観測**。過去のランダム値は推測しない。

- [CI 41215047469](https://github.com/tetsujisugimori-coder/memo/actions/runs/41215047469)、WebKit job 124577732988、[artifact 13046889601](https://github.com/tetsujisugimori-coder/memo/actions/runs/41215047469/artifacts/13046889601)。原始JSONとjob logを `evidence/` にgzip保存し、展開後SHA-256を `original-index.json` に記録。
- PR #395診断提出HEAD `ab0ada7ced033bfd04e16613e7be7551ec6acc07`、実checkout `30510b2c12cd01ca9212e71937548d923987b94b`、tree `ac8af7385d7eabbc16c20515440f876f5e8d3d3a`、Linux WebKit 26.5。
- `original-primary` のT7 iteration 8、version 8→9、open seq271 mainMs163→timeout seq272 mainMs8164（8001ms）。blocked未観測。cleanup UNKNOWN、terminal timeout、2000ms。T8〜T12 NOT_RUN。
- 原版trialにはDB識別子がない。計測primary/completeの別DBと混同しない。既存報告は [PR #395コメント](https://github.com/tetsujisugimori-coder/memo/pull/395#issuecomment-6545605622)を参照。

## 今回の計測と事前上限

基準は#393のリモートHEAD `06796f70f1a42b829ba6c4a2b7e962409aca20e6`。元のworktreeはHEAD `597c1d4985724e3dd77660a3562020d7004b6d86` に未コミット変更と未追跡証拠があるため、別のdetached worktreeを作成し、既存作業は不変更。

`run.cjs` は配信するsuiteだけに、DB名生成直後の `window.t7DbIdentity = {...}` を1行挿入する。原版ファイルは編集しない。初回open前にrunId、完全DB名、iteration 0（T7開始前）、初回要求version 1、UTC ISO時刻、main単調時計、Linux WebKit、観測段階を1回記録する。同じDBが全反復で使用されるため、各反復はidentityRefとrunIdで結合し、versionは既存open_startから取得する。DB名の反復出力はしない。

原版suite/worker/cleanupと過去CIソースの改行正規化hash一致を確認済み。生成ソースは1行挿入を除去すると元ソースに完全一致することを実行前に検査する。artifactに生成差分・ソースhash・実checkout HEAD/tree・dirty・実行環境・全既存timelineを保存する。

Linux WebKit、**1試行のみ・追加実行0回**。新規browser/context、元のfixture初期化と事前snapshot、`t7Only: true`、最大12反復、open8000ms、cleanup2000ms、context180000ms、close5000ms。`node experiments/t7-db-identity/run.cjs`。T1〜T6は実行せず、T8〜T12も実行しない。再試行ループはない。専用workflowはrunner/workflow変更pushだけで起動し、報告・証拠commitでは診断を再実行しない。

## 原版との相違と限界

過去の原版primaryはT1〜T6を先行実行した。今回は依頼どおりT7単独で、新規process/context、単一のDB identityオブジェクト作成と時計採取が追加される。既存t7-onlyのtimeout・反復・Worker/IDB操作・cleanupは維持する。計測によるタイミング影響、新規環境の影響はUNKNOWN。成功しても原版失敗の解消や失敗DB特定とは判定しない。

transaction競合、接続残留、close後の資源解放、通知遅延、OS資源解放はUNKNOWNのまま。ブラウザ異常終了などで結果回収できない場合、識別子取得は未達とする。内部観測・接続操作・強制削除は追加しない。

## 結果

**総合判定 PASS（失敗した診断T7のDB識別子取得）**。T7そのものとCIはFAIL、cleanupはUNKNOWN。過去の原版失敗DB識別子は未観測のまま。

- [専用CI 41244959121](https://github.com/tetsujisugimori-coder/memo/actions/runs/41244959121)、job 124666359277、[artifact 13058663151](https://github.com/tetsujisugimori-coder/memo/actions/runs/41244959121/artifacts/13058663151)。実行1回、追加実行0回。
- 計測commit / 実行HEAD `7b30786ea9f2473e5e2423ccb4a279475ff18646`、tree `1525aa5e6c3ce8c1302fae8ffafe8a323c66b660`、clean。Linux WebKit 26.5、Node v22.23.4。コマンド `node experiments/t7-db-identity/run.cjs`。
- 実行識別子 `0d4bd770-fdb2-431c-8444-73c3e55693c3`。DB識別子 **`worker-poc-b61a85f0-8a98-44b4-93a6-9b6040827d20`**。生成直後・初回open前、iteration 0、初回要求version 1、mainMs34、2026-10-31T21:46:19.116Z（2026-11-01 06:46:19.116 JST）に一度記録。

以下の全行は上記runId・同一DBに対応する。DB名は反復出力せず、JSONのidentityRefで結合する。cleanup欄は各反復の個別削除ではなく、試行終了時の共通cleanup結果。

| iteration | 要求version | open→結果seq | upgrade観測時間 | 結果 | timeout | cleanup |
|---|---|---|---|---|---|---|
| 1 | 2 | 30→32 | 1ms | success | 無 | UNKNOWN |
| 2 | 3 | 47→49 | 0ms（時計分解能内） | success | 無 | UNKNOWN |
| 3 | 4 | 64→66 | 1ms | success | 無 | UNKNOWN |
| 4 | 5 | 81→83 | 1ms | success | 無 | UNKNOWN |
| **5** | **6** | **98→99** | **8000ms** | **IndexedDB open timeout** | **有** | **UNKNOWN** |
| 6〜12 | — | — | — | NOT_RUN | 未実行 | 共通cleanupのみ |

失敗は `T7 iteration 5.upgrade: IndexedDB open timeout; blocked event: false`。version 5→6。cleanupはterminal timeout、2000ms、blocked未観測、UNKNOWN。context.closeとbrowser.closeはRETURNEDだが、物理解放の証明にはしない。T1〜T6/T8〜T12はNOT_RUN。失敗iterationのopen→timeoutにblocked/upgradeneeded/success/errorを受信していないことと、イベント自体が内部で発生しなかったことは区別する。

原始JSON、配信suite差分、診断job log、意図せず自動起動したCIのキャンセル状態を `evidence/` にgzipで保存。`diagnostic-index.json` に実行版、raw/gzip hash、8配信ソースの実commitとのhash照合、runner hash、初回open前の順序照合を記録した。job logはGitHubのテキストをPowerShell UTF8で保存したもので、BOM/改行を含む保存後hashである。原始JSONはartifactの内容をそのまま圧縮した。

push時のPR累積差分により既存CI 41244962234、Stage3 41244962152、PoC 41244962262、旧T7単独41244962316も自動起動したためキャンセルした。すべてcancelledで、旧T7単独は両engineともT7/recovery-browserがskipped（準備中にmodel単体試験のみ自動実行）。PoC/Stage3もブラウザ診断は実行されていない。証拠追記commitには `[skip ci]` を付け、広範囲CIの再起動を避ける。専用診断の反復はしない。

差分要約：新規診断runner・専用workflow・報告・証拠のみ。原版suite/worker/cleanup、製品コード、既存未コミット作業と既存証拠は不変更。

## 次工程と残件

今回の成功条件は満たしたため追加観測0回で終了。次の最小作業は実行HEAD・identity生成時点・iteration/version結合・FAIL/UNKNOWN保持の独立レビュー。DB取得自体の追加観測は不要。接続残留・transaction競合・WebKit内部動作・物理解放の調査は次工程へ分離する。原版iteration8の過去DB値、内部待機理由、通知遅延との区別、計測影響はUNKNOWN。

計測の自己検証を独立レビューとは扱わない。本番Worker採用HOLD、マージ推奨NO、Draft維持、マージしない。

記録日時：2026-11-01 06:48 JST。
