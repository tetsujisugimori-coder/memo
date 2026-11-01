# 静的検証記録

2026-11-02 JST。静的成果物の評価PASS、実験成立の見込みPARTIAL、停止時の内部未完了UNKNOWN。今回のブラウザ実験0、旧実験再実行0、製品変更0。実験runner・自動実行workflowの追加0。疑似試験の成功は、実ブラウザでの実現可能性・接続閉鎖・物理解放を証明しない。

## 局所試験

`node --test design/idb-incomplete-stop/judge.test.cjs` の22試験を実行。実行環境・日時・終了コードは `records/validation.json`、出力は `records/tests.log` に保存する。ブラウザ・Worker・IndexedDBを生成せず、旧実験モジュールをimportしない。依存はNode標準のtest/assertと純粋な `judge.cjs` のみ。

要求成功／readyStateだけの推論、通知欠落、送信後complete、別run/tx/Worker/接続/DB/iteration、abort/error、ゲート期限切れ・epoch不一致、後着通知、異時計差、terminate/closeの戻りによる解放推論を拒否する。成立とupgrade成否は独立。疑似oracleは明示モデル内のみ、通常入力には禁止。cleanupは証拠保存後の一度だけ、開始前の成功やtimeout→PASSも拒否する。

## workflowの事前確認

|既存workflow|発火条件と今回の扱い|
|---|---|
|ci.yml|push main / PR base main / 手動dispatch。新branchはdesign/idb-incomplete-stop、baseはinvestigate/idb-time-delay-only。dispatchしない|
|mcp-search-worker-feasibility / mcp-worker-stage3 / mcp-worker-t7-only|PRの変更pathが旧PoCディレクトリまたは各workflow。今回のdesignディレクトリは一致しない。手動dispatchしない|
|mcp-t7-db-identity|push先がinvestigate/mcp-worker-recoveryかつ指定source/workflow。今回は一致しない|
|idb-upgrade-lifecycle|push先がinvestigate/idb-upgrade-lifecycleかつ指定source/workflow。今回は一致しない|
|idb-transaction-complete-only|push先がinvestigate/idb-transaction-complete-onlyかつ指定source/workflow。今回は一致しない|
|idb-time-delay-only|push先がinvestigate/idb-time-delay-onlyかつ指定source/workflow。今回は一致しない|

workflowは変更しない。commitには追加防御として `[skip ci]` を付ける。最終diffが本設計ディレクトリのみであることを確認してpushする。新規branchのActions履歴も確認する。将来のbase変更やworkflow改変まで自動防止できる保証はない。今回の静的設計を実行許可として扱わない。

## 旧証拠・作業保全

`records/inspection.json` は初回確認のHEAD/tree、既存worktree状態、D/Eの19ファイル・Fの20ファイル・Gの25ファイルのSHA-256検証と原始JSON内のrun/DB/結果を保持する。gzipは圧縮byteと展開byte、テキストは旧index契約のLF正規化で照合した。保存済み実行版と証拠版は [sources.md](sources.md) で分離した。

提出前にも既存worktreeのHEAD/status、旧証拠hashを照合する。他worktreeの未コミット・未追跡内容を整理・削除しない。現在mainと参照PR HEADが変化していないことを確認し、差があれば上書きせず記録する。全変更が新規設計ファイルであることをgit diffで確認する。

## 再検証

`records/SHA256SUMS` はGit blobのLF表現を基準に、本設計ディレクトリの各成果物（manifest自身を除く）のSHA-256を記録する。Windows checkoutのCRLFとの差に注意する。`git show <提出HEAD>:design/idb-incomplete-stop/<path>` のbyteから再計算できる。GitHubの元JSONはgzip展開後のhashもinspection.jsonに記録している。ローカル検証ログのSHAはmanifestから検証できる。

CIを起動していないため今回のCI判定はNOT_RUN。既存D/E/F/GのCI結果・原始証拠は継承して参照するだけで再実行しない。H1/H2/H3 UNKNOWN、H4 PARTIAL、本番Worker HOLD、マージ推奨NO、Draft維持。
