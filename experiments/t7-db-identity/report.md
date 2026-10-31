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

Linux専用CIの1回の結果を取得後に追記する。計測の自己検証を独立レビューとは扱わない。Draft維持、マージしない。
