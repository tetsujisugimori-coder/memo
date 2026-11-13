# Stage 1 提出報告

## A. 総合判定

**PARTIAL。診断基盤の実装・モック検証は完了。実モデル根本原因UNKNOWN。Draft維持、マージ推奨NO。**
実装固定版 `bb52b287a4e86f71d26f38b56eb25031f94cc76e` / tree `82f10b599831d30b3c8520a713d244181bb083af`。後続提出は文書・証拠追加のみ。GitHub提出HEAD/treeとCI確定値はPR本文・最終コメントを正とし、ローカルcommitと混同しない。

## B. 原因候補と証拠

空正常EOF、thinking-only、done欠落、翻訳への履歴混入、save待ち中の設定変更、モデル/Ollama依存を分離した。[調査表・処理経路・A〜D比較](README.md)を参照。空正常EOFと欠doneはモックで観測できるが、利用者が実際に遭遇した症状との因果はUNKNOWN。

## C. 確認されたコード上の問題

既存処理は空でもCOMPLETEDへ遷移する。空assistantの履歴表示には「生成中…」が残り得る。Geminiの既存抽出はthought指定のtextも表示へ含める。翻訳でも過去の会話を送る。Stage 1ではこれらを推測修正しない。新規診断で生じた初期化順と不正thinking値の2回帰は独立レビューの反例を追加して修正した。

## D. 実装

一意requestId、HTTP/stream/本文/thinking/done/EOF/最終回答/UI文字数・結果分類、メモリ内上限付きホワイトリスト診断、最小details UI・コピー・オフ・消去。両アダプタの既存yieldとプロンプト/モデル設定を保持。UIの既存数値requestIdによる旧応答拒否を保持。診断IDをネットワークへ送らない。

## E. モック結果

- 新規診断28/28 PASS。関連全体118/118 PASS（28件を含む、合算しない）。[TAP原票](ai-regression.tap)。実装者と独立担当が同じ118件を各1回確認。
- 最低20項目を含む連続2/5回、遅延旧要求、空/done/thinking/欠done、UTF-8 byte分割、複数イベント、重複done、不完全JSON、通信切断、停止/timeout、用途/言語/履歴/モデル/開閉、UI文字数、秘密非混入、ON/OFF、件数/期限/サイズ/消去を検証。
- 実appの生成/描画/開閉/reset関数をVMと最小DOMで実行。新規startup反例も実initの初回await前と既存guardを組合せる。ブラウザ全体の起動/paintではない。

## F. 回帰・既存CI

- Windows Node v24.20.0。最終製品sourceに対する全単体: **2019 total / 1993 PASS / 25 FAIL / 1 cancelled / skip 0**。[集計・失敗位置・原ログhash](local-results.json)。全体PASSではない。
- 多くはloopback connect EACCES / fetch failed。OAuthの1件は10秒timeoutでcancelled。権限/通信制約を緩和せず、既存検査やassertを変更しない。
- launcher設定検証とWindows専用history ACL検査もFAIL。分離した基準mainでこの2件だけを再実施し **0 PASS / 2 FAIL**、同じinvalid_configurationおよびexpected True/actual False。AI変更との因果は支持されないが、未解決の既存環境制約として残す。
- 初回全体（レビュー修正前）は2015 total /1989 PASS /25 FAIL /1 cancelled。これは最終版の結果へ置換せず履歴として記録。
- JavaScript構文285ファイルPASS。`git diff --check` PASS。lint/typecheck/build scriptは構成に存在しないためNOT_CONFIGURED（PASSとしない）。静的サイトでbuild工程はない。
- 依存は読み取り可能な既存node_modulesを専用領域へコピーし、Playwright 1.62.1 / SDK1.32.1を確認。lock変更なし。ネットワークcloneは失敗し、既存Git objectsを専用領域へコピー、GitHubで確認したmain SHAから新規checkout。npm ciによる再取得は未実施。
- ローカルブラウザE2Eはloopback通信制約があるためNOT_TESTED。GitHubの既存CIはPR作成後に確認し、PRへ正確なrun/状態を追記する。現時点ではPENDING_CI、成功主張なし。

## G. 未検証

Windows実Ollama、インストール済み実モデル、Ollama単体比較、実モデルの連続翻訳/質問、実ブラウザ可視性は **PENDING_MANUAL**。[後日用手順](MANUAL.md)。モデルdownloadなし。利用者へ即時作業要求なし。

## H. セキュリティと作業保全

本文・質問・回答・thinking・APIキー・認証情報を通常診断に保持せず、外部送信・永続保存なし。モデル識別子はメタデータとして含む（匿名化とは呼ばない）。コピーもホワイトリスト値のみ。保存/編集/IndexedDB/Worker/MCP/Codexのコードを変更しない。

開始workspaceは空・非Git。元コピーは別案件branch `investigate/chart-webkit-stage4-sigterm-order` / HEAD `8b1c135d4192ad570170d359d09c30a756ff7d0b`、read-only参照のみ。元領域のGit statusは権限制約で取得できずdirty状態UNKNOWNなので、そのworking treeを使わなかった。対象の分離checkoutは開始時clean。Cドライブ空き約432GB、専用task-tempへの書込み確認、子プロセスのTEMP/TMPを専用領域へ設定。共有Temp清掃・sandbox無効化・権限緩和なし。

## I. 独立レビュー

[レビュー記録](INDEPENDENT.md)。初期固定 `0a809bf5c448c8c2197189c0a40ed99d9e20fe97` / tree `99803c1e308544d5344d27fd77c4489b7fc9aff9` からP1/P2を検出。修正版bb52b287で両件閉鎖、118/118独立PASS、確認範囲内の未解決P1/P2なし。全体試験や実モデルを独立PASSへ拡張しない。GitHubへCOMMENTで提出し、自己APPROVEは行わない。

## J. 提出と変更ファイル

[Issue #455](https://github.com/tetsujisugimori-coder/memo/issues/455)。branch `feat/ai-diagnostics-stage1-20261113`、main直接変更なし。開始HEAD `08572bb0f888c5e8b6f57f3c1aefe98fbf5d2e4d` / tree `bc6709ee93d44d8722ac653ef9cd960d99b93c03`。

製品: ai-diagnostics.js、ai-provider.js、ollama-adapter.js、gemini-adapter.js、app.js、index.html。試験: ai-diagnostics.test.js、version.test.js。文書: README.md、LOG.md、docs/ai-diagnostics-stage1/。Draft URL、提出HEAD/tree、CI/正式レビューURLはPRに追記する。

## K. 次工程

まず既存CIの結果とWindows環境の未達検証を確認し、後日にMANUAL.mdでA〜Dを比較する。根拠が揃ってからStage 2の状態/UI/履歴分離を判断。Stage 3の機能拡充は別工程。

## L. マージ推奨

**NO**。全体回帰と実モデル検証の未達を維持し、Draftで提出する。Stage 1のモック成功を根本原因解消・製品全面受入へ読み替えない。
